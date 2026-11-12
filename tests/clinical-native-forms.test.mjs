import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentId, formDataFromHtml, ids, loadRegisteredActions, recordId, renderCompiledPage } from './helpers/clinical-form-submit.mjs';

const iso = '2026-06-10T12:00:00.000Z';
const content = {
  admission_date: '2026-06-10', admission_status: 'Estable', occupation: 'Docente', referring_physician: 'Dra. Test',
  antecedents: { hta: true, dbt: null, diu: false, sedentary_lifestyle: null, pacemaker: false, other: 'Asma' },
  illness_history: 'Dolor previo', medical_diagnosis: 'Diagnóstico', kinesiology_diagnosis: 'Limitación',
  objectives: 'Recuperar movilidad', proposed_treatment: 'Ejercicios', studies: [{ type: 'RX', description: 'Sin hallazgos', date: null }],
};
const patient = { id: ids.patient, documento: '123', nombres: 'Ana', apellidos: 'Pérez', fecha_nacimiento: '1990-01-01', email: 'ana@example.test', celular: '123', sexo: 'F', direccion: 'Calle' };
const assignment = { id: assignmentId, patient_id: ids.patient, student_habilitation_id: ids.habilitation, subject_id: ids.subject, academic_group_id: ids.group, assigned_by: ids.actor, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso, ended_by: null, ended_at: null, end_reason: null };
const evaluation = (status = 'draft') => ({ id: recordId, clinical_record_id: '9223372036854775806', patient_id: ids.patient, author_id: ids.actor, origin_student_habilitation_id: ids.habilitation, origin_subject_id: ids.subject, origin_group_id: ids.group, status, content, patient, age: 36, created_at: iso, updated_at: iso });
const oralContent = { admission_date: '2026-06-10', treatment_plan: { procedure: 'Exodoncia' } };
const oralDraft = (version = '3') => ({ id: recordId, clinical_record_id: '9223372036854775806', patient_id: ids.patient, author_id: ids.actor, origin_student_habilitation_id: ids.habilitation, origin_subject_id: ids.subject, origin_group_id: ids.group, content: oralContent, status: 'draft', version, created_at: iso, updated_at: iso });
const declaration = { id: '7', draft_id: recordId, draft_version: '3', plan_revision: '2', treatment_plan: oralContent.treatment_plan, declared_by: ids.actor, declared_at: iso };
const filteredAssignmentUrl = `https://backend.invalid/patient-assignments/mine?limit=7&offset=14&patient_id=${ids.patient}`;

function fixtureFetch(actionName) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ method, url, path: parsed.pathname, query: parsed.searchParams, body });
    let response;
    if (parsed.pathname === '/patient-assignments/mine') response = { status: 200, body: { items: [assignment], limit: Number(parsed.searchParams.get('limit')), offset: Number(parsed.searchParams.get('offset')) } };
    else if (parsed.pathname === `/kinesiology-evaluations/${recordId}/submissions` && method === 'POST') response = { status: 201, body: { id: '21', evaluation_id: recordId, ordinal: 1, submitted_by: ids.actor, submitted_at: iso, status: 'pending_validation', clinical_content: content, studies: content.studies, patient, age_at_admission: 36, consent: { id: '5', paper_signature_date: '2026-06-09', verified_by: ids.actor, verified_at: iso } } };
    else if (parsed.pathname === `/kinesiology-evaluations/${recordId}/amendments`) response = { status: 201, body: { ...evaluation('draft'), id: '22', amendment_of_evaluation_id: recordId } };
    else if (parsed.pathname === '/kinesiology-evaluations' && method === 'POST') response = { status: 201, body: evaluation() };
    else if (parsed.pathname === `/kinesiology-evaluations/${recordId}` && method === 'GET') response = { status: 200, body: evaluation(actionName === 'createKinesiologyAmendment' ? 'validated' : 'draft') };
    else if (parsed.pathname === `/kinesiology-evaluations/${recordId}` && method === 'PATCH') response = { status: 200, body: evaluation() };
    else if (parsed.pathname === `/oral-surgery-drafts/${recordId}/consent` && method === 'POST') response = { status: 201, body: declaration };
    else if (parsed.pathname === `/oral-surgery-drafts/${recordId}` && method === 'GET') response = { status: 200, body: oralDraft() };
    else if (parsed.pathname === `/oral-surgery-drafts/${recordId}` && method === 'PATCH') response = { status: 200, body: oralDraft('4') };
    else if (parsed.pathname === '/oral-surgery-drafts' && method === 'POST') response = { status: 201, body: { ...oralDraft('1'), id: '23', content: {} } };
    else throw new Error(`Unexpected fixture request ${method} ${parsed.pathname}`);
    return Response.json(response.body, { status: response.status });
  };
  return { fetch, requests };
}

function objectFromFormData(formData) { return Object.fromEntries(formData.entries()); }
function queryWithListState() { return `assignment_id=${assignmentId}&list_limit=7&list_offset=14&list_patient_id=${ids.patient}`; }

async function renderedCases() {
  const assignmentState = `limit=7&offset=14&patient_id=${ids.patient}`;
  const detailUrl = `/kinesiology-evaluations/${recordId}?${queryWithListState()}`;
  const oralUrl = `/oral-surgery-drafts/${recordId}?${queryWithListState()}`;
  const pages = [
    ['createKinesiologyEvaluation', await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: `/my-patients/${assignmentId}?${assignmentState}` }), 'new-draft', []],
    ['createOralSurgeryDraft', await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: `/my-patients/${assignmentId}?${assignmentState}`, oralEnabled: true }), 'new-draft', []],
    ['updateKinesiologyEvaluation', await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url: detailUrl }), 'evaluation-form', []],
    ['submitKinesiologyEvaluation', await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url: detailUrl }), 'submit-form', []],
    ['createKinesiologyAmendment', await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url: detailUrl, status: 'validated' }), 'amend-form', ['confirm']],
    ['updateOralSurgeryDraft', await renderCompiledPage('src/pages/oral-surgery-drafts/[id].astro', { url: oralUrl }), 'draft-form', []],
    ['declareOralSurgeryConsent', await renderCompiledPage('src/pages/oral-surgery-drafts/[id].astro', { url: oralUrl }), 'declare-form', ['paper_signed']],
  ];
  return pages.map(([name, page, formId, checkboxes]) => ({ name, page, ...formDataFromHtml(page.html, formId, { checkboxes }) }));
}

const expectedBodies = {
  createKinesiologyEvaluation: { patient_id: ids.patient, subject_id: ids.subject, academic_group_id: ids.group, content: {} },
  updateKinesiologyEvaluation: { content },
  submitKinesiologyEvaluation: {},
  createKinesiologyAmendment: {},
  createOralSurgeryDraft: { patient_id: ids.patient, subject_id: ids.subject, academic_group_id: ids.group, content: {} },
  updateOralSurgeryDraft: { expected_version: '3', content: oralContent },
  declareOralSurgeryConsent: { expected_version: '3', paper_signed: true },
};
const mutationPaths = {
  createKinesiologyEvaluation: ['/kinesiology-evaluations', 'POST'],
  updateKinesiologyEvaluation: [`/kinesiology-evaluations/${recordId}`, 'PATCH'],
  submitKinesiologyEvaluation: [`/kinesiology-evaluations/${recordId}/submissions`, 'POST'],
  createKinesiologyAmendment: [`/kinesiology-evaluations/${recordId}/amendments`, 'POST'],
  createOralSurgeryDraft: ['/oral-surgery-drafts', 'POST'],
  updateOralSurgeryDraft: [`/oral-surgery-drafts/${recordId}`, 'PATCH'],
  declareOralSurgeryConsent: [`/oral-surgery-drafts/${recordId}/consent`, 'POST'],
};

test('compiled page components render all seven native forms and real registered handlers execute their submitted FormData', async () => {
  const cases = await renderedCases();
  assert.equal(cases.length, 7);
  for (const { name, page, form, action, data } of cases) {
    assert.match(page.html, /<form\b/);
    assert.ok(form.includes(`id="${name === 'updateKinesiologyEvaluation' ? 'evaluation-form' : name === 'submitKinesiologyEvaluation' ? 'submit-form' : name === 'createKinesiologyAmendment' ? 'amend-form' : name === 'createOralSurgeryDraft' || name === 'createKinesiologyEvaluation' ? 'new-draft' : name === 'updateOralSurgeryDraft' ? 'draft-form' : 'declare-form'}"`));
    assert.ok(action.includes(name), `${name} has its rendered form action`);
    const { server } = await loadRegisteredActions(async () => Response.json({}));
    const registered = server[name];
    const parsed = registered.input.safeParse(objectFromFormData(data));
    assert.equal(parsed.success, true, `${name} rendered FormData accepted by registered schema: ${JSON.stringify(data)}`);
    assert.equal(parsed.data.assignment_id, assignmentId);
    assert.equal(parsed.data.limit, '7');
    assert.equal(parsed.data.offset, '14');
    assert.equal(parsed.data.list_limit, '7');
    assert.equal(parsed.data.list_offset, '14');
    assert.equal(parsed.data.list_patient_id, ids.patient);

    const fixture = fixtureFetch(name);
    const live = await loadRegisteredActions(fixture.fetch);
    const actionData = live.server[name].input.safeParse(objectFromFormData(data));
    assert.equal(actionData.success, true);
    const result = await live.server[name].handler(actionData.data, { cookies: live.cookies });
    assert.equal(result.success, true, `${name} handler result: ${JSON.stringify(result)}`);
    assert.equal(result.assignment_id, assignmentId);
    const assignmentCalls = fixture.requests.filter((request) => request.path === '/patient-assignments/mine');
    assert.equal(assignmentCalls.length, 1, `${name} exact assignment lookup count`);
    assert.equal(fixture.requests.length, name === 'createKinesiologyEvaluation' || name === 'createOralSurgeryDraft' ? 2 : 3, `${name} total synthetic API request count`);
    assert.equal(assignmentCalls[0].url, filteredAssignmentUrl, `${name} constrained assignment lookup`);
    const [mutationPath, method] = mutationPaths[name];
    const mutations = fixture.requests.filter((request) => request.path === mutationPath && request.method === method);
    assert.equal(mutations.length, 1, `${name} exact mutation request count`);
    assert.deepEqual(mutations[0].body, expectedBodies[name], `${name} exact mutation body`);
    assert.ok(Object.keys(mutations[0].body ?? {}).every((key) => !['limit', 'offset'].includes(key) && !key.startsWith('list_')));
  }
});

test('legacy no-filter HTML forms remain schema-valid and removing the required pair from rendered FormData rejects before handler calls', async () => {
  const legacyRows = [
    ['createKinesiologyEvaluation', 'src/pages/my-patients/[assignmentId].astro', `/my-patients/${assignmentId}?limit=50&offset=0`, false, 'new-draft', []],
    ['createOralSurgeryDraft', 'src/pages/my-patients/[assignmentId].astro', `/my-patients/${assignmentId}?limit=50&offset=0`, true, 'new-draft', []],
    ['updateKinesiologyEvaluation', 'src/pages/kinesiology-evaluations/[id].astro', `/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`, false, 'evaluation-form', []],
    ['submitKinesiologyEvaluation', 'src/pages/kinesiology-evaluations/[id].astro', `/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`, false, 'submit-form', []],
    ['createKinesiologyAmendment', 'src/pages/kinesiology-evaluations/[id].astro', `/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`, false, 'amend-form', ['confirm'], 'validated'],
    ['updateOralSurgeryDraft', 'src/pages/oral-surgery-drafts/[id].astro', `/oral-surgery-drafts/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`, false, 'draft-form', []],
    ['declareOralSurgeryConsent', 'src/pages/oral-surgery-drafts/[id].astro', `/oral-surgery-drafts/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`, false, 'declare-form', ['paper_signed']],
  ];
  for (const [name, path, url, oralEnabled, formId, checkboxes, status] of legacyRows) {
    const page = await renderCompiledPage(path, { url, oralEnabled, status });
    const { data } = formDataFromHtml(page.html, formId, { checkboxes });
    const fixture = fixtureFetch(name);
    const live = await loadRegisteredActions(fixture.fetch);
    const parsed = live.server[name].input.safeParse(objectFromFormData(data));
    assert.equal(parsed.success, true, `${name} rendered legacy form schema acceptance: ${JSON.stringify(objectFromFormData(data))}`);
    const mutated = Object.fromEntries(data.entries());
    delete mutated.limit;
    delete mutated.offset;
    const rejected = live.server[name].input.safeParse(mutated);
    assert.equal(rejected.success, false, `${name} mutated rendered form requires legacy pagination`);
    assert.equal(fixture.requests.length, 0, `${name} schema rejection prevents handler/API calls`);
  }
});
