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

test('teacher read preserves 401/403/404 failures and never silently returns empty', async () => {
 for (const status of [401, 403, 404]) {
  let deleted = 0;
  const api = await compile(async () => Response.json({ error: { code: 'DENIED', message: 'evaluation was not found' } }, { status }));
  await assert.rejects(api.listTeacherPatients({ limit: 50, offset: 0 }, { ...cookies, delete() { deleted++; } }), (error) => error.status === status);
  assert.equal(deleted, status === 401 ? 1 : 0);
 }
});
