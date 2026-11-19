import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { realListingModule } from './helpers/clinical-form-submit.mjs';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const listPage = 'src/pages/teacher-clinical.astro';
const detailPage = 'src/pages/teacher-clinical/hygiene-preventive/[id].astro';
const readOnlyPage = 'src/components/clinical/HygieneReadOnly.astro';
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const otherGroup = '44444444-4444-4444-8444-444444444444';
const author = '55555555-5555-4555-8555-555555555555';
const habilitation = '66666666-6666-4666-8666-666666666666';
const assignment = '17';
const id = '9007199254741061';
const iso = '2026-11-18T12:00:00.000Z';
const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
const query = new URLSearchParams(context).toString();
const readGrant = 'hygiene-preventive-drafts:read';
const kinesiologyGrants = ['patient-assignments:read', 'kinesiology-evaluations:read'];
const UNAVAILABLE = 'El borrador no está disponible en este contexto de origen.';

const content = {
 medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', allergy_penicillin: false, diabetes: null, observations: 'Sin novedades' },
 odontogram: {
  16: { state: 'present', surfaces: { occlusal: ['caries'], mesial: ['filled'] } },
  26: { state: 'present', surfaces: { occlusal: ['caries', 'filled'] } },
  36: { state: 'to_extract' }, 18: { state: 'absent' }, 11: { state: 'present' },
 },
 indices: { cpo_d: { c: 2, p: 1, o: 3, total: 6 }, ceo_d: null },
};
const draft = (overrides = {}) => ({
 id, clinical_record_id: '9007199254741060', patient_id: patient, author_id: author, origin_student_habilitation_id: habilitation,
 origin_subject_id: subject, origin_group_id: group, content, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const row = { id: assignment, ...context, nombres: 'Ana', apellidos: 'Prueba', documento: 'QA' };
const evaluation = { id: '5', ...context, origin_subject_id: subject, origin_group_id: group, status: 'draft', patient: null, age: null, content: {} };

class FixtureApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// Fake backend behind the real pod modules: each request is recorded, every route answers with its configured status.
let routes = {};
let calls = [];
async function fakeApiFetch(path, { method = 'GET', body } = {}) {
 const [pathname] = path.split('?');
 calls.push({ method, path, body });
 const entry = routes[`${method} ${pathname}`];
 if (!entry) throw new Error(`Unexpected request ${method} ${pathname}`);
 if (entry.network) throw new Error('Service unavailable');
 if (entry.status >= 400) throw new FixtureApiError(entry.status, 'backend message', 'CODE');
 return entry.body;
}
const apiShim = { apiFetch: fakeApiFetch, ApiError: FixtureApiError };

async function loadCjs(path, shims = {}) {
 const output = ts.transpileModule(await readFile(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const exports = {};
 new Function('exports', 'require', output)(exports, (name) => { if (!(name in shims)) throw new Error(`unshimmed ${name}`); return shims[name]; });
 return exports;
}
const hygieneApi = await loadCjs('src/pods/hygiene-preventive-draft/api.ts', { '../../shared/apiClient': apiShim });
const discovery = await loadCjs('src/pods/hygiene-preventive-draft/discovery.ts', { '../../shared/apiClient': apiShim });
const labels = await loadCjs('src/pods/hygiene-preventive-draft/labels.ts');
const odontogram = await loadCjs('src/pods/hygiene-preventive-draft/odontogram.ts');
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

const renderComponent = async (_result, _name, component, props, slots) => (typeof component === 'function' ? component({ createAstro: () => ({ props }) }, props, slots) : slots?.default?.() ?? '');
// Compiled on first use so a missing component fails only the tests that need it.
const readOnlyComponent = (...args) => compileAstro(readOnlyPage, {
 ...hygieneApi, ...labels, ...odontogram, ...helpers, Fragment: null, $$renderComponent: renderComponent,
}).then((component) => component(...args));

/** Teacher list page with real hygiene discovery and reads; Kinesiology and Oral Surgery reads are recorded mocks. */
async function renderList({ grants = [], hygieneRoutes = {}, oral = {} } = {}) {
 routes = hygieneRoutes;
 calls = [];
 const kinesiology = [];
 const oralCalls = [];
 const headers = new Headers();
 const Astro = {
  props: {}, params: {}, cookies: {}, request: new Request('https://fixture.invalid'),
  url: new URL(`https://fixture.invalid/teacher-clinical?assignment_id=${assignment}`),
  getActionResult: () => undefined, response: { headers }, redirect: (url) => ({ redirect: url }),
 };
 const granted = new Set([...kinesiologyGrants, ...grants]);
 const mocks = {
  ...helpers, ...listing, Layout: null, Fragment: null, ApiError: FixtureApiError, $$renderComponent: renderComponent,
  teacherGrant: (_cookies, permission) => granted.has(permission),
  parseTeacherPagination: () => ({ limit: 50, offset: 0 }),
  parseTeacherAssignmentFilters: () => ({}),
  listTeacherPatients: async () => ({ items: [row], limit: 50, offset: 0 }),
  listTeacherEvaluations: async () => { kinesiology.push('list'); return [evaluation]; },
  listTeacherCrossContextEvaluations: async () => [],
  loadOriginNames: async () => ({ subjects: {}, groups: {} }),
  otherContext: () => false,
  listKinesiologyEvolutions: async () => [],
  parseEvolutionListFilters: () => ({}),
  assignmentListCarrier: (coordinates) => ({ list_limit: String(coordinates.limit), list_offset: String(coordinates.offset) }),
  listOralSurgeryContexts: async () => { oralCalls.push('discovery'); if (oral.forbidden) return { status: 'forbidden' }; return { status: 'ok', items: oral.contexts ?? [] }; },
  isOralSurgeryContext: (items, subjectId, groupId) => items.some((item) => item.subject_id === subjectId && item.academic_group_id === groupId),
  listOralSurgeryDrafts: async () => { oralCalls.push('drafts'); return oral.drafts ?? []; },
  listHygieneContexts: discovery.listHygieneContexts,
  isHygieneContext: discovery.isHygieneContext,
  listHygieneDrafts: hygieneApi.listHygieneDrafts,
 };
 const component = await compileAstro(listPage, mocks);
 const value = await component({ createAstro: () => Astro }, {}, {});
 if (value && typeof value === 'object' && 'redirect' in value) return { redirect: value.redirect, calls, kinesiology, oralCalls };
 return { html: await html(value), calls, kinesiology, oralCalls };
}

/** Teacher detail page: real draft read and read-only component, with the origin query as the only context. */
async function renderDetail({ grants = [readGrant], hygieneRoutes = {}, search = query, pageId = id } = {}) {
 routes = hygieneRoutes;
 calls = [];
 const headers = new Headers();
 const Astro = {
  props: {}, params: { id: pageId }, cookies: {}, request: new Request('https://fixture.invalid'),
  url: new URL(`https://fixture.invalid/teacher-clinical/hygiene-preventive/${pageId}?${search}`),
  getActionResult: () => undefined, response: { headers }, redirect: (url) => ({ redirect: url }),
 };
 const mocks = {
  ...helpers, Layout: null, Fragment: null, ApiError: FixtureApiError, HygieneReadOnly: readOnlyComponent, $$renderComponent: renderComponent,
  teacherGrant: (_cookies, permission) => grants.includes(permission),
  parseClinicalContext: (params) => {
   const get = (key) => { const values = params.getAll(key); if (values.length !== 1 || !/^[0-9a-f-]{36}$/i.test(values[0])) throw new Error('El contexto clínico no es válido.'); return values[0]; };
   return { patient_id: get('patient_id'), subject_id: get('subject_id'), academic_group_id: get('academic_group_id') };
  },
  validId: hygieneApi.validId,
  getHygieneDraft: hygieneApi.getHygieneDraft,
  hygieneTimestampLabel: labels.hygieneTimestampLabel,
 parseAssignmentListCoordinates: () => ({ filters: {}, limit: 50, offset: 0 }),
  assignmentListQuery: () => 'limit=50&offset=0',
 };
 const component = await compileAstro(detailPage, mocks);
 const value = await component({ createAstro: () => Astro }, {}, {});
 if (value && typeof value === 'object' && 'redirect' in value) return { redirect: value.redirect, calls, cacheControl: headers.get('Cache-Control') };
 return { html: await html(value), calls, cacheControl: headers.get('Cache-Control') };
}

const draftsRoute = (items) => ({ 'GET /hygiene-preventive-drafts': { body: { items } } });
const minesRoute = (items) => ({ 'GET /hygiene-preventive-subjects/mine': { body: { items } } });
const enabled = { subject_id: subject, academic_group_id: group };

// T4 teacher branching (D6): the hygiene grant and enabled context decide the list; everything else stays as today.

test('T4 without the hygiene read grant no hygiene request is sent and the Kinesiology list is unchanged', async () => {
 const result = await renderList({ grants: [], hygieneRoutes: { ...minesRoute([enabled]), ...draftsRoute([draft()]) } });
 assert.deepEqual(result.calls, []);
 assert.match(result.html, /Fichas de Prueba, Ana/);
 assert.doesNotMatch(result.html, /Higiene y Preventiva II/);
 assert.deepEqual(result.kinesiology, ['list']);
});

test('T4 a context not enabled for hygiene keeps the Kinesiology list and reads no hygiene drafts', async () => {
 const result = await renderList({ grants: [readGrant], hygieneRoutes: minesRoute([]) });
 assert.deepEqual(result.calls.map((call) => `${call.method} ${call.path.split('?')[0]}`), ['GET /hygiene-preventive-subjects/mine']);
 assert.match(result.html, /Fichas de Prueba, Ana/);
 assert.doesNotMatch(result.html, /Borradores de Higiene/);
});

test('T4 a forbidden hygiene discovery is not an enabled context and keeps the Kinesiology list', async () => {
 const result = await renderList({ grants: [readGrant], hygieneRoutes: { 'GET /hygiene-preventive-subjects/mine': { status: 403 } } });
 assert.match(result.html, /Fichas de Prueba, Ana/);
 assert.doesNotMatch(result.html, /Borradores de Higiene/);
 assert.equal(result.calls.some((call) => call.path.startsWith('/hygiene-preventive-drafts')), false);
});

test('T4 a hygiene-only context lists its drafts with origin links, with no Kinesiology or cross-context sections', async () => {
 const drafts = [draft({ id: '9007199254741070', version: '4' }), draft({ id })];
 const result = await renderList({ grants: [readGrant], hygieneRoutes: { ...minesRoute([enabled]), ...draftsRoute(drafts) } });
 assert.equal(result.calls.length, 2);
 assert.equal(result.calls[1].path, `/hygiene-preventive-drafts?${query}&limit=50&offset=0`);
 assert.deepEqual(result.kinesiology, []);
 assert.match(result.html, /Borradores de Higiene y Preventiva II de Prueba, Ana/);
 assert.match(result.html, /Abrir borrador de Higiene y Preventiva II · versión 4/);
 assert.match(result.html, new RegExp(`/teacher-clinical/hygiene-preventive/9007199254741070\\?[^"]*patient_id=${patient}(&amp;|&)subject_id=${subject}(&amp;|&)academic_group_id=${group}`));
 assert.doesNotMatch(result.html, /Fichas de|De otros contextos|name="status"/);
});

test('T4 both forms render Oral Surgery and Higiene y Preventiva II in separate sections, Oral Surgery first', async () => {
 const result = await renderList({
  grants: [readGrant, 'oral-surgery-drafts:read'],
  hygieneRoutes: { ...minesRoute([enabled]), ...draftsRoute([draft()]) },
  oral: { contexts: [enabled], drafts: [{ id: '9007199254741071', version: '2' }] },
 });
 const oralAt = result.html.indexOf('Borradores de Cirugía Oral I');
 const hygieneAt = result.html.indexOf('Borradores de Higiene y Preventiva II');
 assert.ok(oralAt > -1 && hygieneAt > oralAt, 'oral section must come before the hygiene section');
 assert.match(result.html, /Abrir borrador de Cirugía Oral I · versión 2/);
 assert.match(result.html, /Abrir borrador de Higiene y Preventiva II · versión 3/);
 assert.deepEqual(result.kinesiology, []);
});

test('T4 a hygiene list failure is isolated: the Oral Surgery list still renders', async () => {
 const result = await renderList({
  grants: [readGrant, 'oral-surgery-drafts:read'],
  hygieneRoutes: { ...minesRoute([enabled]), 'GET /hygiene-preventive-drafts': { status: 500 } },
  oral: { contexts: [enabled], drafts: [{ id: '9007199254741071', version: '2' }] },
 });
 assert.match(result.html, /Abrir borrador de Cirugía Oral I · versión 2/);
 assert.match(result.html, /role="alert"[^>]*>No se pudieron cargar los borradores de Higiene y Preventiva II/);
});

test('T4 a hygiene discovery failure shows the existing discovery alert and no clinical lists', async () => {
 const result = await renderList({ grants: [readGrant], hygieneRoutes: { 'GET /hygiene-preventive-subjects/mine': { network: true } } });
 assert.match(result.html, /No se pudo determinar qué ficha clínica corresponde a este contexto\./);
 assert.doesNotMatch(result.html, /Fichas de|Borradores de/);
 assert.deepEqual(result.kinesiology, []);
});

test('T4 a 401 from hygiene discovery redirects to login', async () => {
 const result = await renderList({ grants: [readGrant], hygieneRoutes: { 'GET /hygiene-preventive-subjects/mine': { status: 401 } } });
 assert.equal(result.redirect, '/auth/login?returnTo=%2Fteacher-clinical');
});

// D7 teacher detail: origin guard first, then the read-only component; teachers never write.

test('D7 a matching origin renders the read-only draft with no-store and no form', async () => {
 const result = await renderDetail({ hygieneRoutes: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() } } });
 assert.equal(result.cacheControl, 'no-store');
 assert.deepEqual(result.calls.map((call) => call.method), ['GET']);
 assert.match(result.html, /Higiene y Preventiva II · consulta docente/);
 assert.match(result.html, /Losartán/);
 assert.doesNotMatch(result.html, /<form|method="POST"/);
});

test('D7 an origin mismatch on patient, subject or group is unavailable and renders no clinical content', async () => {
 const mismatches = [
  ['group', { origin_group_id: otherGroup }],
  ['subject', { origin_subject_id: otherGroup }],
  ['patient', { patient_id: otherGroup }],
 ];
 for (const [field, overrides] of mismatches) {
  const result = await renderDetail({ hygieneRoutes: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft(overrides) } } });
  assert.match(result.html, new RegExp(UNAVAILABLE), field);
  assert.doesNotMatch(result.html, /Losartán|Sin novedades/, field);
 }
});

test('D7 an invalid origin query or a malformed draft id sends no request and is unavailable', async () => {
 let result = await renderDetail({ search: 'patient_id=not-a-uuid', hygieneRoutes: {} });
 assert.equal(result.calls.length, 0);
 assert.match(result.html, new RegExp(UNAVAILABLE));
 result = await renderDetail({ pageId: '0', hygieneRoutes: {} });
 assert.equal(result.calls.length, 0);
 assert.match(result.html, new RegExp(UNAVAILABLE));
});

test('D7 without the read grant no request is sent', async () => {
 const result = await renderDetail({ grants: [], hygieneRoutes: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() } } });
 assert.equal(result.calls.length, 0);
 assert.match(result.html, /No tenés permiso para consultar este borrador como docente\./);
});

test('D7 404 is unavailable, 403 is a permission notice, 401 redirects, other failures are a safe alert', async () => {
 const route = (response) => ({ [`GET /hygiene-preventive-drafts/${id}`]: response });
 assert.match((await renderDetail({ hygieneRoutes: route({ status: 404 }) })).html, new RegExp(UNAVAILABLE));
 assert.match((await renderDetail({ hygieneRoutes: route({ status: 403 }) })).html, /No tenés permiso vigente para consultar este borrador\./);
 assert.equal((await renderDetail({ hygieneRoutes: route({ status: 401 }) })).redirect, `/auth/login?returnTo=${encodeURIComponent(`/teacher-clinical/hygiene-preventive/${id}?${query}`)}`);
 assert.match((await renderDetail({ hygieneRoutes: route({ status: 500 }) })).html, /No se pudo cargar el borrador en este contexto de origen\./);
});

// D8 read-only component: answers, recorded teeth as text, surfaces, legend and server totals.

test('D8 medical history shows answers in tri-state copy with their detail texts', async () => {
 const out = String(await readOnlyComponent({ createAstro: () => ({ props: { content } }) }, { content }, {}));
 assert.match(out, /¿Toma algún medicamento\?[\s\S]*?Sí[\s\S]*?Losartán/);
 assert.match(out, /¿Es alérgico\/a a la penicilina\?[\s\S]*?No/);
 assert.match(out, /Diabetes[\s\S]*?Sin responder/);
 assert.match(out, /Sin novedades/);
});

test('D8 recorded teeth are listed as text and unrecorded teeth are counted from the full FDI set', async () => {
 const out = String(await readOnlyComponent({ createAstro: () => ({ props: { content } }) }, { content }, {}));
 assert.match(out, /Pieza 11 · Presente/);
 assert.match(out, /Pieza 18 · Ausente/);
 assert.match(out, /Pieza 36 · A extraer/);
 assert.match(out, /47 piezas sin registrar/);
});

test('D8 surfaces are written as text, the chart is hidden from assistive tech and the legend names every mark', async () => {
 const out = String(await readOnlyComponent({ createAstro: () => ({ props: { content } }) }, { content }, {}));
 assert.match(out, /Pieza 16 · Presente · Oclusal \/ incisal: caries; Mesial: obturada/);
 assert.match(out, /Pieza 26 · Presente · Oclusal \/ incisal: caries y obturada/);
 assert.match(out, /<svg[^>]*aria-hidden="true"/);
 assert.match(out, /class="face caries[^"]*"/);
 assert.match(out, /class="face both[^"]*"/);
 for (const label of ['Caries', 'Obturada', 'Caries secundaria', 'Ausente', 'A extraer', 'Sin registrar']) assert.match(out, new RegExp(label));
 assert.doesNotMatch(out, /<form|<input|<select|<button|<script/);
});

test('D8 indices show components and the server total, and say when an index is not loaded', async () => {
 const out = String(await readOnlyComponent({ createAstro: () => ({ props: { content } }) }, { content }, {}));
 assert.match(out, /CPO-D \(dentición permanente\)[\s\S]*?Cariadas: 2[\s\S]*?Perdidas: 1[\s\S]*?Obturadas: 3[\s\S]*?Total calculado por el servidor: 6/);
 assert.match(out, /ceo-d \(dentición temporal\)[\s\S]*?No cargado/);
 assert.match(out, /CPO de primeros molares[\s\S]*?No cargado/);
});
