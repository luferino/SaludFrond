import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

// Student editor, procedure log section (S4, D4): real pods and a compiled Astro page with explicit mocks.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
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
const today = new Date().toISOString().slice(0, 10);
const EDIT_URL = `/hygiene-preventive-drafts/${largeId}?assignment_id=17&limit=50&offset=0`;
const RETURN = `/hygiene-preventive-drafts/${largeId}?assignment_id=17&limit=50&offset=0`;
const UNCERTAIN_CHANGE = 'No se pudo confirmar el cambio. Recargá la página antes de volver a intentarlo.';
const UNCERTAIN_CREATE = 'No se pudo confirmar el registro. Revisá la lista antes de volver a intentarlo: cada intento puede crear una entrada nueva.';
const GATE = 'Falta declarar el consentimiento en papel antes de registrar procedimientos.';
const STALE = 'El procedimiento cambió en otra pestaña. Se muestra la versión actual; revisalo antes de volver a guardar.';
const APPROVED = 'Este procedimiento ya fue aprobado por un docente y no se puede modificar.';
const DIRTY = 'Hay cambios sin guardar en el borrador. Guardalos antes de declarar el consentimiento o registrar procedimientos.';
const FUTURE = 'La fecha no puede ser posterior a hoy.';
const DESCRIPTION = 'La descripción es obligatoria y admite hasta 1000 caracteres.';

const draftFixture = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: { medical_history: { diabetes: false } }, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '12345678', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const student = (overrides = {}) => ({
	sub: authorId, username: 'ana', role: 'estudiante', permissions: ['hygiene-preventive-drafts:read', 'hygiene-preventive-drafts:write'], ...overrides,
});
const procedure = (overrides = {}) => ({
	id: '21', draft_id: largeId, procedure_date: '2026-11-10', description: 'Profilaxis', author_id: authorId,
	student_name: 'Ana Pérez', version: '4', approved_by: null, teacher_name: null, approved_at: null,
	created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});
const approvedProcedure = (overrides = {}) => procedure({
	id: '22', description: 'Destartraje', version: '5', approved_by: '77777777-7777-4777-8777-777777777777', teacher_name: 'Marta Gómez', approved_at: iso, status: 'approved', ...overrides,
});
const declaration = (overrides = {}) => ({
	id: '11', draft_id: largeId, signer: 'patient', signer_name: 'Ana Pérez', signer_document: '12345678', declared_by: authorId, declared_at: iso, ...overrides,
});
const historyOf = (...items) => ({ current_declaration_id: items.length ? items[items.length - 1].id : null, declarations: items });
const CREATE_URL = '/_actions/createHygieneProcedure';
const UPDATE_URL = '/_actions/updateHygieneProcedure';
const DELETE_URL = '/_actions/deleteHygieneProcedure';
const SAVE_URL = '/_actions/updateHygieneDraft';
const CONSENT_URL = '/_actions/declareHygieneConsent';

async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}

/** A compiled Astro component with the given mocks in place of its imports; the same transform the page uses. */
async function compileComponent(relativePath, mocks) {
	const compiled = (await transform(await readFile(new URL(relativePath, root), 'utf8'), { filename: relativePath })).code;
	const ast = ts.createSourceFile('component.ts', compiled, ts.ScriptTarget.Latest, true);
	let code = compiled;
	const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	return exports.default;
}

/** The procedure section from its heading to the end of the page. */
const sectionOf = (text) => text.slice(text.indexOf('id="procedures-title"'));
/** One form, from its opening tag (found through its id) to its closing tag. */
const formOf = (text, id) => {
	const marker = text.indexOf(`id="${id}"`);
	if (marker < 0) return '';
	return text.slice(text.lastIndexOf('<form', marker), text.indexOf('</form>', marker));
};
const count = (text, pattern) => (text.match(pattern) ?? []).length;

/** Render the real editor page; reads and the procedure action result are recorded or configured here. */
async function renderEditor(options = {}) {
	const { server, importModule } = await loadRegisteredActions(async () => Response.json({}), { realModules: [draftsSpecifier] });
	const drafts = await importModule('src/pods/hygiene-preventive-draft/actions/drafts.ts');
	const consentModule = await importModule('src/pods/hygiene-preventive-draft/actions/consent.ts');
	const procedureModule = await importModule('src/pods/hygiene-preventive-draft/actions/procedures.ts');
	const hygieneApi = await importModule('src/pods/hygiene-preventive-draft/api.ts');
	const labels = await importModule('src/pods/hygiene-preventive-draft/labels.ts');
	const odontogram = await importModule('src/pods/hygiene-preventive-draft/odontogram.ts');
	const apiClient = await importModule('src/shared/apiClient.ts');
	const kinesiologyApi = await importModule('src/pods/kinesiology-evaluation/api.ts');
	const listCoordinates = await importModule('src/pods/patient-assignment/list-coordinates.ts');
	const clinicalListing = await importModule('src/pods/kinesiology-evolution/listing.ts');
	const reads = [];
	const consentReads = [];
	const procedureReads = [];
	const stub = (href) => Object.assign(() => undefined, { toString: () => href });
	const saveStub = stub(SAVE_URL);
	const consentStub = stub(CONSENT_URL);
	const createStub = stub(CREATE_URL);
	const updateStub = stub(UPDATE_URL);
	const deleteStub = stub(DELETE_URL);
	const actor = options.actor ?? student();
	const Astro = {
		params: { id: largeId }, url: new URL(options.url ?? EDIT_URL, 'https://fixture.invalid'),
		cookies: { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} },
		getActionResult: (action) => {
			if (action === saveStub) return options.result;
			if (action === consentStub) return options.consentResult;
			if ([createStub, updateStub, deleteStub].includes(action)) return options.procedureResult;
			return undefined;
		},
		request: new Request('https://fixture.invalid/'), response: { headers: new Headers() },
		redirect: (location) => `REDIRECT:${location}`,
	};
	const mocks = {
		...hygieneApi, ...drafts, ...labels, ...odontogram, ...consentModule, ...procedureModule,
		actions: {
			updateHygieneDraft: saveStub, declareHygieneConsent: consentStub,
			createHygieneProcedure: createStub, updateHygieneProcedure: updateStub, deleteHygieneProcedure: deleteStub,
		},
		HygienePlaqueFields: () => '<div data-plaque-fields></div>',
		HygieneConsentHistory: () => '<div data-consent-history></div>',
		// The real log component, compiled with the page's helpers, so the forms it renders are the ones under test.
		HygieneProcedureLog: async (_result, props) => {
			const component = await compileComponent('src/components/clinical/HygieneProcedureLog.astro', mocks);
			return component({ createAstro: () => ({ props }) }, props, {});
		},
		isInputError: (error) => error?.input === true,
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
			return draftFixture(options.draft ?? {});
		},
		getHygieneConsent: async (draftId) => {
			consentReads.push(draftId);
			if (options.consentStatus) throw new apiClient.ApiError(options.consentStatus, 'backend message');
			return options.consent ?? historyOf(declaration());
		},
		listHygieneProcedures: async (draftId) => {
			procedureReads.push(draftId);
			if (options.procedureStatus) throw new apiClient.ApiError(options.procedureStatus, 'backend message');
			return options.procedures ?? [procedure()];
		},
		$$createAstro: () => ({}), $$createComponent: (component) => component,
		$$render: async (strings, ...values) => { let output = ''; for (let index = 0; index < strings.length; index++) output += strings[index] + await html(values[index]); return output; },
		$$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => Astro }, props, slots) : slots?.default?.() ?? '',
		$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
		$$maybeRenderHead: () => '', $$renderHead: () => '', $$unescapeHTML: (value) => value, $$Fragment: null,
	};
	const compiled = await transform(await readFile(new URL(pagePath, root), 'utf8'), { filename: pagePath });
	const ast = ts.createSourceFile('editor.ts', compiled.code, ts.ScriptTarget.Latest, true);
	let code = compiled.code;
	const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	const rendered = (await html(exports.default({ createAstro: () => Astro }, {}, {}))).replace(/ class="astro-[a-z0-9]+"/g, '').replace(/ astro-[a-z0-9]+(?=")/g, '');
	return { html: rendered, reads, consentReads, procedureReads, server };
}

// S4: the section follows the consent section and renders the log from the procedure read.

test('S4 the procedure section follows the consent section, after its close tag', async () => {
	const page = await renderEditor();
	const consent = page.html.indexOf('id="consent-title"');
	const procedures = page.html.indexOf('id="procedures-title"');
	assert.match(page.html, /<h2 id="procedures-title">Registro de procedimientos<\/h2>/);
	assert.ok(consent > 0 && procedures > page.html.indexOf('</section>', consent), 'procedures after the consent section');
	assert.deepEqual(page.procedureReads, [largeId]);
});

test('S4 the log is rendered with its entries and the editor keeps its draft and consent sections', async () => {
	const page = await renderEditor({ procedures: [procedure(), approvedProcedure()] });
	assert.equal(count(page.html, /Registrado por /g), 2);
	assert.match(page.html, /id="draft-form"/);
	assert.match(page.html, /id="consent-form"/);
});

// S4 / D4: the new-entry form appears only with a current declaration.

test('D4 an eligible author with a current declaration gets the new-entry form with date max, description limit and both fields required', async () => {
	const page = await renderEditor({ procedures: [] });
	const form = formOf(page.html, 'procedure-create-form');
	assert.match(form, /<form method="POST" action="\/_actions\/createHygieneProcedure\?/);
	assert.match(form, new RegExp(`<input type="date" name="procedure_date" max="${today}"[^>]*required`));
	assert.match(form, /<textarea name="description" maxlength="1000" required>/);
	assert.match(form, /<button[^>]*data-procedure-submit[^>]*>Registrar procedimiento<\/button>/);
	assert.doesNotMatch(page.html, new RegExp(GATE));
});

test('D4 without a current declaration there is no new-entry form and the consent gate notice is shown', async () => {
	const page = await renderEditor({ consent: historyOf() });
	assert.doesNotMatch(page.html, /id="procedure-create-form"/);
	assert.match(page.html, /Declará el consentimiento en papel antes de registrar procedimientos\./);
});

test('D4 a consent read failure hides the new-entry form and shows a neutral note, while the entries still render', async () => {
	const page = await renderEditor({ consentStatus: 500 });
	assert.doesNotMatch(page.html, /id="procedure-create-form"/);
	assert.match(page.html, /El registro de procedimientos no está disponible hasta que se pueda verificar el consentimiento\./);
	assert.equal(count(page.html, /Registrado por /g), 1);
	assert.match(page.html, /id="draft-form"/);
});

test('D4 a pending entry keeps its edit form without a current declaration, because editing is not gated', async () => {
	const page = await renderEditor({ consent: historyOf() });
	assert.match(formOf(page.html, 'procedure-edit-21'), /action="\/_actions\/updateHygieneProcedure\?/);
});

// S4 / D4: pending entries get edit and delete forms; approved entries and other readers get none.

test('D4 a pending entry gets an edit form with the version and a delete form with the version and a confirm marker', async () => {
	const page = await renderEditor({ procedures: [procedure({ version: '7' })] });
	const edit = formOf(page.html, 'procedure-edit-21');
	assert.match(edit, /action="\/_actions\/updateHygieneProcedure\?/);
	assert.match(edit, /<input type="hidden" name="procedure_id" value="21"/);
	assert.match(edit, /<input type="hidden" name="expected_version" value="7"/);
	assert.match(edit, /<textarea name="description" maxlength="1000" required>\nProfilaxis<\/textarea>/);
	assert.match(edit, /<button[^>]*data-procedure-submit[^>]*>Guardar procedimiento<\/button>/);
	const remove = formOf(page.html, 'procedure-delete-21');
	assert.match(remove, /action="\/_actions\/deleteHygieneProcedure\?/);
	assert.match(remove, /data-confirm="/);
	assert.match(remove, /<input type="hidden" name="expected_version" value="7"/);
	assert.match(remove, /<button[^>]*data-procedure-submit[^>]*>Eliminar procedimiento<\/button>/);
});

test('D4 an approved entry has no edit or delete form', async () => {
	const page = await renderEditor({ procedures: [approvedProcedure()] });
	assert.doesNotMatch(page.html, /action="\/_actions\/updateHygieneProcedure/);
	assert.doesNotMatch(page.html, /action="\/_actions\/deleteHygieneProcedure/);
});

test('D4 a reader who is not the author sees the entries and no procedure form', async () => {
	const page = await renderEditor({ actor: student({ sub: '77777777-7777-4777-8777-777777777777' }), procedures: [procedure(), approvedProcedure()] });
	assert.equal(count(page.html, /Registrado por /g), 2);
	assert.doesNotMatch(sectionOf(page.html), /<form/);
});

test('D4 a user without the write permission sees the entries and no procedure form', async () => {
	const page = await renderEditor({ actor: student({ permissions: ['hygiene-preventive-drafts:read'] }), procedures: [procedure()] });
	assert.equal(count(page.html, /Registrado por /g), 1);
	assert.doesNotMatch(sectionOf(page.html), /<form/);
});

// S4: a procedure read failure is a section error; the draft and its consent still render.

test('S4 a procedure read failure is a section error and the editable draft still renders', async () => {
	const page = await renderEditor({ procedureStatus: 500 });
	assert.match(page.html, /No se pudo cargar el registro de procedimientos\. El borrador se muestra igual/);
	assert.match(page.html, /id="draft-form"/);
	assert.match(page.html, /Guardar borrador/);
	assert.doesNotMatch(page.html, /Registrado por /);
	assert.doesNotMatch(page.html, /Borrador no disponible/);
});

test('S4 a 401 on the procedure read redirects to login', async () => {
	const page = await renderEditor({ procedureStatus: 401 });
	assert.match(page.html, /^REDIRECT:\/auth\/login\?returnTo=/);
});

// Success is a redirect before any read, with the save return carriers.

test('D4 a successful create redirects with the return carriers and procedure_saved=1, before any read', async () => {
	const page = await renderEditor({ procedureResult: { data: { success: true, action: 'create', id: largeId, assignment_id: '17', limit: '50', offset: '0', procedure_id: '' } } });
	assert.equal(page.html, `REDIRECT:${RETURN}&procedure_saved=1`);
	assert.deepEqual(page.reads, []);
	assert.deepEqual(page.procedureReads, []);
});

test('D4 a successful edit redirects with procedure_saved=1 and a successful delete with procedure_deleted=1', async () => {
	const edit = await renderEditor({ procedureResult: { data: { success: true, action: 'update', id: largeId, assignment_id: '17', limit: '50', offset: '0', procedure_id: '21' } } });
	assert.equal(edit.html, `REDIRECT:${RETURN}&procedure_saved=1`);
	const remove = await renderEditor({ procedureResult: { data: { success: true, action: 'delete', id: largeId, assignment_id: '17', limit: '50', offset: '0', procedure_id: '21' } } });
	assert.equal(remove.html, `REDIRECT:${RETURN}&procedure_deleted=1`);
});

test('D4 the page shows the saved and deleted notices after the redirect', async () => {
	const saved = await renderEditor({ url: `${EDIT_URL}&procedure_saved=1` });
	assert.match(saved.html, /<p class="success" role="status">Procedimiento guardado\.<\/p>/);
	const deleted = await renderEditor({ url: `${EDIT_URL}&procedure_deleted=1` });
	assert.match(deleted.html, /<p class="success" role="status">Procedimiento eliminado\.<\/p>/);
});

// D4: failures keep the typed values; a stale or uncertain edit shows the stored entry instead.

test('D4 a rejected create keeps the typed date and description in the new-entry form', async () => {
	const page = await renderEditor({
		procedureResult: { data: { success: false, action: 'create', procedure_id: '', expected_version: '', uncertain: false, conflict: false, error: FUTURE, values: { procedure_date: '2026-11-09', description: 'Typed text' } } },
	});
	assert.match(page.html, new RegExp(`<p class="notice error" role="alert">${FUTURE}</p>`));
	const form = formOf(page.html, 'procedure-create-form');
	assert.match(form, /name="procedure_date" max="[^"]+" value="2026-11-09"/);
	assert.match(form, /<textarea name="description" maxlength="1000" required>\nTyped text<\/textarea>/);
});

test('D4 a gate rejection on create keeps the typed values and shows the gate copy', async () => {
	const page = await renderEditor({
		procedureResult: { data: { success: false, action: 'create', procedure_id: '', expected_version: '', uncertain: false, conflict: false, error: GATE, values: { procedure_date: '2026-11-09', description: 'Kept' } } },
	});
	assert.match(page.html, new RegExp(GATE));
	assert.match(formOf(page.html, 'procedure-create-form'), /Kept/);
});

test('D4 an uncertain create shows its copy and lists the typed text as unsaved, not in the form', async () => {
	const page = await renderEditor({
		procedureResult: { data: { success: false, action: 'create', procedure_id: '', expected_version: '', uncertain: true, conflict: false, error: UNCERTAIN_CREATE, values: { procedure_date: '2026-11-09', description: 'Maybe saved' } } },
	});
	assert.match(page.html, new RegExp(UNCERTAIN_CREATE));
	assert.doesNotMatch(formOf(page.html, 'procedure-create-form'), /Maybe saved/);
	assert.match(page.html, /Valores no guardados/);
	assert.match(page.html, /Maybe saved/);
});

test('D4 a rejected edit keeps the typed text in that entry only, with the stored version', async () => {
	const page = await renderEditor({
		procedures: [procedure({ id: '21', version: '4' }), procedure({ id: '23', description: 'Other', version: '2' })],
		procedureResult: { data: { success: false, action: 'update', procedure_id: '21', expected_version: '4', uncertain: false, conflict: false, error: DESCRIPTION, values: { procedure_date: '2026-11-10', description: 'Edited text' } } },
	});
	assert.match(page.html, new RegExp(DESCRIPTION));
	const edit = formOf(page.html, 'procedure-edit-21');
	assert.match(edit, /<textarea name="description" maxlength="1000" required>\nEdited text<\/textarea>/);
	assert.match(edit, /<input type="hidden" name="expected_version" value="4"/);
	assert.doesNotMatch(formOf(page.html, 'procedure-edit-23'), /Edited text/);
});

test('D4 a stale edit shows the current version of the entry and lists the typed text as unsaved', async () => {
	const page = await renderEditor({
		procedures: [procedure({ id: '21', version: '5' })],
		procedureResult: { data: { success: false, action: 'update', procedure_id: '21', expected_version: '4', uncertain: false, conflict: true, error: STALE, values: { procedure_date: '2026-11-10', description: 'My change' } } },
	});
	assert.match(page.html, new RegExp(STALE));
	assert.match(formOf(page.html, 'procedure-edit-21'), /<input type="hidden" name="expected_version" value="5"/);
	assert.doesNotMatch(formOf(page.html, 'procedure-edit-21'), /My change/);
	assert.match(page.html, /Valores no guardados/);
	assert.match(page.html, /My change/);
});

test('D4 an uncertain edit shows the reload copy and lists the typed text as unsaved', async () => {
	const page = await renderEditor({
		procedures: [procedure({ id: '21', version: '4' })],
		procedureResult: { data: { success: false, action: 'update', procedure_id: '21', expected_version: '4', uncertain: true, conflict: false, error: UNCERTAIN_CHANGE, values: { procedure_date: '2026-11-10', description: 'Maybe changed' } } },
	});
	assert.match(page.html, new RegExp(UNCERTAIN_CHANGE));
	assert.doesNotMatch(formOf(page.html, 'procedure-edit-21'), /Maybe changed/);
	assert.match(page.html, /Maybe changed/);
});

test('D4 an approved rejection shows the approved copy and the entry is no longer editable', async () => {
	const page = await renderEditor({
		procedures: [approvedProcedure({ id: '21' })],
		procedureResult: { data: { success: false, action: 'update', procedure_id: '21', expected_version: '4', uncertain: false, conflict: false, error: APPROVED, values: { procedure_date: '2026-11-10', description: 'Late' } } },
	});
	assert.match(page.html, new RegExp(APPROVED));
	assert.doesNotMatch(page.html, /action="\/_actions\/updateHygieneProcedure/);
});

test('S4 an invalid form submission shows the input copy for the procedures', async () => {
	const page = await renderEditor({ procedureResult: { error: { input: true } } });
	assert.match(page.html, /Revisá los datos del procedimiento\./);
	assert.match(page.html, /id="draft-form"/);
});

test('S4 an uncertain framework error on a procedure submit says to reload', async () => {
	const page = await renderEditor({ procedureResult: { error: { input: false } } });
	assert.match(page.html, /No se pudo confirmar la operación\. Recargá la página y revisá el registro antes de volver a intentarlo\./);
});

test('S4 a session that expired during a procedure submit redirects to login', async () => {
	const page = await renderEditor({
		procedureResult: { data: { success: false, action: 'create', procedure_id: '', expected_version: '', uncertain: false, conflict: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.', values: { procedure_date: '', description: '' } } },
	});
	assert.match(page.html, /^REDIRECT:\/auth\/login\?returnTo=/);
});

// D4: the dirty notice disables the procedure submit buttons, and delete asks for confirmation.

test('D4 the dirty notice with the D4 copy is present for the procedure section and hidden at first', async () => {
	const page = await renderEditor();
	assert.match(page.html, new RegExp(`<p id="procedure-dirty-notice" class="notice error" role="status" hidden>${DIRTY}</p>`));
});

test('D4 the page script disables consent and procedure submit buttons while the draft is dirty and confirms deletes', async () => {
	// Compiled Astro hoists <script> out of the render output, so the wiring is read from the page source.
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /form\?\.addEventListener\('input', markDirty\)/);
	assert.match(source, /form\?\.addEventListener\('change', markDirty\)/);
	assert.match(source, /querySelectorAll<HTMLButtonElement>\('\[data-procedure-submit\]'\)/);
	assert.match(source, /button\.disabled = true/);
	assert.match(source, /procedureDirtyNotice\.hidden = false/);
	assert.match(source, /querySelectorAll<HTMLFormElement>\('\[data-procedure-form\]'\)/);
	assert.match(source, /const message = procedureForm\.dataset\.confirm/);
	assert.match(source, /if \(message && !confirm\(message\)\)/);
});

test('D4 each procedure form posts once: the submit is ignored while another is in flight', async () => {
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /if \(dirty \|\| procedureForm\.dataset\.submitting === 'true'\)/);
	assert.match(source, /procedureForm\.dataset\.submitting = 'true'/);
});

test('D4 the new-entry, edit and delete buttons each carry the procedure submit marker', async () => {
	const page = await renderEditor();
	assert.equal(count(page.html, /data-procedure-submit/g), 3);
});

test('S4 the procedure action names are registered in the action registry', async () => {
	const page = await renderEditor();
	assert.ok(page.server.createHygieneProcedure, 'create');
	assert.ok(page.server.updateHygieneProcedure, 'update');
	assert.ok(page.server.deleteHygieneProcedure, 'delete');
});
