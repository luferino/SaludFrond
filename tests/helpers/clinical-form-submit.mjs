import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'astro/zod';

const root = new URL('../../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');

export const ids = {
  patient: 'a1b2c3d4-e5f6-4890-abcd-ef0123456789',
  subject: '01234567-89ab-4def-8123-456789abcdef',
  group: 'abcdef01-2345-4789-abcd-ef0123456789',
  actor: '11111111-2222-4333-8444-555555555555',
  habilitation: '99999999-8888-4777-8666-555555555555',
};
export const assignmentId = '17';
export const recordId = '9223372036854775807';
// Native successful-control rules used by these forms: disabled controls and unchecked
// checkboxes are omitted; select contributes its selected option; textarea contributes text.
export function serializeNativeControls(controls) {
  const form = new FormData();
  for (const control of controls) {
    if (!control.name || control.disabled) continue;
    if (control.type === 'checkbox' && !control.checked) continue;
    if (control.tag === 'select') {
      const selected = control.options.find((option) => option.selected);
      if (selected) form.append(control.name, selected.value);
    } else if (control.tag === 'textarea') {
      form.append(control.name, control.text ?? '');
    } else {
      form.append(control.name, control.value ?? '');
    }
  }
  return form;
}

const registryPath = 'src/actions/index.ts';
const stubbedModules = {
  '../pods/auth/actions': ['handleLogin','handleLogout','handleRegister','handleForgotPassword','handleResetPassword'],
  '../pods/subject/actions/subjects': ['handleCreateSubject'], '../pods/group/actions/groups': ['handleCreateGroup'],
  '../pods/subject-group/actions/subject-groups': ['handleCreateSubjectGroup'], '../pods/student/actions/students': ['handleCreateStudent'],
  '../pods/teacher/actions/teachers': ['handleCreateTeacher'], '../pods/paciente/actions/patients': ['handleCreatePatient'],
  '../pods/teacher-habilitation/actions': ['activateTeacherHabilitation','revokeTeacherHabilitation'],
  '../pods/student-habilitation/actions': ['activateStudentHabilitation','revokeStudentHabilitation'],
  '../pods/patient-availability/actions': ['searchAvailablePatient','enablePatientAvailability','withdrawPatientAvailability'],
  '../pods/reception-account/actions': ['createReceptionAccount','grantReceptionCareer','revokeReceptionCareerGrant','grantReceptionRole','revokeReceptionRole'],
  '../pods/active-role/actions': ['switchActiveRole'], '../pods/reception-patient/actions': ['matchReceptionPatient','reuseReceptionPatient','registerReceptionPatient','updateReceptionPatientContact'],
  '../pods/reception-availability/actions': ['searchReceptionAvailabilityPatient','enableReceptionAvailability','withdrawReceptionAvailability'],
  '../pods/teacher-assignment/actions': ['createTeacherAssignment'], '../pods/teacher-clinical/actions/consent': ['handleRecordTeacherConsent'],
  '../pods/teacher-clinical/actions/reviews': ['handleValidateTeacherSubmission','handleRequestTeacherCorrection'],
  '../pods/oral-surgery-draft/actions/authorizations': ['handleAuthorizeOralSurgeryDraft'],
};

export async function loadRegisteredActions(fetchImpl) {
  const requests = [];
  const sandbox = vm.createContext({ URL, URLSearchParams, Response, Error, Date, BigInt, atob, fetch: async (url, init = {}) => {
    requests.push({ url, ...init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    return fetchImpl(url, init);
  } });
  const cache = new Map();
  async function compile(code, identifier) {
    if (cache.has(identifier)) return cache.get(identifier);
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = new vm.SourceTextModule(js, { context: sandbox, identifier, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; } });
    cache.set(identifier, mod);
    await mod.link(async (specifier, parent) => {
      if (specifier === 'astro:actions') return new vm.SyntheticModule(['defineAction'], function () { this.setExport('defineAction', (definition) => definition); }, { context: sandbox });
      if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () { this.setExport('z', z); }, { context: sandbox });
      if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
      if (specifier === './session') return new vm.SyntheticModule(['getSession','clearSession'], function () { this.setExport('getSession', (jar) => jar.get('session')?.value ?? null); this.setExport('clearSession', () => {}); }, { context: sandbox });
      if (parent.identifier.endsWith(registryPath) && stubbedModules[specifier]) {
        const names = stubbedModules[specifier];
        return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, () => undefined); }, { context: sandbox });
      }
      const target = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
      return compile(await readFile(target, 'utf8'), target.href);
    });
    return mod;
  }
  const path = new URL(registryPath, root);
  const registry = await compile(await readFile(path, 'utf8'), path.href);
  await registry.evaluate();
  async function importModule(relativePath) {
    const modulePath = new URL(relativePath, root);
    const module = await compile(await readFile(modulePath, 'utf8'), modulePath.href);
    if (module.status !== 'evaluated') await module.evaluate();
    return module.namespace;
  }
  return { server: registry.namespace.server, importModule, requests, cookies: { get: (name) => name === 'session' ? { value: 'synthetic-session' } : undefined, set() {}, delete() {} } };
}

export function nativeFormData(entries) {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}

async function html(value) {
  value = await value;
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
  return String(value);
}
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Real listing.ts exports (clinical filter carrier and parsers) for harnesses that compile pages with explicit mocks; no vm registry needed. */
export async function realListingModule() {
  const load = async (file, modules = {}) => {
    const output = ts.transpileModule(await readFile(new URL(file, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('exports', 'require', output)(exports, (name) => modules[name] ?? {});
    return exports;
  };
  const clinical = await load('src/pods/kinesiology-evaluation/list-filters.ts');
  return load('src/pods/kinesiology-evolution/listing.ts', { '../kinesiology-evaluation/list-filters': clinical });
}

/** Execute a transformed Astro page component with synthetic data and return its rendered HTML. */
export async function renderCompiledPage(path, { url, oralEnabled = false, status = 'draft', actionResults = {}, submitted = [], oralDrafts = [], amendmentOf } = {}) {
  const pageUrl = new URL(url, 'https://fixture.invalid');
  const nativeAssignment = {
    id: assignmentId, patient_id: ids.patient, student_habilitation_id: ids.habilitation,
    subject_id: ids.subject, academic_group_id: ids.group, assigned_by: ids.actor,
    nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: '2026-06-10T12:00:00.000Z',
    ended_by: null, ended_at: null, end_reason: null,
  };
  const clinicalContent = {
    admission_date: '2026-06-10', admission_status: 'Estable', occupation: 'Docente', referring_physician: 'Dra. Test',
    antecedents: { hta: true, dbt: null, diu: false, sedentary_lifestyle: null, pacemaker: false, other: 'Asma' },
    illness_history: 'Dolor previo', medical_diagnosis: 'Diagnóstico', kinesiology_diagnosis: 'Limitación',
    objectives: 'Recuperar movilidad', proposed_treatment: 'Ejercicios', studies: [{ type: 'RX', description: 'Sin hallazgos', date: null }],
  };
  const clinicalRecord = {
    id: recordId, clinical_record_id: '9223372036854775806', patient_id: ids.patient, author_id: ids.actor,
    origin_student_habilitation_id: ids.habilitation, origin_subject_id: ids.subject, origin_group_id: ids.group,
    status, content: clinicalContent,
    patient: { id: ids.patient, documento: '123', nombres: 'Ana', apellidos: 'Pérez', fecha_nacimiento: '1990-01-01', email: 'ana@example.test', celular: '123', sexo: 'F', direccion: 'Calle' },
    age: 36, created_at: '2026-06-10T12:00:00.000Z', updated_at: '2026-06-10T12:00:00.000Z',
  };
  const oralRecord = {
    ...clinicalRecord, content: { admission_date: '2026-06-10', treatment_plan: { procedure: 'Exodoncia' } },
    version: '3', status: 'draft',
  };
  const actor = { sub: ids.actor, role: 'student', permissions: ['kinesiology-evaluations:write', 'kinesiology-evaluations:submit', 'oral-surgery-drafts:read', 'oral-surgery-drafts:write'] };
  const actionNames = ['createKinesiologyEvaluation','updateKinesiologyEvaluation','submitKinesiologyEvaluation','createKinesiologyAmendment','createOralSurgeryDraft','updateOralSurgeryDraft','declareOralSurgeryConsent'];
  const actions = Object.fromEntries(actionNames.map((name) => [name, Object.assign(() => undefined, { toString: () => `?_action=${name}` })]));
  const Astro = {
    params: { assignmentId, id: recordId }, url: pageUrl,
    cookies: { get: (name) => name === 'session' ? { value: 'synthetic-session' } : undefined, set() {}, delete() {} },
    getActionResult: (action) => {
      const name = Object.entries(actions).find(([, registered]) => registered === action)?.[0];
      return name ? actionResults[name] : undefined;
    },
    request: new Request(pageUrl), response: { headers: new Headers() },
    redirect: (href) => `REDIRECT:${href}`,
  };
  const actionModules = await loadRegisteredActions(async () => Response.json({}));
  const oral = await actionModules.importModule('src/pods/oral-surgery-draft/actions/drafts.ts');
  const evolution = await actionModules.importModule('src/pods/kinesiology-evolution/listing.ts');
  const kinesiology = await actionModules.importModule('src/pods/kinesiology-evaluation/api.ts');
  const listCoordinates = await actionModules.importModule('src/pods/patient-assignment/list-coordinates.ts');
  const mocks = {
    parseEvolutionListFilters: evolution.parseEvolutionListFilters,
    clinicalFilterCarrier: evolution.clinicalFilterCarrier,
    listKinesiologyEvolutions: async () => [],
    actions, Fragment: null, Layout: null, SubmissionSnapshot: null, OralSurgeryReadOnly: null,
    ApiError: class ApiError extends Error { constructor(status) { super(`API ${status}`); this.status = status; } },
    isInputError: () => false,
    decodeJwt: () => actor,
    listAssignedPatients: async (page, _cookies, filters) => ({ items: [{ ...nativeAssignment, ...filters }], limit: page.limit, offset: page.offset }),
    parseAssignmentListCoordinates: listCoordinates.parseAssignmentListCoordinates,
    assignmentListCarrier: listCoordinates.assignmentListCarrier,
    assignmentListQuery: listCoordinates.assignmentListQuery,
    actionHrefWithContext: kinesiology.actionHrefWithContext,
    EVALUATION_STATUS_LABELS: { draft: 'Borrador', submitted: 'Enviada', validated: 'Validada' },
    antecedentOptionState: (value, present) => ({ unrecorded: !present, unknown: present && value === null, yes: value === true, no: value === false }),
    listEvaluations: async () => [clinicalRecord], listSubmittedEvaluations: async () => submitted,
    listOralSurgeryDrafts: async () => oralDrafts,
    listOralSurgeryContexts: async () => ({ status: 'ok', items: oralEnabled ? [{ subject_id: ids.subject, academic_group_id: ids.group }] : [] }),
    isOralSurgeryContext: (contexts, subjectId, groupId) => contexts.some((item) => item.subject_id === subjectId && item.academic_group_id === groupId),
    getEvaluation: async () => (amendmentOf ? { ...clinicalRecord, amendment_of_evaluation_id: amendmentOf } : clinicalRecord),
    listCorrections: async () => ({ evaluation_id: recordId, items: [] }),
    listSubmissions: async () => ({ evaluation_id: recordId, items: [] }),
    rawEvaluationContentFromForm: () => clinicalContent,
    validId: (value) => /^[1-9]\d{0,18}$/.test(value),
    getOralSurgeryDraft: async () => oralRecord,
    getConsentHistory: async () => ({ draft_version: '3', plan_revision: '2', current_declaration_id: null, declarations: [] }),
    getAuthorizationHistory: async () => ({ draft_version: '3', current_authorization_id: null, authorizations: [] }),
    ...oral,
    ORAL_SURGERY_FIELD_LABELS: Object.fromEntries(oral.ORAL_SURGERY_FORM_SECTIONS.map(({ section, booleans, texts }) => [section, Object.fromEntries([...booleans, ...texts].map((field) => [field, field]))])),
    ORAL_SURGERY_SECTION_LABELS: Object.fromEntries(oral.ORAL_SURGERY_FORM_SECTIONS.map(({ section }) => [section, section])),
    oralSurgeryTimestampLabel: (value) => value,
    $$createAstro: () => ({}), $$createComponent: (component) => component,
    $$render: async (strings, ...values) => { let output = ''; for (let index = 0; index < strings.length; index++) output += strings[index] + await html(values[index]); return output; },
    $$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => ({ ...Astro, props }) }, props, slots) : slots?.default?.() ?? '',
    $$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`,
    $$spreadAttributes: (attributes) => Object.entries(attributes ?? {}).map(([name, value]) => value == null || value === false ? '' : ` ${name}="${escapeHtml(value)}"`).join(''),
    $$maybeRenderHead: () => '', $$renderHead: () => '', $$unescapeHTML: (value) => value,
    $$Fragment: null,
  };
  const result = await transform(await readFile(new URL(path, root), 'utf8'), { filename: path });
  const ast = ts.createSourceFile('clinical-page.ts', result.code, ts.ScriptTarget.Latest, true);
  let code = result.code;
  const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
    .map((statement) => [statement.getFullStart(), statement.getEnd()]);
  for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
  const rendered = await html(exports.default({ createAstro: () => Astro }, {}, {}));
  return { html: rendered, assignment: nativeAssignment, content: clinicalContent, record: clinicalRecord, oralRecord, url: pageUrl };
}

function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x[0-9a-f]+|#\d+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}
function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = match[1].toLowerCase();
    result[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

/** Extract a concrete form and browser-successful controls from compiler-executed HTML only. */
export function formDataFromHtml(html, formId, { checkboxes = [] } = {}) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const match = forms.find((item) => attributes(`<form ${item[1]}>`).id === formId);
  assert.ok(match, `rendered HTML has form #${formId}`);
  const controls = [];
  const disabledFieldsets = [];
  const tokens = /<fieldset\b[^>]*>|<\/fieldset\s*>|<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea\s*>|<select\b[^>]*>[\s\S]*?<\/select\s*>/gi;
  for (const item of match[2].matchAll(tokens)) {
    const token = item[0];
    if (/^<fieldset\b/i.test(token)) { disabledFieldsets.push(disabledFieldsets.at(-1) === true || /\sdisabled(?:\s|>|=)/i.test(token)); continue; }
    if (/^<\/fieldset/i.test(token)) { disabledFieldsets.pop(); continue; }
    if (/^<input/i.test(token)) {
      const attrs = attributes(token);
      if (!attrs.name) continue;
      const type = attrs.type?.toLowerCase() ?? 'text';
      const checked = Object.hasOwn(attrs, 'checked') || checkboxes.includes(attrs.name);
      controls.push({ tag: 'input', type, name: attrs.name, value: attrs.value ?? (type === 'checkbox' ? 'on' : ''), checked, disabled: disabledFieldsets.at(-1) === true || Object.hasOwn(attrs, 'disabled') });
      continue;
    }
    if (/^<textarea/i.test(token)) {
      const attrs = attributes(token.slice(0, token.indexOf('>') + 1));
      if (attrs.name) {
        let text = decodeHtml(token.replace(/^<textarea[^>]*>/i, '').replace(/<\/textarea\s*>$/i, ''));
        text = text.replace(/^\n/, '').replace(/\r?\n/g, '\r\n');
        controls.push({ tag: 'textarea', name: attrs.name, text, disabled: disabledFieldsets.at(-1) === true || Object.hasOwn(attrs, 'disabled') });
      }
      continue;
    }
    const attrs = attributes(token.slice(0, token.indexOf('>') + 1));
    if (!attrs.name) continue;
    const options = [...token.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)].map((option) => {
      const optionAttrs = attributes(`<option ${option[1]}>`);
      return { value: optionAttrs.value ?? decodeHtml(option[2].replace(/<[^>]*>/g, '').trim()), selected: Object.hasOwn(optionAttrs, 'selected') };
    });
    if (options.length && !options.some((option) => option.selected)) options[0].selected = true;
    controls.push({ tag: 'select', name: attrs.name, options, disabled: disabledFieldsets.at(-1) === true || Object.hasOwn(attrs, 'disabled') });
  }
  return { form: match[0], action: attributes(`<form ${match[1]}>`).action, data: serializeNativeControls(controls) };
}
