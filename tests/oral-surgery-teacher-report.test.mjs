import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { formDataFromHtml, realListingModule } from './helpers/clinical-form-submit.mjs';

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
const PRACTICAL_FAILED_READ = 'No se pudo consultar la evaluación práctica. No se habilita la calificación ni la corrección.';
const PRACTICAL_UNCERTAIN = 'No se pudo confirmar el guardado de la evaluación práctica. Recargá la página antes de volver a intentarlo; no repetimos el envío automáticamente.';
const PRACTICAL_SCORES = 'Revisá los puntajes: cada ítem debe ser un número entero desde 0 hasta su máximo.';
const PRACTICAL_REASON = 'Escribí un motivo de hasta 4000 caracteres, sin caracteres nulos.';
const PRACTICAL_ALREADY = 'Ya existe una evaluación práctica para este encuentro. Recargá la página para ver la calificación vigente.';
const PRACTICAL_CHANGED = 'La evaluación práctica cambió. Recargá la página para ver la revisión vigente antes de corregir.';
const GRADE_CLOSED_NOTICE = 'La evaluación práctica se habilita cuando el parte quirúrgico está cerrado.';
const NO_GRADE_GRANT = 'Esta consulta no otorga permiso para calificar.';
const CHECK_STATUS = 'Consultá el estado antes de volver a calificar.';
const PREVIEW_NOTE = 'Vista previa: el servidor confirma el total al guardar.';

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
// Mirrors PRACTICAL_RUBRIC in src/pods/oral-surgery-draft/api.ts; keys and maxima are the S2 contract.
const PRACTICAL_RUBRIC = [
 { key: 'hand_washing', max: 1 }, { key: 'barrier_elements', max: 1 }, { key: 'waste_disposal', max: 1 },
 { key: 'clinical_table_setup', max: 2 }, { key: 'asepsis', max: 1 }, { key: 'anamnesis_questionnaire', max: 3 },
 { key: 'anesthetic_technique', max: 2 }, { key: 'sindesmotomy_elevators', max: 2 }, { key: 'surgical_procedure', max: 3 },
 { key: 'curettage_suture', max: 2 }, { key: 'record_and_equipment', max: 1 }, { key: 'relationship', max: 1 },
];
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

// Real read-only practical component; its rubric and labels come from the mirrored rubric and the real labels module.
const practicalReadOnlyComponent = await compileAstro('src/components/clinical/PracticalEvaluationReadOnly.astro', {
 PRACTICAL_RUBRIC,
 PRACTICAL_MAX_TOTAL: PRACTICAL_RUBRIC.reduce((sum, item) => sum + item.max, 0),
 PRACTICAL_LABELS: labels.PRACTICAL_LABELS,
 practicalSummaryLabel: labels.practicalSummaryLabel,
 oralSurgeryTimestampLabel: labels.oralSurgeryTimestampLabel,
 ...helpers,
});

async function renderPage(options = {}) {
 const requests = [];
 const headers = new Headers();
 const grants = {
  'oral-surgery-drafts:read': options.read !== false,
  'oral-surgery-drafts:authorize': options.authorize !== false,
  'oral-surgery-drafts:close': options.close !== false,
  'oral-surgery-drafts:grade': options.grade !== false,
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
  PracticalEvaluationReadOnly: practicalReadOnlyComponent, PRACTICAL_RUBRIC, PRACTICAL_LABELS: labels.PRACTICAL_LABELS,
  actions: {
   authorizeOralSurgeryDraft: 'authorize', closeOralSurgeryOperativeReport: 'close',
   gradeOralSurgeryPracticalEvaluation: 'grade', correctOralSurgeryPracticalEvaluation: 'correct',
  },
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
  getPracticalEvaluation: async (id) => { requests.push(['practical', id]); if (options.practicalError) throw options.practicalError; return options.practical ?? null; },
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
 assert.deepEqual(requests, [['draft', draftId], ['consent', draftId], ['authorizations', draftId], ['report', draftId], ['practical', draftId]]);
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

// ---- Practical evaluation: grade, correction, history and preview -------------------------

const PRACTICAL_KEYS = PRACTICAL_RUBRIC.map(({ key }) => key);
const practicalMax = Object.fromEntries(PRACTICAL_RUBRIC.map(({ key, max }) => [key, max]));
// Sums to 14 of 20 (annulled), with some items below maximum so the correction prefill is observable.
const practicalItems = { hand_washing: 1, barrier_elements: 0, waste_disposal: 1, clinical_table_setup: 2, asepsis: 0, anamnesis_questionnaire: 2, anesthetic_technique: 1, sindesmotomy_elevators: 2, surgical_procedure: 2, curettage_suture: 1, record_and_equipment: 1, relationship: 1 };
const revisionFixture = (overrides = {}) => ({
 revision: '1', items: practicalItems, total: 14, outcome: 'annulled', reason: null, graded_by: teacherId, teacher_habilitation_id: habilitationId, graded_at: closedAt, ...overrides,
});
const teacherPracticalView = (history = [revisionFixture()]) => ({ current: history.at(-1), history });
const maximumScores = (overrides = {}) => ({ ...Object.fromEntries(PRACTICAL_KEYS.map((key) => [key, String(practicalMax[key])])), ...overrides });
const hasAttribute = (tag, name) => new RegExp(`\\s${name}(?=[\\s/>]|$)`).test(tag);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const selectsOf = (markup) => [...markup.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(([select]) => {
 const open = select.match(/<select\b[^>]*>/)[0];
 const options = [...select.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/g)].map(([option]) => {
  const tag = option.match(/<option\b[^>]*>/)[0];
  return { value: attribute(tag, 'value'), selected: hasAttribute(tag, 'selected'), text: option.replace(/<[^>]*>/g, '') };
 });
 return { name: attribute(open, 'name'), max: attribute(open, 'data-max'), required: hasAttribute(open, 'required'), options };
});
const textareaOf = (markup) => markup.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/)?.[0] ?? '';
const textareaValue = (markup) => textareaOf(markup).replace(/^<textarea\b[^>]*>/, '').replace(/<\/textarea>$/, '');

test('the practical section follows the operative report section', async () => {
 const { html } = await renderPage({ report: closedFixture(), practical: teacherPracticalView() });
 assert.match(html, /<h2 id="practical-title"[^>]*>Evaluación práctica<\/h2>/);
 const report = html.indexOf('<h2 id="report-title"');
 const practical = html.indexOf('<h2 id="practical-title"');
 assert.ok(report > -1 && practical > report, 'the practical section must come after the report section');
 assert.ok(html.indexOf('</section>', report) < practical, 'the report section must close before the practical section starts');
});

test('the grade form appears only with the grant, a closed report and no grade, with exact hidden fields and one required select per item', async () => {
 const { html } = await renderPage({ report: closedFixture() });
 const form = formBlock(html, 'grade-form');
 assert.ok(form, 'grade form must render');
 assert.match(form, /<form method="POST" action="grade\?/);
 assert.deepEqual(hiddenFields(form), { id: draftId, patient_id: patientId, subject_id: subjectId, academic_group_id: groupId });
 const selects = selectsOf(form);
 assert.deepEqual(selects.map((select) => select.name), PRACTICAL_KEYS);
 for (const select of selects) {
  assert.equal(select.max, String(practicalMax[select.name]), `${select.name} exposes its maximum`);
  assert.ok(select.required, `${select.name} must be required`);
  assert.deepEqual(select.options[0], { value: '', selected: true, text: 'Elegí un puntaje' });
  assert.deepEqual(select.options.slice(1).map((option) => option.value), Array.from({ length: practicalMax[select.name] + 1 }, (_, score) => String(score)));
  assert.ok(select.options.slice(1).every((option) => option.text === `${option.value}/${practicalMax[select.name]}`), `${select.name} shows its /max`);
  assert.ok(select.options.slice(1).every((option) => !option.selected), `${select.name} has no default answer`);
 }
 for (const key of PRACTICAL_KEYS) assert.ok(form.includes(labels.PRACTICAL_LABELS[key]), `${key} uses its Spanish label`);
 assert.doesNotMatch(form, /type="checkbox"/, 'the grade form has no confirmation checkbox');
 assert.match(form, /<button[^>]*>Registrar evaluación práctica<\/button>/);
});

test('the grade form stays hidden when the report is open or unreadable, the grant is missing, a grade exists, the evaluation read failed or the grade outcome is uncertain', async () => {
 assert.doesNotMatch((await renderPage({ report: reportFixture() })).html, /id="grade-form"/);
 assert.doesNotMatch((await renderPage({ reportError: new FixtureApiError(500, 'failed') })).html, /id="grade-form"/);
 assert.doesNotMatch((await renderPage({ report: closedFixture(), grade: false })).html, /id="grade-form"/);
 assert.doesNotMatch((await renderPage({ report: closedFixture(), practical: teacherPracticalView() })).html, /id="grade-form"/);
 assert.doesNotMatch((await renderPage({ report: closedFixture(), practicalError: new FixtureApiError(500, 'failed') })).html, /id="grade-form"/);
 const uncertain = await renderPage({ report: closedFixture(), results: { grade: { data: { success: false, uncertain: true, error: PRACTICAL_UNCERTAIN } } } });
 assert.doesNotMatch(uncertain.html, /id="grade-form"/);
 assert.match(uncertain.html, new RegExp(`role="alert"[^>]*>${escapeRegExp(PRACTICAL_UNCERTAIN)}`));
 assert.match(uncertain.html, new RegExp(`role="status"[^>]*>${escapeRegExp(CHECK_STATUS)}`));
});

test('the practical section explains why grading is unavailable: report still open, no grant', async () => {
 const open = await renderPage({ report: reportFixture() });
 assert.match(open.html, new RegExp(`>${escapeRegExp(GRADE_CLOSED_NOTICE)}<`));
 assert.doesNotMatch(open.html, /id="grade-form"/);
 const noGrant = await renderPage({ report: closedFixture(), grade: false });
 assert.match(noGrant.html, new RegExp(`>${escapeRegExp(NO_GRADE_GRANT)}<`));
 assert.doesNotMatch(noGrant.html, /id="grade-form"/);
});

test('the correction form is prefilled with the current items and expected revision, requires a reason and keeps the history explanation', async () => {
 const { html } = await renderPage({ report: closedFixture(), practical: teacherPracticalView() });
 const form = formBlock(html, 'correct-form');
 assert.ok(form, 'correction form must render');
 assert.match(form, /<form method="POST" action="correct\?/);
 assert.deepEqual(hiddenFields(form), { id: draftId, patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, expected_revision: '1' });
 const selects = selectsOf(form);
 assert.deepEqual(selects.map((select) => select.name), PRACTICAL_KEYS);
 for (const select of selects) {
  assert.ok(select.required, `${select.name} must be required`);
  assert.deepEqual(select.options.filter((option) => option.selected).map((option) => option.value), [String(practicalItems[select.name])], `${select.name} is prefilled`);
 }
 const reason = textareaOf(form);
 assert.match(reason, /<textarea\b[^>]*name="reason"/);
 assert.match(reason, /maxlength="4000"/);
 assert.match(reason, /\srequired[\s>]/);
 assert.match(form, /Motivo de la corrección\s*<textarea/);
 assert.match(form, /<button[^>]*>Registrar corrección<\/button>/);
 assert.match(form, /La corrección crea una revisión nueva; la calificación anterior queda en el historial\./);
 assert.doesNotMatch(form, /type="checkbox"/);
 assert.doesNotMatch(html, /id="grade-form"/, 'a graded encounter never shows the grade form');
});

test('the correction form stays hidden without a grade, without the grant, with an open report, when the evaluation read failed or on an uncertain correction', async () => {
 assert.doesNotMatch((await renderPage({ report: closedFixture() })).html, /id="correct-form"/);
 assert.doesNotMatch((await renderPage({ report: reportFixture(), practical: teacherPracticalView() })).html, /id="correct-form"/);
 assert.doesNotMatch((await renderPage({ report: closedFixture(), grade: false, practical: teacherPracticalView() })).html, /id="correct-form"/);
 assert.doesNotMatch((await renderPage({ report: closedFixture(), practicalError: new FixtureApiError(500, 'failed') })).html, /id="correct-form"/);
 const uncertain = await renderPage({ report: closedFixture(), practical: teacherPracticalView(), results: { correct: { data: { success: false, uncertain: true, error: PRACTICAL_UNCERTAIN } } } });
 assert.doesNotMatch(uncertain.html, /id="correct-form"/);
 assert.match(uncertain.html, new RegExp(`role="status"[^>]*>${escapeRegExp(CHECK_STATUS)}`));
});

test('every revision with its reason and author is shown in the history', async () => {
 const first = revisionFixture();
 const second = revisionFixture({ revision: '2', items: { ...practicalItems, asepsis: 1 }, total: 15, outcome: 'approved', reason: 'Error de digitación en asepsia', graded_at: '2026-11-08T09:00:00.000Z' });
 const { html } = await renderPage({ report: closedFixture(), practical: teacherPracticalView([first, second]) });
 assert.match(html, /<h3[^>]*>Historial<\/h3>/);
 assert.equal((html.match(/<dt[^>]*>Revisión<\/dt>/g) ?? []).length, 2);
 assert.match(html, /<dt[^>]*>Motivo<\/dt>\s*<dd[^>]*>Error de digitación en asepsia<\/dd>/);
 assert.match(html, /Total: 15\/20 · Aprobado/);
 assert.match(html, /Total: 14\/20 · Anulado/);
});

test('a confirmed grade redirects with graded=1 and a confirmed correction with corrected=1, reading nothing first', async () => {
 const graded = await renderPage({ results: { grade: { data: { success: true, id: draftId, ...context } } } });
 assert.equal(graded.html, `REDIRECT:/teacher-clinical/oral-surgery/${draftId}?${query}&graded=1`);
 assert.deepEqual(graded.requests, []);
 const corrected = await renderPage({ results: { correct: { data: { success: true, id: draftId, ...context } } } });
 assert.equal(corrected.html, `REDIRECT:/teacher-clinical/oral-surgery/${draftId}?${query}&corrected=1`);
 assert.deepEqual(corrected.requests, []);
});

test('the success notices name the saved action', async () => {
 const graded = await renderPage({ query: `${query}&graded=1`, report: closedFixture(), practical: teacherPracticalView() });
 assert.match(graded.html, /role="status"[^>]*>Evaluación práctica registrada\./);
 const corrected = await renderPage({ query: `${query}&corrected=1`, report: closedFixture(), practical: teacherPracticalView() });
 assert.match(corrected.html, /role="status"[^>]*>Corrección registrada\./);
});

test('a typed grade failure shows its copy and re-renders the submitted scores in the grade form', async () => {
 const values = maximumScores({ asepsis: '0', hand_washing: '' });
 const { html } = await renderPage({ report: closedFixture(), results: { grade: { data: { success: false, uncertain: false, conflict: false, error: PRACTICAL_SCORES, values } } } });
 assert.match(html, new RegExp(`role="alert"[^>]*>${escapeRegExp(PRACTICAL_SCORES)}`));
 const submitted = formDataFromHtml(html, 'grade-form').data;
 assert.equal(submitted.get('asepsis'), '0');
 assert.equal(submitted.get('hand_washing'), '');
 assert.equal(submitted.get('relationship'), '1');
});

test('a typed correction failure re-renders the submitted scores and reason', async () => {
 const values = { ...maximumScores({ asepsis: '1' }), expected_revision: '1', reason: 'Motivo de prueba' };
 const { html } = await renderPage({ report: closedFixture(), practical: teacherPracticalView(), results: { correct: { data: { success: false, uncertain: false, conflict: false, error: PRACTICAL_REASON, values } } } });
 assert.match(html, new RegExp(`role="alert"[^>]*>${escapeRegExp(PRACTICAL_REASON)}`));
 const submitted = formDataFromHtml(html, 'correct-form').data;
 assert.equal(submitted.get('asepsis'), '1');
 assert.equal(submitted.get('expected_revision'), '1');
 assert.equal(textareaValue(html.slice(html.indexOf('id="correct-form"'))), 'Motivo de prueba');
});

test('a conflict shows the stored state instead of the submitted values', async () => {
 const values = maximumScores({ asepsis: '1' });
 const grade = await renderPage({ report: closedFixture(), practical: teacherPracticalView(), results: { grade: { data: { success: false, uncertain: false, conflict: true, error: PRACTICAL_ALREADY, values } } } });
 assert.match(grade.html, new RegExp(`role="alert"[^>]*>${escapeRegExp(PRACTICAL_ALREADY)}`));
 assert.match(grade.html, /<dt[^>]*>Resultado<\/dt>/);
 assert.doesNotMatch(grade.html, /id="grade-form"/);
 const correction = await renderPage({ report: closedFixture(), practical: teacherPracticalView(), results: { correct: { data: { success: false, uncertain: false, conflict: true, error: PRACTICAL_CHANGED, values } } } });
 assert.match(correction.html, new RegExp(`role="alert"[^>]*>${escapeRegExp(PRACTICAL_CHANGED)}`));
 assert.equal(formDataFromHtml(correction.html, 'correct-form').data.get('asepsis'), '0');
 assert.equal(textareaValue(correction.html.slice(correction.html.indexOf('id="correct-form"'))), '');
});

test('an evaluation read failure keeps the rest of the page and shows no practical forms', async () => {
 const { html } = await renderPage({ report: reportFixture(), practicalError: new FixtureApiError(500, 'failed') });
 assert.match(html, new RegExp(`role="alert"[^>]*>${escapeRegExp(PRACTICAL_FAILED_READ)}`));
 assert.doesNotMatch(html, /id="grade-form"|id="correct-form"/);
 assert.match(html, /<h2 id="report-title"[^>]*>Parte quirúrgico<\/h2>/);
 assert.match(html, /Autorizar esta versión/);
 assert.match(html, /Dolor en pieza 38/);
});

test('an expired session while reading the practical evaluation redirects to login', async () => {
 const result = await renderPage({ practicalError: new FixtureApiError(401, 'expired') });
 assert.equal(result.html, `REDIRECT:/auth/login?returnTo=${encodeURIComponent(`/teacher-clinical/oral-surgery/${draftId}?${query}`)}`);
});

// Browser-side behavior: the page script runs against a minimal DOM double with the real rubric maxima.
function fakeSelect(name, max, value = '') {
 return { name, dataset: { max: String(max) }, value };
}
function fakeForm(selects = [], label = '') {
 const handlers = new Map();
 const button = { disabled: false, textContent: label };
 return {
  selects, dataset: {}, button,
  addEventListener(name, callback) { handlers.set(name, callback); },
  emit(name, event = {}) { handlers.get(name)?.(event); },
  querySelector: () => button,
  querySelectorAll: () => selects,
 };
}
async function runPageScript(elements) {
 const page = await readFile(new URL(pagePath, root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script, 'page script must exist');
 const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { document: { querySelector: (selector) => elements[selector] ?? null, querySelectorAll: () => [] } });
}

test('the page script sends the grade form a live preview with the pass threshold of 15 and the agreed copy', async () => {
 const page = await readFile(new URL(pagePath, root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
 assert.match(script, /PASSING_TOTAL = 15/);
 assert.ok(script.includes(PREVIEW_NOTE), 'the preview carries the server-confirmation note');
 assert.ok(script.includes('Total parcial:') && script.includes('faltan ítems por calificar'));
 const selects = PRACTICAL_RUBRIC.map(({ key, max }) => fakeSelect(key, max));
 const form = fakeForm(selects, 'Registrar evaluación práctica');
 const preview = { textContent: '' };
 await runPageScript({ '#grade-form': form, '#grade-preview': preview });
 assert.equal(preview.textContent, 'Total parcial: 0/20 · faltan ítems por calificar');
 const set = (name, value) => { selects.find((select) => select.name === name).value = value; form.emit('change'); };
 for (const { key, max } of PRACTICAL_RUBRIC) selects.find((select) => select.name === key).value = String(max);
 form.emit('change');
 assert.equal(preview.textContent, `Total: 20/20 · Aprobado. ${PREVIEW_NOTE}`);
 set('anamnesis_questionnaire', '1');
 set('surgical_procedure', '0');
 assert.equal(preview.textContent, `Total: 15/20 · Aprobado. ${PREVIEW_NOTE}`);
 set('anamnesis_questionnaire', '0');
 assert.equal(preview.textContent, `Total: 14/20 · Anulado. ${PREVIEW_NOTE}`);
 set('asepsis', '');
 assert.equal(preview.textContent, 'Total parcial: 13/20 · faltan ítems por calificar');
});

test('the correction preview starts from the prefilled items and recomputes on change', async () => {
 const selects = PRACTICAL_RUBRIC.map(({ key, max }) => fakeSelect(key, max, String(practicalItems[key])));
 const form = fakeForm(selects, 'Registrar corrección');
 const preview = { textContent: '' };
 await runPageScript({ '#correct-form': form, '#correction-preview': preview });
 assert.equal(preview.textContent, `Total: 14/20 · Anulado. ${PREVIEW_NOTE}`);
 selects.find((select) => select.name === 'anamnesis_questionnaire').value = '3';
 form.emit('change');
 assert.equal(preview.textContent, `Total: 15/20 · Aprobado. ${PREVIEW_NOTE}`);
});

test('the grade and correction forms are double-submit protected with their own busy labels', async () => {
 const grade = fakeForm([], 'Registrar evaluación práctica');
 const correct = fakeForm([], 'Registrar corrección');
 await runPageScript({ '#grade-form': grade, '#correct-form': correct });
 let prevented = 0;
 const event = () => ({ preventDefault() { prevented++; } });
 grade.emit('submit', event());
 assert.equal(grade.button.disabled, true);
 assert.equal(grade.button.textContent, 'Registrando…');
 grade.emit('submit', event());
 assert.equal(prevented, 1);
 assert.equal(correct.button.disabled, false);
 correct.emit('submit', event());
 assert.equal(correct.button.disabled, true);
 assert.equal(correct.button.textContent, 'Registrando corrección…');
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
