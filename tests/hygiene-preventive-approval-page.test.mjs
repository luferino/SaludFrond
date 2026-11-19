import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Teacher detail page, approval (S5, D5): the real page and the real shared components, compiled with explicit mocks for
// the teacher access helpers and the action result. The draft, consent and procedure reads go through the real API module.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const detailPage = 'src/pages/teacher-clinical/hygiene-preventive/[id].astro';
const logComponent = 'src/components/clinical/HygieneProcedureLog.astro';
const readOnlyPage = 'src/components/clinical/HygieneReadOnly.astro';
const consentComponentPath = 'src/components/clinical/HygieneConsentHistory.astro';
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const author = '55555555-5555-4555-8555-555555555555';
const teacher = '77777777-7777-4777-8777-777777777777';
const habilitation = '66666666-6666-4666-8666-666666666666';
const id = '9007199254741061';
const iso = '2026-11-18T12:00:00.000Z';
const approvedIso = '2026-11-18T09:00:00.000Z';
const readGrant = 'hygiene-preventive-drafts:read';
const approveGrant = 'hygiene-preventive-drafts:approve';
const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
const query = new URLSearchParams(context).toString();
const APPROVE_URL = '/_actions/approveHygieneProcedure';
const HINT = 'Tu sesión no tiene permiso para aprobar procedimientos. Si el permiso se otorgó hace poco, cerrá sesión y volvé a ingresar.';
const STALE = 'El alumno modificó el procedimiento. Revisalo antes de aprobar.';
const UNCERTAIN = 'No se pudo confirmar la aprobación. Recargá la página y revisá el registro antes de volver a intentarlo.';
const FORM_COPY = 'Revisá los datos de la aprobación.';

const draft = (overrides = {}) => ({
	id, clinical_record_id: '9007199254741060', patient_id: patient, author_id: author, origin_student_habilitation_id: habilitation,
	origin_subject_id: subject, origin_group_id: group,
	content: { medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', observations: 'Sin novedades' } },
	status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const entry = (overrides = {}) => ({
	id: '21', draft_id: id, procedure_date: '2026-11-10', description: 'Profilaxis', author_id: author, student_name: 'Ana Pérez',
	version: '4', approved_by: null, teacher_name: null, approved_at: null, created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});
const approvedEntry = (overrides = {}) => entry({
	id: '22', description: 'Destartraje', version: '5', approved_by: teacher, teacher_name: 'Marta Gómez', approved_at: approvedIso, status: 'approved', ...overrides,
});
const approveStub = Object.assign(() => undefined, { toString: () => APPROVE_URL });

class FixtureApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// Fake backend behind the real API module: every request is recorded; a route answers with its body or its status.
let routes = {};
let calls = [];
async function fakeApiFetch(path, { method = 'GET', body } = {}) {
	const [pathname] = path.split('?');
	calls.push({ method, path, body });
	const entryRoute = routes[`${method} ${pathname}`];
	if (!entryRoute) throw new Error(`Unexpected request ${method} ${pathname}`);
	if (entryRoute.network) throw new Error('Service unavailable');
	if (entryRoute.status >= 400) throw new FixtureApiError(entryRoute.status, 'backend message', 'CODE');
	return entryRoute.body;
}
const apiShim = { apiFetch: fakeApiFetch, ApiError: FixtureApiError };

async function loadCjs(path, shims = {}) {
	const output = ts.transpileModule(await readFile(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', 'require', '__env', output.replaceAll('import.meta.env', '__env'))(exports, (name) => { if (!(name in shims)) throw new Error(`unshimmed ${name}`); return shims[name]; }, { PUBLIC_API_URL: 'https://backend.invalid' });
	return exports;
}
const sessionShim = { getSession: (jar) => jar.get('session')?.value ?? null, clearSession: () => undefined };
const hygieneApi = await loadCjs('src/pods/hygiene-preventive-draft/api.ts', { '../../shared/apiClient': apiShim, '../../shared/session': sessionShim });
const labels = await loadCjs('src/pods/hygiene-preventive-draft/labels.ts');
const odontogram = await loadCjs('src/pods/hygiene-preventive-draft/odontogram.ts');

async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}
const helpers = {
	$$createAstro: () => ({}), $$createComponent: (component) => component,
	$$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
	$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${value}"`,
	$$maybeRenderHead: () => '', $$renderHead: () => '',
};
const renderComponent = async (_result, _name, component, props, slots) => (typeof component === 'function' ? component({ createAstro: () => ({ props }) }, props, slots) : slots?.default?.() ?? '');

/** Strips the imports and runs the compiled component body with the given mocks; the mocks replace every import. */
async function compileAstro(path, mocks) {
	let code = (await transform(await readFile(new URL(path, root), 'utf8'), { filename: path })).code;
	const ast = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true);
	const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	return exports.default;
}
const readOnlyComponent = (...args) => compileAstro(readOnlyPage, { ...hygieneApi, ...labels, ...odontogram, ...helpers, Fragment: null, $$renderComponent: renderComponent }).then((component) => component(...args));
const consentComponent = (...args) => compileAstro(consentComponentPath, { ...labels, ...helpers, Fragment: null, $$renderComponent: renderComponent }).then((component) => component(...args));
const procedureComponent = (...args) => compileAstro(logComponent, { ...labels, ...helpers, Fragment: null, $$renderComponent: renderComponent }).then((component) => component(...args));

/**
 * Teacher detail page with the given grants, reads and approval result. Returns the rendered HTML, the redirect when the page
 * redirects, and every backend request in order.
 */
async function renderDetail({ grants = [readGrant, approveGrant], routeOverrides = {}, search = query, approval, pageId = id } = {}) {
	routes = {
		[`GET /hygiene-preventive-drafts/${pageId}`]: { body: draft() },
		[`GET /hygiene-preventive-drafts/${pageId}/consent`]: { body: { current_declaration_id: null, declarations: [] } },
		[`GET /hygiene-preventive-drafts/${pageId}/procedures`]: { body: { items: [entry()] } },
		...routeOverrides,
	};
	calls = [];
	const headers = new Headers();
	const Astro = {
		props: {}, params: { id: pageId }, cookies: {}, request: new Request('https://fixture.invalid'),
		url: new URL(`https://fixture.invalid/teacher-clinical/hygiene-preventive/${pageId}?${search}`),
		getActionResult: (action) => (action === approveStub ? approval : undefined), response: { headers }, redirect: (url) => ({ redirect: url }),
	};
	const mocks = {
		...helpers, Layout: null, Fragment: null, ApiError: FixtureApiError,
		HygieneReadOnly: readOnlyComponent, HygieneConsentHistory: consentComponent, HygieneProcedureLog: procedureComponent,
		$$renderComponent: renderComponent,
		teacherGrant: (_cookies, permission) => grants.includes(permission),
		parseClinicalContext: (params) => {
			const get = (key) => { const values = params.getAll(key); if (values.length !== 1 || !/^[0-9a-f-]{36}$/i.test(values[0])) throw new Error('El contexto clínico no es válido.'); return values[0]; };
			return { patient_id: get('patient_id'), subject_id: get('subject_id'), academic_group_id: get('academic_group_id') };
		},
		validId: hygieneApi.validId,
		getHygieneDraft: hygieneApi.getHygieneDraft,
		getHygieneConsent: hygieneApi.getHygieneConsent,
		listHygieneProcedures: hygieneApi.listHygieneProcedures,
		hygieneTimestampLabel: labels.hygieneTimestampLabel,
		parseAssignmentListCoordinates: () => ({ filters: {}, limit: 50, offset: 0 }),
		assignmentListQuery: () => 'limit=50&offset=0',
		assignmentListCarrier: (coordinates) => ({ list_limit: String(coordinates.limit), list_offset: String(coordinates.offset) }),
		actions: { approveHygieneProcedure: approveStub },
		isInputError: (error) => error?.input === true,
		actionHrefWithContext: (href, carried) => `${href}?${new URLSearchParams(carried)}`,
	};
	const component = await compileAstro(detailPage, mocks);
	const value = await component({ createAstro: () => Astro }, {}, {});
	if (value && typeof value === 'object' && 'redirect' in value) return { redirect: value.redirect, calls };
	return { html: await html(value), calls };
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;
/** One form from its opening tag (found through its id) to its closing tag. */
const formOf = (text, formId) => {
	const marker = text.indexOf(`id="${formId}"`);
	if (marker < 0) return '';
	return text.slice(text.lastIndexOf('<form', marker), text.indexOf('</form>', marker));
};

// D5 / S5: the form appears only for pending entries of a teacher with the approve grant.

test('S5 a pending entry gets an approve form that posts to the approval action with the origin context and the entry version', async () => {
	const page = await renderDetail({ routeOverrides: { [`GET /hygiene-preventive-drafts/${id}/procedures`]: { body: { items: [entry({ version: '7' })] } } } });
	const form = formOf(page.html, 'procedure-approve-21');
	assert.match(form, /<form method="POST" action="\/_actions\/approveHygieneProcedure\?patient_id=1111/);
	assert.match(form, /<input type="hidden" name="id" value="9007199254741061"/);
	assert.match(form, /<input type="hidden" name="procedure_id" value="21"/);
	assert.match(form, /<input type="hidden" name="expected_version" value="7"/);
	assert.match(form, /<input type="hidden" name="patient_id" value="11111111-1111-4111-8111-111111111111"/);
	assert.match(form, /<input type="hidden" name="subject_id" value="22222222-2222-4222-8222-222222222222"/);
	assert.match(form, /<input type="hidden" name="academic_group_id" value="33333333-3333-4333-8333-333333333333"/);
});

test('S5 the approve form has the required confirmation checkbox with the D5 wording and the approve button', async () => {
	const page = await renderDetail();
	const form = formOf(page.html, 'procedure-approve-21');
	assert.match(form, /<input type="checkbox" name="approval_confirmed" value="on"[^>]*required/);
	assert.match(form, /Entiendo que la aprobación es definitiva: el alumno ya no podrá editar ni eliminar este procedimiento\./);
	assert.match(form, /<button[^>]*>Aprobar procedimiento<\/button>/);
});

test('S5 an approved entry gets no approve form', async () => {
	const page = await renderDetail({ routeOverrides: { [`GET /hygiene-preventive-drafts/${id}/procedures`]: { body: { items: [approvedEntry()] } } } });
	assert.doesNotMatch(page.html, /procedure-approve-/);
	assert.match(page.html, /Aprobado por Marta Gómez/);
});

test('S5 the page has one form per pending entry and no other form: the draft and consent stay read-only', async () => {
	const page = await renderDetail({ routeOverrides: { [`GET /hygiene-preventive-drafts/${id}/procedures`]: { body: { items: [entry(), entry({ id: '23', version: '2' }), approvedEntry()] } } } });
	assert.equal(count(page.html, /<form /g), 2);
	assert.equal(count(page.html, /method="POST"/g), 2);
});

// D5: without the grant there is no form; the hint explains it when a pending entry is waiting.

test('D5 without the approve grant there is no approve form, and the hint is shown when a pending entry exists', async () => {
	const page = await renderDetail({ grants: [readGrant] });
	assert.doesNotMatch(page.html, /procedure-approve-|approveHygieneProcedure/);
	assert.match(page.html, new RegExp(HINT));
});

test('D5 without the approve grant and with no pending entry the hint is not shown', async () => {
	const page = await renderDetail({ grants: [readGrant], routeOverrides: { [`GET /hygiene-preventive-drafts/${id}/procedures`]: { body: { items: [approvedEntry()] } } } });
	assert.doesNotMatch(page.html, new RegExp(HINT));
});

// S5: the redirect and its notice keep the origin context; a refused approval shows its copy above the log.

test('S5 a successful approval redirects to the detail with the origin context and approved=1, before any read', async () => {
	const page = await renderDetail({
		approval: { data: { success: true, id, procedure_id: '21', patient_id: patient, subject_id: subject, academic_group_id: group } },
	});
	assert.equal(page.redirect, `/teacher-clinical/hygiene-preventive/${id}?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&approved=1`);
	assert.deepEqual(page.calls, []);
});

test('S5 the redirect keeps the assignment choice and the list state of the page it was posted from', async () => {
	const page = await renderDetail({
		search: `${query}&assignment_id=17&list_limit=50&list_offset=0`,
		approval: { data: { success: true, id, procedure_id: '21', patient_id: patient, subject_id: subject, academic_group_id: group } },
	});
	assert.match(page.redirect, /assignment_id=17/);
	assert.match(page.redirect, /list_limit=50&list_offset=0/);
	assert.match(page.redirect, /approved=1$/);
});

test('S5 ?approved=1 shows the success notice', async () => {
	const page = await renderDetail({ search: `${query}&approved=1` });
	assert.match(page.html, /<p[^>]*role="status"[^>]*>Procedimiento aprobado\.<\/p>/);
});

test('S5 a refused approval shows its copy above the log and the draft still renders', async () => {
	const page = await renderDetail({
		approval: { data: { success: false, uncertain: false, error: STALE, procedure_id: '21', expected_version: '4' } },
	});
	assert.match(page.html, new RegExp(STALE));
	assert.ok(page.html.indexOf(STALE) < page.html.indexOf('Registrado por'), 'the copy sits above the log');
	assert.match(page.html, /Losartán/);
});

test('S5 a stale refusal re-renders the entry with its current version, so the next approve form carries it', async () => {
	const page = await renderDetail({
		routeOverrides: { [`GET /hygiene-preventive-drafts/${id}/procedures`]: { body: { items: [entry({ version: '5' })] } } },
		approval: { data: { success: false, uncertain: false, error: STALE, procedure_id: '21', expected_version: '4' } },
	});
	assert.match(formOf(page.html, 'procedure-approve-21'), /<input type="hidden" name="expected_version" value="5"/);
});

test('S5 an uncertain approval says to reload and shows no approve form until the page is reloaded', async () => {
	const page = await renderDetail({
		approval: { data: { success: false, uncertain: true, error: UNCERTAIN, procedure_id: '21', expected_version: '4' } },
	});
	assert.match(page.html, new RegExp(UNCERTAIN));
	assert.doesNotMatch(page.html, /procedure-approve-/);
	assert.match(page.html, /Registrado por Ana Pérez/);
});

test('S5 an invalid submit shows the form copy, and a framework error is treated as unconfirmed', async () => {
	const invalid = await renderDetail({ approval: { error: { input: true } } });
	assert.match(invalid.html, new RegExp(FORM_COPY));
	const framework = await renderDetail({ approval: { error: { input: false } } });
	assert.match(framework.html, new RegExp(UNCERTAIN));
	assert.doesNotMatch(framework.html, /procedure-approve-/);
});

test('S5 a session that expired while approving redirects to login', async () => {
	const page = await renderDetail({
		approval: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.', procedure_id: '21', expected_version: '4' } },
	});
	assert.match(page.redirect, /^\/auth\/login\?returnTo=/);
});

// S5: student and admin views get no approval, and the page script guards against a second submit.

test('S5 the student and admin pages carry no approval action', async () => {
	for (const path of ['src/pages/hygiene-preventive-drafts/[id].astro', 'src/pages/hygiene-preventive-admin/[id].astro']) {
		const source = await readFile(new URL(path, root), 'utf8');
		assert.doesNotMatch(source, /approveHygieneProcedure|procedure-approve|data-approval-form/, path);
	}
});

test('S5 the approval forms are guarded against a second submit in the page script', async () => {
	const source = await readFile(new URL(detailPage, root), 'utf8');
	assert.match(source, /querySelectorAll<HTMLFormElement>\('\[data-approval-form\]'\)/);
	assert.match(source, /approvalForm\.dataset\.submitting === 'true'/);
	assert.match(source, /approvalForm\.dataset\.submitting = 'true'/);
});
