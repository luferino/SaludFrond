import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/assignment-report.astro';
const reportPath = 'src/pods/assignment-report/report.ts';
const query = 'from=2025-01-01&to=2025-01-02';
const subjectId = 'subject-missing';
const groupId = 'group-missing';
const row = { career: 'kinesiology', subject_id: subjectId, academic_group_id: groupId, assignment_count: 3 };

class FixtureApiError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.name = 'ApiError'; this.status = status; }
}

async function loadModule(path, options = {}) {
  const cache = new Map();
  const context = vm.createContext({ URL, URLSearchParams, Date, Number, String, Array, Object, Math, Intl, Error, atob, fetch: options.fetch });
  async function build(relative) {
    const url = relative instanceof URL ? relative : new URL(relative, root);
    if (cache.has(url.href)) return cache.get(url.href);
    const source = await readFile(url, 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = new vm.SourceTextModule(js, { context, identifier: url.href });
    cache.set(url.href, mod);
    await mod.link(async (specifier, parent) => {
      if (specifier === '../../shared/apiClient' || specifier === '../../../shared/apiClient') {
        return new vm.SyntheticModule(['ApiError', 'apiFetch'], function () {
          this.setExport('ApiError', FixtureApiError);
          this.setExport('apiFetch', options.apiFetch ?? (async () => { throw new Error('Unexpected API request'); }));
        }, { context });
      }
      const target = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
      return build(target);
    });
    return mod;
  }
  const module = await build(path);
  await module.evaluate();
  return module.namespace;
}

async function reportModule(options = {}) {
  const calls = [];
  const apiFetch = async (path) => {
    calls.push(path);
    if (path.startsWith('/reports/')) {
      if (options.reportFailure) throw new FixtureApiError(options.reportFailure);
      return { total: 3, items: [row] };
    }
    const role = path.startsWith('/subjects?') ? 'subject' : 'group';
    if (options.catalogFailure?.[role]) throw new FixtureApiError(options.catalogFailure[role]);
    if (role === 'subject') return { limit: 100, offset: 0, items: [{ id: subjectId, name: 'Asignatura recuperada' }] };
    return { limit: 100, offset: 0, items: [{ id: groupId, academic_year: 2025, curriculum_semester: 1, name: 'Grupo recuperado' }] };
  };
  const report = await loadModule(reportPath, { apiFetch });
  const token = Buffer.from(JSON.stringify({ role: 'admin', permissions: ['assignment-reports:read'], exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const cookies = { get: (name) => name === 'session' ? { value: `synthetic.${token}.signature` } : undefined };
  return { ...report, calls, cookies };
}

async function renderPage(options = {}) {
  const report = await reportModule(options);
  let code = (await transform(await readFile(new URL(pagePath, root), 'utf8'), { filename: pagePath })).code;
  const ast = ts.createSourceFile('assignment-report.ts', code, ts.ScriptTarget.Latest, true);
  const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata')).map((statement) => [statement.getFullStart(), statement.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const Astro = {
    url: new URL(`https://fixture.invalid/assignment-report?${query}`), cookies: report.cookies,
    response: { headers: new Headers() }, redirect: (url) => `REDIRECT:${url}`,
  };
  const html = async (value) => {
    value = await value;
    if (value == null || value === false) return '';
    if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
    return String(value);
  };
  const mocks = {
    Layout: (props) => props.children,
    Fragment: (props) => props.children,
    ApiError: FixtureApiError,
    loadAssignmentReportPage: report.loadAssignmentReportPage,
    $$createAstro: () => ({}), $$createComponent: (component) => component,
    $$render: async (strings, ...values) => { let out = ''; for (let i = 0; i < strings.length; i++) out += strings[i] + await html(values[i]); return out; },
    $$renderComponent: async (_result, _name, component, _props, slots) => typeof component === 'function' ? component({ children: await slots?.default?.() }) : slots?.default?.() ?? '',
    $$addAttribute: (value, name) => value == null || value === false ? '' : value === true ? ` ${name}` : ` ${name}="${String(value)}"`,
    $$maybeRenderHead: () => '', $$renderHead: () => '',
  };
  const exports = {};
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  const markup = await html(exports.default({ createAstro: () => Astro }, {}, {}));
  return { markup, calls: report.calls };
}

test('the compiled report page redirects report and either catalog 401 to login with path and query', async () => {
  for (const options of [{ reportFailure: 401 }, { catalogFailure: { subject: 401 } }, { catalogFailure: { group: 401 } }]) {
    const result = await renderPage(options);
    assert.equal(result.markup, 'REDIRECT:/auth/login?returnTo=%2Fassignment-report%3Ffrom%3D2025-01-01%26to%3D2025-01-02');
  }
});

test('the actual middleware redirects missing and expired sessions by pathname only without report calls', async () => {
  const source = await readFile(new URL('src/middleware.ts', root), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const calls = [];
  const modules = {
    'astro/middleware': { defineMiddleware: (handler) => handler },
    './shared/jwt': { isTokenValid: (token) => token === 'valid' },
    './shared/session': { getSession: (cookies) => cookies.get('session')?.value ?? null },
  };
  new Function('exports', 'require', js)(exports, (name) => modules[name]);
  for (const session of [undefined, 'expired']) {
    let proceeded = false;
    const context = { url: new URL('https://fixture.invalid/assignment-report?from=2025-01-01&to=2025-01-02'), cookies: { get: () => session }, redirect: (url) => `REDIRECT:${url}` };
    const response = await exports.onRequest(context, async () => { proceeded = true; calls.push('next'); });
    assert.equal(response, 'REDIRECT:/auth/login?returnTo=%2Fassignment-report');
    assert.equal(proceeded, false);
  }
  assert.deepEqual(calls, []);
});

test('subject catalog denial and failure keep the report usable, fall back to subject ID, and retain group label', async () => {
  for (const failure of [403, 500]) {
    const { markup, calls } = await renderPage({ catalogFailure: { subject: failure } });
    assert.match(markup, /Total de asignaciones:\s*<strong[^>]*>3<\/strong>/);
    assert.match(markup, new RegExp(`<td[^>]*>${subjectId}<\/td>`));
    assert.match(markup, /<td[^>]*>Grupo recuperado<\/td>/);
    assert.deepEqual(calls, ['/reports/assignments?from=2025-01-01&to=2025-01-02', '/subjects?limit=100&offset=0', '/groups?limit=100&offset=0']);
  }
});

test('group catalog denial and failure keep the report usable, fall back to group ID, and retain subject label', async () => {
  for (const failure of [403, 500]) {
    const { markup, calls } = await renderPage({ catalogFailure: { group: failure } });
    assert.match(markup, /Total de asignaciones:\s*<strong[^>]*>3<\/strong>/);
    assert.match(markup, /<td[^>]*>Asignatura recuperada<\/td>/);
    assert.match(markup, new RegExp(`<td[^>]*>${groupId}<\/td>`));
    assert.deepEqual(calls, ['/reports/assignments?from=2025-01-01&to=2025-01-02', '/subjects?limit=100&offset=0', '/groups?limit=100&offset=0']);
  }
});
