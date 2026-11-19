import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/hygiene-preventive-draft/api.ts';
const discoveryPath = 'src/pods/hygiene-preventive-draft/discovery.ts';
const odontogramPath = 'src/pods/hygiene-preventive-draft/odontogram.ts';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const careerId = '44444444-5555-4666-8777-888888888888';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-18T12:00:00.000Z';
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
/** Content as the student sends it: no index totals. */
const content = {
	medical_history: {
		taking_medication: true, taking_medication_detail: 'Enalapril 10 mg', allergy_penicillin: false,
		diabetes: null, treating_physician: '', observations: 'Sin novedades',
	},
	odontogram: {
		16: { state: 'present', surfaces: { occlusal: ['caries'], mesial: ['filled'] } },
		26: { state: 'present', surfaces: { occlusal: ['caries', 'filled'] } },
		18: { state: 'absent', surfaces: {} },
		36: { state: 'to_extract' },
		55: { state: 'present' },
	},
	indices: { ceo_d: null, cpo_d: { c: 2, p: 1, o: 1 }, cpo_first_molars: { c: 1, p: 0, o: 0 } },
};
/** The same content as the server returns it, with computed totals. */
const stored = {
	...content,
	indices: { ceo_d: null, cpo_d: { c: 2, p: 1, o: 1, total: 4 }, cpo_first_molars: { c: 1, p: 0, o: 0, total: 1 } },
};
const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: stored, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const link = (overrides = {}) => ({ subject_id: subjectId, career_id: careerId, created_by: authorId, created_at: iso, ...overrides });

/** Load a real pod module and apiClient against an isolated fetch; every request is recorded. */
async function harness(responses = [], path = apiPath) {
	const requests = [];
	const writes = [];
	const cookies = {
		get: (name) => name === 'session' ? { value: 'session-token' } : undefined,
		set: (...args) => writes.push(['set', ...args]), delete: (...args) => writes.push(['delete', ...args]),
	};
	const sandbox = vm.createContext({ URL, URLSearchParams, Response, Error, Date, BigInt, Set, fetch: async (url, init) => {
		requests.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
		const response = responses.shift();
		if (!response) throw new Error(`Unexpected request ${init.method} ${url}`);
		if (response.network) throw new TypeError('fetch failed');
		return Response.json(response.body, { status: response.status ?? 200 });
	} });
	const cache = new Map();
	async function compile(identifier) {
		if (cache.has(identifier)) return cache.get(identifier);
		const code = await readFile(new URL(identifier), 'utf8');
		const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
		const mod = new vm.SourceTextModule(output, { context: sandbox, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; } });
		cache.set(identifier, mod);
		await mod.link(async (specifier, parent) => {
			if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
			if (specifier === './session') return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
				this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
				this.setExport('clearSession', (jar) => jar.delete('session', { path: '/' }));
			}, { context: sandbox });
			return compile(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
		});
		return mod;
	}
	const mod = await compile(new URL(path, root).href);
	await mod.evaluate();
	return { api: mod.namespace, cookies, requests, writes };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const url = (path) => `https://backend.invalid${path}`;

test('content validation keeps tri-state answers, detail texts, empty text and absent keys exactly as given', async () => {
	const { api } = await harness();
	assert.deepEqual(plain(api.validateHygieneContent(content)), content);
	assert.deepEqual(plain(api.validateHygieneContent({})), {});
	assert.deepEqual(plain(api.validateHygieneContent({ medical_history: {}, odontogram: {}, indices: {} })), { medical_history: {}, odontogram: {}, indices: {} });
	const everyAnswer = Object.fromEntries(api.HYGIENE_MEDICAL_QUESTIONS.flatMap((name) => [[name, false], [`${name}_detail`, null]]));
	assert.equal(api.HYGIENE_MEDICAL_QUESTIONS.length, 14);
	assert.deepEqual(plain(api.validateHygieneContent({ medical_history: everyAnswer })), { medical_history: everyAnswer });
});

test('medical history rejects unknown sections and fields, non-boolean answers and invalid text', async () => {
	const { api } = await harness();
	assert.throws(() => api.validateHygieneContent([]), /objeto/);
	assert.throws(() => api.validateHygieneContent({ consent: {} }), /Sección clínica desconocida: consent/);
	assert.throws(() => api.validateHygieneContent({ medical_history: { marital_status: 'casado' } }), /Campo clínico desconocido: medical_history.marital_status/);
	assert.throws(() => api.validateHygieneContent({ medical_history: { diabetes: 'true' } }), /diabetes/);
	assert.throws(() => api.validateHygieneContent({ medical_history: { observations: 3 } }), /observations/);
	assert.throws(() => api.validateHygieneContent({ medical_history: { observations: 'a\u0000b' } }), /observations/);
	assert.throws(() => api.validateHygieneContent({ medical_history: { observations: '\uD800' } }), /observations/);
	assert.throws(() => api.validateHygieneContent({ medical_history: { observations: 'x'.repeat(4001) } }), /4000/);
	// 4000 code points is the limit, counted as code points, not UTF-16 units.
	assert.doesNotThrow(() => api.validateHygieneContent({ medical_history: { observations: '😀'.repeat(4000) } }));
});

test('odontogram accepts every FDI code with a state and rejects invalid codes, states and surfaces', async () => {
	const { api } = await harness();
	assert.equal(api.FDI_TEETH.length, 52);
	const every = Object.fromEntries(api.FDI_TEETH.map((code) => [code, { state: 'present' }]));
	assert.deepEqual(Object.keys(plain(api.validateHygieneContent({ odontogram: every })).odontogram).length, 52);
	for (const code of ['19', '10', '56', '86', '91', 'abc', '011']) {
		assert.throws(() => api.validateHygieneContent({ odontogram: { [code]: { state: 'present' } } }), /no es una pieza FDI válida/, code);
	}
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: {} } }), /estado/);
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: { state: null } } }), /estado/);
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: { state: 'healthy' } } }), /estado/);
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: 'present' } }), /pieza 11/);
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: { state: 'present', color: 'red' } } }), /odontogram.11.color/);
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: { state: 'present', surfaces: [] } } }), /caras/);
	assert.throws(() => api.validateHygieneContent({ odontogram: { 11: { state: 'present', surfaces: { palatal: ['caries'] } } } }), /odontogram.11.surfaces.palatal/);
	for (const marks of [[], ['caries', 'caries'], ['sealant'], 'caries']) {
		assert.throws(() => api.validateHygieneContent({ odontogram: { 11: { state: 'present', surfaces: { occlusal: marks } } } }), /cara/, JSON.stringify(marks));
	}
	assert.throws(() => api.validateHygieneContent({ odontogram: { 18: { state: 'absent', surfaces: { occlusal: ['filled'] } } } }), /ausente/);
	assert.doesNotThrow(() => api.validateHygieneContent({ odontogram: { 18: { state: 'absent', surfaces: {} } } }));
	assert.doesNotThrow(() => api.validateHygieneContent({ odontogram: { 36: { state: 'to_extract', surfaces: { distal: ['caries'] } } } }));
});

test('indices require all three non-negative integer components, enforce each limit and refuse a client total', async () => {
	const { api } = await harness();
	assert.doesNotThrow(() => api.validateHygieneContent({ indices: { ceo_d: { c: 20, e: 0, o: 0 }, cpo_d: { c: 30, p: 1, o: 1 }, cpo_first_molars: { c: 0, p: 0, o: 4 } } }));
	assert.throws(() => api.validateHygieneContent({ indices: { ceo_d: { c: 20, e: 1, o: 0 } } }), /20/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: { c: 32, p: 1, o: 0 } } }), /32/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_first_molars: { c: 4, p: 0, o: 1 } } }), /4/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: { c: 1, p: 1 } } }), /cpo_d/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: { c: -1, p: 0, o: 0 } } }), /cpo_d/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: { c: 1.5, p: 0, o: 0 } } }), /cpo_d/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: { c: '1', p: 0, o: 0 } } }), /cpo_d/);
	assert.throws(() => api.validateHygieneContent({ indices: { ceo_d: { c: 1, p: 0, o: 0 } } }), /ceo_d/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: 4 } }), /cpo_d/);
	assert.throws(() => api.validateHygieneContent({ indices: { plaque: null } }), /indices.plaque/);
	assert.throws(() => api.validateHygieneContent({ indices: { cpo_d: { c: 2, p: 1, o: 1, total: 4 } } }), /total/);
});

test('writable content strips every server total from a read draft and keeps the rest unchanged', async () => {
	const { api } = await harness();
	assert.deepEqual(plain(api.writableHygieneContent(stored)), content);
	assert.deepEqual(plain(api.writableHygieneContent({ odontogram: content.odontogram })), { odontogram: content.odontogram });
	assert.throws(() => api.writableHygieneContent({ indices: { cpo_d: { c: 2, p: 1, o: 1, total: 5 } } }), /total/);
});

test('draft responses must have the exact keys, valid stored content and totals that match their components', async () => {
	const { api } = await harness();
	assert.equal(api.isHygieneDraft(draft()), true);
	assert.equal(api.isHygieneDraft(draft({ content: content })), false, 'a loaded index without total is not server data');
	assert.equal(api.isHygieneDraft(draft({ content: { indices: { cpo_d: { c: 2, p: 1, o: 1, total: 3 } } } })), false);
	assert.equal(api.isHygieneDraft(draft({ consent: null })), false);
	assert.equal(api.isHygieneDraft(draft({ version: '0' })), false);
	assert.equal(api.isHygieneDraft(draft({ status: 'submitted' })), false);
});

test('list sends only context and paging, validates every item against the requested context', async () => {
	const ok = await harness([{ body: { items: [draft()] } }]);
	assert.deepEqual(plain(await ok.api.listHygieneDrafts(context, ok.cookies, { limit: 50, offset: 0 })), [draft()]);
	assert.deepEqual(ok.requests, [{ url: url(`/hygiene-preventive-drafts?patient_id=${patientId}&subject_id=${subjectId}&academic_group_id=${groupId}&limit=50&offset=0`), method: 'GET', body: undefined }]);
	const mismatch = await harness([{ body: { items: [draft({ origin_group_id: subjectId })] } }]);
	await assert.rejects(mismatch.api.listHygieneDrafts(context, mismatch.cookies, { limit: 50, offset: 0 }), /no coincide/);
	const extra = await harness([{ body: { items: [], total: 0 } }]);
	await assert.rejects(extra.api.listHygieneDrafts(context, extra.cookies, { limit: 50, offset: 0 }), /no es válida/);
	const none = await harness();
	await assert.rejects(none.api.listHygieneDrafts(context, none.cookies, { limit: 101, offset: 0 }), /paginación/);
	await assert.rejects(none.api.listHygieneDrafts({ ...context, patient_id: 'x' }, none.cookies, { limit: 50, offset: 0 }), /contexto/);
	assert.equal(none.requests.length, 0);
});

test('administrator list sends only paging and accepts drafts from any context', async () => {
	const { api, cookies, requests } = await harness([{ body: { items: [draft(), draft({ id: '5', origin_subject_id: careerId })] } }]);
	assert.equal((await api.listAllHygieneDrafts(cookies, { limit: 20, offset: 40 })).length, 2);
	assert.deepEqual(requests.map((request) => request.url), [url('/hygiene-preventive-drafts?limit=20&offset=40')]);
});

test('get reads one draft by id and refuses invalid ids before any request', async () => {
	const ok = await harness([{ body: draft() }]);
	assert.deepEqual(plain(await ok.api.getHygieneDraft(largeId, ok.cookies)), draft());
	assert.deepEqual(ok.requests.map((request) => request.url), [url(`/hygiene-preventive-drafts/${largeId}`)]);
	const other = await harness([{ body: draft({ id: '4' }) }]);
	await assert.rejects(other.api.getHygieneDraft(largeId, other.cookies), /no coincide/);
	const none = await harness();
	for (const id of ['0', '01', '9223372036854775808', '1.0']) await assert.rejects(none.api.getHygieneDraft(id, none.cookies), /identificador/);
	assert.equal(none.requests.length, 0);
	const missing = await harness([{ status: 404, body: { error: { code: 'NOT_FOUND', message: 'hygiene preventive draft was not found' } } }]);
	await assert.rejects(missing.api.getHygieneDraft('8', missing.cookies), (error) => error.status === 404 && error.message === 'hygiene preventive draft was not found');
});

test('create posts the context and validated content exactly once and refuses a client total before sending', async () => {
	const ok = await harness([{ status: 201, body: draft({ version: '1', content: {} }) }]);
	const created = await ok.api.createHygieneDraft({ ...context, content: {} }, ok.cookies);
	assert.equal(created.version, '1');
	assert.deepEqual(ok.requests, [{ url: url('/hygiene-preventive-drafts'), method: 'POST', body: { ...context, content: {} } }]);
	const none = await harness();
	await assert.rejects(none.api.createHygieneDraft({ ...context, content: stored }, none.cookies), /total/);
	assert.equal(none.requests.length, 0);
});

test('update patches expected_version and full content, requires a newer version and surfaces 409 without retrying', async () => {
	const ok = await harness([{ body: draft({ version: '4' }) }]);
	assert.equal((await ok.api.updateHygieneDraft(largeId, '3', content, context, ok.cookies)).version, '4');
	assert.deepEqual(ok.requests, [{ url: url(`/hygiene-preventive-drafts/${largeId}`), method: 'PATCH', body: { expected_version: '3', content } }]);
	const stale = await harness([{ body: draft({ version: '3' }) }]);
	await assert.rejects(stale.api.updateHygieneDraft(largeId, '3', content, context, stale.cookies), /no se pudo confirmar/i);
	const conflict = await harness([{ status: 409, body: { error: { code: 'CONFLICT', message: 'draft version changed; reload before saving' } } }]);
	await assert.rejects(conflict.api.updateHygieneDraft(largeId, '3', content, context, conflict.cookies), (error) => error.status === 409);
	assert.equal(conflict.requests.length, 1);
	const none = await harness();
	await assert.rejects(none.api.updateHygieneDraft(largeId, '3', stored, context, none.cookies), /total/);
	await assert.rejects(none.api.updateHygieneDraft(largeId, '0', content, context, none.cookies), /versión/);
	assert.equal(none.requests.length, 0);
});

test('subject links: administrator list and enable use the exact contract shapes', async () => {
	const list = await harness([{ body: { items: [link()] } }]);
	assert.deepEqual(plain(await list.api.listHygieneSubjects(list.cookies)), [link()]);
	assert.deepEqual(list.requests.map((request) => [request.method, request.url]), [['GET', url('/hygiene-preventive-subjects')]]);
	const bad = await harness([{ body: { items: [link({ name: 'Higiene' })] } }]);
	await assert.rejects(bad.api.listHygieneSubjects(bad.cookies), /no es válida/);
	const enable = await harness([{ status: 201, body: link() }]);
	assert.deepEqual(plain(await enable.api.enableHygieneSubject(subjectId, enable.cookies)), link());
	assert.deepEqual(enable.requests, [{ url: url('/hygiene-preventive-subjects'), method: 'POST', body: { subject_id: subjectId } }]);
	const other = await harness([{ status: 201, body: link({ subject_id: careerId }) }]);
	await assert.rejects(other.api.enableHygieneSubject(subjectId, other.cookies), /no se pudo confirmar/i);
	const duplicate = await harness([{ status: 409, body: { error: { code: 'CONFLICT', message: 'subject is already enabled for hygiene and preventive dentistry' } } }]);
	await assert.rejects(duplicate.api.enableHygieneSubject(subjectId, duplicate.cookies), (error) => error.status === 409);
	const none = await harness();
	await assert.rejects(none.api.enableHygieneSubject('not-a-uuid', none.cookies), /asignatura/);
	assert.equal(none.requests.length, 0);
});

test('chart geometry draws every FDI tooth once, vestibular outward and mesial toward the midline', async () => {
	const { api } = await harness([], odontogramPath);
	const { api: pod } = await harness();
	assert.deepEqual([...api.CHART_ORDER].sort(), [...pod.FDI_TEETH].sort());
	assert.equal(new Set(api.CHART_ORDER).size, 52);
	assert.deepEqual(plain(api.CHART_ROWS[0].left), ['18', '17', '16', '15', '14', '13', '12', '11']);
	assert.deepEqual(plain(api.CHART_ROWS[2].right), ['71', '72', '73', '74', '75']);
	const faces = (code) => plain(api.FACE_POSITIONS.map((position) => api.faceAt(position, code)));
	// Order: top, bottom, left, right, center.
	assert.deepEqual(faces('16'), ['vestibular', 'lingual', 'distal', 'mesial', 'occlusal']);
	assert.deepEqual(faces('26'), ['vestibular', 'lingual', 'mesial', 'distal', 'occlusal']);
	assert.deepEqual(faces('36'), ['lingual', 'vestibular', 'mesial', 'distal', 'occlusal']);
	assert.deepEqual(faces('46'), ['lingual', 'vestibular', 'distal', 'mesial', 'occlusal']);
	assert.deepEqual(faces('55'), faces('16'));
	assert.deepEqual(faces('75'), faces('36'));
});

test('discovery reads /mine without a query, maps 403 to forbidden, propagates 401 and refuses duplicate pairs', async () => {
	const pair = { subject_id: subjectId, academic_group_id: groupId };
	const ok = await harness([{ body: { items: [pair] } }], discoveryPath);
	assert.deepEqual(plain(await ok.api.listHygieneContexts(ok.cookies)), { status: 'ok', items: [pair] });
	assert.deepEqual(ok.requests.map((request) => request.url), [url('/hygiene-preventive-subjects/mine')]);
	assert.equal(ok.api.isHygieneContext([pair], subjectId, groupId), true);
	assert.equal(ok.api.isHygieneContext([pair], subjectId, careerId), false);
	const forbidden = await harness([{ status: 403, body: { error: { code: 'FORBIDDEN', message: 'estudiante or teacher role required' } } }], discoveryPath);
	assert.deepEqual(plain(await forbidden.api.listHygieneContexts(forbidden.cookies)), { status: 'forbidden' });
	const expired = await harness([{ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }], discoveryPath);
	await assert.rejects(expired.api.listHygieneContexts(expired.cookies), (error) => error.status === 401);
	const duplicated = await harness([{ body: { items: [pair, pair] } }], discoveryPath);
	await assert.rejects(duplicated.api.listHygieneContexts(duplicated.cookies), /repite/);
	const extra = await harness([{ body: { items: [{ ...pair, form: 'hygiene' }] } }], discoveryPath);
	await assert.rejects(extra.api.listHygieneContexts(extra.cookies), /no es válida/);
});
