import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/patient-availability.astro';
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const ids = {
  patient: '11111111-1111-4111-8111-111111111111',
  firstSubject: '22222222-2222-4222-8222-222222222222',
  pageTwoSubject: '66666666-6666-4666-8666-666666666666',
};

async function render(query) {
  let code = (await transform(await readFile(new URL(pagePath, root), 'utf8'), { filename: pagePath })).code;
  const ast = ts.createSourceFile('patient-availability-render.ts', code, ts.ScriptTarget.Latest, true);
  const removals = ast.statements
    .filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
    .map((statement) => [statement.getFullStart(), statement.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);

  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  async function html(value) {
    value = await value;
    if (value == null || value === false) return '';
    if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
    return String(value);
  }
  const page = (items, pagination) => ({ items, ...pagination });
  const Astro = {
    cookies: {}, url: new URL(`https://fixture.invalid/patient-availability?${query}`),
    response: { headers: new Headers() }, getActionResult: () => undefined,
    redirect: (url) => ({ redirect: url }),
  };
  const mocks = {
    actions: { searchAvailablePatient: 'search', enablePatientAvailability: 'enable', withdrawPatientAvailability: 'withdraw' },
    Layout: {}, isInputError: () => false, ApiError: class extends Error {},
    getSession: () => 'synthetic-token', decodeJwt: () => ({ role: 'admin' }),
    UUID_PATTERN: /^[a-f0-9-]{36}$/i,
    parseSelectedPatientId: (params) => params.get('patient_id'),
    parseAvailabilityPagination: (params) => ({ limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
    listSubjects: async (pagination) => page([
      { id: ids.firstSubject, name: 'First subject' },
      { id: ids.pageTwoSubject, name: 'Page two subject' },
    ], pagination),
    listGroups: async (pagination) => page([], pagination),
    listLinks: async (_subjectId, pagination) => page([], pagination),
    listHistory: async (_patientId, pagination) => page([], pagination),
    $$createAstro: () => ({}), $$createComponent: (component) => component,
    $$render: async (strings, ...values) => {
      let output = '';
      for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]);
      return output;
    },
    $$renderComponent: async (_result, _name, _component, _props, slots) => slots?.default ? slots.default() : '',
    $$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${escape(value)}"`,
    $$maybeRenderHead: () => '', $$renderHead: () => '',
  };
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  return html(exports.default({ createAstro: () => Astro }, {}, {}));
}

function getSubjectForm(html) {
  return html.match(/<form method="GET" action="\/patient-availability"[^>]*>[\s\S]*?<\/form>/)?.[0] ?? '';
}

function submitNativeGet(form, selectedSubject) {
  const params = new URLSearchParams();
  for (const match of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"[^>]*>/g)) params.append(match[1], match[2]);
  params.set('subject_id', selectedSubject);
  for (const [name, value] of params) assert.notEqual(name, 'documento');
  return params;
}

test('rendered page-two subject form retains independent query coordinates through native GET', async () => {
  const coordinates = {
    patient_id: ids.patient, current_subject_id: ids.pageTwoSubject, subject_id: ids.pageTwoSubject,
    history_limit: '10', history_offset: '20', subject_limit: '10', subject_offset: '10',
    link_limit: '10', link_offset: '30', group_limit: '10', group_offset: '40',
  };
  const initial = new URLSearchParams(coordinates);
  const first = await render(initial);
  const form = getSubjectForm(first);
  assert.ok(form, 'the compiled Astro page renders its native subject GET form');
  assert.match(form, new RegExp(`<option value="${ids.pageTwoSubject}" selected(?: [^>]*)?>Page two subject</option>`));

  const submitted = submitNativeGet(form, ids.pageTwoSubject);
  assert.deepEqual(Object.fromEntries(submitted), coordinates);
  assert.equal(submitted.has('documento'), false);
  const next = await render(submitted);
  const nextForm = getSubjectForm(next);
  assert.match(nextForm, new RegExp(`<option value="${ids.pageTwoSubject}" selected(?: [^>]*)?>Page two subject</option>`));
  assert.equal(submitted.has('documento'), false);
});

test('changing subject resets only link paging and preserves unrelated rendered GET coordinates', async () => {
  const initial = new URLSearchParams({
    patient_id: ids.patient, current_subject_id: ids.pageTwoSubject, subject_id: ids.pageTwoSubject,
    history_limit: '10', history_offset: '20', subject_limit: '10', subject_offset: '10',
    link_limit: '10', link_offset: '30', group_limit: '10', group_offset: '40',
  });
  const form = getSubjectForm(await render(initial));
  const submitted = submitNativeGet(form, ids.firstSubject);
  const next = new URLSearchParams(await render(submitted).then((html) => {
    const nextForm = getSubjectForm(html);
    const nextFormParams = submitNativeGet(nextForm, ids.firstSubject);
    return nextFormParams;
  }));
  assert.equal(next.get('patient_id'), ids.patient);
  assert.equal(next.get('subject_id'), ids.firstSubject);
  assert.equal(next.get('history_offset'), '20');
  assert.equal(next.get('subject_offset'), '10');
  assert.equal(next.get('group_offset'), '40');
  assert.equal(next.get('link_offset'), '0');
  assert.equal(next.has('documento'), false);
});
