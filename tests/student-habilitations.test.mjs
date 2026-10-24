import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'astro/zod';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const modulePath = 'src/pods/student-habilitation/api.ts';
const actionsPath = 'src/pods/student-habilitation/actions.ts';
const uuid = '10000000-0000-4000-8000-000000000021';
const filterStudent = '10000000-0000-4000-8000-000000000022';
const context = '10000000-0000-4000-8000-000000000041';
const subject = '10000000-0000-4000-8000-000000000031';
const period = { id: uuid, student_id: uuid, subject_id: subject, academic_group_id: context, activated_by: uuid, activated_at: '2026-01-01T00:00:00.000Z', revoked_by: null, revoked_at: null };

async function executePage(search = '', options = {}) {
 const page = (await source('src/pages/student-habilitations.astro')).split('---')[1]
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
  .replace('export const prerender = false;', 'const prerender = false;');
 const requests = [];
 const ok = (items) => ({ state: 'success', page: { items, limit: 50, offset: 0 } });
 const mock = {
  actions: { activateStudentHabilitation: 'activate', revokeStudentHabilitation: 'revoke' },
  Layout: {}, listStudents: async (page) => { requests.push(['students', page]); return options.studentState === 'denied' ? { state: 'denied' } : ok([ { id: uuid, nombres: 'Ana', apellidos: 'Pérez', codalumno: 'A1' } ]); },
  listSubjects: async (page) => { requests.push(['subjects', page]); return ok([{ id: subject, name: 'Kinesiología' }]); },
  listGroups: async (page) => { requests.push(['groups', page]); return ok([{ id: context, academic_year: 2026, curriculum_semester: 1, name: 'A' }]); },
  listSubjectGroups: async (page) => { requests.push(['contexts', page]); return options.contextState ? { state: options.contextState } : ok(options.emptyContext ? [] : [{ subject_id: subject, academic_group_id: context, created_by: uuid, created_at: '2026-01-01T00:00:00.000Z' }]); },
  listStudentHabilitations: async (page, filters) => { requests.push(['periods', page, filters]); if (options.unauthorized) throw { status: 401 }; return ok([period]); },
  parseStudentFilters: (params) => ({ studentId: params.get('student_id') || null, subjectId: params.get('subject_id') || null, academicGroupId: params.get('academic_group_id') || null, status: params.get('status') || null }),
  parseSelectorPagination: (params, kind) => { const values = params.getAll(`${kind}_offset`); if (values.length > 1) throw Error('duplicate'); return { limit: 50, offset: values.length ? Number(values[0]) : 0 }; },
  UUID_PATTERN: /^[0-9a-f-]{36}$/i,
  academicPaginationNavigation: ({ offset, limit, itemsLength }) => ({ previousOffset: offset ? offset - limit : null, nextOffset: itemsLength === limit ? offset + limit : null }),
  parseAcademicPagination: (params) => ({ limit: Number(params.get('limit') || 50), offset: Number(params.get('offset') || 0) }),
  getSession: () => 'token',
 };
 const actionResult = options.actionResult;
 const Astro = { cookies: {}, url: new URL(`https://front.invalid/student-habilitations${search ? `?${search}` : ''}`),
  getActionResult: (action) => action === 'activate' ? actionResult : undefined,
  request: { clone: () => ({ formData: async () => new FormData() }) },
  redirect: (to) => ({ redirect: to }), };
 const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
 const transpiled = ts.transpileModule(page, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export \{\};?$/m, '');
 const fn = new AsyncFunction('Astro', ...Object.keys(mock), `${transpiled}; return { periods, selectedStudent, selectedPair, queryError, catalogError, periodState, studentState, contextState, contextLength: contexts.length, canActivate: typeof canActivate === 'undefined' ? null : canActivate, paramsFor, activationFeedback };`);
 return { value: await fn(Astro, ...Object.values(mock)), requests };
}

function serializePageForm(formMarkup, fields, submitter) {
 const names = new Set([...formMarkup.matchAll(/<(?:input|select)\b[^>]*\bname="([^"]+)"[^>]*>/g)].map(([, name]) => name));
 const data = new FormData();
 for (const [name, value] of Object.entries(fields)) {
  const dynamicCatalogControl = /^(student|context|subject|group)_(limit|offset)$/.test(name) && formMarkup.includes('name={`${name}_limit`}');
  assert.ok(names.has(name) || dynamicCatalogControl, `successful control ${name} belongs to the submitted form`);
  data.append(name, value);
 }
 const button = [...formMarkup.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag).find((tag) => tag.includes(`name="${submitter.name}"`));
 assert.ok(button, `submitter ${submitter.name} belongs to the submitted form`);
 assert.match(button, /formmethod="GET"/);
 assert.match(button, /formnovalidate/);
 data.append(submitter.name, submitter.value);
 return data;
}

async function load(path, options = {}) {
 const requests = [], writes = [];
 let token = 'session-token';
 const cookies = { get: (name) => name === 'session' && token ? { value: token } : undefined, set: (...args) => { writes.push(['set', ...args]); token = args[1]; }, delete: (...args) => { writes.push(['delete', ...args]); token = undefined; } };
 const sandbox = vm.createContext({ URLSearchParams, Date, fetch: async (url, init) => {
  requests.push({ url, ...init });
  if (options.networkError) throw Error('offline');
  const response = options.respond?.(url, init) ?? { body: options.body ?? { ...period }, status: options.status ?? 201 };
  return Response.json(response.body, { status: response.status });
 }, Response });
 async function compile(code, identifier) {
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = new vm.SourceTextModule(output, { context: sandbox, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; } });
  await module.link(async (specifier, parent) => {
   if (specifier === 'astro') return new vm.SourceTextModule('export {}', { context: sandbox });
   if (specifier === 'astro:actions') return new vm.SourceTextModule('export const defineAction = (value) => value;', { context: sandbox });
   if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () { this.setExport('z', z); }, { context: sandbox });
   const url = new URL(`${specifier}.ts`, parent.identifier);
   return compile(await readFile(url, 'utf8'), url.href);
  });
  return module;
 }
 const module = await compile(await source(path), new URL(path, root).href);
 await module.evaluate();
 return { api: module.namespace, requests, writes, cookies };
}

test('student habilitation listing validates audit facts and sends exact backend filters and pagination', async () => {
 const { api, requests, cookies } = await load(modulePath, { body: { items: [period], limit: 10, offset: 20 } });
 const result = await api.listStudentHabilitations({ limit: 10, offset: 20 }, { studentId: uuid, subjectId: subject, academicGroupId: context, status: 'active' }, cookies);
 assert.equal(result.state, 'success', JSON.stringify(requests));
 assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { url: 'https://backend.invalid/student-habilitations?student_id=' + uuid + '&subject_id=' + subject + '&academic_group_id=' + context + '&status=active&limit=10&offset=20', method: 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session-token' } });
});

test('activation and revocation allowlist profile/context and period identities; revoke requires confirmation', async () => {
 const { api, requests, cookies } = await load(actionsPath);
 const activated = await api.handleActivateStudentHabilitation({ student_id: uuid, context_pair: `${subject}|${context}`, activated_by: 'spoof' }, { cookies });
 assert.equal(activated.success, true, JSON.stringify(requests));
 assert.deepEqual(JSON.parse(requests[0].body), { student_id: uuid, subject_id: subject, academic_group_id: context });
 const before = requests.length;
 const declined = await api.handleRevokeStudentHabilitation({ id: uuid, confirm_consequences: 'no' }, { cookies });
 assert.equal(declined.success, false);
 assert.equal(requests.length, before);
});

test('malformed replies and backend errors never report success; 401 clears session only', async () => {
 const malformed = await load(actionsPath, { body: { id: 'bad' } });
 assert.equal((await malformed.api.handleActivateStudentHabilitation({ student_id: uuid, context_pair: `${subject}|${context}` }, { cookies: malformed.cookies })).success, false);
 for (const status of [400, 401, 403, 404, 409, 500]) {
  const loaded = await load(actionsPath, { status, body: { error: { code: 'ERR', message: 'backend detail' } } });
  const result = await loaded.api.handleActivateStudentHabilitation({ student_id: uuid, context_pair: `${subject}|${context}` }, { cookies: loaded.cookies });
  assert.equal(result.success, false);
  assert.equal(loaded.writes.length, status === 401 ? 1 : 0);
 }
});

test('optional blank GET selects normalize to no filter, while duplicates and invalid values are rejected', async () => {
 const { api } = await load(modulePath);
 assert.deepEqual(JSON.parse(JSON.stringify(api.parseStudentFilters(new URLSearchParams('student_id=&subject_id=&academic_group_id=&status=')))), { studentId: null, subjectId: null, academicGroupId: null, status: null });
 for (const query of ['student_id=&student_id=', 'student_id=unknown', 'status=unknown', 'status=&status=active']) assert.throws(() => api.parseStudentFilters(new URLSearchParams(query)));
});

test('selector pagination accepts valid decimal offsets and rejects repeated, malformed, and out-of-range values', async () => {
 const page = await source('src/pages/student-habilitations.astro');
 assert.match(page, /parseAcademicPagination/);
 const { api } = await load(modulePath);
 for (const query of ['student_offset=50', 'context_offset=50']) assert.equal(api.parseSelectorPagination(new URLSearchParams(query), query.startsWith('student') ? 'student' : 'context').offset, 50);
 for (const query of ['student_offset=50&student_offset=100', 'context_offset=nope', 'context_offset=10001']) assert.throws(() => api.parseSelectorPagination(new URLSearchParams(query), query.startsWith('student') ? 'student' : 'context'));
 assert.doesNotMatch(page, /\/\\\\d\+\//);
});

test('linked context form schema receives pair directly and rejects malformed pairs without JS fields', async () => {
 const { api } = await load(actionsPath);
 const schema = api.activateStudentHabilitation.input;
 const body = new FormData();
 body.set('student_id', uuid); body.set('context_pair', `${subject}|${context}`);
 const parsed = schema.safeParse(Object.fromEntries(body));
 assert.equal(parsed.success, true);
 assert.deepEqual(JSON.parse(JSON.stringify(parsed.data)), { student_id: uuid, context_pair: `${subject}|${context}` });
 assert.equal(schema.safeParse({ student_id: uuid, context_pair: 'bad' }).success, false);
});

test('activation response must match the selected profile and linked context; revocation is idempotently validated', async () => {
 const mismatched = await load(actionsPath, { body: { ...period, student_id: subject } });
 const activation = await mismatched.api.handleActivateStudentHabilitation({ student_id: uuid, context_pair: `${subject}|${context}` }, { cookies: mismatched.cookies });
 assert.equal(activation.success, false);
 const revoked = { ...period, id: subject, revoked_by: subject, revoked_at: '2026-02-01T00:00:00.000Z' };
 for (const response of [revoked, revoked]) {
  const loaded = await load(actionsPath, { status: 200, body: response });
  const result = await loaded.api.handleRevokeStudentHabilitation({ id: subject.toUpperCase(), confirm_consequences: 'yes' }, { cookies: loaded.cookies });
  assert.equal(result.success, true);
  assert.equal(loaded.requests[0].url, `https://backend.invalid/student-habilitations/${subject.toUpperCase()}/revoke`);
  assert.equal(loaded.requests[0].method, 'POST');
  assert.equal(loaded.requests[0].body, undefined);
 }
});

test('malformed revocation audit facts and activation timestamps never produce success', async () => {
 const invalidPeriods = [
  { ...period, activated_at: 'not-a-date' },
  { ...period, revoked_by: subject, revoked_at: null },
  { ...period, revoked_by: subject, revoked_at: '2025-12-31T23:59:59.000Z' },
 ];
 for (const body of invalidPeriods) {
  const loaded = await load(actionsPath, { body });
  const result = await loaded.api.handleRevokeStudentHabilitation({ id: uuid, confirm_consequences: 'yes' }, { cookies: loaded.cookies });
  assert.equal(result.success, false);
 }
});

test('framework action errors remain visible in evaluated page frontmatter', async () => {
 const evaluated = await executePage('', { actionResult: { error: { message: 'Revisá la asociación seleccionada.' } } });
 assert.equal(evaluated.value.activationFeedback, 'Revisá la asociación seleccionada.');
});

test('real page frontmatter runs default GET, empty filter form shape, and namespaced selector pagination', async () => {
 const evaluated = await executePage('student_offset=50&context_offset=50');
 assert.equal(evaluated.value.redirect, undefined);
 assert.equal(evaluated.value.queryError, '');
 assert.deepEqual(evaluated.requests.filter(([kind]) => kind === 'students')[0][1], { limit: 50, offset: 50 });
 assert.deepEqual(evaluated.requests.filter(([kind]) => kind === 'contexts')[0][1], { limit: 50, offset: 50 });
 assert.equal(evaluated.value.periodState, 'success');
 const page = await source('src/pages/student-habilitations.astro');
 assert.ok(page.includes('<select name="student_id"><option value="">Todos</option>'));
 assert.ok(page.includes('<select name="status"><option value="">Todos</option>'));
});

test('page preserves selected profile/context and all filters through catalog and period navigation', async () => {
 const query = new URLSearchParams({ student_offset: '50', context_offset: '100', subject_offset: '150', group_offset: '200', draft_student_id: uuid, draft_context: `${subject}|${context}`, student_id: '', subject_id: subject, academic_group_id: '', status: 'active', limit: '20', offset: '20' });
 const evaluated = await executePage(query.toString());
 assert.equal(evaluated.value.selectedStudent, uuid);
 assert.equal(evaluated.value.selectedPair, `${subject}|${context}`);
 assert.ok(evaluated.value.paramsFor({ offset: '40' }).includes(`draft_context=${encodeURIComponent(`${subject}|${context}`)}`));
 assert.match(evaluated.value.paramsFor({ offset: '40' }), /subject_id=.*status=active/);
 assert.equal(new URL(evaluated.value.paramsFor({ offset: '40' }), 'https://front.invalid').searchParams.has('student_id'), false);
 const page = await source('src/pages/student-habilitations.astro');
 assert.match(page, /selección conservada/);
 assert.match(page, /name="draft_student_id"/);
 assert.match(page, /name="draft_context"/);
});

test('catalog paging submits unsaved activation choices from the activation form without JavaScript', async () => {
 const page = await source('src/pages/student-habilitations.astro');
 const form = page.match(/<form method="POST" action=\{actions\.activateStudentHabilitation\}>([\s\S]*?)<\/form>/)?.[1] ?? '';
 const submitted = serializePageForm(form, {
  student_id: uuid, context_pair: `${subject}|${context}`, filter_student_id: filterStudent, subject_id: '', academic_group_id: '', status: '',
  limit: '20', offset: '0', student_limit: '50', student_offset: '0', context_limit: '50', context_offset: '0', subject_limit: '50', subject_offset: '0', group_limit: '50', group_offset: '0',
 }, { name: 'selector_page', value: 'context=50' });
 const result = await executePage(new URLSearchParams(submitted).toString());
 assert.equal(result.value.selectedStudent, uuid);
 assert.equal(result.value.selectedPair, `${subject}|${context}`);
 assert.equal(result.requests.find(([kind]) => kind === 'contexts')[1].offset, 50);
 assert.equal(result.requests.find(([kind]) => kind === 'periods')[2].studentId, filterStudent, 'existing period filter remains separate from the activation draft');
});

test('activation availability requires successful nonempty student and context catalogs while catalog navigation remains available', async () => {
 const allowed = await executePage();
 assert.equal(allowed.value.canActivate, true);
 for (const contextState of ['denied', 'failed']) {
  const unavailable = await executePage('', { contextState });
  assert.equal(unavailable.value.canActivate, false, `${contextState} contexts must disable activation`);
 }
 const empty = await executePage('', { emptyContext: true });
 assert.equal(empty.value.canActivate, false, 'an empty context catalog must disable activation');
 const page = await source('src/pages/student-habilitations.astro');
 assert.match(page, /name="selector_page"/);
 assert.match(page, /canActivate \? <button type="submit">Activar período<\/button> : <p role="status">La activación requiere perfiles y contextos vinculados disponibles en los catálogos\.<\/p>/);
});

test('selector navigation cannot overwrite duplicate original offsets before validation', async () => {
 for (const [prefix, navigation] of [['student', 'student=100'], ['context', 'context=100'], ['subject', 'subject=100'], ['group', 'group=100']]) {
  const query = `${prefix}_offset=0&${prefix}_offset=50&selector_page=${encodeURIComponent(navigation)}`;
  const evaluated = await executePage(query);
  assert.notEqual(evaluated.value.catalogError, '', `${prefix}: original duplicate offset must be rejected`);
  assert.equal(evaluated.requests.some(([kind]) => ['students', 'contexts', 'subjects', 'groups'].includes(kind)), false, `${prefix}: invalid selector query must not fetch catalogs`);
 }
 const valid = await executePage('student_offset=0&selector_page=student%3D100');
 assert.equal(valid.value.catalogError, '');
 assert.equal(valid.requests.find(([kind]) => kind === 'students')[1].offset, 100);
});

test('page keeps denied, failed, and empty contexts distinct and sends 401 reads to login', async () => {
 const denied = await executePage('', { contextState: 'denied' });
 assert.equal(denied.value.contextState, 'denied');
 const failed = await executePage('', { contextState: 'failed' });
 assert.equal(failed.value.contextState, 'failed');
 const empty = await executePage('', { emptyContext: true });
 assert.equal(empty.value.contextState, 'success');
 assert.equal(empty.value.contextLength, 0);
 const unauthorized = await executePage('', { unauthorized: true });
 assert.equal(unauthorized.value.redirect, '/auth/login?returnTo=%2Fstudent-habilitations');
});

test('page renders student-facing activation and revocation consequence and period audit facts', async () => {
 const page = await source('src/pages/student-habilitations.astro');
 assert.match(page, /student-habilitations/);
 assert.match(page, /estudiante/i);
 assert.match(page, /asignaciones activas/);
 assert.match(page, /no se restauran|nunca.*restaur/i);
 assert.match(page, /activated_at/);
});
