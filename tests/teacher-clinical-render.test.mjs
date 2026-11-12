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
const otherGroup = '44444444-4444-4444-8444-444444444444';
const id = '9007199254741061';
const latestSubmissionId = '9007199254741063';
const oralDraft = (overrides = {}) => ({ id: '9007199254741070', clinical_record_id: '9007199254741069', patient_id: patient, author_id: patient, origin_student_habilitation_id: '99999999-8888-4777-8666-555555555555', origin_subject_id: subject, origin_group_id: group, content: {}, status: 'draft', version: '4', created_at: '2026-11-06T12:00:00Z', updated_at: '2026-11-06T12:00:00Z', ...overrides });
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
 const oralListings = [];
 const clinicalCalls = [];
 const Astro = { props: options.props ?? {}, params: { id }, cookies: {}, url: new URL(`https://fixture.invalid/${path.includes('[id]') ? `teacher-clinical/${id}` : 'teacher-clinical'}?${options.query ?? query}`), request: new Request('https://fixture.invalid'), getActionResult: (action) => options.results?.[action] ?? (action === 'record' ? options.result : undefined), response: { headers: new Headers() }, redirect: (url) => `REDIRECT:${url}` };
 const mocks = {
  Layout: null, Fragment: null, EvaluationReadOnly: null, ApiError: class ApiError extends Error { constructor(status) { super('api'); this.status = status; } },
  actions: { recordTeacherConsent: 'record', validateTeacherSubmission: 'validate', requestTeacherCorrection: 'correct' }, isInputError: () => false,
  teacherGrant: (_cookies, grant) => options.denied ? false : grant === 'kinesiology-evaluations:verify-consent' ? !!options.verify : grant === 'kinesiology-evaluations:review' ? options.review !== false : grant === 'oral-surgery-drafts:read' ? !!options.oralSurgeryRead : grant === 'kinesiology-evolutions:read' ? !!options.evolutions : true,
  parseTeacherPagination: (params) => ({ limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? options.offset ?? 0) }),
   parseTeacherAssignmentFilters: (params) => Object.fromEntries(['patient_id','student_id','subject_id','academic_group_id'].filter((key) => params.has(key)).map((key) => [key,params.get(key)])),
  parseAssignmentListCoordinates: (params, namespaced = false) => { const prefix = namespaced ? 'list_' : ''; const filters = Object.fromEntries(['patient_id','student_id','subject_id','academic_group_id'].filter((key) => params.has(`${prefix}${key}`)).map((key) => [key,params.get(`${prefix}${key}`)])); return { filters, limit: Number(params.get(namespaced && params.has('list_limit') ? 'list_limit' : 'limit') ?? 50), offset: Number(params.get(namespaced && params.has('list_offset') ? 'list_offset' : 'offset') ?? 0) }; },
  assignmentListCarrier: (coordinates) => Object.fromEntries([['list_limit',String(coordinates.limit)],['list_offset',String(coordinates.offset)], ...Object.entries(coordinates.filters).map(([key,value])=>[`list_${key}`,value])]),
  assignmentListQuery: (coordinates) => new URLSearchParams({limit:String(coordinates.limit),offset:String(coordinates.offset),...coordinates.filters}).toString(),
  parseEvolutionListFilters: (params) => {
   if (params.has('evaluation_id') && !/^[1-9]\d*$/.test(params.get('evaluation_id'))) throw new Error('El filtro de evaluación no es válido.');
   return Object.fromEntries(['status','date_from','date_to','evaluation_id'].filter((key) => params.has(key) && params.get(key)).map((key) => [key,params.get(key)]));
  },
  parseClinicalContext: (params) => {
   if (options.rejectQuery || !params?.has('patient_id') || !params?.has('subject_id') || !params?.has('academic_group_id')) throw new Error('invalid query context');
   return Object.fromEntries(['patient_id', 'subject_id', 'academic_group_id'].map((key) => [key, params.get(key)]));
  },
  listTeacherPatients: async () => { requests.push('assignments'); if (options.failure) throw new Error('failed'); return { items: options.empty ? [] : [row], limit: 50, offset: options.offset ?? 0 }; },
  listTeacherEvaluations: async (context, _cookies, filters) => { requests.push('list'); clinicalCalls.push({ context, filters }); return options.emptyEvaluations ? [] : [evaluation]; },
  listKinesiologyEvolutions: async (context, _cookies, filters) => { requests.push('evolutions'); clinicalCalls.push({ context, filters, evolution: true }); if (options.evolutionsStatus) throw new mocks.ApiError(options.evolutionsStatus); if (options.evolutionsFailure) throw new Error('offline'); return []; },
  listOralSurgeryContexts: async () => { requests.push('discovery'); if (options.discoveryStatus) throw new mocks.ApiError(options.discoveryStatus); if (options.discoveryFailure) throw new Error('offline'); if (options.forbidden) return { status: 'forbidden' }; return { status: 'ok', items: options.contexts ?? [] }; },
  isOralSurgeryContext: (contexts, subjectId, groupId) => contexts.some((item) => item.subject_id === subjectId && item.academic_group_id === groupId),
  listOralSurgeryDrafts: async (context, _cookies, page) => { requests.push('oral-list'); oralListings.push({ context, page }); return options.oralDrafts ?? []; },
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
 return { html: await html(component({ createAstro: () => Astro }, {}, {})), requests, oralListings, clinicalCalls };
}

test('teacher discovery renders selected contextual patient and all-status list without mutation controls', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}&patient_id=${patient}&student_id=${group}&subject_id=${subject}&academic_group_id=${group}&limit=7&offset=14` });
 assert.deepEqual(result.requests, ['assignments', 'list']);
 assert.match(result.html, /Ana|Prueba/);
 const href = result.html.match(new RegExp(`href="([^"]*teacher-clinical/${id}[^\"]*)"[^>]*>`))?.[1];
 assert.ok(href);
 const editor = new URL(href, 'https://fixture.invalid');
 assert.equal(editor.pathname, `/teacher-clinical/${id}`);
 assert.equal(editor.searchParams.get('patient_id'), patient);
 assert.equal(editor.searchParams.get('list_patient_id'), patient);
 assert.equal(editor.searchParams.get('list_student_id'), group);
 assert.equal(editor.searchParams.get('list_limit'), '7');
 assert.equal(editor.searchParams.get('list_offset'), '14');
 assert.doesNotMatch(result.html, /method="POST"|Crear.*borrador|Guardar borrador/);
});

test('compiled teacher HTML renders selected-context GET filters and forwards only that context and filters', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { evolutions: true, query: `assignment_id=${id}&patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&limit=7&offset=14&status=validated&date_from=0001-01-01&date_to=9999-12-31&evaluation_id=9223372036854775807` });
 assert.match(result.html, /<form method="GET" class="clinical-filters[^\"]*" aria-label="Filtrar listas clínicas"/);
 for (const control of ['name="status"', 'name="date_from"', 'name="date_to"', 'name="evaluation_id"']) assert.match(result.html, new RegExp(control));
 assert.deepEqual(result.clinicalCalls[0], { context: clinicalContext, filters: { status: 'validated', date_from: '0001-01-01', date_to: '9999-12-31' } });
 assert.deepEqual(result.clinicalCalls[1], { context: clinicalContext, filters: { status: 'validated', date_from: '0001-01-01', date_to: '9999-12-31', evaluation_id: '9223372036854775807' }, evolution: true });
 const form = result.html.match(/<form method="GET" class="clinical-filters[^\"]*" aria-label="Filtrar listas clínicas"[\s\S]*?<\/form>/)?.[0];
 assert.ok(form);
 assert.match(form, new RegExp(`name="assignment_id" value="${id}"`));
 assert.match(form, /name="limit" value="7"/);
 assert.match(form, /name="offset" value="14"/);
 assert.doesNotMatch(form, /method="POST"/);
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

test('teacher clinical return link restores validated list filters and page while keeping origin context separate', async () => {
 const listState = `patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}&assignment_id=${id}&list_limit=7&list_offset=14&list_patient_id=${patient}&list_student_id=${group}`;
 const detail = await render('src/pages/teacher-clinical/[id].astro', { query: listState });
 const href = detail.html.match(/<a href="([^"]*teacher-clinical\?[^\"]*)"[^>]*>Volver al acceso clínico docente<\/a>/)?.[1];
 assert.ok(href);
 const back = new URL(href, 'https://fixture.invalid');
 assert.equal(back.pathname, '/teacher-clinical');
 assert.equal(back.searchParams.get('patient_id'), patient);
 assert.equal(back.searchParams.get('student_id'), group);
 assert.equal(back.searchParams.get('limit'), '7');
 assert.equal(back.searchParams.get('offset'), '14');
 assert.equal(back.searchParams.get('assignment_id'), id);
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

// Oral Surgery I discovery branch (D12): only with the oral-surgery read grant and a selected assignment.
test('teacher discovery with an enabled pair lists Oral Surgery drafts instead of Kinesiology records', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, contexts: [{ subject_id: subject, academic_group_id: group }], oralDrafts: [oralDraft()] });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'oral-list']);
 assert.deepEqual(result.oralListings, [{ context: { patient_id: patient, subject_id: subject, academic_group_id: group }, page: { limit: 50, offset: 0 } }]);
 assert.match(result.html, /Abrir borrador de Cirugía Oral I · versión 4/);
 assert.match(result.html, /\/teacher-clinical\/oral-surgery\/9007199254741070\?patient_id=/);
 assert.match(result.html, new RegExp(`subject_id=${subject}`));
 assert.match(result.html, new RegExp(`academic_group_id=${group}`));
 assert.doesNotMatch(result.html, /Abrir ficha|\/teacher-clinical\/9007199254741061\?|Fichas de/);
});

test('teacher Oral Surgery list shows the 50-row notice only when the page is full', async () => {
 const full = Array.from({ length: 50 }, (_, index) => oralDraft({ id: String(9007199254741100n + BigInt(index)) }));
 assert.match((await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, contexts: [{ subject_id: subject, academic_group_id: group }], oralDrafts: full })).html, /Se muestran los 50 borradores más recientes\./);
 assert.doesNotMatch((await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, contexts: [{ subject_id: subject, academic_group_id: group }], oralDrafts: full.slice(0, 49) })).html, /Se muestran los 50 borradores más recientes\./);
});

test('teacher without the oral-surgery read grant makes no discovery request and keeps the Kinesiology list', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}` });
 assert.deepEqual(result.requests, ['assignments', 'list']);
 assert.match(result.html, /Abrir ficha · Borrador/);
 assert.doesNotMatch(result.html, /Cirugía Oral I/);
});

test('teacher discovery with no matching pair keeps the Kinesiology list and no Oral Surgery list request', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, contexts: [{ subject_id: subject, academic_group_id: otherGroup }] });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'list']);
 assert.match(result.html, /Abrir ficha · Borrador/);
 assert.doesNotMatch(result.html, /Cirugía Oral I|oral-surgery|No tenés permiso/);
});

test('teacher forbidden discovery shows the permission notice and keeps the Kinesiology list unchanged', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, forbidden: true });
 assert.deepEqual(result.requests, ['assignments', 'discovery', 'list']);
 assert.deepEqual(result.oralListings, []);
 assert.match(result.html, /No tenés permiso para consultar si este contexto usa Cirugía Oral I\. No se muestran acciones de Cirugía Oral\./);
 assert.match(result.html, /Abrir ficha · Borrador/);
 assert.doesNotMatch(result.html, /Abrir borrador de Cirugía Oral I|Borradores de Cirugía Oral I|oral-surgery\//);
});

test('teacher discovery failure shows the discovery alert with no list of either kind', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, discoveryFailure: true });
 assert.deepEqual(result.requests, ['assignments', 'discovery']);
 assert.match(result.html, /role="alert"[^>]*>No se pudo determinar qué ficha clínica corresponde a este contexto\./);
 assert.doesNotMatch(result.html, /Abrir ficha|Abrir borrador|Fichas de|Borradores de/);
});

test('teacher discovery 401 redirects to login and no discovery runs without a selected assignment', async () => {
 const expired = await render('src/pages/teacher-clinical.astro', { query: `assignment_id=${id}`, oralSurgeryRead: true, discoveryStatus: 401 });
 assert.deepEqual(expired.requests, ['assignments', 'discovery']);
 assert.equal(expired.html, 'REDIRECT:/auth/login?returnTo=%2Fteacher-clinical');
 assert.deepEqual((await render('src/pages/teacher-clinical.astro', { query: '', oralSurgeryRead: true })).requests, ['assignments']);
});

const selectedContext = `assignment_id=${id}&patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`;

test('RED R3-002: teacher evolution read failure keeps the evaluation list rendered and shows an evolution-specific error', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { evolutions: true, evolutionsFailure: true, query: selectedContext });
 assert.deepEqual(result.requests, ['assignments', 'list', 'evolutions']);
 assert.match(result.html, /Abrir ficha · Borrador/);
 assert.match(result.html, /role="alert"[^>]*>No se pudieron cargar las evoluciones kinésicas\./);
 assert.doesNotMatch(result.html, /No se pudo cargar el acceso clínico/);
});

test('teacher evolution 401 still redirects to login', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { evolutions: true, evolutionsStatus: 401, query: selectedContext });
 assert.equal(result.html, 'REDIRECT:/auth/login?returnTo=%2Fteacher-clinical');
});

test('teacher invalid evolution filter is rejected before any clinical or evolution read', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { evolutions: true, query: `${selectedContext}&evaluation_id=0` });
 assert.deepEqual(result.requests, ['assignments']);
 assert.match(result.html, /role="alert"[^>]*>El filtro de evaluación no es válido\./);
});

test('teacher no-filter page keeps the default evaluation list and evolutions without an error', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { evolutions: true, query: selectedContext });
 assert.deepEqual(result.requests, ['assignments', 'list', 'evolutions']);
 assert.match(result.html, /Abrir ficha · Borrador/);
 assert.match(result.html, /No hay evoluciones visibles para este paciente y contexto de origen\./);
 assert.doesNotMatch(result.html, /role="alert"/);
 const select = result.html.match(/<select id="clinical-status"[\s\S]*?<\/select>/)?.[0];
 assert.ok(select);
 assert.doesNotMatch(select, / selected/);
});

test('teacher status select already renders the applied clinical status as the selected option (R3-001 check)', async () => {
 const result = await render('src/pages/teacher-clinical.astro', { query: `${selectedContext}&status=validated` });
 const select = result.html.match(/<select id="clinical-status"[\s\S]*?<\/select>/)?.[0];
 assert.ok(select);
 assert.doesNotMatch(select, /<select[^>]* value=/);
 assert.deepEqual([...select.matchAll(/<option value="([^"]*)"[^>]* selected[ >]/g)].map((match) => match[1]), ['validated']);
});
