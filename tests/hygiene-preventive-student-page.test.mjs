import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { formDataFromHtml, loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

// The student editor page: real pods, compiled Astro template and explicit mocks for the collaborators it reads.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const { formDataToObject } = await import(pathToFileURL(join(dirname(require.resolve('astro/package.json')), 'dist/actions/runtime/server.js')));
const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/hygiene-preventive-drafts/[id].astro';
const draftsSpecifier = '../pods/hygiene-preventive-draft/actions/drafts';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const served = {
	medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', diabetes: false, observations: 'Dolor en encía' },
	odontogram: { 16: { state: 'present', surfaces: { occlusal: ['caries'] } }, 36: { state: 'to_extract' } },
	indices: { ceo_d: { c: 1, e: 0, o: 2, total: 3 }, cpo_d: null },
};
const draftFixture = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: served, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const student = (overrides = {}) => ({
	sub: authorId, username: 'ana', role: 'estudiante', permissions: ['hygiene-preventive-drafts:read', 'hygiene-preventive-drafts:write'], ...overrides,
});
const SAVE_URL = '/_actions/updateHygieneDraft';
const EDIT_URL = `/hygiene-preventive-drafts/${largeId}?assignment_id=17&limit=50&offset=0`;

async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}

/** Render the real editor page with isolated collaborators; every draft read is recorded. */
async function renderEditor(options = {}) {
	const { server, importModule } = await loadRegisteredActions(async () => Response.json({}), { realModules: [draftsSpecifier] });
	const drafts = await importModule('src/pods/hygiene-preventive-draft/actions/drafts.ts');
	const hygieneApi = await importModule('src/pods/hygiene-preventive-draft/api.ts');
	const consentModule = await importModule('src/pods/hygiene-preventive-draft/actions/consent.ts');
	const procedureModule = await importModule('src/pods/hygiene-preventive-draft/actions/procedures.ts');
	const labels = await importModule('src/pods/hygiene-preventive-draft/labels.ts');
	const odontogram = await importModule('src/pods/hygiene-preventive-draft/odontogram.ts');
	const apiClient = await importModule('src/shared/apiClient.ts');
	const kinesiologyApi = await importModule('src/pods/kinesiology-evaluation/api.ts');
	const listCoordinates = await importModule('src/pods/patient-assignment/list-coordinates.ts');
	const clinicalListing = await importModule('src/pods/kinesiology-evolution/listing.ts');
	const reads = [];
	const consentReads = [];
	const procedureReads = [];
	const actionStub = Object.assign(() => undefined, { toString: () => SAVE_URL });
	const actor = options.actor ?? student();
	const token = 'session-token';
	const Astro = {
		params: { id: largeId }, url: new URL(options.url ?? EDIT_URL, 'https://fixture.invalid'),
		cookies: { get: (name) => (name === 'session' ? { value: token } : undefined), set() {}, delete() {} },
		getActionResult: (action) => (action === actionStub ? options.result : undefined),
		request: new Request('https://fixture.invalid/'), response: { headers: new Headers() },
		redirect: (location) => `REDIRECT:${location}`,
	};
	const plaqueProps = [];
	const mocks = {
		...hygieneApi, ...drafts, ...labels, ...odontogram, ...consentModule, ...procedureModule,
		actions: {
			updateHygieneDraft: actionStub,
			declareHygieneConsent: Object.assign(() => undefined, { toString: () => '/_actions/declareHygieneConsent' }),
			createHygieneProcedure: Object.assign(() => undefined, { toString: () => '/_actions/createHygieneProcedure' }),
			updateHygieneProcedure: Object.assign(() => undefined, { toString: () => '/_actions/updateHygieneProcedure' }),
			deleteHygieneProcedure: Object.assign(() => undefined, { toString: () => '/_actions/deleteHygieneProcedure' }),
		},
		HygienePlaqueFields: (_astro, props) => { plaqueProps.push(props); return '<div data-plaque-fields></div>'; },
		HygieneConsentHistory: () => '<div data-consent-history></div>',
		HygieneProcedureLog: () => '<ol data-procedure-log></ol>',
		listHygieneProcedures: async (draftId) => {
			procedureReads.push(draftId);
			if (options.procedureStatus) throw new apiClient.ApiError(options.procedureStatus, 'backend message');
			return [];
		},
		getHygieneConsent: async (draftId) => {
			consentReads.push(draftId);
			if (options.consentStatus) throw new apiClient.ApiError(options.consentStatus, 'expired');
			return { current_declaration_id: null, declarations: [] };
		},
		isInputError: () => false,
		ApiError: apiClient.ApiError,
		Layout: null, Fragment: null,
		decodeJwt: () => actor,
		listAssignedPatients: async (page) => ({ items: options.assignments ?? [assignment()], limit: page.limit, offset: page.offset }),
		parseAssignmentListCoordinates: listCoordinates.parseAssignmentListCoordinates,
		assignmentListCarrier: listCoordinates.assignmentListCarrier,
		assignmentListQuery: listCoordinates.assignmentListQuery,
		clinicalFilterCarrier: clinicalListing.clinicalFilterCarrier,
		actionHrefWithContext: kinesiologyApi.actionHrefWithContext,
		getHygieneDraft: async (id) => {
			reads.push(id);
			if (options.readStatus) throw new apiClient.ApiError(options.readStatus, 'expired');
			return draftFixture(options.draft ?? {});
		},
		$$createAstro: () => ({}), $$createComponent: (component) => component,
		$$render: async (strings, ...values) => { let output = ''; for (let index = 0; index < strings.length; index++) output += strings[index] + await html(values[index]); return output; },
		$$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => Astro }, props, slots) : slots?.default?.() ?? '',
		$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
		$$maybeRenderHead: () => '', $$renderHead: () => '', $$unescapeHTML: (value) => value, $$Fragment: null,
	};
	const result = await transform(await readFile(new URL(pagePath, root), 'utf8'), { filename: pagePath });
	const ast = ts.createSourceFile('editor.ts', result.code, ts.ScriptTarget.Latest, true);
	let code = result.code;
	const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	// The compiler adds a scoped `astro-*` class to styled elements; assertions read the page's own classes and attributes.
	const rendered = (await html(exports.default({ createAstro: () => Astro }, {}, {}))).replace(/ class="astro-[a-z0-9]+"/g, '').replace(/ astro-[a-z0-9]+(?=")/g, '');
	return { html: rendered, reads, consentReads, procedureReads, server, importModule, plaqueProps };
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;

// D1: availability and eligibility.

test('D1 the editor is unavailable when the assignment is no longer active, and the draft is not read', async () => {
	const page = await renderEditor({ assignments: [] });
	assert.match(page.html, /Borrador no disponible/);
	assert.deepEqual(page.reads, []);
});

test('D1 a draft whose patient or origin differs from the assignment is unavailable', async () => {
	for (const draft of [{ patient_id: '22222222-3333-4444-8555-666666666666' }, { origin_subject_id: '22222222-3333-4444-8555-666666666666' }, { origin_group_id: '22222222-3333-4444-8555-666666666666' }]) {
		const page = await renderEditor({ draft });
		assert.match(page.html, /Borrador no disponible/, JSON.stringify(draft));
		assert.doesNotMatch(page.html, /id="draft-form"/, JSON.stringify(draft));
		assert.equal(page.reads.length, 1);
	}
});

test('D1 the author with the write permission sees an editable form with a submit button', async () => {
	const page = await renderEditor();
	assert.match(page.html, /<form method="POST" action="\/_actions\/updateHygieneDraft\?/);
	assert.match(page.html, /id="draft-form"/);
	assert.match(page.html, /<button class="button" type="submit">Guardar borrador<\/button>/);
	assert.doesNotMatch(page.html, /<fieldset disabled/);
});

test('D1 a non-author or a user without the write permission sees the same form disabled and without a submit button', async () => {
	for (const actor of [student({ sub: '77777777-7777-4777-8777-777777777777' }), student({ permissions: ['hygiene-preventive-drafts:read'] }), student({ role: 'teacher' })]) {
		const page = await renderEditor({ actor });
		assert.match(page.html, /id="draft-form"/);
		assert.match(page.html, /<fieldset disabled/);
		assert.doesNotMatch(page.html, /Guardar borrador<\/button>/);
		assert.match(page.html, /Este borrador se muestra en modo de solo lectura/);
	}
});

// D2: native controls for every tooth, medical history and indices.

test('D2 the odontogram renders native controls for all 52 teeth in chart order without JavaScript', async () => {
	const page = await renderEditor();
	assert.equal(count(page.html, /<fieldset class="tooth"/g), 52);
	for (const code of ['11', '18', '21', '48', '51', '85']) assert.match(page.html, new RegExp(`data-tooth="${code}"`));
	assert.equal(count(page.html, /name="odontogram\.\d+\.state"/g), 52 * 4);
});

test('D2 each tooth has a state radio group with an unrecorded option and five faces with caries and filled checkboxes', async () => {
	const page = await renderEditor();
	assert.match(page.html, /<input type="radio" name="odontogram\.16\.state" value=""[ >]/);
	assert.match(page.html, /<input type="radio" name="odontogram\.16\.state" value="present" checked/);
	for (const face of ['occlusal', 'mesial', 'distal', 'vestibular', 'lingual']) {
		assert.match(page.html, new RegExp(`<input type="checkbox" name="odontogram\\.16\\.${face}" value="caries"`));
		assert.match(page.html, new RegExp(`<input type="checkbox" name="odontogram\\.16\\.${face}" value="filled"`));
	}
	assert.equal(count(page.html, /name="odontogram\.16\.occlusal" value="caries" checked/g), 1);
});

test('D2 the faces of an absent tooth are rendered disabled and the stored marks of other teeth stay checked', async () => {
	const page = await renderEditor({ draft: { content: { odontogram: { 18: { state: 'absent', surfaces: {} } } } } });
	assert.match(page.html, /name="odontogram\.18\.occlusal" value="caries"[^>]*disabled/);
	assert.doesNotMatch(page.html, /name="odontogram\.16\.occlusal" value="caries"[^>]*disabled/);
});

test('D2 the medical history renders each yes/no select, its detail text and the free-text fields in contract order', async () => {
	const page = await renderEditor();
	assert.equal(count(page.html, /<select name="medical_history\.[a-z_]+"/g), 14);
	assert.match(page.html, /<select name="medical_history\.taking_medication">[\s\S]*?<option value="true" selected>Sí<\/option>/);
	assert.match(page.html, /<select name="medical_history\.diabetes">[\s\S]*?<option value="false" selected>No<\/option>/);
	assert.match(page.html, /<textarea name="medical_history\.taking_medication_detail">\nLosartán<\/textarea>/);
	assert.match(page.html, /<textarea name="medical_history\.treating_physician">\n?<\/textarea>/);
	assert.match(page.html, /<textarea name="medical_history\.observations">\nDolor en encía<\/textarea>/);
});

test('D2 the indices render a number input per component, and the stored total is read-only for loaded indices only', async () => {
	const page = await renderEditor();
	assert.match(page.html, /<input type="number" name="indices\.ceo_d\.c" value="1" min="0" step="1"/);
	assert.match(page.html, /<input type="number" name="indices\.cpo_d\.c" value="" min="0" step="1"/);
	assert.match(page.html, /Total calculado por el servidor: 3/);
	assert.equal(count(page.html, /Total calculado por el servidor/g), 1);
});

// D4: result handling in the editor.

test('D4 a successful save redirects to the editor with the list coordinates, before any read', async () => {
	const page = await renderEditor({ result: { data: { success: true, id: largeId, assignment_id: '17', limit: '50', offset: '0', draft: draftFixture({ version: '4' }) } } });
	assert.equal(page.html, `REDIRECT:/hygiene-preventive-drafts/${largeId}?assignment_id=17&limit=50&offset=0&saved=1`);
	assert.deepEqual(page.reads, []);
});

test('D4 the saved notice appears after the redirect', async () => {
	const page = await renderEditor({ url: `${EDIT_URL}&saved=1` });
	assert.match(page.html, /Borrador guardado\./);
});

test('D4 a conflict shows the stored version in the form with the submitted values listed read-only and never resubmitted', async () => {
	const page = await renderEditor({
		draft: { version: '5' },
		result: { data: { success: false, uncertain: false, conflict: true, error: 'Otra pestaña o persona guardó una versión más nueva. Se muestra la versión actual; tus valores no guardados quedan abajo para copiarlos.', expected_version: '3', values: { 'medical_history.diabetes': 'true', 'medical_history.observations': 'Nuevo texto' } } },
	});
	assert.match(page.html, /Otra pestaña o persona guardó una versión más nueva/);
	assert.match(page.html, /name="expected_version" value="5"/);
	const unsaved = page.html.match(/<section class="preserved" aria-labelledby="unsaved-title">[\s\S]*?<\/section>/)?.[0] ?? '';
	assert.match(unsaved, /<dd>Nuevo texto<\/dd>/);
	assert.match(unsaved, /<dd>Sí<\/dd>/);
	assert.match(page.html, /<select name="medical_history\.diabetes">[\s\S]*?<option value="false" selected>No<\/option>/);
});

test('D4 another failure keeps the submitted values and the same expected_version', async () => {
	const page = await renderEditor({
		result: { data: { success: false, uncertain: false, conflict: false, error: 'Revisá los datos del borrador.', expected_version: '3', values: { 'medical_history.diabetes': 'true', 'medical_history.observations': 'Texto enviado' } } },
	});
	assert.match(page.html, /Revisá los datos del borrador\./);
	assert.match(page.html, /name="expected_version" value="3"/);
	assert.match(page.html, /<select name="medical_history\.diabetes">[\s\S]*?<option value="true" selected>Sí<\/option>/);
	assert.match(page.html, /<textarea name="medical_history\.observations">\nTexto enviado<\/textarea>/);
});

test('D4 an uncertain save tells the student to reload before editing again', async () => {
	const page = await renderEditor({
		result: { data: { success: false, uncertain: true, conflict: false, error: 'No se pudo confirmar el guardado. Recargá la página para ver la versión guardada antes de volver a editar.', expected_version: '3', values: {} } },
	});
	assert.match(page.html, /No se pudo confirmar el guardado\. Recargá la página/);
});

test('D4 an expired session during save redirects to login', async () => {
	const page = await renderEditor({
		result: { data: { success: false, uncertain: false, conflict: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.', expected_version: '3', values: {} } },
	});
	assert.equal(page.html, `REDIRECT:/auth/login?returnTo=${encodeURIComponent(EDIT_URL)}`);
});

test('D4 an expired session while reading the draft redirects to login', async () => {
	const page = await renderEditor({ readStatus: 401 });
	assert.equal(page.html, `REDIRECT:/auth/login?returnTo=${encodeURIComponent(EDIT_URL)}`);
});

// Rendered controls through the registered schema.

test('the controls the editor renders post through the registered updateHygieneDraft schema, with both marks on one face', async () => {
	const page = await renderEditor({ draft: { content: { medical_history: { diabetes: false }, indices: { ceo_d: { c: 1, e: 0, o: 2, total: 3 } }, odontogram: { 11: { state: 'present', surfaces: { occlusal: ['caries', 'filled'] } }, 18: { state: 'absent', surfaces: {} } } } } });
	const { data } = formDataFromHtml(page.html, 'draft-form');
	const input = page.server.updateHygieneDraft.input;
	const parsed = input.safeParse(formDataToObject(data, input));
	assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
	assert.deepEqual(parsed.data['odontogram.11.occlusal'], ['caries', 'filled']);
	assert.deepEqual(parsed.data['odontogram.18.occlusal'], [], 'disabled faces are not posted');
	assert.equal(parsed.data['medical_history.diabetes'], 'false');
	assert.equal(parsed.data['indices.ceo_d.c'], '1');
});

test('the editor page does not import the teacher read-only component', async () => {
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.doesNotMatch(source, /HygieneReadOnly/);
});

test('odontogram chart styles reach the nodes the client script creates, which carry no scope attribute', async () => {
	const file = 'src/pages/hygiene-preventive-drafts/[id].astro';
	const source = await readFile(new URL(file, root), 'utf8');
	const { css } = await transform(source, { filename: file, scopedStyleStrategy: 'attribute' });
	const styles = css.join('\n');
	// Scoped selectors would require data-astro-cid-* on these script-created nodes and never match.
	const scoped = styles.match(/(?:\.chart|\.row|\.row-label|\.pick|\.inspector|\.teeth|\.nav|svg\.t|\.t|\.mark|\.face\.(?:caries|filled|both))\[data-astro-cid[^\]]*\]/g) ?? [];
	assert.deepEqual(scoped, []);
	// A fieldset grows to its min-content width by default; the 16-tooth row must scroll inside the chart, not widen the page.
	assert.match(styles, /\.odontogram\[data-astro-cid[^\]]*\]\{[^}]*min-inline-size:0/);
	assert.match(styles, /\.odontogram\[data-astro-cid[^\]]*\] \.chart\{[^}]*overflow-x:auto/);
	for (const selector of ['.chart', '.pick', 'svg.t .face.caries', 'svg.t .face.filled', 'svg.t .face.both', 'svg.t .mark.absent', '.inspector']) {
		assert.match(styles, new RegExp(String.raw`\.odontogram\[data-astro-cid[^\]]*\] ` + selector.replaceAll('.', String.raw`\.`)), selector);
	}
});

// S1: the plaque fields component receives the stored plaque and the editability, and renders after Índices inside the form.
const plaqueStored = {
	loe_silness: { teeth: { 16: { distal: 2, vestibular: 2, mesial: 2, lingual: 1 } }, average: 1.75, category: 'abundant' },
	oleary: { teeth: { 11: { mesial: true, distal: false, vestibular: false, lingual: false } }, stained_surfaces: 1, present_surfaces: 4, percentage: 25, category: 'good' },
};

test('D2 the plaque fields receive the stored plaque and editability, and render inside the form after the indices', async () => {
	const page = await renderEditor({ draft: { content: { ...served, plaque: plaqueStored } } });
	assert.equal(page.plaqueProps.length, 1);
	assert.deepEqual(page.plaqueProps[0].stored, plaqueStored);
	assert.equal(page.plaqueProps[0].editable, true);
	assert.equal(typeof page.plaqueProps[0].values, 'object');
	const form = page.html.indexOf('id="draft-form"');
	const indices = page.html.indexOf('class="indices"');
	const plaqueFields = page.html.indexOf('data-plaque-fields');
	assert.ok(form < indices && indices < plaqueFields && plaqueFields < page.html.indexOf('</form>', form));
});

test('D2 a draft without plaque passes an undefined stored plaque, and a read-only user gets editable false', async () => {
	const page = await renderEditor();
	assert.equal(page.plaqueProps[0].stored, undefined);
	const readOnly = await renderEditor({ actor: student({ permissions: ['hygiene-preventive-drafts:read'] }), draft: { content: { ...served, plaque: plaqueStored } } });
	assert.equal(readOnly.plaqueProps[0].editable, false);
	assert.deepEqual(readOnly.plaqueProps[0].stored, plaqueStored);
});

// S3: the consent read is separate from the draft read; its failure never hides the editable draft.

test('S3 a consent read failure is a section error and the editable draft still renders', async () => {
	const page = await renderEditor({ consentStatus: 500 });
	assert.match(page.html, /id="draft-form"/);
	assert.match(page.html, /<button class="button" type="submit">Guardar borrador<\/button>/);
	assert.match(page.html, /No se pudo cargar el consentimiento/);
	assert.deepEqual(page.consentReads, [largeId]);
});

// S4: the procedure read is separate from the draft read; its failure never hides the editable draft.

test('S4 a procedure read failure is a section error and the editable draft still renders', async () => {
	const page = await renderEditor({ procedureStatus: 500 });
	assert.match(page.html, /id="draft-form"/);
	assert.match(page.html, /<button class="button" type="submit">Guardar borrador<\/button>/);
	assert.match(page.html, /No se pudo cargar el registro de procedimientos/);
	assert.deepEqual(page.procedureReads, [largeId]);
});
