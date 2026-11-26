import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const listPage = 'src/pages/hygiene-preventive-admin.astro';
const detailPage = 'src/pages/hygiene-preventive-admin/[id].astro';
const readOnlyPage = 'src/components/clinical/HygieneReadOnly.astro';
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const author = '55555555-5555-4555-8555-555555555555';
const habilitation = '66666666-6666-4666-8666-666666666666';
const id = '9007199254741061';
const iso = '2026-11-18T12:00:00.000Z';
const readGrant = 'hygiene-preventive-drafts:read';
const UNAVAILABLE = 'Borrador no disponible.';

const content = {
 medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', observations: 'Sin novedades' },
 odontogram: { 16: { state: 'present', surfaces: { occlusal: ['caries'] } } },
 indices: { cpo_d: { c: 2, p: 1, o: 3, total: 6 } },
};
const draft = (overrides = {}) => ({
 id, clinical_record_id: '9007199254741060', patient_id: patient, author_id: author, origin_student_habilitation_id: habilitation,
 origin_subject_id: subject, origin_group_id: group, content, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const admin = (overrides = {}) => ({ sub: '77777777-7777-4777-8777-777777777777', username: 'admin', role: 'admin', permissions: [readGrant], exp: 4102444800, iat: 1, ...overrides });
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const cookiesFor = (actor) => {
 const token = actor ? jwt(actor) : undefined;
 return { get: (name) => (name === 'session' && token ? { value: token } : undefined), set() {}, delete() {} };
};

class FixtureApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// Fake backend behind the real pod modules: requests are recorded; a route answers with its body or its status.
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
 // The env stands in for Astro's import.meta.env, which a CommonJS load cannot parse; apiClient itself is shimmed.
 new Function('exports', 'require', '__env', output.replaceAll('import.meta.env', '__env'))(exports, (name) => { if (!(name in shims)) throw new Error(`unshimmed ${name}`); return shims[name]; }, { PUBLIC_API_URL: 'https://backend.invalid' });
 return exports;
}
const jwtModule = await loadCjs('src/shared/jwt.ts');
// api.ts reads the session cookie itself for the one request apiClient cannot answer (an empty 204 delete).
const sessionShim = { getSession: (jar) => jar.get('session')?.value ?? null, clearSession: () => undefined };
const hygieneApi = await loadCjs('src/pods/hygiene-preventive-draft/api.ts', { '../../shared/apiClient': apiShim, '../../shared/session': sessionShim });
const labels = await loadCjs('src/pods/hygiene-preventive-draft/labels.ts');
const odontogram = await loadCjs('src/pods/hygiene-preventive-draft/odontogram.ts');
// A missing module fails only the tests that call into it.
const admin_ = await loadCjs('src/pods/hygiene-preventive-draft/admin.ts', { '../../shared/jwt': jwtModule, './api': hygieneApi }).catch((error) => ({ loadError: error.message }));

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
const readOnlyComponent = (...args) => compileAstro(readOnlyPage, { ...hygieneApi, ...labels, ...odontogram, ...helpers, Fragment: null, $$renderComponent: renderComponent }).then((component) => component(...args));
// S3: the shared consent history, compiled on first use like the read-only draft component.
const consentComponentPath = 'src/components/clinical/HygieneConsentHistory.astro';
const consentComponent = (...args) => compileAstro(consentComponentPath, { ...labels, ...helpers, Fragment: null, $$renderComponent: renderComponent }).then((component) => component(...args));
// S4: the shared procedure log, compiled on first use.
const procedureComponentPath = 'src/components/clinical/HygieneProcedureLog.astro';
const procedureComponent = (...args) => compileAstro(procedureComponentPath, { ...labels, ...helpers, Fragment: null, $$renderComponent: renderComponent }).then((component) => component(...args));

/** Renders an admin page with the real admin helpers and API; `search` is the query string of the page URL. */
async function renderAdmin(path, { actor = admin(), search = '', pageId = id, responses = {}, catalogs = {} } = {}) {
 routes = path === detailPage ? { [`GET /hygiene-preventive-drafts/${pageId}/consent`]: { body: { current_declaration_id: null, declarations: [] } }, [`GET /hygiene-preventive-drafts/${pageId}/procedures`]: { body: { items: [] } }, ...responses } : responses;
 calls = [];
 const headers = new Headers();
 const Astro = {
  props: {}, params: { id: pageId }, cookies: cookiesFor(actor), request: new Request('https://fixture.invalid'),
  url: new URL(`https://fixture.invalid${path.includes('[id]') ? `/hygiene-preventive-admin/${pageId}` : '/hygiene-preventive-admin'}?${search}`),
  getActionResult: () => undefined, response: { headers }, redirect: (url) => ({ redirect: url }),
 };
 const mocks = {
  ...helpers, ...hygieneApi, ...labels, ...admin_, Layout: null, Fragment: null, ApiError: FixtureApiError,
  HygieneReadOnly: readOnlyComponent, HygieneConsentHistory: consentComponent, HygieneProcedureLog: procedureComponent, $$renderComponent: renderComponent,
  listSubjects: async () => catalogs.subjects ?? { state: 'success', page: { items: [] } },
  listGroups: async () => catalogs.groups ?? { state: 'success', page: { items: [] } },
  listSubjectGroups: async () => catalogs.associations ?? { state: 'failed' },
 };
 const component = await compileAstro(path, mocks);
 const value = await component({ createAstro: () => Astro }, {}, {});
 if (value && typeof value === 'object' && 'redirect' in value) return { redirect: value.redirect, calls, cacheControl: headers.get('Cache-Control') };
 return { html: await html(value), calls, cacheControl: headers.get('Cache-Control') };
}

// A1: admin gate and listing parameters.

test('A1 only an admin session with the drafts read grant passes the gate', () => {
 assert.equal(admin_.hygieneAdminGrant(cookiesFor(admin())), true);
 for (const actor of [null, admin({ role: 'teacher' }), admin({ role: 'estudiante' }), admin({ permissions: [] }), admin({ permissions: ['oral-surgery-drafts:read'] }), admin({ permissions: [readGrant, null] })]) {
  assert.equal(admin_.hygieneAdminGrant(cookiesFor(actor)), false, JSON.stringify(actor));
 }
});

test('A1 the subjects screen gates by its own permission and the admin role', () => {
 const subjectsRead = 'hygiene-preventive-subjects:read';
 assert.equal(admin_.hygienePermissionGrant(cookiesFor(admin({ permissions: [subjectsRead] })), subjectsRead), true);
 assert.equal(admin_.hygienePermissionGrant(cookiesFor(admin({ permissions: [readGrant] })), subjectsRead), false);
 assert.equal(admin_.hygienePermissionGrant(cookiesFor(admin({ role: 'teacher', permissions: [subjectsRead] })), subjectsRead), false);
});

test('A1 the listing keeps defaults and bounds; malformed or repeated values are rejected', () => {
 assert.deepEqual(JSON.parse(JSON.stringify(admin_.parseHygieneAdminListing(new URLSearchParams('')))), { limit: 50, offset: 0 });
 assert.deepEqual(JSON.parse(JSON.stringify(admin_.parseHygieneAdminListing(new URLSearchParams('limit=100&offset=200')))), { limit: 100, offset: 200 });
 for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'offset=-1', 'offset=2147483648', 'limit=10&limit=20']) {
  assert.throws(() => admin_.parseHygieneAdminListing(new URLSearchParams(query)), Error, query);
 }
});

test('A1 the query keeps only limit and offset, and pagination offers next only on a full page', () => {
 const listing = { limit: 20, offset: 40 };
 assert.equal(admin_.hygieneAdminQuery(listing), 'limit=20&offset=40');
 assert.equal(admin_.hygieneAdminQuery(listing, 60), 'limit=20&offset=60');
 assert.deepEqual(JSON.parse(JSON.stringify(admin_.hygieneAdminPagination(listing, 20))), { previousOffset: 20, nextOffset: 60 });
 assert.deepEqual(JSON.parse(JSON.stringify(admin_.hygieneAdminPagination(listing, 3))), { previousOffset: 20, nextOffset: null });
});

test('A1 patient and academic UUID filters accept blanks and reject malformed or repeated IDs', () => {
 const parse = (query) => admin_.parseHygieneAdminListing(new URLSearchParams(query));
 assert.equal(admin_.hygieneAdminQuery(parse('patient_id=&subject_id=&academic_group_id=')), 'limit=50&offset=0');
 assert.deepEqual(JSON.parse(JSON.stringify(parse(`patient_id=${patient}`))), { limit: 50, offset: 0, patient_id: patient });
 for (const key of ['patient_id', 'subject_id', 'academic_group_id']) {
  assert.throws(() => parse(`${key}=invalid`), /Los filtros no son válidos/);
  assert.throws(() => parse(`${key}=${key === 'patient_id' ? patient : subject}&${key}=`), /Los filtros no son válidos/);
 }
});

// A2: global list page. Read-only, with optional academic filters.

test('A2 patient and academic UUID filters scope the API and travel with pager and detail return, without catalog requests', async () => {
 const filters = `patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`;
 const page = await renderAdmin(listPage, { search: `limit=1&offset=2&${filters}`, responses: { 'GET /hygiene-preventive-drafts': { body: { items: [draft()] } } }, catalogs: { associations: { state: 'success', page: { items: [{ subject_id: subject, academic_group_id: group }], limit: 100, offset: 0 } } } });
 assert.deepEqual(calls.filter((call) => call.path.startsWith('/hygiene-preventive-drafts')).map((call) => call.path), [`/hygiene-preventive-drafts?limit=1&offset=2&${filters}`]);
 assert.equal(calls.length, 1, 'no patient catalog request');
 assert.ok(page.html.includes(`href="/hygiene-preventive-admin/${id}?limit=1&offset=2&${filters}"`));
 assert.ok(page.html.includes(`href="?limit=1&offset=1&${filters}"`));
 assert.ok(page.html.includes(`href="?limit=1&offset=3&${filters}"`));
 const detail = await renderAdmin(detailPage, { search: `limit=1&offset=2&${filters}`, responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() } } });
 assert.ok(detail.html.includes(`href="/hygiene-preventive-admin?limit=1&offset=2&${filters}"`));
});

test('A2 the list sends one request with the validated paging and offers next only on a full page', async () => {
 const items = [draft({ id: '9007199254741070' }), draft({ id: '9007199254741071' })];
 const page = await renderAdmin(listPage, { search: 'limit=2&offset=4', responses: { 'GET /hygiene-preventive-drafts': { body: { items } } } });
 assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ['GET /hygiene-preventive-drafts?limit=2&offset=4']);
 assert.match(page.html, /Borrador 9007199254741070/);
 assert.match(page.html, /href="\/hygiene-preventive-admin\/9007199254741070\?limit=2&offset=4"/);
 assert.match(page.html, /href="\?limit=2&offset=2"[^>]*>Anteriores/);
 assert.match(page.html, /href="\?limit=2&offset=6"[^>]*>Siguientes/);
 assert.equal(page.cacheControl, 'no-store');
 assert.doesNotMatch(page.html, /date_from|method="POST"/);
});

test('A2 the GET form keeps a legacy patient filter hidden and shows named academic choices', async () => {
 const page = await renderAdmin(listPage, {
  search: `limit=10&offset=20&patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`,
  responses: { 'GET /hygiene-preventive-drafts': { body: { items: [] } } },
  catalogs: {
   subjects: { state: 'success', page: { items: [{ id: subject, name: 'Higiene II' }] } },
   groups: { state: 'success', page: { items: [{ id: group, name: 'Grupo A', academic_year: 2026, curriculum_semester: 2 }] } },
   associations: { state: 'success', page: { items: [{ subject_id: subject, academic_group_id: group }], limit: 100, offset: 0 } },
  },
 });
 assert.match(page.html, /<form[^>]*method="get"[^>]*>/i);
 assert.match(page.html, /name="limit" value="10"/);
 assert.doesNotMatch(page.html, /name="offset"/);
 assert.match(page.html, new RegExp(`<input type="hidden" name="patient_id" value="${patient}"`));
 assert.match(page.html, new RegExp(`<option value="${subject}" selected[^>]*>Higiene II`));
 assert.match(page.html, new RegExp(`<option value="${group}" selected[^>]*>Grupo A · 2026 · semestre 2`));
 assert.doesNotMatch(page.html, /patient-filter|Paciente \(UUID\)/);
 assert.doesNotMatch(page.html, /<datalist[^>]*patient|patient-options|Doc\.|documento|email|celular/);
 assert.match(page.html, /href="\?limit=10&offset=0"[^>]*>Limpiar filtros/);
 assert.match(page.html, /No hay borradores que coincidan con los filtros/);
});

test('S4 subject selection offers only associated groups with readable labels and hides UUID controls and labels', async () => {
 const associated = '33333333-3333-4333-8333-333333333333';
 const unrelated = '44444444-4444-4444-8444-444444444444';
 const page = await renderAdmin(listPage, {
  search: `subject_id=${subject}&academic_group_id=${associated}`,
  responses: { 'GET /hygiene-preventive-drafts': { body: { items: [draft()] } } },
  catalogs: {
   subjects: { state: 'success', page: { items: [{ id: subject, name: 'Higiene II' }] } },
   groups: { state: 'success', page: { items: [{ id: associated, name: 'Grupo A', academic_year: 2026, curriculum_semester: 2 }, { id: unrelated, name: 'Grupo B', academic_year: 2026, curriculum_semester: 1 }] } },
   associations: { state: 'success', page: { items: [{ subject_id: subject, academic_group_id: associated }] } },
  },
 });
 assert.match(page.html, /name="subject_id"/);
 assert.match(page.html, /name="academic_group_id"/);
 assert.match(page.html, /Grupo A · 2026 · semestre 2/);
 assert.doesNotMatch(page.html, /Grupo B/);
 assert.doesNotMatch(page.html, /patient-filter|UUID|Paciente [0-9a-f]{8}-|Asignatura de origen [0-9a-f]{8}-|Grupo de origen [0-9a-f]{8}-/i);
});

test('S5 unavailable subject catalog preserves the selected subject as a human-readable option', async () => {
 for (const subjects of [
  { state: 'denied' },
  { state: 'failed' },
  { state: 'success', page: { items: [{ id: group, name: 'Otro' }], limit: 100, offset: 0 } },
 ]) {
  const page = await renderAdmin(listPage, {
   search: `subject_id=${subject}&academic_group_id=${group}`,
   responses: { 'GET /hygiene-preventive-drafts': { body: { items: [draft()] } } },
   catalogs: { subjects, associations: { state: 'failed' } },
  });
  assert.match(page.html, new RegExp(`<option value="${subject}" selected[^>]*>Materia seleccionada no disponible`));
  assert.match(page.html, /<option value=""[^>]*>Todas las materias/);
  assert.doesNotMatch(page.html, new RegExp(`>${subject}<`));
 }
});

test('S5 an incomplete association listing does not clear an unconfirmed group and explains partial coverage', async () => {
 const page = await renderAdmin(listPage, {
  search: `subject_id=${subject}&academic_group_id=${group}`,
  responses: { 'GET /hygiene-preventive-drafts': { body: { items: [draft()] } } },
  catalogs: { associations: { state: 'failed' } },
 });
 assert.match(page.html, new RegExp(`<option value="${group}" selected[^>]*>Grupo seleccionado; asociación no confirmada`));
 assert.match(page.html, /No se pudo verificar la asociación.*cobertura es parcial/);
});

test('A2 unavailable catalogs do not block an academic ID filter or list results', async () => {
 const page = await renderAdmin(listPage, {
  search: `academic_group_id=${group}`,
  responses: { 'GET /hygiene-preventive-drafts': { body: { items: [draft()] } } },
  catalogs: { subjects: { state: 'denied' }, groups: { state: 'failed' } },
 });
 assert.deepEqual(calls.map((call) => call.path), [`/hygiene-preventive-drafts?limit=50&offset=0&academic_group_id=${group}`]);
 assert.match(page.html, new RegExp(`<option value="${group}" selected[^>]*>Grupo seleccionado; asociación no confirmada`));
 assert.match(page.html, /No tenés permiso para consultar las materias/);
 assert.match(page.html, /No se pudo consultar el catálogo de grupos/);
 assert.match(page.html, /Ver borrador/);
});

test('A2 date parameters are not part of this list: the request carries only limit and offset', async () => {
 await renderAdmin(listPage, { search: 'date_from=2026-11-01&limit=5', responses: { 'GET /hygiene-preventive-drafts': { body: { items: [] } } } });
 assert.deepEqual(calls.map((call) => call.path), ['/hygiene-preventive-drafts?limit=5&offset=0']);
});

test('A2 non-admin sessions and invalid paging send no request', async () => {
 for (const [actor, search] of [[admin({ role: 'teacher' }), ''], [admin({ permissions: [] }), ''], [null, ''], [admin(), 'limit=500'], [admin(), 'subject_id=invalid']]) {
  const page = await renderAdmin(listPage, { actor, search, responses: { 'GET /hygiene-preventive-drafts': { body: { items: [] } } } });
  assert.equal(calls.length, 0, search);
  assert.doesNotMatch(page.html ?? '', /Borrador [0-9]/);
 }
 const invalid = await renderAdmin(listPage, { search: 'limit=500', responses: {} });
 assert.match(invalid.html, /La paginación no es válida\./);
 const invalidFilter = await renderAdmin(listPage, { search: 'subject_id=invalid' });
 assert.match(invalidFilter.html, /Los filtros no son válidos\./);
});

test('A2 401 redirects to login, 403 is a permission notice, other failures and malformed items are an alert', async () => {
 let page = await renderAdmin(listPage, { search: 'limit=50', responses: { 'GET /hygiene-preventive-drafts': { status: 401 } } });
 assert.equal(page.redirect, `/auth/login?returnTo=${encodeURIComponent('/hygiene-preventive-admin?limit=50')}`);
 page = await renderAdmin(listPage, { responses: { 'GET /hygiene-preventive-drafts': { status: 403 } } });
 assert.match(page.html, /No tenés permiso vigente para consultar los borradores de Higiene y Preventiva II\./);
 for (const response of [{ status: 500 }, { network: true }, { body: { items: [{ ...draft(), status: 'closed' }] } }]) {
  page = await renderAdmin(listPage, { responses: { 'GET /hygiene-preventive-drafts': response } });
  assert.match(page.html, /No se pudieron cargar los borradores de Higiene y Preventiva II\./);
  assert.doesNotMatch(page.html, /Ver borrador/);
 }
});

// A3: read-only detail page. Origin is not checked here: the admin reads every draft.

test('A3 the detail reads the draft once, renders its content read-only and keeps the list query for the back link', async () => {
 const page = await renderAdmin(detailPage, { search: 'limit=20&offset=40', responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() } } });
 assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [`GET /hygiene-preventive-drafts/${id}`, `GET /hygiene-preventive-drafts/${id}/consent`, `GET /hygiene-preventive-drafts/${id}/procedures`]);
 assert.match(page.html, /Losartán/);
 assert.match(page.html, /Higiene y Preventiva II · consulta de borrador/);
 assert.match(page.html, /href="\/hygiene-preventive-admin\?limit=20&offset=40"/);
 assert.match(page.html, /Consulta de solo lectura/);
 assert.doesNotMatch(page.html, /<form|method="POST"|<button/);
 assert.equal(page.cacheControl, 'no-store');
});

test('A3 invalid ids and non-admin sessions send no request; 404, 403 and 401 have their own states', async () => {
 for (const [pageId, actor] of [['0', admin()], ['abc', admin()], [id, admin({ role: 'teacher' })], [id, null]]) {
  const page = await renderAdmin(detailPage, { actor, pageId, responses: { [`GET /hygiene-preventive-drafts/${pageId}`]: { body: draft() } } });
  assert.equal(calls.length, 0, pageId);
  assert.doesNotMatch(page.html ?? '', /Losartán/);
 }
 let page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { status: 404 } } });
 assert.match(page.html, new RegExp(UNAVAILABLE));
 page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { status: 403 } } });
 assert.match(page.html, /No tenés permiso vigente para consultar este borrador\./);
 page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { status: 401 } } });
 assert.equal(page.redirect, `/auth/login?returnTo=${encodeURIComponent(`/hygiene-preventive-admin/${id}`)}`);
});

// A4: no mutating form in the admin read pages.

test('A4 both admin read pages compile with no form that posts or calls an action', async () => {
 for (const path of [listPage, detailPage]) {
  const source = await readFile(new URL(path, root), 'utf8');
  const compiled = await transform(source, { filename: path });
  assert.equal(compiled.diagnostics.filter((item) => item.severity === 1).length, 0, path);
  assert.doesNotMatch(source, /method="POST"|astro:actions/i, path);
 }
});

// A5: navigation (D9). Admin links sit with the Oral Surgery admin entry; other roles keep today's links.

test('A5 the navigation shows the hygiene admin and subject links only to administrators with their grants', async () => {
 const source = await readFile(new URL('src/layouts/Layout.astro', root), 'utf8');
 const frontmatter = source.split('---')[1].replace(/^import .*\.astro';\r?$/gm, '');
 const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
 const body = frontmatter.replace(/^import .*;\r?$/gm, '');
 const layoutUrl = new URL('src/layouts/Layout.astro', root).href;
 async function shell(payload, pathname = '/') {
  const sandbox = vm.createContext({
   atob, Date,
   Astro: { cookies: { get: (name) => (name === 'session' ? { value: jwt({ exp: 4102444800, ...payload }) } : undefined) }, url: new URL(pathname, 'https://frontend.invalid') },
  });
  async function compile(code, identifier) {
   const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
   const module = new vm.SourceTextModule(output, { context: sandbox, identifier });
   await module.link(async (specifier, parent) => {
    const url = new URL(`${specifier}.ts`, parent.identifier);
    return compile(await readFile(url, 'utf8'), url.href);
   });
   return module;
  }
  const module = await compile(`${imports.join('\n')}\nexport function render() { ${body}\nreturn { clinicalLinks, pageTitle }; }`, layoutUrl);
  await module.evaluate();
  return JSON.parse(JSON.stringify(module.namespace.render()));
 }
 const hygieneRead = await shell({ role: 'admin', permissions: [readGrant] }, '/hygiene-preventive-admin/12');
 assert.deepEqual(hygieneRead.clinicalLinks, [{ href: '/hygiene-preventive-admin', label: 'Higiene y Preventiva II' }]);
 assert.equal(hygieneRead.pageTitle, 'Higiene y Preventiva II');
 const both = await shell({ role: 'admin', permissions: ['oral-surgery-drafts:read', readGrant, 'hygiene-preventive-subjects:write'] });
 assert.deepEqual(both.clinicalLinks, [
  { href: '/oral-surgery-admin', label: 'Cirugía Oral I' },
  { href: '/hygiene-preventive-admin', label: 'Higiene y Preventiva II' },
  { href: '/hygiene-preventive-subjects', label: 'Habilitar Higiene y Preventiva II' },
 ]);
 const subjectsRead = await shell({ role: 'admin', permissions: ['hygiene-preventive-subjects:read'] });
 assert.deepEqual(subjectsRead.clinicalLinks, [{ href: '/hygiene-preventive-subjects', label: 'Habilitar Higiene y Preventiva II' }]);
 for (const payload of [{ role: 'admin' }, { role: 'reception', permissions: [readGrant] }, { role: 'student', permissions: [readGrant] }]) {
  assert.deepEqual((await shell(payload)).clinicalLinks.filter((link) => link.href.includes('hygiene')), [], JSON.stringify(payload));
 }
 const teacher = await shell({ role: 'teacher', permissions: ['patient-assignments:read', 'kinesiology-evaluations:read', readGrant] });
 assert.deepEqual(teacher.clinicalLinks, [{ href: '/teacher-clinical', label: 'Acceso clínico docente' }]);
});

test('A3 a draft with stored plaque renders read-only without a load error', async () => {
	const plaqueStored = {
		loe_silness: { teeth: { 16: { distal: 2, vestibular: 2, mesial: 2, lingual: 1 } }, average: 1.75, category: 'abundant' },
		oleary: { teeth: { 11: { mesial: true, distal: false, vestibular: false, lingual: false } }, stained_surfaces: 1, present_surfaces: 4, percentage: 25, category: 'good' },
	};
	const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft({ content: { ...content, plaque: plaqueStored } }) } } });
	assert.match(page.html, /Losartán/);
	assert.doesNotMatch(page.html, /No se pudo cargar el borrador/);
	assert.doesNotMatch(page.html, /<form|method="POST"|<button/);
});

// S3: the consent history is read-only for administrators; a failed consent read never hides the draft.

const adminConsentRoute = (overrides) => ({ [`GET /hygiene-preventive-drafts/${id}/consent`]: overrides });
const adminConsentHistory = {
 current_declaration_id: '12',
 declarations: [
  { id: '11', draft_id: id, signer: 'patient', signer_name: 'Ana Pérez', signer_document: '12345678', declared_by: author, declared_at: iso },
  { id: '12', draft_id: id, signer: 'parent', signer_name: 'Laura Pérez', signer_document: '30123456', declared_by: author, declared_at: iso },
 ],
};

test('S3 the admin detail shows the consent history read-only, oldest first, with the current mark and no form', async () => {
 const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() }, ...adminConsentRoute({ body: adminConsentHistory }) } });
 assert.match(page.html, /Consentimiento en papel/);
 assert.ok(page.html.indexOf('Ana Pérez') < page.html.indexOf('Laura Pérez'), 'oldest first');
 assert.equal((page.html.match(/vigente/g) ?? []).length, 1);
 assert.doesNotMatch(page.html, /<form|method="POST"|<button/);
});

test('S3 a consent read failure is a section error and the admin draft still renders', async () => {
 const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() }, ...adminConsentRoute({ status: 500 }) } });
 assert.match(page.html, /Losartán/);
 assert.match(page.html, /No se pudo cargar el consentimiento/);
 assert.doesNotMatch(page.html, /<form|method="POST"|<button/);
});

test('S3 a 401 on the admin consent read redirects to login', async () => {
 const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() }, ...adminConsentRoute({ status: 401 }) } });
 assert.equal(page.redirect, `/auth/login?returnTo=${encodeURIComponent(`/hygiene-preventive-admin/${id}`)}`);
});

// S4: the procedure log is read-only for administrators; a failed read never hides the draft.

const adminProcedureRoute = (overrides) => ({ [`GET /hygiene-preventive-drafts/${id}/procedures`]: overrides });
const adminProcedureEntry = (overrides = {}) => ({
 id: '21', draft_id: id, procedure_date: '2026-11-10', description: 'Profilaxis', author_id: author, student_name: 'Ana Pérez',
 version: '4', approved_by: null, teacher_name: null, approved_at: null, created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});

test('S4 the admin detail shows the procedure log read-only, in creation order, with no form', async () => {
 const approved = adminProcedureEntry({ id: '22', description: 'Destartraje', version: '5', approved_by: '77777777-7777-4777-8777-777777777777', teacher_name: 'Marta Gómez', approved_at: iso, status: 'approved' });
 const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() }, ...adminProcedureRoute({ body: { items: [adminProcedureEntry(), approved] } }) } });
 assert.match(page.html, /Registro de procedimientos/);
 assert.ok(page.html.indexOf('Profilaxis') < page.html.indexOf('Destartraje'), 'creation order');
 assert.match(page.html, /Aprobado por Marta Gómez/);
 assert.doesNotMatch(page.html, /<form|method="POST"|<button/);
});

test('S4 a procedure read failure is a section error and the admin draft still renders', async () => {
 const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() }, ...adminProcedureRoute({ status: 500 }) } });
 assert.match(page.html, /Losartán/);
 assert.match(page.html, /No se pudo cargar el registro de procedimientos/);
 assert.doesNotMatch(page.html, /<form|method="POST"/);
});

test('S4 a 401 on the admin procedure read redirects to login', async () => {
 const page = await renderAdmin(detailPage, { responses: { [`GET /hygiene-preventive-drafts/${id}`]: { body: draft() }, ...adminProcedureRoute({ status: 401 }) } });
 assert.equal(page.redirect, `/auth/login?returnTo=${encodeURIComponent(`/hygiene-preventive-admin/${id}`)}`);
});
