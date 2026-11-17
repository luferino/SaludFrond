import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/oral-surgery-draft/api.ts';
const actionPath = 'src/pods/oral-surgery-draft/actions/operative-report.ts';
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
const closePath = `${reportPath}/close`;
const draftUrl = `${apiBase}${draftPath}`;
const reportUrl = `${apiBase}${reportPath}`;
const assignmentUrl = `${apiBase}/patient-assignments/mine?limit=50&offset=0`;
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };

const reportContent = {
	narrative: 'Exodoncia sin complicaciones',
	asepsis: { extraoral: 'Clorhexidina', intraoral: null },
	anesthesia: {},
	extraction: { teeth: '38', technique: '' },
	postoperative_instructions: null,
};
const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const draft = (overrides = {}) => ({
	id: draftId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: { treatment_plan: { procedure: 'Exodoncia' } }, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const report = (overrides = {}) => ({
	draft_id: draftId, draft_version: '3', authorization_id: '11', content: reportContent, version: '2', status: 'draft',
	created_by: authorId, created_at: iso, updated_at: iso, closed_by: null, closed_at: null, teacher_habilitation_id: null, ...overrides,
});
const closed = (overrides = {}) => report({ version: '3', status: 'closed', closed_by: teacherId, closed_at: iso, teacher_habilitation_id: habilitationId, ...overrides });
const errorBody = (code, message) => ({ error: { code, message } });
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const plain = (value) => JSON.parse(JSON.stringify(value));
const notFound = { status: 404, body: errorBody('NOT_FOUND', 'oral surgery operative report was not found') };

/** Real pods run in one vm context; fetch is a route table and every request is recorded. */
async function environment(routes = {}) {
	const requests = [];
	const table = {
		'GET /patient-assignments/mine': ({ url }) => ({
			body: { items: [assignment()], limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) },
		}),
		[`GET ${draftPath}`]: { body: draft() },
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
const teacher = (permissions = ['oral-surgery-drafts:read', 'oral-surgery-drafts:close']) => ({ sub: teacherId, username: 'doc', role: 'teacher', permissions, exp: 4102444800, iat: 1 });

/** The controls a browser submits for an editor showing `content`; null and absent render as empty. */
function controlsFor(api, content, overrides = {}) {
	const controls = {};
	for (const { key, fields } of api.OPERATIVE_REPORT_LAYOUT) {
		if (fields === null) controls[key] = typeof content[key] === 'string' ? content[key] : '';
		else for (const field of fields) controls[`${key}.${field}`] = typeof content[key]?.[field] === 'string' ? content[key][field] : '';
	}
	return { ...controls, ...overrides };
}
const saveInput = (api, content, overrides = {}) => ({
	id: draftId, expected_draft_version: '3', expected_version: '2', assignment_id: '17', limit: '50', offset: '0', ...controlsFor(api, content), ...overrides,
});
const closeInput = (overrides = {}) => ({ id: draftId, ...context, expected_version: '2', expected_draft_version: '3', ready_confirmed: 'on', ...overrides });
const GET_ASSIGNMENT = { method: 'GET', url: assignmentUrl };
const GET_DRAFT = { method: 'GET', url: draftUrl };
const GET_REPORT = { method: 'GET', url: reportUrl };
const writes = (requests) => requests.filter((request) => request.method !== 'GET');

// R1: content validation and response shape (S2, S8).

test('R1 content validation keeps documented keys exactly, including empty sections, null and empty text', async () => {
	const { api } = await environment();
	assert.deepEqual(plain(api.validateOperativeReportContent(reportContent)), reportContent);
	assert.deepEqual(plain(api.validateOperativeReportContent({})), {});
	const full = {
		narrative: null, operative_incident: 'Ninguno', postoperative_instructions: 'Frío local',
		asepsis: { extraoral: 'a', intraoral: 'b' }, anesthesia: { technique: 't', drug: 'd', dose: '1' },
		extraction: { teeth: '18', technique: 'x', suture: 's' },
		prescription: { medications: 'm', commercial_name: 'c', route: 'oral', dose: '1', frequency: '8h', duration: '5d' },
	};
	assert.deepEqual(plain(api.validateOperativeReportContent(full)), full);
	assert.equal([...api.validateOperativeReportContent({ narrative: '🦷'.repeat(4000) }).narrative].length, 4000);
});

test('R1 content validation rejects unknown keys, non-object sections, other value types, NUL and over-long text', async () => {
	const { api } = await environment();
	for (const bad of [
		null, [], 'x', { grade: '10' }, { asepsis: 'x' }, { asepsis: null }, { asepsis: [] }, { asepsis: { other: 'x' } },
		{ narrative: 1 }, { narrative: true }, { narrative: {} }, { anesthesia: { dose: 2 } }, { narrative: 'a\u0000b' },
		{ prescription: { route: 'x'.repeat(4001) } }, { admission_date: '2026-11-16' },
	]) {
		assert.throws(() => api.validateOperativeReportContent(bad), Error, JSON.stringify(bad));
	}
});

test('R1 the report shape requires exactly the 12 contract keys and consistent closure fields', async () => {
	const { api } = await environment();
	assert.equal(api.isOperativeReport(report(), draftId), true);
	assert.equal(api.isOperativeReport(closed(), draftId), true);
	const broken = [
		report({ draft_id: '1' }), report({ status: 'open' }), report({ version: '0' }), report({ draft_version: 3 }),
		report({ authorization_id: 'x' }), report({ created_by: 'nobody' }), report({ updated_at: 'yesterday' }),
		report({ content: { grade: 'A' } }), report({ closed_by: teacherId }), report({ closed_at: iso }),
		closed({ closed_by: null }), closed({ closed_at: null }), closed({ teacher_habilitation_id: null }),
		{ ...report(), extra: true }, (() => { const value = report(); delete value.closed_at; return value; })(),
	];
	for (const value of broken) assert.equal(api.isOperativeReport(value, draftId), false, JSON.stringify(value));
});

// R2: API calls (S1, S4, S6, S8).

test('R2 reading the report returns it, or null for a 404 because the encounter has no report yet', async () => {
	let env = await environment({ [`GET ${reportPath}`]: { body: report() } });
	assert.deepEqual(plain(await env.api.getOperativeReport(draftId, env.cookies(student))), report());
	env = await environment({ [`GET ${reportPath}`]: notFound });
	assert.equal(await env.api.getOperativeReport(draftId, env.cookies(student)), null);
	env = await environment({ [`GET ${reportPath}`]: { body: report({ draft_id: '5' }) } });
	await assert.rejects(env.api.getOperativeReport(draftId, env.cookies(student)));
	env = await environment({ [`GET ${reportPath}`]: { status: 403, body: errorBody('FORBIDDEN', 'forbidden') } });
	await assert.rejects(env.api.getOperativeReport(draftId, env.cookies(student)), (error) => error.status === 403);
	await assert.rejects(env.api.getOperativeReport('0', env.cookies(student)));
	assert.equal(env.requests.length, 1);
});

test('R2 create posts expected_draft_version and content; update patches both versions; close posts both versions', async () => {
	const env = await environment({
		[`POST ${reportPath}`]: { status: 201, body: report({ version: '1' }) },
		[`PATCH ${reportPath}`]: { body: report({ version: '3' }) },
		[`POST ${closePath}`]: { body: closed({ version: '3' }) },
	});
	const cookies = env.cookies(student);
	await env.api.createOperativeReport(draftId, '3', reportContent, cookies);
	await env.api.updateOperativeReport(draftId, '2', '3', { narrative: null }, cookies);
	await env.api.closeOperativeReport(draftId, '2', '3', cookies);
	assert.deepEqual(plain(env.requests), [
		{ method: 'POST', url: reportUrl, body: { expected_draft_version: '3', content: reportContent } },
		{ method: 'PATCH', url: reportUrl, body: { expected_version: '2', expected_draft_version: '3', content: { narrative: null } } },
		{ method: 'POST', url: `${reportUrl}/close`, body: { expected_version: '2', expected_draft_version: '3' } },
	]);
});

test('R2 writes reject invalid ids or content before any request, and unconfirmed responses throw the confirmation error', async () => {
	let env = await environment();
	const cookies = env.cookies(student);
	await assert.rejects(env.api.createOperativeReport(draftId, '0', {}, cookies));
	await assert.rejects(env.api.createOperativeReport(draftId, '3', { grade: 'A' }, cookies));
	await assert.rejects(env.api.updateOperativeReport(draftId, 'x', '3', {}, cookies));
	await assert.rejects(env.api.closeOperativeReport('abc', '2', '3', cookies));
	assert.equal(env.requests.length, 0);
	for (const [method, path, call, body] of [
		['POST', reportPath, (api) => api.createOperativeReport(draftId, '3', {}, cookies), report({ draft_version: '2', version: '1' })],
		['POST', reportPath, (api) => api.createOperativeReport(draftId, '3', {}, cookies), closed({ version: '1' })],
		['PATCH', reportPath, (api) => api.updateOperativeReport(draftId, '2', '3', {}, cookies), report({ version: '2' })],
		['POST', closePath, (api) => api.closeOperativeReport(draftId, '2', '3', cookies), report({ version: '3' })],
		['POST', closePath, (api) => api.closeOperativeReport(draftId, '2', '3', cookies), closed({ version: '2' })],
	]) {
		env = await environment({ [`${method} ${path}`]: { body } });
		await assert.rejects(call(env.api), /no se pudo confirmar/i);
	}
});

test('R2 the administrator list sends only the given filters and validates every item', async () => {
	let env = await environment({ 'GET /oral-surgery-drafts': { body: { items: [draft(), draft({ id: '5', patient_id: teacherId })] } } });
	const items = await env.api.listAllOralSurgeryDrafts(env.cookies(student), { limit: 50, offset: 100 }, { date_from: '2026-11-01' });
	assert.equal(items.length, 2);
	assert.deepEqual(plain(env.requests), [{ method: 'GET', url: `${apiBase}/oral-surgery-drafts?limit=50&offset=100&date_from=2026-11-01` }]);
	await assert.rejects(env.api.listAllOralSurgeryDrafts(env.cookies(student), { limit: 0, offset: 0 }));
	await assert.rejects(env.api.listAllOralSurgeryDrafts(env.cookies(student), { limit: 50, offset: 0 }, { date_from: '2026-11-31' }));
	assert.equal(env.requests.length, 1);
	env = await environment({ 'GET /oral-surgery-drafts': { body: { items: [{ ...draft(), status: 'closed' }] } } });
	await assert.rejects(env.api.listAllOralSurgeryDrafts(env.cookies(student), { limit: 50, offset: 0 }));
});

// R3: form conversion (S1, S2).

test('R3 untouched controls reproduce stored content exactly; cleared answers become null; absent sections stay absent until answered', async () => {
	const env = await environment();
	const { operativeReportContentFromForm, operativeReportFormValues } = await env.importModule(actionPath);
	assert.deepEqual(plain(operativeReportContentFromForm(operativeReportFormValues(reportContent), reportContent)), reportContent);
	const edited = operativeReportContentFromForm({
		...operativeReportFormValues(reportContent), narrative: '', 'extraction.teeth': '38 y 48', 'prescription.route': 'oral',
	}, reportContent);
	assert.deepEqual(plain(edited), {
		narrative: null, asepsis: { extraoral: 'Clorhexidina', intraoral: null }, anesthesia: {},
		extraction: { teeth: '38 y 48', technique: '' }, prescription: { route: 'oral' }, postoperative_instructions: null,
	});
	assert.deepEqual(plain(operativeReportContentFromForm(operativeReportFormValues({}), {})), {});
	const crlf = { narrative: 'línea 1\nlínea 2' };
	assert.deepEqual(plain(operativeReportContentFromForm({ ...operativeReportFormValues(crlf), narrative: 'línea 1\r\nlínea 2' }, crlf)), crlf);
});

// R4: student save handler (S1, S3).

test('R4 a first save reads assignment, draft and report, then sends exactly one POST with expected_draft_version', async () => {
	const env = await environment({
		[`GET ${reportPath}`]: notFound,
		[`POST ${reportPath}`]: ({ body }) => ({ status: 201, body: report({ version: '1', content: body.content }) }),
	});
	const { handleSaveOperativeReport } = await env.importModule(actionPath);
	const input = saveInput(env.api, {}, { expected_version: undefined, narrative: 'Relato', 'asepsis.extraoral': 'Iodopovidona' });
	const result = plain(await handleSaveOperativeReport(input, { cookies: env.cookies(student) }));
	assert.equal(result.success, true);
	assert.deepEqual(result.report.content, { narrative: 'Relato', asepsis: { extraoral: 'Iodopovidona' } });
	assert.deepEqual([result.id, result.assignment_id, result.limit, result.offset], [draftId, '17', '50', '0']);
	assert.deepEqual(plain(env.requests), [GET_ASSIGNMENT, GET_DRAFT, GET_REPORT,
		{ method: 'POST', url: reportUrl, body: { expected_draft_version: '3', content: { narrative: 'Relato', asepsis: { extraoral: 'Iodopovidona' } } } }]);
});

test('R4 an incomplete edit sends one PATCH with both versions and the whole replacement content', async () => {
	const env = await environment({
		[`GET ${reportPath}`]: { body: report() },
		[`PATCH ${reportPath}`]: ({ body }) => ({ body: report({ version: '3', content: body.content }) }),
	});
	const { handleSaveOperativeReport } = await env.importModule(actionPath);
	const result = plain(await handleSaveOperativeReport(saveInput(env.api, reportContent, { operative_incident: 'Ninguno' }), { cookies: env.cookies(student) }));
	assert.equal(result.success, true);
	assert.deepEqual(writes(env.requests), [{ method: 'PATCH', url: reportUrl, body: {
		expected_version: '2', expected_draft_version: '3', content: { ...reportContent, operative_incident: 'Ninguno' },
	} }]);
});

test('R4 stale clinical or report versions, an existing report on create and a closed report are conflicts with no write', async () => {
	const cases = [
		[{ [`GET ${draftPath}`]: { body: draft({ version: '4' }) } }, {}, /borrador clínico cambió/, [GET_ASSIGNMENT, GET_DRAFT]],
		[{ [`GET ${reportPath}`]: { body: report({ version: '5' }) } }, {}, /cambió o ya fue cerrado/, [GET_ASSIGNMENT, GET_DRAFT, GET_REPORT]],
		[{ [`GET ${reportPath}`]: { body: closed({ version: '2' }) } }, {}, /cambió o ya fue cerrado/, [GET_ASSIGNMENT, GET_DRAFT, GET_REPORT]],
		[{ [`GET ${reportPath}`]: notFound }, {}, /cambió o ya fue cerrado/, [GET_ASSIGNMENT, GET_DRAFT, GET_REPORT]],
		[{ [`GET ${reportPath}`]: { body: report() } }, { expected_version: undefined }, /Ya existe un parte/, [GET_ASSIGNMENT, GET_DRAFT, GET_REPORT]],
	];
	for (const [routes, overrides, message, requests] of cases) {
		const env = await environment(routes);
		const { handleSaveOperativeReport } = await env.importModule(actionPath);
		const input = saveInput(env.api, reportContent, { narrative: 'Nuevo relato', ...overrides });
		const result = plain(await handleSaveOperativeReport(input, { cookies: env.cookies(student) }));
		assert.equal(result.success, false);
		assert.equal(result.conflict, true);
		assert.match(result.error, message);
		assert.equal(result.values.narrative, 'Nuevo relato');
		assert.deepEqual(plain(env.requests), requests);
	}
});

test('R4 invalid ids, unknown controls, inactive assignment or foreign draft stop before any write', async () => {
	const env = await environment({ [`GET ${reportPath}`]: { body: report() } });
	const { handleSaveOperativeReport } = await env.importModule(actionPath);
	const cookies = env.cookies(student);
	for (const overrides of [{ id: 'x' }, { expected_draft_version: '0' }, { expected_version: 'v2' }, { grade: '10' }, { 'asepsis.other': 'x' }]) {
		const result = await handleSaveOperativeReport(saveInput(env.api, reportContent, overrides), { cookies });
		assert.equal(result.success, false);
	}
	assert.equal(env.requests.length, 0);
	const tooLong = await handleSaveOperativeReport(saveInput(env.api, reportContent, { narrative: 'x'.repeat(4001) }), { cookies });
	assert.equal(tooLong.success, false);
	assert.equal(writes(env.requests).length, 0);
	for (const routes of [
		{ 'GET /patient-assignments/mine': { body: { items: [assignment({ id: '18' })], limit: 50, offset: 0 } } },
		{ [`GET ${draftPath}`]: { body: draft({ origin_group_id: subjectId }) } },
	]) {
		const other = await environment({ [`GET ${reportPath}`]: { body: report() }, ...routes });
		const { handleSaveOperativeReport: save } = await other.importModule(actionPath);
		const result = await save(saveInput(other.api, reportContent), { cookies: other.cookies(student) });
		assert.equal(result.success, false);
		assert.equal(writes(other.requests).length, 0);
	}
});

test('R4 each backend 409 message maps to its own copy after exactly one write; 404 and 403 are safe copy', async () => {
	const cases = [
		[409, 'draft version changed; reload before saving', /borrador clínico cambió/, true],
		[409, 'operative report changed or is closed; reload before saving', /cambió o ya fue cerrado/, true],
		[409, 'operative report already exists; reload before saving', /Ya existe un parte/, true],
		[409, 'current instructor authorization is required', /autorización docente vigente/, false],
		[404, 'oral surgery draft was not found', /no está disponible/, false],
		[403, 'forbidden', /No tenés permiso/, false],
		[400, 'invalid content', /Revisá los datos del parte/, false],
	];
	for (const [status, message, copy, conflict] of cases) {
		const env = await environment({
			[`GET ${reportPath}`]: { body: report() },
			[`PATCH ${reportPath}`]: { status, body: errorBody('E', message) },
		});
		const { handleSaveOperativeReport } = await env.importModule(actionPath);
		const result = plain(await handleSaveOperativeReport(saveInput(env.api, reportContent, { narrative: 'x' }), { cookies: env.cookies(student) }));
		assert.equal(result.success, false);
		assert.match(result.error, copy, message);
		assert.equal(result.conflict, conflict, message);
		assert.equal(result.uncertain, false);
		assert.equal(result.values.narrative, 'x');
		assert.equal(writes(env.requests).length, 1);
	}
});

test('R4 network failure, 5xx or an unconfirmed response is uncertain and never retried', async () => {
	for (const response of [{ network: true }, { status: 502, body: {} }, { status: 201, body: report({ version: '1', draft_version: '2' }) }]) {
		const env = await environment({ [`GET ${reportPath}`]: notFound, [`POST ${reportPath}`]: response });
		const { handleSaveOperativeReport } = await env.importModule(actionPath);
		const result = await handleSaveOperativeReport(saveInput(env.api, {}, { expected_version: undefined, narrative: 'x' }), { cookies: env.cookies(student) });
		assert.equal(result.success, false);
		assert.equal(result.uncertain, true);
		assert.match(result.error, /No se pudo confirmar el guardado del parte/);
		assert.equal(writes(env.requests).length, 1);
	}
});

// R5: teacher close handler (S4).

test('R5 closing re-reads draft and report under the origin guard, then sends exactly one POST with both versions', async () => {
	const env = await environment({ [`GET ${reportPath}`]: { body: report() }, [`POST ${closePath}`]: { body: closed() } });
	const { handleCloseOperativeReport } = await env.importModule(actionPath);
	const result = plain(await handleCloseOperativeReport(closeInput(), { cookies: env.cookies(teacher()) }));
	assert.deepEqual(result, { success: true, id: draftId, ...context });
	assert.deepEqual(plain(env.requests), [GET_DRAFT, GET_REPORT, { method: 'POST', url: `${reportUrl}/close`, body: { expected_version: '2', expected_draft_version: '3' } }]);
});

test('R5 no close grant, wrong fields, missing confirmation or invalid context send no request', async () => {
	const env = await environment();
	const { handleCloseOperativeReport } = await env.importModule(actionPath);
	const cases = [
		[closeInput(), teacher(['oral-surgery-drafts:read'])],
		[closeInput(), { ...student, permissions: ['oral-surgery-drafts:close'] }],
		[{ ...closeInput(), extra: 'x' }, teacher()],
		[(() => { const input = closeInput(); delete input.ready_confirmed; return input; })(), teacher()],
		[closeInput({ ready_confirmed: 'off' }), teacher()],
		[closeInput({ expected_draft_version: '0' }), teacher()],
		[closeInput({ subject_id: 'x' }), teacher()],
	];
	for (const [input, actor] of cases) {
		const result = await handleCloseOperativeReport(input, { cookies: env.cookies(actor) });
		assert.equal(result.success, false);
	}
	assert.equal(env.requests.length, 0);
});

test('R5 a foreign context, stale versions, a closed or missing report, or a report saved against another clinical version stop before the POST', async () => {
	const cases = [
		[{ [`GET ${draftPath}`]: { body: draft({ patient_id: teacherId }) } }, /no está disponible en este contexto/],
		[{ [`GET ${draftPath}`]: { body: draft({ version: '4' }) } }, /borrador clínico cambió/],
		[{ [`GET ${reportPath}`]: { body: report({ version: '5' }) } }, /parte cambió/],
		[{ [`GET ${reportPath}`]: { body: closed({ version: '2' }) } }, /ya está cerrado/],
		[{ [`GET ${reportPath}`]: notFound }, /No hay un parte quirúrgico/],
		[{ [`GET ${reportPath}`]: { body: report({ draft_version: '2' }) } }, /otra versión clínica/],
	];
	for (const [routes, message] of cases) {
		const env = await environment({ [`GET ${reportPath}`]: { body: report() }, ...routes });
		const { handleCloseOperativeReport } = await env.importModule(actionPath);
		const result = await handleCloseOperativeReport(closeInput(), { cookies: env.cookies(teacher()) });
		assert.equal(result.success, false);
		assert.match(result.error, message);
		assert.equal(writes(env.requests).length, 0);
	}
});

test('R5 backend rejections after the POST map to safe copy; unknown outcomes are uncertain and never retried', async () => {
	const cases = [
		[{ status: 409, body: errorBody('E', 'operative report does not match current clinical version; save it before closing') }, /otra versión clínica/, false],
		[{ status: 409, body: errorBody('E', 'draft version changed; reload before saving') }, /borrador clínico cambió/, false],
		[{ status: 409, body: errorBody('E', 'operative report changed or is closed; reload before saving') }, /parte cambió o ya fue cerrado/, false],
		[{ status: 404, body: errorBody('E', 'oral surgery operative report was not found') }, /^No hay un parte quirúrgico para cerrar en este encuentro\.$/, false],
		[{ status: 404, body: errorBody('E', 'oral surgery draft was not found') }, /^El parte quirúrgico no está disponible en este contexto de origen\.$/, false],
		[{ status: 403, body: errorBody('E', 'teacher instructor role required') }, /docente instructor/, false],
		[{ network: true }, /No se pudo confirmar el cierre/, true],
		[{ status: 500, body: {} }, /No se pudo confirmar el cierre/, true],
		[{ body: report({ version: '3' }) }, /No se pudo confirmar el cierre/, true],
	];
	for (const [response, message, uncertain] of cases) {
		const env = await environment({ [`GET ${reportPath}`]: { body: report() }, [`POST ${closePath}`]: response });
		const { handleCloseOperativeReport } = await env.importModule(actionPath);
		const result = await handleCloseOperativeReport(closeInput(), { cookies: env.cookies(teacher()) });
		assert.equal(result.success, false);
		assert.match(result.error, message);
		assert.equal(result.uncertain, uncertain);
		assert.equal(writes(env.requests).length, 1);
	}
});

test('R6 actions are registered with strict form schemas for every report control', async () => {
	const source = await readFile(new URL('src/actions/index.ts', root), 'utf8');
	assert.match(source, /saveOralSurgeryOperativeReport: defineAction\(/);
	assert.match(source, /closeOralSurgeryOperativeReport: defineAction\(/);
	assert.match(source, /OPERATIVE_REPORT_FORM_FIELDS\.map/);
	assert.match(source, /ready_confirmed: z\.literal\('on'\)/);
	const env = await environment();
	const { OPERATIVE_REPORT_FORM_FIELDS } = await env.importModule(actionPath);
	assert.deepEqual([...OPERATIVE_REPORT_FORM_FIELDS], [
		'narrative', 'asepsis.extraoral', 'asepsis.intraoral', 'anesthesia.technique', 'anesthesia.drug', 'anesthesia.dose',
		'extraction.teeth', 'extraction.technique', 'extraction.suture', 'prescription.medications', 'prescription.commercial_name',
		'prescription.route', 'prescription.dose', 'prescription.frequency', 'prescription.duration', 'postoperative_instructions', 'operative_incident',
	]);
});

test('R7 every report control and section has a Spanish label, and the read-only component compiles', async () => {
	const env = await environment();
	const { OPERATIVE_REPORT_LABELS, operativeReportStatusLabel } = await env.importModule('src/pods/oral-surgery-draft/labels.ts');
	const { OPERATIVE_REPORT_FORM_FIELDS } = await env.importModule(actionPath);
	for (const name of [...OPERATIVE_REPORT_FORM_FIELDS, 'asepsis', 'anesthesia', 'extraction', 'prescription']) assert.ok(OPERATIVE_REPORT_LABELS[name], name);
	assert.match(operativeReportStatusLabel('closed'), /Cerrado/);
	assert.match(operativeReportStatusLabel('draft'), /pendiente de cierre/);
	const { createRequire } = await import('node:module');
	const { transform } = createRequire(import.meta.resolve('astro/package.json'))('@astrojs/compiler');
	const source = await readFile(new URL('src/components/clinical/OperativeReportReadOnly.astro', root), 'utf8');
	const compiled = await transform(source, { filename: 'OperativeReportReadOnly.astro' });
	assert.equal(compiled.diagnostics.filter((item) => item.severity === 1).length, 0);
});

test('R8 a closed encounter rejection of draft save, paper consent or authorization maps to closed copy after exactly one write', async () => {
	const closedError = { status: 409, body: errorBody('CONFLICT', 'closed oral surgery encounter is immutable') };
	const env = await environment({
		[`PATCH ${draftPath}`]: closedError,
		[`POST ${draftPath}/consent`]: closedError,
		[`POST ${draftPath}/authorizations`]: closedError,
	});
	const drafts = await env.importModule('src/pods/oral-surgery-draft/actions/drafts.ts');
	const authorizations = await env.importModule('src/pods/oral-surgery-draft/actions/authorizations.ts');
	const base = { id: draftId, expected_version: '3', assignment_id: '17', limit: '50', offset: '0' };
	const saved = plain(await drafts.handleUpdateOralSurgeryDraft({ ...base, 'treatment_plan.procedure': 'Exodoncia' }, { cookies: env.cookies(student) }));
	assert.equal(saved.success, false);
	assert.equal(saved.conflict, true);
	assert.equal(saved.uncertain, false);
	assert.match(saved.error, /encuentro quirúrgico ya fue cerrado/);
	assert.equal(saved.values['treatment_plan.procedure'], 'Exodoncia');
	const declared = plain(await drafts.handleDeclareOralSurgeryConsent({ ...base, paper_signed: 'on' }, { cookies: env.cookies(student) }));
	assert.deepEqual([declared.success, declared.uncertain], [false, false]);
	assert.match(declared.error, /encuentro quirúrgico ya fue cerrado/);
	const authorized = plain(await authorizations.handleAuthorizeOralSurgeryDraft({
		id: draftId, ...context, expected_version: '3', consent_declaration_id: '7', paper_consent_verified: 'on',
	}, { cookies: env.cookies(teacher(['oral-surgery-drafts:read', 'oral-surgery-drafts:authorize'])) }));
	assert.deepEqual([authorized.success, authorized.uncertain], [false, false]);
	assert.match(authorized.error, /encuentro quirúrgico ya fue cerrado/);
	assert.equal(writes(env.requests).length, 3);
});
