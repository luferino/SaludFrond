import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '33333333-3333-4333-8333-333333333333';
const group = '44444444-4444-4444-8444-444444444444';

async function renderAssignmentDetail(query, rows, records = []) {
  const path = 'src/pages/my-patients/[assignmentId].astro';
  let code = (await transform(await read(path), { filename: path })).code;
  const ast = ts.createSourceFile('page.ts', code, ts.ScriptTarget.Latest, true);
  const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const requests = [];
  const row = { id: '91', patient_id: patient, student_habilitation_id: patient, subject_id: subject, academic_group_id: group, assigned_by: patient, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: '2026-01-01T00:00:00Z', ended_by: null, ended_at: null, end_reason: null };
  const Astro = { params: { assignmentId: '91' }, cookies: { get: () => undefined }, url: new URL(`https://fixture.invalid/my-patients/91?${query}`), response: { headers: new Headers() }, getActionResult: () => undefined, redirect: (url) => `REDIRECT:${url}` };
  const actions = { createKinesiologyEvaluation: 'create', createOralSurgeryDraft: 'oral-create' };
  const evolution = await (await loadRegisteredActions(async () => Response.json({}))).importModule('src/pods/kinesiology-evolution/listing.ts');
  const mocks = {
    parseEvolutionListFilters: evolution.parseEvolutionListFilters,
    listKinesiologyEvolutions: async () => [],
    Layout: {}, Fragment: (props) => props.children, actions, ApiError: class extends Error {}, decodeJwt: () => null,
    listAssignedPatients: async (pagination, _cookies, filters) => { requests.push({ pagination, filters }); return { items: rows ?? [row], ...pagination }; },
    parseAssignmentListCoordinates: (params) => {
      const filters = {};
      for (const key of ['patient_id','student_id','subject_id','academic_group_id']) {
        const values = params.getAll(key);
        const malformed = [...params.keys()].some((name) => name.startsWith(`${key}[`) || name.startsWith(`${key}.`));
        if (values.length > 1 || malformed || values.some((value) => !/^[0-9a-f-]{36}$/i.test(value))) throw new Error('invalid');
        if (values.length) filters[key] = values[0];
      }
      const key = (name) => params.getAll(name);
      const limitName = params.has('list_limit') ? 'list_limit' : 'limit';
      const offsetName = params.has('list_offset') ? 'list_offset' : 'offset';
      for (const name of [limitName, offsetName]) if (key(name).length > 1 || (name === 'list_limit' && params.has('list_limit[x]')) || (name === 'list_offset' && params.has('list_offset[x]'))) throw new Error('invalid');
      return { filters, limit: Number(params.get(limitName) ?? 50), offset: Number(params.get(offsetName) ?? 0) };
    },
    assignmentListCarrier: (coordinates) => Object.fromEntries([['list_limit',String(coordinates.limit)],['list_offset',String(coordinates.offset)], ...Object.entries(coordinates.filters).map(([k,v])=>[`list_${k}`,v])]),
    assignmentListQuery: (coordinates) => new URLSearchParams({ limit: String(coordinates.limit), offset: String(coordinates.offset), ...coordinates.filters }).toString(),
    parseAssignmentPagination: (params) => ({ limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
    actionHrefWithContext: (path, context) => `${path}?${new URLSearchParams(context)}`,
    EVALUATION_STATUS_LABELS: {}, listEvaluations: async () => records, listSubmittedEvaluations: async () => [], listOralSurgeryDrafts: async () => [],
    isOralSurgeryContext: () => false, listOralSurgeryContexts: async () => ({ items: [] }),
    $$createAstro: () => ({}), $$createComponent: (c) => c,
    $$render: async (strings, ...values) => { let out = ''; for (let i = 0; i < strings.length; i++) out += strings[i] + await html(values[i]); return out; },
    $$renderComponent: async (_r, _n, _p, _s, slots) => slots?.default?.() ?? '',
    $$addAttribute: (v, n) => v == null || v === false ? '' : v === true ? ` ${n}` : ` ${n}="${String(v)}"`,
    $$maybeRenderHead: () => '', $$renderHead: () => '',
  };
  const exports = {};
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  return { html: await html(exports.default({ createAstro: () => Astro }, {}, {})), requests };
}
async function html(value) { value = await value; if (value == null || value === false) return ''; if (Array.isArray(value)) return (await Promise.all(value.map(html))).join(''); return String(value); }

test('coordinate helper accepts only canonical unique filter keys in list and action namespaces', async () => {
  const source = await read('src/pods/patient-assignment/list-coordinates.ts');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', output)(exports);
  const valid = new URLSearchParams(`list_limit=7&list_offset=14&list_patient_id=${patient}&list_subject_id=${subject}`);
  assert.deepEqual(exports.parseAssignmentListCoordinates(valid, true), { limit: 7, offset: 14, filters: { patient_id: patient, subject_id: subject } });
  for (const query of [`list_patient_id=${patient}&list_patient_id=${patient}`, `list_patient_id%5Bx%5D=${patient}`, `list_patient_id.foo=${patient}`, `list_unknown=x`]) {
    assert.throws(() => exports.parseAssignmentListCoordinates(new URLSearchParams(query), true));
  }
  assert.throws(() => exports.parseAssignmentActionCoordinates({ ...Object.fromEntries(valid), 'list_subject_id[x]': subject }));
});

test('filtered list coordinates survive assignment selection and missing selection never broadens lookup', async () => {
  const query = `limit=7&offset=14&patient_id=${patient}&subject_id=${subject}`;
  const selected = await renderAssignmentDetail(query, undefined, [{ id: '600', status: 'draft', updated_at: '2026-01-01T00:00:00Z' }]);
  assert.deepEqual(selected.requests[0].filters, { patient_id: patient, subject_id: subject });
  assert.deepEqual(selected.requests[0].pagination, { limit: 7, offset: 14 });
  assert.match(selected.html, /name="assignment_id" value="91"/);
  const editorHref = selected.html.match(/<a href="([^"]+)"[^>]*>\s*Abrir borrador de ficha/)?.[1];
  assert.ok(editorHref);
  const editorUrl = new URL(editorHref, 'https://fixture.invalid');
  assert.equal(editorUrl.pathname, '/kinesiology-evaluations/600');
  assert.deepEqual([...editorUrl.searchParams], [['assignment_id','91'],['list_limit','7'],['list_offset','14'],['list_patient_id',patient],['list_subject_id',subject]]);
  assert.match(selected.html, /name="list_patient_id" value="11111111-1111-4111-8111-111111111111"/);
  const missing = await renderAssignmentDetail(query, []);
  assert.deepEqual(missing.requests[0].filters, { patient_id: patient, subject_id: subject });
  assert.match(missing.html, /Asignación no disponible/);
  assert.doesNotMatch(missing.html, /Crear nuevo borrador/);
});

test('malformed duplicate filter state is rejected before assignment or clinical requests', async () => {
  for (const query of [`patient_id=${patient}&patient_id=${patient}`, `patient_id%5Bx%5D=${patient}`]) {
    const result = await renderAssignmentDetail(query);
    assert.equal(result.requests.length, 0);
    assert.match(result.html, /No se pudieron cargar las asignaciones/);
  }
});
