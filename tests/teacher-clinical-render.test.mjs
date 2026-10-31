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
const latestSubmissionId = '9007199254741063';
const clinicalContext = { patient_id: patient, subject_id: subject, academic_group_id: group };
const query = new URLSearchParams(clinicalContext).toString();
const row = { id, ...clinicalContext, nombres: 'Ana', apellidos: 'Prueba', documento: 'QA' };
const evaluation = { id, ...clinicalContext, origin_subject_id: subject, origin_group_id: group, status: 'draft', patient: null, age: null, content: { admission_status: 'Estable', antecedents: { hta: false, dbt: null }, studies: [{ type: 'RX', description: 'Descripción de prueba', date: null }] } };
const reviewSnapshot = (submissionId = latestSubmissionId, ordinal = '1', status = 'pending_validation') => ({ id: submissionId, evaluation_id: id, ordinal, submitted_by: patient, submitted_at: '2026-01-02T00:00:00Z', status, clinical_content: evaluation.content, studies: [], patient: null, age_at_admission: null, consent: { id: '5', paper_signature_date: '2026-01-01', verified_by: patient, verified_at: '2026-01-02T00:00:00Z' } });
async function html(value) {
 value = await value;
 if (value == null || value === false) return '';
 if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
 return String(value);
}
async function render(path, options = {}) {
 const requests = [];
 const Astro = { props: options.props ?? {}, params: { id }, cookies: {}, url: new URL(`https://fixture.invalid/${path.includes('[id]') ? `teacher-clinical/${id}` : 'teacher-clinical'}?${options.query ?? query}`), request: new Request('https://fixture.invalid'), getActionResult: (action) => options.results?.[action] ?? (action === 'record' ? options.result : undefined), response: { headers: new Headers() }, redirect: (url) => `REDIRECT:${url}` };
 const mocks = {
  Layout: null, Fragment: null, EvaluationReadOnly: null, ApiError: class ApiError extends Error {},
  actions: { recordTeacherConsent: 'record', validateTeacherSubmission: 'validate', requestTeacherCorrection: 'correct' }, isInputError: () => false,
  teacherGrant: (_cookies, grant) => options.denied ? false : grant === 'kinesiology-evaluations:verify-consent' ? !!options.verify : grant === 'kinesiology-evaluations:review' ? options.review !== false : true,
  parseTeacherPagination: () => ({ limit: 50, offset: options.offset ?? 0 }),
  parseClinicalContext: (params) => {
   if (options.rejectQuery || !params?.has('patient_id') || !params?.has('subject_id') || !params?.has('academic_group_id')) throw new Error('invalid query context');
   return Object.fromEntries(['patient_id', 'subject_id', 'academic_group_id'].map((key) => [key, params.get(key)]));
  },
  listTeacherPatients: async () => { requests.push('assignments'); if (options.failure) throw new Error('failed'); return { items: options.empty ? [] : [row], limit: 50, offset: options.offset ?? 0 }; },
  listTeacherEvaluations: async () => { requests.push('list'); return options.emptyEvaluations ? [] : [evaluation]; },
  getTeacherEvaluation: async () => { requests.push('detail'); if (options.detailFailure) throw new Error('failed'); return { ...evaluation, status: options.evaluationStatus ?? 'draft' }; },
  getConsent: async () => { requests.push('consent'); if (options.consentFailure) throw new Error('failed'); return { evaluation_id: id, status: 'pending', evidence: null }; },
  listTeacherSubmissions: async () => { requests.push('history'); if (options.historyFailure) throw new Error('failed'); return { evaluation_id: id, items: options.submissions ?? [] }; },
  listTeacherCorrections: async () => { requests.push('corrections'); if (options.correctionsFailure) throw new Error('failed'); return { evaluation_id: id, items: options.corrections ?? [] }; },
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
 if (!path.includes('components/')) {
  mocks.EvaluationReadOnly = await compile('src/components/clinical/EvaluationReadOnly.astro');
  mocks.SubmissionSnapshot = await compile('src/components/clinical/SubmissionSnapshot.astro');
 }
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
 assert.deepEqual(reader.requests, ['detail', 'consent', 'history', 'corrections']);
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
 const success = await render(path, { verify: true, result: { data: { success: true, id, ...clinicalContext } } });
 assert.match(success.html, /REDIRECT:/);
 assert.match(success.html, /recorded=1/);
});

test('teacher detail shows origin version history after the origin read without a second consent form', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const snapshot = { id: '9007199254741062', evaluation_id: id, ordinal: 1, submitted_by: patient, submitted_at: '2026-01-02T00:00:00Z', status: 'pending_validation', clinical_content: evaluation.content, studies: [{ type: 'RX', description: 'Informe top-level', date: null }], patient: null, age_at_admission: null, consent: { id: '5', paper_signature_date: '2026-01-01', verified_by: patient, verified_at: '2026-01-02T00:00:00Z' } };
 const reader = await render(path, { submissions: [snapshot] });
 assert.match(reader.html, /Historial de versiones/);
 assert.match(reader.html, /Versión 1 · Pendiente de validación/);
 assert.match(reader.html, /Informe top-level/);
 assert.doesNotMatch(reader.html, /method="POST"/);
 const writer = await render(path, { verify: true, submissions: [snapshot] });
 assert.equal((writer.html.match(/method="POST"/g) ?? []).length, 1);
 assert.equal((writer.html.match(/name="paper_signature_date"/g) ?? []).length, 1);
 assert.match((await render(path)).html, /No hay versiones enviadas para esta ficha/);
});

test('teacher review controls target only the latest submitted version and disappear on failed or empty history', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const history = ['9007199254741062', latestSubmissionId].map((submissionId, index) => reviewSnapshot(submissionId, String(index + 1)));
 const latestSubmission = history.at(-1);
 const snapshot = latestSubmission;
 const active = await render(path, { review: true, evaluationStatus: 'submitted', submissions: history });
 assert.equal((active.html.match(/name="submission_id"/g) ?? []).length, 2);
 assert.match(active.html, /name="reason"/);
 assert.equal((active.html.match(new RegExp(`name="submission_id" value="${latestSubmission.id}"`, 'g')) ?? []).length, 2);
 assert.doesNotMatch(active.html, new RegExp(`name="submission_id" value="${history[0].id}"`));
 const empty = await render(path, { review: true, evaluationStatus: 'submitted', submissions: [] });
 assert.doesNotMatch(empty.html, /name="submission_id"/);
 const failed = await render(path, { review: true, evaluationStatus: 'submitted', historyFailure: true });
 assert.match(failed.html, /No se pudo cargar el historial/);
 assert.doesNotMatch(failed.html, /name="submission_id"/);
 const denied = await render(path, { review: false, evaluationStatus: 'submitted', submissions: [snapshot] });
 assert.doesNotMatch(denied.html, /name="submission_id"/);
 const draft = await render(path, { review: true, evaluationStatus: 'draft', submissions: [snapshot] });
 const validated = await render(path, { review: true, evaluationStatus: 'validated', submissions: [snapshot] });
 assert.doesNotMatch(draft.html, /name="submission_id"/);
 assert.doesNotMatch(validated.html, /name="submission_id"/);
 const uncertain = await render(path, { review: true, evaluationStatus: 'submitted', submissions: [snapshot], results: { validate: { data: { success: false, uncertain: true, error: 'uncertain' } } } });
 assert.match(uncertain.html, /Consultá el estado de la ficha antes de decidir si corresponde otra revisión\./);
 assert.doesNotMatch(uncertain.html, /name="submission_id"/);
});

test('confirmed teacher reviews redirect with nested action-validated context before follow-up reads', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 for (const [action, outcome] of [['validate', 'validated'], ['correct', 'corrections-requested']]) {
  for (const queryValue of ['', `patient_id=${group}&subject_id=${patient}&academic_group_id=${subject}`]) {
   const result = await render(path, { query: queryValue, rejectQuery: true, detailFailure: true, results: { [action]: { data: { success: true, id, context: clinicalContext, outcome } } } });
   assert.equal(result.html, `REDIRECT:/teacher-clinical/${id}?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&reviewed=${outcome}`);
   assert.deepEqual(result.requests, []);
  }
 }
});

test('teacher history failure shows its own error while the origin record and consent state still render', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const failed = await render(path, { verify: true, historyFailure: true });
 assert.match(failed.html, /No se pudo cargar el historial de versiones/);
 assert.match(failed.html, /Estable/);
 assert.match(failed.html, /Pendiente/);
 assert.match(failed.html, /method="POST"/);
 assert.doesNotMatch(failed.html, /No hay versiones enviadas/);
 assert.deepEqual((await render(path, { denied: true, historyFailure: true })).requests, []);
 assert.deepEqual((await render(path, { detailFailure: true, historyFailure: true })).requests, ['detail']);
});

test('confirmed consent append redirects with context before any follow-up reads can fail', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const result = await render(path, { result: { data: { success: true, id, ...clinicalContext } }, detailFailure: true });
 assert.equal(result.html, `REDIRECT:/teacher-clinical/${id}?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&recorded=1`);
 assert.deepEqual(result.requests, []);
 assert.doesNotMatch(result.html, /<form|method="POST"|Registrar constancia/);
});

test('confirmed append redirects from validated action context despite missing, malformed, or different query context', async () => {
 const path = 'src/pages/teacher-clinical/[id].astro';
 const actionContext = { patient_id: patient, subject_id: subject, academic_group_id: group };
 const confirmedId = '9007199254741099';
 for (const queryValue of ['', 'patient_id=bad&subject_id=bad&academic_group_id=bad', `patient_id=${group}&subject_id=${patient}&academic_group_id=${subject}`]) {
  const result = await render(path, { query: queryValue, rejectQuery: true, result: { data: { success: true, id: confirmedId, ...actionContext } }, detailFailure: true });
  assert.equal(result.html, `REDIRECT:/teacher-clinical/${confirmedId}?patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&recorded=1`);
  assert.deepEqual(result.requests, []);
 }
});

test('consent browser handler disables first submit and prevents a second click without sending itself', async () => {
 const page = await readFile(new URL('src/pages/teacher-clinical/[id].astro', root), 'utf8');
 const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script, 'explicit submit protection must exist');
 let handler;
 const button = { disabled: false, textContent: '' };
 const form = { dataset: {}, addEventListener: (_name, callback) => { handler = callback; }, querySelector: () => button };
 const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { document: { querySelector: () => form, querySelectorAll: () => [] } });
 let prevented = 0;
 handler({ preventDefault() { prevented++; } });
 assert.equal(button.disabled, true);
 handler({ preventDefault() { prevented++; } });
 assert.equal(prevented, 1);
});

test('shared submission snapshot renders one version read-only with top-level studies, consent evidence and no form controls', async () => {
 const submission = { id: '9007199254741062', evaluation_id: id, ordinal: 2, submitted_by: patient, submitted_at: '2026-02-01T10:00:00Z', status: 'validated', clinical_content: { admission_status: 'Estable', antecedents: { hta: true, dbt: null }, studies: [{ type: 'Merge sentinel', description: 'Solo contenido', date: null }] }, studies: [{ type: 'RX', description: 'Informe top-level', date: '2026-01-15' }], patient: { id: patient, documento: 'QA-1', nombres: 'Ana', apellidos: 'Prueba', fecha_nacimiento: '1990-01-01', email: 'a@example.test', celular: '1', sexo: 'F', direccion: 'x' }, age_at_admission: 36, consent: { id: '5', paper_signature_date: '2026-01-10', verified_by: patient, verified_at: '2026-01-11T09:00:00Z' } };
 const result = await render('src/components/clinical/SubmissionSnapshot.astro', { props: { submission } });
 assert.match(result.html, /Versión 2/);
 assert.match(result.html, /Validada/);
 assert.match(result.html, /2026-02-01T10:00:00Z/);
 assert.match(result.html, /Prueba, Ana · Documento: QA-1/);
 assert.match(result.html, /Edad al ingreso: 36/);
 assert.match(result.html, /Estable/);
 assert.match(result.html, /Sin determinar/);
 assert.match(result.html, /Informe top-level/);
 assert.doesNotMatch(result.html, /Merge sentinel/);
 assert.match(result.html, /Fecha de firma en papel/);
 assert.match(result.html, /2026-01-10/);
 assert.match(result.html, /2026-01-11T09:00:00Z/);
 assert.doesNotMatch(result.html, /<form|<input|<textarea|<select|<button|paper_signature_date/);
 const pending = await render('src/components/clinical/SubmissionSnapshot.astro', { props: { submission: { ...submission, ordinal: 1, status: 'pending_validation', patient: null, age_at_admission: null, studies: [] } } });
 assert.match(pending.html, /Pendiente de validación/);
 assert.match(pending.html, /Datos del paciente no disponibles/);
 assert.match(pending.html, /Sin estudios registrados/);
 assert.doesNotMatch(pending.html, /Edad al ingreso/);
});

test('origin history annotates only the corrected version without changing immutable snapshot status or adding controls', async () => {
 const snapshot = { id: '9007199254741062', evaluation_id: id, ordinal: '9007199254741063', submitted_at: '2026-01-02T00:00:00Z', status: 'pending_validation', clinical_content: {}, studies: [], patient: null, age_at_admission: null, consent: {} };
 const reason = { submission_id: snapshot.id, reason: 'Revisar diagnóstico', reviewed_by: patient, requested_at: '2026-02-01T00:00:00Z' };
 const rendered = await render('src/pages/teacher-clinical/[id].astro', { submissions: [snapshot, { ...snapshot, id: '9007199254741064', ordinal: '9007199254741064' }], corrections: [reason] });
 assert.equal((rendered.html.match(/Revisar diagnóstico/g) ?? []).length, 1);
 assert.match(rendered.html, /Corrección solicitada/);
 assert.match(rendered.html, /2026-02-01T00:00:00Z/);
 assert.match(rendered.html, new RegExp(patient));
 assert.equal((rendered.html.match(/Pendiente de validación/g) ?? []).length, 2);
 assert.doesNotMatch(rendered.html, /<form|<button/);
 const failed = await render('src/pages/teacher-clinical/[id].astro', { submissions: [snapshot], correctionsFailure: true });
 assert.match(failed.html, /No se pudieron cargar los motivos de corrección/);
 assert.match(failed.html, /Versión 9007199254741063/);
 assert.doesNotMatch(failed.html, /Corrección solicitada/);
 assert.deepEqual((await render('src/pages/teacher-clinical/[id].astro', { detailFailure: true })).requests, ['detail']);
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
