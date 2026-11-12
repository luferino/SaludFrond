import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
async function compile(path, fetch) {
  const context = vm.createContext({ URL, URLSearchParams, fetch });
  async function load(code, identifier) {
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = new vm.SourceTextModule(output, { context, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://api.invalid' }; } });
    await mod.link(async (specifier, parent) => { const url = new URL(`${specifier}.ts`, parent.identifier); return load(await readFile(url, 'utf8'), url.href); });
    return mod;
  }
  const mod = await load(await read(path), new URL(path, root).href); await mod.evaluate(); return mod.namespace;
}
const cookies = { get: () => ({ value: 'session-token' }) };
const ids = { patient_id: '11111111-1111-4111-8111-111111111111', student_id: '22222222-2222-4222-8222-222222222222', subject_id: '33333333-3333-4333-8333-333333333333', academic_group_id: '44444444-4444-4444-8444-444444444444' };

test('assignment filters are sent as UUID query constraints and malformed input causes no request', async () => {
  const requests = [];
  const api = await compile('src/pods/patient-assignment/api.ts', async (url) => { requests.push(url); return Response.json({ items: [], limit: 50, offset: 0 }); });
  await api.listAssignedPatients({ limit: 50, offset: 0 }, cookies, ids);
  assert.equal(requests[0], `https://api.invalid/patient-assignments/mine?limit=50&offset=0&patient_id=${ids.patient_id}&student_id=${ids.student_id}&subject_id=${ids.subject_id}&academic_group_id=${ids.academic_group_id}`);
  for (const invalid of ['bad', '[11111111-1111-4111-8111-111111111111]', '11111111-1111-4111-8111-111111111111&patient_id=11111111-1111-4111-8111-111111111111']) {
    const params = new URLSearchParams(`patient_id=${encodeURIComponent(invalid)}`);
    assert.throws(() => api.parseAssignmentListingFilters(params));
  }
  assert.equal(requests.length, 1);
});

test('teacher eligible student selector encodes literal trimmed q and keeps habilitation selection identity', async () => {
  const requests = [];
  const api = await compile('src/pods/teacher-assignment/api.ts', async (url, init) => { requests.push([url, init]); return Response.json({ items: [], limit: 50, offset: 0 }); });
  await api.listTeacherStudents({ subject_id: ids.subject_id, academic_group_id: ids.academic_group_id, limit: 50, offset: 0, q: '  A%_\\  ' }, cookies);
  const url = new URL(requests[0][0]);
  assert.equal(url.searchParams.get('q'), 'A%_\\');
  assert.equal(url.searchParams.get('student_id'), null);
  assert.equal(requests[0][1].body, undefined);
  assert.throws(() => api.parseTeacherAssignmentFilters(new URLSearchParams('q=one&q=two')));
  assert.throws(() => api.parseTeacherAssignmentFilters(new URLSearchParams(`q=${'x'.repeat(101)}`)));
});

async function renderPage(path, query, options = {}) {
  const source = await read(path);
  let code = (await transform(source, { filename: path })).code;
  const ast = ts.createSourceFile('assignment-page.ts', code, ts.ScriptTarget.Latest, true);
  const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const page = (items, p) => ({ items, ...p });
  const context = { subject_id: ids.subject_id, subject_name: 'Subject', academic_group_id: ids.academic_group_id, academic_group_name: 'Group', academic_year: 2026, curriculum_semester: 1 };
  const row = { id: '91', patient_id: ids.patient_id, student_habilitation_id: ids.student_id, subject_id: ids.subject_id, academic_group_id: ids.academic_group_id, assigned_by: ids.student_id, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: '2026-01-01T00:00:00Z', ended_by: null, ended_at: null, end_reason: null };
  const form = new FormData(); for (const [key, value] of Object.entries(options.form ?? {})) form.set(key, value);
  const Astro = { cookies: {}, url: new URL(`https://fixture.invalid/${path.includes('my-patients') ? 'my-patients' : 'teacher-assignments'}?${query}`), response: { headers: new Headers() }, request: { clone: () => ({ formData: async () => form }) }, getActionResult: () => options.actionResult, redirect: (url) => `REDIRECT:${url}` };
  const requests = [];
  const mocks = {
    Layout: {}, Fragment: (props) => props.children, actions: { createTeacherAssignment: 'create' }, ASSIGNMENT_FILTER_KEYS: ['patient_id','student_id','subject_id','academic_group_id'], ApiError: class extends Error { constructor(status) { super('error'); this.status = status; } }, getSession: () => 'token',
    listAssignedPatients: async (p) => page(options.assignments ?? [row], p), parseAssignmentPagination: (p) => ({ limit: Number(p.get('limit') ?? 50), offset: Number(p.get('offset') ?? 0) }), parseAssignmentListingFilters: (p) => Object.fromEntries(['patient_id','student_id','subject_id','academic_group_id'].filter((k) => p.has(k)).map((k) => [k,p.get(k)])),
    parseTeacherAssignmentPagination: (p) => ({ limit: Number(p.get('limit') ?? 50), offset: Number(p.get('offset') ?? 0) }), parseTeacherAssignmentFilters: (p) => ({ q: p.get('q')?.trim() ?? '' }),
    listTeacherContexts: async (p) => page([context], p), listTeacherStudents: async (p) => { requests.push(['students', p]); return page(options.students ?? [{ student_habilitation_id: ids.student_id, student_id: ids.student_id, nombres: 'Ana', apellidos: 'Pérez' }], p); },
    listAvailablePatients: async (p) => page([{ patient_id: ids.patient_id, nombres: 'Luis', apellidos: 'Díaz' }], p),
    $$createAstro: () => ({}), $$createComponent: (c) => c, $$render: async (strings, ...values) => { let out=''; for(let i=0;i<strings.length;i++) out += strings[i] + await html(values[i]); return out; },
    $$renderComponent: async (_r,_n,_p,_s,slots) => slots?.default?.() ?? '', $$addAttribute: (v,n) => v == null || v === false ? '' : v === true ? ` ${n}` : ` ${n}="${String(v)}"`, $$maybeRenderHead: () => '', $$renderHead: () => '',
  };
  const exports = {}; const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  return { html: await html(exports.default({ createAstro: () => Astro }, {}, {})), requests };
}
async function html(value) { value = await value; if (value == null || value === false) return ''; if (Array.isArray(value)) return (await Promise.all(value.map(html))).join(''); return String(value); }

test('compiled own assignment listing renders detail path and retains filters and pagination', async () => {
  const result = await renderPage('src/pages/my-patients.astro', `limit=7&offset=14&patient_id=${ids.patient_id}&subject_id=${ids.subject_id}`);
  const href = result.html.match(/<a class="record-link[^>]* href="([^"]+)"/)?.[1];
  assert.ok(href);
  const link = new URL(href, 'https://fixture.invalid');
  assert.equal(link.pathname, '/my-patients/91');
  assert.deepEqual([...link.searchParams], [['limit','7'],['offset','14'],['patient_id',ids.patient_id],['subject_id',ids.subject_id]]);
});

test('compiled teacher listing renders editable search and retained selector coordinates; failed POST restores search and selection only when still eligible', async () => {
  const query = `context=${ids.subject_id}:${ids.academic_group_id}&current_context=${ids.subject_id}:${ids.academic_group_id}&q=Ana&limit=5&offset=10&student_limit=6&student_offset=12&patient_limit=8&patient_offset=16`;
  const result = await renderPage('src/pages/teacher-assignments.astro', query);
  assert.match(result.html, /name="q"[^>]*value="Ana"/);
  assert.match(result.html, /name="student_offset"[^>]*value="0"/);
  assert.match(result.html, /name="offset"[^>]*value="10"/);
  assert.match(result.html, /name="patient_offset"[^>]*value="16"/);
  const studentNav = result.html.match(/<nav aria-label="Paginación de estudiantes"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.match(studentNav, /q=Ana/);
  assert.match(studentNav, /student_offset=6/);
  assert.match(result.html, /name="student_habilitation_id"/);
  assert.deepEqual(result.requests[0][1], { subject_id: ids.subject_id, academic_group_id: ids.academic_group_id, limit: 6, offset: 12, q: 'Ana' });
  const failed = await renderPage('src/pages/teacher-assignments.astro', '', { actionResult: { data: { success: false, error: 'conflict' } }, form: { subject_id: ids.subject_id, academic_group_id: ids.academic_group_id, student_habilitation_id: ids.student_id, patient_id: ids.patient_id, q: 'Ana', limit: '5', offset: '10', student_limit: '6', student_offset: '12', patient_limit: '8', patient_offset: '16' }, students: [] });
  assert.match(failed.html, /name="q"[^>]*value="Ana"/);
  assert.match(failed.html, /name="student_offset"[^>]*value="0"/);
  assert.doesNotMatch(failed.html, new RegExp(`name="student_habilitation_id" value="${ids.student_id}"`));
  assert.deepEqual(failed.requests[0][1], { subject_id: ids.subject_id, academic_group_id: ids.academic_group_id, limit: 6, offset: 12, q: 'Ana' });
});

test('teacher clinical assignment filters retain selected assignment context in its downstream link', async () => {
  const page = await read('src/pages/teacher-clinical.astro');
  assert.match(page, /name="patient_id"/);
  assert.match(page, /name="student_id"/);
  assert.match(page, /name="subject_id"/);
  assert.match(page, /name="academic_group_id"/);
  assert.match(page, /assignment_id: selected!\.id/);
});
