import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/permission-matrix/api.ts';
const source = (path) => readFile(new URL(path, root), 'utf8');
const permission = (name, enforced = false) => ({ permission: name, enforced });
const payload = {
  permissions: [permission('users:write'), permission('users:unassigned', true), permission('users:read', true)],
  roles: [{ role: 'student', permissions: ['users:write'] }, { role: 'admin', permissions: ['users:read'] }],
};

async function loadApi(options = {}) {
  const requests = [];
  const writes = [];
  const cookies = {
    get: () => ({ value: 'synthetic-session' }),
    set: (...args) => writes.push(['set', ...args]),
    delete: (...args) => writes.push(['delete', ...args]),
  };
  const sandbox = vm.createContext({ URL, URLSearchParams, Error });
  async function compile(code, identifier) {
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = new vm.SourceTextModule(output, { context: sandbox, identifier });
    await module.link(async (specifier, parent) => {
      if (specifier === '../../shared/apiClient') return new vm.SyntheticModule(['apiFetch', 'ApiError'], function () {
        class ApiError extends Error { constructor(status) { super(String(status)); this.status = status; } }
        this.setExport('ApiError', ApiError);
        this.setExport('apiFetch', async (path, init) => {
          requests.push({ path, init });
          if (options.networkError) throw new Error('Synthetic network failure');
          if (options.error) throw new ApiError(options.error);
          return Object.hasOwn(options, 'body') ? options.body : payload;
        });
      }, { context: sandbox });
      const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
      return compile(await readFile(resolved, 'utf8'), resolved.href);
    });
    return module;
  }
  const mod = await compile(await source(apiPath), new URL(apiPath, root).href);
  await mod.evaluate();
  return { api: mod.namespace, cookies, requests, writes };
}

test('permission matrix fetches authenticated read-only backend contract and retains complete distinctions', async () => {
  const { api, cookies, requests, writes } = await loadApi();
  const result = await api.getPermissionMatrix(cookies);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    permissions: [permission('users:read', true), permission('users:unassigned', true), permission('users:write')],
    roles: [{ role: 'admin', permissions: ['users:read'] }, { role: 'student', permissions: ['users:write'] }],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/auth/permission-matrix');
  assert.equal(requests[0].init.cookies, cookies);
  assert.deepEqual(writes, []);
});

test('permission matrix rejects malformed DTOs without exposing partial content', async () => {
  for (const body of [null, {}, { ...payload, permissions: [permission('users:read', 'yes')] },
    { ...payload, roles: [{ role: 'admin', permissions: [1] }] }, { ...payload, permissions: {} }]) {
    const { api, cookies } = await loadApi({ body });
    assert.deepEqual(JSON.parse(JSON.stringify(await api.getPermissionMatrix(cookies))), { state: 'failed' });
  }
});

test('403 and server/network failures return no data while 401 propagates', async () => {
  for (const status of [403, 404, 500]) {
    const { api, cookies, writes } = await loadApi({ error: status });
    assert.deepEqual(JSON.parse(JSON.stringify(await api.getPermissionMatrix(cookies))), { state: status === 403 ? 'denied' : 'failed' });
    assert.deepEqual(writes, []);
  }
  const offline = await loadApi({ networkError: true });
  assert.deepEqual(JSON.parse(JSON.stringify(await offline.api.getPermissionMatrix(offline.cookies))), { state: 'failed' });
  assert.deepEqual(offline.writes, []);
  const { api, cookies } = await loadApi({ error: 401 });
  await assert.rejects(api.getPermissionMatrix(cookies), (error) => error.status === 401);
});

test('page and navigation provide no-store, Spanish read-only table and Personas link', async () => {
  const page = await source('src/pages/permission-matrix.astro');
  const layout = await source('src/layouts/Layout.astro');
  assert.match(page, /Cache-Control',\s*'no-store/);
  assert.match(page, /<table[\s>]/);
  assert.match(page, /Asignación/);
  assert.match(page, /Aplicación|Exigencia|Enforcement/i);
  assert.match(page, /403|denied/);
  assert.match(page, /401|auth\/login/);
  assert.match(layout, /Matriz de permisos/);
  assert.match(layout, /href="\/permission-matrix"/);
});
