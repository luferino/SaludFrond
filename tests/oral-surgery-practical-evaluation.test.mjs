import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/oral-surgery-draft/api.ts';
const actionPath = 'src/pods/oral-surgery-draft/actions/practical-evaluation.ts';
const labelsPath = 'src/pods/oral-surgery-draft/labels.ts';
const componentPath = 'src/components/clinical/PracticalEvaluationReadOnly.astro';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const draftId = '9223372036854775807';
const iso = '2026-11-16T12:00:00.000Z';
const draftPath = `/oral-surgery-drafts/${draftId}`;
const reportPath = `${draftPath}/operative-report`;
const practicalPath = `${draftPath}/practical-evaluation`;
const correctionsPath = `${practicalPath}/corrections`;
const practicalUrl = `${apiBase}${practicalPath}`;
const correctionsUrl = `${apiBase}${correctionsPath}`;
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };

// Scores in S2 order; the maxima total 20. at16 and at15 move two and three points from the maxima.
const scores = {
	hand_washing: 1, barrier_elements: 1, waste_disposal: 1, clinical_table_setup: 2, asepsis: 1, anamnesis_questionnaire: 3,
	anesthetic_technique: 2, sindesmotomy_elevators: 2, surgical_procedure: 3, curettage_suture: 2, record_and_equipment: 1, relationship: 1,
};
const KEYS = Object.keys(scores);
const at16 = { ...scores, surgical_procedure: 1, anamnesis_questionnaire: 1 };
const at15 = { ...at16, relationship: 0 };
const at14 = { ...at15, curettage_suture: 1 };
const zeros = Object.fromEntries(KEYS.map((key) => [key, 0]));

const draft = (overrides = {}) => ({
	id: draftId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: { treatment_plan: { procedure: 'Exodoncia' } }, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const closedReport = (overrides = {}) => ({
	draft_id: draftId, draft_version: '3', authorization_id: '11', content: { narrative: 'Exodoncia sin complicaciones' }, version: '3',
	status: 'closed', created_by: authorId, created_at: iso, updated_at: iso, closed_by: teacherId, closed_at: iso,
	teacher_habilitation_id: habilitationId, ...overrides,
});
const openReport = (overrides = {}) => closedReport({
	status: 'draft', version: '2', closed_by: null, closed_at: null, teacher_habilitation_id: null, ...overrides,
});
const revision = (overrides = {}) => ({
	revision: '1', items: at16, total: 16, outcome: 'approved', reason: null,
	graded_by: teacherId, teacher_habilitation_id: habilitationId, graded_at: iso, ...overrides,
});
const correctedRevision = (overrides = {}) => revision({ revision: '2', reason: 'Corrección de la anamnesis', ...overrides });
const studentView = (overrides = {}) => ({ current: { items: at16, total: 16, outcome: 'approved', graded_at: iso, ...overrides } });
const instructorView = (history = [revision()]) => ({ current: history.at(-1), history });
const errorBody = (code, message) => ({ error: { code, message } });
const notFound = (message) => ({ status: 404, body: errorBody('NOT_FOUND', message) });
const evaluationNotFound = notFound('oral surgery practical evaluation was not found');
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const plain = (value) => JSON.parse(JSON.stringify(value));
const scoreControls = (items) => Object.fromEntries(KEYS.map((key) => [key, String(items[key])]));
const gradeInput = (overrides = {}) => ({ id: draftId, ...context, ...scoreControls(at16), ...overrides });
const correctInput = (overrides = {}) => ({ ...gradeInput(), expected_revision: '1', reason: 'Corrección de la anamnesis', ...overrides });
const without = (input, key) => {
	const copy = { ...input };
	delete copy[key];
	return copy;
};
const writes = (requests) => requests.filter((request) => request.method !== 'GET');
function assertUncertain(result, env) {
	assert.equal(result.success, false);
	assert.equal(result.uncertain, true);
	assert.match(result.error, /No se pudo confirmar/);
	assert.equal(writes(env.requests).length, 1);
}

/** Real pods run in one vm context; fetch is a route table and every request is recorded. */
async function environment(routes = {}) {
	const requests = [];
	const table = {
		[`GET ${draftPath}`]: { body: draft() },
		[`GET ${reportPath}`]: { body: closedReport() },
		[`GET ${practicalPath}`]: evaluationNotFound,
		...routes,
	};
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, BigInt, atob, btoa,
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
	async function importModule(path) {
		const mod = await load(new URL(path, root).href);
		if (mod.status !== 'evaluated') await mod.evaluate();
		return mod.namespace;
	}
	const cookies = (actor) => {
		const token = jwt(actor);
		return { get: (name) => (name === 'session' ? { value: token } : undefined), set() {}, delete() {} };
	};
	return { requests, importModule, cookies, api: await importModule(apiPath) };
}

const student = { sub: authorId, username: 'ana', role: 'estudiante', permissions: ['oral-surgery-drafts:read', 'oral-surgery-drafts:write'], exp: 4102444800, iat: 1 };
const teacher = (permissions = ['oral-surgery-drafts:read', 'oral-surgery-drafts:grade']) => ({ sub: teacherId, username: 'doc', role: 'teacher', permissions, exp: 4102444800, iat: 1 });

// P1: rubric, threshold and pure helpers (S2).

test('P1 the rubric lists the 12 S2 keys in order with fixed maxima that total 20, and the passing total is 15', async () => {
	const { api } = await environment();
	assert.deepEqual(plain(api.PRACTICAL_RUBRIC), [
		{ key: 'hand_washing', max: 1 }, { key: 'barrier_elements', max: 1 }, { key: 'waste_disposal', max: 1 },
		{ key: 'clinical_table_setup', max: 2 }, { key: 'asepsis', max: 1 }, { key: 'anamnesis_questionnaire', max: 3 },
		{ key: 'anesthetic_technique', max: 2 }, { key: 'sindesmotomy_elevators', max: 2 }, { key: 'surgical_procedure', max: 3 },
		{ key: 'curettage_suture', max: 2 }, { key: 'record_and_equipment', max: 1 }, { key: 'relationship', max: 1 },
	]);
	assert.equal(api.PRACTICAL_PASSING_TOTAL, 15);
	assert.equal(api.PRACTICAL_MAX_TOTAL, 20);
});

test('P1 practicalTotal sums the items and practicalOutcome is approved exactly from 15 up', async () => {
	const { api } = await environment();
	assert.equal(api.practicalTotal(scores), 20);
	assert.equal(api.practicalTotal(at15), 15);
	assert.equal(api.practicalTotal(at14), 14);
	assert.equal(api.practicalOutcome(14), 'annulled');
	assert.equal(api.practicalOutcome(15), 'approved');
	assert.equal(api.practicalOutcome(0), 'annulled');
	assert.equal(api.practicalOutcome(20), 'approved');
});

// P2: view shapes and revision rules, checked through the public read (S6).

test('P2 student and instructor views accept the exact contract shapes', async () => {
	for (const body of [studentView(), instructorView(), instructorView([revision(), correctedRevision()])]) {
		const env = await environment({ [`GET ${practicalPath}`]: { body } });
		assert.deepEqual(plain(await env.api.getPracticalEvaluation(draftId, env.cookies(teacher()))), plain(body));
	}
});

test('P2 views reject extra, missing or inconsistent keys, totals, outcomes, items, revisions and reasons', async () => {
	const bad = [
		{ current: studentView().current, extra: true },
		{ current: { ...studentView().current, reason: 'x' } },
		{ current: { ...studentView().current, revision: '1' } },
		{ current: { ...studentView().current, total: 15 } },
		{ current: { ...studentView().current, outcome: 'annulled' } },
		{ current: { ...studentView().current, items: { ...at16, asepsis: 2, total: 17 } } },
		{ current: { ...studentView().current, items: without(at16, 'asepsis') } },
		{ current: { ...studentView().current, items: { ...at16, unknown: 0 } } },
		{ current: { ...studentView().current, items: { ...at16, relationship: 1.5 } } },
		{ current: { ...studentView().current, items: { ...at16, relationship: -1 } } },
		{ current: { ...studentView().current, graded_at: 'yesterday' } },
		instructorView([]),
		{ current: revision(), history: [] },
		{ current: revision(), history: [revision()], extra: true },
		instructorView([revision({ revision: '2', reason: 'x' })]),
		instructorView([revision(), revision({ revision: '3', reason: 'x' })]),
		instructorView([revision(), correctedRevision(), correctedRevision({ revision: '2' })]),
		{ current: revision(), history: [revision(), correctedRevision()] },
		instructorView([revision({ reason: 'no debe existir' })]),
		instructorView([revision(), correctedRevision({ reason: null })]),
		instructorView([revision(), correctedRevision({ reason: '   ' })]),
		instructorView([revision(), correctedRevision({ reason: 'a\u0000b' })]),
		instructorView([revision(), correctedRevision({ reason: 'x'.repeat(4001) })]),
		instructorView([revision({ outcome: 'annulled' })]),
		instructorView([revision({ total: 14 })]),
		instructorView([revision({ graded_by: 'nobody' })]),
		instructorView([revision({ teacher_habilitation_id: '1' })]),
		instructorView([revision({ graded_at: 'yesterday' })]),
		instructorView([revision({ extra: 1 })]),
	];
	for (const body of bad) {
		const env = await environment({ [`GET ${practicalPath}`]: { body } });
		await assert.rejects(env.api.getPracticalEvaluation(draftId, env.cookies(teacher())), /no es válida/, JSON.stringify(body));
	}
});

// P3: reads (S6).

test('P3 a read returns null only for the evaluation-not-found 404; a draft-not-found 404 and other errors are rethrown', async () => {
	let env = await environment();
	assert.equal(await env.api.getPracticalEvaluation(draftId, env.cookies(student)), null);
	env = await environment({ [`GET ${practicalPath}`]: notFound('oral surgery draft was not found') });
	await assert.rejects(env.api.getPracticalEvaluation(draftId, env.cookies(student)), (error) => error.status === 404 && error.message === 'oral surgery draft was not found');
	env = await environment({ [`GET ${practicalPath}`]: { status: 403, body: errorBody('FORBIDDEN', 'forbidden') } });
	await assert.rejects(env.api.getPracticalEvaluation(draftId, env.cookies(student)), (error) => error.status === 403);
	env = await environment({ [`GET ${practicalPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } });
	await assert.rejects(env.api.getPracticalEvaluation(draftId, env.cookies(student)), (error) => error.status === 500);
	env = await environment();
	await assert.rejects(env.api.getPracticalEvaluation('0', env.cookies(student)));
	assert.equal(env.requests.length, 0);
});

// P4: exact request bodies and confirmed responses (S3, S4).

test('P4 grading posts exactly {items}; correction posts {expected_revision, reason, items}; the trimmed reason is what is sent and confirmed', async () => {
	const env = await environment({
		[`POST ${practicalPath}`]: { status: 201, body: revision() },
		[`POST ${correctionsPath}`]: { status: 201, body: correctedRevision() },
	});
	const cookies = env.cookies(teacher());
	assert.deepEqual(plain(await env.api.gradePracticalEvaluation(draftId, at16, cookies)), revision());
	assert.deepEqual(plain(await env.api.correctPracticalEvaluation(draftId, '1', 'Corrección de la anamnesis', at16, cookies)), correctedRevision());
	assert.deepEqual(plain(await env.api.correctPracticalEvaluation(draftId, '1', '  Corrección de la anamnesis  ', at16, cookies)), correctedRevision());
	assert.deepEqual(plain(env.requests), [
		{ method: 'POST', url: practicalUrl, body: { items: at16 } },
		{ method: 'POST', url: correctionsUrl, body: { expected_revision: '1', reason: 'Corrección de la anamnesis', items: at16 } },
		{ method: 'POST', url: correctionsUrl, body: { expected_revision: '1', reason: 'Corrección de la anamnesis', items: at16 } },
	]);
});

test('P5 unconfirmed grade or correction responses throw the confirmation error after one write', async () => {
	const cases = [
		[`POST ${practicalPath}`, (api, cookies) => api.gradePracticalEvaluation(draftId, at16, cookies), revision({ revision: '2', reason: 'x' })],
		[`POST ${practicalPath}`, (api, cookies) => api.gradePracticalEvaluation(draftId, at16, cookies), revision({ items: at15, total: 15, outcome: 'approved' })],
		[`POST ${practicalPath}`, (api, cookies) => api.gradePracticalEvaluation(draftId, at16, cookies), { ...revision(), extra: true }],
		[`POST ${correctionsPath}`, (api, cookies) => api.correctPracticalEvaluation(draftId, '1', 'Corrección de la anamnesis', at16, cookies), correctedRevision({ revision: '3' })],
		[`POST ${correctionsPath}`, (api, cookies) => api.correctPracticalEvaluation(draftId, '1', 'Corrección de la anamnesis', at16, cookies), correctedRevision({ reason: 'Otra' })],
		[`POST ${correctionsPath}`, (api, cookies) => api.correctPracticalEvaluation(draftId, '1', 'Corrección de la anamnesis', at16, cookies), correctedRevision({ items: at14, total: 14, outcome: 'annulled' })],
	];
	for (const [route, call, body] of cases) {
		const env = await environment({ [route]: { status: 201, body } });
		await assert.rejects(call(env.api, env.cookies(teacher())), /no se pudo confirmar/i, JSON.stringify(body));
		assert.equal(writes(env.requests).length, 1);
	}
});

test('P5 the API refuses invalid ids, scores, extra keys and reasons before any request', async () => {
	const env = await environment();
	const cookies = env.cookies(teacher());
	await assert.rejects(env.api.getPracticalEvaluation('abc', cookies));
	await assert.rejects(env.api.gradePracticalEvaluation('0', at16, cookies));
	await assert.rejects(env.api.gradePracticalEvaluation(draftId, { ...at16, hand_washing: 2 }, cookies));
	await assert.rejects(env.api.gradePracticalEvaluation(draftId, { ...at16, extra: 1 }, cookies));
	await assert.rejects(env.api.gradePracticalEvaluation(draftId, without(at16, 'relationship'), cookies));
	await assert.rejects(env.api.correctPracticalEvaluation(draftId, 'x', 'Motivo', at16, cookies));
	for (const reason of ['', '   ', 'a\u0000b', 'x'.repeat(4001)]) {
		await assert.rejects(env.api.correctPracticalEvaluation(draftId, '1', reason, at16, cookies));
	}
	assert.equal(env.requests.length, 0);
});

// P6: action handlers map every S5 backend message to its own copy after exactly one write (S5).

test('P6 grading maps each S5 backend rejection to safe copy after exactly one write and keeps the submitted scores', async () => {
	const cases = [
		[409, 'operative report must be closed before practical evaluation', /debe estar cerrado/],
		[409, 'practical evaluation already exists; reload before grading', /Ya existe una evaluación práctica/],
		[403, 'teacher instructor role required', /Solo un docente instructor/],
		[403, "Permission 'oral-surgery-drafts:grade' required", /No tenés permiso/],
		[404, 'oral surgery draft was not found', /no está disponible/],
		[400, 'missing practical item: hand_washing', /Revisá los puntajes/],
		[400, 'unknown practical item: extra', /Revisá los puntajes/],
		[400, 'asepsis must be an integer from 0 to 1', /Revisá los puntajes/],
	];
	const copies = [];
	for (const [status, message, copy] of cases) {
		const env = await environment({ [`POST ${practicalPath}`]: { status, body: errorBody('E', message) } });
		const { handleGradePracticalEvaluation } = await env.importModule(actionPath);
		const result = plain(await handleGradePracticalEvaluation(gradeInput(), { cookies: env.cookies(teacher()) }));
		assert.equal(result.success, false, message);
		assert.match(result.error, copy, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(result.values.asepsis, '1', message);
		assert.equal(writes(env.requests).length, 1, message);
		copies.push(result.error);
	}
	// The three item messages intentionally share one copy; the other five each have their own.
	assert.equal(new Set(copies).size, 6);
});

test('P6 correcting maps each S5 backend rejection to safe copy after exactly one write and keeps the submitted reason', async () => {
	const cases = [
		[409, 'practical evaluation changed; reload before correcting', /cambió/],
		[409, 'operative report must be closed before practical evaluation', /debe estar cerrado/],
		[403, 'teacher instructor role required', /Solo un docente instructor/],
		[403, "Permission 'oral-surgery-drafts:grade' required", /No tenés permiso/],
		[404, 'oral surgery draft was not found', /no está disponible/],
		[400, 'missing practical item: relationship', /Revisá los puntajes/],
		[400, 'reason must be non-empty text of at most 4000 characters without NUL', /motivo/],
	];
	const copies = [];
	for (const [status, message, copy] of cases) {
		const env = await environment({
			[`GET ${practicalPath}`]: { body: instructorView() },
			[`POST ${correctionsPath}`]: { status, body: errorBody('E', message) },
		});
		const { handleCorrectPracticalEvaluation } = await env.importModule(actionPath);
		const result = plain(await handleCorrectPracticalEvaluation(correctInput(), { cookies: env.cookies(teacher()) }));
		assert.equal(result.success, false, message);
		assert.match(result.error, copy, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(result.values.reason, 'Corrección de la anamnesis', message);
		assert.equal(result.values.expected_revision, '1', message);
		assert.equal(writes(env.requests).length, 1, message);
		copies.push(result.error);
	}
	assert.equal(new Set(copies).size, cases.length);
});

// P7: uncertain outcomes are never retried (S5).

test('P7 network failure, 5xx or an unconfirmed response after the write is uncertain and never retried', async () => {
	for (const response of [{ network: true }, { status: 502, body: {} }, { status: 201, body: revision({ items: at15, total: 15, outcome: 'approved' }) }]) {
		const grade = await environment({ [`POST ${practicalPath}`]: response });
		const { handleGradePracticalEvaluation } = await grade.importModule(actionPath);
		assertUncertain(plain(await handleGradePracticalEvaluation(gradeInput(), { cookies: grade.cookies(teacher()) })), grade);

		const correction = await environment({ [`GET ${practicalPath}`]: { body: instructorView() }, [`POST ${correctionsPath}`]: response });
		const { handleCorrectPracticalEvaluation } = await correction.importModule(actionPath);
		assertUncertain(plain(await handleCorrectPracticalEvaluation(correctInput(), { cookies: correction.cookies(teacher()) })), correction);
	}
});

// P8: pre-write refusals send zero writes (S3, S4, S5).

test('P8 grading refuses a missing grant, a student role, extra or missing fields and bad scores before any request', async () => {
	const badScores = ['', ' 1', '1 ', '+1', '01', '1.0', '-1', '2', '1e0', 'x', '9999999999999999999999'];
	const cases = [
		[gradeInput(), teacher(['oral-surgery-drafts:read'])],
		[gradeInput(), { ...student, permissions: ['oral-surgery-drafts:grade'] }],
		[gradeInput({ extra: 'x' }), teacher()],
		[gradeInput({ reason: 'no aplica' }), teacher()],
		[gradeInput({ expected_revision: '1' }), teacher()],
		[gradeInput({ id: 'x' }), teacher()],
		[gradeInput({ subject_id: 'x' }), teacher()],
		[without(gradeInput(), 'relationship'), teacher()],
		...badScores.map((value) => [gradeInput({ hand_washing: value }), teacher()]),
		[gradeInput({ asepsis: '2' }), teacher()],
	];
	for (const [input, actor] of cases) {
		const env = await environment();
		const { handleGradePracticalEvaluation } = await env.importModule(actionPath);
		const result = await handleGradePracticalEvaluation(input, { cookies: env.cookies(actor) });
		assert.equal(result.success, false, JSON.stringify(input));
		assert.equal(env.requests.length, 0, JSON.stringify(input));
	}
});

test('P8 grading re-reads the draft, the closed report and the current evaluation and refuses before the POST', async () => {
	const cases = [
		[{ [`GET ${reportPath}`]: { body: openReport() } }, /debe estar cerrado/],
		[{ [`GET ${reportPath}`]: notFound('oral surgery operative report was not found') }, /No hay un parte quirúrgico cerrado/],
		[{ [`GET ${reportPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }, /No se pudo verificar/],
		[{ [`GET ${practicalPath}`]: { body: instructorView() } }, /Ya existe una evaluación práctica/],
		[{ [`GET ${draftPath}`]: { body: draft({ patient_id: teacherId }) } }, /no está disponible/],
		[{ [`GET ${draftPath}`]: { body: draft({ origin_group_id: subjectId }) } }, /no está disponible/],
		[{ [`GET ${draftPath}`]: notFound('oral surgery draft was not found') }, /no está disponible/],
	];
	for (const [routes, copy] of cases) {
		const env = await environment(routes);
		const { handleGradePracticalEvaluation } = await env.importModule(actionPath);
		const result = plain(await handleGradePracticalEvaluation(gradeInput(), { cookies: env.cookies(teacher()) }));
		assert.equal(result.success, false);
		assert.match(result.error, copy);
		assert.equal(writes(env.requests).length, 0);
	}
});

test('P8 correcting refuses a missing grant, extra fields, bad ids, scores or reasons before any request', async () => {
	const cases = [
		[correctInput(), teacher(['oral-surgery-drafts:read'])],
		[correctInput({ extra: 'x' }), teacher()],
		[correctInput({ expected_revision: '0' }), teacher()],
		[correctInput({ expected_revision: 'x' }), teacher()],
		[correctInput({ reason: '' }), teacher()],
		[correctInput({ reason: '   ' }), teacher()],
		[correctInput({ reason: 'a\u0000b' }), teacher()],
		[correctInput({ reason: 'x'.repeat(4001) }), teacher()],
		[correctInput({ hand_washing: '2' }), teacher()],
		[without(correctInput(), 'expected_revision'), teacher()],
	];
	for (const [input, actor] of cases) {
		const env = await environment({ [`GET ${practicalPath}`]: { body: instructorView() } });
		const { handleCorrectPracticalEvaluation } = await env.importModule(actionPath);
		const result = await handleCorrectPracticalEvaluation(input, { cookies: env.cookies(actor) });
		assert.equal(result.success, false, JSON.stringify(input));
		assert.equal(env.requests.length, 0, JSON.stringify(input));
	}
});

test('P8 correcting re-reads the closed report and the evaluation and refuses a stale revision or a missing evaluation before the POST', async () => {
	const cases = [
		[{ [`GET ${practicalPath}`]: { body: instructorView() }, [`GET ${reportPath}`]: { body: openReport() } }, /debe estar cerrado/],
		[{ [`GET ${practicalPath}`]: evaluationNotFound }, /No hay una evaluación práctica para corregir/],
		[{ [`GET ${practicalPath}`]: { body: instructorView([revision(), correctedRevision()]) } }, /cambió/],
		[{ [`GET ${practicalPath}`]: { body: instructorView([revision({ revision: '2', reason: 'x' })]) } }, /No se pudo verificar/],
		[{ [`GET ${draftPath}`]: { body: draft({ origin_subject_id: groupId }) }, [`GET ${practicalPath}`]: { body: instructorView() } }, /no está disponible/],
	];
	for (const [routes, copy] of cases) {
		const env = await environment(routes);
		const { handleCorrectPracticalEvaluation } = await env.importModule(actionPath);
		const result = plain(await handleCorrectPracticalEvaluation(correctInput(), { cookies: env.cookies(teacher()) }));
		assert.equal(result.success, false);
		assert.match(result.error, copy);
		assert.equal(writes(env.requests).length, 0);
	}
});

// P9: boundaries and success results (S2, S4).

test('P9 grading accepts all-zero and all-maximum items and returns the encounter context on success', async () => {
	const zeroEnv = await environment({ [`POST ${practicalPath}`]: { status: 201, body: revision({ items: zeros, total: 0, outcome: 'annulled' }) } });
	const { handleGradePracticalEvaluation } = await zeroEnv.importModule(actionPath);
	const zeroed = plain(await handleGradePracticalEvaluation({ id: draftId, ...context, ...scoreControls(zeros) }, { cookies: zeroEnv.cookies(teacher()) }));
	assert.deepEqual(zeroed, { success: true, id: draftId, ...context });

	const maxEnv = await environment({ [`POST ${practicalPath}`]: { status: 201, body: revision({ items: scores, total: 20, outcome: 'approved' }) } });
	const { handleGradePracticalEvaluation: grade } = await maxEnv.importModule(actionPath);
	const maximal = plain(await grade({ id: draftId, ...context, ...scoreControls(scores) }, { cookies: maxEnv.cookies(teacher()) }));
	assert.deepEqual(maximal, { success: true, id: draftId, ...context });
});

test('P9 correcting with a 4000-code-point reason succeeds and returns the encounter context', async () => {
	const reason = '🦷'.repeat(4000);
	const env = await environment({
		[`GET ${practicalPath}`]: { body: instructorView() },
		[`POST ${correctionsPath}`]: { status: 201, body: correctedRevision({ reason }) },
	});
	const { handleCorrectPracticalEvaluation } = await env.importModule(actionPath);
	const result = plain(await handleCorrectPracticalEvaluation(correctInput({ reason }), { cookies: env.cookies(teacher()) }));
	assert.deepEqual(result, { success: true, id: draftId, ...context });
	assert.equal(writes(env.requests).length, 1);
});

// P10: registration, labels and component (S5, S6).

test('P10 both actions are registered with strict form schemas and every score control', async () => {
	const source = await readFile(new URL('src/actions/index.ts', root), 'utf8');
	assert.match(source, /gradeOralSurgeryPracticalEvaluation: defineAction\(/);
	assert.match(source, /correctOralSurgeryPracticalEvaluation: defineAction\(/);
	assert.match(source, /handleGradePracticalEvaluation/);
	assert.match(source, /handleCorrectPracticalEvaluation/);
	assert.match(source, /PRACTICAL_EVALUATION_FORM_FIELDS\.map/);
	assert.match(source, /expected_revision: ID_INPUT/);
	const env = await environment();
	const { PRACTICAL_EVALUATION_FORM_FIELDS } = await env.importModule(actionPath);
	assert.deepEqual([...PRACTICAL_EVALUATION_FORM_FIELDS], KEYS);
});

test('P11 every rubric key has Spanish copy; outcome and summary labels read as the paper form', async () => {
	const env = await environment();
	const labels = await env.importModule(labelsPath);
	for (const { key } of env.api.PRACTICAL_RUBRIC) assert.ok(labels.PRACTICAL_LABELS[key], key);
	assert.equal(labels.practicalOutcomeLabel('approved'), 'Aprobado');
	assert.equal(labels.practicalOutcomeLabel('annulled'), 'Anulado');
	assert.equal(labels.practicalSummaryLabel(16, 'approved', 20), 'Total: 16/20 · Aprobado');
	assert.equal(labels.practicalSummaryLabel(14, 'annulled', 20), 'Total: 14/20 · Anulado');
});

test('P10 the read-only component compiles and renders labels, total, outcome, annulled note and history reasons', async () => {
	const source = await readFile(new URL(componentPath, root), 'utf8');
	const { createRequire } = await import('node:module');
	const { transform } = createRequire(import.meta.resolve('astro/package.json'))('@astrojs/compiler');
	const compiled = await transform(source, { filename: 'PracticalEvaluationReadOnly.astro' });
	assert.equal(compiled.diagnostics.filter((item) => item.severity === 1).length, 0);
	assert.match(source, /PRACTICAL_RUBRIC/);
	assert.match(source, /PRACTICAL_LABELS/);
	assert.match(source, /practicalSummaryLabel/);
	assert.match(source, /oralSurgeryTimestampLabel/);
	assert.match(source, /outcome === 'annulled'/);
	assert.match(source, /Práctico anulado: el registro clínico no cambia y el alumno repite el práctico en otro encuentro\./);
	assert.match(source, /history/);
	assert.match(source, /graded_by/);
	assert.match(source, /reason/);
});
