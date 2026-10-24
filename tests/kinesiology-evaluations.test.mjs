import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'astro/zod';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const apiPath = 'src/pods/kinesiology-evaluation/api.ts';
const actionPath = 'src/pods/kinesiology-evaluation/actions/evaluations.ts';
const registryPath = 'src/actions/index.ts';
const patientId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-6789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-06-10T12:00:00Z';
const content = {
 admission_date: '2026-06-10', admission_status: null, illness_history: 'Dolor previo',
 medical_diagnosis: null, kinesiology_diagnosis: 'Limitación', objectives: null,
 proposed_treatment: 'Movilidad', occupation: null, referring_physician: null,
 antecedents: { hta: null, dbt: false, diu: true, sedentary_lifestyle: null, pacemaker: false, other: null },
 studies: [{ type: 'Radiografía', description: 'Informe sin hallazgos', date: null }],
};
const assignment = () => ({ id: '17', patient_id: patientId, student_habilitation_id: '99999999-8888-4777-8666-555555555555', subject_id: subjectId, academic_group_id: groupId, assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso, ended_by: null, ended_at: null, end_reason: null });
const nativeFormInput = () => ({
 id: largeId, assignment_id: '17', limit: '50', offset: '0', admission_date: '2026-06-10',
 admission_status: '', occupation: '', referring_physician: '', 'antecedent-hta': 'unknown',
 'antecedent-dbt': 'false', 'antecedent-diu': 'true', 'antecedent-sedentary_lifestyle': 'unknown',
 'antecedent-pacemaker': 'false', 'antecedent-other': '', antecedents_keys: 'hta,dbt,diu,sedentary_lifestyle,pacemaker,other',
 illness_history: 'Dolor previo', medical_diagnosis: '', kinesiology_diagnosis: 'Limitación',
 objectives: '', proposed_treatment: 'Movilidad', 'study-type-0': 'Radiografía',
 'study-description-0': 'Informe sin hallazgos', 'study-date-0': '',
});
const evaluation = (overrides = {}) => ({
 id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId,
 author_id: authorId, origin_student_habilitation_id: '99999999-8888-4777-8666-555555555555',
 origin_subject_id: subjectId, origin_group_id: groupId, status: 'draft', content,
 patient: { id: patientId, documento: '123', nombres: 'Ana', apellidos: 'Pérez', fecha_nacimiento: '1990-01-01', email: 'ana@example.test', celular: '123', sexo: 'F', direccion: 'Calle' },
 age: 36, created_at: iso, updated_at: iso, ...overrides,
});

async function evaluate(path, options = {}) {
 const requests = [], writes = [];
 const cookies = {
  get: (name) => name === 'session' ? { value: 'session-token' } : undefined,
  set: (...args) => writes.push(['set', ...args]), delete: (...args) => writes.push(['delete', ...args]),
 };
 const sandbox = vm.createContext({ URL, URLSearchParams, Response, Error, Date, atob, fetch: async (url, init) => {
  requests.push({ url, ...init });
  const pathname = new URL(url).pathname;
  const response = options.responses?.shift() ?? { status: options.status ?? (init.method === 'POST' ? 201 : 200), body: options.body ?? (pathname === '/patient-assignments/mine' ? { items: [assignment()], limit: Number(new URL(url).searchParams.get('limit')), offset: Number(new URL(url).searchParams.get('offset')) } : pathname === '/kinesiology-evaluations' && init.method === 'GET' ? { items: [evaluation()] } : evaluation()) };
  return Response.json(response.body, { status: response.status });
 }});
 const cache = new Map();
 async function compile(code, identifier) {
  if (cache.has(identifier)) return cache.get(identifier);
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new vm.SourceTextModule(output, { context: sandbox, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; } });
  cache.set(identifier, mod);
  await mod.link(async (specifier, parent) => {
   if (specifier === 'astro:actions') return new vm.SyntheticModule(['defineAction'], function () { this.setExport('defineAction', (x) => x); }, { context: sandbox });
   if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () { this.setExport('z', z); }, { context: sandbox });
   if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
   if (specifier === './session') return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
    this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
    this.setExport('clearSession', (jar) => jar.delete('session', { path: '/' }));
   }, { context: sandbox });
   if (specifier === '../api') {
    const resolved = new URL('../api.ts', parent.identifier);
    return compile(await readFile(resolved, 'utf8'), resolved.href);
   }
   if (parent.identifier.endsWith(registryPath)) {
    if (specifier === '../pods/kinesiology-evaluation/actions/evaluations') {
     const resolved = new URL('../pods/kinesiology-evaluation/actions/evaluations.ts', parent.identifier);
     return compile(await readFile(resolved, 'utf8'), resolved.href);
    }
    const exports = {
     '../pods/auth/actions': ['handleLogin','handleLogout','handleRegister','handleForgotPassword','handleResetPassword'],
     '../pods/subject/actions/subjects': ['handleCreateSubject'], '../pods/group/actions/groups': ['handleCreateGroup'],
     '../pods/subject-group/actions/subject-groups': ['handleCreateSubjectGroup'], '../pods/student/actions/students': ['handleCreateStudent'],
     '../pods/teacher/actions/teachers': ['handleCreateTeacher'], '../pods/paciente/actions/patients': ['handleCreatePatient'],
     '../pods/teacher-habilitation/actions': ['activateTeacherHabilitation','revokeTeacherHabilitation'],
     '../pods/student-habilitation/actions': ['activateStudentHabilitation','revokeStudentHabilitation'],
    };
    return new vm.SyntheticModule(exports[specifier], function () { for (const n of exports[specifier]) this.setExport(n, () => undefined); }, { context: sandbox });
   }
   const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
   return compile(await readFile(resolved, 'utf8'), resolved.href);
  });
  return mod;
 }
 const mod = await compile(await source(path), new URL(path, root).href);
 await mod.evaluate();
 return { mod, cookies, requests, writes };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
class FakeApiError extends Error { constructor(status) { super(); this.status = status; } }

// Use real apiClient/session behavior around isolated fetch and cookies.
const apiHarness = (options) => evaluate(apiPath, options);

async function evaluatePageFrontmatter(path, options = {}) {
 const page = await source(path);
 const frontmatter = page.match(/^---\r?\n([\s\S]*?)\r?\n---/);
 assert.ok(frontmatter, `${path} has frontmatter`);
 const declarations = frontmatter[1].replace(/^import .*;\s*$/gm, '').replace(/^export const prerender = false;\s*$/m, '');
 const script = `async function renderPage() {${declarations}\nreturn { createHref: typeof createHref === 'undefined' ? undefined : createHref, actionHref: typeof actionHref === 'undefined' ? undefined : actionHref, assignment: typeof assignment === 'undefined' ? undefined : assignment, drafts: typeof drafts === 'undefined' ? undefined : drafts, evaluation: typeof evaluation === 'undefined' ? undefined : evaluation, eligible: typeof eligible === 'undefined' ? undefined : eligible, loadError: typeof loadError === 'undefined' ? undefined : loadError, unavailable: typeof unavailable === 'undefined' ? undefined : unavailable, c: typeof c === 'undefined' ? undefined : c }; }\nglobalThis.renderPage = renderPage;`;
 const output = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
 const action = (name) => ({ toString: () => `/_actions/${name}?_action=${name}` });
 const sandbox = vm.createContext({
  URL, URLSearchParams, BigInt, Date, console,
  actions: { createKinesiologyEvaluation: action('createKinesiologyEvaluation'), updateKinesiologyEvaluation: action('updateKinesiologyEvaluation') },
  isInputError: () => false,
  Astro: {
   params: options.params ?? { assignmentId: '17', id: largeId },
   url: new URL(options.url ?? '/my-patients/17?limit=50&offset=0', 'http://localhost'),
   cookies: { get: () => ({ value: 'token' }) },
   getActionResult: () => options.actionResult,
   redirect: (href) => ({ redirect: href }),
   request: { clone: () => ({ formData: async () => new FormData() }) },
  },
  ApiError: FakeApiError,
  listAssignedPatients: options.listAssignedPatients ?? (async () => ({ items: [assignment()], limit: 50, offset: 0 })),
  parseAssignmentPagination: (params) => ({ limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
  listEvaluations: options.listEvaluations ?? (async () => [evaluation()]),
  getEvaluation: options.getEvaluation ?? (async () => evaluation()),
  actionHrefWithContext: (await apiHarness()).mod.namespace.actionHrefWithContext,
  decodeJwt: () => ({ sub: authorId, role: 'student', permissions: ['kinesiology-evaluations:write'] }),
  rawEvaluationContentFromForm: () => content,
 });
 vm.runInContext(output, sandbox);
 return sandbox.renderPage();
}

test('listing uses exact patient and assignment context, filters drafts, and preserves string BIGINT ids', async () => {
 const result = await apiHarness({ body: { items: [evaluation(), evaluation({ id: '2', status: 'submitted' })] } });
 const { listEvaluations } = result.mod.namespace;
 const rows = await listEvaluations({ patient_id: patientId, subject_id: subjectId, academic_group_id: groupId }, result.cookies);
 assert.equal(result.requests[0].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patientId}&subject_id=${subjectId}&academic_group_id=${groupId}`);
 assert.equal(rows.length, 1);
 assert.equal(rows[0].id, largeId);
 assert.equal(typeof rows[0].id, 'string');
});

test('listing rejects malformed rows before filtering valid non-draft evaluations', async () => {
 for (const row of [null, { status: 'unknown' }, evaluation({ status: 'unknown' }), evaluation({ status: 'submitted', content: null })]) {
  const result = await apiHarness({ body: { items: [row] } });
  await assert.rejects(() => result.mod.namespace.listEvaluations({ patient_id: patientId, subject_id: subjectId, academic_group_id: groupId }, result.cookies));
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].method, 'GET');
  assert.equal(result.writes.length, 0);
 }
});

test('save rejects same-id replies with changed context and retains submitted clinical values', async () => {
 for (const changed of [
  { patient_id: subjectId, patient: { ...evaluation().patient, id: subjectId } },
  { origin_subject_id: groupId },
  { origin_group_id: subjectId },
 ]) {
  const result = await evaluate(actionPath, { responses: [
   { status: 200, body: { items: [assignment()], limit: 50, offset: 0 } },
   { status: 200, body: evaluation() },
   { status: 200, body: evaluation(changed) },
  ] });
  const saved = await result.mod.namespace.handleUpdateKinesiologyEvaluation(nativeFormInput(), { cookies: result.cookies });
  assert.equal(saved.success, false);
  assert.equal(saved.evaluation, undefined);
  assert.deepEqual(plain(saved.content), content);
  assert.match(saved.error, /Conservamos los valores enviados/);
  assert.equal(result.requests.length, 3);
  assert.equal(result.requests.filter((request) => request.method === 'PATCH').length, 1);
  assert.deepEqual(JSON.parse(result.requests[2].body), { content });
  assert.equal(result.writes.length, 0);
 }
});

test('explicit create sends only exact context and full content, never deduplicates or leaks demographics', async () => {
 const created = evaluation();
 const result = await apiHarness({ body: created });
 const record = await result.mod.namespace.createEvaluation({ patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, content }, result.cookies);
 assert.equal(record.id, largeId);
 assert.equal(result.requests[0].url, 'https://backend.invalid/kinesiology-evaluations');
 assert.equal(result.requests[0].method, 'POST');
 assert.deepEqual(JSON.parse(result.requests[0].body), { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, content });
});

test('edit is an exact full-replacement PATCH with string id and no audit or patient fields', async () => {
 const result = await apiHarness({ body: evaluation() });
 await result.mod.namespace.updateEvaluation(largeId, content, result.cookies, { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId });
 assert.equal(result.requests[0].url, `https://backend.invalid/kinesiology-evaluations/${largeId}`);
 assert.equal(result.requests[0].method, 'PATCH');
 assert.deepEqual(JSON.parse(result.requests[0].body), { content });
});

test('partial antecedents stay partial and optional blank study rows are discarded without losing partial input', async () => {
 const result = await apiHarness();
 const { validateEvaluationContent, isEvaluation, actionHrefWithContext } = result.mod.namespace;
 assert.deepEqual(plain(validateEvaluationContent({ antecedents: {} })), { antecedents: {} });
 assert.deepEqual(plain(validateEvaluationContent({ antecedents: { hta: true } })), { antecedents: { hta: true } });
 assert.equal(isEvaluation(evaluation({ patient: { ...evaluation().patient, id: subjectId } })), false);
 const blank = [{ type: '', description: '', date: null }];
 assert.deepEqual(plain(result.mod.namespace.normalizeStudyRows(blank)), []);
 assert.throws(() => result.mod.namespace.normalizeStudyRows([{ type: 'Informe', description: '', date: null }]), /completá/i);
 assert.deepEqual(plain(result.mod.namespace.normalizeStudyRows([{ type: 'Informe', description: 'Hallazgo', date: null }])), [{ type: 'Informe', description: 'Hallazgo', date: null }]);
 assert.equal(actionHrefWithContext('/_actions/save?_action=save', { assignment_id: '7', limit: '50', offset: '0' }), '/_actions/save?_action=save&assignment_id=7&limit=50&offset=0');
});

test('public update action accepts the rendered native form fields and only forwards content', async () => {
 const result = await evaluate(registryPath);
 const schema = result.mod.namespace.server.updateKinesiologyEvaluation.input;
 const form = new FormData();
 for (const [name, value] of Object.entries(nativeFormInput())) form.set(name, value);
 assert.equal(schema.safeParse(Object.fromEntries(form)).success, true);
});

test('content validation accepts null tri-state and studies, rejects invalid dates, malformed values and unknown keys', async () => {
 const result = await apiHarness();
 const { validateEvaluationContent } = result.mod.namespace;
 assert.deepEqual(plain(validateEvaluationContent(content)), content);
 for (const invalid of [
  { ...content, unknown: 'discard me' }, { ...content, admission_date: '2026-02-30' },
  { ...content, antecedents: null }, { ...content, antecedents: { ...content.antecedents, hta: 'no' } },
  { ...content, studies: [{ type: '', description: 'x' }] }, { studies: [{ type: 'x', description: 'y', date: 'tomorrow' }] },
 ]) assert.throws(() => validateEvaluationContent(invalid));
});

test('malformed evaluation ids and identities fail closed without numeric conversion', async () => {
 const result = await apiHarness();
 const { isEvaluation } = result.mod.namespace;
 assert.equal(isEvaluation(evaluation()), true, JSON.stringify(evaluation()));
 for (const bad of [evaluation({ id: Number(largeId) }), evaluation({ id: '0' }), evaluation({ id: '9223372036854775808' }), evaluation({ author_id: 'bad' })]) assert.equal(isEvaluation(bad), false);
 assert.equal(isEvaluation(evaluation({ status: 'submitted' })), true, JSON.stringify(evaluation({ status: 'submitted' })));
});

test('pod actions validate identifiers, send full creates and updates, and retain input on backend rejection', async () => {
 const created = await evaluate(actionPath);
 const create = await created.mod.namespace.handleCreateKinesiologyEvaluation({ patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, assignment_id: '17', limit: '50', offset: '0', content: '{}' }, { cookies: created.cookies });
 assert.equal(create.success, true, JSON.stringify({ create, requests: created.requests }));
 const post = created.requests.find((request) => request.method === 'POST');
 assert.ok(post);
 assert.deepEqual(JSON.parse(post.body), { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, content: {} });
 const invalid = await evaluate(actionPath);
 const denied = await invalid.mod.namespace.handleUpdateKinesiologyEvaluation({ ...nativeFormInput(), id: '9223372036854775808' }, { cookies: invalid.cookies });
 assert.equal(denied.success, false);
 assert.equal(invalid.requests.length, 0);
 const conflict = await evaluate(actionPath, { responses: [
  { status: 200, body: { items: [assignment()], limit: 50, offset: 0 } },
  { status: 200, body: evaluation() },
  { status: 409, body: { error: { code: 'DRAFT_NOT_EDITABLE', message: 'private detail' } } },
 ] });
 const rejected = await conflict.mod.namespace.handleUpdateKinesiologyEvaluation(nativeFormInput(), { cookies: conflict.cookies });
 assert.equal(rejected.success, false);
 assert.match(rejected.error, /conservamos los valores/i);
 assert.deepEqual(plain(rejected.content), content);
 const patch = conflict.requests.find((request) => request.method === 'PATCH');
 assert.ok(patch);
 assert.deepEqual(JSON.parse(patch.body), { content });
});

test('native optional fields normalized to undefined still permit an empty draft save', async () => {
 const input = { id: largeId, assignment_id: '17', limit: '50', offset: '0' };
 for (const field of Object.keys(nativeFormInput())) {
  if (!(field in input) && !field.startsWith('study-')) input[field] = undefined;
 }
 const result = await evaluate(actionPath);
 const saved = await result.mod.namespace.handleUpdateKinesiologyEvaluation(input, { cookies: result.cookies });
 assert.equal(saved.success, true);
 const patches = result.requests.filter((request) => request.method === 'PATCH');
 assert.equal(patches.length, 1);
 assert.deepEqual(JSON.parse(patches[0].body), { content: {
  admission_date: null, admission_status: null, occupation: null, referring_physician: null,
  illness_history: null, medical_diagnosis: null, kinesiology_diagnosis: null,
  objectives: null, proposed_treatment: null, studies: [],
 } });
 assert.equal(result.writes.length, 0);
});

test('choosing unrecorded for a previously recorded antecedent removes it instead of saving null', async () => {
 const input = { ...nativeFormInput(), 'antecedent-hta': '', 'antecedent-dbt': 'unknown', 'antecedent-diu': '', 'antecedent-sedentary_lifestyle': '', 'antecedent-pacemaker': '', antecedents_keys: 'hta,dbt' };
 const result = await evaluate(actionPath);
 const saved = await result.mod.namespace.handleUpdateKinesiologyEvaluation(input, { cookies: result.cookies });
 assert.equal(saved.success, true);
 const patches = result.requests.filter((request) => request.method === 'PATCH');
 assert.equal(patches.length, 1);
 assert.deepEqual(JSON.parse(patches[0].body).content.antecedents, { dbt: null });
});

test('native update preserves partial rows on validation errors and permits empty drafts', async () => {
 const partial = nativeFormInput();
 partial['study-description-0'] = '';
 const rejected = await evaluate(actionPath);
 const partialResult = await rejected.mod.namespace.handleUpdateKinesiologyEvaluation(partial, { cookies: rejected.cookies });
 assert.equal(partialResult.success, false);
 assert.equal(partialResult.content.studies[0].type, 'Radiografía');
 assert.match(partialResult.error, /Conservamos los valores/);
 assert.equal(rejected.requests.some((request) => request.method === 'PATCH'), false);
 const empty = nativeFormInput();
 empty['study-type-0'] = '';
 empty['study-description-0'] = '';
 empty['study-date-0'] = '';
 empty.antecedents_keys = 'hta';
 empty['antecedent-hta'] = 'true';
 for (const key of ['dbt', 'diu', 'sedentary_lifestyle', 'pacemaker']) empty[`antecedent-${key}`] = '';
 const saved = await evaluate(actionPath);
 const emptyResult = await saved.mod.namespace.handleUpdateKinesiologyEvaluation(empty, { cookies: saved.cookies });
 assert.equal(emptyResult.success, true);
 const patch = saved.requests.find((request) => request.method === 'PATCH');
 const body = JSON.parse(patch.body);
 assert.deepEqual(body.content.studies, []);
 assert.deepEqual(body.content.antecedents, { hta: true });
});

test('mutation handlers revalidate the selected assignment and returned evaluation context', async () => {
 const create = await evaluate(actionPath);
 const mismatched = await create.mod.namespace.handleCreateKinesiologyEvaluation({
  patient_id: subjectId, subject_id: subjectId, academic_group_id: groupId, assignment_id: '17', limit: '50', offset: '0', content: '{}',
 }, { cookies: create.cookies });
 assert.equal(mismatched.success, false);
 assert.equal(create.requests.some((request) => request.method === 'POST'), false);
 const update = await evaluate(actionPath, { responses: [
  { status: 200, body: { items: [assignment()], limit: 50, offset: 0 } },
  { status: 200, body: evaluation({ patient_id: subjectId }) },
 ] });
 const denied = await update.mod.namespace.handleUpdateKinesiologyEvaluation(nativeFormInput(), { cookies: update.cookies });
 assert.equal(denied.success, false);
 assert.equal(update.requests.some((request) => request.method === 'PATCH'), false);
});

test('typed backend errors distinguish 401, 403, concealed 404 and non-draft 409', async () => {
 for (const status of [400, 401, 403, 404, 409]) {
  const result = await apiHarness({ status, body: { error: { code: `E${status}`, message: 'backend detail' } } });
  await assert.rejects(result.mod.namespace.listEvaluations({ patient_id: patientId, subject_id: subjectId, academic_group_id: groupId }, result.cookies), (error) => error.status === status && (status === 401 ? error.code === 'UNAUTHORIZED' : error.code === `E${status}`));
  assert.deepEqual(result.writes.map(([kind]) => kind), status === 401 ? ['delete'] : []);
 }
});

test('evaluated SSR frontmatter preserves Astro action query and revalidates list/detail state', async () => {
 const listPage = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro');
 assert.equal(listPage.createHref, '/_actions/createKinesiologyEvaluation?_action=createKinesiologyEvaluation&assignment_id=17&limit=50&offset=0');
 assert.equal(listPage.assignment.id, '17');
 assert.equal(listPage.drafts.length, 1);
 const detailPage = await evaluatePageFrontmatter('src/pages/kinesiology-evaluations/[id].astro', { url: '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0' });
 assert.equal(detailPage.actionHref, '/_actions/updateKinesiologyEvaluation?_action=updateKinesiologyEvaluation&assignment_id=17&limit=50&offset=0');
 assert.equal(detailPage.eligible, true);
 assert.equal(detailPage.evaluation.id, largeId);
 const failedList = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro', { listEvaluations: async () => { throw new Error('offline'); } });
 assert.match(failedList.loadError, /No se muestra una lista vacía/);
 const createdRedirect = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro', { actionResult: { data: { success: true, evaluation: { id: '28' } } } });
 assert.equal(createdRedirect.redirect, '/kinesiology-evaluations/28?assignment_id=17&limit=50&offset=0');
 const savedRedirect = await evaluatePageFrontmatter('src/pages/kinesiology-evaluations/[id].astro', { url: '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0', actionResult: { data: { success: true } } });
 assert.equal(savedRedirect.redirect, `/kinesiology-evaluations/${largeId}?assignment_id=17&limit=50&offset=0&saved=1`);
 const unauthorized = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro', { listAssignedPatients: async () => { throw new FakeApiError(401); } });
 assert.match(unauthorized.redirect, /^\/auth\/login\?returnTo=/);
 const options = (await apiHarness()).mod.namespace.antecedentOptionState;
 assert.deepEqual(plain(options(true, true)), { unrecorded: false, unknown: false, yes: true, no: false });
 assert.deepEqual(plain(options(false, true)), { unrecorded: false, unknown: false, yes: false, no: true });
 assert.deepEqual(plain(options(null, true)), { unrecorded: false, unknown: true, yes: false, no: false });
 assert.deepEqual(plain(options(undefined, false)), { unrecorded: true, unknown: false, yes: false, no: false });
});

test('registered actions validate mutations and retain supported content; pages expose safe SSR routes and Spanish form', async () => {
 const result = await evaluate(registryPath);
 const server = result.mod.namespace.server;
 for (const name of ['createKinesiologyEvaluation', 'updateKinesiologyEvaluation']) assert.ok(server[name]);
 assert.ok(server.createStudent);
 const routes = await Promise.all(['src/pages/my-patients/[assignmentId].astro','src/pages/kinesiology-evaluations/[id].astro'].map(source));
 assert.match(routes[0], /listAssignedPatients/);
 assert.match(routes[0], /listEvaluations/);
 assert.match(routes[0], /Astro\.redirect/);
 assert.match(routes[1], /antecedents|antecedentes/i);
 assert.match(routes[1], /assignment_id/);
 assert.doesNotMatch(routes[1], /localStorage|JSON\.stringify\(content/);
 assert.match(routes[1], /record\.id !== id/);
 assert.match(routes[1], /record\.author_id/);
 assert.match(routes[1], /Guardar borrador/);
 assert.match(routes[1], /solo lectura/i);
});
