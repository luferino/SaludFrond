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
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const draftPath = `/oral-surgery-drafts/${largeId}`;
const draftUrl = `${apiBase}${draftPath}`;
const assignmentUrl = `${apiBase}/patient-assignments/mine?limit=50&offset=0`;
const reportSaveAction = '/_actions/saveOralSurgeryOperativeReport';

const stored = {
	admission_date: '2026-11-06',
	medical_history: { hospitalized: false, taking_medication: null, consultation_reason: 'Dolor en pieza 38', medication: '' },
	treatment_plan: { procedure: 'Exodoncia simple', anomalies_or_pathology: null },
};
const reportContent = {
	narrative: 'Exodoncia sin complicaciones',
	asepsis: { extraoral: 'Clorhexidina', intraoral: null },
	anesthesia: { technique: 'Infiltrativa', drug: 'Lidocaína', dose: '' },
	postoperative_instructions: 'Hielo 20 minutos',
};
/** Every report control in form order: top-level keys and `<section>.<field>` names. */
const reportFieldNames = [
	'narrative', 'asepsis.extraoral', 'asepsis.intraoral', 'anesthesia.technique', 'anesthesia.drug', 'anesthesia.dose',
	'extraction.teeth', 'extraction.technique', 'extraction.suture', 'prescription.medications', 'prescription.commercial_name',
	'prescription.route', 'prescription.dose', 'prescription.frequency', 'prescription.duration',
	'postoperative_instructions', 'operative_incident',
];
const emptyReportValues = Object.fromEntries(reportFieldNames.map((name) => [name, '']));
const reportValues = (overrides = {}) => ({ ...emptyReportValues, ...overrides });

const student = (overrides = {}) => ({
	sub: authorId, username: 'ana', role: 'estudiante', permissions: ['oral-surgery-drafts:read', 'oral-surgery-drafts:write'],
	exp: 4102444800, iat: 1, ...overrides,
});
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const plain = (value) => JSON.parse(JSON.stringify(value));
const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: stored, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const reportBody = (overrides = {}) => ({
	draft_id: largeId, draft_version: '3', authorization_id: '11', content: reportContent, version: '5', status: 'draft',
	created_by: authorId, created_at: iso, updated_at: iso, closed_by: null, closed_at: null, teacher_habilitation_id: null, ...overrides,
});
const closedReport = (overrides = {}) => reportBody({
	version: '6', status: 'closed', closed_by: teacherId, closed_at: iso, teacher_habilitation_id: habilitationId, ...overrides,
});
const authorization = (draftVersion) => ({
	id: '11', draft_id: largeId, draft_version: draftVersion, consent_declaration_id: '7', reviewed_content: stored,
	authorized_by: authorId, teacher_habilitation_id: habilitationId, authorized_at: iso,
});
const authHistory = (draftVersion) => ({ draft_version: '3', current_authorization_id: '11', authorizations: [authorization(draftVersion)] });
const consentNone = { draft_version: '3', plan_revision: '2', current_declaration_id: null, declarations: [] };
const authNone = { draft_version: '3', current_authorization_id: null, authorizations: [] };
const errorBody = (code, message) => ({ error: { code, message } });
const baseRoutes = (overrides = {}) => ({
	[`GET ${draftPath}`]: { body: draft() },
	[`GET ${draftPath}/consent`]: { body: consentNone },
	[`GET ${draftPath}/authorizations`]: { body: authNone },
	[`GET ${draftPath}/operative-report`]: { status: 404, body: errorBody('NOT_FOUND', 'oral surgery operative report was not found') },
	[`GET ${draftPath}/practical-evaluation`]: practicalNotFound,
	...overrides,
});
const GET_ASSIGNMENT = { method: 'GET', url: assignmentUrl };
const GET_DRAFT = { method: 'GET', url: draftUrl };
const GET_REPORT = { method: 'GET', url: `${draftUrl}/operative-report` };
const GET_PRACTICAL = { method: 'GET', url: `${draftUrl}/practical-evaluation` };
const practicalNotFound = { status: 404, body: errorBody('NOT_FOUND', 'oral surgery practical evaluation was not found') };
const practicalItems = {
	hand_washing: 1, barrier_elements: 0, waste_disposal: 1, clinical_table_setup: 2, asepsis: 0, anamnesis_questionnaire: 2,
	anesthetic_technique: 1, sindesmotomy_elevators: 2, surgical_procedure: 2, curettage_suture: 1, record_and_equipment: 1, relationship: 1,
};
/** The student view: the current grade only, exactly the four keys of the S6 contract. */
const studentEvaluation = { current: { items: practicalItems, total: 14, outcome: 'annulled', graded_at: iso } };

/** Real pods and page frontmatter run in one vm context; fetch and cookies are isolated and every request is recorded. */
async function environment(routes = {}) {
	const requests = [];
	const table = {
		'GET /patient-assignments/mine': ({ url }) => ({
			body: { items: [{
				id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
				assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso,
				ended_by: null, ended_at: null, end_reason: null,
			}], limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) },
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
	const actionStubs = Object.fromEntries(['updateOralSurgeryDraft', 'declareOralSurgeryConsent', 'createOralSurgeryDraft', 'saveOralSurgeryOperativeReport']
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
		const state = ['unavailable', 'loadError', 'eligible', 'editable', 'editHint', 'draft', 'formValues', 'formVersion', 'unsaved', 'saveError',
			'canDeclare', 'declareError', 'consent', 'consentError', 'authorizationStatus', 'authorizationError', 'saved', 'declared', 'limit', 'offset', 'saveHref', 'declareHref',
			'report', 'reportError', 'closed', 'reportActions', 'reportAuthorizationMissing', 'reportStale', 'reportFields', 'reportFormVersion',
			'reportFormDraftVersion', 'reportSaveError', 'reportSaved', 'reportUnsaved', 'reportSaveHref', 'evaluation', 'evaluationError', 'evaluationNoGradeCopy'];
		const script = `async function renderPage() {${declarations}\nreturn { ${state.join(', ')} };\n}`;
		const output = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
		vm.runInContext(output, sandbox);
		return plain(await sandbox.renderPage());
	}

	const api = await importModule(apiPath);
	return { requests, cookies, importModule, renderPage, api };
}

const sourceOfPage = () => readFile(new URL(pagePath, root), 'utf8');

// R1 and R2: create and edit forms of the report.

test('R1 a 404 for the report means no report yet: the create form has no expected_version and sends the current draft version', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath);
	assert.deepEqual(plain(env.requests).slice(-2), [GET_REPORT, GET_PRACTICAL]);
	assert.equal(page.report, null);
	assert.equal(page.reportError, '');
	assert.equal(page.reportActions, true);
	assert.equal(page.reportFormVersion, '');
	assert.equal(page.reportFormDraftVersion, '3');
	assert.deepEqual(Object.keys(page.reportFields), reportFieldNames);
	assert.ok(Object.values(page.reportFields).every((value) => value === ''));
	const source = await sourceOfPage();
	assert.match(source, /\{reportFormVersion !== '' && <input type="hidden" name="expected_version" value=\{reportFormVersion\} \/>\}/);
	assert.match(source, /<input type="hidden" name="expected_draft_version" value=\{reportFormDraftVersion\} \/>/);
});

test('R2 an edit form carries the stored report version and the draft version it was written against, with stored answers', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	const page = await env.renderPage(pagePath);
	assert.equal(page.report.version, '5');
	assert.equal(page.reportFormVersion, '5');
	assert.equal(page.reportFormDraftVersion, '3');
	assert.equal(page.reportFields.narrative, 'Exodoncia sin complicaciones');
	assert.equal(page.reportFields['asepsis.extraoral'], 'Clorhexidina');
	assert.equal(page.reportFields['asepsis.intraoral'], '');
	assert.equal(page.reportFields['anesthesia.dose'], '');
	assert.equal(page.reportFields.postoperative_instructions, 'Hielo 20 minutos');
	const source = await sourceOfPage();
	assert.match(source, /\{reportFormVersion !== '' && <input type="hidden" name="expected_version" value=\{reportFormVersion\} \/>\}/);
	assert.match(source, /\{OPERATIVE_REPORT_LAYOUT\.map\(/);
	assert.match(source, /<textarea name=\{key\}>\{oralSurgeryTextareaText\(reportFields\[key\] \?\? ''\)\}<\/textarea>/);
	assert.match(source, /<textarea name=\{`\$\{key\}\.\$\{field\}`\}>\{oralSurgeryTextareaText\(reportFields\[`\$\{key\}\.\$\{field\}`\] \?\? ''\)\}<\/textarea>/);
});

test('R2 the report action href carries the validated assignment context, and the form posts there', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath, { url: `${draftPath}?assignment_id=17&limit=20&offset=40` });
	assert.equal(page.reportSaveHref, `${reportSaveAction}?assignment_id=17&list_limit=20&list_offset=40`);
	const source = await sourceOfPage();
	assert.match(source, /<form method="POST" action=\{reportSaveHref\} id="report-form">/);
	assert.match(source, /<input type="hidden" name="expected_draft_version" value=\{reportFormDraftVersion\} \/>/);
	assert.match(source, /<input type="hidden" name="assignment_id" value=\{assignmentId\} \/>/);
});

// R3: closure, eligibility and read-only viewers.

test('R3 a closed report makes the draft read-only, hides the declaration and shows the report read-only', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: closedReport() } }));
	const page = await env.renderPage(pagePath);
	assert.equal(page.closed, true);
	assert.equal(page.editable, false);
	assert.equal(page.eligible, true);
	assert.equal(page.canDeclare, false);
	assert.equal(page.reportActions, false);
	assert.equal(page.report.status, 'closed');
	assert.match(page.editHint, /cerrado por el docente/);
	assert.match(page.editHint, /inmutable/);
	const source = await sourceOfPage();
	assert.equal((source.match(/<fieldset disabled=\{!editable\}>/g) ?? []).length, 2);
	assert.match(source, /\{editable && <button class="button" type="submit">Guardar borrador<\/button>\}/);
	assert.match(source, /<OperativeReportReadOnly report=\{report\} \/>/);
	assert.match(source, /reportActions \? </);
});

test('R3 a non-eligible viewer sees the stored report read-only, or a line when no report was saved yet', async () => {
	const withReport = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	const readOnly = await withReport.renderPage(pagePath, { actor: student({ role: 'teacher' }) });
	assert.equal(readOnly.reportActions, false);
	assert.equal(readOnly.report.version, '5');
	const none = await environment(baseRoutes());
	const empty = await none.renderPage(pagePath, { actor: student({ sub: patientId }) });
	assert.equal(empty.reportActions, false);
	assert.equal(empty.report, null);
	const source = await sourceOfPage();
	assert.match(source, /Todavía no se guardó ningún parte quirúrgico para este encuentro\./);
});

// R4: authorization prerequisite and version notice.

test('R4 a current authorization for another version hides only the save button; a missing or failed history keeps the rule for missing and the button for failed', async () => {
	const outdated = await environment(baseRoutes({ [`GET ${draftPath}/authorizations`]: { body: authHistory('2') } }));
	const stale = await outdated.renderPage(pagePath);
	assert.equal(stale.reportAuthorizationMissing, true);
	assert.equal(stale.reportActions, true);
	const none = await environment(baseRoutes());
	assert.equal((await none.renderPage(pagePath)).reportAuthorizationMissing, true);
	const current = await environment(baseRoutes({ [`GET ${draftPath}/authorizations`]: { body: authHistory('3') } }));
	assert.equal((await current.renderPage(pagePath)).reportAuthorizationMissing, false);
	const failed = await environment(baseRoutes({ [`GET ${draftPath}/authorizations`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	const unknown = await failed.renderPage(pagePath);
	assert.equal(unknown.reportAuthorizationMissing, false);
	assert.equal(unknown.reportActions, true);
	const source = await sourceOfPage();
	assert.match(source, /\{!reportAuthorizationMissing && <button id="report-button" class="button" type="submit">Guardar parte quirúrgico<\/button>\}/);
	assert.match(source, /Hace falta una autorización docente vigente para la versión \{draft\.version\} antes de guardar el parte quirúrgico\./);
});

test('R5 a report saved against another clinical version shows the notice; a closed report never does', async () => {
	const behind = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody({ draft_version: '2' }) } }));
	const page = await behind.renderPage(pagePath);
	assert.equal(page.reportStale, true);
	assert.equal(page.reportFormDraftVersion, '3');
	const current = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	assert.equal((await current.renderPage(pagePath)).reportStale, false);
	const closed = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: closedReport({ draft_version: '2' }) } }));
	assert.equal((await closed.renderPage(pagePath)).reportStale, false);
	const source = await sourceOfPage();
	assert.match(source, /reportStale && /);
	assert.match(source, /versión clínica \{report\.draft_version\}/);
});

// R6: action results.

test('R6 a successful report save redirects with report_saved=1 before any read, keeping the validated list context', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath, {
		results: { saveOralSurgeryOperativeReport: { data: { success: true, id: largeId, assignment_id: '17', limit: '50', offset: '0', report: reportBody() } } },
	});
	assert.equal(page.redirect, `/oral-surgery-drafts/${largeId}?assignment_id=17&limit=50&offset=0&report_saved=1`);
	assert.deepEqual(plain(env.requests), []);
	const filtered = await env.renderPage(pagePath, {
		url: `${draftPath}?assignment_id=99&limit=1&offset=2&list_limit=7&list_offset=14&list_patient_id=${patientId}`,
		results: { saveOralSurgeryOperativeReport: { data: { success: true, id: largeId, assignment_id: '17', limit: '7', offset: '14', list_filters: { patient_id: patientId }, report: reportBody() } } },
	});
	assert.equal(filtered.redirect, `/oral-surgery-drafts/${largeId}?assignment_id=17&list_limit=7&list_offset=14&list_patient_id=${patientId}&report_saved=1`);
});

test('R6 the report saved notice is shown on return, separately from the draft saved notice', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath, { url: `${draftPath}?assignment_id=17&limit=50&offset=0&report_saved=1` });
	assert.equal(page.reportSaved, true);
	assert.equal(page.saved, false);
	const source = await sourceOfPage();
	assert.match(source, /Parte quirúrgico guardado\./);
});

test('R6 a conflict shows the stored report, keeps the draft, and lists the submitted non-empty values with report labels', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	const submitted = reportValues({ narrative: 'Relato nuevo', 'extraction.teeth': '36' });
	const page = await env.renderPage(pagePath, {
		results: { saveOralSurgeryOperativeReport: { data: { success: false, uncertain: false, conflict: true, error: 'Copy de conflicto', expected_version: '4', expected_draft_version: '3', values: submitted } } },
	});
	assert.equal(page.reportSaveError, 'Copy de conflicto');
	assert.equal(page.reportFormVersion, '5');
	assert.equal(page.reportFields.narrative, 'Exodoncia sin complicaciones');
	assert.deepEqual(page.reportUnsaved, [
		{ label: 'Relato del procedimiento', value: 'Relato nuevo' },
		{ label: 'Piezas', value: '36' },
	]);
	assert.equal(page.saveError, '');
	assert.equal(page.formVersion, '3');
	assert.equal(page.formValues['medical_history.consultation_reason'], 'Dolor en pieza 38');
	assert.equal(page.canDeclare, true);
	const source = await sourceOfPage();
	assert.match(source, /Valores no guardados del parte/);
});

test('R6 other failures re-render the submitted values with the submitted versions and no unsaved panel; the draft is untouched', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	const page = await env.renderPage(pagePath, {
		results: { saveOralSurgeryOperativeReport: { data: { success: false, uncertain: false, conflict: false, error: 'Revisá los datos del parte quirúrgico.', expected_version: '4', expected_draft_version: '3', values: reportValues({ narrative: 'Relato nuevo' }) } } },
	});
	assert.equal(page.reportSaveError, 'Revisá los datos del parte quirúrgico.');
	assert.equal(page.reportFields.narrative, 'Relato nuevo');
	assert.equal(page.reportFormVersion, '4');
	assert.equal(page.reportFormDraftVersion, '3');
	assert.deepEqual(page.reportUnsaved, []);
	assert.equal(page.saveError, '');
	assert.equal(page.formValues['medical_history.consultation_reason'], 'Dolor en pieza 38');
	assert.equal(page.formVersion, '3');
	assert.equal(page.canDeclare, true);
});

test('R6 an uncertain outcome shows the save copy and the stored report, lists the submitted values as unsaved and sends no write from the page', async () => {
	const uncertain = { success: false, uncertain: true, conflict: false, error: 'No se pudo confirmar el guardado del parte quirúrgico. Recargá la página para ver la versión guardada antes de volver a intentarlo.', expected_version: '', expected_draft_version: '3', values: reportValues({ narrative: 'Relato nuevo' }) };
	// The first save may have been written: the form must carry the stored version, never the empty create version.
	const written = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	const page = await written.renderPage(pagePath, { results: { saveOralSurgeryOperativeReport: { data: uncertain } } });
	assert.match(page.reportSaveError, /No se pudo confirmar el guardado del parte quirúrgico/);
	assert.equal(page.reportFormVersion, '5');
	assert.equal(page.reportFormDraftVersion, '3');
	assert.equal(page.reportFields.narrative, 'Exodoncia sin complicaciones');
	assert.deepEqual(page.reportUnsaved, [{ label: 'Relato del procedimiento', value: 'Relato nuevo' }]);
	assert.deepEqual(plain(written.requests).filter((request) => request.method !== 'GET'), []);
	// Not written: the create form comes back empty, with the submitted values still listed.
	const missing = await environment(baseRoutes());
	const none = await missing.renderPage(pagePath, { results: { saveOralSurgeryOperativeReport: { data: uncertain } } });
	assert.equal(none.reportFormVersion, '');
	assert.equal(none.reportFields.narrative, '');
	assert.deepEqual(none.reportUnsaved, [{ label: 'Relato del procedimiento', value: 'Relato nuevo' }]);
	assert.deepEqual(plain(missing.requests).filter((request) => request.method !== 'GET'), []);
});

test('R6 framework errors use the form copy for input errors and the save-uncertain copy otherwise', async () => {
	const input = await environment(baseRoutes());
	const invalid = await input.renderPage(pagePath, { results: { saveOralSurgeryOperativeReport: { error: { inputError: true, message: 'bad' } } } });
	assert.equal(invalid.reportSaveError, 'Revisá los campos del parte quirúrgico.');
	const other = await environment(baseRoutes());
	const failed = await other.renderPage(pagePath, { results: { saveOralSurgeryOperativeReport: { error: { inputError: false, message: 'boom' } } } });
	assert.match(failed.reportSaveError, /No se pudo confirmar el guardado del parte quirúrgico/);
});

test('R6 an expired session in the report action redirects to login', async () => {
	const env = await environment(baseRoutes());
	const page = await env.renderPage(pagePath, {
		results: { saveOralSurgeryOperativeReport: { data: { success: false, uncertain: false, conflict: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.', expected_version: '5', expected_draft_version: '3' } } },
	});
	assert.match(page.redirect, /^\/auth\/login\?returnTo=/);
});

// R7: report read failures keep the draft.

test('R7 a report read failure shows the draft read-only, hides the save, the declaration and the report actions, with its own alert', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	const page = await env.renderPage(pagePath);
	assert.equal(page.unavailable, false);
	assert.equal(page.loadError, '');
	assert.equal(page.draft.id, largeId);
	assert.equal(page.eligible, true);
	assert.equal(page.closed, false);
	// The encounter may be closed: nothing that writes is offered until the report state is known.
	assert.equal(page.editable, false);
	assert.equal(page.canDeclare, false);
	assert.equal(page.editHint, 'No se pudo confirmar si el encuentro quirúrgico fue cerrado. El borrador se muestra en solo lectura; recargá la página antes de editar o declarar el consentimiento.');
	assert.equal(page.reportActions, false);
	assert.equal(page.report, null);
	assert.match(page.reportError, /No se pudo cargar el parte quirúrgico/);
	const source = await sourceOfPage();
	assert.match(source, /\{reportError \? <p class="notice error" role="alert">\{reportError\}<\/p>/);
});

test('R7 an expired session on the report read redirects to login', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { status: 401, body: errorBody('UNAUTHORIZED', 'expired') } }));
	const page = await env.renderPage(pagePath);
	assert.match(page.redirect, /^\/auth\/login\?returnTo=/);
});

// R8: page copy and client-side guards.

test('R8 the report section carries the Spanish note, the button copy, and a double-submit guard scoped to the report form', async () => {
	const source = await sourceOfPage();
	assert.match(source, /Parte quirúrgico/);
	assert.match(source, /Podés guardar un parte incompleto\. El docente del contexto lo revisa y confirma el cierre\./);
	assert.match(source, /reportForm\.dataset\.submitting/);
	assert.match(source, /reportButton\.disabled = true/);
});

test('R8 report edits never mark the clinical draft dirty, so they cannot block the consent declaration', async () => {
	const source = await sourceOfPage();
	assert.match(source, /form\?\.addEventListener\('input', markDirty\)/);
	assert.doesNotMatch(source, /reportForm\??\.addEventListener\('(input|change)', markDirty\)/);
});

// E1-E6: practical evaluation section (S1, S6). The student sees the current grade only, never history or reasons.

const NO_GRADE_CLOSED = 'El docente todavía no registró la evaluación práctica.';
const NO_GRADE_OPEN = 'La evaluación práctica se registra después del cierre del parte quirúrgico.';
const PRACTICAL_FAILED = 'No se pudo cargar la evaluación práctica. El resto de la ficha se muestra igual; intentá recargar la página.';
const withoutEvaluation = ({ evaluation, evaluationError, evaluationNoGradeCopy, ...rest }) => rest;

test('E1 the practical evaluation is read after the report, only for a loaded draft, and its section follows the report section', async () => {
	const env = await environment(baseRoutes());
	await env.renderPage(pagePath);
	assert.deepEqual(plain(env.requests).slice(-2), [GET_REPORT, GET_PRACTICAL]);
	const missing = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 404, body: errorBody('NOT_FOUND', 'oral surgery draft was not found') } }));
	await missing.renderPage(pagePath);
	assert.equal(missing.requests.some((request) => request.url.endsWith('/practical-evaluation')), false);
	const source = await sourceOfPage();
	assert.ok(source.indexOf('id="report-title"') > 0 && source.indexOf('id="practical-title"') > source.indexOf('id="report-title"'));
	assert.match(source, /<section class="practical" aria-labelledby="practical-title">\s*<h2 id="practical-title">Evaluación práctica<\/h2>/);
});

test('E2 the student sees the current grade only: the component receives current, never history or reasons', async () => {
	const env = await environment(baseRoutes({
		[`GET ${draftPath}/operative-report`]: { body: closedReport() },
		[`GET ${draftPath}/practical-evaluation`]: { body: studentEvaluation },
	}));
	const page = await env.renderPage(pagePath);
	assert.deepEqual(page.evaluation, studentEvaluation);
	assert.equal('history' in page.evaluation, false);
	assert.equal(page.evaluationError, '');
	const source = await sourceOfPage();
	assert.match(source, /<PracticalEvaluationReadOnly current=\{evaluation\.current\} \/>/);
	assert.doesNotMatch(source, /PracticalEvaluationReadOnly[^>]*(history|reason)/);
});

test('E3 without a grade the copy depends on the report: a closed report says the teacher has not graded, any other state says grading follows closure', async () => {
	const closed = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: closedReport() } }));
	const closedPage = await closed.renderPage(pagePath);
	assert.equal(closedPage.evaluation, null);
	assert.equal(closedPage.evaluationNoGradeCopy, NO_GRADE_CLOSED);
	const open = await environment(baseRoutes({ [`GET ${draftPath}/operative-report`]: { body: reportBody() } }));
	assert.equal((await open.renderPage(pagePath)).evaluationNoGradeCopy, NO_GRADE_OPEN);
	const none = await environment(baseRoutes());
	assert.equal((await none.renderPage(pagePath)).evaluationNoGradeCopy, NO_GRADE_OPEN);
	const source = await sourceOfPage();
	assert.match(source, /\{evaluationError \?[\s\S]*: evaluation \? <PracticalEvaluationReadOnly current=\{evaluation\.current\} \/>[\s\S]*: <p>\{evaluationNoGradeCopy\}<\/p>\}/);
});

test('E4 an evaluation read failure shows its own copy and leaves editability, consent, draft and report state unchanged', async () => {
	for (const report of [{ body: reportBody() }, { body: closedReport() }, null]) {
		const withReport = (practical) => baseRoutes({
			...(report ? { [`GET ${draftPath}/operative-report`]: report } : {}),
			[`GET ${draftPath}/practical-evaluation`]: practical,
		});
		const healthy = await (await environment(withReport(practicalNotFound))).renderPage(pagePath);
		for (const failure of [{ status: 500, body: errorBody('INTERNAL', 'boom') }, { network: true }]) {
			const failed = await (await environment(withReport(failure))).renderPage(pagePath);
			assert.equal(failed.evaluationError, PRACTICAL_FAILED);
			assert.equal(failed.evaluation, null);
			assert.deepEqual(withoutEvaluation(failed), withoutEvaluation(healthy));
		}
	}
});

test('E5 an expired session on the evaluation read redirects to login', async () => {
	const env = await environment(baseRoutes({ [`GET ${draftPath}/practical-evaluation`]: { status: 401, body: errorBody('UNAUTHORIZED', 'expired') } }));
	const page = await env.renderPage(pagePath);
	assert.equal(page.redirect, `/auth/login?returnTo=${encodeURIComponent(`${draftPath}?assignment_id=17&limit=50&offset=0`)}`);
});

test('E6 the student page offers no grade or correction form, field or action', async () => {
	const source = await sourceOfPage();
	assert.doesNotMatch(source, /gradeOralSurgeryPracticalEvaluation|correctOralSurgeryPracticalEvaluation|PRACTICAL_RUBRIC|expected_revision|practical-evaluation\/corrections|name="(?:items|reason)"/);
});

test('compiles the student editor with the installed Astro compiler', async () => {
	const source = await sourceOfPage();
	const result = await transform(source, { filename: pagePath });
	const astroErrors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 1);
	assert.deepEqual(astroErrors, [], `Astro compiler errors: ${JSON.stringify(astroErrors)}`);
	const generated = ts.transpileModule(result.code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
	const syntaxErrors = generated.diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
	assert.deepEqual(syntaxErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
	assert.doesNotMatch(source, /fetch\(/);
});
