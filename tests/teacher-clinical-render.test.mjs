import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const id = '9007199254741061';
const clinicalContext = { patient_id: patient, subject_id: subject, academic_group_id: group };
const query = new URLSearchParams(clinicalContext).toString();
const row = { id, ...clinicalContext, nombres: 'Ana', apellidos: 'Prueba', documento: 'QA' };
const evaluation = { id, ...clinicalContext, origin_subject_id: subject, origin_group_id: group, status: 'draft', patient: null, age: null, content: { admission_status: 'Estable', antecedents: { hta: false, dbt: null }, studies: [{ type: 'RX', description: 'Descripción de prueba', date: null }] } };
async function html(value) {
 value = await value;
 if (value == null || value === false) return '';
 if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
 return String(value);
}
async function render(path, options = {}) {
 const requests = [];
 const Astro = { props: options.props ?? {}, params: { id }, cookies: {}, url: new URL(`https://fixture.invalid/${path.includes('[id]') ? `teacher-clinical/${id}` : 'teacher-clinical'}?${options.query ?? query}`), request: new Request('https://fixture.invalid'), getActionResult: () => options.result, response: { headers: new Headers() }, redirect: (url) => `REDIRECT:${url}` };
 const mocks = {
  Layout: null, Fragment: null, EvaluationReadOnly: null, ApiError: class ApiError extends Error {},
  actions: { recordTeacherConsent: 'record' }, isInputError: () => false,
  teacherGrant: (_cookies, grant) => options.denied ? false : grant === 'kinesiology-evaluations:verify-consent' ? !!options.verify : true,
  parseTeacherPagination: () => ({ limit: 50, offset: options.offset ?? 0 }),
  parseClinicalContext: () => clinicalContext,
  listTeacherPatients: async () => { requests.push('assignments'); if (options.failure) throw new Error('failed'); return { items: options.empty ? [] : [row], limit: 50, offset: options.offset ?? 0 }; },
  listTeacherEvaluations: async () => { requests.push('list'); return options.emptyEvaluations ? [] : [evaluation]; },
  getTeacherEvaluation: async () => { requests.push('detail'); if (options.detailFailure) throw new Error('failed'); return evaluation; },
  getConsent: async () => { requests.push('consent'); if (options.consentFailure) throw new Error('failed'); return { evaluation_id: id, status: 'pending', evidence: null }; },
  actionHrefWithContext: (action) => action,
  $$createAstro: () => ({}), $$createComponent: (component) => component,
  $$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
  $$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => ({ ...Astro, props }) }, props, slots) : slots?.default?.() ?? '',
  $$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${value}"`,
  $$maybeRenderHead: () => '', $$renderHead: () => '',
 };
 async function compile(file) {
  let code = (await transform(await readFile(new URL(file, root), 'utf8'), { filename: file })).code;
  const ast = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true);
  const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  return exports.default;
 }
 if (!path.includes('components/')) mocks.EvaluationReadOnly = await compile('src/components/clinical/EvaluationReadOnly.astro');
 const component = await compile(path);
 return { html: await html(component({ createAstro: () => Astro }, {}, {})), requests };
}

test('teacher discovery renders selected contextual patient and all-status list without mutation controls', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}` });
 assert.deepEqual(result.requests, ['assignments', 'list']);
 assert.match(result.html, /Ana|Prueba/);
 assert.match(result.html, new RegExp(`/teacher-clinical/${id}`));
 assert.match(result.html, /subject_id=/);
 assert.doesNotMatch(result.html, /method="POST"|Crear.*borrador|Guardar borrador/);
});

test('teacher discovery distinguishes denied/error/empty and preserves Previous on empty later page', async () => {
 const denied = await render('src/pages/teacher-clinical.astro', { denied: true });
 assert.deepEqual(denied.requests, []);
 assert.match(denied.html, /permiso/);
 const failed = await render('src/pages/teacher-clinical.astro', { failure: true });
 assert.match(failed.html, /No se pudo/);
 assert.doesNotMatch(failed.html, /No hay pacientes/);
 const empty = await render('src/pages/teacher-clinical.astro', { empty: true, offset: 50 });
 assert.match(empty.html, /No hay pacientes/);
 assert.match(empty.html, />Anterior</);
 assert.doesNotMatch(empty.html, />Siguiente</);
});

test('teacher consent renders state on GET, requires separate verify grant and hides form on uncertain/read failure', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const reader = await render(path);
 assert.deepEqual(reader.requests, ['detail', 'consent']);
 assert.match(reader.html, /Pendiente/);
 assert.doesNotMatch(reader.html, /method="POST"/);
 const writer = await render(path, { verify: true });
 assert.match(writer.html, /method="POST"/);
 assert.match(writer.html, /name="paper_signature_date"/);
 assert.doesNotMatch(writer.html, /Guardar borrador|Crear.*borrador|name="verified_by"/);
 const unavailable = await render(path, { verify: true, consentFailure: true });
 assert.match(unavailable.html, /No se pudo consultar/);
 assert.doesNotMatch(unavailable.html, /method="POST"/);
 const uncertain = await render(path, { verify: true, result: { data: { success: false, uncertain: true, error: 'No se pudo confirmar el registro.' } } });
 assert.match(uncertain.html, /Consultar estado/);
 assert.doesNotMatch(uncertain.html, /method="POST"/);
 const success = await render(path, { verify: true, result: { data: { success: true } } });
 assert.match(success.html, /REDIRECT:/);
 assert.match(success.html, /recorded=1/);
});

test('confirmed consent append redirects with context before any follow-up reads can fail', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const result = await render(path, { result: { data: { success: true } }, detailFailure: true });
 assert.equal(result.html, `REDIRECT:/teacher-clinical/${id}?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&recorded=1`);
 assert.deepEqual(result.requests, []);
 assert.doesNotMatch(result.html, /<form|method="POST"|Registrar constancia/);
});

test('consent browser handler disables first submit and prevents a second click without sending itself', async () => {
 const page = await readFile(new URL('src/pages/teacher-clinical/[id].astro', root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script, 'explicit submit protection must exist');
 let handler;
 const button = { disabled: false, textContent: '' };
 const form = { dataset: {}, addEventListener: (_name, callback) => { handler = callback; }, querySelector: () => button };
 const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { document: { querySelector: () => form } });
 let prevented = 0;
 handler({ preventDefault() { prevented++; } });
 assert.equal(button.disabled, true);
 handler({ preventDefault() { prevented++; } });
 assert.equal(prevented, 1);
});

test('teacher read-only renderer shows actual clinical content, false/null antecedents and studies', async () => {
 const result = await render('src/components/clinical/EvaluationReadOnly.astro', { props: { evaluation } });
 assert.match(result.html, /Estable/);
 assert.match(result.html, /No/);
 assert.match(result.html, /Sin determinar/);
 assert.match(result.html, /RX/);
 assert.match(result.html, /Descripción de prueba/);
 assert.doesNotMatch(result.html, /<form|<input|<textarea|<button/);
});
