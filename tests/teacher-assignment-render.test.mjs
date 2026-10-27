import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const patient = '11111111-1111-4111-8111-111111111111';

async function html(value) {
 value = await value;
 if (value == null || value === false) return '';
 if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
 return String(value);
}

async function render(query, options = {}) {
 const path = 'src/pages/teacher-assignments.astro';
 let code = (await transform(await readFile(new URL(path, root), 'utf8'), { filename: path })).code;
 const ast = ts.createSourceFile('teacher-assignments.ts', code, ts.ScriptTarget.Latest, true);
 const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement)
  || statement.getText(ast).startsWith('export const $$metadata')).map((statement) => [statement.getFullStart(), statement.getEnd()]);
 for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
 const page = (items, pagination) => ({ items, ...pagination });
 const contextItem = { subject_id: subject, subject_name: 'Subject', academic_group_id: group, academic_group_name: 'Group', academic_year: 2026, curriculum_semester: 1 };
 const requests = [];
 const Astro = { cookies: {}, url: new URL(`https://fixture.invalid/teacher-assignments?${query}`), response: { headers: new Headers() }, getActionResult: () => undefined, redirect: (url) => ({ redirect: url }) };
 const mocks = {
  actions: { createTeacherAssignment: 'create' }, Layout: {}, Fragment: (props) => props.children, ApiError: class ApiError extends Error { constructor(status) { super('error'); this.status = status; } },
  getSession: () => 'token', parseTeacherAssignmentPagination: (params) => ({ limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
  listTeacherContexts: async (pagination) => { requests.push('contexts'); return page(options.emptyContexts ? [] : [contextItem], pagination); },
  listTeacherStudents: async (pagination) => { requests.push('students'); return page(options.emptyStudents ? [] : [{ student_habilitation_id: patient, student_id: patient, nombres: 'Ana', apellidos: 'Pérez' }], pagination); },
  listAvailablePatients: async (pagination) => { requests.push('patients'); return page(options.emptyPatients ? [] : [{ patient_id: patient, nombres: 'Luis', apellidos: 'Díaz' }], pagination); },
  $$createAstro: () => ({}), $$createComponent: (component) => component,
  $$render: async (strings, ...values) => { let output = ''; for (let index = 0; index < strings.length; index++) output += strings[index] + await html(values[index]); return output; },
  $$renderComponent: async (_result, _name, _props, _slots, slots) => slots?.default ? slots.default() : '',
  $$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${value}"`,
  $$maybeRenderHead: () => '', $$renderHead: () => '',
 };
 const exports = {};
 const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
 const rendered = await html(exports.default({ createAstro: () => Astro }, {}, {}));
 return { html: rendered, requests };
}

const contextQuery = `context=${subject}:${group}&current_context=${subject}:${group}`;

test('compiled teacher page renders bounded Previous navigation for empty selector pages', async () => {
 for (const [query, empty, label] of [
  ['offset=50', { emptyContexts: true }, 'Paginación de contextos'],
  [`${contextQuery}&student_offset=50`, { emptyStudents: true }, 'Paginación de estudiantes'],
  [`${contextQuery}&patient_offset=50`, { emptyPatients: true }, 'Paginación de pacientes'],
 ]) {
  const { html } = await render(query, empty);
  const nav = html.match(new RegExp(`<nav aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`))?.[1] ?? '';
  assert.match(nav, />Anterior</, `${label} must render Previous for a successful empty page at offset 50`);
  assert.doesNotMatch(nav, />Siguiente</, `${label} must not render Next for an empty page`);
  assert.match(html, /No hay (?:contextos docentes activos disponibles|estudiantes habilitados en este contexto|pacientes disponibles en este contexto)\./);
 }
});

test('compiled teacher page omits Previous at offset zero and never enables empty create', async () => {
 for (const [query, empty, label] of [
  ['offset=0', { emptyContexts: true }, 'Paginación de contextos'],
  [`${contextQuery}&student_offset=0`, { emptyStudents: true }, 'Paginación de estudiantes'],
  [`${contextQuery}&patient_offset=0`, { emptyPatients: true }, 'Paginación de pacientes'],
 ]) {
  const { html } = await render(query, empty);
  const nav = html.match(new RegExp(`<nav aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`))?.[1] ?? '';
  assert.doesNotMatch(nav, />Anterior</);
  assert.doesNotMatch(nav, />Siguiente</);
  assert.match(html, /No hay (?:contextos docentes activos disponibles|estudiantes habilitados en este contexto|pacientes disponibles en este contexto)\./);
  if (!empty.emptyContexts) assert.match(html, /<button type="submit" disabled[^>]*>Crear asignación<\/button>/);
  assert.equal(html.includes('name="patient_id"') && html.includes('name="student_habilitation_id"'), false);
 }
});
