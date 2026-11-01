import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { z } from 'astro/zod';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const source = (path) => readFile(new URL(path, root), 'utf8');
const apiPath = 'src/pods/kinesiology-evaluation/api.ts';
const actionPath = 'src/pods/kinesiology-evaluation/actions/evaluations.ts';
const registryPath = 'src/actions/index.ts';
const patientId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-6789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const otherSubjectId = '22222222-3333-4444-8555-666666666666';
const otherGroupId = '33333333-4444-4555-8666-777777777777';
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
const submission = (overrides = {}) => ({
 id: '9223372036854775806', evaluation_id: largeId, ordinal: 1, submitted_by: authorId, submitted_at: iso,
 status: 'pending_validation', clinical_content: content, studies: content.studies, patient: evaluation().patient,
 age_at_admission: 36, consent: { id: '5', paper_signature_date: '2026-06-09', verified_by: authorId, verified_at: iso },
 ...overrides,
});
const submitInput = () => ({ id: largeId, assignment_id: '17', limit: '50', offset: '0' });
const assignmentPage = { status: 200, body: { items: [assignment()], limit: 50, offset: 0 } };

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
  if (response.network) throw new TypeError('fetch failed');
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
     '../pods/patient-availability/actions': ['searchAvailablePatient','enablePatientAvailability','withdrawPatientAvailability'],
     '../pods/teacher-assignment/actions': ['createTeacherAssignment'],
     '../pods/teacher-clinical/actions/consent': ['handleRecordTeacherConsent'],
     '../pods/teacher-clinical/actions/reviews': ['handleValidateTeacherSubmission', 'handleRequestTeacherCorrection'],
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
 const script = `async function renderPage() {${declarations}\nreturn { createHref: typeof createHref === 'undefined' ? undefined : createHref, actionHref: typeof actionHref === 'undefined' ? undefined : actionHref, assignment: typeof assignment === 'undefined' ? undefined : assignment, drafts: typeof drafts === 'undefined' ? undefined : drafts, evaluation: typeof evaluation === 'undefined' ? undefined : evaluation, eligible: typeof eligible === 'undefined' ? undefined : eligible, submitted: typeof submitted === 'undefined' ? undefined : submitted, canSubmit: typeof canSubmit === 'undefined' ? undefined : canSubmit, submitUncertain: typeof submitUncertain === 'undefined' ? undefined : submitUncertain, submitHref: typeof submitHref === 'undefined' ? undefined : submitHref, loadError: typeof loadError === 'undefined' ? undefined : loadError, unavailable: typeof unavailable === 'undefined' ? undefined : unavailable, c: typeof c === 'undefined' ? undefined : c, submissions: typeof submissions === 'undefined' ? undefined : submissions, historyError: typeof historyError === 'undefined' ? undefined : historyError, corrections: typeof corrections === 'undefined' ? undefined : corrections, correctionsError: typeof correctionsError === 'undefined' ? undefined : correctionsError, correctionDraft: typeof correctionDraft === 'undefined' ? undefined : correctionDraft, crossContext: typeof crossContext === 'undefined' ? undefined : crossContext, canAmend: typeof canAmend === 'undefined' ? undefined : canAmend, amendHref: typeof amendHref === 'undefined' ? undefined : amendHref, amendUncertain: typeof amendUncertain === 'undefined' ? undefined : amendUncertain, amendError: typeof amendError === 'undefined' ? undefined : amendError, justAmended: typeof justAmended === 'undefined' ? undefined : justAmended }; }\nglobalThis.renderPage = renderPage;`;
 const output = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
 const action = (name) => ({ toString: () => `/_actions/${name}?_action=${name}` });
 const submitAction = action('submitKinesiologyEvaluation');
 const amendAction = action('createKinesiologyAmendment');
 const sandbox = vm.createContext({
  URL, URLSearchParams, BigInt, Date, console,
  actions: { createKinesiologyEvaluation: action('createKinesiologyEvaluation'), updateKinesiologyEvaluation: action('updateKinesiologyEvaluation'), submitKinesiologyEvaluation: submitAction, createKinesiologyAmendment: amendAction },
  isInputError: () => false,
  Astro: {
   params: options.params ?? { assignmentId: '17', id: largeId },
   url: new URL(options.url ?? '/my-patients/17?limit=50&offset=0', 'http://localhost'),
   cookies: { get: () => ({ value: 'token' }) },
   getActionResult: (name) => name === submitAction ? options.submitResult : name === amendAction ? options.amendResult : options.actionResult,
   redirect: (href) => ({ redirect: href }),
   request: { clone: () => ({ formData: async () => new FormData() }) },
  },
  ApiError: FakeApiError,
  listAssignedPatients: options.listAssignedPatients ?? (async () => ({ items: [assignment()], limit: 50, offset: 0 })),
  parseAssignmentPagination: (params) => ({ limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
  listEvaluations: options.listEvaluations ?? (async () => [evaluation()]),
  getEvaluation: options.getEvaluation ?? (async () => evaluation()),
  actionHrefWithContext: (await apiHarness()).mod.namespace.actionHrefWithContext,
  decodeJwt: () => options.actor ?? ({ sub: authorId, role: 'student', permissions: options.permissions ?? ['kinesiology-evaluations:write', 'kinesiology-evaluations:submit'] }),
  rawEvaluationContentFromForm: () => content,
  listSubmittedEvaluations: options.listSubmittedEvaluations ?? (async () => []),
  listSubmissions: options.listSubmissions ?? (async () => ({ evaluation_id: largeId, items: [] })),
  listCorrections: options.listCorrections ?? (async () => ({ evaluation_id: largeId, items: [] })),
  EVALUATION_STATUS_LABELS: (await apiHarness()).mod.namespace.EVALUATION_STATUS_LABELS,
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
 for (const name of ['createKinesiologyEvaluation', 'updateKinesiologyEvaluation', 'submitKinesiologyEvaluation']) assert.ok(server[name]);
 const submitSchema = server.submitKinesiologyEvaluation.input;
 assert.equal(submitSchema.safeParse(submitInput()).success, true);
 assert.equal(submitSchema.safeParse({ ...submitInput(), id: '0' }).success, false);
 assert.equal(submitSchema.safeParse({ ...submitInput(), content: '{}' }).success, false);
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

test('submitEvaluation posts one empty-body request to the submissions route and validates the 201 item', async () => {
 const result = await apiHarness({ status: 201, body: submission() });
 const record = await result.mod.namespace.submitEvaluation(largeId, result.cookies);
 assert.equal(record.id, '9223372036854775806');
 assert.equal(result.requests.length, 1);
 assert.equal(result.requests[0].url, `https://backend.invalid/kinesiology-evaluations/${largeId}/submissions`);
 assert.equal(result.requests[0].method, 'POST');
 assert.equal(result.requests[0].body, '{}');
});

test('submission validation rejects malformed 201 items before they can be shown as success', async () => {
 const bad = [
  submission({ evaluation_id: '2' }), submission({ status: 'draft' }), submission({ id: Number(largeId) }),
  submission({ consent: undefined }), submission({ consent: { ...submission().consent, paper_signature_date: '2026-02-30' } }),
  submission({ studies: [{ type: 'RX', description: 'x' }] }), submission({ clinical_content: null }), submission({ submitted_by: 'bad' }),
 ];
 for (const body of bad) {
  const result = await apiHarness({ status: 201, body });
  await assert.rejects(() => result.mod.namespace.submitEvaluation(largeId, result.cookies), /incompletos o desconocidos/);
 }
});

test('assignment helper lists only non-draft records while listEvaluations keeps the draft filter', async () => {
 const items = [evaluation(), evaluation({ id: '2', status: 'submitted' }), evaluation({ id: '3', status: 'validated' })];
 const result = await apiHarness({ body: { items } });
 const { listEvaluations, listSubmittedEvaluations } = result.mod.namespace;
 const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
 assert.deepEqual((await listEvaluations(context, result.cookies)).map((row) => row.id), [largeId]);
 assert.deepEqual((await listSubmittedEvaluations(context, result.cookies)).map((row) => row.status), ['submitted', 'validated']);
});

test('submit action refuses locally on invalid id, context mismatch or non-draft without any POST', async () => {
 const cases = [
  { input: { ...submitInput(), id: '0' }, responses: [] },
  { input: submitInput(), responses: [assignmentPage, { status: 200, body: evaluation({ origin_group_id: subjectId }) }] },
  { input: submitInput(), responses: [assignmentPage, { status: 200, body: evaluation({ status: 'submitted' }) }] },
 ];
 for (const { input, responses } of cases) {
  const result = await evaluate(actionPath, { responses });
  const outcome = await result.mod.namespace.handleSubmitKinesiologyEvaluation(input, { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, false);
  assert.equal(result.requests.some((request) => request.method === 'POST'), false);
 }
});

test('submit action maps typed backend rejections to safe copy with exactly one POST and no retry', async () => {
 const cases = [
  [400, 'evaluation content is incomplete', /incompleta/], [401, 'session expired', /sesión venció/],
  [403, 'forbidden', /No tenés permiso/], [404, 'not found', /no está disponible/],
  [409, 'evaluation has already been submitted', /ya fue enviada/],
  [409, 'verified paper consent is required before submission', /consentimiento verificado/],
 ];
 for (const [status, message, copy] of cases) {
  const result = await evaluate(actionPath, { responses: [assignmentPage, { status: 200, body: evaluation() }, { status, body: { error: { code: `E${status}`, message } } }] });
  const outcome = await result.mod.namespace.handleSubmitKinesiologyEvaluation(submitInput(), { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, false);
  assert.match(outcome.error, copy);
  assert.equal(result.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(result.requests.length, 3);
 }
});

test('submit action reports network failure or malformed 201 after the POST as uncertain without retrying', async () => {
 for (const response of [{ network: true }, { status: 201, body: submission({ evaluation_id: '2' }) }, { status: 500, body: { error: { code: 'X', message: 'boom' } } }]) {
  const result = await evaluate(actionPath, { responses: [assignmentPage, { status: 200, body: evaluation() }, response] });
  const outcome = await result.mod.namespace.handleSubmitKinesiologyEvaluation(submitInput(), { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, true);
  assert.match(outcome.error, /consultá el estado/i);
  assert.equal(result.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(result.requests.length, 3);
 }
});

test('submit action success returns the validated submission with confirmed assignment context', async () => {
 const result = await evaluate(actionPath, { responses: [assignmentPage, { status: 200, body: evaluation() }, { status: 201, body: submission() }] });
 const outcome = await result.mod.namespace.handleSubmitKinesiologyEvaluation(submitInput(), { cookies: result.cookies });
 assert.equal(outcome.success, true);
 assert.equal(outcome.id, largeId);
 assert.equal(outcome.assignment_id, '17');
 assert.equal(outcome.limit, '50');
 assert.equal(outcome.offset, '0');
 assert.equal(outcome.submission.status, 'pending_validation');
});

test('editor submit form is gated by draft, author, submit grant and action result; uncertain hides it', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const draft = await evaluatePageFrontmatter(page, { url });
 assert.equal(draft.canSubmit, true);
 assert.equal(draft.submitHref, '/_actions/submitKinesiologyEvaluation?_action=submitKinesiologyEvaluation&assignment_id=17&limit=50&offset=0');
 assert.equal((await evaluatePageFrontmatter(page, { url, permissions: ['kinesiology-evaluations:write'] })).canSubmit, false);
 const submitted = await evaluatePageFrontmatter(page, { url, getEvaluation: async () => evaluation({ status: 'submitted' }) });
 assert.equal(submitted.eligible, false);
 assert.equal(submitted.canSubmit, false);
 const uncertain = await evaluatePageFrontmatter(page, { url, submitResult: { data: { success: false, uncertain: true, error: 'No se pudo confirmar el envío.' } } });
 assert.equal(uncertain.submitUncertain, true);
 const expired = await evaluatePageFrontmatter(page, { url, submitResult: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.' } } });
 assert.match(expired.redirect, /^\/auth\/login\?returnTo=/);
 const redirect = await evaluatePageFrontmatter(page, {
  params: { id: '5', assignmentId: '17' }, url: '/kinesiology-evaluations/5?assignment_id=99&limit=10&offset=20',
  submitResult: { data: { success: true, id: largeId, assignment_id: '17', limit: '50', offset: '0' } },
 });
 assert.equal(redirect.redirect, `/kinesiology-evaluations/${largeId}?assignment_id=17&limit=50&offset=0&submitted=1`);
 const template = await source(page);
 assert.match(template, /canSubmit && !submitUncertain/);
 assert.match(template, /última versión guardada/);
 assert.match(template, /Estado de la ficha/);
});

test('assignment view lists submitted and validated records beside unchanged drafts', async () => {
 const page = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro', {
  listEvaluations: async () => [evaluation()],
  listSubmittedEvaluations: async () => [evaluation({ id: '2', status: 'submitted' }), evaluation({ id: '3', status: 'validated' })],
 });
 assert.deepEqual(page.drafts.map((row) => row.status), ['draft']);
 assert.deepEqual(page.submitted.map((row) => row.status), ['submitted', 'validated']);
 const template = await source('src/pages/my-patients/[assignmentId].astro');
 assert.match(template, /Borradores de ficha inicial/);
 assert.match(template, /Fichas enviadas/);
});

test('editor hides submission while unsaved retained values from a failed save are shown', async () => {
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const page = await evaluatePageFrontmatter('src/pages/kinesiology-evaluations/[id].astro', { url, actionResult: { data: { success: false, error: 'Revisá los datos clínicos ingresados.', content } } });
 assert.equal(page.eligible, true);
 assert.equal(page.canSubmit, false);
});

test('listSubmissions reads the exact submissions route and returns the ordered version envelope', async () => {
 const items = [submission(), submission({ id: '9223372036854775805', ordinal: 2, status: 'validated' })];
 const result = await apiHarness({ body: { evaluation_id: largeId, items } });
 const list = await result.mod.namespace.listSubmissions(largeId, result.cookies);
 assert.equal(result.requests.length, 1);
 assert.equal(result.requests[0].url, `https://backend.invalid/kinesiology-evaluations/${largeId}/submissions`);
 assert.equal(result.requests[0].method, 'GET');
 assert.equal(list.evaluation_id, largeId);
 assert.equal(list.amendment_of_evaluation_id, undefined);
 assert.deepEqual(list.items.map((item) => [typeof item.id, item.ordinal, item.status]), [['string', 1, 'pending_validation'], ['string', 2, 'validated']]);
 const empty = await apiHarness({ body: { evaluation_id: largeId, items: [] } });
 assert.deepEqual((await empty.mod.namespace.listSubmissions(largeId, empty.cookies)).items, []);
});

test('listSubmissions fails closed on envelope mismatch, unordered or duplicate ordinals, malformed items and invalid ids', async () => {
 const envelope = (items, overrides = {}) => ({ evaluation_id: largeId, items, ...overrides });
 const cases = [
  envelope([], { evaluation_id: '2' }), envelope(null), envelope([], { amendment_of_evaluation_id: Number(largeId) }), envelope([], { amendment_of_evaluation_id: 5 }),
  envelope([submission({ ordinal: 2 }), submission({ id: '9223372036854775805', ordinal: 1 })]),
  envelope([submission({ ordinal: 1 }), submission({ id: '9223372036854775805', ordinal: 1 })]),
  envelope([submission({ evaluation_id: '2' })]), envelope([submission({ consent: undefined })]),
 ];
 for (const body of cases) {
  const result = await apiHarness({ body });
  await assert.rejects(() => result.mod.namespace.listSubmissions(largeId, result.cookies), /no es válid[oa]|no está ordenado/);
 }
 const invalid = await apiHarness({ body: envelope([]) });
 await assert.rejects(() => invalid.mod.namespace.listSubmissions('0', invalid.cookies), /no es válido/);
 assert.equal(invalid.requests.length, 0);
});

test('submission snapshot validation rejects extra consent keys and the zero submission id', async () => {
 const { isSubmission } = (await apiHarness()).mod.namespace;
 assert.equal(isSubmission(submission(), largeId), true);
 assert.equal(isSubmission(submission({ id: '0' }), largeId), false);
 assert.equal(isSubmission(submission({ consent: { ...submission().consent, extra: 'x' } }), largeId), false);
});

test('editor loads version history only for non-draft records and keeps the record when history fails', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const submitted = (options) => evaluatePageFrontmatter(page, { url, getEvaluation: async () => evaluation({ status: 'submitted' }), ...options });
 const draft = await evaluatePageFrontmatter(page, { url, listSubmissions: async () => { throw new Error('drafts must not load history'); } });
 assert.deepEqual(plain(draft.submissions), []);
 assert.equal(draft.historyError, '');
 const versions = [submission(), submission({ id: '9223372036854775805', ordinal: 2, status: 'validated' })];
 const loaded = await submitted({ listSubmissions: async () => ({ evaluation_id: largeId, items: versions }) });
 assert.equal(loaded.evaluation.id, largeId);
 assert.deepEqual(plain(loaded.submissions.map((item) => item.ordinal)), [1, 2]);
 assert.equal(loaded.historyError, '');
 const failed = await submitted({ listSubmissions: async () => { throw new Error('offline'); } });
 assert.equal(failed.evaluation.id, largeId);
 assert.equal(failed.loadError, '');
 assert.deepEqual(plain(failed.submissions), []);
 assert.match(failed.historyError, /historial/);
 const expired = await submitted({ listSubmissions: async () => { throw new FakeApiError(401); } });
 assert.match(expired.redirect, /^\/auth\/login\?returnTo=/);
 const outside = await evaluatePageFrontmatter(page, { url, listAssignedPatients: async () => ({ items: [], limit: 50, offset: 0 }), getEvaluation: async () => evaluation({ status: 'submitted' }), listSubmissions: async () => { throw new Error('outside the assignment'); } });
 assert.equal(outside.unavailable, true);
 const template = await source(page);
 assert.match(template, /Historial de versiones/);
 assert.match(template, /SubmissionSnapshot/);
});

test('cross-context submitted section fetches by patient only and accepts other-origin non-draft snapshots', async () => {
 const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
 const projected = [
  evaluation({ id: '2', status: 'submitted', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId }),
  evaluation({ id: '3', status: 'validated', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId }),
 ];
 const result = await apiHarness({ body: { items: projected } });
 const rows = await result.mod.namespace.listSubmittedEvaluations(context, result.cookies);
 assert.equal(result.requests.length, 1);
 assert.equal(result.requests[0].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patientId}`);
 assert.deepEqual(rows.map((row) => [row.id, row.status, row.origin_subject_id, row.origin_group_id]), [
  ['2', 'submitted', otherSubjectId, otherGroupId], ['3', 'validated', otherSubjectId, otherGroupId],
 ]);
});

test('draft list rejects other-origin drafts; submitted list excludes them and still rejects other-patient rows', async () => {
 const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
 const otherOriginDraft = evaluation({ origin_subject_id: otherSubjectId, origin_group_id: otherGroupId });
 const draftApi = await apiHarness({ body: { items: [otherOriginDraft] } });
 await assert.rejects(() => draftApi.mod.namespace.listEvaluations(context, draftApi.cookies), /no coincide/);
 const submittedApi = await apiHarness({ body: { items: [otherOriginDraft, evaluation({ id: '2', status: 'submitted', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId })] } });
 assert.deepEqual((await submittedApi.mod.namespace.listSubmittedEvaluations(context, submittedApi.cookies)).map((row) => row.id), ['2']);
 for (const list of ['listEvaluations', 'listSubmittedEvaluations']) {
  const wrongPatient = await apiHarness({ body: { items: [evaluation({ id: '4', status: 'submitted', patient_id: subjectId, patient: null })] } });
  await assert.rejects(() => wrongPatient.mod.namespace[list](context, wrongPatient.cookies), /no coincide/);
 }
});

test('author with another-origin draft of the same patient sees only submitted rows on the assignment view, with no load error', async () => {
 const ownOtherDraft = evaluation({ id: '21', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId });
 const submittedRow = evaluation({ id: '2', status: 'submitted', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId });
 const api = await apiHarness({ body: { items: [ownOtherDraft, submittedRow] } });
 const page = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro', {
  listEvaluations: async () => [],
  listSubmittedEvaluations: (value) => api.mod.namespace.listSubmittedEvaluations(value, api.cookies),
 });
 assert.equal(page.loadError, '');
 assert.deepEqual(page.drafts, []);
 assert.deepEqual(page.submitted.map((row) => [row.id, row.status]), [['2', 'submitted']]);
 assert.equal(api.requests.length, 1);
 assert.equal(api.requests[0].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patientId}`);
});

test('assignment view for a cross-context reader lists the projected submitted row and keeps the draft request scoped', async () => {
 const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
 const draftApi = await apiHarness({ body: { items: [] } });
 await draftApi.mod.namespace.listEvaluations(context, draftApi.cookies);
 assert.equal(draftApi.requests[0].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patientId}&subject_id=${subjectId}&academic_group_id=${groupId}`);
 const projected = evaluation({ id: '2', status: 'submitted', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId });
 const api = await apiHarness({ body: { items: [projected] } });
 const page = await evaluatePageFrontmatter('src/pages/my-patients/[assignmentId].astro', {
  listEvaluations: async () => [],
  listSubmittedEvaluations: (value) => api.mod.namespace.listSubmittedEvaluations(value, api.cookies),
 });
 assert.equal(page.loadError, '');
 assert.deepEqual(page.drafts, []);
 assert.deepEqual(page.submitted.map((row) => [row.id, row.origin_subject_id]), [['2', otherSubjectId]]);
 assert.equal(api.requests.length, 1);
 assert.equal(api.requests[0].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patientId}`);
 assert.match(await source('src/pages/my-patients/[assignmentId].astro'), /Ver ficha enviada/);
});

test('cross-context submitted snapshot renders read-only: no corrections, consent or actionable controls', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const version = submission({ id: '9223372036854775805' });
 const correction = { submission_id: version.id, reason: 'Motivo de corrección', reviewed_by: authorId, requested_at: iso };
 const otherStudent = { sub: patientId, role: 'student', permissions: ['kinesiology-evaluations:write', 'kinesiology-evaluations:submit'] };
 for (const actor of [undefined, otherStudent]) {
  let correctionReads = 0;
  const cross = await evaluatePageFrontmatter(page, {
   url, actor, getEvaluation: async () => evaluation({ status: 'submitted', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId }),
   listCorrections: async () => { correctionReads++; return { evaluation_id: largeId, items: [correction] }; },
   listSubmissions: async () => ({ evaluation_id: largeId, items: [version] }),
  });
  assert.equal(cross.unavailable, false);
  assert.equal(cross.crossContext, true);
  assert.equal(cross.evaluation.id, largeId);
  assert.equal(cross.eligible, false);
  assert.equal(cross.canSubmit, false);
  assert.equal(cross.correctionDraft, false);
  assert.equal(correctionReads, 0);
  assert.deepEqual(plain(cross.corrections), []);
  assert.deepEqual(plain(cross.submissions.map((item) => item.id)), [version.id]);
  assert.equal(cross.loadError, '');
  assert.equal(cross.historyError, '');
 }
 const template = await source(page);
 assert.match(template, /\{!crossContext && <form method="POST" action=\{actionHref\} id="evaluation-form">/);
 assert.match(template, /crossContext=\{crossContext\}/);
 assert.match(template, /Esta ficha fue registrada en otra asignatura o grupo y se muestra en modo de solo lectura\./);
 const snapshot = await source('src/components/clinical/SubmissionSnapshot.astro');
 assert.match(snapshot, /crossContext = false/);
 assert.match(snapshot, /\{!crossContext && <h4>Consentimiento en papel/);
 assert.match(snapshot, /\{!crossContext && versionCorrections\.length > 0/);
});

test('author own other-origin submitted row opens through the same cross-context read-only view', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const author = { sub: authorId, role: 'student', permissions: ['kinesiology-evaluations:write', 'kinesiology-evaluations:submit'] };
 let correctionReads = 0;
 const own = await evaluatePageFrontmatter(page, {
  url, actor: author,
  getEvaluation: async () => evaluation({ status: 'submitted', author_id: authorId, origin_subject_id: otherSubjectId, origin_group_id: otherGroupId }),
  listCorrections: async () => { correctionReads++; return { evaluation_id: largeId, items: [] }; },
  listSubmissions: async () => ({ evaluation_id: largeId, items: [submission()] }),
 });
 assert.equal(own.unavailable, false);
 assert.equal(own.crossContext, true);
 assert.equal(own.eligible, false);
 assert.equal(own.canSubmit, false);
 assert.equal(own.correctionDraft, false);
 assert.equal(correctionReads, 0);
 assert.deepEqual(plain(own.corrections), []);
 assert.deepEqual(plain(own.submissions.map((item) => item.id)), [submission().id]);
});

test('never-submitted draft from another origin stays unavailable with no history or corrections', async () => {
 let reads = 0;
 const draft = await evaluatePageFrontmatter('src/pages/kinesiology-evaluations/[id].astro', {
  url: '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0',
  getEvaluation: async () => evaluation({ origin_subject_id: otherSubjectId, origin_group_id: otherGroupId }),
  listCorrections: async () => { reads++; return { evaluation_id: largeId, items: [] }; },
  listSubmissions: async () => { reads++; return { evaluation_id: largeId, items: [] }; },
 });
 assert.equal(draft.unavailable, true);
 assert.equal(draft.evaluation, null);
 assert.notEqual(draft.crossContext, true);
 assert.equal(draft.canSubmit, false);
 assert.deepEqual(plain(draft.submissions), []);
 assert.deepEqual(plain(draft.corrections), []);
 assert.equal(reads, 0);
});

test('cross-context history keeps the 401 redirect, treats other history failures as history-only, and keeps other read errors', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const crossSubmitted = { getEvaluation: async () => evaluation({ status: 'submitted', origin_subject_id: otherSubjectId, origin_group_id: otherGroupId }) };
 const expired = await evaluatePageFrontmatter(page, { url, ...crossSubmitted, listSubmissions: async () => { throw new FakeApiError(401); } });
 assert.match(String(expired.redirect), /^\/auth\/login\?returnTo=/);
 const failed = await evaluatePageFrontmatter(page, { url, ...crossSubmitted, listSubmissions: async () => { throw new Error('offline'); } });
 assert.equal(failed.unavailable, false);
 assert.equal(failed.evaluation.id, largeId);
 assert.equal(failed.loadError, '');
 assert.match(failed.historyError, /historial/);
 const denied = await evaluatePageFrontmatter(page, { url, getEvaluation: async () => { throw new FakeApiError(403); } });
 assert.equal(denied.loadError, 'No se pudo verificar esta ficha. Volvé a la lista antes de intentar otra acción.');
 assert.equal(denied.evaluation, null);
});

test('teacher-clinical snapshot call keeps the default props, so consent and corrections still render', async () => {
 const teacher = await source('src/pages/teacher-clinical/[id].astro');
 assert.match(teacher, /<SubmissionSnapshot submission=\{submission\} corrections=\{corrections\} \/>/);
});

test('student editor compiles with the installed Astro compiler', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const result = await transform(await source(page), { filename: page });
 assert.ok(Array.isArray(result.diagnostics), 'Astro compiler diagnostics must be available');
 const astroErrors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 1);
 assert.deepEqual(astroErrors, [], `Astro compiler errors: ${JSON.stringify(astroErrors)}`);
 const generated = ts.transpileModule(result.code, {
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
 });
 const syntaxErrors = generated.diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
 assert.deepEqual(syntaxErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n')), [], 'Astro output must be syntactically valid JavaScript');
 assert.doesNotThrow(() => new vm.SourceTextModule(generated.outputText, { context: vm.createContext({}) }));
});

test('student correction rework loads origin history and reasons, distinguishes empty/failing reads, and keeps resubmission gated', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const old = submission({ id: '9223372036854775806', ordinal: '1' });
 const correction = { submission_id: old.id, reason: 'Aclarar evolución clínica', reviewed_by: authorId, requested_at: iso };
 let correctionReads = 0, historyReads = 0;
 const reopened = await evaluatePageFrontmatter(page, {
  url, getEvaluation: async () => evaluation(),
  listCorrections: async () => { correctionReads++; return { evaluation_id: largeId, items: [correction] }; },
  listSubmissions: async () => { historyReads++; return { evaluation_id: largeId, items: [old] }; },
 });
 assert.equal(correctionReads, 1);
 assert.equal(historyReads, 1);
 assert.equal(reopened.correctionDraft, true);
 assert.deepEqual(plain(reopened.submissions.map((item) => item.id)), [old.id]);
 assert.deepEqual(plain(reopened.corrections), [correction]);
 assert.equal(reopened.canSubmit, true);
 const initial = await evaluatePageFrontmatter(page, { url, getEvaluation: async () => evaluation() });
 assert.equal(initial.correctionDraft, false);
 assert.deepEqual(plain(initial.submissions), []);
 assert.equal(initial.canSubmit, true);
 const validated = await evaluatePageFrontmatter(page, {
  url, getEvaluation: async () => evaluation({ status: 'validated' }),
  listCorrections: async () => ({ evaluation_id: largeId, items: [correction] }),
  listSubmissions: async () => ({ evaluation_id: largeId, items: [old, submission({ id: largeId, ordinal: 2, status: 'validated' })] }),
 });
 assert.deepEqual(plain(validated.corrections), [correction]);
 assert.deepEqual(plain(validated.submissions.map((item) => item.status)), ['pending_validation', 'validated']);
 assert.equal(validated.canSubmit, false);
 const failed = await evaluatePageFrontmatter(page, {
  url, getEvaluation: async () => evaluation(),
  listCorrections: async () => { throw new Error('offline'); },
  listSubmissions: async () => { throw new Error('must not infer a correction'); },
 });
 assert.equal(failed.correctionsError, 'No se pudieron cargar las solicitudes de corrección. La ficha se muestra igual; intentá recargar la página.');
 assert.equal(failed.correctionDraft, false);
 assert.equal(failed.canSubmit, false);
 assert.equal(failed.evaluation.id, largeId);
 let nonAuthorCorrectionReads = 0;
 const nonAuthor = await evaluatePageFrontmatter(page, {
  url, actor: { sub: patientId, role: 'student', permissions: ['kinesiology-evaluations:write', 'kinesiology-evaluations:submit'] },
  getEvaluation: async () => evaluation(), listCorrections: async () => { nonAuthorCorrectionReads++; return { evaluation_id: largeId, items: [correction] }; },
 });
 assert.equal(nonAuthor.eligible, false);
 assert.equal(nonAuthor.canSubmit, false);
 assert.equal(nonAuthorCorrectionReads, 0);
 let outsideCorrectionReads = 0;
 const outside = await evaluatePageFrontmatter(page, {
  url, listAssignedPatients: async () => ({ items: [], limit: 50, offset: 0 }),
  listCorrections: async () => { outsideCorrectionReads++; throw new Error('must not read outside origin'); },
 });
 assert.equal(outside.unavailable, true);
 assert.equal(outsideCorrectionReads, 0);
 let endedCorrectionReads = 0;
 const ended = await evaluatePageFrontmatter(page, {
  url, listAssignedPatients: async () => ({ items: [{ ...assignment(), ended_at: iso }], limit: 50, offset: 0 }),
  listCorrections: async () => { endedCorrectionReads++; return { evaluation_id: largeId, items: [correction] }; },
 });
 assert.equal(ended.unavailable, true);
 assert.equal(endedCorrectionReads, 0);
 const historyFailed = await evaluatePageFrontmatter(page, {
  url, getEvaluation: async () => evaluation(),
  listCorrections: async () => ({ evaluation_id: largeId, items: [correction] }),
  listSubmissions: async () => { throw new Error('history offline'); },
 });
 assert.equal(historyFailed.correctionDraft, true);
 assert.deepEqual(plain(historyFailed.corrections), [correction]);
 assert.match(historyFailed.historyError, /historial/);
 assert.equal(historyFailed.canSubmit, true);
 const template = await source(page);
 assert.match(template, /Reenviar versión guardada/);
 assert.match(template, /corrections=\{corrections\}/);
});

test('submit action treats post-POST 408/429 as uncertain and other unmapped 4xx as a submit-specific rejection', async () => {
 for (const [status, uncertain, copy] of [[408, true, /consultá el estado/i], [429, true, /consultá el estado/i], [422, false, /No se pudo enviar la ficha/]]) {
  const result = await evaluate(actionPath, { responses: [assignmentPage, { status: 200, body: evaluation() }, { status, body: { error: { code: 'X', message: 'detail' } } }] });
  const outcome = await result.mod.namespace.handleSubmitKinesiologyEvaluation(submitInput(), { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, uncertain);
  assert.match(outcome.error, copy);
  assert.equal(result.requests.filter((request) => request.method === 'POST').length, 1);
 }
});


test('real API decimal-string ordinal confirms submission once while numeric snapshots stay supported', async () => {
 for (const ordinal of [1, '1']) {
  const snapshot = submission({ ordinal });
  const api = await apiHarness({ status: 201, body: snapshot });
  assert.deepEqual(plain(await api.mod.namespace.submitEvaluation(largeId, api.cookies)), snapshot);
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].method, 'POST');
  assert.equal(api.requests[0].body, '{}');
  assert.equal(api.writes.length, 0);
  const action = await evaluate(actionPath, { responses: [assignmentPage, { status: 200, body: evaluation() }, { status: 201, body: snapshot }] });
  const result = await action.mod.namespace.handleSubmitKinesiologyEvaluation(submitInput(), { cookies: action.cookies });
  assert.equal(result.success, true, `ordinal ${JSON.stringify(ordinal)} must confirm the committed version`);
  assert.deepEqual(plain(result.submission), snapshot);
  assert.equal(result.assignment_id, '17');
  assert.equal(action.requests.length, 3);
  assert.equal(action.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(action.requests.at(-1).body, '{}');
  assert.equal(action.writes.length, 0);
 }
});

test('history accepts decimal-string ordinals and orders them numerically without losing bigint precision', async () => {
 for (const ordinals of [[2, 10], ['2', '10'], [2, '10'], ['9007199254740992', '9007199254740993'], ['9223372036854775806', largeId]]) {
  const items = ordinals.map((ordinal, index) => submission({ id: String(index + 1), ordinal }));
  const api = await apiHarness({ body: { evaluation_id: largeId, items } });
  const result = await api.mod.namespace.listSubmissions(largeId, api.cookies);
  assert.deepEqual(plain(result.items), items);
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].method, 'GET');
  assert.equal(api.writes.length, 0);
 }
 for (const ordinals of [['10', '2'], [1, '1'], ['1', 1], ['9007199254740993', '9007199254740992']]) {
  const items = ordinals.map((ordinal, index) => submission({ id: String(index + 1), ordinal }));
  const api = await apiHarness({ body: { evaluation_id: largeId, items } });
  await assert.rejects(() => api.mod.namespace.listSubmissions(largeId, api.cookies), /no está ordenado/);
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].method, 'GET');
  assert.equal(api.writes.length, 0);
 }
});

test('ordinal compatibility still rejects malformed snapshots and leaves post-POST outcomes uncertain', async () => {
 const invalid = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', '0', '01', '-1', '+1', '1.0', '1e0', ' 1', '1 ', '9223372036854775808', null, true];
 const { isSubmission } = (await apiHarness()).mod.namespace;
 for (const ordinal of invalid) assert.equal(isSubmission(submission({ ordinal }), largeId), false, JSON.stringify(ordinal));
 const malformed = submission({ ordinal: '1.0' });
 const api = await apiHarness({ body: { evaluation_id: largeId, items: [malformed] } });
 await assert.rejects(() => api.mod.namespace.listSubmissions(largeId, api.cookies), /no es válido/);
 assert.equal(api.requests.length, 1);
 const action = await evaluate(actionPath, { responses: [assignmentPage, { status: 200, body: evaluation() }, { status: 201, body: malformed }] });
 const outcome = await action.mod.namespace.handleSubmitKinesiologyEvaluation(submitInput(), { cookies: action.cookies });
 assert.equal(outcome.success, false);
 assert.equal(outcome.uncertain, true);
 assert.match(outcome.error, /consultá el estado/i);
 assert.equal(action.requests.length, 3);
 assert.equal(action.requests.filter((request) => request.method === 'POST').length, 1);
 assert.equal(action.writes.length, 0);
});

// Amendments: a validated record opens a new draft through POST /:id/amendments.
const amendmentId = '41';
const amendInput = () => ({ id: largeId, assignment_id: '17', limit: '50', offset: '0', confirm: 'on' });
const amendment = (overrides = {}) => evaluation({ id: amendmentId, clinical_record_id: '9223372036854775806', author_id: otherSubjectId, status: 'draft', amendment_of_evaluation_id: largeId, ...overrides });
const validatedPage = { status: 200, body: evaluation({ status: 'validated' }) };

test('createAmendment posts one empty-body request to the amendments route and validates the new draft', async () => {
 const api = await apiHarness({ status: 201, body: amendment() });
 const record = await api.mod.namespace.createAmendment(largeId, api.cookies);
 assert.equal(record.id, amendmentId);
 assert.equal(record.status, 'draft');
 assert.equal(record.amendment_of_evaluation_id, largeId);
 assert.equal(api.requests.length, 1);
 assert.equal(api.requests[0].url, `https://backend.invalid/kinesiology-evaluations/${largeId}/amendments`);
 assert.equal(api.requests[0].method, 'POST');
 assert.equal(api.requests[0].body, '{}');
 assert.equal(api.writes.length, 0);
 const local = await apiHarness();
 await assert.rejects(() => local.mod.namespace.createAmendment('0', local.cookies), /identificador de ficha/);
 assert.equal(local.requests.length, 0);
});

test('createAmendment rejects malformed 201 bodies before they can be shown as success', async () => {
 const bad = [
  amendment({ status: 'validated' }), amendment({ id: largeId }), amendment({ amendment_of_evaluation_id: '2' }),
  amendment({ amendment_of_evaluation_id: undefined }), amendment({ amendment_of_evaluation_id: '01' }), amendment({ content: null }),
 ];
 for (const body of bad) {
  const api = await apiHarness({ status: 201, body });
  await assert.rejects(() => api.mod.namespace.createAmendment(largeId, api.cookies), /incompletos o desconocidos/);
  assert.equal(api.requests.length, 1);
 }
});

test('evaluation reads accept an optional decimal amendment link and reject a malformed one', async () => {
 const { isEvaluation } = (await apiHarness()).mod.namespace;
 assert.equal(isEvaluation(evaluation()), true);
 assert.equal(isEvaluation(amendment()), true);
 for (const link of ['0', '01', 'x', 7, null]) assert.equal(isEvaluation(amendment({ amendment_of_evaluation_id: link })), false, JSON.stringify(link));
});

test('amend action refuses locally on invalid id or confirmation, context mismatch or non-validated record without any POST', async () => {
 const cases = [
  { input: { ...amendInput(), id: '0' }, responses: [], copy: /identificador/ },
  { input: { ...amendInput(), confirm: undefined }, responses: [], copy: /Confirmá/ },
  { input: amendInput(), responses: [assignmentPage, { status: 200, body: evaluation({ status: 'validated', origin_group_id: otherGroupId }) }], copy: /no pertenece/ },
  { input: amendInput(), responses: [assignmentPage, { status: 200, body: evaluation({ status: 'submitted' }) }], copy: /Solo se puede enmendar una ficha validada/ },
  { input: amendInput(), responses: [assignmentPage, { status: 200, body: evaluation() }], copy: /Solo se puede enmendar una ficha validada/ },
 ];
 for (const { input, responses, copy } of cases) {
  const result = await evaluate(actionPath, { responses });
  const outcome = await result.mod.namespace.handleCreateKinesiologyAmendment(input, { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, false);
  assert.match(outcome.error, copy);
  assert.equal(result.requests.some((request) => request.method === 'POST'), false);
  assert.equal(result.writes.length, 0);
 }
});

test('amend action maps typed backend rejections to safe copy with exactly one POST and no retry', async () => {
 const cases = [
  [400, 'body must be an empty object', /No se creó la enmienda/], [401, 'Authentication required', /sesión venció/],
  [403, "Permission 'kinesiology-evaluations:write' required", /No tenés permiso para enmendar/],
  [404, 'evaluation was not found', /no está disponible/],
  [409, 'only a validated evaluation can be amended', /Solo se puede enmendar una ficha validada/],
  [409, 'validated submission is unavailable', /versión validada no está disponible/],
  [422, 'unexpected', /No se creó la enmienda/],
 ];
 for (const [status, message, copy] of cases) {
  const result = await evaluate(actionPath, { responses: [assignmentPage, validatedPage, { status, body: { error: { code: `E${status}`, message } } }] });
  const outcome = await result.mod.namespace.handleCreateKinesiologyAmendment(amendInput(), { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, false);
  assert.match(outcome.error, copy);
  assert.equal(result.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(result.requests.length, 3);
 }
});

test('amend action reports network failure, 408/429/5xx or a malformed or other-context 201 as uncertain without retrying', async () => {
 const responses = [
  { network: true }, { status: 408, body: { error: { code: 'T', message: 'timeout' } } }, { status: 429, body: { error: { code: 'R', message: 'slow down' } } },
  { status: 500, body: { error: { code: 'X', message: 'boom' } } }, { status: 201, body: amendment({ status: 'submitted' }) },
  { status: 201, body: amendment({ origin_group_id: otherGroupId }) }, { status: 201, body: amendment({ patient_id: authorId, patient: null }) },
 ];
 for (const response of responses) {
  const result = await evaluate(actionPath, { responses: [assignmentPage, validatedPage, response] });
  const outcome = await result.mod.namespace.handleCreateKinesiologyAmendment(amendInput(), { cookies: result.cookies });
  assert.equal(outcome.success, false);
  assert.equal(outcome.uncertain, true);
  assert.match(outcome.error, /No se pudo confirmar la creación de la enmienda/);
  assert.equal(result.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(result.requests.length, 3);
 }
});

test('amend action success returns the new draft id with the confirmed assignment context', async () => {
 const result = await evaluate(actionPath, { responses: [assignmentPage, validatedPage, { status: 201, body: amendment() }] });
 const outcome = await result.mod.namespace.handleCreateKinesiologyAmendment(amendInput(), { cookies: result.cookies });
 assert.deepEqual(plain(outcome), { success: true, id: amendmentId, amendment_of_evaluation_id: largeId, assignment_id: '17', limit: '50', offset: '0' });
 assert.equal(result.requests[2].url, `https://backend.invalid/kinesiology-evaluations/${largeId}/amendments`);
 assert.equal(result.requests[2].body, '{}');
});

test('registered amend action requires explicit confirmation and rejects unknown fields', async () => {
 const result = await evaluate(registryPath);
 const schema = result.mod.namespace.server.createKinesiologyAmendment.input;
 assert.equal(schema.safeParse(amendInput()).success, true);
 assert.equal(schema.safeParse({ ...amendInput(), confirm: undefined }).success, false);
 assert.equal(schema.safeParse({ ...amendInput(), id: '0' }).success, false);
 assert.equal(schema.safeParse({ ...amendInput(), content: '{}' }).success, false);
 for (const name of ['createKinesiologyEvaluation', 'updateKinesiologyEvaluation', 'submitKinesiologyEvaluation']) assert.ok(result.mod.namespace.server[name]);
});

test('editor amend panel is offered on validated same-context records to any student with write, never elsewhere', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const url = '/kinesiology-evaluations/9223372036854775807?assignment_id=17&limit=50&offset=0';
 const validated = async () => evaluation({ status: 'validated' });
 const author = await evaluatePageFrontmatter(page, { url, getEvaluation: validated });
 assert.equal(author.canAmend, true);
 assert.equal(author.amendHref, '/_actions/createKinesiologyAmendment?_action=createKinesiologyAmendment&assignment_id=17&limit=50&offset=0');
 const replacement = await evaluatePageFrontmatter(page, { url, getEvaluation: validated, actor: { sub: otherSubjectId, role: 'estudiante', permissions: ['kinesiology-evaluations:write'] } });
 assert.equal(replacement.canAmend, true);
 assert.equal((await evaluatePageFrontmatter(page, { url })).canAmend, false);
 assert.equal((await evaluatePageFrontmatter(page, { url, getEvaluation: async () => evaluation({ status: 'submitted' }) })).canAmend, false);
 assert.equal((await evaluatePageFrontmatter(page, { url, getEvaluation: async () => evaluation({ status: 'validated', origin_group_id: otherGroupId }) })).canAmend, false);
 assert.equal((await evaluatePageFrontmatter(page, { url, getEvaluation: validated, actor: { sub: authorId, role: 'teacher', permissions: ['kinesiology-evaluations:read', 'kinesiology-evaluations:review'] } })).canAmend, false);
 assert.equal((await evaluatePageFrontmatter(page, { url, getEvaluation: validated, permissions: ['kinesiology-evaluations:submit'] })).canAmend, false);
 const uncertain = await evaluatePageFrontmatter(page, { url, getEvaluation: validated, amendResult: { data: { success: false, uncertain: true, error: 'No se pudo confirmar la creación de la enmienda.' } } });
 assert.equal(uncertain.amendUncertain, true);
 assert.equal(uncertain.canAmend, false);
 assert.match(uncertain.amendError, /No se pudo confirmar/);
 const rejected = await evaluatePageFrontmatter(page, { url, getEvaluation: validated, amendResult: { data: { success: false, uncertain: false, error: 'No tenés permiso para enmendar esta ficha.' } } });
 assert.equal(rejected.amendUncertain, false);
 assert.equal(rejected.amendError, 'No tenés permiso para enmendar esta ficha.');
 const expired = await evaluatePageFrontmatter(page, { url, getEvaluation: validated, amendResult: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.' } } });
 assert.match(expired.redirect, /^\/auth\/login\?returnTo=/);
});

test('confirmed amendment redirects to the new draft through the validated context and announces it', async () => {
 const page = 'src/pages/kinesiology-evaluations/[id].astro';
 const redirect = await evaluatePageFrontmatter(page, {
  params: { id: largeId }, url: `/kinesiology-evaluations/${largeId}?assignment_id=99&limit=10&offset=20`,
  amendResult: { data: { success: true, id: amendmentId, amendment_of_evaluation_id: largeId, assignment_id: '17', limit: '50', offset: '0' } },
 });
 assert.equal(redirect.redirect, `/kinesiology-evaluations/${amendmentId}?assignment_id=17&limit=50&offset=0&amended=1`);
 const draft = await evaluatePageFrontmatter(page, {
  params: { id: amendmentId }, url: `/kinesiology-evaluations/${amendmentId}?assignment_id=17&limit=50&offset=0&amended=1`,
  getEvaluation: async () => amendment({ author_id: authorId }),
 });
 assert.equal(draft.justAmended, true);
 assert.equal(draft.eligible, true);
 assert.equal(draft.canSubmit, true);
 assert.equal(draft.canAmend, false);
 const template = await source(page);
 assert.match(template, /Enmienda creada/);
 assert.match(template, /amendment_of_evaluation_id/);
 assert.match(template, /Crear enmienda/);
});
