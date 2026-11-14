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
const actionPath = 'src/pods/oral-surgery-draft/actions/authorizations.ts';
const apiBase = 'https://api.invalid';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patientId = '11111111-1111-4111-8111-111111111111';
const subjectId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const authorId = '44444444-4444-4444-8444-444444444444';
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitationId = '66666666-6666-4666-8666-666666666666';
const draftId = '9007199254741061';
const iso = '2026-11-06T12:00:00.000Z';
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
const query = new URLSearchParams(context).toString();
const draftUrl = `${apiBase}/oral-surgery-drafts/${draftId}`;
const authorizeUrl = `${draftUrl}/authorizations`;
const authorizeGrants = ['oral-surgery-drafts:read', 'oral-surgery-drafts:authorize'];

const UNAVAILABLE = /El borrador no está disponible en este contexto de origen\./;
const VERSION_CHANGED = 'El alumno guardó una versión nueva. Revisala antes de autorizar.';
const UNCERTAIN = 'No se pudo confirmar la autorización. Actualizá la ficha y revisá el historial antes de volver a intentarlo; no repetimos el envío automáticamente.';

const content = {
 admission_date: '2026-11-06',
 medical_history: { hospitalized: false, consultation_reason: 'Dolor en pieza 38' },
 preoperative: { tooth: '38' },
 treatment_plan: { procedure: 'Exodoncia simple', anomalies_or_pathology: null },
};
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

class FixtureApiError extends Error {
 constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function teacherCookies(permissions, role = 'teacher') {
 const token = `header.${Buffer.from(JSON.stringify({ role, permissions, exp: 9999999999 })).toString('base64url')}.signature`;
 return { get: () => ({ value: token }), delete() {} };
}

/** Load the real action module graph (apiClient, teacher grant, oral surgery adapter) against an isolated fetch. */
async function loadModule(fetcher, path) {
 const sandbox = vm.createContext({ URL, URLSearchParams, atob, Date, fetch: fetcher });
 const modules = new Map();
 const create = (url) => {
  if (!modules.has(url.href)) {
   modules.set(url.href, (async () => {
    const code = await readFile(url, 'utf8');
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    return new vm.SourceTextModule(output, {
     context: sandbox, identifier: url.href,
     initializeImportMeta(meta) { meta.env = { PUBLIC_API_URL: apiBase }; },
    });
   })());
  }
  return modules.get(url.href);
 };
 const mod = await create(new URL(path, root));
 await mod.link((specifier, parent) => create(new URL(`${specifier}.ts`, parent.identifier)));
 await mod.evaluate();
 // Results are created inside the vm realm; a JSON round-trip compares them as plain data.
 return { handleAuthorizeOralSurgeryDraft: async (input, options) => JSON.parse(JSON.stringify(await mod.namespace.handleAuthorizeOralSurgeryDraft(input, options))) };
}

/** Fake backend: GET returns the stored draft; POST answers with the configured outcome. Every request is recorded. */
function fakeApi({ draft = draftFixture(), getStatus = 200, getThrow = false, postStatus = 201, postBody, postError, postThrow = false } = {}) {
 const requests = [];
 const fetcher = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  requests.push({ method, url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
  if (method === 'GET') {
   if (getThrow) throw new TypeError('fetch failed');
   if (getStatus !== 200) return Response.json({ error: { code: 'NOT_FOUND', message: 'oral surgery draft was not found' } }, { status: getStatus });
   return Response.json(draft);
  }
  if (postThrow) throw new TypeError('fetch failed');
  if (postError) return Response.json({ error: { code: 'CONFLICT', message: postError } }, { status: postStatus });
  return Response.json(postBody ?? authorizationFixture(), { status: postStatus });
 };
 return { requests, fetcher };
}

const form = (overrides = {}) => ({ id: draftId, ...context, expected_version: '3', consent_declaration_id: '7', paper_consent_verified: 'on', ...overrides });
const posts = (requests) => requests.filter((request) => request.method === 'POST');

// ---- Page render harness -------------------------------------------------------------

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

async function compileAstro(path, mocks, renderComponent) {
 let code = (await transform(await readFile(new URL(path, root), 'utf8'), { filename: path })).code;
 const ast = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true);
 const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
 for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
 const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const exports = {};
 new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
 return exports.default;
}

// Real read-only renderer; the section map only needs its keys, which come from the real labels module.
const readOnlyMocks = {
 ORAL_SURGERY_SECTIONS: Object.fromEntries(Object.keys(labels.ORAL_SURGERY_SECTION_LABELS).map((name) => [name, {}])),
 ORAL_SURGERY_FIELD_LABELS: labels.ORAL_SURGERY_FIELD_LABELS,
 ORAL_SURGERY_SECTION_LABELS: labels.ORAL_SURGERY_SECTION_LABELS,
 oralSurgeryAnswerLabel: labels.oralSurgeryAnswerLabel,
 ...helpers,
};
const readOnlyComponent = await compileAstro('src/components/clinical/OralSurgeryReadOnly.astro', readOnlyMocks);

async function renderPage(options = {}) {
 const requests = [];
 const headers = new Headers();
 const grants = { 'oral-surgery-drafts:read': options.read !== false, 'oral-surgery-drafts:authorize': options.authorize !== false };
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
  Layout: null, Fragment: null, OralSurgeryReadOnly: readOnlyComponent, ApiError: FixtureApiError,
  actions: { authorizeOralSurgeryDraft: 'authorize' },
  isInputError: (error) => error?.input === true,
  actionHrefWithContext: (action) => action,
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
  getConsentHistory: async (id) => { requests.push(['consent', id]); if (options.consentError) throw options.consentError; return options.consent ?? consentFixture(); },
  getAuthorizationHistory: async (id) => { requests.push(['authorizations', id]); if (options.authorizationError) throw options.authorizationError; return options.authorizations ?? historyFixture(); },
  $$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => ({ ...Astro, props }) }, props, slots) : slots?.default?.() ?? '',
 };
 const page = await compileAstro(pagePath, mocks);
 return { html: await html(page({ createAstro: () => Astro }, {}, {})), requests, headers };
}

// ---- Handler: POST /authorizations ---------------------------------------------------

test('D9 authorize sends exactly one GET-then-POST pair with the reviewed version, declaration and literal checkbox', async () => {
 const fake = fakeApi();
 const api = await loadModule(fake.fetcher, actionPath);
 const result = await api.handleAuthorizeOralSurgeryDraft(form(), { cookies: teacherCookies(authorizeGrants) });
 assert.deepEqual(fake.requests, [
  { method: 'GET', url: draftUrl, body: undefined },
  { method: 'POST', url: authorizeUrl, body: { expected_version: '3', consent_declaration_id: '7', paper_consent_verified: true } },
 ]);
 assert.deepEqual(result, { success: true, id: draftId, ...context });
});

test('D9 refuses without the authorize grant, for non-teacher roles, or for malformed input without any request', async () => {
 const cases = [
  [form(), teacherCookies(['oral-surgery-drafts:read']), 'No tenés permiso vigente para autorizar este borrador.'],
  [form(), teacherCookies(['oral-surgery-drafts:authorize'], 'student'), 'No tenés permiso vigente para autorizar este borrador.'],
  [form({ paper_consent_verified: 'off' }), teacherCookies(authorizeGrants), 'Confirmá que verificaste el consentimiento firmado en papel.'],
  [form({ paper_consent_verified: true }), teacherCookies(authorizeGrants), 'Confirmá que verificaste el consentimiento firmado en papel.'],
  [form({ id: '0' }), teacherCookies(authorizeGrants), 'Revisá el borrador, la versión y la declaración seleccionados.'],
  [form({ expected_version: '01' }), teacherCookies(authorizeGrants), 'Revisá el borrador, la versión y la declaración seleccionados.'],
  [form({ consent_declaration_id: 'abc' }), teacherCookies(authorizeGrants), 'Revisá el borrador, la versión y la declaración seleccionados.'],
  [form({ patient_id: 'not-a-uuid' }), teacherCookies(authorizeGrants), 'El contexto clínico no es válido.'],
  [form({ admin: 'x' }), teacherCookies(authorizeGrants), 'El formulario contiene campos no permitidos.'],
  [(({ consent_declaration_id, ...rest }) => rest)(form()), teacherCookies(authorizeGrants), 'El formulario contiene campos no permitidos.'],
 ];
 for (const [input, cookies, copy] of cases) {
  const fake = fakeApi();
  const api = await loadModule(fake.fetcher, actionPath);
  const result = await api.handleAuthorizeOralSurgeryDraft(input, { cookies });
  assert.deepEqual(result, { success: false, error: copy, uncertain: false });
  assert.deepEqual(fake.requests, []);
 }
});

test('D9 refuses a foreign origin, a draft already at another version, or an unreadable draft before any POST', async () => {
 const cases = [
  [fakeApi({ draft: draftFixture({ origin_subject_id: '88888888-8888-4888-8888-888888888888' }) }), 'El borrador no está disponible en este contexto de origen.', false],
  [fakeApi({ draft: draftFixture({ version: '4' }) }), VERSION_CHANGED, false],
  [fakeApi({ getStatus: 404 }), 'El borrador no está disponible en este contexto.', false],
  [fakeApi({ getThrow: true }), 'No se pudo verificar el borrador. No se envió ninguna autorización.', false],
 ];
 for (const [fake, copy, uncertain] of cases) {
  const api = await loadModule(fake.fetcher, actionPath);
  const result = await api.handleAuthorizeOralSurgeryDraft(form(), { cookies: teacherCookies(authorizeGrants) });
  assert.deepEqual(result, { success: false, error: copy, uncertain });
  assert.equal(fake.requests.length, 1, 'only the draft read is sent');
  assert.equal(fake.requests[0].method, 'GET');
  assert.deepEqual(posts(fake.requests), []);
 }
});

test('D9 maps each 409 message to its own copy as a typed rejection and never retries', async () => {
 const cases = [
  ['current signed paper consent declaration is required', 'Falta una declaración vigente de consentimiento en papel para el plan actual.'],
  ['draft version changed; reload before saving', VERSION_CHANGED],
  ['some other conflict', 'El borrador ya no admite esta autorización. Actualizá la ficha antes de volver a intentarlo.'],
 ];
 for (const [message, copy] of cases) {
  const fake = fakeApi({ postStatus: 409, postError: message });
  const api = await loadModule(fake.fetcher, actionPath);
  const result = await api.handleAuthorizeOralSurgeryDraft(form(), { cookies: teacherCookies(authorizeGrants) });
  assert.deepEqual(result, { success: false, error: copy, uncertain: false });
  assert.equal(posts(fake.requests).length, 1);
 }
});

test('D9 maps 400, 401, 403 and 404 on the POST to typed copy with a single attempt', async () => {
 const cases = [
  [400, 'La solicitud de autorización no es válida.'],
  [401, 'Tu sesión venció. Iniciá sesión nuevamente.'],
  [403, 'No tenés permiso vigente para autorizar este borrador.'],
  [404, 'El borrador no está disponible en este contexto.'],
 ];
 for (const [status, copy] of cases) {
  const fake = fakeApi({ postStatus: status, postError: 'rejected' });
  const api = await loadModule(fake.fetcher, actionPath);
  const result = await api.handleAuthorizeOralSurgeryDraft(form(), { cookies: teacherCookies(authorizeGrants) });
  assert.deepEqual(result, { success: false, error: copy, uncertain: false });
  assert.equal(posts(fake.requests).length, 1);
 }
});

test('D9 network loss, a 5xx and an unconfirmed 201 are uncertain, reported once and never retried', async () => {
 const cases = [
  { postThrow: true },
  { postStatus: 500, postError: 'failed' },
  { postBody: authorizationFixture({ draft_version: '2' }) },
  { postBody: authorizationFixture({ consent_declaration_id: '9' }) },
  { postBody: { ...authorizationFixture(), extra: true } },
 ];
 for (const options of cases) {
  const fake = fakeApi(options);
  const api = await loadModule(fake.fetcher, actionPath);
  const result = await api.handleAuthorizeOralSurgeryDraft(form(), { cookies: teacherCookies(authorizeGrants) });
  assert.deepEqual(result, { success: false, error: UNCERTAIN, uncertain: true });
  assert.equal(posts(fake.requests).length, 1);
 }
});

// ---- Page: teacher detail -----------------------------------------------------------

test('D7 detail is gated by the oral-surgery read grant, sends no reads without it, and is never cached', async () => {
 const denied = await renderPage({ read: false });
 assert.deepEqual(denied.requests, []);
 assert.match(denied.html, /No tenés permiso para consultar este borrador como docente\./);
 assert.equal(denied.headers.get('Cache-Control'), 'no-store');
 const allowed = await renderPage();
 assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
});

test('D7 origin guard: invalid query context, a draft from another origin and an unknown draft show unavailable with no history reads', async () => {
 const invalid = await renderPage({ query: 'patient_id=bad&subject_id=bad&academic_group_id=bad' });
 assert.deepEqual(invalid.requests, []);
 assert.match(invalid.html, UNAVAILABLE);
 const foreign = await renderPage({ draft: draftFixture({ origin_group_id: '77777777-7777-4777-8777-777777777777' }) });
 assert.deepEqual(foreign.requests, [['draft', draftId]]);
 assert.match(foreign.html, UNAVAILABLE);
 assert.doesNotMatch(foreign.html, /Dolor en pieza 38|Autorizar esta versión/);
 const unknown = await renderPage({ draftError: new FixtureApiError(404, 'oral surgery draft was not found') });
 assert.deepEqual(unknown.requests, [['draft', draftId]]);
 assert.match(unknown.html, UNAVAILABLE);
});

test('D7 detail shows the origin context ids, the current version and the full read-only content', async () => {
 const { html } = await renderPage({ draft: draftFixture({ version: '5' }) });
 assert.match(html, new RegExp(`Paciente: ${patientId}`));
 assert.match(html, new RegExp(`Asignatura de origen: ${subjectId}`));
 assert.match(html, new RegExp(`Grupo de origen: ${groupId}`));
 assert.match(html, /Versión actual: 5/);
 assert.match(html, /Dolor en pieza 38/);
 assert.match(html, /Exodoncia simple/);
 assert.match(html, /Sin responder/);
});

test('D8 consent history shows the current declaration and oldest-first declarations with each treatment plan snapshot', async () => {
 const older = declarationFixture({ id: '5', draft_version: '2', plan_revision: '1', treatment_plan: { procedure: 'Extracción previa', anomalies_or_pathology: 'Ninguna' }, declared_at: '2026-11-01T09:00:00.000Z' });
 const { html, requests } = await renderPage({ consent: consentFixture({ current_declaration_id: '7', declarations: [older, declarationFixture()] }) });
 assert.deepEqual(requests, [['draft', draftId], ['consent', draftId], ['authorizations', draftId]]);
 assert.match(html, /Declaración vigente: 7/);
 const consentSection = html.slice(html.indexOf('id="consent-title"'), html.indexOf('id="authorization-title"'));
 assert.ok(consentSection.indexOf('Declaración 5') < consentSection.indexOf('Declaración 7'), 'declarations are listed oldest first');
 assert.ok(consentSection.indexOf('Extracción previa') > consentSection.indexOf('Declaración 5') && consentSection.indexOf('Extracción previa') < consentSection.indexOf('Declaración 7'), 'each plan snapshot sits under its declaration');
 assert.match(consentSection, /Exodoncia simple/);
 const none = await renderPage({ consent: consentFixture({ current_declaration_id: null, declarations: [] }) });
 assert.match(none.html, /No hay una declaración vigente para el plan de tratamiento guardado\./);
 assert.doesNotMatch(none.html, /Declaración vigente:/);
});

test('D8 history read failures keep the draft visible, show their own error and never offer the authorize form', async () => {
 const consentFailed = await renderPage({ consentError: new FixtureApiError(500, 'failed') });
 assert.deepEqual(consentFailed.requests, [['draft', draftId], ['consent', draftId], ['authorizations', draftId]]);
 assert.match(consentFailed.html, /Dolor en pieza 38/);
 assert.match(consentFailed.html, /No se pudo consultar el consentimiento de este borrador/);
 assert.doesNotMatch(consentFailed.html, /Autorizar esta versión/);
 const historyFailed = await renderPage({ authorizationError: new FixtureApiError(500, 'failed') });
 assert.match(historyFailed.html, /Dolor en pieza 38/);
 assert.match(historyFailed.html, /No se pudo consultar el historial de autorizaciones/);
 assert.doesNotMatch(historyFailed.html, /Autorizar esta versión/);
});

test('D8 authorization history lists oldest first with version, declaration, date and the reviewed content', async () => {
 const older = authorizationFixture({ id: '10', draft_version: '2', consent_declaration_id: '5', authorized_at: '2026-11-02T09:00:00.000Z', reviewed_content: { ...content, preoperative: { tooth: '16' } } });
 const { html } = await renderPage({ authorizations: historyFixture({ draft_version: '3', current_authorization_id: '11', authorizations: [older, authorizationFixture()] }) });
 assert.ok(html.indexOf('Autorización 10') < html.indexOf('Autorización 11'), 'authorizations are listed oldest first');
 const olderDate = labels.oralSurgeryTimestampLabel('2026-11-02T09:00:00.000Z').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 assert.match(html, new RegExp(`versión 2 · declaración 5 · autorizada <time datetime="2026-11-02T09:00:00\\.000Z"[^>]*>${olderDate}</time>`));
 assert.match(html, /Contenido revisado/);
 assert.match(html, /Dolor en pieza 38/);
});

test('D8 status line says authorized for the current version and stale otherwise, including when no authorization exists', async () => {
 const current = await renderPage({ authorizations: historyFixture({ current_authorization_id: '11', authorizations: [authorizationFixture()] }) });
 assert.match(current.html, /Autorización docente vigente para la versión 3\./);
 assert.doesNotMatch(current.html, /Sin autorización vigente/);
 const staleLine = /Sin autorización vigente para la versión actual \(3\)\. Cada edición del alumno exige volver a autorizar\./;
 const stale = await renderPage({ authorizations: historyFixture({ current_authorization_id: '11', authorizations: [authorizationFixture({ draft_version: '2' })] }) });
 assert.match(stale.html, staleLine);
 assert.doesNotMatch(stale.html, /Autorización docente vigente/);
 const none = await renderPage({ authorizations: historyFixture() });
 assert.match(none.html, staleLine);
});

test('D8 a version mismatch between the draft and either history hides the form and asks to reload', async () => {
 const consentMoved = await renderPage({ consent: consentFixture({ draft_version: '4' }) });
 assert.match(consentMoved.html, /El borrador cambió mientras se cargaba\. Recargá antes de autorizar\./);
 assert.doesNotMatch(consentMoved.html, /Autorizar esta versión/);
 const historyMoved = await renderPage({ authorizations: historyFixture({ draft_version: '4' }) });
 assert.match(historyMoved.html, /El borrador cambió mientras se cargaba\. Recargá antes de autorizar\./);
 assert.doesNotMatch(historyMoved.html, /Autorizar esta versión/);
});

test('D9 authorize form appears with the grant, a current declaration and consistent versions, with exact hidden fields and a required checkbox', async () => {
 const { html } = await renderPage({ draft: draftFixture({ version: '3' }), consent: consentFixture(), authorizations: historyFixture() });
 assert.match(html, /<form method="POST" action="authorize"/);
 assert.match(html, /name="id" value="9007199254741061"/);
 assert.match(html, new RegExp(`name="patient_id" value="${patientId}"`));
 assert.match(html, new RegExp(`name="subject_id" value="${subjectId}"`));
 assert.match(html, new RegExp(`name="academic_group_id" value="${groupId}"`));
 assert.match(html, /name="expected_version" value="3"/);
 assert.match(html, /name="consent_declaration_id" value="7"/);
 assert.equal((html.match(/name="paper_consent_verified"/g) ?? []).length, 1);
 assert.match(html, /name="paper_consent_verified"[^>]*required/);
 assert.match(html, /Verifiqué el consentimiento firmado en papel/);
 assert.match(html, /Autorizar esta versión/);
});

test('D9 hides the authorize form without the grant, without a current declaration, or when this version is already authorized', async () => {
 const authorized = historyFixture({ current_authorization_id: '11', authorizations: [authorizationFixture()] });
 const cases = [
  { authorize: false },
  { consent: consentFixture({ current_declaration_id: null, declarations: [] }) },
  { authorizations: authorized },
 ];
 for (const overrides of cases) {
  const { html } = await renderPage(overrides);
  assert.doesNotMatch(html, /name="paper_consent_verified"/);
  assert.doesNotMatch(html, /Autorizar esta versión/);
 }
 const staleAuthorization = historyFixture({ current_authorization_id: '11', authorizations: [authorizationFixture({ draft_version: '2' })] });
 assert.match((await renderPage({ authorizations: staleAuthorization })).html, /name="paper_consent_verified"/);
});

test('D9 confirmed authorization redirects to the detail with its origin context and reads nothing before the redirect', async () => {
 const result = await renderPage({ results: { authorize: { data: { success: true, id: draftId, ...context } } } });
 assert.equal(result.html, `REDIRECT:/teacher-clinical/oral-surgery/${draftId}?${query}&authorized=1`);
 assert.deepEqual(result.requests, []);
});

test('D9 confirmed authorization retains explicit list filters without replacing clinical origin', async () => {
 const listState = new URLSearchParams({ list_student_id: authorId, list_limit: '7', list_offset: '14' });
 const result = await renderPage({ query: `${query}&${listState}`, results: { authorize: { data: { success: true, id: draftId, ...context } } } });
 const redirect = new URL(result.html.replace('REDIRECT:', ''), 'https://fixture.invalid');
 assert.equal(redirect.pathname, `/teacher-clinical/oral-surgery/${draftId}`);
 for (const [key, value] of Object.entries(context)) assert.equal(redirect.searchParams.get(key), value);
 for (const [key, value] of listState) assert.equal(redirect.searchParams.get(key), value);
 assert.equal(redirect.searchParams.get('authorized'), '1');
 assert.deepEqual(result.requests, []);
});

test('D9 action results: uncertain outcomes hide the form, typed failures keep their copy, and an expired session goes to login', async () => {
 const uncertain = await renderPage({ results: { authorize: { data: { success: false, uncertain: true, error: UNCERTAIN } } } });
 assert.match(uncertain.html, /No se pudo confirmar la autorización/);
 assert.match(uncertain.html, /Consultá el estado antes de volver a autorizar\./);
 assert.doesNotMatch(uncertain.html, /name="paper_consent_verified"/);
 const typed = await renderPage({ results: { authorize: { data: { success: false, uncertain: false, error: VERSION_CHANGED } } } });
 assert.match(typed.html, /El alumno guardó una versión nueva\. Revisala antes de autorizar\./);
 assert.doesNotMatch(typed.html, /Consultá el estado antes de volver a autorizar/);
 assert.match(typed.html, /name="paper_consent_verified"/);
 const thrown = await renderPage({ results: { authorize: { error: { message: 'boom' } } } });
 assert.match(thrown.html, /No se pudo procesar la autorización\. Consultá el estado antes de volver a intentarlo\./);
 assert.doesNotMatch(thrown.html, /name="paper_consent_verified"/);
 const expired = await renderPage({ results: { authorize: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.' } } } });
 assert.equal(expired.html, `REDIRECT:/auth/login?returnTo=${encodeURIComponent(`/teacher-clinical/oral-surgery/${draftId}?${query}`)}`);
});

test('D9 browser handler disables the authorize submit on the first click and blocks a second submit', async () => {
 const page = await readFile(new URL(pagePath, root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script, 'explicit submit protection must exist');
 let handler;
 const button = { disabled: false, textContent: '' };
 const form = { dataset: {}, addEventListener: (_name, callback) => { handler = callback; }, querySelector: () => button };
 const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { document: { querySelector: () => form, querySelectorAll: () => [] } });
 let prevented = 0;
 handler({ preventDefault() { prevented++; } });
 assert.equal(button.disabled, true);
 handler({ preventDefault() { prevented++; } });
 assert.equal(prevented, 1);
});

// Clinical filter return (T1): the teacher oral detail keeps date filters in «Volver» and in the authorization redirect.
const oralDateQuery = 'date_from=2026-01-01&date_to=2026-02-01';

test('RED (c) teacher oral surgery «Volver» restores date filters beside list coordinates and assignment_id', async () => {
 const result = await renderPage({ query: `${query}&assignment_id=17&list_limit=7&list_offset=14&${oralDateQuery}` });
 const back = new URL(result.html.match(/href="(\/teacher-clinical\?[^"]*)"[^>]*>Volver/)[1].replaceAll('&amp;', '&'), 'https://fixture.invalid').searchParams;
 assert.equal(back.get('date_from'), '2026-01-01');
 assert.equal(back.get('date_to'), '2026-02-01');
 assert.equal(back.get('assignment_id'), '17');
 assert.equal(back.get('limit'), '7');
 assert.equal(back.get('offset'), '14');
});

test('RED (d) teacher oral surgery authorization redirect keeps the date filters', async () => {
 const result = await renderPage({ query: `${query}&${oralDateQuery}`, results: { authorize: { data: { success: true, id: draftId, ...context } } } });
 assert.ok(result.html.startsWith(`REDIRECT:/teacher-clinical/oral-surgery/${draftId}?`), result.html);
 const params = new URL(result.html.slice('REDIRECT:'.length), 'https://fixture.invalid').searchParams;
 assert.equal(params.get('date_from'), '2026-01-01');
 assert.equal(params.get('date_to'), '2026-02-01');
 assert.equal(params.get('authorized'), '1');
});

test('teacher oral surgery authorization redirect keeps a valid assignment_id and drops an invalid one', async () => {
 const authorize = { authorize: { data: { success: true, id: draftId, ...context } } };
 const kept = await renderPage({ query: `${query}&assignment_id=17`, results: authorize });
 assert.equal(new URL(kept.html.slice('REDIRECT:'.length), 'https://fixture.invalid').searchParams.get('assignment_id'), '17');
 const invalid = await renderPage({ query: `${query}&assignment_id=0`, results: authorize });
 assert.equal(invalid.html, `REDIRECT:/teacher-clinical/oral-surgery/${draftId}?${query}&authorized=1`);
});

test('no-filter teacher oral surgery «Volver» keeps the exact list URL', async () => {
 const result = await renderPage({ query });
 assert.match(result.html, /href="\/teacher-clinical\?limit=50&amp;offset=0"[^>]*>Volver|href="\/teacher-clinical\?limit=50&offset=0"[^>]*>Volver/);
});
