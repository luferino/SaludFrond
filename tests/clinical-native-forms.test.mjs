import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.resolve('astro/package.json'));
const { formDataToObject } = await import(pathToFileURL(join(dirname(require.resolve('astro/package.json')), 'dist/actions/runtime/server.js')));
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
    const astroInput = formDataToObject(data, registered.input);
    for (const key of ['list_student_id', 'list_subject_id', 'list_academic_group_id']) {
      assert.equal(Object.hasOwn(astroInput, key), true);
      assert.equal(astroInput[key], undefined);
    }
    const parsed = registered.input.safeParse(astroInput);
    assert.equal(parsed.success, true, `${name} Astro-normalized FormData accepted by registered schema: ${JSON.stringify(astroInput)}`);
    assert.equal(parsed.data.assignment_id, assignmentId);
    assert.equal(parsed.data.limit, '7');
    assert.equal(parsed.data.offset, '14');
    assert.equal(parsed.data.list_limit, '7');
    assert.equal(parsed.data.list_offset, '14');
    assert.equal(parsed.data.list_patient_id, ids.patient);

    const fixture = fixtureFetch(name);
    const live = await loadRegisteredActions(fixture.fetch);
    const actionData = live.server[name].input.safeParse(formDataToObject(data, live.server[name].input));
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

async function assertCreationRoundTrips(scenario) {
  for (const query of scenario.queries) {
    const initialUrl = `/my-patients/${assignmentId}?${query}`;
    const initial = await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: initialUrl, oralEnabled: scenario.oralEnabled });
    const { action, data } = formDataFromHtml(initial.html, 'new-draft');
    const actionUrl = new URL(action, initial.url);
    assert.equal(actionUrl.pathname, `/my-patients/${assignmentId}`);
    assert.equal(actionUrl.searchParams.get('_action'), scenario.name);
    const fixture = fixtureFetch(scenario.name);
    const live = await loadRegisteredActions(fixture.fetch);
    const registered = live.server[scenario.name];
    const input = registered.input.safeParse(formDataToObject(data, registered.input));
    assert.equal(input.success, true, `${scenario.name} submitted native form is schema-valid`);
    const result = await registered.handler(input.data, { cookies: live.cookies });
    assert.equal(result.success, true, `${scenario.name} handler succeeds`);
    const mutationPath = scenario.name === 'createKinesiologyEvaluation' ? '/kinesiology-evaluations' : '/oral-surgery-drafts';
    const mutation = fixture.requests.filter((request) => request.path === mutationPath && request.method === 'POST');
    assert.equal(mutation.length, 1, `${scenario.name} exactly one create mutation`);
    assert.deepEqual(mutation[0].body, expectedBodies[scenario.name], `${scenario.name} exact API body`);
    const createdId = scenario.name === 'createKinesiologyEvaluation' ? result.evaluation.id : result.draft.id;
    const expectedId = scenario.name === 'createKinesiologyEvaluation' ? recordId : '23';
    assert.equal(createdId, expectedId);

    const receiving = await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', {
      url: actionUrl.href,
      oralEnabled: scenario.oralEnabled,
      actionResults: { [scenario.name]: { data: result } },
    });
    const listFilters = new URLSearchParams(query);
    const expectedFilters = ['patient_id', 'student_id', 'subject_id', 'academic_group_id']
      .filter((key) => listFilters.has(key))
      .map((key) => `&list_${key}=${listFilters.get(key)}`).join('');
    const expectedTarget = `${scenario.expectedPath(expectedId)}?assignment_id=${assignmentId}&list_limit=${listFilters.get('limit')}&list_offset=${listFilters.get('offset')}${expectedFilters}`;
    assert.equal(receiving.html, `REDIRECT:${expectedTarget}`, `${scenario.name} receiving-page redirect`);
  }
}

test('Kinesiology creation round trip redirects using the real created id and preserves filtered and legacy context', async () => {
  await assertCreationRoundTrips({
    name: 'createKinesiologyEvaluation', oralEnabled: false,
    queries: [`limit=7&offset=14&patient_id=${ids.patient}&student_id=${ids.actor}&subject_id=${ids.subject}&academic_group_id=${ids.group}`, 'limit=50&offset=0'],
    expectedPath: (id) => `/kinesiology-evaluations/${id}`,
  });
});

test('Oral Surgery creation round trip redirects using the real created id and preserves filtered and legacy context', async () => {
  await assertCreationRoundTrips({
    name: 'createOralSurgeryDraft', oralEnabled: true,
    queries: [`limit=7&offset=14&patient_id=${ids.patient}`, 'limit=50&offset=0'],
    expectedPath: (id) => `/oral-surgery-drafts/${id}`,
  });
});


test('Kinesiology save redirects from the real handler evaluation and retains filtered and legacy coordinates', async () => {
  const registeredFixture = fixtureFetch('updateKinesiologyEvaluation');
  const { server } = await loadRegisteredActions(registeredFixture.fetch);
  const registered = server.updateKinesiologyEvaluation;
  for (const [url, expected] of [
    [`/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&list_limit=7&list_offset=14&list_patient_id=${ids.patient}`, { list_limit: '7', list_offset: '14', list_patient_id: ids.patient }],
    [`/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`, { list_limit: '50', list_offset: '0' }],
  ]) {
    const page = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url });
    const { data } = formDataFromHtml(page.html, 'evaluation-form');
    const input = registered.input.safeParse(formDataToObject(data, registered.input));
    assert.equal(input.success, true);
    const result = await registered.handler(input.data, { cookies: { get: () => ({ value: 'synthetic-session' }), set() {}, delete() {} } });
    assert.equal(result.success, true);
    assert.equal(Object.hasOwn(result, 'id'), false, 'real handler response has no top-level id');
    assert.equal(result.evaluation.id, recordId);

    const redirected = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', {
      url, actionResults: { updateKinesiologyEvaluation: { data: result } },
    });
    assert.match(redirected.html, /^REDIRECT:/);
    const target = new URL(redirected.html.slice('REDIRECT:'.length), page.url);
    assert.equal(target.pathname, `/kinesiology-evaluations/${recordId}`);
    assert.equal(target.searchParams.get('assignment_id'), assignmentId);
    assert.equal(target.searchParams.get('saved'), '1');
    for (const [key, value] of Object.entries(expected)) assert.equal(target.searchParams.get(key), value, key);
  }
});

test('action coordinates omit only known undefined optional carriers and retain strict validation', async () => {
  const { importModule } = await loadRegisteredActions(async () => Response.json({}));
  const { parseAssignmentActionCoordinates } = await importModule('src/pods/patient-assignment/list-coordinates.ts');
  const carriers = {
    list_patient_id: ids.patient, list_student_id: undefined, list_subject_id: undefined,
    list_academic_group_id: undefined, list_limit: '7', list_offset: '14',
  };
  assert.deepEqual(JSON.parse(JSON.stringify(parseAssignmentActionCoordinates(carriers))), { filters: { patient_id: ids.patient }, limit: 7, offset: 14 });
  for (const invalid of [
    { ...carriers, list_unknown: undefined },
    { ...carriers, 'list_patient_id[x]': ids.patient },
    { ...carriers, 'list_patient_id.foo': ids.patient },
    { ...carriers, list_patient_id: null },
    { ...carriers, list_patient_id: 7 },
    { ...carriers, list_patient_id: 'not-a-uuid' },
    { ...carriers, list_limit: '0' },
    { ...carriers, list_limit: '1.5' },
    { ...carriers, list_offset: '-1' },
    { ...carriers, list_offset: 'nope' },
  ]) assert.throws(() => parseAssignmentActionCoordinates(invalid));
  assert.throws(() => parseAssignmentActionCoordinates({ ...carriers, limit: undefined }, true));
  assert.throws(() => parseAssignmentActionCoordinates({ ...carriers, offset: 'bad' }, true));
  assert.deepEqual(JSON.parse(JSON.stringify(parseAssignmentActionCoordinates({}))), { filters: {}, limit: 50, offset: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(parseAssignmentActionCoordinates({ limit: '8', offset: '16', list_limit: undefined, list_offset: undefined }, true))), { filters: {}, limit: 8, offset: 16 });
});

test('Kinesiology editor action URLs resolve against the rendered editor URL and retain list context', async () => {
  const filters = `list_patient_id=${ids.patient}&list_student_id=${ids.actor}&list_subject_id=${ids.subject}&list_academic_group_id=${ids.group}`;
  const editorUrl = `/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&list_limit=7&list_offset=14&${filters}`;
  const expectedActions = [
    ['evaluation-form', 'updateKinesiologyEvaluation', 'draft'],
    ['submit-form', 'submitKinesiologyEvaluation', 'draft'],
    ['amend-form', 'createKinesiologyAmendment', 'validated'],
  ];
  async function assertActions(url, expectedLimit, expectedOffset, expectedFilters) {
    const pages = new Map();
    for (const status of ['draft', 'validated']) pages.set(status, await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url, status }));
    for (const [formId, actionName, status] of expectedActions) {
      const page = pages.get(status);
      const { action } = formDataFromHtml(page.html, formId);
      const resolved = new URL(action, page.url);
      assert.equal(resolved.pathname, page.url.pathname, `${actionName} stays on the editor route`);
      assert.equal(resolved.searchParams.get('_action'), actionName);
      assert.equal(resolved.searchParams.get('assignment_id'), assignmentId);
      assert.equal(resolved.searchParams.get('list_limit'), expectedLimit);
      assert.equal(resolved.searchParams.get('list_offset'), expectedOffset);
      for (const [key, value] of Object.entries(expectedFilters)) {
        assert.equal(resolved.searchParams.get(`list_${key}`), value, `${actionName} retains list_${key}`);
      }
    }
  }

  await assertActions(editorUrl, '7', '14', { patient_id: ids.patient, student_id: ids.actor, subject_id: ids.subject, academic_group_id: ids.group });
  const legacyUrl = `/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`;
  await assertActions(legacyUrl, '50', '0', {});
});

test('Kinesiology editor offers study add/remove controls only for an editable draft', async () => {
  const url = `/kinesiology-evaluations/${recordId}?assignment_id=${assignmentId}&limit=50&offset=0`;
  const draft = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url, status: 'draft' });
  assert.match(draft.html, /id="add-study"[^>]*>Agregar estudio</);
  assert.match(draft.html, />Quitar estudio</);
  for (const status of ['submitted', 'validated']) {
    const readOnly = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url, status });
    assert.match(readOnly.html, /modo de solo lectura/, `${status} renders read-only`);
    assert.match(readOnly.html, /value="RX"/, `${status} still shows the stored study`);
    assert.doesNotMatch(readOnly.html, /Agregar estudio|id="add-study"/, `${status} hides Agregar estudio`);
    assert.doesNotMatch(readOnly.html, /Quitar estudio/, `${status} hides Quitar estudio`);
  }
});

test('list and oral surgery draft form actions post back to the rendered route with list context', async () => {
  const listUrl = `http://127.0.0.1:4321/my-patients/${assignmentId}?limit=7&offset=14&patient_id=${ids.patient}`;
  const draftUrl = `http://127.0.0.1:4321/oral-surgery-drafts/${recordId}?${queryWithListState()}`;
  const createCarrier = `assignment_id=${assignmentId}&limit=7&offset=14&patient_id=${ids.patient}`;
  const editorCarrier = `assignment_id=${assignmentId}&list_limit=7&list_offset=14&list_patient_id=${ids.patient}`;
  const rows = [
    ['src/pages/my-patients/[assignmentId].astro', { url: listUrl }, 'new-draft', `/my-patients/${assignmentId}?_action=createKinesiologyEvaluation&${createCarrier}`],
    ['src/pages/my-patients/[assignmentId].astro', { url: listUrl, oralEnabled: true }, 'new-draft', `/my-patients/${assignmentId}?_action=createOralSurgeryDraft&${createCarrier}`],
    ['src/pages/oral-surgery-drafts/[id].astro', { url: draftUrl }, 'draft-form', `/oral-surgery-drafts/${recordId}?_action=updateOralSurgeryDraft&${editorCarrier}`],
    ['src/pages/oral-surgery-drafts/[id].astro', { url: draftUrl }, 'declare-form', `/oral-surgery-drafts/${recordId}?_action=declareOralSurgeryConsent&${editorCarrier}`],
  ];
  const actual = [];
  for (const [path, options, formId] of rows) {
    const page = await renderCompiledPage(path, options);
    actual.push(formDataFromHtml(page.html, formId).action);
  }
  assert.deepEqual(actual, rows.map(([, , , expectedAction]) => expectedAction));
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
    const normalized = formDataToObject(data, live.server[name].input);
    const parsed = live.server[name].input.safeParse(normalized);
    assert.equal(parsed.success, true, `${name} Astro-normalized legacy form schema acceptance: ${JSON.stringify(normalized)}`);
    const mutated = Object.fromEntries(data.entries());
    delete mutated.limit;
    delete mutated.offset;
    const rejected = live.server[name].input.safeParse(mutated);
    assert.equal(rejected.success, false, `${name} mutated rendered form requires legacy pagination`);
    assert.equal(fixture.requests.length, 0, `${name} schema rejection prevents handler/API calls`);
  }
});

// Clinical filter return (T1): plain filter names travel beside list_* coordinates on every student link, Volver, action URL and redirect.
const submittedId = '9223372036854775700';
const amendedId = '9223372036854775600';
const filterQuery = 'status=draft&date_from=2026-01-01&date_to=2026-02-01&evaluation_id=9223372036854775700';
const dateQuery = 'date_from=2026-01-01&date_to=2026-02-01';
const listUrlWithFilters = `http://127.0.0.1:4321/my-patients/${assignmentId}?limit=7&offset=14&patient_id=${ids.patient}&${filterQuery}`;
const pageUrlWithFilters = `/kinesiology-evaluations/${recordId}?${queryWithListState()}&${filterQuery}`;
const oralUrlWithFilters = `/oral-surgery-drafts/${recordId}?${queryWithListState()}&${filterQuery}`;
const filterExpectation = (params) => {
  assert.equal(params.get('status'), 'draft');
  assert.equal(params.get('date_from'), '2026-01-01');
  assert.equal(params.get('date_to'), '2026-02-01');
  assert.equal(params.get('evaluation_id'), '9223372036854775700');
};

/** Searches for the href of the first anchor whose target contains the fragment and returns its query. */
function hrefParams(html, fragment) {
  const href = [...html.matchAll(/href="([^"]*)"/g)].map(([, value]) => value.replaceAll('&amp;', '&')).find((value) => value.includes(fragment));
  assert.ok(href, `missing link ${fragment}`);
  return new URL(href, 'https://fixture.invalid').searchParams;
}

test('RED (b) student list links to evaluation, submitted record and oral surgery keep the applied clinical filters', async () => {
  const kinesiology = await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: listUrlWithFilters, submitted: [{ ...evaluation('submitted'), id: submittedId }] });
  for (const fragment of [`/kinesiology-evaluations/${recordId}?`, `/kinesiology-evaluations/${submittedId}?`]) {
    const params = hrefParams(kinesiology.html, fragment);
    filterExpectation(params);
    assert.equal(params.get('list_limit'), '7');
    assert.equal(params.get('list_offset'), '14');
  }
  const oral = await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: `http://127.0.0.1:4321/my-patients/${assignmentId}?limit=7&offset=14&patient_id=${ids.patient}&${dateQuery}`, oralEnabled: true, oralDrafts: [{ ...oralDraft('1'), id: recordId }] });
  const params = hrefParams(oral.html, `/oral-surgery-drafts/${recordId}?`);
  assert.equal(params.get('date_from'), '2026-01-01');
  assert.equal(params.get('date_to'), '2026-02-01');
  assert.equal(params.get('list_limit'), '7');
});

test('RED (c) student detail «Volver» restores clinical filters beside list coordinates and assignment_id', async () => {
  const evaluationPage = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url: pageUrlWithFilters });
  const back = hrefParams(evaluationPage.html, `/my-patients/${assignmentId}?`);
  filterExpectation(back);
  assert.equal(back.get('limit'), '7');
  assert.equal(back.get('offset'), '14');
  const oralPage = await renderCompiledPage('src/pages/oral-surgery-drafts/[id].astro', { url: oralUrlWithFilters });
  filterExpectation(hrefParams(oralPage.html, `/my-patients/${assignmentId}?`));
});

test('RED (d) student action URLs carry the filters while form bodies stay identical to the no-filter form', async () => {
  for (const [path, url, formId] of [
    ['src/pages/kinesiology-evaluations/[id].astro', pageUrlWithFilters, 'evaluation-form'],
    ['src/pages/oral-surgery-drafts/[id].astro', oralUrlWithFilters, 'draft-form'],
  ]) {
    const withFilters = formDataFromHtml((await renderCompiledPage(path, { url })).html, formId);
    const plain = formDataFromHtml((await renderCompiledPage(path, { url: url.split('&status=')[0] })).html, formId);
    filterExpectation(new URL(withFilters.action, 'https://fixture.invalid').searchParams);
    assert.deepEqual([...withFilters.data.entries()], [...plain.data.entries()], formId);
    assert.doesNotMatch(plain.action, /status=|date_from=|evaluation_id=/);
  }
});

test('RED (d) student create, save, submit, amend and declare redirects keep the clinical filters', async () => {
  const cases = [
    ['src/pages/my-patients/[assignmentId].astro', listUrlWithFilters, { createKinesiologyEvaluation: { data: { success: true, evaluation: { id: recordId } } } }, `/kinesiology-evaluations/${recordId}?`],
    ['src/pages/kinesiology-evaluations/[id].astro', pageUrlWithFilters, { updateKinesiologyEvaluation: { data: { success: true, evaluation: { id: recordId }, assignment_id: assignmentId, list_limit: '7', list_offset: '14' } } }, `/kinesiology-evaluations/${recordId}?`],
    ['src/pages/kinesiology-evaluations/[id].astro', pageUrlWithFilters, { submitKinesiologyEvaluation: { data: { success: true, id: recordId, assignment_id: assignmentId, list_limit: '7', list_offset: '14' } } }, `/kinesiology-evaluations/${recordId}?`],
    ['src/pages/kinesiology-evaluations/[id].astro', pageUrlWithFilters, { createKinesiologyAmendment: { data: { success: true, id: amendedId, assignment_id: assignmentId, list_limit: '7', list_offset: '14' } } }, `/kinesiology-evaluations/${amendedId}?`],
    ['src/pages/oral-surgery-drafts/[id].astro', oralUrlWithFilters, { updateOralSurgeryDraft: { data: { success: true, id: recordId, assignment_id: assignmentId, limit: '7', offset: '14' } } }, `/oral-surgery-drafts/${recordId}?`],
    ['src/pages/oral-surgery-drafts/[id].astro', oralUrlWithFilters, { declareOralSurgeryConsent: { data: { success: true, id: recordId, assignment_id: assignmentId, limit: '7', offset: '14' } } }, `/oral-surgery-drafts/${recordId}?`],
  ];
  for (const [path, url, actionResults, prefix] of cases) {
    const page = await renderCompiledPage(path, { url, actionResults });
    assert.ok(page.html.startsWith(`REDIRECT:${prefix}`), page.html);
    filterExpectation(new URL(page.html.slice('REDIRECT:'.length), 'https://fixture.invalid').searchParams);
  }
});

test('RED (e) student amendment-of link keeps the clinical filters beside assignment and list coordinates', async () => {
  const page = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url: pageUrlWithFilters, amendmentOf: amendedId });
  const params = hrefParams(page.html, `/kinesiology-evaluations/${amendedId}?`);
  filterExpectation(params);
  assert.equal(params.get('assignment_id'), assignmentId);
  assert.equal(params.get('list_limit'), '7');
});

test('no-filter student «Volver» keeps the exact list-coordinate URL', async () => {
  const page = await renderCompiledPage('src/pages/kinesiology-evaluations/[id].astro', { url: `/kinesiology-evaluations/${recordId}?${queryWithListState()}` });
  assert.ok(page.html.includes(`href="/my-patients/${assignmentId}?limit=7&amp;offset=14&amp;patient_id=${ids.patient}"`));
});

test('RED (b) student create-draft form actions carry the clinical filters while the hidden body keeps only list coordinates', async () => {
  const page = await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: listUrlWithFilters });
  const form = formDataFromHtml(page.html, 'new-draft');
  filterExpectation(new URL(form.action, 'https://fixture.invalid').searchParams);
  assert.deepEqual([...form.data.keys()].filter((name) => /^(status|date_from|date_to|evaluation_id)$/.test(name)), []);
  const oral = await renderCompiledPage('src/pages/my-patients/[assignmentId].astro', { url: `http://127.0.0.1:4321/my-patients/${assignmentId}?${dateQuery}`, oralEnabled: true });
  assert.equal(new URL(formDataFromHtml(oral.html, 'new-draft').action, 'https://fixture.invalid').searchParams.get('date_from'), '2026-01-01');
});
