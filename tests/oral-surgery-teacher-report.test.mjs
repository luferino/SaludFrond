import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { realListingModule } from './helpers/clinical-form-submit.mjs';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/teacher-clinical/oral-surgery/[id].astro';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patientId = '11111111-1111-4111-8111-111111111111';
const subjectId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const authorId = '44444444-4444-4444-8444-444444444444';
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitationId = '66666666-6666-4666-8666-666666666666';
const draftId = '9007199254741061';
const iso = '2026-11-06T12:00:00.000Z';
const closedAt = '2026-11-07T10:00:00.000Z';
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
const query = new URLSearchParams(context).toString();

const UNAVAILABLE = /El borrador no está disponible en este contexto de origen\./;
const REPORT_LOAD_FAILED = 'No se pudo consultar el parte quirúrgico. No se habilita la autorización ni el cierre.';
const CLOSE_UNCERTAIN = 'No se pudo confirmar el cierre. Actualizá la ficha antes de volver a intentarlo; no repetimos el envío automáticamente.';
const CLOSE_CHECKBOX = 'Revisé el parte quirúrgico y confirmo que está listo para cerrarse. El cierre es irreversible.';

const content = {
 admission_date: '2026-11-06',
 medical_history: { hospitalized: false, consultation_reason: 'Dolor en pieza 38' },
 preoperative: { tooth: '38' },
 treatment_plan: { procedure: 'Exodoncia simple', anomalies_or_pathology: null },
};
const reportContent = {
 narrative: 'Exodoncia sin complicaciones',
 asepsis: { extraoral: 'Clorhexidina', intraoral: null },
 postoperative_instructions: null,
};
// Mirrors OPERATIVE_REPORT_LAYOUT in src/pods/oral-surgery-draft/api.ts; the read-only component only needs these keys.
const OPERATIVE_REPORT_LAYOUT = [
 { key: 'narrative', fields: null },
 { key: 'asepsis', fields: ['extraoral', 'intraoral'] },
 { key: 'anesthesia', fields: ['technique', 'drug', 'dose'] },
 { key: 'extraction', fields: ['teeth', 'technique', 'suture'] },
 { key: 'prescription', fields: ['medications', 'commercial_name', 'route', 'dose', 'frequency', 'duration'] },
 { key: 'postoperative_instructions', fields: null },
 { key: 'operative_incident', fields: null },
];

const draftFixture = (overrides = {}) => ({
 id: draftId, clinical_record_id: '9007199254741060', patient_id: patientId, author_id: authorId,
 origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
 content, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const declarationFixture = (overrides = {}) => ({
 id: '7', draft_id: draftId, draft_version: '3', plan_revision: '2', treatment_plan: content.treatment_plan,
 declared_by: authorId, declared_at: iso, ...overrides,
});
const authorizationFixture = (overrides = {}) => ({
 id: '11', draft_id: draftId, draft_version: '3', consent_declaration_id: '7', reviewed_content: content,
 authorized_by: teacherId, teacher_habilitation_id: habilitationId, authorized_at: iso, ...overrides,
});
const consentFixture = (overrides = {}) => ({
 draft_version: '3', plan_revision: '2', current_declaration_id: '7', declarations: [declarationFixture()], ...overrides,
});
const historyFixture = (overrides = {}) => ({ draft_version: '3', current_authorization_id: null, authorizations: [], ...overrides });
const reportFixture = (overrides = {}) => ({
 draft_id: draftId, draft_version: '3', authorization_id: '11', content: reportContent, version: '2', status: 'draft',
 created_by: authorId, created_at: iso, updated_at: iso, closed_by: null, closed_at: null, teacher_habilitation_id: null, ...overrides,
});
const closedFixture = (overrides = {}) => reportFixture({
 version: '3', status: 'closed', closed_by: teacherId, closed_at: closedAt, teacher_habilitation_id: habilitationId, ...overrides,
});

class FixtureApiError extends Error {
 constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ---- Page render harness (same pattern as oral-surgery-teacher.test.mjs) -----------------

async function loadCjs(path) {
 const output = ts.transpileModule(await readFile(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const exports = {};
 new Function('exports', output)(exports);
 return exports;
}
const labels = await loadCjs('src/pods/oral-surgery-draft/labels.ts');
const listCoordinates = await loadCjs('src/pods/patient-assignment/list-coordinates.ts');
const listing = await realListingModule();

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

// Real read-only renderers; their section maps come from the real labels module.
const readOnlyMocks = {
 ORAL_SURGERY_SECTIONS: Object.fromEntries(Object.keys(labels.ORAL_SURGERY_SECTION_LABELS).map((name) => [name, {}])),
 ORAL_SURGERY_FIELD_LABELS: labels.ORAL_SURGERY_FIELD_LABELS,
 ORAL_SURGERY_SECTION_LABELS: labels.ORAL_SURGERY_SECTION_LABELS,
 oralSurgeryAnswerLabel: labels.oralSurgeryAnswerLabel,
 ...helpers,
};
const readOnlyComponent = await compileAstro('src/components/clinical/OralSurgeryReadOnly.astro', readOnlyMocks);
const reportReadOnlyComponent = await compileAstro('src/components/clinical/OperativeReportReadOnly.astro', {
 OPERATIVE_REPORT_LAYOUT,
 OPERATIVE_REPORT_LABELS: labels.OPERATIVE_REPORT_LABELS,
 operativeReportStatusLabel: labels.operativeReportStatusLabel,
 oralSurgeryAnswerLabel: labels.oralSurgeryAnswerLabel,
 oralSurgeryTimestampLabel: labels.oralSurgeryTimestampLabel,
 ...helpers,
 // The closure fields render inside a fragment, which the compiler emits as a Fragment component.
 Fragment: null,
 $$renderComponent: async (_result, _name, _component, _props, slots) => slots?.default?.() ?? '',
});

async function renderPage(options = {}) {
 const requests = [];
 const headers = new Headers();
 const grants = {
  'oral-surgery-drafts:read': options.read !== false,
  'oral-surgery-drafts:authorize': options.authorize !== false,
  'oral-surgery-drafts:close': options.close !== false,
 };
 const Astro = {
  props: {}, params: { id: draftId }, cookies: {},
  url: new URL(`https://fixture.invalid/teacher-clinical/oral-surgery/${draftId}?${options.query ?? query}`),
  request: new Request('https://fixture.invalid'),
  getActionResult: (action) => options.results?.[action],
  response: { headers },
  redirect: (url) => `REDIRECT:${url}`,
 };
 const mocks = {
  ...helpers,
  ...listCoordinates,
  clinicalFilterCarrier: listing.clinicalFilterCarrier,
  oralSurgeryTimestampLabel: labels.oralSurgeryTimestampLabel,
  Layout: null, Fragment: null, OralSurgeryReadOnly: readOnlyComponent, OperativeReportReadOnly: reportReadOnlyComponent, ApiError: FixtureApiError,
  actions: { authorizeOralSurgeryDraft: 'authorize', closeOralSurgeryOperativeReport: 'close' },
  isInputError: (error) => error?.input === true,
  // Mirrors actionHrefWithContext: the clean context becomes the query string of the action href.
  actionHrefWithContext: (action, params) => `${action}?${new URLSearchParams(params)}`,
  teacherGrant: (_cookies, permission) => grants[permission] ?? false,
  parseClinicalContext: (params) => {
   const get = (key) => {
    const values = params.getAll(key);
    if (values.length !== 1 || !UUID.test(values[0])) throw new Error('El contexto clínico no es válido.');
    return values[0];
   };
   return { patient_id: get('patient_id'), subject_id: get('subject_id'), academic_group_id: get('academic_group_id') };
  },
  getOralSurgeryDraft: async (id) => { requests.push(['draft', id]); if (options.draftError) throw options.draftError; return options.draft ?? draftFixture(); },
  getConsentHistory: async (id) => { requests.push(['consent', id]); return options.consent ?? consentFixture(); },
  getAuthorizationHistory: async (id) => { requests.push(['authorizations', id]); return options.authorizations ?? historyFixture(); },
  getOperativeReport: async (id) => { requests.push(['report', id]); if (options.reportError) throw options.reportError; return options.report ?? null; },
  $$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => ({ ...Astro, props }) }, props, slots) : slots?.default?.() ?? '',
 };
 const page = await compileAstro(pagePath, mocks);
 return { html: await html(page({ createAstro: () => Astro }, {}, {})), requests, headers };
}

const formBlock = (markup, id) => markup.match(new RegExp(`<form[^>]*id="${id}"[^>]*>[\\s\\S]*?</form>`))?.[0] ?? '';
const attribute = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const hiddenFields = (markup) => Object.fromEntries([...markup.matchAll(/<input[^>]*type="hidden"[^>]*>/g)].map(([tag]) => [attribute(tag, 'name'), attribute(tag, 'value')]));

// ---- Report section: read, empty state and read-only display -----------------------------

test('the operative report is read only after the draft passes the origin guard', async () => {
 const { requests } = await renderPage({ report: null });
 assert.deepEqual(requests, [['draft', draftId], ['consent', draftId], ['authorizations', draftId], ['report', draftId]]);
 const foreign = await renderPage({ draft: draftFixture({ origin_group_id: '77777777-7777-4777-8777-777777777777' }) });
 assert.deepEqual(foreign.requests, [['draft', draftId]]);
 const unknown = await renderPage({ draftError: new FixtureApiError(404, 'oral surgery draft was not found') });
 assert.deepEqual(unknown.requests, [['draft', draftId]]);
 assert.match(unknown.html, UNAVAILABLE);
});

test('a draft without an operative report shows the empty copy and no report or close control', async () => {
 const { html } = await renderPage({ report: null });
 assert.match(html, /<h2 id="report-title"[^>]*>Parte quirúrgico<\/h2>/);
 assert.match(html, /El alumno todavía no guardó el parte quirúrgico\./);
 assert.doesNotMatch(html, /Versión del parte/);
 assert.doesNotMatch(html, /id="close-form"/);
 assert.doesNotMatch(html, /name="ready_confirmed"/);
});

test('an open report is shown read-only with its status and both versions', async () => {
 const { html } = await renderPage({ report: reportFixture() });
 assert.match(html, /Abierto: pendiente de cierre docente/);
 assert.match(html, /Versión del parte<\/dt>\s*<dd[^>]*>2<\/dd>/);
 assert.match(html, /Versión clínica<\/dt>\s*<dd[^>]*>3<\/dd>/);
 assert.match(html, /Exodoncia sin complicaciones/);
 assert.doesNotMatch(html, /Cerrado por<\/dt>/);
 assert.doesNotMatch(html, /El alumno todavía no guardó el parte quirúrgico\./);
});

test('a closed report shows who closed it and when', async () => {
 const { html } = await renderPage({ report: closedFixture() });
 assert.match(html, /Cerrado por el docente/);
 assert.match(html, new RegExp(`Cerrado por</dt>\\s*<dd[^>]*>${teacherId}</dd>`));
 assert.match(html, new RegExp(`Cerrado el</dt>\\s*<dd[^>]*><time datetime="${closedAt}"`));
});

// ---- Close form -------------------------------------------------------------------------

test('the close form appears only with the grant, a draft report and a matching clinical version, with exact hidden fields and the required checkbox', async () => {
 const { html } = await renderPage({ report: reportFixture({ draft_version: '3' }), draft: draftFixture({ version: '3' }) });
 const closeForm = formBlock(html, 'close-form');
 assert.ok(closeForm, 'close form must render');
 assert.match(closeForm, /<form method="POST" action="close\?/);
 assert.deepEqual(hiddenFields(closeForm), {
  id: draftId, patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, expected_version: '2', expected_draft_version: '3',
 });
 assert.equal((closeForm.match(/name="ready_confirmed"/g) ?? []).length, 1);
 assert.match(closeForm, /<input type="checkbox" name="ready_confirmed" value="on"[^>]*required/);
 assert.ok(closeForm.includes(CLOSE_CHECKBOX), 'checkbox copy is the agreed sentence');
 assert.match(closeForm, /<button[^>]*>Cerrar parte quirúrgico<\/button>/);
 const action = new URL(closeForm.match(/action="([^"]+)"/)[1], 'https://fixture.invalid').searchParams;
 for (const [key, value] of Object.entries(context)) assert.equal(action.get(key), value);
});

test('the close form stays hidden without the grant, when the clinical version moved, or when the close result is uncertain', async () => {
 const withoutGrant = await renderPage({ report: reportFixture(), close: false });
 assert.doesNotMatch(withoutGrant.html, /id="close-form"/);
 assert.doesNotMatch(withoutGrant.html, /name="ready_confirmed"/);
 const moved = await renderPage({ report: reportFixture({ draft_version: '2' }), draft: draftFixture({ version: '3' }) });
 assert.doesNotMatch(moved.html, /id="close-form"/);
 const uncertain = await renderPage({ report: reportFixture(), results: { close: { data: { success: false, uncertain: true, error: CLOSE_UNCERTAIN } } } });
 assert.doesNotMatch(uncertain.html, /id="close-form"/);
});

test('a report saved against another clinical version shows a notice with both versions and no close form', async () => {
 const { html } = await renderPage({ report: reportFixture({ draft_version: '2' }), draft: draftFixture({ version: '3' }) });
 assert.match(html, /El parte se guardó contra la versión clínica 2; el borrador está en la versión 3\. El alumno debe volver a guardar el parte para la versión 3 antes de cerrarlo\./);
 assert.doesNotMatch(html, /id="close-form"/);
 assert.match(html, /Abierto: pendiente de cierre docente/);
});

// ---- Closed encounter -------------------------------------------------------------------

test('a closed report hides the close form and the authorize form even when the draft is otherwise authorizable', async () => {
 const sanity = await renderPage({ report: null });
 assert.match(sanity.html, /Autorizar esta versión/, 'the fixture is authorizable without a report');
 const { html } = await renderPage({ report: closedFixture() });
 assert.doesNotMatch(html, /id="close-form"/);
 assert.doesNotMatch(html, /name="paper_consent_verified"/);
 assert.doesNotMatch(html, /Autorizar esta versión/);
 assert.match(html, /El encuentro está cerrado/);
 assert.match(html, /inmutable/);
});

test('a closed encounter keeps the consent and authorization histories visible read-only', async () => {
 const authorized = historyFixture({ current_authorization_id: '11', authorizations: [authorizationFixture()] });
 const { html } = await renderPage({ report: closedFixture(), authorizations: authorized });
 assert.match(html, /Declaración vigente: 7/);
 assert.match(html, /Autorización 11 · versión 3 · declaración 7/);
 assert.match(html, /Autorización docente vigente para la versión 3\./);
});

// ---- Report load failures -----------------------------------------------------------------

test('a report read failure shows its own alert and hides both the authorize and the close forms', async () => {
 const { html } = await renderPage({ reportError: new FixtureApiError(500, 'failed') });
 assert.match(html, new RegExp(`role="alert"[^>]*>${REPORT_LOAD_FAILED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
 assert.doesNotMatch(html, /name="paper_consent_verified"/);
 assert.doesNotMatch(html, /id="close-form"/);
 assert.doesNotMatch(html, /El alumno todavía no guardó el parte quirúrgico\./);
 assert.match(html, /Dolor en pieza 38/);
});

test('an expired session while reading the report redirects to login', async () => {
 const result = await renderPage({ reportError: new FixtureApiError(401, 'expired') });
 assert.equal(result.html, `REDIRECT:/auth/login?returnTo=${encodeURIComponent(`/teacher-clinical/oral-surgery/${draftId}?${query}`)}`);
});

// ---- Action results -----------------------------------------------------------------------

test('a confirmed closure redirects to the same page with the authorize params plus closed=1 and reads nothing first', async () => {
 const result = await renderPage({ results: { close: { data: { success: true, id: draftId, ...context } } } });
 assert.equal(result.html, `REDIRECT:/teacher-clinical/oral-surgery/${draftId}?${query}&closed=1`);
 assert.deepEqual(result.requests, []);
});

test('the page shows the closure notice on closed=1 with the closed report', async () => {
 const { html } = await renderPage({ query: `${query}&closed=1`, report: closedFixture() });
 assert.match(html, /role="status"[^>]*>Parte quirúrgico cerrado\./);
 assert.doesNotMatch(html, /id="close-form"/);
});

test('a typed close failure shows its copy and keeps the close form available', async () => {
 const copy = 'El parte cambió o ya fue cerrado. Revisá la versión actual antes de cerrar.';
 const { html } = await renderPage({ report: reportFixture(), results: { close: { data: { success: false, uncertain: false, error: copy } } } });
 assert.match(html, new RegExp(`role="alert"[^>]*>${copy}`));
 assert.doesNotMatch(html, /Consultá el estado antes de volver a cerrar\./);
 assert.match(html, /id="close-form"/);
});

test('an uncertain close result shows its copy, the status-check line, and hides the close form', async () => {
 const { html } = await renderPage({ report: reportFixture(), results: { close: { data: { success: false, uncertain: true, error: CLOSE_UNCERTAIN } } } });
 assert.match(html, /role="alert"[^>]*>No se pudo confirmar el cierre\./);
 assert.match(html, /role="status"[^>]*>Consultá el estado antes de volver a cerrar\./);
 assert.doesNotMatch(html, /id="close-form"/);
});

test('a framework input error asks to review the form and keeps the close form available', async () => {
 const { html } = await renderPage({ report: reportFixture(), results: { close: { error: { input: true, message: 'bad' } } } });
 assert.match(html, /role="alert"[^>]*>Revisá los campos del formulario\./);
 assert.doesNotMatch(html, /Consultá el estado antes de volver a cerrar\./);
 assert.match(html, /id="close-form"/);
});

test('a framework error outside input validation is uncertain: status-check line and no close form', async () => {
 const { html } = await renderPage({ report: reportFixture(), results: { close: { error: { message: 'boom' } } } });
 assert.match(html, /role="alert"[^>]*>No se pudo confirmar el cierre del parte quirúrgico\./);
 assert.match(html, /role="status"[^>]*>Consultá el estado antes de volver a cerrar\./);
 assert.doesNotMatch(html, /id="close-form"/);
});

test('an expired session on closure redirects to login', async () => {
 const result = await renderPage({ report: reportFixture(), results: { close: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.' } } } });
 assert.equal(result.html, `REDIRECT:/auth/login?returnTo=${encodeURIComponent(`/teacher-clinical/oral-surgery/${draftId}?${query}`)}`);
});

// ---- Browser and compiler guards ----------------------------------------------------------

test('the close form is protected against double submit with the Cerrando… label, without touching the authorize form', async () => {
 const page = await readFile(new URL(pagePath, root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script, 'explicit submit protection must exist');
 const createForm = (label) => {
  const button = { disabled: false, textContent: label };
  const form = { dataset: {}, handler: null, addEventListener(_name, callback) { this.handler = callback; }, querySelector: () => button };
  return { form, button };
 };
 const authorize = createForm('Autorizar esta versión');
 const close = createForm('Cerrar parte quirúrgico');
 const forms = { '#authorize-form': authorize.form, '#close-form': close.form };
 const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { document: { querySelector: (selector) => forms[selector] ?? null, querySelectorAll: () => [] } });
 let prevented = 0;
 const event = () => ({ preventDefault() { prevented++; } });
 close.form.handler(event());
 assert.equal(close.button.disabled, true);
 assert.equal(close.button.textContent, 'Cerrando…');
 close.form.handler(event());
 assert.equal(prevented, 1);
 assert.equal(authorize.button.disabled, false);
 assert.equal(authorize.button.textContent, 'Autorizar esta versión');
});

test('the teacher oral surgery page compiles with @astrojs/compiler and wires the close action', async () => {
 const source = await readFile(new URL(pagePath, root), 'utf8');
 const compiled = await transform(source, { filename: pagePath });
 assert.match(compiled.code, /closeOralSurgeryOperativeReport/);
});
