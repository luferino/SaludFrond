import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const discoveryPath = 'src/pods/oral-surgery-draft/discovery.ts';
const subject = '01234567-89ab-4def-8123-456789abcdef';
const group = 'abcdef01-2345-4789-abcd-ef0123456789';
const otherSubject = '22222222-3333-4444-8555-666666666666';
const otherGroup = '33333333-4444-4555-8666-777777777777';
const iso = '2026-11-06T12:00:00Z';
const pair = (overrides = {}) => ({ subject_id: subject, academic_group_id: group, ...overrides });

/** Load the real discovery adapter and apiClient against an isolated fetch; every request is recorded. */
async function harness(responses = []) {
 const requests = [];
 const writes = [];
 const cookies = {
  get: (name) => name === 'session' ? { value: 'session-token' } : undefined,
  set: (...args) => writes.push(['set', ...args]), delete: (...args) => writes.push(['delete', ...args]),
 };
 const sandbox = vm.createContext({ URL, URLSearchParams, Response, Error, Date, Set, fetch: async (url, init) => {
  requests.push({ url, method: init.method, authorization: init.headers.Authorization, body: init.body === undefined ? undefined : JSON.parse(init.body) });
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
   if (specifier === './session') return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
    this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
    this.setExport('clearSession', (jar) => jar.delete('session', { path: '/' }));
   }, { context: sandbox });
   return compile(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
  });
  return mod;
 }
 const mod = await compile(new URL(discoveryPath, root).href);
 await mod.evaluate();
 return { api: mod.namespace, cookies, requests, writes };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('discovery sends one authenticated GET to the exact route and returns the enabled pairs as given', async () => {
 const { api, cookies, requests } = await harness([{ body: { items: [pair(), pair({ subject_id: otherSubject, academic_group_id: otherGroup })] } }]);
 const contexts = await api.listOralSurgeryContexts(cookies);
 assert.deepEqual(requests, [{ url: 'https://backend.invalid/oral-surgery-subjects/mine', method: 'GET', authorization: 'Bearer session-token', body: undefined }]);
 assert.equal(new URL(requests[0].url).search, '', 'the backend rejects any query string with 400');
 assert.deepEqual(plain(contexts), { status: 'ok', items: [pair(), pair({ subject_id: otherSubject, academic_group_id: otherGroup })] });
});

test('an empty items list is a valid answer with no pairs and exactly one request', async () => {
 const { api, cookies, requests } = await harness([{ body: { items: [] } }]);
 assert.deepEqual(plain(await api.listOralSurgeryContexts(cookies)), { status: 'ok', items: [] });
 assert.equal(requests.length, 1);
});

test('isOralSurgeryContext matches only an exact enabled subject and group pair', async () => {
 const { api } = await harness();
 const contexts = [pair(), pair({ subject_id: otherSubject, academic_group_id: otherGroup })];
 assert.equal(api.isOralSurgeryContext(contexts, subject, group), true);
 assert.equal(api.isOralSurgeryContext(contexts, otherSubject, otherGroup), true);
 assert.equal(api.isOralSurgeryContext(contexts, subject, otherGroup), false);
 assert.equal(api.isOralSurgeryContext(contexts, otherSubject, group), false);
 assert.equal(api.isOralSurgeryContext([], subject, group), false);
});

test('discovery rejects extra keys on the envelope or on an item', async () => {
 for (const body of [
  { items: [pair()], total: 1 },
  { items: [pair({ enabled: true })] },
  { items: [pair({ name: 'Cirugía Oral I' })] },
 ]) {
  const { api, cookies } = await harness([{ body }]);
  await assert.rejects(api.listOralSurgeryContexts(cookies), Error, JSON.stringify(body));
 }
});

test('discovery rejects a non-UUID subject or group id and a missing items array', async () => {
 for (const body of [
  { items: [pair({ subject_id: 'Cirugía Oral I' })] },
  { items: [pair({ academic_group_id: '1' })] },
  { items: [pair({ subject_id: null })] },
  { items: 'none' },
  {},
 ]) {
  const { api, cookies } = await harness([{ body }]);
  await assert.rejects(api.listOralSurgeryContexts(cookies), Error, JSON.stringify(body));
 }
});

test('discovery rejects a duplicate subject and group pair but allows one subject in two groups', async () => {
 const duplicate = await harness([{ body: { items: [pair(), pair()] } }]);
 await assert.rejects(duplicate.api.listOralSurgeryContexts(duplicate.cookies), Error, 'duplicate pair');
 const twoGroups = await harness([{ body: { items: [pair(), pair({ academic_group_id: otherGroup })] } }]);
 assert.equal((await twoGroups.api.listOralSurgeryContexts(twoGroups.cookies)).items.length, 2);
});

test('discovery 403 maps to forbidden with one request, while 401 clears the session and propagates', async () => {
 const forbidden = await harness([{ status: 403, body: { error: { code: 'FORBIDDEN', message: "Permission 'oral-surgery-drafts:read' required" } } }]);
 assert.deepEqual(plain(await forbidden.api.listOralSurgeryContexts(forbidden.cookies)), { status: 'forbidden' });
 assert.equal(forbidden.requests.length, 1);
 assert.deepEqual(forbidden.writes, []);
 const expired = await harness([{ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }]);
 await assert.rejects(expired.api.listOralSurgeryContexts(expired.cookies), (error) => error.status === 401);
 assert.deepEqual(expired.writes.map(([kind]) => kind), ['delete']);
});

test('discovery 400, 500 and network failures propagate and never become an empty list', async () => {
 const badRequest = await harness([{ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'query parameters are not supported' } } }]);
 await assert.rejects(badRequest.api.listOralSurgeryContexts(badRequest.cookies), (error) => error.status === 400);
 const server = await harness([{ status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } }]);
 await assert.rejects(server.api.listOralSurgeryContexts(server.cookies), (error) => error.status === 500);
 const offline = await harness([{ network: true }]);
 await assert.rejects(offline.api.listOralSurgeryContexts(offline.cookies), Error, 'Service unavailable');
});

// ---------------------------------------------------------------------------
// Student assignment page: /my-patients/[assignmentId] (D11)
// ---------------------------------------------------------------------------

const patient = '11111111-1111-4111-8111-111111111111';
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitation = '22222222-2222-4222-8222-222222222222';
const assignment = { id: '17', patient_id: patient, student_habilitation_id: habilitation, subject_id: subject, academic_group_id: group, assigned_by: teacherId, nombres: 'Ana', apellidos: 'Pérez', documento: '12345678', assigned_at: iso, ended_by: null, ended_at: null, end_reason: null };
const oralDraft = (overrides = {}) => ({
 id: '9007199254741061', clinical_record_id: '9007199254741060', patient_id: patient, author_id: teacherId,
 origin_student_habilitation_id: habilitation, origin_subject_id: subject, origin_group_id: group,
 content: {}, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});

/** Render the real student assignment page; each collaborator is an isolated, recorded mock. */
async function renderAssignment(options = {}) {
 const requests = [];
 const oralListings = [];
 const cookies = { get: (name) => name === 'session' ? { value: 'token' } : undefined };
 const Astro = {
  params: { assignmentId: '17' }, cookies, url: new URL(options.url ?? 'https://fixture.invalid/my-patients/17?limit=50&offset=0'),
  getActionResult: (action) => options.results?.[action],
  redirect: (url) => `REDIRECT:${url}`, response: { headers: new Headers() },
 };
 const mocks = {
  Layout: null, Fragment: null, ApiError: class ApiError extends Error { constructor(status) { super('api'); this.status = status; } },
  actions: { createKinesiologyEvaluation: 'kinesiology', createOralSurgeryDraft: 'oral-surgery' }, isInputError: () => false,
  decodeJwt: () => ({ sub: teacherId, role: 'student', permissions: options.permissions ?? [] }),
  parseAssignmentPagination: () => ({ limit: 50, offset: 0 }),
  listAssignedPatients: async () => { requests.push('assignments'); if (options.assignmentsFailure) throw new Error('offline'); return { items: options.items ?? [assignment], limit: 50, offset: 0 }; },
  listEvaluations: async () => { requests.push('kinesiology-drafts'); return []; },
  listSubmittedEvaluations: async () => { requests.push('kinesiology-submitted'); return []; },
  EVALUATION_STATUS_LABELS: {},
  actionHrefWithContext: (href, context) => { const url = new URL(href, 'http://localhost'); for (const [key, value] of Object.entries(context)) url.searchParams.set(key, value); return `${url.pathname}${url.search}`; },
  listOralSurgeryContexts: async () => {
   requests.push('discovery');
   if (options.discoveryStatus) throw new mocks.ApiError(options.discoveryStatus);
   if (options.discoveryFailure) throw new Error('offline');
   if (options.forbidden) return { status: 'forbidden' };
   return { status: 'ok', items: options.contexts ?? [] };
  },
  isOralSurgeryContext: (contexts, subjectId, groupId) => contexts.some((item) => item.subject_id === subjectId && item.academic_group_id === groupId),
  listOralSurgeryDrafts: async (context, _cookies, page) => {
   requests.push('oral-list');
   oralListings.push({ context, page });
   if (options.oralFailure) throw new Error('offline');
   return options.drafts ?? [];
  },
  $$createAstro: () => ({}), $$createComponent: (component) => component,
  $$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
  $$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => Astro }, props, slots) : slots?.default?.() ?? '',
  $$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${String(value).replaceAll('&', '&amp;')}"`,
  $$maybeRenderHead: () => '', $$renderHead: () => '',
 };
 async function compile(file) {
  let code = (await transform(await readFile(new URL(file, root), 'utf8'), { filename: file })).code;
  const ast = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true);
  const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  return exports.default;
 }
 const component = await compile('src/pages/my-patients/[assignmentId].astro');
 const rendered = await html(component({ createAstro: () => Astro }, {}, {}));
 return { html: rendered, requests, oralListings };
}
async function html(value) {
 value = await value;
 if (value == null || value === false) return '';
 if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
 return String(value);
}

test('student page with an enabled pair renders only Oral Surgery: create form, hidden context, list, and no Kinesiology request', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], drafts: [oralDraft()] });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'oral-list']);
 assert.deepEqual(result.oralListings, [{ context: { patient_id: patient, subject_id: subject, academic_group_id: group }, page: { limit: 50, offset: 0 } }]);
 assert.match(result.html, /Cirugía Oral I/);
 assert.match(result.html, /Crear nuevo borrador de Cirugía Oral I/);
 assert.match(result.html, /Cada creación inicia un encuentro clínico nuevo\. Para continuar uno existente, abrilo desde la lista\./);
 for (const [name, value] of [['patient_id', patient], ['subject_id', subject], ['academic_group_id', group], ['assignment_id', '17'], ['limit', '50'], ['offset', '0']]) {
  assert.match(result.html, new RegExp(`<input type="hidden" name="${name}" value="${value}"`));
 }
 assert.doesNotMatch(result.html, /name="content"/);
 assert.match(result.html, /action="\/oral-surgery\?assignment_id=17&amp;limit=50&amp;offset=0"/);
 assert.match(result.html, /href="\/oral-surgery-drafts\/9007199254741061\?assignment_id=17&amp;limit=50&amp;offset=0"/);
 assert.match(result.html, /Abrir borrador · versión 3 · actualizado /);
 assert.doesNotMatch(result.html, /Ficha kinésica inicial|Crear nuevo borrador<|Borradores de ficha inicial|Fichas enviadas/);
});

test('student page shows the 50-row notice only when the Oral Surgery list is full', async () => {
 const full = Array.from({ length: 50 }, (_, index) => oralDraft({ id: String(9007199254741000n + BigInt(index)) }));
 const fullPage = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], drafts: full });
 assert.match(fullPage.html, /Se muestran los 50 borradores más recientes\./);
 const partial = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], drafts: full.slice(0, 49) });
 assert.doesNotMatch(partial.html, /Se muestran los 50 borradores más recientes\./);
});

test('student page with no discovery match keeps the Kinesiology view and makes no Oral Surgery list request', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair({ academic_group_id: otherGroup })] });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'kinesiology-drafts', 'kinesiology-submitted']);
 assert.match(result.html, /Ficha kinésica inicial/);
 assert.match(result.html, /Crear nuevo borrador/);
 assert.doesNotMatch(result.html, /Cirugía Oral I|oral-surgery/);
});

test('student page without the oral-surgery read grant makes no discovery request and stays Kinesiology', async () => {
 const result = await renderAssignment({ permissions: ['kinesiology-evaluations:write'], contexts: [pair()], drafts: [oralDraft()] });
 assert.deepEqual(result.requests, ['assignments', 'kinesiology-drafts', 'kinesiology-submitted']);
 assert.match(result.html, /Ficha kinésica inicial/);
 assert.doesNotMatch(result.html, /Cirugía Oral I|oral-surgery/);
});

test('student page discovery failure shows an alert with no create form, no list and no Kinesiology request', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], discoveryFailure: true });
 assert.deepEqual(result.requests, ['assignments', 'discovery']);
 assert.match(result.html, /role="alert"[^>]*>[\s\S]*No se pudo determinar qué ficha clínica corresponde a esta asignatura\. No se muestran acciones para evitar crear la ficha equivocada\./);
 assert.doesNotMatch(result.html, /id="new-draft"|name="patient_id"|Crear nuevo borrador|Abrir borrador/);
});

test('student page discovery 401 redirects to login and makes no further request', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], discoveryStatus: 401 });
 assert.deepEqual(result.requests, ['assignments', 'discovery']);
 assert.equal(result.html, 'REDIRECT:/auth/login?returnTo=%2Fmy-patients%2F17%3Flimit%3D50%26offset%3D0');
});

test('student page forbidden discovery shows the permission notice and keeps the Kinesiology view unchanged', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], forbidden: true, drafts: [oralDraft()] });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'kinesiology-drafts', 'kinesiology-submitted']);
 assert.deepEqual(result.oralListings, []);
 assert.match(result.html, /No tenés permiso para consultar si esta asignatura usa Cirugía Oral I\. No se muestran acciones de Cirugía Oral\./);
 assert.match(result.html, /Ficha kinésica inicial/);
 assert.match(result.html, /name="content" value="\{\}"/);
 assert.match(result.html, /Crear nuevo borrador<\/button>/);
 assert.doesNotMatch(result.html, /Crear nuevo borrador de Cirugía Oral I|Borradores de Cirugía Oral I|oral-surgery-drafts\/|\/oral-surgery\?/);
});

test('student page pair absent from an ok discovery answer keeps Kinesiology with no notice', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [] });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'kinesiology-drafts', 'kinesiology-submitted']);
 assert.doesNotMatch(result.html, /No tenés permiso|Cirugía Oral I/);
 assert.match(result.html, /Ficha kinésica inicial/);
});

test('student page create success redirects to the editor and create failure shows the action error', async () => {
 const created = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], drafts: [], results: { 'oral-surgery': { data: { success: true, draft: oralDraft({ id: '28' }) } } } });
 assert.equal(created.html, 'REDIRECT:/oral-surgery-drafts/28?assignment_id=17&limit=50&offset=0');
 const failed = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], drafts: [], results: { 'oral-surgery': { data: { success: false, uncertain: true, error: 'No se pudo confirmar la creación. Revisá la lista de borradores antes de volver a intentarlo.' } } } });
 assert.match(failed.html, /role="alert"[^>]*>No se pudo confirmar la creación\./);
});

test('student page Oral Surgery list failure replaces the view with the load error and no create form', async () => {
 const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], oralFailure: true });
 assert.match(result.html, /No se pudieron cargar las asignaciones y sus fichas/);
 assert.doesNotMatch(result.html, /id="new-draft"|Crear nuevo borrador de Cirugía Oral I/);
});
