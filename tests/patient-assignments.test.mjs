import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const id = '9223372036854775807';
const row = {
  id, patient_id: '11111111-1111-4111-8111-111111111111',
  student_habilitation_id: '22222222-2222-4222-8222-222222222222',
  subject_id: '33333333-3333-4333-8333-333333333333', academic_group_id: '44444444-4444-4444-8444-444444444444',
  assigned_by: '55555555-5555-4555-8555-555555555555', nombres: 'Ana', apellidos: 'Pérez', documento: '12345678',
  assigned_at: '2025-01-01T00:00:00Z', ended_by: null, ended_at: null, end_reason: null,
};

async function compile(path, sandbox = {}) {
  const context = vm.createContext({ URL, URLSearchParams, fetch: async () => {}, ...sandbox });
  async function load(code, identifier) {
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = new vm.SourceTextModule(output, { context, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://api.invalid' }; } });
    await mod.link(async (specifier, parent) => {
      const url = new URL(`${specifier}.ts`, parent.identifier);
      return load(await readFile(url, 'utf8'), url.href);
    });
    return mod;
  }
  const mod = await load(await source(path), new URL(path, root).href);
  await mod.evaluate();
  return mod.namespace;
}

test('pagination defaults and rejects duplicate, malformed, unsafe, or out-of-range values', async () => {
  const api = await compile('src/pods/patient-assignment/api.ts');
  assert.deepEqual({ ...api.parseAssignmentPagination(new URLSearchParams()) }, { limit: 50, offset: 0 });
  assert.deepEqual({ ...api.parseAssignmentPagination(new URLSearchParams('limit=100&offset=9007199254740991')) }, { limit: 100, offset: 9007199254740991 });
  for (const query of ['limit=0', 'limit=101', 'limit=1&limit=2', 'limit=-1', 'offset=-1', 'offset=9007199254740992', 'offset=1.5', 'offset=1&offset=2']) {
    assert.throws(() => api.parseAssignmentPagination(new URLSearchParams(query)));
  }
  const zeroId = await compile('src/pods/patient-assignment/api.ts', { fetch: async () => Response.json({ items: [{ ...row, id: '0' }], limit: 50, offset: 0 }) });
  await assert.rejects(zeroId.listAssignedPatients({ limit: 50, offset: 0 }, { get: () => undefined }));
});

test('mine adapter sends exact authenticated URL, validates rows, preserves decimal ids and contexts', async () => {
  const apiSource = await source('src/pods/patient-assignment/api.ts');
  assert.match(apiSource, /academic_group_id: string/);
  assert.doesNotMatch(apiSource, /\bgroup_id\b/);
  const requests = [];
  const cookies = { get: () => ({ value: 'session-token' }) };
  const api = await compile('src/pods/patient-assignment/api.ts', { fetch: async (url, init) => { requests.push([url, init]); return Response.json({ items: [row, { ...row, id: '9007199254740993', subject_id: '66666666-6666-4666-8666-666666666666' }], limit: 50, offset: 0 }); } });
  const result = await api.listAssignedPatients({ limit: 50, offset: 0 }, cookies);
  assert.equal(requests[0][0], 'https://api.invalid/patient-assignments/mine?limit=50&offset=0');
  assert.equal(requests[0][1].headers.Authorization, 'Bearer session-token');
  assert.equal(requests[0][1].body, undefined);
  assert.equal(result.items[0].id, id);
  assert.equal(result.items[1].id, '9007199254740993');
  assert.equal(result.items[0].academic_group_id, row.academic_group_id);
  assert.equal(result.items[0].ended_by, null);
  assert.equal(result.items[0].ended_at, null);
  assert.equal(result.items[0].end_reason, null);
  assert.equal(result.items.length, 2);
});

test('mine adapter rejects malformed envelopes, invalid ids and ended assignments', async () => {
  const api = await compile('src/pods/patient-assignment/api.ts', { fetch: async () => Response.json({ items: [{ ...row, id: 9007199254740993 }], limit: 50, offset: 0 }) });
  await assert.rejects(api.listAssignedPatients({ limit: 50, offset: 0 }, { get: () => undefined }));
  const ended = await compile('src/pods/patient-assignment/api.ts', { fetch: async () => Response.json({ items: [{ ...row, ended_at: '2025-02-01T00:00:00Z' }], limit: 50, offset: 0 }) });
  await assert.rejects(ended.listAssignedPatients({ limit: 50, offset: 0 }, { get: () => undefined }));
  const missingAudit = await compile('src/pods/patient-assignment/api.ts', { fetch: async () => { const { ended_by, end_reason, ...withoutAudit } = row; return Response.json({ items: [withoutAudit], limit: 50, offset: 0 }); } });
  await assert.rejects(missingAudit.listAssignedPatients({ limit: 50, offset: 0 }, { get: () => undefined }));
});

test('pagination keeps previous navigation on an empty later page and bounds next offsets', async () => {
  const page = await source('src/pages/my-patients.astro');
  const paginationCode = page.slice(page.indexOf('const previousOffset ='), page.indexOf('const pageLink ='));
  const getNavigation = (offset, limit, items, state) => Function('offset', 'limit', 'items', 'state', `${paginationCode}; return { previousOffset, nextOffset };`)(offset, limit, items, state);
  assert.deepEqual(getNavigation(50, 50, [], 'empty'), { previousOffset: 0, nextOffset: null });
  assert.deepEqual(getNavigation(Number.MAX_SAFE_INTEGER, 100, Array(100), 'ok'), { previousOffset: Number.MAX_SAFE_INTEGER - 100, nextOffset: null });
  assert.match(page, /state !== 'denied' && state !== 'error' && \(previousOffset !== null \|\| nextOffset !== null\)/);
});

test('adapter preserves ApiError status and clears the session only for 401', async () => {
  for (const status of [401, 403]) {
    let deleted = 0;
    const cookies = { get: () => ({ value: 'session-token' }), delete: () => { deleted += 1; } };
    const api = await compile('src/pods/patient-assignment/api.ts', {
      fetch: async () => Response.json({ error: { code: 'DENIED', message: 'Denied' } }, { status }),
    });
    await assert.rejects(api.listAssignedPatients({ limit: 50, offset: 0 }, cookies), (error) => {
      assert.equal(error.name, 'ApiError');
      assert.equal(error.status, status);
      return true;
    });
    assert.equal(deleted, status === 401 ? 1 : 0);
  }
});

test('layout shows separate clinical navigation and nested clinical page titles without changing login conventions', async () => {
  const layout = await source('src/layouts/Layout.astro');
  assert.match(layout, /\/my-patients/);
  assert.match(layout, /\/kinesiology-evaluations/);
  assert.match(layout, /estudiante|student/);
  assert.match(layout, /aria-current/);
  assert.match(layout, /\/patients/);
});

test('assigned patient page is read-only, contextual, and distinguishes empty and error states', async () => {
  const page = await source('src/pages/my-patients.astro');
  assert.match(page, /listAssignedPatients/);
  assert.match(page, /parseAssignmentPagination/);
  assert.match(page, /\/my-patients\/\$\{row\.id\}\?limit=\$\{limit\}&offset=\$\{offset\}/);
  assert.match(page, /items\.length/);
  assert.match(page, /subject_id/);
  assert.match(page, /academic_group_id/);
  assert.match(page, /offset - limit/);
  assert.match(page, /Number\.MAX_SAFE_INTEGER/);
  assert.match(page, /academic_group_id/);
  assert.doesNotMatch(page, /method="POST"|method="PATCH"|actions\./);
  assert.match(page, /401/);
  assert.match(page, /403/);
  assert.match(page, /\.notice \{[^}]*var\(--line\)[^}]*var\(--paper\)/);
  assert.doesNotMatch(page, /var\(--(?:border|background|surface|text)\)/);
});
