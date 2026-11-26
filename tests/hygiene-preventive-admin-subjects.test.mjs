import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const subjectsPage = 'src/pages/hygiene-preventive-subjects.astro';
const handlerPath = 'src/pods/hygiene-preventive-draft/actions/subjects.ts';
const readPermission = 'hygiene-preventive-subjects:read';
const writePermission = 'hygiene-preventive-subjects:write';
const subjectA = '01234567-89ab-4def-8123-456789abcdef';
const subjectB = '10000000-0000-4000-8000-000000000002';
const careerId = '20000000-0000-4000-8000-000000000001';
const adminId = '77777777-7777-4777-8777-777777777777';
const iso = '2026-11-18T12:00:00.000Z';
const ENABLE_UNCERTAIN = 'No se pudo confirmar la habilitación. Recargá la lista antes de volver a intentarlo.';

class FixtureApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

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
const admin = await loadCjs('src/pods/hygiene-preventive-draft/admin.ts', { '../../shared/jwt': jwtModule, './api': hygieneApi });
const listSearch = await loadCjs('src/pods/subject/list-search.ts');
const subjectApi = await loadCjs('src/pods/subject/api.ts', { '../../shared/apiClient': apiShim, './list-search': listSearch });
const academic = await loadCjs('src/shared/academic-api.ts');
const handler = await loadCjs(handlerPath, { '../../../shared/apiClient': apiShim, '../api': hygieneApi });

const token = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const cookiesFor = (permissions, role = 'admin') => {
 const value = token({ sub: adminId, username: 'admin', role, permissions, exp: 4102444800, iat: 1 });
 return { get: (name) => (name === 'session' ? { value } : undefined), set() {}, delete() {} };
};
const link = (subjectId) => ({ subject_id: subjectId, career_id: careerId, created_by: adminId, created_at: iso });
const subjectPage = (items, offset = 0) => ({ items, limit: 50, offset });

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

/** Subjects screen with real enabled-list, subject-list and pagination helpers; `action` is the enable action result. */
async function renderSubjects({ permissions = [], responses = {}, action, search = '' } = {}) {
 routes = responses;
 calls = [];
 const headers = new Headers();
 const Astro = {
  props: {}, params: {}, cookies: cookiesFor(permissions), request: new Request('https://fixture.invalid'),
  url: new URL(`https://fixture.invalid/hygiene-preventive-subjects?${search}`),
  getActionResult: () => action, response: { headers }, redirect: (url) => ({ redirect: url }),
 };
 const mocks = {
  ...helpers, ...hygieneApi, ...labels, ...admin, ...academic, Layout: null, Fragment: null, ApiError: FixtureApiError, $$renderComponent: renderComponent,
  listSubjects: subjectApi.listSubjects, parseAcademicPagination: academic.parseAcademicPagination,
  academicPaginationNavigation: academic.academicPaginationNavigation,
  hygienePermissionGrant: admin.hygienePermissionGrant,
  actions: { enableHygieneSubject: '/_actions/enableHygieneSubject' }, isInputError: () => false,
 };
 const component = await compileAstro(subjectsPage, mocks);
 const value = await component({ createAstro: () => Astro }, {}, {});
 if (value && typeof value === 'object' && 'redirect' in value) return { redirect: value.redirect, calls };
 return { html: await html(value), calls };
}

const subjectsRoute = (items) => ({ 'GET /subjects': { body: subjectPage(items) } });
const enabledRoute = (items) => ({ 'GET /hygiene-preventive-subjects': { body: { items } } });

// D9 subject enabling screen: the enabled list needs read, the form needs write, and both pages come from the real API.

test('D9 without either subject permission the screen sends no request and says so', async () => {
 const page = await renderSubjects({ permissions: ['hygiene-preventive-drafts:read'], responses: { ...subjectsRoute([]), ...enabledRoute([]) } });
 assert.deepEqual(page.calls, []);
 assert.match(page.html, /No tenés permiso para consultar las asignaturas habilitadas de Higiene y Preventiva II\./);
 assert.doesNotMatch(page.html, /<form/);
});

test('D9 the enable form appears only with the write grant', async () => {
 const readOnly = await renderSubjects({ permissions: [readPermission], responses: { ...subjectsRoute([{ id: subjectA, name: 'Odontología Clínica' }]), ...enabledRoute([]) } });
 assert.doesNotMatch(readOnly.html, /<form|irreversible_confirmed|Habilitar para Higiene y Preventiva II/);
 const writeOnly = await renderSubjects({ permissions: [writePermission], responses: { ...subjectsRoute([{ id: subjectA, name: 'Odontología Clínica' }]) } });
 assert.match(writeOnly.html, /<form/);
 assert.deepEqual(writeOnly.calls.map((call) => call.path.split('?')[0]), ['/subjects']);
});

test('D9 the form has a subject select, the required confirmation checkbox and the exact button', async () => {
 const page = await renderSubjects({ permissions: [readPermission, writePermission], responses: { ...subjectsRoute([{ id: subjectA, name: 'Odontología Clínica' }]), ...enabledRoute([]) } });
 assert.match(page.html, /<select[^>]*name="subject_id"/);
 assert.match(page.html, /<input[^>]*type="checkbox"[^>]*name="irreversible_confirmed"[^>]*value="on"[^>]*required/);
 assert.match(page.html, /Entiendo que la habilitación no se puede deshacer desde el sistema\./);
 assert.match(page.html, /<button[^>]*type="submit"[^>]*>Habilitar para Higiene y Preventiva II<\/button>/);
});

test('D9 the select offers only subjects that are not enabled yet, and the enabled list names them when the subjects page has them', async () => {
 const page = await renderSubjects({
  permissions: [readPermission, writePermission],
  responses: { ...subjectsRoute([{ id: subjectA, name: 'Odontología Clínica' }, { id: subjectB, name: 'Anatomía' }]), ...enabledRoute([link(subjectA)]) },
 });
 const select = page.html.match(/<select[\s\S]*?<\/select>/)[0];
 assert.doesNotMatch(select, new RegExp(`value="${subjectA}"`));
 assert.match(select, new RegExp(`value="${subjectB}"`));
 assert.match(page.html, /Odontología Clínica/);
});

test('D9 an enabled subject outside the loaded subject page is shown by its id', async () => {
 const page = await renderSubjects({ permissions: [readPermission], responses: { ...subjectsRoute([{ id: subjectB, name: 'Anatomía' }]), ...enabledRoute([link(subjectA)]) } });
 assert.match(page.html, new RegExp(`Asignatura ${subjectA}`));
});

test('D9 a success result redirects to the list with the enabled flag, and the flag shows the confirmation', async () => {
 const redirected = await renderSubjects({ permissions: [readPermission, writePermission], action: { data: { success: true, subject_id: subjectA } }, responses: { ...subjectsRoute([]), ...enabledRoute([]) } });
 assert.equal(redirected.redirect, '/hygiene-preventive-subjects?enabled=1');
 const flagged = await renderSubjects({ permissions: [readPermission, writePermission], search: 'enabled=1', responses: { ...subjectsRoute([]), ...enabledRoute([]) } });
 assert.match(flagged.html, /Asignatura habilitada para Higiene y Preventiva II\./);
});

test('D9 an action error keeps the form visible with its copy; a session expiry redirects to login', async () => {
 const failed = await renderSubjects({
  permissions: [readPermission, writePermission], action: { data: { success: false, uncertain: false, error: 'La asignatura ya estaba habilitada.' } },
  responses: { ...subjectsRoute([{ id: subjectA, name: 'Odontología Clínica' }]), ...enabledRoute([]) },
 });
 assert.match(failed.html, /role="alert"[^>]*>La asignatura ya estaba habilitada\./);
 assert.match(failed.html, /<form/);
 const uncertain = await renderSubjects({
  permissions: [readPermission, writePermission], action: { data: { success: false, uncertain: true, error: ENABLE_UNCERTAIN } },
  responses: { ...subjectsRoute([]), ...enabledRoute([]) },
 });
 assert.match(uncertain.html, new RegExp(ENABLE_UNCERTAIN.replace(/[.]/g, '\\.')));
 const expired = await renderSubjects({
  permissions: [readPermission, writePermission], action: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Volvé a iniciar sesión.' } },
  responses: { ...subjectsRoute([]), ...enabledRoute([]) },
 });
 assert.equal(expired.redirect, `/auth/login?returnTo=${encodeURIComponent('/hygiene-preventive-subjects')}`);
});

test('D9 a 401 while reading the enabled list redirects to login; a 500 is an alert and no form is offered as settled', async () => {
 const unauthorized = await renderSubjects({ permissions: [readPermission], responses: { ...subjectsRoute([]), 'GET /hygiene-preventive-subjects': { status: 401 } } });
 assert.equal(unauthorized.redirect, `/auth/login?returnTo=${encodeURIComponent('/hygiene-preventive-subjects')}`);
 const failed = await renderSubjects({ permissions: [readPermission], responses: { ...subjectsRoute([]), 'GET /hygiene-preventive-subjects': { status: 500 } } });
 assert.match(failed.html, /role="alert"[^>]*>No se pudieron cargar las asignaturas habilitadas\./);
});

// D9 handler: one POST, every status mapped to its copy, and an unconfirmed success is never reported as enabled.

const form = { subject_id: subjectA, irreversible_confirmed: 'on' };
async function enable(responses) {
 routes = responses;
 calls = [];
 const result = await handler.handleEnableHygieneSubject(form, { cookies: cookiesFor([writePermission]) });
 return { result: JSON.parse(JSON.stringify(result)), posts: calls.filter((call) => call.method === 'POST') };
}

test('D9 enable sends exactly one POST with the subject id and reports the success', async () => {
 const { result, posts } = await enable({ 'POST /hygiene-preventive-subjects': { status: 201, body: link(subjectA) } });
 assert.deepEqual(posts.map((post) => [post.path, post.body]), [['/hygiene-preventive-subjects', { subject_id: subjectA }]]);
 assert.deepEqual(result, { success: true, subject_id: subjectA });
});

test('D9 each failure status keeps its own copy and only the unknown outcome is marked uncertain; no retry happens', async () => {
 const cases = [
  [404, 'La asignatura no existe o no es de Odontología.', false],
  [409, 'La asignatura ya estaba habilitada.', false],
  [403, 'No tenés permiso para habilitar asignaturas de Higiene y Preventiva II.', false],
  [401, 'Tu sesión venció. Volvé a iniciar sesión.', false],
  [400, 'No se pudo habilitar la asignatura. Revisá la selección.', false],
  [500, ENABLE_UNCERTAIN, true],
 ];
 for (const [status, error, uncertain] of cases) {
  const { result, posts } = await enable({ 'POST /hygiene-preventive-subjects': { status } });
  assert.deepEqual(result, { success: false, uncertain, error }, String(status));
  assert.equal(posts.length, 1, `one POST for ${status}`);
 }
});

test('D9 a network failure is uncertain and sends exactly one POST', async () => {
 const { result, posts } = await enable({ 'POST /hygiene-preventive-subjects': { network: true } });
 assert.deepEqual(result, { success: false, uncertain: true, error: ENABLE_UNCERTAIN });
 assert.equal(posts.length, 1);
});

test('D9 a 201 whose body does not confirm the subject is uncertain, never a success', async () => {
 for (const body of [{ ...link(subjectA), subject_id: subjectB }, { subject_id: subjectA }, 'ok']) {
  const { result, posts } = await enable({ 'POST /hygiene-preventive-subjects': { status: 201, body } });
  assert.deepEqual(result, { success: false, uncertain: true, error: ENABLE_UNCERTAIN });
  assert.equal(posts.length, 1);
 }
});

test('D9 a malformed subject id is refused before any request', async () => {
 routes = {};
 calls = [];
 const refused = JSON.parse(JSON.stringify(await handler.handleEnableHygieneSubject({ subject_id: 'nope', irreversible_confirmed: 'on' }, { cookies: cookiesFor([writePermission]) })));
 assert.deepEqual(refused, { success: false, uncertain: false, error: 'La asignatura no es válida.' });
 assert.equal(calls.length, 0);
});
