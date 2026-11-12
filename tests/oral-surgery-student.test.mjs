import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const apiPath = 'src/pods/oral-surgery-draft/api.ts';
const draftsPath = 'src/pods/oral-surgery-draft/actions/drafts.ts';
const pagePath = 'src/pages/oral-surgery-drafts/[id].astro';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const draftPath = `/oral-surgery-drafts/${largeId}`;
const draftUrl = `${apiBase}${draftPath}`;
const assignmentUrl = `${apiBase}/patient-assignments/mine?limit=50&offset=0`;
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };

const stored = {
	admission_date: '2026-11-06',
	medical_history: { hospitalized: false, taking_medication: null, consultation_reason: 'Dolor en pieza 38', medication: '' },
	complementary_tests: { panoramic_radiographs: true, blood_group: 'O+' },
	extraoral_exam: { facial_symmetry: true, skin: '' },
	intraoral_exam: {},
	preoperative: { vital: true, tooth: '38', cc_rr: null },
	treatment_plan: { procedure: 'Exodoncia simple', anomalies_or_pathology: null },
};
const minimal = { medical_history: { hospitalized: null }, treatment_plan: { procedure: 'Exodoncia' } };

const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: stored, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const declaration = (overrides = {}) => ({
	id: '7', draft_id: largeId, draft_version: '3', plan_revision: '2', treatment_plan: stored.treatment_plan,
	declared_by: authorId, declared_at: iso, ...overrides,
});
const consentNone = { draft_version: '3', plan_revision: '2', current_declaration_id: null, declarations: [] };
const authNone = { draft_version: '3', current_authorization_id: null, authorizations: [] };
const errorBody = (code, message) => ({ error: { code, message } });
const student = (overrides = {}) => ({
	sub: authorId, username: 'ana', role: 'estudiante', permissions: ['oral-surgery-drafts:read', 'oral-surgery-drafts:write'],
	exp: 4102444800, iat: 1, ...overrides,
});
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const plain = (value) => JSON.parse(JSON.stringify(value));
const answerText = (value) => (value === true ? 'true' : value === false ? 'false' : '');
const patchEcho = ({ body }) => ({ body: draft({ version: String(BigInt(body.expected_version) + 1n), content: body.content }) });
const readDraft = (content = stored, version = '3') => ({ body: draft({ content, version }) });
const baseRoutes = (overrides = {}) => ({
	[`GET ${draftPath}`]: { body: draft() },
	[`GET ${draftPath}/consent`]: { body: consentNone },
	[`GET ${draftPath}/authorizations`]: { body: authNone },
	...overrides,
});

/** Real pods and page frontmatter run in one vm context; fetch and cookies are isolated and every request is recorded. */
async function environment(routes = {}) {
	const requests = [];
	const table = {
		'GET /patient-assignments/mine': ({ url }) => ({
			body: { items: [assignment()], limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) },
		}),
		...routes,
	};
	const cookies = { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} };
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
	const evaluated = new Map();
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
		const href = new URL(path, root).href;
		const mod = await load(href);
		if (!evaluated.has(href)) evaluated.set(href, mod.evaluate());
		await evaluated.get(href);
		return mod.namespace;
	}
	const actionStubs = Object.fromEntries(['updateOralSurgeryDraft', 'declareOralSurgeryConsent', 'createOralSurgeryDraft']
		.map((name) => [name, Object.assign(() => undefined, { toString: () => `/_actions/${name}` })]));

	async function renderPage(path, { url = `${draftPath}?assignment_id=17&limit=50&offset=0`, id = largeId, results = {}, actor = student() } = {}) {
		const token = jwt(actor);
		sandbox.Astro = {
			params: { id },
			url: new URL(url, 'http://localhost'),
			cookies: { get: (name) => (name === 'session' ? { value: token } : undefined), set() {}, delete() {} },
			getActionResult: (action) => results[String(action).replace('/_actions/', '')],
			redirect: (location) => ({ redirect: location }),
		};
		sandbox.__import = async (specifier) => {
			if (specifier === 'astro:actions') return { actions: actionStubs, isInputError: (error) => error?.inputError === true };
			return importModule(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, new URL(path, root)).href);
		};
		const source = await readFile(new URL(path, root), 'utf8');
		const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
		const declarations = frontmatter
			.replace(/^export const prerender = false;\s*$/m, '')
			.replace(/^import type .*;\s*$/gm, '')
			.replace(/^import \w+ from '[^']+\.astro';\s*$/gm, '')
			.replace(/^import (\{[^}]*\}) from '([^']+)';\s*$/gm, (_, names, specifier) => `const ${names.replace(/\s+as\s+/g, ': ')} = await __import('${specifier}');`);
		const state = ['unavailable', 'loadError', 'eligible', 'editHint', 'draft', 'formValues', 'formVersion', 'unsaved', 'saveError',
			'canDeclare', 'declareError', 'consent', 'consentError', 'authorizationStatus', 'authorizationError', 'saved', 'declared', 'limit', 'offset', 'saveHref', 'declareHref'];
		const script = `async function renderPage() {${declarations}\nreturn { ${state.join(', ')} };\n}`;
		const output = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
		vm.runInContext(output, sandbox);
		return plain(await sandbox.renderPage());
	}

	const api = await importModule(apiPath);
	return { requests, cookies, importModule, renderPage, api };
}

/** The form a browser submits for an editor showing `content`: one value per control, rendered the way the page renders it. */
function controlsFor(env, content, overrides = {}) {
	const controls = { admission_date: content.admission_date ?? '' };
	for (const [section, { booleans, texts }] of Object.entries(env.api.ORAL_SURGERY_SECTIONS)) {
		for (const field of booleans) controls[`${section}.${field}`] = answerText(content[section]?.[field]);
		for (const field of texts) controls[`${section}.${field}`] = typeof content[section]?.[field] === 'string' ? content[section][field] : '';
	}
	return { ...controls, ...overrides };
}
function saveInput(env, content, overrides = {}) {
	return { id: largeId, expected_version: '3', assignment_id: '17', limit: '50', offset: '0', ...controlsFor(env, content), ...overrides };
}
const methodsOf = (requests) => requests.map((request) => request.method);
const patches = (requests) => requests.filter((request) => request.method === 'PATCH');
const GET_ASSIGNMENT = { method: 'GET', url: assignmentUrl };
const GET_DRAFT = { method: 'GET', url: draftUrl };
const CONFLICT_RE = /versión más nueva/;
const DECLARE_CONFLICT_RE = /cambió desde que lo abriste/;
const SAVE_UNCERTAIN_RE = /No se pudo confirmar el guardado/;
const DECLARE_UNCERTAIN_RE = /No se pudo confirmar la declaración/;
const CREATE_UNCERTAIN_RE = /Revisá la lista de borradores/;

// D1 and D2: page rules through the evaluated frontmatter.

test('D1 the editor is unavailable when the assignment is no longer active, without reading the draft', async () => {
	const env = await environment(baseRoutes({ 'GET /patient-assignments/mine': { body: { items: [], limit: 50, offset: 0 } } }));
	const page = await env.renderPage(pagePath);
	assert.deepEqual(plain(env.requests), [GET_ASSIGNMENT]);
	assert.equal(page.unavailable, true);
	assert.equal(page.draft, null);
	assert.equal(page.consent, null);
});

test('D1 any context mismatch between the draft and the assignment renders unavailable and skips consent and authorization reads', async () => {
	for (const field of ['patient_id', 'origin_subject_id', 'origin_group_id']) {
		const env = await environment(baseRoutes({ [`GET ${draftPath}`]: { body: draft({ [field]: authorId }) } }));
		const page = await env.renderPage(pagePath);
		assert.deepEqual(plain(env.requests), [GET_ASSIGNMENT, GET_DRAFT], field);
		assert.equal(page.unavailable, true, field);
		assert.equal(page.draft, null, field);
		assert.equal(page.formValues, undefined, field);
	}
});

test('D1 a 404 for the draft and malformed route ids render unavailable; malformed ids send no request', async () => {
	const missing = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 404, body: errorBody('NOT_FOUND', 'oral surgery draft was not found') } }));
	const notFound = await missing.renderPage(pagePath);
	assert.equal(notFound.unavailable, true);
	assert.deepEqual(plain(missing.requests), [GET_ASSIGNMENT, GET_DRAFT]);
	const malformed = await environment(baseRoutes());
	const badAssignment = await malformed.renderPage(pagePath, { url: '/oral-surgery-drafts/x?assignment_id=abc&limit=50&offset=0' });
	const badDraft = await malformed.renderPage(pagePath, { id: '0' });
	assert.equal(badAssignment.unavailable, true);
	assert.equal(badDraft.unavailable, true);
	assert.deepEqual(plain(malformed.requests), []);
});

test('D1 editable hint is shown only to the author with student role and write permission; reads follow a verified draft', async () => {
	const env = await environment(baseRoutes());
	const editable = await env.renderPage(pagePath);
	assert.equal(editable.eligible, true);
	assert.match(editable.editHint, /Podés editar este borrador/);
	assert.deepEqual(plain(env.requests), [GET_ASSIGNMENT, GET_DRAFT, { method: 'GET', url: `${draftUrl}/consent` }, { method: 'GET', url: `${draftUrl}/authorizations` }]);
	const cases = [
		{ actor: student({ role: 'teacher' }) },
		{ actor: student({ permissions: ['oral-surgery-drafts:read'] }) },
		{ actor: student({ sub: patientId }) },
	];
	for (const { actor } of cases) {
		const other = await environment(baseRoutes());
		const page = await other.renderPage(pagePath, { actor });
		assert.equal(page.eligible, false);
		assert.match(page.editHint, /solo lectura/);
	}
});

test('D2 the editor renders every contract control with stored answers as browser-equivalent values and the hidden context fields', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath);
	const expected = controlsFor(env, stored);
	assert.equal(Object.keys(page.formValues).length, 71);
	assert.deepEqual(page.formValues, expected);
	assert.equal(page.formValues['medical_history.hospitalized'], 'false');
	assert.equal(page.formValues['medical_history.taking_medication'], '');
	assert.equal(page.formValues['admission_date'], '2026-11-06');
	assert.equal(page.formVersion, '3');
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /<input type="hidden" name="expected_version" value=\{formVersion\} \/>/);
	assert.match(source, /<input type="hidden" name="id" value=\{draft\.id\} \/>/);
	assert.match(source, /name="admission_date" type="date"/);
	assert.match(source, /Sin responder/);
	assert.match(source, /<option value="true"[^>]*>Sí<\/option>/);
	assert.match(source, /<option value="false"[^>]*>No<\/option>/);
});

test('D4 save and declare forms post with the assignment context so a failed result re-renders the editor, not the unavailable page', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath, { url: `${draftPath}?assignment_id=17&limit=20&offset=40` });
	assert.equal(page.saveHref, '/_actions/updateOralSurgeryDraft?assignment_id=17&list_limit=20&list_offset=40');
	assert.equal(page.declareHref, '/_actions/declareOralSurgeryConsent?assignment_id=17&list_limit=20&list_offset=40');
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /<form method="POST" action={saveHref} id="draft-form">/);
	assert.match(source, /<form method="POST" action={declareHref} id="declare-form">/);
	const conflict = await env.renderPage(pagePath, { url: `${draftPath}?_action=updateOralSurgeryDraft&assignment_id=17&limit=20&offset=40`, results: { updateOralSurgeryDraft: { data: { success: false, uncertain: false, conflict: true, error: 'conflict copy', expected_version: '2', values: { 'treatment_plan.procedure': 'Nuevo plan' } } } } });
	assert.equal(conflict.unavailable, false);
	assert.equal(conflict.saveError, 'conflict copy');
	assert.equal(conflict.formVersion, '3');
});

// D3: save action (one PATCH, exact replacement, conflict before PATCH).

test('D3 direct save and declaration handlers reject missing legacy pagination before requests or writes', async () => {
	const env = await environment(baseRoutes());
	const pod = await env.importModule(draftsPath);
	const save = { ...saveInput(env, stored), limit: undefined, offset: undefined, list_limit: '7', list_offset: '14' };
	const saved = plain(await pod.handleUpdateOralSurgeryDraft(save, { cookies: env.cookies }));
	assert.equal(saved.success, false);
	assert.deepEqual(plain(env.requests), []);
	const declarationInput = { id: largeId, expected_version: '3', assignment_id: '17', paper_signed: 'on', list_limit: '7', list_offset: '14' };
	const declared = plain(await pod.handleDeclareOralSurgeryConsent(declarationInput, { cookies: env.cookies }));
	assert.equal(declared.success, false);
	assert.deepEqual(plain(env.requests), []);
});

test('D3 untouched saves reproduce stored content exactly, keeping absent, null and empty answers as stored', async () => {
	for (const content of [stored, minimal]) {
		const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(content), [`PATCH ${draftPath}`]: patchEcho }));
		const pod = await env.importModule(draftsPath);
		const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, content), { cookies: env.cookies }));
		assert.deepEqual(plain(env.requests), [
			GET_ASSIGNMENT,
			GET_DRAFT,
			{ method: 'PATCH', url: draftUrl, body: { expected_version: '3', content } },
		]);
		assert.equal(result.success, true);
		assert.deepEqual(result.draft.content, content);
		assert.equal(result.draft.version, '4');
	}
});

/** What a browser submits for a textarea rendered with `text`: the parser drops one leading LF, submission normalizes newlines to CRLF. */
function browserTextarea(text) {
	return text.replace(/^\n/, '').replace(/\r\n|\r|\n/g, '\r\n');
}

test('D3 untouched saves keep stored text with line breaks exactly after the browser round trip of the textarea', async () => {
	const content = { treatment_plan: { procedure: '\nExodoncia 38\nControl a 7 dias', anomalies_or_pathology: 'Linea 1\r\nLinea 2' }, intraoral_exam: { lips: 'Sin lesiones\n' } };
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(content), [`PATCH ${draftPath}`]: patchEcho }));
	const pod = await env.importModule(draftsPath);
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /<textarea name=\{`\$\{section\}\.\$\{field\}`\}>\{oralSurgeryTextareaText\(fields\[`\$\{section\}\.\$\{field\}`\]\)\}<\/textarea>/);
	const rendered = controlsFor(env, content);
	const submitted = Object.fromEntries(Object.entries(rendered).map(([name, value]) => [name, name.includes('.') && pod.ORAL_SURGERY_FORM_CONTROLS.get(name).kind === 'text' ? browserTextarea(pod.oralSurgeryTextareaText(value)) : value]));
	const result = plain(await pod.handleUpdateOralSurgeryDraft({ ...saveInput(env, content), ...submitted }, { cookies: env.cookies }));
	assert.equal(result.success, true);
	assert.deepEqual(plain(env.requests.at(-1).body), { expected_version: '3', content });
	const edited = plain(await pod.handleUpdateOralSurgeryDraft({ ...saveInput(env, content), ...submitted, 'treatment_plan.procedure': 'Exodoncia 38\r\nControl a 10 dias' }, { cookies: env.cookies }));
	assert.equal(edited.success, true);
	assert.equal(env.requests.at(-1).body.content.treatment_plan.procedure, 'Exodoncia 38\r\nControl a 10 dias');
});

test('D3 cleared answers become null, typed answers replace stored ones, and unrelated stored answers keep their form', async () => {
	const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: patchEcho }));
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, {
		admission_date: '',
		'medical_history.hospitalized': '',
		'medical_history.consultation_reason': '',
		'complementary_tests.blood_group': 'A-',
		'preoperative.vital': 'false',
	}), { cookies: env.cookies }));
	assert.equal(result.success, true);
	assert.equal(patches(env.requests).length, 1);
	assert.deepEqual(patches(env.requests)[0].body.content, {
		admission_date: null,
		medical_history: { hospitalized: null, taking_medication: null, consultation_reason: null, medication: '' },
		complementary_tests: { panoramic_radiographs: true, blood_group: 'A-' },
		extraoral_exam: { facial_symmetry: true, skin: '' },
		intraoral_exam: {},
		preoperative: { vital: false, tooth: '38', cc_rr: null },
		treatment_plan: { procedure: 'Exodoncia simple', anomalies_or_pathology: null },
	});
});

test('D3 an absent section stays absent until it gains an answer, and only answered fields are added', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(minimal), [`PATCH ${draftPath}`]: patchEcho }));
	const pod = await env.importModule(draftsPath);
	await pod.handleUpdateOralSurgeryDraft(saveInput(env, minimal, { 'complementary_tests.laboratory': 'true' }), { cookies: env.cookies });
	assert.deepEqual(patches(env.requests)[0].body.content, {
		medical_history: { hospitalized: null },
		treatment_plan: { procedure: 'Exodoncia' },
		complementary_tests: { laboratory: true },
	});
});

test('D3 a stale expected_version returns the conflict result with the submitted values and sends no PATCH', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(stored, '4'), [`PATCH ${draftPath}`]: patchEcho }));
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, { 'medical_history.consultation_reason': 'Nuevo motivo' }), { cookies: env.cookies }));
	assert.deepEqual(plain(env.requests), [GET_ASSIGNMENT, GET_DRAFT]);
	assert.equal(result.success, false);
	assert.equal(result.conflict, true);
	assert.equal(result.uncertain, false);
	assert.match(result.error, CONFLICT_RE);
	assert.equal(result.expected_version, '3');
	assert.equal(Object.keys(result.values).length, 71);
	assert.equal(result.values['medical_history.consultation_reason'], 'Nuevo motivo');
});

test('D3 rejected input sends no PATCH: unknown or invalid controls stop before any read, invalid content stops after the draft read', async () => {
	const cases = [
		{ name: 'unknown control', overrides: { 'medical_history.unknown': 'x' }, requests: [] },
		{ name: 'invalid yes/no answer', overrides: { 'medical_history.hospitalized': 'yes' }, requests: [] },
		{ name: 'text over 4000 code points', overrides: { 'medical_history.consultation_reason': 'x'.repeat(4001) }, requests: [GET_ASSIGNMENT, GET_DRAFT] },
		{ name: 'NUL in text', overrides: { 'treatment_plan.procedure': 'a\u0000b' }, requests: [GET_ASSIGNMENT, GET_DRAFT] },
		{ name: 'impossible admission date', overrides: { admission_date: '2026-02-30' }, requests: [GET_ASSIGNMENT, GET_DRAFT] },
	];
	for (const { name, overrides, requests } of cases) {
		const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: patchEcho }));
		const pod = await env.importModule(draftsPath);
		const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, overrides), { cookies: env.cookies }));
		assert.equal(result.success, false, name);
		assert.equal(result.uncertain, false, name);
		assert.deepEqual(plain(env.requests), requests, name);
		assert.equal(patches(env.requests).length, 0, name);
	}
});

test('D3 an inactive assignment or a draft from another context stops before any PATCH', async () => {
	const inactive = await environment(baseRoutes({ 'GET /patient-assignments/mine': { body: { items: [], limit: 50, offset: 0 } }, [`PATCH ${draftPath}`]: patchEcho }));
	const inactivePod = await inactive.importModule(draftsPath);
	const notListed = plain(await inactivePod.handleUpdateOralSurgeryDraft(saveInput(inactive, stored), { cookies: inactive.cookies }));
	assert.equal(notListed.success, false);
	assert.deepEqual(plain(inactive.requests), [GET_ASSIGNMENT]);
	const foreign = await environment(baseRoutes({ [`GET ${draftPath}`]: { body: draft({ patient_id: authorId }) }, [`PATCH ${draftPath}`]: patchEcho }));
	const foreignPod = await foreign.importModule(draftsPath);
	const mismatch = plain(await foreignPod.handleUpdateOralSurgeryDraft(saveInput(foreign, stored), { cookies: foreign.cookies }));
	assert.equal(mismatch.success, false);
	assert.deepEqual(plain(foreign.requests), [GET_ASSIGNMENT, GET_DRAFT]);
});

test('D3 a backend 409 after the PATCH is a conflict with values kept, and only one PATCH is sent', async () => {
	const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: { status: 409, body: errorBody('CONFLICT', 'draft version changed; reload before saving') } }));
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, { 'medical_history.medication': 'Ibuprofeno' }), { cookies: env.cookies }));
	assert.equal(result.conflict, true);
	assert.equal(result.uncertain, false);
	assert.match(result.error, CONFLICT_RE);
	assert.equal(result.values['medical_history.medication'], 'Ibuprofeno');
	assert.deepEqual(methodsOf(env.requests), ['GET', 'GET', 'PATCH']);
});

// D4: results and safe copy, one request per attempt, never retried.

test('D4 typed backend rejections keep the values with the same expected_version, use safe copy and send exactly one PATCH', async () => {
	const cases = [
		{ status: 400, body: errorBody('BAD_REQUEST', 'raw backend text'), copy: /Revisá los datos del borrador/ },
		{ status: 403, body: errorBody('FORBIDDEN', 'raw'), copy: /No tenés permiso/ },
		{ status: 404, body: errorBody('NOT_FOUND', 'oral surgery draft was not found'), copy: /no está disponible en esta asignación/ },
	];
	for (const { status, body, copy } of cases) {
		const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: { status, body } }));
		const pod = await env.importModule(draftsPath);
		const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, { 'medical_history.medication': 'Ibuprofeno' }), { cookies: env.cookies }));
		assert.equal(result.success, false, String(status));
		assert.equal(result.uncertain, false, String(status));
		assert.equal(result.conflict, false, String(status));
		assert.match(result.error, copy, String(status));
		assert.doesNotMatch(result.error, /raw/, String(status));
		assert.equal(result.expected_version, '3');
		assert.equal(result.values['medical_history.medication'], 'Ibuprofeno');
		assert.deepEqual(methodsOf(env.requests), ['GET', 'GET', 'PATCH'], String(status));
	}
});

test('D4 an expired session is a typed failure that the page turns into a login redirect', async () => {
	const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: { status: 401, body: errorBody('UNAUTHORIZED', 'expired') } }));
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored), { cookies: env.cookies }));
	assert.equal(result.uncertain, false);
	assert.match(result.error, /sesión venció/);
	assert.equal(patches(env.requests).length, 1);
});

test('D4 network failure, 5xx or a PATCH response that does not advance the version is uncertain, keeps values and is never retried', async () => {
	const outcomes = [
		{ network: true },
		{ status: 500, body: errorBody('INTERNAL', 'boom') },
		{ body: draft({ version: '3' }) },
	];
	for (const outcome of outcomes) {
		const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: outcome }));
		const pod = await env.importModule(draftsPath);
		const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, { 'medical_history.medication': 'Ibuprofeno' }), { cookies: env.cookies }));
		assert.equal(result.success, false, JSON.stringify(outcome));
		assert.equal(result.uncertain, true, JSON.stringify(outcome));
		assert.match(result.error, SAVE_UNCERTAIN_RE, JSON.stringify(outcome));
		assert.equal(result.values['medical_history.medication'], 'Ibuprofeno');
		assert.equal(patches(env.requests).length, 1, JSON.stringify(outcome));
	}
});

test('D4 a successful save returns validated list coordinates without putting them in the clinical mutation', async () => {
	const env = await environment(baseRoutes({ [`PATCH ${draftPath}`]: patchEcho }));
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleUpdateOralSurgeryDraft(saveInput(env, stored, { limit: '7', offset: '14', list_limit: '7', list_offset: '14', list_patient_id: patientId, 'medical_history.medication': 'Ibuprofeno' }), { cookies: env.cookies }));
	assert.equal(result.success, true);
	assert.equal(result.id, largeId);
	assert.equal(result.assignment_id, '17');
	assert.equal(result.limit, '7');
	assert.equal(result.offset, '14');
	assert.deepEqual(result.list_filters, { patient_id: patientId });
	assert.equal(result.draft.version, '4');
	assert.equal(result.draft.content.medical_history.medication, 'Ibuprofeno');
	assert.deepEqual(env.requests.at(-1).body, { expected_version: '3', content: { ...stored, medical_history: { ...stored.medical_history, medication: 'Ibuprofeno' } } });
});

// D5: consent declaration (one POST, never retried, uncertain outcomes).

const consentPost = `POST ${draftPath}/consent`;
const declareInput = (overrides = {}) => ({ id: largeId, expected_version: '3', assignment_id: '17', limit: '50', offset: '0', paper_signed: 'on', ...overrides });

test('D5 declaring paper consent sends one POST without list coordinates in the mutation', async () => {
	const env = await environment(baseRoutes({ [consentPost]: { status: 201, body: declaration() } }));
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleDeclareOralSurgeryConsent(declareInput({ limit: '7', offset: '14', list_limit: '7', list_offset: '14', list_subject_id: subjectId }), { cookies: env.cookies }));
	assert.deepEqual(plain(env.requests), [
		{ method: 'GET', url: `https://backend.invalid/patient-assignments/mine?limit=7&offset=14&subject_id=${subjectId}` },
		GET_DRAFT,
		{ method: 'POST', url: `${draftUrl}/consent`, body: { expected_version: '3', paper_signed: true } },
	]);
	assert.deepEqual(result, { success: true, id: largeId, assignment_id: '17', limit: '7', offset: '14', list_filters: { subject_id: subjectId }, declaration: declaration() });
});

test('D5 an unchecked confirmation or a stale version sends no POST', async () => {
	const unchecked = await environment(baseRoutes());
	const uncheckedPod = await unchecked.importModule(draftsPath);
	const refused = plain(await uncheckedPod.handleDeclareOralSurgeryConsent(declareInput({ paper_signed: undefined }), { cookies: unchecked.cookies }));
	assert.equal(refused.success, false);
	assert.deepEqual(plain(unchecked.requests), []);
	const stale = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(stored, '4'), [consentPost]: { status: 201, body: declaration() } }));
	const stalePod = await stale.importModule(draftsPath);
	const conflict = plain(await stalePod.handleDeclareOralSurgeryConsent(declareInput(), { cookies: stale.cookies }));
	assert.equal(conflict.success, false);
	assert.match(conflict.error, DECLARE_CONFLICT_RE);
	assert.deepEqual(plain(stale.requests), [GET_ASSIGNMENT, GET_DRAFT]);
});

test('D5 a backend 409 is the reload message and a typed 403 is safe copy; each sends exactly one POST', async () => {
	const conflict = await environment(baseRoutes({ [consentPost]: { status: 409, body: errorBody('CONFLICT', 'draft version changed; reload before saving') } }));
	const conflictPod = await conflict.importModule(draftsPath);
	const conflicted = plain(await conflictPod.handleDeclareOralSurgeryConsent(declareInput(), { cookies: conflict.cookies }));
	assert.equal(conflicted.success, false);
	assert.equal(conflicted.uncertain, false);
	assert.match(conflicted.error, DECLARE_CONFLICT_RE);
	assert.equal(conflict.requests.filter((request) => request.method === 'POST').length, 1);
	const forbidden = await environment(baseRoutes({ [consentPost]: { status: 403, body: errorBody('FORBIDDEN', 'raw') } }));
	const forbiddenPod = await forbidden.importModule(draftsPath);
	const denied = plain(await forbiddenPod.handleDeclareOralSurgeryConsent(declareInput(), { cookies: forbidden.cookies }));
	assert.equal(denied.uncertain, false);
	assert.match(denied.error, /No tenés permiso/);
	assert.doesNotMatch(denied.error, /raw/);
	assert.equal(forbidden.requests.filter((request) => request.method === 'POST').length, 1);
});

test('D5 network failure, 5xx or an unconfirmed 201 is uncertain, is never retried and tells the student to review history', async () => {
	const outcomes = [{ network: true }, { status: 500, body: errorBody('INTERNAL', 'boom') }, { status: 201, body: declaration({ draft_version: '2' }) }];
	for (const outcome of outcomes) {
		const env = await environment(baseRoutes({ [consentPost]: outcome }));
		const pod = await env.importModule(draftsPath);
		const result = plain(await pod.handleDeclareOralSurgeryConsent(declareInput(), { cookies: env.cookies }));
		assert.equal(result.success, false, JSON.stringify(outcome));
		assert.equal(result.uncertain, true, JSON.stringify(outcome));
		assert.match(result.error, DECLARE_UNCERTAIN_RE, JSON.stringify(outcome));
		assert.equal(env.requests.filter((request) => request.method === 'POST').length, 1, JSON.stringify(outcome));
	}
});

// D6: create action and authorization status line.

const createInput = (overrides = {}) => ({ ...context, assignment_id: '17', limit: '50', offset: '0', ...overrides });
const createPost = 'POST /oral-surgery-drafts';

test('D6 creating a draft sends one POST with the exact context and empty content, after the assignment is revalidated', async () => {
	const env = await environment({ [createPost]: { status: 201, body: draft({ id: '5', version: '1', content: {} }) } });
	const pod = await env.importModule(draftsPath);
	const result = plain(await pod.handleCreateOralSurgeryDraft(createInput(), { cookies: env.cookies }));
	assert.deepEqual(plain(env.requests), [
		GET_ASSIGNMENT,
		{ method: 'POST', url: `${apiBase}/oral-surgery-drafts`, body: { ...context, content: {} } },
	]);
	assert.equal(result.success, true);
	assert.equal(result.id, '5');
	assert.equal(result.draft.version, '1');
});

test('D6 filtered create revalidates the constrained assignment and keeps the clinical POST payload identical', async () => {
	const filtered = await environment({ [createPost]: { status: 201, body: draft({ id: '5', version: '1', content: {} }) } });
	const pod = await filtered.importModule(draftsPath);
	const carrier = { list_limit: '50', list_offset: '20', list_patient_id: patientId, list_subject_id: subjectId };
	const result = plain(await pod.handleCreateOralSurgeryDraft(createInput(carrier), { cookies: filtered.cookies }));
	assert.equal(result.success, true);
	const assignmentUrl = new URL(filtered.requests[0].url);
	assert.equal(assignmentUrl.searchParams.get('patient_id'), patientId);
	assert.equal(assignmentUrl.searchParams.get('subject_id'), subjectId);
	assert.deepEqual(filtered.requests.find((request) => request.method === 'POST').body, { ...context, content: {} });
	const invalid = await environment({ [createPost]: { status: 201, body: draft() } });
	const invalidPod = await invalid.importModule(draftsPath);
	assert.equal((await invalidPod.handleCreateOralSurgeryDraft(createInput({ 'list_patient_id[x]': patientId }), { cookies: invalid.cookies })).success, false);
	assert.deepEqual(plain(invalid.requests), []);
});

test('D6 create refuses a context that no longer matches the active assignment, and invalid identifiers, without any POST', async () => {
	const mismatch = await environment({ [createPost]: { status: 201, body: draft() } });
	const mismatchPod = await mismatch.importModule(draftsPath);
	const refused = plain(await mismatchPod.handleCreateOralSurgeryDraft(createInput({ subject_id: authorId }), { cookies: mismatch.cookies }));
	assert.equal(refused.success, false);
	assert.deepEqual(plain(mismatch.requests), [GET_ASSIGNMENT]);
	const invalid = await environment({ [createPost]: { status: 201, body: draft() } });
	const invalidPod = await invalid.importModule(draftsPath);
	const malformed = plain(await invalidPod.handleCreateOralSurgeryDraft(createInput({ patient_id: 'not-a-uuid' }), { cookies: invalid.cookies }));
	assert.equal(malformed.success, false);
	assert.deepEqual(plain(invalid.requests), []);
});

test('D6 a typed create rejection is safe copy with one POST; network failure is uncertain and tells the student to check the list', async () => {
	const notFound = await environment({ [createPost]: { status: 404, body: errorBody('NOT_FOUND', 'patient was not found') } });
	const notFoundPod = await notFound.importModule(draftsPath);
	const missing = plain(await notFoundPod.handleCreateOralSurgeryDraft(createInput(), { cookies: notFound.cookies }));
	assert.equal(missing.uncertain, false);
	assert.match(missing.error, /paciente no está disponible/);
	assert.equal(notFound.requests.filter((request) => request.method === 'POST').length, 1);
	const network = await environment({ [createPost]: { network: true } });
	const networkPod = await network.importModule(draftsPath);
	const unknown = plain(await networkPod.handleCreateOralSurgeryDraft(createInput(), { cookies: network.cookies }));
	assert.equal(unknown.success, false);
	assert.equal(unknown.uncertain, true);
	assert.match(unknown.error, CREATE_UNCERTAIN_RE);
	assert.equal(network.requests.filter((request) => request.method === 'POST').length, 1);
});

test('D6 the authorization line names the current version only when the current authorization is for the saved version', async () => {
	const current = { draft_version: '3', current_authorization_id: '11', authorizations: [{ id: '11', draft_id: largeId, draft_version: '3', consent_declaration_id: '7', reviewed_content: stored, authorized_by: authorId, teacher_habilitation_id: habilitationId, authorized_at: iso }] };
	const authorized = await environment(baseRoutes({ [`GET ${draftPath}/authorizations`]: { body: current } }));
	assert.equal((await authorized.renderPage(pagePath)).authorizationStatus, 'Autorización docente vigente para la versión 3');
	const older = { ...current, draft_version: '3', authorizations: [{ ...current.authorizations[0], draft_version: '2' }] };
	const outdated = await environment(baseRoutes({ [`GET ${draftPath}/authorizations`]: { body: older } }));
	assert.equal((await outdated.renderPage(pagePath)).authorizationStatus,
		'Sin autorización docente vigente para la versión guardada (3). Cada guardado exige una nueva autorización.');
	const none = await environment(baseRoutes());
	assert.equal((await none.renderPage(pagePath)).authorizationStatus,
		'Sin autorización docente vigente para la versión guardada (3). Cada guardado exige una nueva autorización.');
});

test('D6 an authorization load failure shows an error line and never hides the draft', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/authorizations`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	const page = await env.renderPage(pagePath);
	assert.equal(page.unavailable, false);
	assert.equal(page.loadError, '');
	assert.equal(page.draft.id, largeId);
	assert.equal(page.authorizationStatus, '');
	assert.match(page.authorizationError, /No se pudo cargar la autorización docente/);
});

// D4 and D5 at page level.

test('D4 a saved result redirects to the editor with saved=1 before any read', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath, {
		results: { updateOralSurgeryDraft: { data: { success: true, id: largeId, assignment_id: '17', limit: '50', offset: '0', draft: draft({ version: '4' }) } } },
	});
	assert.equal(page.redirect, `/oral-surgery-drafts/${largeId}?assignment_id=17&limit=50&offset=0&saved=1`);
	assert.deepEqual(plain(env.requests), []);
	const filtered = await env.renderPage(pagePath, {
		url: `${draftPath}?assignment_id=99&limit=1&offset=2&list_limit=7&list_offset=14&list_patient_id=${patientId}`,
		results: { updateOralSurgeryDraft: { data: { success: true, id: largeId, assignment_id: '17', limit: '7', offset: '14', list_filters: { patient_id: patientId }, draft: draft({ version: '4' }) } } },
	});
	assert.equal(filtered.redirect, `/oral-surgery-drafts/${largeId}?assignment_id=17&list_limit=7&list_offset=14&list_patient_id=${patientId}&saved=1`);
});

test('D4 a conflict renders the current stored version in the form and the typed values in an unsaved panel', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: readDraft(stored, '4') }));
	const typed = controlsFor(env, stored, { 'medical_history.consultation_reason': 'Nuevo motivo' });
	const page = await env.renderPage(pagePath, {
		results: { updateOralSurgeryDraft: { data: { success: false, uncertain: false, conflict: true, error: 'Otra pestaña o persona guardó una versión más nueva. Se muestra la versión actual; tus valores no guardados quedan abajo para copiarlos.', expected_version: '3', values: typed } } },
	});
	assert.match(page.saveError, CONFLICT_RE);
	assert.equal(page.formVersion, '4');
	assert.equal(page.formValues['medical_history.consultation_reason'], 'Dolor en pieza 38');
	assert.equal(page.unsaved.some((entry) => entry.value === 'Dolor en pieza 38'), false);
	assert.deepEqual(page.unsaved.find((entry) => entry.label === 'Motivo de consulta'), { label: 'Motivo de consulta', value: 'Nuevo motivo' });
	assert.equal(page.canDeclare, false);
});

test('D4 other failures re-render the submitted values with the submitted expected_version and no unsaved panel', async () => {
	const env = await environment(baseRoutes());
	const values = controlsFor(env, stored, { 'medical_history.medication': 'Ibuprofeno' });
	const page = await env.renderPage(pagePath, {
		results: { updateOralSurgeryDraft: { data: { success: false, uncertain: false, conflict: false, error: 'Revisá los datos del borrador.', expected_version: '3', values } } },
	});
	assert.equal(page.saveError, 'Revisá los datos del borrador.');
	assert.equal(page.formVersion, '3');
	assert.equal(page.formValues['medical_history.medication'], 'Ibuprofeno');
	assert.deepEqual(page.unsaved, []);
});

test('D4 retained values survive an unavailable draft as an unsaved panel and no editable form', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 404, body: errorBody('NOT_FOUND', 'x') } }));
	const values = controlsFor(env, {}, { 'medical_history.medication': 'Ibuprofeno' });
	const page = await env.renderPage(pagePath, {
		results: { updateOralSurgeryDraft: { data: { success: false, uncertain: false, conflict: false, error: 'x', expected_version: '3', values } } },
	});
	assert.equal(page.unavailable, true);
	assert.equal(page.formValues, undefined);
	assert.deepEqual(page.unsaved, [{ label: 'Medicación', value: 'Ibuprofeno' }]);
});

test('D4 an expired session in any action redirects to login and an uncertain framework error keeps the save copy', async () => {
	const expired = await environment(baseRoutes());
	const redirected = await expired.renderPage(pagePath, {
		results: { updateOralSurgeryDraft: { data: { success: false, uncertain: false, conflict: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.', expected_version: '3' } } },
	});
	assert.match(redirected.redirect, /^\/auth\/login\?returnTo=/);
	const framework = await environment(baseRoutes());
	const page = await framework.renderPage(pagePath, { results: { updateOralSurgeryDraft: { error: { message: 'x', inputError: false } } } });
	assert.match(page.saveError, SAVE_UNCERTAIN_RE);
});

test('D5 the declare form is offered only to the eligible author with no current declaration and no retained or failed state', async () => {
	const open = await environment(baseRoutes());
	const page = await open.renderPage(pagePath);
	assert.equal(page.canDeclare, true);
	const declared = await environment(baseRoutes({ [`GET ${draftPath}/consent`]: { body: { ...consentNone, current_declaration_id: '7', declarations: [declaration()] } } }));
	assert.equal((await declared.renderPage(pagePath)).canDeclare, false);
	const notEligible = await environment(baseRoutes());
	assert.equal((await notEligible.renderPage(pagePath, { actor: student({ role: 'teacher' }) })).canDeclare, false);
	const retained = await environment(baseRoutes());
	const withRetained = await retained.renderPage(pagePath, {
		results: { updateOralSurgeryDraft: { data: { success: false, uncertain: false, conflict: false, error: 'x', expected_version: '3', values: controlsFor(retained, stored) } } },
	});
	assert.equal(withRetained.canDeclare, false);
	const consentFailed = await environment(baseRoutes({ [`GET ${draftPath}/consent`]: { status: 500, body: errorBody('INTERNAL', 'x') } }));
	const failed = await consentFailed.renderPage(pagePath);
	assert.equal(failed.canDeclare, false);
	assert.equal(failed.draft.id, largeId);
	assert.match(failed.consentError, /No se pudo cargar el consentimiento/);
	const versionMismatch = await environment(baseRoutes({ [`GET ${draftPath}/consent`]: { body: { ...consentNone, draft_version: '2' } } }));
	assert.equal((await versionMismatch.renderPage(pagePath)).canDeclare, false);
	const uncertain = await environment(baseRoutes());
	const uncertainPage = await uncertain.renderPage(pagePath, {
		results: { declareOralSurgeryConsent: { data: { success: false, uncertain: true, error: 'No se pudo confirmar la declaración. Recargá la página y revisá el historial antes de volver a intentarlo.' } } },
	});
	assert.equal(uncertainPage.canDeclare, false);
	assert.match(uncertainPage.declareError, DECLARE_UNCERTAIN_RE);
});

test('D5 a declaration redirects to declared=1, and the history keeps the backend order with the current declaration', async () => {
	const env = await environment(baseRoutes());
	const redirected = await env.renderPage(pagePath, {
		results: { declareOralSurgeryConsent: { data: { success: true, id: largeId, assignment_id: '17', limit: '50', offset: '0', declaration: declaration() } } },
	});
	assert.equal(redirected.redirect, `/oral-surgery-drafts/${largeId}?assignment_id=17&limit=50&offset=0&declared=1`);
	const filtered = await env.renderPage(pagePath, {
		url: `${draftPath}?assignment_id=99&limit=1&offset=2&list_limit=7&list_offset=14&list_subject_id=${subjectId}`,
		results: { declareOralSurgeryConsent: { data: { success: true, id: largeId, assignment_id: '17', limit: '7', offset: '14', list_filters: { subject_id: subjectId }, declaration: declaration() } } },
	});
	assert.equal(filtered.redirect, `/oral-surgery-drafts/${largeId}?assignment_id=17&list_limit=7&list_offset=14&list_subject_id=${subjectId}&declared=1`);
	const history = { draft_version: '3', plan_revision: '2', current_declaration_id: '7', declarations: [declaration({ id: '6', plan_revision: '1', treatment_plan: null }), declaration()] };
	const withHistory = await environment(baseRoutes({ [`GET ${draftPath}/consent`]: { body: history } }));
	const page = await withHistory.renderPage(pagePath);
	assert.deepEqual(page.consent, history);
	assert.equal(page.consent.declarations[0].id, '6');
	assert.equal(page.consent.current_declaration_id, '7');
});

test('D5 the declare control is disabled while the editor has unsaved changes', async () => {
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /declareButton\.disabled = true/);
	assert.match(source, /dirty = true/);
	assert.match(source, /Hay cambios sin guardar/);
});

// Pod-level contract for the form and page compile.

test('D2 the pod exposes one control per contract field and round-trips stored content through form values', async () => {
	const env = await environment();
	const pod = await env.importModule(draftsPath);
	const expected = ['admission_date', ...Object.entries(env.api.ORAL_SURGERY_SECTIONS)
		.flatMap(([section, { booleans, texts }]) => [...booleans, ...texts].map((field) => `${section}.${field}`))];
	assert.deepEqual(plain(pod.ORAL_SURGERY_FORM_FIELDS), expected);
	assert.deepEqual(plain(pod.ORAL_SURGERY_FORM_CONTROLS.get('medical_history.hospitalized')), { section: 'medical_history', field: 'hospitalized', kind: 'boolean' });
	assert.deepEqual(plain(pod.ORAL_SURGERY_FORM_CONTROLS.get('admission_date')), { section: null, field: 'admission_date', kind: 'date' });
	const values = plain(pod.formValuesFromContent(stored));
	const rebuilt = plain(pod.oralSurgeryContentFromForm(values, stored));
	assert.deepEqual(rebuilt, stored);
});

test('compiles the student editor with the installed Astro compiler', async () => {
	const source = await readFile(new URL(pagePath, root), 'utf8');
	const result = await transform(source, { filename: pagePath });
	const astroErrors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 1);
	assert.deepEqual(astroErrors, [], `Astro compiler errors: ${JSON.stringify(astroErrors)}`);
	const generated = ts.transpileModule(result.code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
	const syntaxErrors = generated.diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
	assert.deepEqual(syntaxErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
	assert.doesNotMatch(source, /fetch\(/);
});
