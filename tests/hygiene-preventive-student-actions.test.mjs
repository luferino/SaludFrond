import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Student actions for Hygiene and Preventive Dentistry II: content mapping (D3), result handling (D4) and
// create. Real pods run in one vm context; fetch and cookies are isolated and every request is recorded.
const root = new URL('../', import.meta.url);
const draftsPath = 'src/pods/hygiene-preventive-draft/actions/drafts.ts';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const draftPath = `/hygiene-preventive-drafts/${largeId}`;
const assignmentPath = '/patient-assignments/mine';
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };

// Stored content as the server returns it: loaded indices carry their computed total.
const served = {
	medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', diabetes: false, observations: 'Línea 1\nLínea 2', treating_physician: '' },
	odontogram: { 16: { state: 'present', surfaces: { occlusal: ['caries'] } }, 18: { state: 'absent', surfaces: {} }, 36: { state: 'to_extract' } },
	indices: { ceo_d: { c: 1, e: 0, o: 2, total: 3 }, cpo_d: null },
};
// The same content as a client may send it: totals removed (D3 baseline).
const writable = {
	medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', diabetes: false, observations: 'Línea 1\nLínea 2', treating_physician: '' },
	odontogram: { 16: { state: 'present', surfaces: { occlusal: ['caries'] } }, 18: { state: 'absent', surfaces: {} }, 36: { state: 'to_extract' } },
	indices: { ceo_d: { c: 1, e: 0, o: 2 }, cpo_d: null },
};

const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: served, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const errorBody = (code, message) => ({ error: { code, message } });
const plain = (value) => JSON.parse(JSON.stringify(value));
const withTotals = (content) => ({
	...content,
	indices: Object.fromEntries(Object.entries(content.indices ?? {}).map(([name, index]) => [name, index ? { ...index, total: index.c + index.e + index.o } : index])),
});
const patchEcho = ({ body }) => ({ body: draft({ version: String(BigInt(body.expected_version) + 1n), content: withTotals(body.content) }) });
const readDraft = (content = served, version = '3') => ({ body: draft({ content, version }) });
const baseRoutes = (overrides = {}) => ({
	[`GET ${assignmentPath}`]: { body: { items: [assignment()], limit: 50, offset: 0 } },
	[`GET ${draftPath}`]: readDraft(),
	[`PATCH ${draftPath}`]: patchEcho,
	...overrides,
});

/** Real drafts module against an isolated fetch; every request is recorded with its JSON body. */
async function environment(routes = baseRoutes()) {
	const requests = [];
	const table = { ...routes };
	const cookies = { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} };
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, BigInt, atob, btoa, Set, Map,
		fetch: async (href, init = {}) => {
			const method = init.method ?? 'GET';
			const request = { method, url: href };
			if (init.body !== undefined) request.body = JSON.parse(init.body);
			requests.push(request);
			const key = `${method} ${new URL(href).pathname}`;
			const entry = table[key];
			const response = typeof entry === 'function' ? await entry({ url: new URL(href), body: request.body }) : entry;
			if (!response) throw new Error(`Unexpected request ${key}`);
			if (response.network) throw new TypeError('fetch failed');
			return Response.json(response.body ?? {}, { status: response.status ?? 200 });
		},
	});
	const modules = new Map();
	function load(href) {
		if (!modules.has(href)) {
			modules.set(href, (async () => {
				const code = await readFile(new URL(href), 'utf8');
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const mod = new vm.SourceTextModule(output, {
					context: sandbox, identifier: href,
					initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: apiBase }; },
				});
				await mod.link(async (specifier, parent) => {
					if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
					if (specifier === './session') {
						return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
							this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
							this.setExport('clearSession', () => undefined);
						}, { context: sandbox });
					}
					return load(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
				});
				return mod;
			})());
		}
		return modules.get(href);
	}
	const mod = await load(new URL(draftsPath, root).href);
	await mod.evaluate();
	return { requests, cookies, drafts: mod.namespace, api: await importApi() };
	async function importApi() {
		const href = new URL('src/pods/hygiene-preventive-draft/api.ts', root).href;
		const apiModule = await load(href);
		await apiModule.evaluate();
		return apiModule.namespace;
	}
}

/** The form a browser submits for a page showing `content`: every control rendered the way the editor renders it. */
function browserForm(env, content, overrides = {}) {
	const values = Object.fromEntries(env.drafts.HYGIENE_FORM_FIELDS.map((name) => [name, env.drafts.HYGIENE_MARK_FIELDS.includes(name) ? [] : '']));
	const medical = content.medical_history ?? {};
	for (const question of env.api.HYGIENE_MEDICAL_QUESTIONS) {
		const answer = medical[question];
		values[`medical_history.${question}`] = answer === true ? 'true' : answer === false ? 'false' : '';
		values[`medical_history.${question}_detail`] = typeof medical[`${question}_detail`] === 'string' ? medical[`${question}_detail`].replace(/\n/g, '\r\n') : '';
	}
	for (const field of env.api.HYGIENE_MEDICAL_TEXTS) values[`medical_history.${field}`] = typeof medical[field] === 'string' ? medical[field].replace(/\n/g, '\r\n') : '';
	for (const code of env.api.FDI_TEETH) {
		const tooth = content.odontogram?.[code];
		values[`odontogram.${code}.state`] = tooth?.state ?? '';
		for (const face of env.api.TOOTH_FACES) values[`odontogram.${code}.${face}`] = [...(tooth?.surfaces?.[face] ?? [])];
	}
	for (const [name, index] of Object.entries(env.api.HYGIENE_INDICES)) {
		const loaded = content.indices?.[name];
		for (const component of index.components) values[`indices.${name}.${component}`] = loaded ? String(loaded[component]) : '';
	}
	return { ...values, ...overrides };
}
function saveInput(env, content, overrides = {}) {
	return { id: largeId, expected_version: '3', assignment_id: '17', limit: '50', offset: '0', ...browserForm(env, content), ...overrides };
}
const patches = (requests) => requests.filter((request) => request.method === 'PATCH');
const posts = (requests) => requests.filter((request) => request.method === 'POST');
const sentContent = (requests) => patches(requests)[0].body.content;
const DIABETES = 'medical_history.diabetes';

// D3: content mapping from the submitted controls to the replacement content.

test('D3 answered medical questions are sent as true or false, and an empty answer over a stored true becomes null', async () => {
	const env = await environment();
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, {
		'medical_history.taking_medication': 'false', [DIABETES]: 'true',
	}), { cookies: env.cookies });
	assert.equal(result.success, true);
	assert.equal(sentContent(env.requests).medical_history.taking_medication, false);
	assert.equal(sentContent(env.requests).medical_history.diabetes, true);
	const cleared = await environment();
	await cleared.drafts.handleUpdateHygieneDraft(saveInput(cleared, served, { 'medical_history.taking_medication': '' }), { cookies: cleared.cookies });
	assert.equal(sentContent(cleared.requests).medical_history.taking_medication, null);
});

test('D3 an empty medical control keeps an absent answer absent and a stored null as null', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ medical_history: { diabetes: null } }) }));
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, { medical_history: { diabetes: null } }), { cookies: env.cookies });
	const content = sentContent(env.requests);
	assert.deepEqual(content.medical_history, { diabetes: null });
	assert.equal(Object.hasOwn(content.medical_history, 'pregnant'), false);
});

test('D3 a text answer is sent exactly as typed, and line endings from the browser keep the stored text', async () => {
	const env = await environment();
	const typed = '  Alergia leve  ';
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'medical_history.treating_physician': typed }), { cookies: env.cookies });
	assert.equal(sentContent(env.requests).medical_history.treating_physician, typed);
	assert.equal(sentContent(env.requests).medical_history.observations, 'Línea 1\nLínea 2');
});

test('D3 an empty text keeps a stored empty string and clears a stored text to null', async () => {
	const env = await environment();
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'medical_history.observations': '' }), { cookies: env.cookies });
	assert.equal(sentContent(env.requests).medical_history.observations, null);
	assert.equal(sentContent(env.requests).medical_history.treating_physician, '');
});

test('D3 a medical section absent in storage with every control empty stays absent, and a stored {} stays {}', async () => {
	const absent = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ odontogram: {} }) }));
	await absent.drafts.handleUpdateHygieneDraft(saveInput(absent, { odontogram: {} }), { cookies: absent.cookies });
	assert.equal(Object.hasOwn(sentContent(absent.requests), 'medical_history'), false);
	const empty = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ medical_history: {} }) }));
	await empty.drafts.handleUpdateHygieneDraft(saveInput(empty, { medical_history: {} }), { cookies: empty.cookies });
	assert.deepEqual(sentContent(empty.requests).medical_history, {});
});

test('D3 an unchanged read draft round-trips to its stored content without any index total', async () => {
	const env = await environment();
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests), writable);
	assert.equal(JSON.stringify(sentContent(env.requests)).includes('"total"'), false);
});

test('D3 a tooth with an empty state and no marks is omitted, so an unrecorded tooth is never sent as present', async () => {
	const env = await environment();
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'odontogram.16.state': '', 'odontogram.16.occlusal': [] }), { cookies: env.cookies });
	assert.equal(Object.hasOwn(sentContent(env.requests).odontogram, '16'), false);
	assert.equal(sentContent(env.requests).odontogram['36'].state, 'to_extract');
});

test('D3 marked faces are sent in caries, filled order and only the marked faces appear in surfaces', async () => {
	const env = await environment();
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, {
		'odontogram.11.state': 'present', 'odontogram.11.mesial': ['filled', 'caries'], 'odontogram.11.distal': ['filled'],
	}), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests).odontogram['11'], { state: 'present', surfaces: { mesial: ['caries', 'filled'], distal: ['filled'] } });
});

test('D3 a stored empty surfaces object is kept only when nothing is marked, and a tooth without it stays without it', async () => {
	const env = await environment();
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests).odontogram['18'], { state: 'absent', surfaces: {} });
	assert.deepEqual(sentContent(env.requests).odontogram['36'], { state: 'to_extract' });
});

test('D3 an absent tooth with marked faces is a validation error: nothing is sent and the submitted values are kept', async () => {
	const env = await environment();
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, {
		'odontogram.16.state': 'absent', 'odontogram.16.occlusal': ['caries'],
	}), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.equal(result.uncertain, false);
	assert.equal(result.conflict, false);
	assert.match(result.error, /La pieza 16 está ausente y no puede tener caras marcadas/);
	assert.deepEqual(plain(result.values['odontogram.16.occlusal']), ['caries']);
	assert.equal(result.expected_version, '3');
	assert.deepEqual(patches(env.requests), []);
});

test('D3 marked faces on a tooth without a state are a validation error, never silently dropped', async () => {
	const env = await environment();
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'odontogram.12.state': '', 'odontogram.12.lingual': ['filled'] }), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.match(result.error, /La pieza 12 tiene caras marcadas y no tiene estado/);
	assert.deepEqual(patches(env.requests), []);
});

test('D3 an absent tooth without marks is recorded as absent without surfaces', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ medical_history: { diabetes: false } }) }));
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, { medical_history: { diabetes: false } }, { 'odontogram.18.state': 'absent' }), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests).odontogram, { '18': { state: 'absent' } });
});

test('D3 an odontogram section absent in storage with no tooth recorded stays absent', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ medical_history: { diabetes: false } }) }));
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, { medical_history: { diabetes: false } }), { cookies: env.cookies });
	assert.equal(Object.hasOwn(sentContent(env.requests), 'odontogram'), false);
});

test('D3 a stored empty odontogram stays {} when no tooth is recorded', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ odontogram: {} }) }));
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, { odontogram: {} }), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests).odontogram, {});
});

test('D3 an index with all three components empty keeps an absent or null index and clears a loaded one to null', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft({ indices: { cpo_d: null } }) }));
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, { indices: { cpo_d: null } }), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests).indices, { cpo_d: null });
	const loaded = await environment();
	await loaded.drafts.handleUpdateHygieneDraft(saveInput(loaded, served, {
		'indices.ceo_d.c': '', 'indices.ceo_d.e': '', 'indices.ceo_d.o': '',
	}), { cookies: loaded.cookies });
	assert.equal(sentContent(loaded.requests).indices.ceo_d, null);
});

test('D3 an index with some components empty is a validation error that names the index', async () => {
	const env = await environment();
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'indices.cpo_d.c': '2', 'indices.cpo_d.p': '', 'indices.cpo_d.o': '1' }), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.equal(result.error, 'Completá los tres valores del índice CPO-D (dentición permanente) o dejalos vacíos.');
	assert.deepEqual(patches(env.requests), []);
});

test('D3 index components must be whole non-negative numbers, zero is valid', async () => {
	for (const bad of ['-1', '1.5', 'dos', ' 2']) {
		const env = await environment();
		const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'indices.cpo_d.c': bad, 'indices.cpo_d.p': '0', 'indices.cpo_d.o': '0' }), { cookies: env.cookies });
		assert.equal(result.success, false, bad);
		assert.match(result.error, /debe ser un número entero mayor o igual a 0/, bad);
		assert.deepEqual(patches(env.requests), [], bad);
	}
	const zero = await environment();
	await zero.drafts.handleUpdateHygieneDraft(saveInput(zero, served, { 'indices.cpo_d.c': '0', 'indices.cpo_d.p': '0', 'indices.cpo_d.o': '0' }), { cookies: zero.cookies });
	assert.deepEqual(sentContent(zero.requests).indices.cpo_d, { c: 0, p: 0, o: 0 });
});

test('D3 an index whose components exceed its limit is rejected before any write', async () => {
	const env = await environment();
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'indices.ceo_d.c': '10', 'indices.ceo_d.e': '10', 'indices.ceo_d.o': '1' }), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.equal(result.error, 'El índice ceo_d no puede sumar más de 20.');
	assert.deepEqual(patches(env.requests), []);
});

test('D3 a PATCH built from a read draft never carries a total, even when the stored index has one', async () => {
	const env = await environment();
	await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'indices.ceo_d.c': '4', 'indices.ceo_d.e': '1', 'indices.ceo_d.o': '0' }), { cookies: env.cookies });
	assert.deepEqual(sentContent(env.requests).indices.ceo_d, { c: 4, e: 1, o: 0 });
	assert.equal(JSON.stringify(patches(env.requests)[0].body).includes('total'), false);
});

// D4: one write per submission and the result handling of each outcome.

test('D4 a successful save sends exactly one PATCH with expected_version and the replacement content, and no POST', async () => {
	const env = await environment();
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { 'medical_history.diabetes': 'true' }), { cookies: env.cookies });
	assert.equal(result.success, true);
	assert.equal(result.id, largeId);
	assert.equal(result.assignment_id, '17');
	assert.equal(result.draft.version, '4');
	assert.equal(patches(env.requests).length, 1);
	assert.equal(patches(env.requests)[0].body.expected_version, '3');
	assert.equal(posts(env.requests).length, 0);
});

test('D4 a stale version is a conflict found before any PATCH, and the submitted values are kept', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(served, '5') }));
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { [DIABETES]: 'true' }), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.equal(result.conflict, true);
	assert.equal(result.expected_version, '3');
	assert.equal(result.values[DIABETES], 'true');
	assert.deepEqual(patches(env.requests), []);
});

test('D4 a 409 from the server is a conflict with one PATCH and the submitted values kept', async () => {
	const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: { status: 409, body: errorBody('CONFLICT', 'draft version changed; reload before saving') } }));
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { [DIABETES]: 'true' }), { cookies: env.cookies });
	assert.equal(result.conflict, true);
	assert.match(result.error, /Otra pestaña o persona guardó una versión más nueva/);
	assert.equal(result.values[DIABETES], 'true');
	assert.equal(patches(env.requests).length, 1);
});

test('D4 a typed rejection keeps the submitted values with the same expected_version and is never retried', async () => {
	for (const status of [400, 403, 404]) {
		const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: { status, body: errorBody('ERR', 'rejected') } }));
		const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { [DIABETES]: 'true' }), { cookies: env.cookies });
		assert.equal(result.success, false, String(status));
		assert.equal(result.uncertain, false, String(status));
		assert.equal(result.conflict, false, String(status));
		assert.equal(result.expected_version, '3', String(status));
		assert.equal(result.values[DIABETES], 'true', String(status));
		assert.equal(patches(env.requests).length, 1, String(status));
	}
});

test('D4 a server or network failure is uncertain, keeps the values and is never retried', async () => {
	for (const failure of [{ status: 500, body: errorBody('INTERNAL', 'boom') }, { network: true }]) {
		const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: failure }));
		const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served, { [DIABETES]: 'true' }), { cookies: env.cookies });
		assert.equal(result.success, false);
		assert.equal(result.uncertain, true);
		assert.match(result.error, /No se pudo confirmar el guardado/);
		assert.equal(result.values[DIABETES], 'true');
		assert.equal(patches(env.requests).length, 1);
	}
});

test('D4 an expired session is reported as a session error with one PATCH and no retry', async () => {
	const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: { status: 401, body: errorBody('UNAUTHORIZED', 'expired') } }));
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.match(result.error, /sesión venció/);
	assert.equal(patches(env.requests).length, 1);
});

test('D4 an assignment that is no longer active is refused before the draft is read or written', async () => {
	const env = await environment(baseRoutes({ [`GET ${assignmentPath}`]: { body: { items: [], limit: 50, offset: 0 } } }));
	const result = await env.drafts.handleUpdateHygieneDraft(saveInput(env, served), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.deepEqual(env.requests.map((request) => request.method), ['GET']);
});

// Create: exactly one POST per deliberate creation.

const createInput = (overrides = {}) => ({
	patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, assignment_id: '17', limit: '50', offset: '0', ...overrides,
});

test('create sends exactly one POST with the assignment context and empty content, and returns the editor coordinates', async () => {
	const env = await environment(baseRoutes({
		[`POST /hygiene-preventive-drafts`]: { status: 201, body: draft({ id: '28', version: '1', content: {} }) },
	}));
	const result = await env.drafts.handleCreateHygieneDraft(createInput(), { cookies: env.cookies });
	assert.equal(result.success, true);
	assert.equal(result.id, '28');
	assert.equal(result.assignment_id, '17');
	assert.deepEqual(posts(env.requests).map((request) => request.body), [{ ...context, content: {} }]);
	assert.equal(patches(env.requests).length, 0);
});

test('create refuses a context that does not match the active assignment before any POST', async () => {
	const env = await environment(baseRoutes({ [`POST /hygiene-preventive-drafts`]: { status: 201, body: draft() } }));
	const result = await env.drafts.handleCreateHygieneDraft(createInput({ subject_id: '22222222-3333-4444-8555-666666666666' }), { cookies: env.cookies });
	assert.equal(result.success, false);
	assert.equal(result.error, 'La asignación ya no coincide con este paciente y su contexto.');
	assert.deepEqual(posts(env.requests), []);
});

test('create maps a typed rejection to the patient copy and an untyped failure to the uncertain copy, with one POST each', async () => {
	const typed = await environment(baseRoutes({ [`POST /hygiene-preventive-drafts`]: { status: 404, body: errorBody('NOT_FOUND', 'patient was not found') } }));
	const rejected = await typed.drafts.handleCreateHygieneDraft(createInput(), { cookies: typed.cookies });
	assert.equal(rejected.uncertain, false);
	assert.equal(rejected.error, 'El paciente no está disponible en este contexto.');
	assert.equal(posts(typed.requests).length, 1);
	const offline = await environment(baseRoutes({ [`POST /hygiene-preventive-drafts`]: { network: true } }));
	const uncertain = await offline.drafts.handleCreateHygieneDraft(createInput(), { cookies: offline.cookies });
	assert.equal(uncertain.uncertain, true);
	assert.match(uncertain.error, /Revisá la lista de borradores antes de volver a intentarlo/);
	assert.equal(posts(offline.requests).length, 1);
});
