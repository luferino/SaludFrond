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
		if (response.empty) return new Response(null, { status: response.status ?? 204 });
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
			if (specifier === './session' || specifier === '../../shared/session') return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
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

// Plaque indices (S1): accepted from served drafts, teeth-only when written, exact results when stored.
const labelsPath = 'src/pods/hygiene-preventive-draft/labels.ts';
const teacherId = '66666666-6666-4666-8666-666666666666';
const plaque = {
	loe_silness: { teeth: { 16: { distal: 2, vestibular: 2, mesial: 2, lingual: 1 } }, average: 1.75, category: 'abundant' },
	oleary: { teeth: { 11: { mesial: true, distal: false, vestibular: false, lingual: false } }, stained_surfaces: 1, present_surfaces: 4, percentage: 25, category: 'good' },
};
const plaqueWrite = { loe_silness: { teeth: plaque.loe_silness.teeth }, oleary: { teeth: plaque.oleary.teeth } };
const allFalse = { mesial: false, distal: false, vestibular: false, lingual: false };

test('plaque from a served draft is accepted and returned as stored, results included', async () => {
	const served = { ...stored, plaque };
	const ok = await harness([{ body: draft({ content: served }) }]);
	assert.deepEqual(plain((await ok.api.getHygieneDraft(largeId, ok.cookies)).content.plaque), plaque);
	assert.equal(ok.api.isHygieneDraft(draft({ content: served })), true);
});

test('writable content keeps only the plaque teeth and keeps null, {} and absent plaque sections exactly', async () => {
	const { api } = await harness();
	assert.deepEqual(plain(api.writableHygieneContent({ ...stored, plaque })), { ...content, plaque: plaqueWrite });
	assert.deepEqual(plain(api.writableHygieneContent({ plaque: { loe_silness: null } })), { plaque: { loe_silness: null } });
	assert.deepEqual(plain(api.writableHygieneContent({ plaque: { oleary: null, loe_silness: null } })), { plaque: { oleary: null, loe_silness: null } });
	assert.deepEqual(plain(api.writableHygieneContent({ plaque: {} })), { plaque: {} });
	assert.deepEqual(plain(api.writableHygieneContent({ plaque: { loe_silness: { teeth: {}, average: null, category: null } } })), { plaque: { loe_silness: { teeth: {} } } });
	assert.equal(Object.hasOwn(api.writableHygieneContent({ odontogram: content.odontogram }), 'plaque'), false);
});

test('write validation accepts plaque teeth only and names every computed field it refuses', async () => {
	const { api } = await harness();
	assert.deepEqual(plain(api.validateHygieneContent({ plaque: plaqueWrite })), { plaque: plaqueWrite });
	assert.deepEqual(plain(api.validateHygieneContent({ plaque: { loe_silness: null, oleary: null } })), { plaque: { loe_silness: null, oleary: null } });
	assert.deepEqual(plain(api.validateHygieneContent({ plaque: { loe_silness: { teeth: {} } } })), { plaque: { loe_silness: { teeth: {} } } });
	assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: {}, average: 1.75 } } }), /plaque\.loe_silness\.average/);
	assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: {}, average: null, category: null } } }), /plaque\.loe_silness\.average/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: {}, percentage: 25 } } }), /plaque\.oleary\.percentage/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: {}, stained_surfaces: 1 } } }), /plaque\.oleary\.stained_surfaces/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: {}, present_surfaces: 0 } } }), /plaque\.oleary\.present_surfaces/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: {}, category: null } } }), /plaque\.oleary\.category/);
});

test('plaque rejects unknown sections and fields, non-object sections and a missing teeth object', async () => {
	const { api } = await harness();
	assert.throws(() => api.validateHygieneContent({ plaque: [] }), /plaque/);
	assert.throws(() => api.validateHygieneContent({ plaque: null }), /plaque/);
	assert.throws(() => api.validateHygieneContent({ plaque: { gingival: {} } }), /plaque\.gingival/);
	assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: 3 } }), /plaque\.loe_silness/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: [] } }), /plaque\.oleary/);
	assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: {} } }), /plaque\.loe_silness\.teeth/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: null } } }), /plaque\.oleary\.teeth/);
	assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: { 16: 'present' } } } }), /plaque\.loe_silness\.teeth\.16/);
	assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: { 16: { lingual: 1, palatal: 1 } } } } }), /plaque\.loe_silness\.teeth\.16\.palatal/);
});

test('Löe-Silness accepts only the six index teeth, the four sites and integer grades 0 to 3', async () => {
	const { api } = await harness();
	assert.doesNotThrow(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: { 44: {}, 21: { lingual: 0 }, 36: { mesial: 3 } } } } }));
	for (const code of ['11', '26', '31', '46', '51']) {
		assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: { [code]: { mesial: 1 } } } } }), new RegExp(`plaque\.loe_silness\.teeth\.${code} debe ser una de 16`), code);
	}
	for (const grade of [4, -1, 1.5, '2', null]) {
		assert.throws(() => api.validateHygieneContent({ plaque: { loe_silness: { teeth: { 16: { distal: grade } } } } }), /plaque\.loe_silness\.teeth\.16\.distal/, String(grade));
	}
});

test("O'Leary accepts any FDI code and requires all four boolean surfaces on each recorded tooth", async () => {
	const { api } = await harness();
	assert.doesNotThrow(() => api.validateHygieneContent({ plaque: { oleary: { teeth: { 11: { ...allFalse, mesial: true }, 85: { ...allFalse, lingual: true } } } } }));
	assert.doesNotThrow(() => api.validateHygieneContent({ plaque: { oleary: { teeth: {} } } }));
	for (const code of ['19', '56', '86']) {
		assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: { [code]: allFalse } } } }), new RegExp(`plaque\.oleary\.teeth\.${code} no es un código FDI válido`), code);
	}
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: { 11: { mesial: false, distal: false, vestibular: false } } } } }), /plaque\.oleary\.teeth\.11\.lingual/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: { 11: { ...allFalse, mesial: 'true' } } } } }), /plaque\.oleary\.teeth\.11\.mesial/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: { 11: { ...allFalse, palatal: true } } } } }), /plaque\.oleary\.teeth\.11\.palatal/);
	assert.throws(() => api.validateHygieneContent({ plaque: { oleary: { teeth: { 11: 'evaluated' } } } }), /plaque\.oleary\.teeth\.11/);
});

test('stored plaque needs its exact result fields and counts consistent with the recorded teeth', async () => {
	const { api } = await harness();
	const served = (section) => draft({ content: { plaque: section } });
	assert.equal(api.isHygieneDraft(served(plaque)), true);
	assert.equal(api.isHygieneDraft(served({ loe_silness: { teeth: {}, average: null, category: null }, oleary: { teeth: {}, stained_surfaces: 0, present_surfaces: 0, percentage: null, category: null } })), true);
	assert.equal(api.isHygieneDraft(served({ loe_silness: { teeth: {} } })), false, 'results are required when stored');
	assert.equal(api.isHygieneDraft(served({ loe_silness: { ...plaque.loe_silness, extra: 1 } })), false);
	assert.equal(api.isHygieneDraft(served({ loe_silness: { ...plaque.loe_silness, average: '1.75' } })), false);
	assert.equal(api.isHygieneDraft(served({ loe_silness: { ...plaque.loe_silness, category: 'excellent' } })), false);
	assert.equal(api.isHygieneDraft(served({ oleary: { ...plaque.oleary, present_surfaces: 8 } })), false);
	assert.equal(api.isHygieneDraft(served({ oleary: { ...plaque.oleary, stained_surfaces: 2 } })), false);
	assert.equal(api.isHygieneDraft(served({ oleary: { ...plaque.oleary, percentage: null, category: 'poor' } })), true, 'percentage is not recomputed');
	assert.throws(() => api.writableHygieneContent({ plaque: { oleary: { ...plaque.oleary, stained_surfaces: 2 } } }), /plaque\.oleary\.stained_surfaces/);
});

// Paper consent (S3): exact paths, bodies and shapes; the patient body never carries signer fields.
const consentPath = `/hygiene-preventive-drafts/${largeId}/consent`;
const declaration = (overrides = {}) => ({
	id: '7', draft_id: largeId, signer: 'patient', signer_name: 'Ana Pérez', signer_document: '123', declared_by: authorId, declared_at: iso, ...overrides,
});
const parentDeclaration = (overrides = {}) => declaration({ signer: 'parent', signer_name: 'María Gómez', signer_document: '12345678', ...overrides });
const parentInput = (overrides = {}) => ({ signer: 'parent', signer_name: 'María Gómez', signer_document: '12345678', ...overrides });

test('consent history reads the exact shape, oldest first, with the current id of the last declaration', async () => {
	const body = { current_declaration_id: '8', declarations: [declaration({ id: '7' }), parentDeclaration({ id: '8' })] };
	const ok = await harness([{ body }]);
	assert.deepEqual(plain(await ok.api.getHygieneConsent(largeId, ok.cookies)), body);
	assert.deepEqual(ok.requests, [{ url: url(consentPath), method: 'GET', body: undefined }]);
	const none = await harness([{ body: { current_declaration_id: null, declarations: [] } }]);
	assert.deepEqual(plain(await none.api.getHygieneConsent(largeId, none.cookies)), { current_declaration_id: null, declarations: [] });
});

test('consent history refuses extra keys, foreign or malformed declarations and a current id that is not the last one', async () => {
	const bodies = [
		{ current_declaration_id: null, declarations: [], total: 0 },
		{ current_declaration_id: '7', declarations: [declaration({ draft_id: '4' })] },
		{ current_declaration_id: '7', declarations: [declaration({ extra: 1 })] },
		{ current_declaration_id: '7', declarations: [declaration({ signer: 'guardian' })] },
		{ current_declaration_id: '7', declarations: [declaration({ declared_by: 'me' })] },
		{ current_declaration_id: '9', declarations: [declaration({ id: '7' }), parentDeclaration({ id: '8' })] },
		{ current_declaration_id: null, declarations: [declaration()] },
		{ current_declaration_id: '7', declarations: [] },
		{ current_declaration_id: '7' },
	];
	for (const body of bodies) {
		const env = await harness([{ body }]);
		await assert.rejects(env.api.getHygieneConsent(largeId, env.cookies), /no es válida/, JSON.stringify(body));
	}
	const none = await harness();
	await assert.rejects(none.api.getHygieneConsent('0', none.cookies), /identificador/);
	assert.equal(none.requests.length, 0);
});

test('patient consent posts only paper_signed and signer, never signer_name or signer_document', async () => {
	const ok = await harness([{ status: 201, body: declaration() }]);
	assert.deepEqual(plain(await ok.api.declareHygieneConsent(largeId, { signer: 'patient' }, ok.cookies)), declaration());
	assert.deepEqual(ok.requests, [{ url: url(consentPath), method: 'POST', body: { paper_signed: true, signer: 'patient' } }]);
	const leaky = await harness([{ status: 201, body: declaration() }]);
	await leaky.api.declareHygieneConsent(largeId, { signer: 'patient', signer_name: null, signer_document: null }, leaky.cookies);
	assert.deepEqual(leaky.requests[0].body, { paper_signed: true, signer: 'patient' });
	assert.equal(Object.hasOwn(leaky.requests[0].body, 'signer_name'), false);
	assert.equal(Object.hasOwn(leaky.requests[0].body, 'signer_document'), false);
});

test('parent consent posts the name exactly as typed and the document, and the response must echo the signer', async () => {
	const name = '  María Gómez ';
	const ok = await harness([{ status: 201, body: parentDeclaration({ signer_name: name }) }]);
	assert.deepEqual(plain(await ok.api.declareHygieneConsent(largeId, { signer: 'parent', signer_name: name, signer_document: '12345678' }, ok.cookies)), parentDeclaration({ signer_name: name }));
	assert.deepEqual(ok.requests, [{ url: url(consentPath), method: 'POST', body: { paper_signed: true, signer: 'parent', signer_name: name, signer_document: '12345678' } }]);
	const mismatches = [
		parentDeclaration({ signer_name: 'María' }),
		parentDeclaration({ signer_document: '87654321' }),
		declaration(),
		parentDeclaration({ draft_id: '4' }),
		{ ...parentDeclaration(), extra: 1 },
		parentDeclaration({ id: 'abc' }),
	];
	for (const body of mismatches) {
		const env = await harness([{ status: 201, body }]);
		await assert.rejects(env.api.declareHygieneConsent(largeId, parentInput(), env.cookies), /no se pudo confirmar/i, JSON.stringify(body));
		assert.equal(env.requests.length, 1);
	}
});

test('parent name of 200 code points and documents of 4 or 8 digits are accepted', async () => {
	for (const [name, document] of [['😀'.repeat(200), '1234'], ['Ana', '12345678']]) {
		const env = await harness([{ status: 201, body: parentDeclaration({ signer_name: name, signer_document: document }) }]);
		await env.api.declareHygieneConsent(largeId, { signer: 'parent', signer_name: name, signer_document: document }, env.cookies);
		assert.equal(env.requests.length, 1);
	}
});

test('consent input is checked locally: a bad parent name or document, signer or draft id sends no request', async () => {
	const cases = [
		[largeId, parentInput({ signer_name: '' })],
		[largeId, parentInput({ signer_name: '   ' })],
		[largeId, parentInput({ signer_name: '😀'.repeat(201) })],
		[largeId, parentInput({ signer_name: 'Ana\u0000' })],
		[largeId, parentInput({ signer_name: 'Ana\uD800' })],
		[largeId, parentInput({ signer_name: 42 })],
		[largeId, parentInput({ signer_document: '123' })],
		[largeId, parentInput({ signer_document: '123456789' })],
		[largeId, parentInput({ signer_document: '12a4' })],
		[largeId, parentInput({ signer_document: '1234 ' })],
		[largeId, parentInput({ signer_document: 1234 })],
		[largeId, { signer: 'parent' }],
		[largeId, { signer: 'guardian' }],
		[largeId, null],
		['0', { signer: 'patient' }],
		['abc', { signer: 'patient' }],
	];
	for (const [id, input] of cases) {
		const env = await harness();
		await assert.rejects(env.api.declareHygieneConsent(id, input, env.cookies), Error, JSON.stringify(input));
		assert.equal(env.requests.length, 0, JSON.stringify(input));
	}
});

// Procedure log (S4) and teacher approval (S5): exact paths, bodies, shapes and local checks.
const proceduresPath = `/hygiene-preventive-drafts/${largeId}/procedures`;
const procedureId = '31';
const entryPath = `${proceduresPath}/${procedureId}`;
const procedure = (overrides = {}) => ({
	id: procedureId, draft_id: largeId, procedure_date: '2026-11-10', description: '  Profilaxis\ncon pasta  ', author_id: authorId, student_name: 'Ana Pérez',
	version: '2', approved_by: null, teacher_name: null, approved_at: null, created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});
const approvedEntry = (overrides = {}) => procedure({
	version: '3', approved_by: teacherId, teacher_name: 'Luis Docente', approved_at: '2026-11-11T09:00:00.000Z', status: 'approved', ...overrides,
});
const rejection = (status, message, code = 'CONFLICT') => ({ status, body: { error: { code, message } } });

test('procedure list reads {items} with the exact 13-key entries and refuses foreign or inconsistent entries', async () => {
	const items = [procedure(), approvedEntry({ id: '32' })];
	const ok = await harness([{ body: { items } }]);
	assert.deepEqual(plain(await ok.api.listHygieneProcedures(largeId, ok.cookies)), items);
	assert.deepEqual(ok.requests, [{ url: url(proceduresPath), method: 'GET', body: undefined }]);
	const { status, ...withoutStatus } = procedure();
	const bodies = [
		{ items: [], total: 0 },
		{ items: [procedure({ draft_id: '4' })] },
		{ items: [{ ...procedure(), extra: true }] },
		{ items: [withoutStatus] },
		{ items: [procedure({ status: 'approved' })] },
		{ items: [approvedEntry({ status: 'pending' })] },
		{ items: [procedure({ approved_by: teacherId })] },
		{ items: [approvedEntry({ teacher_name: null })] },
		{ items: [approvedEntry({ approved_at: null })] },
		{ items: [procedure({ procedure_date: '2026-02-30' })] },
		{ items: [procedure({ procedure_date: '10/11/2026' })] },
		{ items: [procedure({ version: '0' })] },
		{ items: [procedure({ created_at: 'today' })] },
		{ items: [procedure({ author_id: 'x' })] },
		{ items: [procedure({ description: 5 })] },
	];
	for (const body of bodies) {
		const env = await harness([{ body }]);
		await assert.rejects(env.api.listHygieneProcedures(largeId, env.cookies), /no es válida/, JSON.stringify(body).slice(0, 120));
	}
	const none = await harness();
	await assert.rejects(none.api.listHygieneProcedures('0', none.cookies), /identificador/);
	assert.equal(status, 'pending');
	assert.equal(none.requests.length, 0);
});

test('create posts procedure_date and description exactly as typed and the entry must echo them', async () => {
	const input = { procedure_date: '2026-11-10', description: '  Profilaxis\ncon pasta  ' };
	const ok = await harness([{ status: 201, body: procedure() }]);
	assert.deepEqual(plain(await ok.api.createHygieneProcedure(largeId, input, ok.cookies)), procedure());
	assert.deepEqual(ok.requests, [{ url: url(proceduresPath), method: 'POST', body: input }]);
	const echoes = [procedure({ description: 'Profilaxis' }), procedure({ procedure_date: '2026-11-11' }), procedure({ draft_id: '4' })];
	for (const body of echoes) {
		const env = await harness([{ status: 201, body }]);
		await assert.rejects(env.api.createHygieneProcedure(largeId, input, env.cookies), /no se pudo confirmar/i, JSON.stringify(body).slice(0, 80));
	}
});

test('create checks date and description locally and sends nothing when they are invalid', async () => {
	const valid = { procedure_date: '2026-11-10', description: 'Control' };
	const cases = [
		{ ...valid, procedure_date: '2026-02-30' },
		{ ...valid, procedure_date: '2026-13-01' },
		{ ...valid, procedure_date: '2026-00-10' },
		{ ...valid, procedure_date: '26-11-10' },
		{ ...valid, procedure_date: '2026-11-1' },
		{ ...valid, procedure_date: ' 2026-11-10' },
		{ ...valid, procedure_date: '2026-11-10T00:00:00Z' },
		{ ...valid, procedure_date: 20261110 },
		{ ...valid, description: '' },
		{ ...valid, description: ' \n\t ' },
		{ ...valid, description: '😀'.repeat(1001) },
		{ ...valid, description: 'Control\u0000' },
		{ ...valid, description: 'Control\uDC00' },
		{ ...valid, description: 5 },
		{ procedure_date: '2026-11-10' },
		null,
	];
	for (const input of cases) {
		const env = await harness();
		await assert.rejects(env.api.createHygieneProcedure(largeId, input, env.cookies), Error, JSON.stringify(input));
		assert.equal(env.requests.length, 0, JSON.stringify(input));
	}
	for (const input of [{ ...valid, description: '😀'.repeat(1000) }, { ...valid, description: ' a ' }]) {
		const env = await harness([{ status: 201, body: procedure({ description: input.description }) }]);
		await env.api.createHygieneProcedure(largeId, input, env.cookies);
		assert.equal(env.requests.length, 1);
	}
	const badId = await harness();
	await assert.rejects(badId.api.createHygieneProcedure('x', valid, badId.cookies), /identificador/);
	assert.equal(badId.requests.length, 0);
});

test('update patches expected_version and both fields, and needs a greater version and the same entry back', async () => {
	const input = { procedure_date: '2026-11-09', description: 'Revisión de placa' };
	const ok = await harness([{ body: procedure({ version: '3', ...input }) }]);
	assert.deepEqual(plain(await ok.api.updateHygieneProcedure(largeId, procedureId, '2', input, ok.cookies)), procedure({ version: '3', ...input }));
	assert.deepEqual(ok.requests, [{ url: url(entryPath), method: 'PATCH', body: { expected_version: '2', ...input } }]);
	const stale = await harness([{ body: procedure({ version: '2', ...input }) }]);
	await assert.rejects(stale.api.updateHygieneProcedure(largeId, procedureId, '2', input, stale.cookies), /no se pudo confirmar/i);
	const otherEntry = await harness([{ body: procedure({ id: '33', version: '3', ...input }) }]);
	await assert.rejects(otherEntry.api.updateHygieneProcedure(largeId, procedureId, '2', input, otherEntry.cookies), /no se pudo confirmar/i);
	const conflict = await harness([rejection(409, 'procedure entry version changed; reload before saving')]);
	await assert.rejects(conflict.api.updateHygieneProcedure(largeId, procedureId, '2', input, conflict.cookies), (error) => error.status === 409);
	assert.equal(conflict.requests.length, 1);
	const none = await harness();
	await assert.rejects(none.api.updateHygieneProcedure(largeId, '0', '2', input, none.cookies), /identificador/);
	await assert.rejects(none.api.updateHygieneProcedure(largeId, procedureId, 'x', input, none.cookies), /versión/);
	await assert.rejects(none.api.updateHygieneProcedure(largeId, procedureId, '2', { ...input, description: ' ' }, none.cookies), Error);
	assert.equal(none.requests.length, 0);
});

test('delete sends one DELETE with expected_version in the query and accepts only an empty 204', async () => {
	const ok = await harness([{ empty: true }]);
	assert.equal(await ok.api.deleteHygieneProcedure(largeId, procedureId, '2', ok.cookies), undefined);
	assert.deepEqual(ok.requests, [{ url: url(`${entryPath}?expected_version=2`), method: 'DELETE', body: undefined }]);
	const json = await harness([{ status: 200, body: {} }]);
	await assert.rejects(json.api.deleteHygieneProcedure(largeId, procedureId, '2', json.cookies), /no se pudo confirmar/i);
	const approved = await harness([rejection(409, 'approved procedure entries cannot be changed')]);
	await assert.rejects(approved.api.deleteHygieneProcedure(largeId, procedureId, '2', approved.cookies), (error) => error.status === 409);
	const expired = await harness([{ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }]);
	await assert.rejects(expired.api.deleteHygieneProcedure(largeId, procedureId, '2', expired.cookies), (error) => error.status === 401);
	assert.deepEqual(expired.writes, [['delete', 'session', { path: '/' }]]);
	const none = await harness();
	await assert.rejects(none.api.deleteHygieneProcedure(largeId, 'x', '2', none.cookies), /identificador/);
	await assert.rejects(none.api.deleteHygieneProcedure(largeId, procedureId, '0', none.cookies), /versión/);
	assert.equal(none.requests.length, 0);
});

test('approval posts exactly expected_version and needs an approved entry of the same id with a greater version', async () => {
	const ok = await harness([{ body: approvedEntry() }]);
	assert.deepEqual(plain(await ok.api.approveHygieneProcedure(largeId, procedureId, '2', ok.cookies)), approvedEntry());
	assert.deepEqual(ok.requests, [{ url: url(`${entryPath}/approval`), method: 'POST', body: { expected_version: '2' } }]);
	const answers = [procedure({ version: '3' }), approvedEntry({ id: '99' }), approvedEntry({ version: '2' }), approvedEntry({ draft_id: '4' }), { ...approvedEntry(), extra: 1 }];
	for (const body of answers) {
		const env = await harness([{ body }]);
		await assert.rejects(env.api.approveHygieneProcedure(largeId, procedureId, '2', env.cookies), /no se pudo confirmar/i, JSON.stringify(body).slice(0, 80));
	}
	const already = await harness([rejection(409, 'procedure entry is already approved')]);
	await assert.rejects(already.api.approveHygieneProcedure(largeId, procedureId, '2', already.cookies), (error) => error.status === 409);
	assert.equal(already.requests.length, 1);
	const none = await harness();
	await assert.rejects(none.api.approveHygieneProcedure(largeId, '0', '2', none.cookies), /identificador/);
	await assert.rejects(none.api.approveHygieneProcedure(largeId, procedureId, 'x', none.cookies), /versión/);
	assert.equal(none.requests.length, 0);
});

// Spanish copy for the new sections (labels only; the file imports types from api.ts).
test('labels carry the plaque, signer and procedure copy', async () => {
	const { api: labels } = await harness([], labelsPath);
	assert.equal(labels.HYGIENE_SECTION_LABELS.plaque, 'Índices de placa');
	assert.deepEqual(plain(labels.HYGIENE_PLAQUE_SECTION_LABELS), { loe_silness: 'Löe-Silness', oleary: "O'Leary" });
	assert.deepEqual(plain(labels.LOE_SILNESS_SITE_LABELS), { distal: 'Distal', vestibular: 'Vestibular', mesial: 'Mesial', lingual: 'Lingual / palatino' });
	assert.deepEqual(plain(labels.OLEARY_SURFACE_LABELS), { mesial: 'Mesial', distal: 'Distal', vestibular: 'Vestibular', lingual: 'Lingual / palatino' });
	assert.deepEqual(plain(labels.LOE_SILNESS_CATEGORY_LABELS), { low: 'POCA', moderate: 'MODERADA', abundant: 'ABUNDANTE' });
	assert.deepEqual(plain(labels.OLEARY_CATEGORY_LABELS), { good: 'BUENO', fair: 'REGULAR', poor: 'MALO' });
	assert.deepEqual(plain(labels.HYGIENE_SIGNER_LABELS), { patient: 'Paciente', parent: 'Madre, padre o tutor' });
	assert.deepEqual(plain(labels.HYGIENE_PROCEDURE_STATUS_LABELS), { pending: 'Pendiente', approved: 'Aprobado' });
});
