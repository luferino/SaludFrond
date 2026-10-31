import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const id = '9007199254741061';
const latest = '9007199254741063';
const previous = '9007199254741062';
const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
const evaluation = { id, clinical_record_id: id, patient_id: patient, author_id: patient, origin_student_habilitation_id: patient, origin_subject_id: subject, origin_group_id: group, status: 'submitted', content: {}, patient: null, age: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const snapshot = (submissionId, ordinal, status = 'pending_validation') => ({ id: submissionId, evaluation_id: id, ordinal, submitted_by: patient, submitted_at: '2026-01-02T00:00:00Z', status, clinical_content: {}, studies: [], patient: null, age_at_admission: null, consent: { id: '5', paper_signature_date: '2026-01-01', verified_by: patient, verified_at: '2026-01-02T00:00:00Z' } });
const teacherCookies = (permissions, role = 'teacher') => ({ get: () => ({ value: `header.${Buffer.from(JSON.stringify({ role, permissions, exp: 9999999999 })).toString('base64url')}.signature` }), delete() {} });
const grants = ['kinesiology-evaluations:read', 'kinesiology-evaluations:review'];

async function compile(fetcher, path = 'src/pods/teacher-clinical/actions/reviews.ts') {
 const sandbox = vm.createContext({ URL, URLSearchParams, atob, Date, fetch: fetcher });
 const modules = new Map();
 function create(url) {
  const key = url.href;
  if (!modules.has(key)) {
   const pending = Promise.resolve().then(async () => {
    const code = await readFile(url, 'utf8');
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    return new vm.SourceTextModule(output, { context: sandbox, identifier: key, initializeImportMeta(meta) { meta.env = { PUBLIC_API_URL: 'https://api.invalid' }; } });
   });
   modules.set(key, pending);
  }
  return modules.get(key);
 }
 const mod = await create(new URL(path, root));
 await mod.link((specifier, parent) => create(new URL(`${specifier}.ts`, parent.identifier)));
 await mod.evaluate();
 return mod.namespace;
}

function fakeApi({ status = 'submitted', history = [snapshot(previous, '1'), snapshot(latest, '2')], response, postStatus = 201, postError, postThrow } = {}) {
 const requests = [];
 const state = { status, history, corrections: [], content: { admission_status: 'Baseline' } };
 const fetcher = async (url, init = {}) => {
  requests.push([url, init]);
  if (init.method === 'POST') {
   if (postThrow) throw new Error('lost response');
   if (postError) return Response.json({ error: { code: 'CONFLICT', message: postError } }, { status: postStatus });
   if (postStatus >= 500) return Response.json({ error: { code: 'SERVER', message: 'failed' } }, { status: postStatus });
   const body = JSON.parse(init.body);
   if (url.endsWith('/validations')) {
    state.status = 'validated';
    state.history = state.history.map((item) => item.id === body.submission_id ? { ...item, status: 'validated' } : item);
    return Response.json(response ?? { evaluation_id: id, submission_id: body.submission_id, status: 'validated', reviewed_by: patient, reviewed_at: '2026-02-01T00:00:00Z' }, { status: postStatus });
   }
   state.corrections.push({ submission_id: body.submission_id, reason: body.reason, reviewed_by: patient, requested_at: '2026-02-01T00:00:00Z' });
   state.status = 'draft';
   state.content = state.history.find((item) => item.id === body.submission_id)?.clinical_content ?? {};
   return Response.json(response ?? { evaluation_id: id, submission_id: body.submission_id, status: 'draft', correction_request_id: '9007199254741099', requested_at: '2026-02-01T00:00:00Z' }, { status: postStatus });
  }
  if (url.endsWith('/submissions')) return Response.json({ evaluation_id: id, items: state.history });
  if (url.endsWith('/corrections')) return Response.json({ evaluation_id: id, items: state.corrections });
  return Response.json({ ...evaluation, status: state.status, content: state.content });
 };
 return { requests, state, fetcher };
}

const input = (submission_id = latest, patch = {}) => ({ id, ...context, submission_id, ...patch });
async function publicBaseline(fetcher) {
 const urls = [`/kinesiology-evaluations/${id}`, `/kinesiology-evaluations/${id}/submissions`, `/kinesiology-evaluations/${id}/corrections`];
 const values = [];
 for (const path of urls) values.push(await (await fetcher(`https://api.invalid${path}`, { method: 'GET' })).json());
 return values;
}
async function assertRejectedWithoutPublicChanges(apiState, operation, expectedPosts = 0) {
 const before = await publicBaseline(apiState.fetcher);
 const writesBefore = apiState.requests.filter(([, init]) => init.method === 'POST').length;
 const result = await operation();
 assert.equal(result.success, false);
 assert.deepEqual(await publicBaseline(apiState.fetcher), before);
 assert.equal(apiState.requests.filter(([, init]) => init.method === 'POST').length, writesBefore + expectedPosts);
 return result;
}

test('review actions perform one confirmed targeted validation or reasoned correction and return validated context', async () => {
 for (const [handler, expectedPath, body, expectedStatus] of [
  ['handleValidateTeacherSubmission', '/validations', { submission_id: latest }, 'validated'],
  ['handleRequestTeacherCorrection', '/corrections', { submission_id: latest, reason: 'Revisar diagnóstico' }, 'draft'],
 ]) {
  const apiState = fakeApi();
  const api = await compile(apiState.fetcher);
  const result = await api[handler](input(latest, body.reason ? { reason: body.reason } : {}), { cookies: teacherCookies(grants) });
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify({ id: result.id, ...result.context })), { id, ...context });
  const writes = apiState.requests.filter(([, init]) => init.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], `https://api.invalid/kinesiology-evaluations/${id}${expectedPath}`);
  assert.deepEqual(JSON.parse(writes[0][1].body), body);
  assert.equal(result.result.status, expectedStatus);
 }
});

test('review actions enforce exact grant, teacher profile, origin, current status and latest BigInt target before writes', async () => {
 const attempts = [
  [input(), teacherCookies(['kinesiology-evaluations:read'])],
  [input(), teacherCookies(grants, 'student')],
  [input('9007199254741062'), teacherCookies(grants)],
  [{ ...input(), patient_id: group }, teacherCookies(grants)],
  [{ ...input(), subject_id: patient }, teacherCookies(grants)],
  [{ ...input(), academic_group_id: patient }, teacherCookies(grants)],
 ];
 for (const [form, cookies] of [...attempts, [input(latest, { unexpected: 'not allowed' }), teacherCookies(grants)]]) {
  const apiState = fakeApi(); const api = await compile(apiState.fetcher);
  await assertRejectedWithoutPublicChanges(apiState, () => api.handleValidateTeacherSubmission(form, { cookies }));
 }
 for (const status of ['draft', 'validated']) {
  const apiState = fakeApi({ status }); const api = await compile(apiState.fetcher);
  await assertRejectedWithoutPublicChanges(apiState, () => api.handleRequestTeacherCorrection(input(latest, { reason: 'Revisar' }), { cookies: teacherCookies(grants) }));
 }
 const unknownCorrection = fakeApi(); const correctionApi = await compile(unknownCorrection.fetcher);
 await assertRejectedWithoutPublicChanges(unknownCorrection, () => correctionApi.handleRequestTeacherCorrection(input(latest, { reason: 'Revisar', extra: 'not allowed' }), { cookies: teacherCookies(grants) }));
 const reordered = fakeApi({ history: [snapshot(latest, '2'), snapshot(previous, '1')] });
 const bad = await compile(reordered.fetcher);
 await assertRejectedWithoutPublicChanges(reordered, () => bad.handleValidateTeacherSubmission(input(), { cookies: teacherCookies(grants) }));
});

test('reason rejects blank text, trims only for the payload, and retains typed reason on failures', async () => {
 for (const reason of ['', '  \n  ']) {
  const apiState = fakeApi(); const api = await compile(apiState.fetcher);
  await assertRejectedWithoutPublicChanges(apiState, () => api.handleRequestTeacherCorrection(input(latest, { reason }), { cookies: teacherCookies(grants) }));
 }
 const apiState = fakeApi({ postStatus: 409, postError: 'submission is not the latest version' });
 const api = await compile(apiState.fetcher);
 const reason = '  Revisar diagnóstico  ';
 const result = await api.handleRequestTeacherCorrection(input(latest, { reason }), { cookies: teacherCookies(grants) });
 assert.equal(result.success, false);
 assert.equal(result.reason, reason);
 assert.equal(apiState.requests.filter(([, init]) => init.method === 'POST').length, 1);
 assert.equal(JSON.parse(apiState.requests.find(([, init]) => init.method === 'POST')[1].body).reason, reason.trim());
});

test('malformed success, network loss and server failure are uncertain and never retried', async () => {
 for (const options of [
  { response: { evaluation_id: id, submission_id: previous, status: 'validated', reviewed_by: patient, reviewed_at: '2026-02-01T00:00:00Z' } },
  { response: { evaluation_id: id, submission_id: latest, status: 'validated', reviewed_by: 'bad', reviewed_at: 'bad' } },
  { postThrow: true },
  { postStatus: 500 },
 ]) {
  const apiState = fakeApi(options); const api = await compile(apiState.fetcher);
  const result = await api.handleValidateTeacherSubmission(input(), { cookies: teacherCookies(grants) });
  assert.equal(result.success, false);
  assert.equal(result.uncertain, true);
  assert.equal(apiState.requests.filter(([, init]) => init.method === 'POST').length, 1);
 }
});

test('known backend review conflicts stay failures and do not alter public GET baselines', async () => {
 for (const status of [400, 401, 403, 404, 409]) {
  const apiState = fakeApi({ postStatus: status, postError: 'evaluation is not awaiting validation' });
  const api = await compile(apiState.fetcher);
  const result = await assertRejectedWithoutPublicChanges(apiState, () => api.handleValidateTeacherSubmission(input(), { cookies: teacherCookies(grants) }), 1);
  assert.notEqual(result.uncertain, true);
  assert.equal(apiState.requests.filter(([, init]) => init.method === 'POST').length, 1);
 }
});

test('strict registered review actions expose only approved fields', async () => {
 const registry = await readFile(new URL('src/actions/index.ts', root), 'utf8');
 assert.match(registry, /validateTeacherSubmission:\s*defineAction\([\s\S]*?\.strict\(\)[\s\S]*?handleValidateTeacherSubmission/);
 assert.match(registry, /requestTeacherCorrection:\s*defineAction\([\s\S]*?reason:\s*z\.string\(\)[\s\S]*?\.strict\(\)[\s\S]*?handleRequestTeacherCorrection/);
});
