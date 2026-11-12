import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'astro/zod';

const root = new URL('../', import.meta.url);
const API = 'https://api.invalid';
const ids = {
	patient: '11111111-1111-4111-8111-111111111111',
	other: '22222222-2222-4222-8222-222222222222',
	user: '33333333-3333-4333-8333-333333333333',
};

// Loads a TypeScript module graph through node:vm with one instance per file, so
// class identity (ApiError) is shared between the action, the API and the client.
async function compile(path, fetchImpl = async () => Response.json({})) {
	const context = vm.createContext({ URL, URLSearchParams, Response, Error, Date, atob, fetch: fetchImpl });
	const modules = new Map();
	const synthetic = {
		'astro:actions': () => new vm.SyntheticModule(['defineAction'], function () { this.setExport('defineAction', (config) => config); }, { context }),
		'astro/zod': () => new vm.SyntheticModule(['z'], function () { this.setExport('z', z); }, { context }),
	};
	async function load(href) {
		if (!modules.has(href)) {
			const pending = (async () => {
				const code = await readFile(new URL(href), 'utf8');
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const mod = new vm.SourceTextModule(output, {
					context,
					identifier: href,
					initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: API }; },
				});
				await mod.link(async (specifier, parent) => {
					if (synthetic[specifier]) {
						const cached = `synthetic:${specifier}`;
						if (!modules.has(cached)) modules.set(cached, Promise.resolve(synthetic[specifier]()));
						return modules.get(cached);
					}
					return load(new URL(`${specifier}.ts`, parent.identifier).href);
				});
				return mod;
			})();
			modules.set(href, pending);
		}
		return modules.get(href);
	}
	const mod = await load(new URL(path, root).href);
	await mod.evaluate();
	return mod.namespace;
}

// Scripted backend: every request is recorded with its method, path, query and parsed JSON body.
function backend(route) {
	const calls = [];
	const fetch = async (url, init = {}) => {
		const parsed = new URL(url);
		const call = {
			method: init.method ?? 'GET',
			path: parsed.pathname,
			search: parsed.search,
			body: init.body === undefined ? undefined : JSON.parse(init.body),
		};
		calls.push(call);
		const { status = 200, body } = await route(call);
		return Response.json(body, { status });
	};
	const patientCalls = () => calls.filter((call) => call.path.startsWith('/reception/patients'));
	return { fetch, calls, patientCalls };
}

const cookies = () => ({
	get: () => ({ value: 'session-token' }),
	set() {},
	delete() { this.deleted = true; },
	deleted: false,
});

const dto = (overrides = {}) => ({
	id: ids.patient,
	documento: '12345678',
	nombres: 'Ana',
	apellidos: 'Pérez',
	fecha_nacimiento: '1990-05-17',
	email: 'ana@example.invalid',
	celular: '5550100',
	sexo: 'F',
	direccion: 'Calle 1',
	...overrides,
});
// Values built inside the vm context carry another realm's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const withoutKey = (object, key) => { const copy = { ...object }; delete copy[key]; return copy; };

const careersModule = 'src/pods/reception/careers.ts';
const apiModule = 'src/pods/reception-patient/api.ts';
const actionsModule = 'src/pods/reception-patient/actions.ts';
const stateModule = 'src/pods/reception-patient/state.ts';

test('GET /reception/careers must be exactly {careers: known codes}', async () => {
	for (const body of [{ careers: [] }, { careers: ['kinesiology'] }, { careers: ['kinesiology', 'odontology'] }]) {
		const net = backend(() => ({ body }));
		const api = await compile(careersModule, net.fetch);
		assert.deepEqual(await api.listGrantedCareers(cookies()), body.careers);
		assert.equal(net.calls[0].path, '/reception/careers');
		assert.equal(net.calls[0].method, 'GET');
		assert.equal(net.calls[0].search, '');
	}
	for (const body of [null, {}, { careers: [], items: [] }, { careers: ['pediatrics'] }, { careers: 'kinesiology' }, { careers: ['kinesiology', 'kinesiology'] }, { careers: [null] }]) {
		const net = backend(() => ({ body }));
		const api = await compile(careersModule, net.fetch);
		await assert.rejects(api.listGrantedCareers(cookies()), /inválida/);
	}
});

test('career labels are the two Spanish labels for the known codes', async () => {
	const api = await compile(careersModule);
	assert.deepEqual([...api.RECEPTION_CAREERS], ['kinesiology', 'odontology']);
	assert.deepEqual(plain(api.RECEPTION_CAREER_LABELS), { kinesiology: 'Kinesiología', odontology: 'Odontología' });
});

test('selectGrantedCareer returns a career only when it is known and currently granted', async () => {
	const api = await compile(careersModule);
	assert.equal(api.selectGrantedCareer('kinesiology', ['kinesiology']), 'kinesiology');
	assert.equal(api.selectGrantedCareer('odontology', ['kinesiology', 'odontology']), 'odontology');
	assert.equal(api.selectGrantedCareer('odontology', ['kinesiology']), null, 'ungranted career is rejected');
	assert.equal(api.selectGrantedCareer('kinesiology', []), null, 'zero careers select nothing');
	assert.equal(api.selectGrantedCareer('pediatrics', ['kinesiology', 'odontology']), null, 'unknown code is rejected');
	assert.equal(api.selectGrantedCareer('constructor', ['kinesiology', 'odontology']), null, 'prototype keys are not careers');
	assert.equal(api.selectGrantedCareer(null, ['kinesiology']), null);
	assert.equal(api.selectGrantedCareer(undefined, ['kinesiology']), null);
});

test('parseRequestedCareer reads one ?career= value and treats repeated values as no selection', async () => {
	const api = await compile(careersModule);
	assert.equal(api.parseRequestedCareer(new URLSearchParams()), null);
	assert.equal(api.parseRequestedCareer(new URLSearchParams('career=kinesiology')), 'kinesiology');
	assert.equal(api.parseRequestedCareer(new URLSearchParams('career=kinesiology&career=odontology')), null);
});

test('loadCareerScope fetches careers fresh on every call and drops a career revoked between requests', async () => {
	const responses = [{ careers: ['kinesiology', 'odontology'] }, { careers: ['kinesiology'] }];
	const net = backend(() => ({ body: responses.shift() }));
	const api = await compile(careersModule, net.fetch);
	const params = new URLSearchParams('career=odontology');
	assert.deepEqual(plain(await api.loadCareerScope(params, cookies())), { careers: ['kinesiology', 'odontology'], selected: 'odontology' });
	assert.deepEqual(plain(await api.loadCareerScope(params, cookies())), { careers: ['kinesiology'], selected: null });
	assert.equal(net.calls.length, 2, 'no caching between renders');
});

test('loadCareerScope with zero granted careers selects nothing', async () => {
	const net = backend(() => ({ body: { careers: [] } }));
	const api = await compile(careersModule, net.fetch);
	assert.deepEqual(plain(await api.loadCareerScope(new URLSearchParams('career=kinesiology'), cookies())), { careers: [], selected: null });
});

test('GET /reception/patients is scoped by career and validates the exact DTO list', async () => {
	const net = backend(() => ({ body: { items: [dto(), dto({ id: ids.other, fecha_nacimiento: null })], limit: 100, offset: 0 } }));
	const api = await compile(apiModule, net.fetch);
	const items = await api.listReceptionPatients('kinesiology', cookies());
	assert.equal(items.length, 2);
	assert.equal(items[1].fecha_nacimiento, null);
	assert.equal(net.calls[0].method, 'GET');
	assert.equal(net.calls[0].path, '/reception/patients');
	assert.equal(net.calls[0].search, '?career=kinesiology&limit=100&offset=0');
	assert.equal(net.calls[0].body, undefined);
});

test('patient DTO rejects extra keys, missing keys and malformed values', async () => {
	const bad = [
		{ ...dto(), created_by: ids.user },
		withoutKey(dto(), 'email'),
		dto({ id: 'not-a-uuid' }),
		dto({ fecha_nacimiento: '17/05/1990' }),
		dto({ fecha_nacimiento: '1990-02-30' }),
		dto({ documento: 12345678 }),
		dto({ nombres: null }),
	];
	for (const item of bad) {
		const net = backend(() => ({ body: { items: [item] } }));
		const api = await compile(apiModule, net.fetch);
		await assert.rejects(api.listReceptionPatients('kinesiology', cookies()), /inválid/);
	}
	const extraEnvelope = backend(() => ({ body: { items: [], limit: 100, offset: 0, total: 0 } }));
	await assert.rejects((await compile(apiModule, extraEnvelope.fetch)).listReceptionPatients('kinesiology', cookies()), /inválid/);
});

test('match posts exactly career and documento and accepts only the two documented shapes', async () => {
	const noMatch = backend(() => ({ body: { match: false } }));
	const apiNo = await compile(apiModule, noMatch.fetch);
	assert.deepEqual(plain(await apiNo.matchReceptionPatient('kinesiology', '12345678', cookies())), { match: false });
	assert.equal(noMatch.calls[0].method, 'POST');
	assert.equal(noMatch.calls[0].path, '/reception/patients/match');
	assert.deepEqual(noMatch.calls[0].body, { career: 'kinesiology', documento: '12345678' });

	const yes = backend(() => ({ body: { match: true, patient_id: ids.patient } }));
	assert.deepEqual(plain(await (await compile(apiModule, yes.fetch)).matchReceptionPatient('odontology', '12345678', cookies())), { match: true, patient_id: ids.patient });

	for (const body of [{ match: true, patient_id: ids.patient, nombres: 'Ana' }, { match: false, patient_id: ids.patient }, { match: true, patient_id: 'bad' }, { match: 'yes' }, {}]) {
		const net = backend(() => ({ body }));
		await assert.rejects((await compile(apiModule, net.fetch)).matchReceptionPatient('kinesiology', '12345678', cookies()), /inválid/);
	}
});

test('reuse posts the explicit link and accepts only an enrollment matching its inputs', async () => {
	const ok = backend(() => ({ body: { patient_id: ids.patient, career: 'kinesiology', enrolled: true } }));
	const api = await compile(apiModule, ok.fetch);
	assert.deepEqual(plain(await api.reuseReceptionPatient('kinesiology', ids.patient, '12345678', cookies())), { patient_id: ids.patient, career: 'kinesiology', enrolled: true });
	assert.equal(ok.calls[0].method, 'POST');
	assert.equal(ok.calls[0].path, '/reception/patients/reuse');
	assert.deepEqual(ok.calls[0].body, { career: 'kinesiology', patient_id: ids.patient, documento: '12345678' });

	const mismatched = [
		{ patient_id: ids.other, career: 'kinesiology', enrolled: true },
		{ patient_id: ids.patient, career: 'odontology', enrolled: true },
		{ patient_id: ids.patient, career: 'kinesiology', enrolled: false },
		{ patient_id: ids.patient, career: 'kinesiology', enrolled: true, nombres: 'Ana' },
	];
	for (const body of mismatched) {
		const net = backend(() => ({ body }));
		await assert.rejects((await compile(apiModule, net.fetch)).reuseReceptionPatient('kinesiology', ids.patient, '12345678', cookies()), /inválid/);
	}
});

test('register posts every required field and validates the 201 DTO', async () => {
	const net = backend(() => ({ status: 201, body: dto() }));
	const api = await compile(apiModule, net.fetch);
	const input = { career: 'kinesiology', documento: '12345678', nombres: 'Ana', apellidos: 'Pérez', fecha_nacimiento: '1990-05-17', email: 'ana@example.invalid', celular: '5550100', sexo: 'F', direccion: 'Calle 1' };
	assert.equal((await api.registerReceptionPatient(input, cookies())).id, ids.patient);
	assert.equal(net.calls[0].method, 'POST');
	assert.equal(net.calls[0].path, '/reception/patients/register');
	assert.deepEqual(net.calls[0].body, input);

	const invalid = backend(() => ({ status: 201, body: withoutKey(dto(), 'direccion') }));
	await assert.rejects((await compile(apiModule, invalid.fetch)).registerReceptionPatient(input, cookies()), /inválid/);
});

test('PATCH targets the scoped patient and validates the returned DTO id', async () => {
	const net = backend(() => ({ body: dto({ email: 'nuevo@example.invalid' }) }));
	const api = await compile(apiModule, net.fetch);
	const result = await api.updateReceptionPatientContact(ids.patient, 'odontology', { email: 'nuevo@example.invalid', celular: '5550100', direccion: 'Calle 1' }, cookies());
	assert.equal(result.email, 'nuevo@example.invalid');
	assert.equal(net.calls[0].method, 'PATCH');
	assert.equal(net.calls[0].path, `/reception/patients/${ids.patient}`);
	assert.equal(net.calls[0].search, '?career=odontology');
	assert.deepEqual(Object.keys(net.calls[0].body).sort(), ['celular', 'direccion', 'email']);

	const wrongId = backend(() => ({ body: dto({ id: ids.other }) }));
	await assert.rejects((await compile(apiModule, wrongId.fetch)).updateReceptionPatientContact(ids.patient, 'odontology', { email: 'a@b.c', celular: '1', direccion: 'x' }, cookies()), /inválid/);
});

test('documento must be 4 to 8 digits and invalid input never reaches fetch', async () => {
	let calls = 0;
	const fetch = async () => { calls++; return Response.json({ match: false }); };
	const api = await compile(actionsModule, fetch);
	const base = { career: 'kinesiology', documento: '12345678', patient_id: ids.patient };
	for (const documento of ['', '123', '123456789', '12a4', '12 34', '1.234']) {
		assert.equal((await api.handleMatchReceptionPatient({ ...base, documento }, { cookies: cookies() })).success, false, `match rejects ${documento}`);
		assert.equal((await api.handleReuseReceptionPatient({ ...base, documento }, { cookies: cookies() })).success, false, `reuse rejects ${documento}`);
		assert.equal((await api.handleRegisterReceptionPatient({ ...base, documento, nombres: 'A', apellidos: 'B', fecha_nacimiento: '01/01/2000', email: 'a@b.c', celular: '1', sexo: 'F', direccion: 'x' }, { cookies: cookies() })).success, false, `register rejects ${documento}`);
	}
	assert.equal(calls, 0);
	assert.equal((await api.handleMatchReceptionPatient({ ...base, documento: '1234' }, { cookies: cookies() })).success, true);
	assert.equal((await api.handleMatchReceptionPatient({ ...base, documento: '12345678' }, { cookies: cookies() })).success, true);
	assert.equal(calls, 2);
});

test('every handler rejects an unknown career before any request', async () => {
	let calls = 0;
	const api = await compile(actionsModule, async () => { calls++; return Response.json({}); });
	const base = { documento: '12345678', patient_id: ids.patient, id: ids.patient, email: 'a@b.c', celular: '1', direccion: 'x', nombres: 'A', apellidos: 'B', fecha_nacimiento: '01/01/2000', sexo: 'F' };
	for (const career of ['pediatrics', '', undefined, 'Kinesiology']) {
		assert.equal((await api.handleMatchReceptionPatient({ ...base, career }, { cookies: cookies() })).success, false);
		assert.equal((await api.handleReuseReceptionPatient({ ...base, career }, { cookies: cookies() })).success, false);
		assert.equal((await api.handleRegisterReceptionPatient({ ...base, career }, { cookies: cookies() })).success, false);
		assert.equal((await api.handleUpdateReceptionPatientContact({ ...base, career }, { cookies: cookies() })).success, false);
	}
	assert.equal(calls, 0);
});

test('match never links or exposes identity; only the explicit reuse action performs the link', async () => {
	const net = backend(({ path }) => (path.endsWith('/match') ? { body: { match: true, patient_id: ids.patient } } : { body: { patient_id: ids.patient, career: 'kinesiology', enrolled: true } }));
	const api = await compile(actionsModule, net.fetch);
	const matched = await api.handleMatchReceptionPatient({ career: 'kinesiology', documento: '12345678' }, { cookies: cookies() });
	assert.equal(matched.success, true);
	assert.equal(matched.match, true);
	assert.equal(matched.patientId, ids.patient);
	assert.doesNotMatch(JSON.stringify(matched), /Ana|Pérez|ana@example/);
	assert.deepEqual(net.calls.map((call) => call.path), ['/reception/patients/match']);

	const linked = await api.handleReuseReceptionPatient({ career: 'kinesiology', patient_id: ids.patient, documento: '12345678' }, { cookies: cookies() });
	assert.equal(linked.success, true);
	assert.deepEqual(net.calls.map((call) => call.path), ['/reception/patients/match', '/reception/patients/reuse']);
	assert.deepEqual(net.calls[1].body, { career: 'kinesiology', patient_id: ids.patient, documento: '12345678' });
});

test('reuse action rejects an enrollment response that does not match the request', async () => {
	const net = backend(() => ({ body: { patient_id: ids.other, career: 'kinesiology', enrolled: true } }));
	const api = await compile(actionsModule, net.fetch);
	const result = await api.handleReuseReceptionPatient({ career: 'kinesiology', patient_id: ids.patient, documento: '12345678' }, { cookies: cookies() });
	assert.equal(result.success, false);
});

test('register converts dd/mm/yyyy birth dates like the paciente form and rejects invalid input before fetch', async () => {
	const net = backend(() => ({ status: 201, body: dto() }));
	const api = await compile(actionsModule, net.fetch);
	const valid = { career: 'kinesiology', documento: '12345678', nombres: 'Ana', apellidos: 'Pérez', fecha_nacimiento: '17/05/1990', email: 'ana@example.invalid', celular: '5550100', sexo: 'F', direccion: 'Calle 1' };
	const result = await api.handleRegisterReceptionPatient(valid, { cookies: cookies() });
	assert.equal(result.success, true);
	assert.equal(net.calls[0].body.fecha_nacimiento, '1990-05-17');
	assert.deepEqual(Object.keys(net.calls[0].body).sort(), ['apellidos', 'career', 'celular', 'direccion', 'documento', 'email', 'fecha_nacimiento', 'nombres', 'sexo']);

	const before = net.calls.length;
	for (const patch of [{ fecha_nacimiento: '31/02/1990' }, { fecha_nacimiento: '01/01/2099' }, { fecha_nacimiento: '1990-05-17' }, { sexo: 'X' }, { nombres: '  ' }, { email: '' }, { direccion: '' }]) {
		assert.equal((await api.handleRegisterReceptionPatient({ ...valid, ...patch }, { cookies: cookies() })).success, false, JSON.stringify(patch));
	}
	assert.equal(net.calls.length, before);
});

test('contact action sends only email, celular and direccion even when identity fields are submitted', async () => {
	const net = backend(() => ({ body: dto({ email: 'nuevo@example.invalid' }) }));
	const api = await compile(actionsModule, net.fetch);
	const result = await api.handleUpdateReceptionPatientContact({
		id: ids.patient, career: 'odontology', email: ' nuevo@example.invalid ', celular: '5550199', direccion: 'Calle 2',
		nombres: 'Otra', documento: '99999999', fecha_nacimiento: '01/01/2000', sexo: 'M',
	}, { cookies: cookies() });
	assert.equal(result.success, true);
	assert.equal(net.calls[0].method, 'PATCH');
	assert.equal(net.calls[0].path, `/reception/patients/${ids.patient}`);
	assert.equal(net.calls[0].search, '?career=odontology');
	assert.deepEqual(net.calls[0].body, { email: 'nuevo@example.invalid', celular: '5550199', direccion: 'Calle 2' });

	const before = net.calls.length;
	assert.equal((await api.handleUpdateReceptionPatientContact({ id: ids.patient, career: 'odontology', email: '  ', celular: '1', direccion: 'x' }, { cookies: cookies() })).success, false);
	assert.equal((await api.handleUpdateReceptionPatientContact({ id: 'bad', career: 'odontology', email: 'a@b.c', celular: '1', direccion: 'x' }, { cookies: cookies() })).success, false);
	assert.equal(net.calls.length, before);
});

test('action input schemas accept the known career codes and reject other values', async () => {
	const api = await compile(actionsModule);
	assert.equal(api.matchReceptionPatient.input.safeParse({ career: 'kinesiology', documento: '12345678' }).success, true);
	assert.equal(api.matchReceptionPatient.input.safeParse({ career: 'pediatrics', documento: '12345678' }).success, false);
	assert.equal(api.reuseReceptionPatient.input.safeParse({ career: 'odontology', patient_id: 'bad', documento: '12345678' }).success, false);
	assert.equal(api.updateReceptionPatientContact.input.safeParse({ id: ids.patient, career: 'odontology', email: 'a@b.c', celular: '1', direccion: 'x' }).success, true);
});

test('scoped errors map to Spanish copy without backend messages or other-career hints', async () => {
	for (const [status, code] of [[400, 'BAD_REQUEST'], [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'CONFLICT'], [500, 'INTERNAL_SERVER_ERROR']]) {
		const c = cookies();
		const net = backend(() => ({ status, body: { error: { code, message: 'private backend detail for another career' } } }));
		const api = await compile(actionsModule, net.fetch);
		const result = await api.handleMatchReceptionPatient({ career: 'kinesiology', documento: '12345678' }, { cookies: c });
		assert.equal(result.success, false, `status ${status}`);
		assert.doesNotMatch(result.error, /private backend|another career|otra carrera|other career/i);
		assert.equal(!!result.unauthorized, status === 401);
		assert.equal(!!c.deleted, status === 401, 'only 401 clears the session');
		if (status === 404) assert.match(result.error, /carrera/, '404 explains the career scope without naming other activity');
	}
	const offline = await compile(actionsModule, async () => { throw new Error('socket hang up with secret'); });
	const result = await offline.handleUpdateReceptionPatientContact({ id: ids.patient, career: 'kinesiology', email: 'a@b.c', celular: '1', direccion: 'x' }, { cookies: cookies() });
	assert.equal(result.success, false);
	assert.doesNotMatch(result.error, /secret|socket/);
});

test('no-careers state makes no patient or global calls', async () => {
	const net = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: [] } } : { body: { items: [] } }));
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionPatientsState(new URLSearchParams('career=kinesiology'), cookies());
	assert.equal(state.kind, 'no-careers');
	assert.equal(net.patientCalls().length, 0);
	assert.deepEqual(net.calls.map((call) => call.path), ['/reception/careers']);
});

test('ungranted or invalid career selects nothing and makes no patient calls', async () => {
	for (const search of ['career=odontology', 'career=pediatrics', 'career=kinesiology&career=kinesiology', '']) {
		const net = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { body: { items: [dto()], limit: 100, offset: 0 } }));
		const api = await compile(stateModule, net.fetch);
		const state = await api.loadReceptionPatientsState(new URLSearchParams(search), cookies());
		assert.equal(state.kind, 'select', search);
		assert.deepEqual(state.careers, ['kinesiology']);
		assert.equal(net.patientCalls().length, 0, search);
	}
});

test('granted career loads only the career-scoped patient list', async () => {
	const net = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology', 'odontology'] } } : { body: { items: [dto()], limit: 100, offset: 0 } }));
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionPatientsState(new URLSearchParams('career=kinesiology'), cookies());
	assert.equal(state.kind, 'list');
	assert.equal(state.career, 'kinesiology');
	assert.equal(state.patients.length, 1);
	assert.deepEqual(net.calls.map((call) => `${call.method} ${call.path}${call.search}`), ['GET /reception/careers', 'GET /reception/patients?career=kinesiology&limit=100&offset=0']);
	assert.ok(net.calls.every((call) => !/^\/(patients|patient-availabilities)/.test(call.path)), 'no global endpoints');
});

test('switching career renders only the current request data', async () => {
	const net = backend(({ path, search }) => {
		if (path === '/reception/careers') return { body: { careers: ['kinesiology', 'odontology'] } };
		return { body: { items: [dto({ id: search.includes('odontology') ? ids.other : ids.patient, nombres: search.includes('odontology') ? 'Bea' : 'Ana' })], limit: 100, offset: 0 } };
	});
	const api = await compile(stateModule, net.fetch);
	const first = await api.loadReceptionPatientsState(new URLSearchParams('career=kinesiology'), cookies());
	const second = await api.loadReceptionPatientsState(new URLSearchParams('career=odontology'), cookies());
	assert.equal(first.patients[0].nombres, 'Ana');
	assert.equal(second.career, 'odontology');
	assert.deepEqual(second.patients.map((p) => p.nombres), ['Bea']);
	assert.equal(net.patientCalls().length, 2);
});

test('career revoked before the list request gives a neutral career-unavailable state without patient data', async () => {
	const net = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'active career scope was not found' } } }));
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionPatientsState(new URLSearchParams('career=kinesiology'), cookies());
	assert.equal(state.kind, 'career-unavailable');
	assert.equal(state.patients, undefined);
	assert.doesNotMatch(state.message, /active career scope|another career/);
});

test('invalid careers response yields unavailable without patient calls', async () => {
	const net = backend(() => ({ body: { careers: ['pediatrics'] } }));
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionPatientsState(new URLSearchParams('career=kinesiology'), cookies());
	assert.equal(state.kind, 'unavailable');
	assert.equal(net.patientCalls().length, 0);
});

test('page access: no session goes to login, non-reception role goes home, reception role renders', async () => {
	const api = await compile(stateModule);
	const jwt = (payload) => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
	assert.equal(api.resolveReceptionPatientsAccess(null), 'login');
	assert.equal(api.resolveReceptionPatientsAccess('not-a-jwt'), 'home');
	assert.equal(api.resolveReceptionPatientsAccess(jwt({ role: 'admin' })), 'home');
	assert.equal(api.resolveReceptionPatientsAccess(jwt({ role: 'Reception' })), 'home');
	assert.equal(api.resolveReceptionPatientsAccess(jwt({ role: 'reception' })), 'ok');
});
