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
const cookies = { get: () => ({ value: 'token' }), delete() {} };
const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
const assignment = { id, ...context, student_habilitation_id: patient, assigned_by: patient, nombres: 'Ana', apellidos: 'Prueba', documento: 'QA', assigned_at: '2026-01-01T00:00:00Z', ended_by: null, ended_at: null, end_reason: null };
const evaluation = { id, clinical_record_id: id, patient_id: patient, author_id: patient, origin_student_habilitation_id: patient, origin_subject_id: subject, origin_group_id: group, status: 'draft', content: { antecedents: { hta: false, dbt: null }, studies: [] }, patient: null, age: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
async function compile(fetcher, path = 'src/pods/teacher-clinical/api.ts') {
 const sandbox = vm.createContext({ URL, URLSearchParams, atob, Date, fetch: fetcher });
 async function load(url) {
  const code = await readFile(url, 'utf8');
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new vm.SourceTextModule(output, { context: sandbox, identifier: url.href, initializeImportMeta(meta) { meta.env = { PUBLIC_API_URL: 'https://api.invalid' }; } });
  await mod.link((specifier, parent) => load(new URL(`${specifier}.ts`, parent.identifier)));
  return mod;
 }
 const mod = await load(new URL(path, root));
 await mod.evaluate();
 return mod.namespace;
}

test('teacher discovery uses authenticated scoped endpoint, preserves IDs and validates pagination/rows', async () => {
 const requests = [];
 const api = await compile(async (url, init) => { requests.push([url, init]); return Response.json({ items: [assignment], limit: 50, offset: 0 }); });
 const page = await api.listTeacherPatients({ limit: 50, offset: 0 }, cookies);
 assert.equal(page.items[0].id, id);
 assert.equal(requests[0][0], 'https://api.invalid/patient-assignments?limit=50&offset=0');
 assert.equal(requests[0][1].headers.Authorization, 'Bearer token');
 assert.equal(requests[0][1].body, undefined);
 for (const query of ['limit=0', 'limit=101', 'offset=10001', 'offset=1&offset=2']) assert.throws(() => api.parseTeacherPagination(new URLSearchParams(query)));
 for (const row of [{ ...assignment, id: 9 }, { ...assignment, ended_at: '2026-02-01T00:00:00Z' }, { ...assignment, patient_id: 'bad' }]) {
  const bad = await compile(async () => Response.json({ items: [row], limit: 50, offset: 0 }));
  await assert.rejects(bad.listTeacherPatients({ limit: 50, offset: 0 }, cookies));
 }
});

test('teacher origin list preserves all clinical statuses without altering student draft filtering', async () => {
 const requests = [];
 const api = await compile(async (url, init) => { requests.push([url, init]); return Response.json({ items: ['draft', 'submitted', 'validated'].map((status) => ({ ...evaluation, status })) }); });
 const records = await api.listTeacherEvaluations(context, cookies);
 assert.deepEqual(Array.from(records, (record) => record.status), ['draft', 'submitted', 'validated']);
 assert.equal(requests[0][0], `https://api.invalid/kinesiology-evaluations?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`);
 assert.equal(requests[0][1].body, undefined);
 const bad = await compile(async () => Response.json({ items: [{ ...evaluation, origin_group_id: patient }] }));
 await assert.rejects(bad.listTeacherEvaluations(context, cookies));
 const previous = await readFile(new URL('src/pods/kinesiology-evaluation/api.ts', root), 'utf8');
 assert.match(previous, /filter\(\(item\) => item.status === 'draft'\)/);
});

test('teacher detail checks exact selected origin without requesting student mine/current assignment', async () => {
 const requests = [];
 const api = await compile(async (url) => { requests.push(url); return Response.json(evaluation); });
 assert.equal((await api.getTeacherEvaluation(id, context, cookies)).id, id);
 assert.deepEqual(requests, [`https://api.invalid/kinesiology-evaluations/${id}`]);
 await assert.rejects(api.getTeacherEvaluation(id, { ...context, academic_group_id: patient }, cookies));
 await assert.rejects(api.getTeacherEvaluation('0', context, cookies));
});

test('origin parser rejects every cross-context provenance field for all statuses', async () => {
 for (const field of ['submission_id', 'submission_ordinal', 'submitted_by', 'submitted_at', 'consent']) {
  const api = await compile(async () => Response.json({ ...evaluation, status: 'submitted', [field]: null }));
  await assert.rejects(api.getTeacherEvaluation(id, context, cookies));
 }
});

test('consent validates pending/verified envelopes, exact IDs and calendar dates without invented restrictions', async () => {
 const evidence = { id, paper_signature_date: '2099-12-31', verified_by: patient, verified_at: '2026-01-01T00:00:00Z' };
 const api = await compile(async () => Response.json({ evaluation_id: id, status: 'verified', evidence }));
 assert.equal((await api.getConsent(id, cookies)).evidence.paper_signature_date, '2099-12-31');
 for (const date of ['2024-02-29', '2099-12-31', '1900-01-01']) assert.equal(api.validPaperDate(date), true);
 for (const date of ['2025-02-29', '2026-04-31', '2026-1-01', '']) assert.equal(api.validPaperDate(date), false);
 for (const value of [
  { evaluation_id: id, status: 'pending', evidence },
  { evaluation_id: id, status: 'verified', evidence: null },
  { evaluation_id: 9, status: 'pending', evidence: null },
  { evaluation_id: id, status: 'verified', evidence: { ...evidence, id: 9 } },
 ]) {
  const bad = await compile(async () => Response.json(value));
  await assert.rejects(bad.getConsent(id, cookies));
 }
});

const teacherCookies = (permissions, role = 'teacher') => ({ get: () => ({ value: `header.${Buffer.from(JSON.stringify({ role, permissions, exp: 9999999999 })).toString('base64url')}.signature` }), delete() {} });
test('consent action checks separate teacher verify grant, exact origin and origin-only consent before one append', async () => {
 const input = { id, ...context, paper_signature_date: '2099-12-31' };
 const requests = [];
 const evidence = { id, paper_signature_date: input.paper_signature_date, verified_by: patient, verified_at: '2026-01-01T00:00:00Z' };
 const api = await compile(async (url, init) => {
  requests.push([url, init]);
  if (init.method === 'POST') return Response.json({ evaluation_id: id, status: 'verified', evidence }, { status: 201 });
  if (url.endsWith('/consent')) return Response.json({ evaluation_id: id, status: 'pending', evidence: null });
  return Response.json({ ...evaluation, status: 'validated' });
 }, 'src/pods/teacher-clinical/actions/consent.ts');
 for (const [grants, role] of [[['kinesiology-evaluations:read'], 'teacher'], [['kinesiology-evaluations:verify-consent'], 'student']]) {
  const result = await api.handleRecordTeacherConsent(input, { cookies: teacherCookies(grants, role) });
  assert.equal(result.success, false);
  assert.equal(requests.length, 0);
 }
 const grants = ['kinesiology-evaluations:read', 'kinesiology-evaluations:verify-consent'];
 const saved = await api.handleRecordTeacherConsent(input, { cookies: teacherCookies(grants) });
 assert.deepEqual(JSON.parse(JSON.stringify(saved)), { success: true, id, ...context });
 const posts = requests.filter(([, init]) => init.method === 'POST');
 assert.equal(posts.length, 1);
 assert.deepEqual(JSON.parse(posts[0][1].body), { paper_signature_date: '2099-12-31' });
 assert.equal(posts[0][0], `https://api.invalid/kinesiology-evaluations/${id}/consent`);
 const before = posts.length;
 assert.equal((await api.handleRecordTeacherConsent({ ...input, paper_signature_date: '2025-02-29' }, { cookies: teacherCookies(grants) })).success, false);
 assert.equal(requests.filter(([, init]) => init.method === 'POST').length, before);
});

test('denied consent action leaves append count and stored rows unchanged', async () => {
 const rows = [{ id: 'existing', paper_signature_date: '2024-01-01' }];
 let appends = 0;
 const before = structuredClone(rows);
 const api = await compile(async (_url, init) => {
  if (init.method === 'POST') { appends++; rows.push({ paper_signature_date: '2024-02-29' }); }
  return Response.json(evaluation);
 }, 'src/pods/teacher-clinical/actions/consent.ts');
 const result = await api.handleRecordTeacherConsent({ id, ...context, paper_signature_date: '2024-02-29' }, { cookies: teacherCookies(['kinesiology-evaluations:read']) });
 assert.equal(result.success, false);
 assert.equal(appends, 0);
 assert.deepEqual(rows, before);
});

test('consent action never retries failed/ambiguous writes or writes after concealed origin rejection', async () => {
 const grants = ['kinesiology-evaluations:read', 'kinesiology-evaluations:verify-consent'];
 for (const failure of ['snapshot', '404', 'post-failure']) {
  let posts = 0;
  const api = await compile(async (url, init) => {
   if (init.method === 'POST') { posts++; throw new Error('network response lost'); }
   if (url.endsWith('/consent')) return Response.json({ error: { code: 'NOT_FOUND', message: 'evaluation was not found' } }, { status: 404 });
   return Response.json(failure === 'snapshot' ? { ...evaluation, submission_id: id } : evaluation);
  }, 'src/pods/teacher-clinical/actions/consent.ts');
  const result = await api.handleRecordTeacherConsent({ id, ...context, paper_signature_date: '2024-02-29' }, { cookies: teacherCookies(grants) });
  assert.equal(result.success, false);
  assert.equal(posts, 0);
 }
 let posts = 0;
 const api = await compile(async (url, init) => {
  if (init.method === 'POST') { posts++; throw new Error('network response lost'); }
  return Response.json(url.endsWith('/consent') ? { evaluation_id: id, status: 'pending', evidence: null } : evaluation);
 }, 'src/pods/teacher-clinical/actions/consent.ts');
 const result = await api.handleRecordTeacherConsent({ id, ...context, paper_signature_date: '2024-02-29' }, { cookies: teacherCookies(grants) });
 assert.equal(result.success, false);
 assert.match(result.error, /No se pudo confirmar/);
 assert.equal(posts, 1);
});

test('teacher read preserves 401/403/404 failures and never silently returns empty', async () => {
 for (const status of [401, 403, 404]) {
  let deleted = 0;
  const api = await compile(async () => Response.json({ error: { code: 'DENIED', message: 'evaluation was not found' } }, { status }));
  await assert.rejects(api.listTeacherPatients({ limit: 50, offset: 0 }, { ...cookies, delete() { deleted++; } }), (error) => error.status === status);
  assert.equal(deleted, status === 401 ? 1 : 0);
 }
});
