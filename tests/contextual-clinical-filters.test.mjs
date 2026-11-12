import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const patient = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const subject = '01234567-89ab-4def-8123-456789abcdef';
const group = 'abcdef01-2345-6789-abcd-ef0123456789';

async function load(path, responses = []) {
 const requests = [];
 const sandbox = vm.createContext({ URL, URLSearchParams, Date, BigInt, fetch: async (url, init) => {
  requests.push({ url, init });
  const response = responses.shift() ?? { items: [] };
  return Response.json(response);
 }});
 const cache = new Map();
 async function compile(text, id) {
  if (cache.has(id)) return cache.get(id);
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new vm.SourceTextModule(code, { context: sandbox, identifier: id, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; } });
  cache.set(id, mod);
  await mod.link(async (specifier, parent) => {
   if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
   const resolved = new URL(`${specifier}.ts`, parent.identifier);
   return compile(await readFile(resolved, 'utf8'), resolved.href);
  });
  return mod;
 }
 const mod = await compile(await source(path), new URL(path, root).href);
 await mod.evaluate();
 return { api: mod.namespace, requests };
}

const cookies = { get: () => ({ value: 'synthetic-session' }) };

test('patient-context date/status helpers accept civil boundary dates and reject invalid ranges before reads', async () => {
 const { api } = await load('src/pods/kinesiology-evaluation/list-filters.ts');
 const { parseClinicalListFilters } = api;
 assert.deepEqual(JSON.parse(JSON.stringify(parseClinicalListFilters(new URLSearchParams('date_from=0001-01-01&date_to=9999-12-31&status=validated')))), { date_from: '0001-01-01', date_to: '9999-12-31', status: 'validated' });
 assert.deepEqual(JSON.parse(JSON.stringify(parseClinicalListFilters(new URLSearchParams('date_from=2024-02-29')))), { date_from: '2024-02-29' });
 for (const query of ['date_from=0000-01-01', 'date_from=2023-02-29', 'date_from=2025-03-01&date_to=2025-02-28', 'status=hidden', 'status=draft&status=submitted', 'date_from=2024-01-01&date_from=2024-01-02', 'date_from%5B0%5D=2024-01-01']) assert.throws(() => parseClinicalListFilters(new URLSearchParams(query)));
});

test('evaluation readers forward only supplied filters while submitted snapshots remain patient-only', async () => {
 const { api, requests } = await load('src/pods/kinesiology-evaluation/api.ts', [{ items: [] }, { items: [] }]);
 const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
 await api.listEvaluations(context, cookies);
 await api.listSubmittedEvaluations(context, cookies);
 assert.equal(requests[0].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`);
 assert.equal(requests[1].url, `https://backend.invalid/kinesiology-evaluations?patient_id=${patient}`);
 await api.listEvaluations(context, cookies, { date_from: '0001-01-01', status: 'draft' });
 await api.listSubmittedEvaluations(context, cookies, { date_to: '2024-02-29', status: 'validated' });
 assert.equal(new URL(requests[2].url).searchParams.get('date_from'), '0001-01-01');
 assert.equal(new URL(requests[3].url).searchParams.get('patient_id'), patient);
 assert.equal(new URL(requests[3].url).searchParams.has('subject_id'), false);
 assert.equal(new URL(requests[3].url).searchParams.get('status'), 'validated');
});

test('evolution filters preserve BIGINT decimal precision and reject invalid IDs before requests', async () => {
 const { api, requests } = await load('src/pods/kinesiology-evolution/listing.ts', [{ items: [] }]);
 const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
 await api.listKinesiologyEvolutions(context, cookies, { evaluation_id: '9223372036854775807' });
 assert.equal(new URL(requests[0].url).searchParams.get('evaluation_id'), '9223372036854775807');
 for (const evaluation_id of ['0', '9223372036854775808', Number('9223372036854775807')]) await assert.rejects(() => api.listKinesiologyEvolutions(context, cookies, { evaluation_id }));
 assert.equal(requests.length, 1);
});

test('Oral Surgery date filters are optional and malformed inputs fail before clinical reads', async () => {
 const { api, requests } = await load('src/pods/oral-surgery-draft/api.ts', [{ items: [] }, { items: [] }]);
 const context = { patient_id: patient, subject_id: subject, academic_group_id: group };
 const page = { limit: 50, offset: 0 };
 await api.listOralSurgeryDrafts(context, cookies, page);
 assert.equal(requests[0].url, `https://backend.invalid/oral-surgery-drafts?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&limit=50&offset=0`);
 await api.listOralSurgeryDrafts(context, cookies, page, { date_to: '2024-02-29' });
 assert.equal(new URL(requests[1].url).searchParams.get('date_to'), '2024-02-29');
 await assert.rejects(() => api.listOralSurgeryDrafts(context, cookies, page, { date_from: '2024-02-30' }));
 assert.equal(requests.length, 2);
});

test('public patient screens expose GET filters only after selected patient/context and keep empty separate from errors', async () => {
 const student = await source('src/pages/my-patients/[assignmentId].astro');
 const teacher = await source('src/pages/teacher-clinical.astro');
 assert.match(student, /clinical-filters/);
 assert.match(teacher, /clinical-filters/);
 assert.match(student, /status|date_from|evaluation_id/);
 assert.match(teacher, /status|date_from|evaluation_id/);
 assert.doesNotMatch(student, /method="POST"[^>]*clinical-filters/);
 assert.doesNotMatch(teacher, /method="POST"[^>]*clinical-filters/);
});
