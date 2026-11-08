import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/oral-surgery-draft/api.ts';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const context = { patient_id: patientId, subject_id: subjectId, academic_group_id: groupId };
const content = {
 admission_date: '2026-11-06',
 medical_history: { hospitalized: false, taking_medication: null, consultation_reason: 'Dolor en pieza 38' },
 complementary_tests: { panoramic_radiographs: true, blood_group: 'O+' },
 extraoral_exam: { facial_symmetry: true, skin: '' },
 intraoral_exam: {},
 preoperative: { vital: true, tooth: '38', cc_rr: 'CC' },
 treatment_plan: { procedure: 'Exodoncia simple', anomalies_or_pathology: null },
};
const draft = (overrides = {}) => ({
 id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
 origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
 content, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const declaration = (overrides = {}) => ({
 id: '7', draft_id: largeId, draft_version: '3', plan_revision: '2', treatment_plan: content.treatment_plan,
 declared_by: authorId, declared_at: iso, ...overrides,
});
const authorization = (overrides = {}) => ({
 id: '11', draft_id: largeId, draft_version: '3', consent_declaration_id: '7', reviewed_content: content,
 authorized_by: authorId, teacher_habilitation_id: habilitationId, authorized_at: iso, ...overrides,
});

/** Load the real pod and apiClient against an isolated fetch; every request is recorded. */
async function harness(responses = []) {
 const requests = [];
 const writes = [];
 const cookies = {
  get: (name) => name === 'session' ? { value: 'session-token' } : undefined,
  set: (...args) => writes.push(['set', ...args]), delete: (...args) => writes.push(['delete', ...args]),
 };
 const sandbox = vm.createContext({ URL, URLSearchParams, Response, Error, Date, BigInt, fetch: async (url, init) => {
  requests.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
  const response = responses.shift();
  if (!response) throw new Error(`Unexpected request ${init.method} ${url}`);
  if (response.network) throw new TypeError('fetch failed');
  return Response.json(response.body, { status: response.status ?? 200 });
 } });
 const cache = new Map();
 async function compile(identifier) {
  if (cache.has(identifier)) return cache.get(identifier);
  const code = await readFile(new URL(identifier), 'utf8');
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new vm.SourceTextModule(output, { context: sandbox, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; } });
  cache.set(identifier, mod);
  await mod.link(async (specifier, parent) => {
   if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
   if (specifier === './session') return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
    this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
    this.setExport('clearSession', (jar) => jar.delete('session', { path: '/' }));
   }, { context: sandbox });
   return compile(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
  });
  return mod;
 }
 const mod = await compile(new URL(apiPath, root).href);
 await mod.evaluate();
 return { api: mod.namespace, cookies, requests, writes };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('content validation accepts the documented sections, tri-state answers, empty text and absent keys exactly as given', async () => {
 const { api } = await harness();
 assert.deepEqual(plain(api.validateOralSurgeryContent(content)), content);
 assert.deepEqual(plain(api.validateOralSurgeryContent({})), {});
 assert.deepEqual(plain(api.validateOralSurgeryContent({ admission_date: null, intraoral_exam: {} })), { admission_date: null, intraoral_exam: {} });
 const fourThousandCodePoints = '🦷'.repeat(4000);
 assert.equal(api.validateOralSurgeryContent({ treatment_plan: { procedure: fourThousandCodePoints } }).treatment_plan.procedure, fourThousandCodePoints);
 const fields = plain(api.ORAL_SURGERY_SECTIONS);
 assert.deepEqual(Object.keys(fields), ['medical_history', 'complementary_tests', 'extraoral_exam', 'intraoral_exam', 'preoperative', 'treatment_plan']);
 assert.equal(fields.medical_history.booleans.length, 26);
 assert.equal(fields.medical_history.texts.length, 10);
 assert.deepEqual(fields.preoperative.booleans, ['vital']);
 assert.deepEqual(fields.treatment_plan, { booleans: [], texts: ['procedure', 'anomalies_or_pathology'] });
});

test('content validation rejects unknown keys, null sections, wrong answer types, invalid dates, NUL and text over 4000 code points', async () => {
 const { api } = await harness();
 const rejected = [
  null, [], { notes: 'x' }, { medical_history: null }, { medical_history: { unknown_field: true } },
  { medical_history: { hospitalized: 'true' } }, { medical_history: { consultation_reason: true } },
  { admission_date: '2026-02-30' }, { admission_date: '06/11/2026' }, { treatment_plan: { procedure: 'a\u0000b' } },
  { treatment_plan: { procedure: 'x'.repeat(4001) } }, { intraoral_exam: { lips: 5 } },
 ];
 for (const value of rejected) assert.throws(() => api.validateOralSurgeryContent(value), Error, JSON.stringify(value));
});

test('listing sends exact context and pagination and validates every row, keeping BIGINT ids as strings', async () => {
 const { api, cookies, requests } = await harness([{ body: { items: [draft(), draft({ id: '2', version: '1' })] } }]);
 const rows = await api.listOralSurgeryDrafts(context, cookies, { limit: 50, offset: 0 });
 assert.equal(requests[0].url, `https://backend.invalid/oral-surgery-drafts?patient_id=${patientId}&subject_id=${subjectId}&academic_group_id=${groupId}&limit=50&offset=0`);
 assert.equal(requests[0].method, 'GET');
 assert.deepEqual(rows.map((row) => [row.id, row.version]), [[largeId, '3'], ['2', '1']]);
});

test('listing fails closed on a malformed envelope, an extra key, a foreign context or an unsupported status', async () => {
 for (const body of [
  { items: [draft()], limit: 50 }, {}, { items: [draft({ patient: null })] }, { items: [draft({ origin_group_id: authorId })] },
  { items: [draft({ status: 'submitted' })] }, { items: [draft({ version: 3 })] }, { items: [draft({ version: '0' })] },
  { items: [draft({ content: { notes: 'x' } })] },
 ]) {
  const { api, cookies } = await harness([{ body }]);
  await assert.rejects(api.listOralSurgeryDrafts(context, cookies, { limit: 50, offset: 0 }), Error, JSON.stringify(body));
 }
 const { api, cookies, requests } = await harness();
 await assert.rejects(api.listOralSurgeryDrafts({ ...context, subject_id: 'not-a-uuid' }, cookies, { limit: 50, offset: 0 }));
 await assert.rejects(api.listOralSurgeryDrafts(context, cookies, { limit: 101, offset: 0 }));
 assert.equal(requests.length, 0);
});

test('create posts exactly the context and validated content once and checks the returned context', async () => {
 const created = await harness([{ status: 201, body: draft({ version: '1' }) }]);
 const result = await created.api.createOralSurgeryDraft({ ...context, content }, created.cookies);
 assert.deepEqual(created.requests, [{ url: 'https://backend.invalid/oral-surgery-drafts', method: 'POST', body: { ...context, content } }]);
 assert.equal(result.version, '1');
 const mismatch = await harness([{ status: 201, body: draft({ patient_id: authorId }) }]);
 await assert.rejects(mismatch.api.createOralSurgeryDraft({ ...context, content: {} }, mismatch.cookies), /no coincide/);
 assert.equal(mismatch.requests.length, 1);
});

test('update replaces the whole content with expected_version and accepts only an advanced version of the same draft', async () => {
 const updated = await harness([{ body: draft({ version: '4' }) }]);
 const result = await updated.api.updateOralSurgeryDraft(largeId, '3', { treatment_plan: {} }, context, updated.cookies);
 assert.deepEqual(updated.requests, [{ url: `https://backend.invalid/oral-surgery-drafts/${largeId}`, method: 'PATCH', body: { expected_version: '3', content: { treatment_plan: {} } } }]);
 assert.equal(result.version, '4');
 const stale = await harness([{ body: draft({ version: '3' }) }]);
 await assert.rejects(stale.api.updateOralSurgeryDraft(largeId, '3', {}, context, stale.cookies), /no se pudo confirmar/i);
 const local = await harness();
 await assert.rejects(local.api.updateOralSurgeryDraft(largeId, '03', {}, context, local.cookies));
 await assert.rejects(local.api.updateOralSurgeryDraft('1.5', '3', {}, context, local.cookies));
 await assert.rejects(local.api.updateOralSurgeryDraft(largeId, '3', { notes: 'x' }, context, local.cookies));
 assert.equal(local.requests.length, 0);
});

test('a stale-version 409 surfaces as a typed conflict and nothing is retried', async () => {
 const { api, cookies, requests } = await harness([{ status: 409, body: { error: { code: 'CONFLICT', message: 'draft version changed; reload before saving' } } }]);
 await assert.rejects(api.updateOralSurgeryDraft(largeId, '3', {}, context, cookies), (error) => error.status === 409 && error.code === 'CONFLICT' && /reload before saving/.test(error.message));
 assert.equal(requests.length, 1);
});

test('get reads one draft by string id and rejects another id', async () => {
 const read = await harness([{ body: draft() }]);
 assert.equal((await read.api.getOralSurgeryDraft(largeId, read.cookies)).id, largeId);
 assert.equal(read.requests[0].url, `https://backend.invalid/oral-surgery-drafts/${largeId}`);
 const other = await harness([{ body: draft({ id: '5' }) }]);
 await assert.rejects(other.api.getOralSurgeryDraft(largeId, other.cookies));
});

test('consent history is validated exactly, including the current declaration reference and plan snapshot', async () => {
 const history = { draft_version: '3', plan_revision: '2', current_declaration_id: '7', declarations: [declaration({ id: '6', treatment_plan: null, plan_revision: '1' }), declaration()] };
 const read = await harness([{ body: history }]);
 const result = await read.api.getConsentHistory(largeId, read.cookies);
 assert.equal(read.requests[0].url, `https://backend.invalid/oral-surgery-drafts/${largeId}/consent`);
 assert.deepEqual(plain(result), history);
 for (const body of [
  { ...history, extra: true }, { ...history, current_declaration_id: '8' }, { ...history, declarations: [declaration({ draft_id: '1' })] },
  { ...history, declarations: [declaration({ treatment_plan: { notes: 'x' } })] }, { ...history, declarations: [declaration({ declared_by: 'x' })] },
  { ...history, plan_revision: 2 },
 ]) {
  const bad = await harness([{ body }]);
  await assert.rejects(bad.api.getConsentHistory(largeId, bad.cookies), Error, JSON.stringify(body));
 }
 const empty = await harness([{ body: { draft_version: '1', plan_revision: '1', current_declaration_id: null, declarations: [] } }]);
 assert.equal((await empty.api.getConsentHistory(largeId, empty.cookies)).current_declaration_id, null);
});

test('declaring paper consent posts only expected_version and literal true and confirms the declared version', async () => {
 const declared = await harness([{ status: 201, body: declaration() }]);
 const result = await declared.api.declarePaperConsent(largeId, '3', declared.cookies);
 assert.deepEqual(declared.requests, [{ url: `https://backend.invalid/oral-surgery-drafts/${largeId}/consent`, method: 'POST', body: { expected_version: '3', paper_signed: true } }]);
 assert.equal(result.id, '7');
 const mismatch = await harness([{ status: 201, body: declaration({ draft_version: '2' }) }]);
 await assert.rejects(mismatch.api.declarePaperConsent(largeId, '3', mismatch.cookies), /no se pudo confirmar/i);
});

test('authorization history and authorize validate exact keys and bind version and declaration', async () => {
 const history = { draft_version: '3', current_authorization_id: '11', authorizations: [authorization()] };
 const read = await harness([{ body: history }]);
 assert.deepEqual(plain(await read.api.getAuthorizationHistory(largeId, read.cookies)), history);
 assert.equal(read.requests[0].url, `https://backend.invalid/oral-surgery-drafts/${largeId}/authorizations`);
 for (const body of [{ ...history, current_authorization_id: '12' }, { ...history, authorizations: [authorization({ reviewed_content: { notes: 'x' } })] }, { ...history, authorizations: [{ ...authorization(), extra: 1 }] }]) {
  const bad = await harness([{ body }]);
  await assert.rejects(bad.api.getAuthorizationHistory(largeId, bad.cookies), Error, JSON.stringify(body));
 }
 const authorized = await harness([{ status: 201, body: authorization() }]);
 const result = await authorized.api.authorizeOralSurgeryDraft(largeId, '3', '7', authorized.cookies);
 assert.deepEqual(authorized.requests, [{ url: `https://backend.invalid/oral-surgery-drafts/${largeId}/authorizations`, method: 'POST', body: { expected_version: '3', consent_declaration_id: '7', paper_consent_verified: true } }]);
 assert.equal(result.id, '11');
 const mismatch = await harness([{ status: 201, body: authorization({ consent_declaration_id: '6' }) }]);
 await assert.rejects(mismatch.api.authorizeOralSurgeryDraft(largeId, '3', '7', mismatch.cookies), /no se pudo confirmar/i);
 const local = await harness();
 await assert.rejects(local.api.authorizeOralSurgeryDraft(largeId, '3', '0', local.cookies));
 assert.equal(local.requests.length, 0);
});
