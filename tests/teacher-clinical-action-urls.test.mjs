import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const origin = 'http://127.0.0.1:4321';
const id = '9007199254741061';
const submissionId = '9007199254741063';
const actorId = '44444444-4444-4444-8444-444444444444';
const patient = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const iso = '2026-06-10T12:00:00.000Z';
const context = `patient_id=${patient}&subject_id=${subject}&academic_group_id=${group}`;
const listContext = 'list_limit=50&list_offset=0';

// Realistic Astro action stubs: toString() yields only the query, never a path.
const actions = Object.fromEntries(['recordTeacherConsent', 'validateTeacherSubmission', 'requestTeacherCorrection', 'authorizeOralSurgeryDraft']
  .map((name) => [name, Object.assign(() => undefined, { toString: () => `?_action=${name}` })]));
const evaluation = {
  id, clinical_record_id: '9007199254741060', patient_id: patient, author_id: actorId, origin_student_habilitation_id: actorId,
  origin_subject_id: subject, origin_group_id: group, status: 'submitted', content: {}, patient: null, age: null, created_at: iso, updated_at: iso,
};
const submission = {
  id: submissionId, evaluation_id: id, ordinal: 1, submitted_by: actorId, submitted_at: iso, status: 'pending_validation',
  clinical_content: {}, studies: [], patient: null, age_at_admission: 36, consent: null,
};

async function html(value) {
  value = await value;
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
  return String(value);
}
const escapeAttribute = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const formActions = (rendered) => [...rendered.matchAll(/<form\b[^>]*\baction="([^"]*)"/g)].map(([, action]) => action.replaceAll('&amp;', '&'));

async function realHelpers() {
  const { importModule } = await loadRegisteredActions(async () => Response.json({}));
  const kinesiology = await importModule('src/pods/kinesiology-evaluation/api.ts');
  const coordinates = await importModule('src/pods/patient-assignment/list-coordinates.ts');
  return {
    actionHrefWithContext: kinesiology.actionHrefWithContext,
    parseAssignmentListCoordinates: coordinates.parseAssignmentListCoordinates,
    assignmentListCarrier: coordinates.assignmentListCarrier,
    assignmentListQuery: coordinates.assignmentListQuery,
  };
}

/** Execute a transformed teacher page with synthetic data; only the page under test is compiled. */
async function renderTeacherPage(path, { url, mocks: pageMocks }) {
  const pageUrl = new URL(url);
  const Astro = {
    params: { id }, url: pageUrl, cookies: {}, request: new Request(pageUrl), response: { headers: new Headers() },
    getActionResult: () => undefined, redirect: (location) => `REDIRECT:${location}`,
  };
  const mocks = {
    ...await realHelpers(), actions, isInputError: () => false,
    Layout: null, Fragment: null, EvaluationReadOnly: null, SubmissionSnapshot: null, OralSurgeryReadOnly: null,
    ApiError: class ApiError extends Error { constructor(status) { super(`API ${status}`); this.status = status; } },
    teacherGrant: () => true,
    parseClinicalContext: (params) => ({ patient_id: params.get('patient_id'), subject_id: params.get('subject_id'), academic_group_id: params.get('academic_group_id') }),
    oralSurgeryTimestampLabel: (value) => value,
    $$createAstro: () => ({}), $$createComponent: (component) => component, $$Fragment: null,
    $$render: async (strings, ...values) => { let output = ''; for (let index = 0; index < strings.length; index++) output += strings[index] + await html(values[index]); return output; },
    $$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => ({ ...Astro, props }) }, props, slots) : slots?.default?.() ?? '',
    $$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`,
    $$maybeRenderHead: () => '', $$renderHead: () => '', $$unescapeHTML: (value) => value,
    ...pageMocks,
  };
  const result = await transform(await readFile(new URL(path, root), 'utf8'), { filename: path });
  const ast = ts.createSourceFile('teacher-page.ts', result.code, ts.ScriptTarget.Latest, true);
  let code = result.code;
  const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
    .map((statement) => [statement.getFullStart(), statement.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  return { html: await html(exports.default({ createAstro: () => Astro }, {}, {})), url: pageUrl };
}

test('teacher-clinical detail forms post back to the rendered detail route, not the site root', async () => {
  const page = await renderTeacherPage('src/pages/teacher-clinical/[id].astro', {
    url: `${origin}/teacher-clinical/${id}?${context}&assignment_id=17`,
    mocks: {
      getTeacherEvaluation: async () => evaluation,
      getConsent: async () => ({ evaluation_id: id, status: 'pending', evidence: null }),
      listTeacherSubmissions: async () => ({ evaluation_id: id, items: [submission] }),
      listTeacherCorrections: async () => ({ evaluation_id: id, items: [] }),
    },
  });
  const route = `/teacher-clinical/${id}`;
  assert.deepEqual(formActions(page.html), [
    `${route}?_action=recordTeacherConsent&${context}&${listContext}`,
    `${route}?_action=validateTeacherSubmission&${context}&${listContext}`,
    `${route}?_action=requestTeacherCorrection&${context}&${listContext}`,
  ]);
});

test('teacher oral surgery authorization form posts back to the rendered draft route, not the site root', async () => {
  const page = await renderTeacherPage('src/pages/teacher-clinical/oral-surgery/[id].astro', {
    url: `${origin}/teacher-clinical/oral-surgery/${id}?${context}&assignment_id=17`,
    mocks: {
      getOralSurgeryDraft: async () => ({ id, patient_id: patient, origin_subject_id: subject, origin_group_id: group, version: '3', status: 'draft', content: {} }),
      getConsentHistory: async () => ({ draft_version: '3', plan_revision: '2', current_declaration_id: '7', declarations: [] }),
      getAuthorizationHistory: async () => ({ draft_version: '3', current_authorization_id: null, authorizations: [] }),
    },
  });
  assert.deepEqual(formActions(page.html), [
    `/teacher-clinical/oral-surgery/${id}?_action=authorizeOralSurgeryDraft&${context}&${listContext}`,
  ]);
});
