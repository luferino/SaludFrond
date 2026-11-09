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
	otherPatient: '22222222-2222-4222-8222-222222222222',
	subject: '33333333-3333-4333-8333-333333333333',
	group: '44444444-4444-4444-8444-444444444444',
	otherSubject: '55555555-5555-4555-8555-555555555555',
	otherGroup: '66666666-6666-4666-8666-666666666666',
	activity: '77777777-7777-4777-8777-777777777777',
	otherActivity: '88888888-8888-4888-8888-888888888888',
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
	const scopedCalls = () => calls.filter((call) => call.path.startsWith('/reception/availability'));
	return { fetch, calls, scopedCalls };
}

const cookies = () => ({
	get: () => ({ value: 'session-token' }),
	set() {},
	delete() { this.deleted = true; },
	deleted: false,
});

const searchDto = (overrides = {}) => ({ patient_id: ids.patient, nombres: 'Ana', apellidos: 'Pérez', ...overrides });
const activityDto = (overrides = {}) => ({
	id: ids.activity,
	subject_id: ids.subject,
	academic_group_id: ids.group,
	enabled_at: '2026-11-09T10:00:00.000Z',
	withdrawn_at: null,
	...overrides,
});
const contextDto = (overrides = {}) => ({
	career: 'kinesiology',
	subject_id: ids.subject,
	academic_group_id: ids.group,
	subject_name: 'Anatomía',
	academic_group_name: 'Grupo A',
	...overrides,
});
const WITHDRAWN_AT = '2026-11-09T12:00:00.000Z';
const withoutKey = (object, key) => { const copy = { ...object }; delete copy[key]; return copy; };
// Values built inside the vm context carry another realm's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const route = (call) => `${call.method} ${call.path}${call.search}`;
// Echoes the requested limit and offset, the way the backend envelope does.
const envelope = (items, search) => {
	const params = new URLSearchParams(search);
	return { items, limit: Number(params.get('limit')), offset: Number(params.get('offset')) };
};
const jwt = (payload) => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

const apiModule = 'src/pods/reception-availability/api.ts';
const actionsModule = 'src/pods/reception-availability/actions.ts';
const stateModule = 'src/pods/reception-availability/state.ts';
const careersModule = 'src/pods/reception/careers.ts';
const page = { limit: 50, offset: 0 };

test('search GET is scoped by career and documento and returns the exact paginated envelope', async () => {
	const net = backend(({ search }) => ({ body: envelope([searchDto()], search) }));
	const api = await compile(apiModule, net.fetch);
	const result = await api.searchAvailabilityPatients('kinesiology', '12345678', page, cookies());
	assert.deepEqual(plain(result), { items: [searchDto()], limit: 50, offset: 0 });
	assert.equal(route(net.calls[0]), 'GET /reception/availability/search?career=kinesiology&documento=12345678&limit=50&offset=0');
	assert.equal(net.calls[0].body, undefined);
});

test('search rejects extra or missing envelope keys, mismatched pagination and malformed items', async () => {
	const bad = [
		() => ({ items: [], limit: 50, offset: 0, total: 0 }),
		() => ({ items: [], limit: 50 }),
		() => ({ items: [], limit: 10, offset: 0 }),
		() => ({ items: [], limit: 50, offset: 10 }),
		() => ({ items: [searchDto({ extra: true })], limit: 50, offset: 0 }),
		() => ({ items: [withoutKey(searchDto(), 'apellidos')], limit: 50, offset: 0 }),
		() => ({ items: [searchDto({ patient_id: 'not-a-uuid' })], limit: 50, offset: 0 }),
		() => ({ items: [searchDto({ nombres: '   ' })], limit: 50, offset: 0 }),
		() => ({ items: 'Ana', limit: 50, offset: 0 }),
	];
	for (const body of bad) {
		const net = backend(({ search }) => ({ body: body(search) }));
		const api = await compile(apiModule, net.fetch);
		await assert.rejects(api.searchAvailabilityPatients('kinesiology', '12345678', page, cookies()), /inválid/);
	}
});

test('contexts GET is career scoped and returns the exact context envelope', async () => {
	const net = backend(({ search }) => ({ body: envelope([contextDto()], search) }));
	const api = await compile(apiModule, net.fetch);
	const result = await api.listAvailabilityContexts('kinesiology', { limit: 20, offset: 40 }, cookies());
	assert.deepEqual(plain(result), { items: [contextDto()], limit: 20, offset: 40 });
	assert.equal(route(net.calls[0]), 'GET /reception/availability/contexts?career=kinesiology&limit=20&offset=40');
	assert.equal(net.calls[0].body, undefined);
});

test('contexts reject items from another career, extra or missing keys and malformed values', async () => {
	const bad = [
		contextDto({ career: 'odontology' }),
		{ ...contextDto(), patient_id: ids.patient },
		withoutKey(contextDto(), 'subject_name'),
		contextDto({ academic_group_id: 'bad' }),
		contextDto({ academic_group_name: '' }),
	];
	for (const item of bad) {
		const net = backend(({ search }) => ({ body: envelope([item], search) }));
		const api = await compile(apiModule, net.fetch);
		await assert.rejects(api.listAvailabilityContexts('kinesiology', page, cookies()), /inválid/);
	}
});

test('history GET requires career and patient_id and returns activity items without identity', async () => {
	const net = backend(({ search }) => ({ body: envelope([activityDto(), activityDto({ id: ids.otherActivity, withdrawn_at: WITHDRAWN_AT })], search) }));
	const api = await compile(apiModule, net.fetch);
	const result = await api.listAvailabilityHistory('odontology', ids.patient, { limit: 20, offset: 40 }, cookies());
	assert.equal(result.items.length, 2);
	assert.equal(result.items[1].withdrawn_at, WITHDRAWN_AT);
	assert.equal(route(net.calls[0]), `GET /reception/availability/history?career=odontology&patient_id=${ids.patient}&limit=20&offset=40`);
	assert.equal(net.calls[0].body, undefined);
});

test('history rejects activity with extra identity keys, bad ISO timestamps or a missing withdrawn_at', async () => {
	const bad = [
		activityDto({ patient_id: ids.patient }),
		activityDto({ actor: ids.otherPatient }),
		activityDto({ career: 'kinesiology' }),
		activityDto({ enabled_at: '09/11/2026 10:00' }),
		activityDto({ enabled_at: '2026-13-01T10:00:00Z' }),
		activityDto({ withdrawn_at: 'yesterday' }),
		activityDto({ withdrawn_at: '2026-11-09' }),
		withoutKey(activityDto(), 'withdrawn_at'),
		activityDto({ id: 'not-a-uuid' }),
		activityDto({ subject_name: 'Anatomía' }),
	];
	for (const item of bad) {
		const net = backend(({ search }) => ({ body: envelope([item], search) }));
		const api = await compile(apiModule, net.fetch);
		await assert.rejects(api.listAvailabilityHistory('kinesiology', ids.patient, page, cookies()), /inválid/, JSON.stringify(item));
	}
});

test('enable POST sends exactly career, patient, subject and group and accepts only an active echo', async () => {
	const net = backend(() => ({ status: 201, body: activityDto() }));
	const api = await compile(apiModule, net.fetch);
	const input = { career: 'kinesiology', patient_id: ids.patient, subject_id: ids.subject, academic_group_id: ids.group };
	assert.deepEqual(plain(await api.enableAvailability(input, cookies())), activityDto());
	assert.equal(route(net.calls[0]), 'POST /reception/availability');
	assert.deepEqual(net.calls[0].body, input);

	const bad = [
		activityDto({ withdrawn_at: WITHDRAWN_AT }),
		activityDto({ subject_id: ids.otherSubject }),
		activityDto({ academic_group_id: ids.otherGroup }),
		{ ...activityDto(), patient_id: ids.patient },
		activityDto({ enabled_at: 'bad' }),
		withoutKey(activityDto(), 'id'),
	];
	for (const body of bad) {
		const failing = backend(() => ({ status: 201, body }));
		const failingApi = await compile(apiModule, failing.fetch);
		await assert.rejects(failingApi.enableAvailability(input, cookies()), /inválid/, JSON.stringify(body));
	}
});

test('withdraw POST targets the activity id with a career body and requires withdrawn_at to be set', async () => {
	const net = backend(() => ({ body: activityDto({ withdrawn_at: WITHDRAWN_AT }) }));
	const api = await compile(apiModule, net.fetch);
	const result = await api.withdrawAvailability('kinesiology', ids.activity, cookies());
	assert.equal(result.withdrawn_at, WITHDRAWN_AT);
	assert.equal(route(net.calls[0]), `POST /reception/availability/${ids.activity}/withdraw`);
	assert.deepEqual(net.calls[0].body, { career: 'kinesiology' });

	const bad = [
		activityDto(),
		activityDto({ withdrawn_at: WITHDRAWN_AT, id: ids.otherActivity }),
		{ ...activityDto({ withdrawn_at: WITHDRAWN_AT }), patient_id: ids.patient },
	];
	for (const body of bad) {
		const failing = backend(() => ({ body }));
		const failingApi = await compile(apiModule, failing.fetch);
		await assert.rejects(failingApi.withdrawAvailability('kinesiology', ids.activity, cookies()), /inválid/, JSON.stringify(body));
	}
});

test('career, documento, UUID and pair inputs are validated before any request', async () => {
	const net = backend(() => ({ body: {} }));
	const api = await compile(apiModule, net.fetch);
	const c = cookies();
	const invalid = [
		() => api.searchAvailabilityPatients('kinesiology', '123', page, c),
		() => api.searchAvailabilityPatients('kinesiology', '123456789', page, c),
		() => api.searchAvailabilityPatients('kinesiology', '12a4', page, c),
		() => api.searchAvailabilityPatients('pediatrics', '12345678', page, c),
		() => api.listAvailabilityContexts('pediatrics', page, c),
		() => api.listAvailabilityHistory('kinesiology', 'not-a-uuid', page, c),
		() => api.listAvailabilityHistory('pediatrics', ids.patient, page, c),
		() => api.enableAvailability({ career: 'kinesiology', patient_id: 'x', subject_id: ids.subject, academic_group_id: ids.group }, c),
		() => api.enableAvailability({ career: 'kinesiology', patient_id: ids.patient, subject_id: ids.subject, academic_group_id: 'x' }, c),
		() => api.enableAvailability({ career: 'pediatrics', patient_id: ids.patient, subject_id: ids.subject, academic_group_id: ids.group }, c),
		() => api.withdrawAvailability('kinesiology', 'nope', c),
		() => api.withdrawAvailability('pediatrics', ids.activity, c),
	];
	for (const call of invalid) await assert.rejects(call(), /inválid/);
	assert.equal(net.calls.length, 0);
});

test('pagination bounds are enforced before any request and the edges are accepted', async () => {
	const net = backend(({ search }) => ({ body: envelope([], search) }));
	const api = await compile(apiModule, net.fetch);
	const c = cookies();
	const invalid = [
		{ limit: 0, offset: 0 },
		{ limit: 101, offset: 0 },
		{ limit: 50, offset: -1 },
		{ limit: 50, offset: 10001 },
		{ limit: 1.5, offset: 0 },
		{ limit: 50, offset: '0' },
		{ limit: Number.NaN, offset: 0 },
	];
	for (const pagination of invalid) {
		await assert.rejects(api.listAvailabilityContexts('kinesiology', pagination, c), /inválid/, JSON.stringify(pagination));
		await assert.rejects(api.listAvailabilityHistory('kinesiology', ids.patient, pagination, c), /inválid/, JSON.stringify(pagination));
		await assert.rejects(api.searchAvailabilityPatients('kinesiology', '12345678', pagination, c), /inválid/, JSON.stringify(pagination));
	}
	assert.equal(net.calls.length, 0);

	await api.listAvailabilityContexts('kinesiology', { limit: 1, offset: 0 }, c);
	await api.listAvailabilityContexts('kinesiology', { limit: 100, offset: 10000 }, c);
	assert.deepEqual(net.calls.map(route), [
		'GET /reception/availability/contexts?career=kinesiology&limit=1&offset=0',
		'GET /reception/availability/contexts?career=kinesiology&limit=100&offset=10000',
	]);
});

test('search handler rejects invalid documento, career or pagination without any request', async () => {
	let calls = 0;
	const api = await compile(actionsModule, async () => { calls++; return Response.json({}); });
	const base = { career: 'kinesiology', documento: '12345678', limit: '50', offset: '0' };
	for (const documento of ['', '123', '123456789', '12a4', '12 34', '1.234']) {
		assert.equal((await api.handleSearchReceptionAvailabilityPatient({ ...base, documento }, { cookies: cookies() })).success, false, documento);
	}
	for (const career of ['pediatrics', '', undefined, 'Kinesiology']) {
		assert.equal((await api.handleSearchReceptionAvailabilityPatient({ ...base, career }, { cookies: cookies() })).success, false, String(career));
	}
	for (const pagination of [{ limit: '0' }, { limit: '101' }, { offset: '10001' }, { offset: '-1' }, { limit: 'abc' }, { limit: '1.5' }]) {
		assert.equal((await api.handleSearchReceptionAvailabilityPatient({ ...base, ...pagination }, { cookies: cookies() })).success, false, JSON.stringify(pagination));
	}
	assert.equal(calls, 0);
});

test('search handler returns the page with computed navigation and no totals', async () => {
	const net = backend(({ search }) => ({ body: envelope([searchDto(), searchDto({ patient_id: ids.otherPatient })], search) }));
	const api = await compile(actionsModule, net.fetch);
	const result = await api.handleSearchReceptionAvailabilityPatient({ career: 'kinesiology', documento: '12345678', limit: '2', offset: '2' }, { cookies: cookies() });
	assert.equal(result.success, true);
	assert.equal(result.career, 'kinesiology');
	assert.deepEqual(plain(result.patients), [searchDto(), searchDto({ patient_id: ids.otherPatient })]);
	assert.deepEqual(plain(result.navigation), { previousOffset: 0, nextOffset: 4 });
	assert.equal(route(net.calls[0]), 'GET /reception/availability/search?career=kinesiology&documento=12345678&limit=2&offset=2');
	assert.equal(result.total, undefined);
});

test('enable and withdraw handlers reject invalid career, patient, pair and confirmation before any request', async () => {
	let calls = 0;
	const api = await compile(actionsModule, async (url, init = {}) => {
		calls++;
		const withdraw = init.method === 'POST' && url.endsWith('/withdraw');
		return Response.json(withdraw ? activityDto({ withdrawn_at: WITHDRAWN_AT }) : activityDto(), { status: withdraw ? 200 : 201 });
	});
	const c = cookies();
	const pair = `${ids.subject}:${ids.group}`;
	const enableBase = { career: 'kinesiology', patient_id: ids.patient, context_pair: pair };
	const enableInvalid = [
		{ career: 'pediatrics' }, { career: undefined },
		{ patient_id: 'not-a-uuid' }, { patient_id: '' },
		{ context_pair: '' }, { context_pair: 'abc' }, { context_pair: ids.subject }, { context_pair: `${ids.subject}|${ids.group}` },
		{ context_pair: `${ids.subject}:${ids.group}:${ids.otherGroup}` }, { context_pair: `${ids.subject}:bad` },
	];
	for (const patch of enableInvalid) {
		assert.equal((await api.handleEnableReceptionAvailability({ ...enableBase, ...patch }, { cookies: c })).success, false, JSON.stringify(patch));
	}
	assert.equal(calls, 0);
	assert.equal((await api.handleEnableReceptionAvailability(enableBase, { cookies: c })).success, true);
	assert.equal(calls, 1);

	const withdrawBase = { career: 'kinesiology', id: ids.activity, patient_id: ids.patient, confirm: 'yes' };
	const withdrawInvalid = [
		{ career: 'pediatrics' }, { id: 'not-a-uuid' }, { id: '' },
		{ confirm: undefined }, { confirm: '' }, { confirm: 'no' }, { confirm: 'true' }, { confirm: 'on' }, { confirm: 'YES' },
	];
	for (const patch of withdrawInvalid) {
		assert.equal((await api.handleWithdrawReceptionAvailability({ ...withdrawBase, ...patch }, { cookies: c })).success, false, JSON.stringify(patch));
	}
	assert.equal(calls, 1, 'no withdraw request was sent for invalid or unconfirmed input');
	assert.equal((await api.handleWithdrawReceptionAvailability(withdrawBase, { cookies: c })).success, true);
	assert.equal(calls, 2);
});

test('enable and withdraw actions post the expected bodies only after validation', async () => {
	const net = backend(({ method, path }) => (method === 'POST' && path === '/reception/availability'
		? { status: 201, body: activityDto() }
		: { body: activityDto({ withdrawn_at: WITHDRAWN_AT }) }));
	const api = await compile(actionsModule, net.fetch);
	const enabled = await api.handleEnableReceptionAvailability({ career: 'odontology', patient_id: ids.patient, context_pair: `${ids.subject}:${ids.group}` }, { cookies: cookies() });
	assert.equal(enabled.success, true);
	assert.equal(enabled.career, 'odontology');
	assert.deepEqual(net.calls[0].body, { career: 'odontology', patient_id: ids.patient, subject_id: ids.subject, academic_group_id: ids.group });

	const withdrawn = await api.handleWithdrawReceptionAvailability({ career: 'odontology', id: ids.activity, patient_id: ids.patient, confirm: 'yes' }, { cookies: cookies() });
	assert.equal(withdrawn.success, true);
	assert.equal(route(net.calls[1]), `POST /reception/availability/${ids.activity}/withdraw`);
	assert.deepEqual(net.calls[1].body, { career: 'odontology' });
	assert.ok(net.calls.every((call) => !/^\/(patient-availabilities|patients)/.test(call.path)), 'no global endpoints');
});

test('scoped errors map to neutral Spanish copy without backend messages and clear the session only on 401', async () => {
	const expectations = {
		400: /Revisá los datos/,
		401: /Tu sesión venció/,
		403: /no tiene permiso/,
		404: /carrera seleccionada/,
		409: /disponibilidad activa/,
		500: /No se pudo habilitar/,
	};
	for (const [status, copy] of Object.entries(expectations)) {
		const c = cookies();
		const code = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 500: 'INTERNAL_SERVER_ERROR' }[status];
		const net = backend(() => ({ status: Number(status), body: { error: { code, message: 'private backend detail for another career: active career scope was not found' } } }));
		const api = await compile(actionsModule, net.fetch);
		const result = await api.handleEnableReceptionAvailability({ career: 'kinesiology', patient_id: ids.patient, context_pair: `${ids.subject}:${ids.group}` }, { cookies: c });
		assert.equal(result.success, false, `status ${status}`);
		assert.match(result.error, copy, `status ${status}`);
		assert.doesNotMatch(result.error, /private|backend|scope|another career|otra carrera|other career/i, `status ${status}`);
		assert.equal(!!result.unauthorized, status === '401', `status ${status}`);
		assert.equal(!!c.deleted, status === '401', `only 401 clears the session (status ${status})`);
	}
});

test('withdraw 404 and 409 map to neutral copy and never show the backend message', async () => {
	for (const status of [404, 409]) {
		const net = backend(() => ({ status, body: { error: { code: 'NOT_FOUND', message: 'activity belongs to another career' } } }));
		const api = await compile(actionsModule, net.fetch);
		const result = await api.handleWithdrawReceptionAvailability({ career: 'kinesiology', id: ids.activity, confirm: 'yes' }, { cookies: cookies() });
		assert.equal(result.success, false);
		assert.doesNotMatch(result.error, /another career|activity belongs/);
		assert.match(result.error, /carrera|historial/);
	}
});

test('network failures surface a generic message without the underlying error text', async () => {
	const api = await compile(actionsModule, async () => { throw new Error('socket hang up with secret'); });
	const result = await api.handleSearchReceptionAvailabilityPatient({ career: 'kinesiology', documento: '12345678', limit: '50', offset: '0' }, { cookies: cookies() });
	assert.equal(result.success, false);
	assert.doesNotMatch(result.error, /secret|socket/);
});

test('no-careers state makes no scoped availability calls', async () => {
	const net = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: [] } } : { body: { items: [] } }));
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionAvailabilityState(new URLSearchParams('career=kinesiology'), cookies());
	assert.equal(state.kind, 'no-careers');
	assert.equal(net.scopedCalls().length, 0);
	assert.deepEqual(net.calls.map(route), ['GET /reception/careers']);
});

test('ungranted, unknown or repeated career selects nothing and makes no scoped calls', async () => {
	for (const search of ['career=odontology', 'career=pediatrics', 'career=kinesiology&career=kinesiology', '']) {
		const net = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { body: envelope([contextDto()], '?limit=50&offset=0') }));
		const api = await compile(stateModule, net.fetch);
		const state = await api.loadReceptionAvailabilityState(new URLSearchParams(search), cookies());
		assert.equal(state.kind, 'select', search);
		assert.deepEqual(plain(state.careers), ['kinesiology']);
		assert.equal(net.scopedCalls().length, 0, search);
	}
});

test('ready state loads contexts then the selected patient history, with no global endpoints', async () => {
	const net = backend(({ path, search }) => {
		if (path === '/reception/careers') return { body: { careers: ['kinesiology', 'odontology'] } };
		if (path === '/reception/availability/contexts') return { body: envelope([contextDto()], search) };
		return { body: envelope([activityDto()], search) };
	});
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionAvailabilityState(new URLSearchParams(`career=kinesiology&patient_id=${ids.patient}`), cookies());
	assert.equal(state.kind, 'ready');
	assert.equal(state.career, 'kinesiology');
	assert.equal(state.patientId, ids.patient);
	assert.equal(state.contexts.length, 1);
	assert.equal(state.history.length, 1);
	assert.deepEqual(net.calls.map(route), [
		'GET /reception/careers',
		'GET /reception/availability/contexts?career=kinesiology&limit=50&offset=0',
		`GET /reception/availability/history?career=kinesiology&patient_id=${ids.patient}&limit=50&offset=0`,
	]);
	assert.ok(net.calls.every((call) => !/^\/(patients|patient-availabilities)/.test(call.path)), 'no global endpoints');
});

test('careers are read fresh on every render and a revoked career selects nothing on the next render', async () => {
	const responses = [{ careers: ['kinesiology', 'odontology'] }, { careers: ['kinesiology'] }];
	const net = backend(({ path, search }) => (path === '/reception/careers' ? { body: responses.shift() } : { body: envelope([contextDto({ career: 'odontology' })], search) }));
	const api = await compile(stateModule, net.fetch);
	const params = new URLSearchParams('career=odontology');
	const first = await api.loadReceptionAvailabilityState(params, cookies());
	const second = await api.loadReceptionAvailabilityState(params, cookies());
	assert.equal(first.kind, 'ready');
	assert.equal(second.kind, 'select');
	assert.equal(net.calls.filter((call) => call.path === '/reception/careers').length, 2);
});

test('invalid patient_id is reported without a history request while contexts still load', async () => {
	for (const search of ['patient_id=not-a-uuid', `patient_id=${ids.patient}&patient_id=${ids.otherPatient}`]) {
		const net = backend(({ path, search: query }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { body: envelope([], query) }));
		const api = await compile(stateModule, net.fetch);
		const state = await api.loadReceptionAvailabilityState(new URLSearchParams(`career=kinesiology&${search}`), cookies());
		assert.equal(state.kind, 'ready', search);
		assert.equal(state.patientId, null, search);
		assert.ok(state.patientError, search);
		assert.ok(!net.calls.some((call) => call.path === '/reception/availability/history'), search);
	}
});

test('invalid pagination query falls back to the defaults and never sends the invalid value', async () => {
	const net = backend(({ path, search }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { body: envelope([], search) }));
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionAvailabilityState(new URLSearchParams(`career=kinesiology&patient_id=${ids.patient}&contexts_limit=0&history_offset=10001`), cookies());
	assert.equal(state.kind, 'ready');
	assert.ok(state.queryError);
	assert.deepEqual(net.calls.map(route).slice(1), [
		'GET /reception/availability/contexts?career=kinesiology&limit=50&offset=0',
		`GET /reception/availability/history?career=kinesiology&patient_id=${ids.patient}&limit=50&offset=0`,
	]);
});

test('section pagination uses explicit bounds and computes navigation without totals', async () => {
	const contexts = Array.from({ length: 100 }, (_, index) => contextDto({ subject_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
	const net = backend(({ path, search }) => {
		if (path === '/reception/careers') return { body: { careers: ['kinesiology'] } };
		if (path === '/reception/availability/contexts') return { body: envelope(contexts, search) };
		return { body: envelope([activityDto()], search) };
	});
	const api = await compile(stateModule, net.fetch);
	const state = await api.loadReceptionAvailabilityState(new URLSearchParams(`career=kinesiology&patient_id=${ids.patient}&contexts_limit=100&contexts_offset=9900&history_limit=20&history_offset=0`), cookies());
	assert.equal(state.kind, 'ready');
	assert.deepEqual(plain(state.contextsNavigation), { previousOffset: 9800, nextOffset: 10000 });
	assert.deepEqual(plain(state.historyNavigation), { previousOffset: null, nextOffset: null });
	assert.equal(state.contextsPage.limit, 100);
	assert.equal(state.historyPage.limit, 20);
});

test('history 404 is neutral and a contexts 404 is treated as a revoked career scope', async () => {
	const historyMissing = backend(({ path, search }) => {
		if (path === '/reception/careers') return { body: { careers: ['kinesiology'] } };
		if (path === '/reception/availability/contexts') return { body: envelope([], search) };
		return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'patient is not enrolled in this career' } } };
	});
	const api = await compile(stateModule, historyMissing.fetch);
	const ready = await api.loadReceptionAvailabilityState(new URLSearchParams(`career=kinesiology&patient_id=${ids.patient}`), cookies());
	assert.equal(ready.kind, 'ready');
	assert.match(ready.historyError, /paciente/);
	assert.doesNotMatch(ready.historyError, /enrolled|another career/);

	const contextsGone = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'active career scope was not found' } } }));
	const gone = await compile(stateModule, contextsGone.fetch);
	const revoked = await gone.loadReceptionAvailabilityState(new URLSearchParams('career=kinesiology'), cookies());
	assert.equal(revoked.kind, 'career-unavailable');
	assert.doesNotMatch(revoked.message, /active career scope/);
});

test('401 from any scoped call sends the user back to login and other failures stay generic', async () => {
	const expired = backend(({ path }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'token expired' } } }));
	const expiredApi = await compile(stateModule, expired.fetch);
	assert.equal((await expiredApi.loadReceptionAvailabilityState(new URLSearchParams('career=kinesiology'), cookies())).kind, 'session-expired');

	const failing = backend(({ path, search }) => (path === '/reception/careers' ? { body: { careers: ['kinesiology'] } } : path === '/reception/availability/contexts' ? { body: envelope([], search) } : { status: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'stack trace' } } }));
	const failingApi = await compile(stateModule, failing.fetch);
	const state = await failingApi.loadReceptionAvailabilityState(new URLSearchParams(`career=kinesiology&patient_id=${ids.patient}`), cookies());
	assert.equal(state.kind, 'ready');
	assert.doesNotMatch(state.historyError, /stack trace/);
	assert.match(state.historyError, /historial/);
});

test('activity labels come from the contexts page and fall back to neutral copy', async () => {
	const api = await compile(stateModule);
	const contexts = [contextDto()];
	assert.deepEqual(plain(api.activityLabels(activityDto(), contexts)), { subject: 'Anatomía', group: 'Grupo A' });
	const unknown = api.activityLabels(activityDto({ subject_id: ids.otherSubject, academic_group_id: ids.otherGroup }), contexts);
	assert.deepEqual(plain(unknown), { subject: 'Asignatura (nombre no disponible)', group: 'Grupo (nombre no disponible)' });
});

test('result from another career is ignored by the page', async () => {
	const api = await compile(stateModule);
	const own = { success: true, career: 'kinesiology', patientId: ids.patient };
	assert.equal(api.resultForCareer(own, 'kinesiology'), own);
	assert.equal(api.resultForCareer({ success: true, career: 'odontology', patientId: ids.patient }, 'kinesiology'), undefined);
	assert.equal(api.resultForCareer(undefined, 'kinesiology'), undefined);
});

test('page access: no session goes to login, non-reception role goes home, reception role renders', async () => {
	const api = await compile(stateModule);
	assert.equal(api.resolveReceptionAvailabilityAccess(null), 'login');
	assert.equal(api.resolveReceptionAvailabilityAccess('not-a-jwt'), 'home');
	assert.equal(api.resolveReceptionAvailabilityAccess(jwt({ role: 'admin' })), 'home');
	assert.equal(api.resolveReceptionAvailabilityAccess(jwt({ role: 'Reception' })), 'home');
	assert.equal(api.resolveReceptionAvailabilityAccess(jwt({ role: 'reception' })), 'ok');
});

test('career helper stays the shared T2 contract', async () => {
	const careers = await compile(careersModule);
	assert.deepEqual([...careers.RECEPTION_CAREERS], ['kinesiology', 'odontology']);
});
