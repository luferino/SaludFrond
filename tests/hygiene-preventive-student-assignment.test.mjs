import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { realListingModule } from './helpers/clinical-form-submit.mjs';

// D5: /my-patients/[assignmentId] branches per form. Oral-only and kinesiology-only keep their behavior; both forms
// render two sections, one below the other.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/my-patients/[assignmentId].astro';
const subject = '01234567-89ab-4def-8123-456789abcdef';
const group = 'abcdef01-2345-4789-abcd-ef0123456789';
const otherGroup = '33333333-4444-4555-8666-777777777777';
const patient = '11111111-1111-4111-8111-111111111111';
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitation = '22222222-2222-4222-8222-222222222222';
const iso = '2026-11-06T12:00:00Z';
const pair = (overrides = {}) => ({ subject_id: subject, academic_group_id: group, ...overrides });
const assignment = { id: '17', patient_id: patient, student_habilitation_id: habilitation, subject_id: subject, academic_group_id: group, assigned_by: teacherId, nombres: 'Ana', apellidos: 'Pérez', documento: '12345678', assigned_at: iso, ended_by: null, ended_at: null, end_reason: null };
const oralDraft = (overrides = {}) => ({
	id: '9007199254741061', clinical_record_id: '9007199254741060', patient_id: patient, author_id: teacherId,
	origin_student_habilitation_id: habilitation, origin_subject_id: subject, origin_group_id: group,
	content: {}, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const hygieneDraft = (overrides = {}) => ({ ...oralDraft({ id: '9007199254742001', content: { medical_history: { diabetes: false } } }), ...overrides });
const listing = await realListingModule();
const LOGIN = 'REDIRECT:/auth/login?returnTo=%2Fmy-patients%2F17%3Flimit%3D50%26offset%3D0';
const KINESIOLOGY_REQUESTS = ['kinesiology-drafts', 'kinesiology-submitted'];

/** Render the real student assignment page; each collaborator is an isolated, recorded mock. */
async function renderAssignment(options = {}) {
	const requests = [];
	const oralListings = [];
	const hygieneListings = [];
	const cookies = { get: (name) => (name === 'session' ? { value: 'token' } : undefined) };
	const Astro = {
		params: { assignmentId: '17' }, cookies, url: new URL(options.url ?? 'https://fixture.invalid/my-patients/17?limit=50&offset=0'),
		getActionResult: (action) => options.results?.[action],
		redirect: (url) => `REDIRECT:${url}`, response: { headers: new Headers() },
	};
	const mocks = {
		Layout: null, Fragment: null, ApiError: class ApiError extends Error { constructor(status) { super('api'); this.status = status; } },
		actions: { createKinesiologyEvaluation: 'kinesiology', createOralSurgeryDraft: 'oral-surgery', createHygieneDraft: 'hygiene' },
		isInputError: () => false,
		decodeJwt: () => ({ sub: teacherId, role: 'student', permissions: options.permissions ?? [] }),
		parseEvolutionListFilters: (params) => Object.fromEntries(['status', 'date_from', 'date_to', 'evaluation_id'].filter((key) => params.has(key) && params.get(key)).map((key) => [key, params.get(key)])),
		clinicalFilterCarrier: listing.clinicalFilterCarrier,
		parseAssignmentListCoordinates: (params) => ({ filters: {}, limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
		assignmentListCarrier: (coordinates) => Object.fromEntries([['list_limit', String(coordinates.limit)], ['list_offset', String(coordinates.offset)], ...Object.entries(coordinates.filters).map(([key, value]) => [`list_${key}`, value])]),
		assignmentListQuery: (coordinates) => new URLSearchParams({ limit: String(coordinates.limit), offset: String(coordinates.offset), ...coordinates.filters }).toString(),
		listAssignedPatients: async () => { requests.push('assignments'); if (options.assignmentsFailure) throw new Error('offline'); return { items: [assignment], limit: 50, offset: 0 }; },
		listEvaluations: async () => { requests.push('kinesiology-drafts'); return []; },
		listSubmittedEvaluations: async () => { requests.push('kinesiology-submitted'); return []; },
		listKinesiologyEvolutions: async () => [],
		EVALUATION_STATUS_LABELS: {},
		actionHrefWithContext: (href, context) => { const url = new URL(href, 'http://localhost'); for (const [key, value] of Object.entries(context)) url.searchParams.set(key, value); return `${url.pathname}${url.search}`; },
		listOralSurgeryContexts: async () => {
			requests.push('discovery');
			if (options.discoveryStatus) throw new mocks.ApiError(options.discoveryStatus);
			if (options.discoveryFailure) throw new Error('offline');
			return { status: 'ok', items: options.contexts ?? [] };
		},
		isOralSurgeryContext: (contexts, subjectId, groupId) => contexts.some((item) => item.subject_id === subjectId && item.academic_group_id === groupId),
		listOralSurgeryDrafts: async (context, _cookies, page) => { requests.push('oral-list'); oralListings.push({ context, page }); return options.drafts ?? []; },
		listHygieneContexts: async () => {
			requests.push('hygiene-discovery');
			if (options.hygieneStatus) throw new mocks.ApiError(options.hygieneStatus);
			if (options.hygieneFailure) throw new Error('offline');
			if (options.hygieneForbidden) return { status: 'forbidden' };
			return { status: 'ok', items: options.hygieneContexts ?? [] };
		},
		isHygieneContext: (contexts, subjectId, groupId) => contexts.some((item) => item.subject_id === subjectId && item.academic_group_id === groupId),
		listHygieneDrafts: async (context, _cookies, page) => {
			requests.push('hygiene-list');
			hygieneListings.push({ context, page });
			if (options.hygieneListFailure) throw new Error('offline');
			return options.hygieneDrafts ?? [];
		},
		$$createAstro: () => ({}), $$createComponent: (component) => component,
		$$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
		$$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => Astro }, props, slots) : slots?.default?.() ?? '',
		$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${String(value).replaceAll('&', '&amp;')}"`,
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
	const component = await compile(pagePath);
	const rendered = await html(component({ createAstro: () => Astro }, {}, {}));
	return { html: rendered, requests, oralListings, hygieneListings };
}
async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('neither form enabled keeps the Kinesiology view exactly as today, with no Hygiene request without the grant', async () => {
	const result = await renderAssignment({ permissions: ['kinesiology-evaluations:write'] });
	assert.deepEqual(result.requests, ['assignments', ...KINESIOLOGY_REQUESTS]);
	assert.match(result.html, /Ficha kinésica inicial/);
	assert.match(result.html, /Crear nuevo borrador<\/button>/);
	assert.doesNotMatch(result.html, /Higiene|Cirugía Oral|hygiene|oral-surgery/);
});

test('a Hygiene read grant with no enabled pair keeps the Kinesiology view and makes one discovery request', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair({ academic_group_id: otherGroup })] });
	assert.deepEqual(result.requests, ['assignments', 'hygiene-discovery', ...KINESIOLOGY_REQUESTS]);
	assert.match(result.html, /Ficha kinésica inicial/);
	assert.doesNotMatch(result.html, /Higiene y Preventiva II|hygiene-preventive-drafts|new-hygiene-draft/);
});

test('an Oral Surgery only context renders exactly today\'s Oral Surgery view with no Hygiene request', async () => {
	const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read'], contexts: [pair()], drafts: [oralDraft()] });
	assert.deepEqual(result.requests, ['assignments', 'discovery', 'oral-list']);
	assert.match(result.html, /Cirugía Oral I/);
	assert.match(result.html, /Crear nuevo borrador de Cirugía Oral I/);
	assert.match(result.html, /id="new-draft"/);
	assert.doesNotMatch(result.html, /Higiene y Preventiva II|new-hygiene-draft|hygiene-preventive-drafts/);
	assert.doesNotMatch(result.html, /Odontología/);
});

test('a Hygiene only context renders the Hygiene view: create form, hint, list and no Kinesiology or Oral Surgery', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: [hygieneDraft()] });
	assert.deepEqual(result.requests, ['assignments', 'hygiene-discovery', 'hygiene-list']);
	assert.deepEqual(result.hygieneListings, [{ context: { patient_id: patient, subject_id: subject, academic_group_id: group }, page: { limit: 50, offset: 0 } }]);
	assert.match(result.html, /<p class="eyebrow[^"]*">[\s\S]*Higiene y Preventiva II<\/p>/);
	assert.match(result.html, /<form method="POST" action="\?_action=createHygieneDraft|action="[^"]*createHygieneDraft[^"]*"[^>]*id="new-hygiene-draft"|id="new-hygiene-draft"/);
	assert.match(result.html, /Crear nuevo borrador de Higiene y Preventiva II<\/button>/);
	assert.match(result.html, /Cada creación inicia un encuentro clínico nuevo\. Para continuar uno existente, abrilo desde la lista\./);
	for (const [name, value] of [['patient_id', patient], ['subject_id', subject], ['academic_group_id', group], ['assignment_id', '17'], ['limit', '50'], ['offset', '0']]) {
		assert.match(result.html, new RegExp(`<input type="hidden" name="${name}" value="${value}"`));
	}
	assert.match(result.html, /href="\/hygiene-preventive-drafts\/9007199254742001\?assignment_id=17&amp;list_limit=50&amp;list_offset=0"/);
	assert.match(result.html, /Abrir borrador · versión 3 · actualizado /);
	assert.doesNotMatch(result.html, /Ficha kinésica inicial|Cirugía Oral I|Crear nuevo borrador<\/button>|class="clinical-filters"/);
});

test('an empty Hygiene list shows the empty copy without the 50-row notice', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: [] });
	assert.match(result.html, /Todavía no hay borradores de Higiene y Preventiva II para esta asignación\./);
	assert.doesNotMatch(result.html, /Se muestran los 50 borradores más recientes\./);
});

test('the Hygiene list shows the 50-row notice only when the page is full', async () => {
	const full = Array.from({ length: 50 }, (_, index) => hygieneDraft({ id: String(9007199254743000n + BigInt(index)) }));
	const fullPage = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: full });
	assert.match(fullPage.html, /Se muestran los 50 borradores más recientes\./);
	const partial = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: full.slice(0, 49) });
	assert.doesNotMatch(partial.html, /Se muestran los 50 borradores más recientes\./);
});

test('both forms render two sections, Oral Surgery first, each with its own create form and list under the Odontología eyebrow', async () => {
	const result = await renderAssignment({
		permissions: ['oral-surgery-drafts:read', 'hygiene-preventive-drafts:read'], contexts: [pair()], drafts: [oralDraft()],
		hygieneContexts: [pair()], hygieneDrafts: [hygieneDraft()],
	});
	assert.deepEqual(result.requests, ['assignments', 'discovery', 'hygiene-discovery', 'oral-list', 'hygiene-list']);
	assert.match(result.html, /Odontología/);
	const oralAt = result.html.indexOf('Borradores de Cirugía Oral I');
	const hygieneAt = result.html.indexOf('Borradores de Higiene y Preventiva II');
	assert.ok(oralAt > 0 && hygieneAt > oralAt, 'Oral Surgery section first, Hygiene second');
	assert.equal(count(result.html, /id="new-draft"/g), 1);
	assert.equal(count(result.html, /id="new-hygiene-draft"/g), 1);
	assert.match(result.html, /Crear nuevo borrador de Cirugía Oral I<\/button>/);
	assert.match(result.html, /Crear nuevo borrador de Higiene y Preventiva II<\/button>/);
	assert.match(result.html, /href="\/oral-surgery-drafts\/9007199254741061\?/);
	assert.match(result.html, /href="\/hygiene-preventive-drafts\/9007199254742001\?/);
	assert.doesNotMatch(result.html, /Ficha kinésica inicial|Crear nuevo borrador<\/button>/);
});

test('both forms keep the Oral Surgery date filters for the Oral list and show no Kinesiology filter', async () => {
	const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read', 'hygiene-preventive-drafts:read'], contexts: [pair()], hygieneContexts: [pair()] });
	assert.match(result.html, /name="date_from"/);
	assert.doesNotMatch(result.html, /name="evaluation_id"|name="status"/);
});

test('a Hygiene discovery failure shows the shared alert with no create form and no list, and no Kinesiology request', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneFailure: true });
	assert.deepEqual(result.requests, ['assignments', 'hygiene-discovery']);
	assert.match(result.html, /role="alert"[^>]*>[\s\S]*No se pudo determinar qué ficha clínica corresponde a esta asignatura\. No se muestran acciones para evitar crear la ficha equivocada\./);
	assert.doesNotMatch(result.html, /id="new-hygiene-draft"|id="new-draft"|name="patient_id"|Crear nuevo borrador|Abrir borrador/);
});

test('a Hygiene discovery failure with an enabled Oral Surgery pair hides both forms and both lists', async () => {
	const result = await renderAssignment({ permissions: ['oral-surgery-drafts:read', 'hygiene-preventive-drafts:read'], contexts: [pair()], drafts: [oralDraft()], hygieneFailure: true });
	assert.deepEqual(result.requests, ['assignments', 'discovery', 'hygiene-discovery']);
	assert.match(result.html, /No se pudo determinar qué ficha clínica corresponde a esta asignatura/);
	assert.doesNotMatch(result.html, /id="new-draft"|id="new-hygiene-draft"|Abrir borrador|Borradores de/);
});

test('a Hygiene discovery 401 redirects to login and makes no further request', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneStatus: 401 });
	assert.deepEqual(result.requests, ['assignments', 'hygiene-discovery']);
	assert.equal(result.html, LOGIN);
});

test('a Hygiene forbidden discovery shows its permission notice and keeps the Kinesiology view unchanged', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneForbidden: true });
	assert.deepEqual(result.requests, ['assignments', 'hygiene-discovery', ...KINESIOLOGY_REQUESTS]);
	assert.match(result.html, /No tenés permiso para consultar si esta asignatura usa Higiene y Preventiva II\. No se muestran acciones de Higiene y Preventiva II\./);
	assert.match(result.html, /Ficha kinésica inicial/);
	assert.doesNotMatch(result.html, /id="new-hygiene-draft"|Borradores de Higiene/);
});

test('a Hygiene list failure replaces the view with the shared load error and no create form', async () => {
	const result = await renderAssignment({ permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneListFailure: true });
	assert.match(result.html, /No se pudieron cargar las asignaciones y sus fichas/);
	assert.doesNotMatch(result.html, /id="new-hygiene-draft"/);
});

test('a Hygiene create success redirects to the editor with the list coordinates', async () => {
	const result = await renderAssignment({
		permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: [],
		results: { hygiene: { data: { success: true, draft: hygieneDraft({ id: '28' }) } } },
	});
	assert.equal(result.html, 'REDIRECT:/hygiene-preventive-drafts/28?assignment_id=17&list_limit=50&list_offset=0');
});

test('a Hygiene create failure shows the action error and an expired session redirects to login', async () => {
	const failed = await renderAssignment({
		permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: [],
		results: { hygiene: { data: { success: false, uncertain: true, error: 'No se pudo confirmar la creación del borrador. Revisá la lista de borradores antes de volver a intentarlo: cada intento puede crear un encuentro nuevo.' } } },
	});
	assert.match(failed.html, /role="alert"[^>]*>No se pudo confirmar la creación del borrador\./);
	const expired = await renderAssignment({
		permissions: ['hygiene-preventive-drafts:read'], hygieneContexts: [pair()], hygieneDrafts: [],
		results: { hygiene: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.' } } },
	});
	assert.equal(expired.html, LOGIN);
});

test('a Hygiene context with an Oral Surgery status filter keeps the Hygiene section and reports the Oral filter error', async () => {
	const result = await renderAssignment({
		permissions: ['oral-surgery-drafts:read', 'hygiene-preventive-drafts:read'], contexts: [pair()], hygieneContexts: [pair()], hygieneDrafts: [hygieneDraft()],
		url: 'https://fixture.invalid/my-patients/17?limit=50&offset=0&status=draft',
	});
	assert.match(result.html, /Los filtros de Cirugía Oral solo admiten fechas\./);
	assert.match(result.html, /Borradores de Higiene y Preventiva II/);
	assert.doesNotMatch(result.html, /Borradores de Cirugía Oral I/);
});
