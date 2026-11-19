import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

// Student editor, paper consent section (S3, D3, D4 dirty notice): real pods and a compiled Astro page with explicit mocks.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const pagePath = 'src/pages/hygiene-preventive-drafts/[id].astro';
const draftsSpecifier = '../pods/hygiene-preventive-draft/actions/drafts';
const consentModulePath = 'src/pods/hygiene-preventive-draft/actions/consent.ts';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const served = {
	medical_history: { taking_medication: true, taking_medication_detail: 'Losartán', diabetes: false, observations: 'Dolor en encía' },
	odontogram: { 16: { state: 'present', surfaces: { occlusal: ['caries'] } } },
	indices: { ceo_d: { c: 1, e: 0, o: 2, total: 3 }, cpo_d: null },
};
const draftFixture = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: served, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '12345678', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const student = (overrides = {}) => ({
	sub: authorId, username: 'ana', role: 'estudiante', permissions: ['hygiene-preventive-drafts:read', 'hygiene-preventive-drafts:write'], ...overrides,
});
const declarationFixture = (overrides = {}) => ({
	id: '11', draft_id: largeId, signer: 'patient', signer_name: 'Ana Pérez', signer_document: '12345678', declared_by: authorId, declared_at: iso, ...overrides,
});
const historyOf = (...items) => ({ current_declaration_id: items.length ? items[items.length - 1].id : null, declarations: items });
const SAVE_URL = '/_actions/updateHygieneDraft';
const CONSENT_URL = '/_actions/declareHygieneConsent';
const EDIT_URL = `/hygiene-preventive-drafts/${largeId}?assignment_id=17&limit=50&offset=0`;
const UNCERTAIN = 'No se pudo confirmar la declaración. Recargá la página y revisá el historial antes de volver a intentarlo.';
const NAME_ERROR = 'Ingresá el nombre del firmante (hasta 200 caracteres).';

async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}

/** Render the real editor page; every read and the consent action result are recorded or configured here. */
async function renderEditor(options = {}) {
	const { server, importModule } = await loadRegisteredActions(async () => Response.json({}), { realModules: [draftsSpecifier, consentModulePath] });
	const drafts = await importModule('src/pods/hygiene-preventive-draft/actions/drafts.ts');
	const consentModule = await importModule(consentModulePath);
	const hygieneApi = await importModule('src/pods/hygiene-preventive-draft/api.ts');
	const labels = await importModule('src/pods/hygiene-preventive-draft/labels.ts');
	const odontogram = await importModule('src/pods/hygiene-preventive-draft/odontogram.ts');
	const apiClient = await importModule('src/shared/apiClient.ts');
	const kinesiologyApi = await importModule('src/pods/kinesiology-evaluation/api.ts');
	const listCoordinates = await importModule('src/pods/patient-assignment/list-coordinates.ts');
	const clinicalListing = await importModule('src/pods/kinesiology-evolution/listing.ts');
	const reads = [];
	const consentReads = [];
	const saveStub = Object.assign(() => undefined, { toString: () => SAVE_URL });
	const consentStub = Object.assign(() => undefined, { toString: () => CONSENT_URL });
	const actor = options.actor ?? student();
	const Astro = {
		params: { id: largeId }, url: new URL(options.url ?? EDIT_URL, 'https://fixture.invalid'),
		cookies: { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} },
		getActionResult: (action) => (action === saveStub ? options.result : action === consentStub ? options.consentResult : undefined),
		request: new Request('https://fixture.invalid/'), response: { headers: new Headers() },
		redirect: (location) => `REDIRECT:${location}`,
	};
	const mocks = {
		...hygieneApi, ...drafts, ...labels, ...odontogram, ...consentModule,
		actions: { updateHygieneDraft: saveStub, declareHygieneConsent: consentStub },
		HygienePlaqueFields: () => '<div data-plaque-fields></div>',
		HygieneConsentHistory: (_astro, props) => `<ol data-consent-history data-declarations="${props.consent.declarations.length}" data-current="${props.consent.current_declaration_id ?? ''}"></ol>`,
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
			return options.consent ?? historyOf();
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
	const rendered = (await html(exports.default({ createAstro: () => Astro }, {}, {}))).replace(/ class="astro-[a-z0-9]+"/g, '').replace(/ astro-[a-z0-9]+(?=")/g, '');
	return { html: rendered, reads, consentReads, server };
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;
const sectionOf = (text) => text.slice(text.indexOf('id="consent-title"'));

// S3: the section follows the draft form and is not part of it.

test('S3 the consent section follows the draft form as its own section, after the form closes', async () => {
	const page = await renderEditor();
	const formEnd = page.html.indexOf('</form>');
	const title = page.html.indexOf('id="consent-title"');
	assert.ok(formEnd > 0 && title > formEnd, 'consent title after the draft form');
	assert.match(page.html, /<h2 id="consent-title">Consentimiento informado en papel<\/h2>/);
	assert.equal(count(page.html, /<form /g), 2, 'the draft form and the consent form only');
});

test('S3 an eligible author with no declaration sees the signer form and the first-declaration button', async () => {
	const page = await renderEditor();
	const consent = sectionOf(page.html);
	assert.match(consent, /<form method="POST" action="\/_actions\/declareHygieneConsent\?/);
	assert.match(consent, /<input type="hidden" name="id" value="9223372036854775807"/);
	assert.match(consent, /<input type="hidden" name="assignment_id" value="17"/);
	assert.match(consent, /<input type="checkbox" name="paper_signed" value="on" required/);
	assert.match(consent, /Confirmo que existe el consentimiento firmado en papel\. No es una firma electrónica y no se adjunta el documento\./);
	assert.match(consent, /<input type="radio" name="signer" value="patient"/);
	assert.match(consent, /<input type="radio" name="signer" value="parent"/);
	assert.match(consent, /Madre, padre o tutor/);
	assert.match(consent, /<input type="text" name="signer_name"/);
	assert.match(consent, /<input type="text" name="signer_document"/);
	assert.match(consent, /<button id="consent-button" class="button" type="submit">Declarar consentimiento en papel<\/button>/);
	assert.doesNotMatch(consent, /signer" value="patient" checked/);
});

test('S3 with a current declaration the button declares again, and the history renders the stored list', async () => {
	const page = await renderEditor({ consent: historyOf(declarationFixture({ id: '11' }), declarationFixture({ id: '12', signer: 'parent', signer_name: 'Laura Pérez', signer_document: '30123456' })) });
	assert.match(page.html, /data-consent-history data-declarations="2" data-current="12"/);
	assert.match(page.html, /<button id="consent-button" class="button" type="submit">Declarar nuevamente \(corrige la declaración vigente\)<\/button>/);
	assert.deepEqual(page.consentReads, [largeId]);
});

test('S3 a reader who is not the author sees the history and no consent form', async () => {
	const page = await renderEditor({ actor: student({ sub: '77777777-7777-4777-8777-777777777777' }), consent: historyOf(declarationFixture()) });
	assert.match(page.html, /data-consent-history data-declarations="1"/);
	assert.doesNotMatch(page.html, /id="consent-form"/);
	assert.doesNotMatch(page.html, /declareHygieneConsent\?/);
});

test('S3 a history read failure is a section error and the draft still renders', async () => {
	const page = await renderEditor({ consentStatus: 500 });
	assert.match(page.html, /No se pudo cargar el consentimiento/);
	assert.match(page.html, /id="draft-form"/);
	assert.doesNotMatch(page.html, /Borrador no disponible/);
	assert.doesNotMatch(page.html, /declareHygieneConsent\?/);
});

test('S3 a 404 on the history read does not make the draft unavailable', async () => {
	const page = await renderEditor({ consentStatus: 404 });
	assert.match(page.html, /id="draft-form"/);
	assert.match(page.html, /No se pudo cargar el consentimiento/);
});

test('S3 a 401 on the history read redirects to login', async () => {
	const page = await renderEditor({ consentStatus: 401 });
	assert.match(page.html, /^REDIRECT:\/auth\/login\?returnTo=/);
});

// S3: result handling. Success is a redirect before any read; failures keep the typed signer values.

test('S3 a successful declaration redirects with the save return carriers and consent_saved=1, before any read', async () => {
	const page = await renderEditor({ consentResult: { data: { success: true, id: largeId, assignment_id: '17', limit: '50', offset: '0', declaration: declarationFixture() } } });
	assert.equal(page.html, `REDIRECT:/hygiene-preventive-drafts/${largeId}?assignment_id=17&limit=50&offset=0&consent_saved=1`);
	assert.deepEqual(page.reads, []);
	assert.deepEqual(page.consentReads, []);
});

test('S3 the page shows the declared notice after the redirect', async () => {
	const page = await renderEditor({ url: `${EDIT_URL}&consent_saved=1` });
	assert.match(page.html, /<p class="success" role="status">Consentimiento declarado\.<\/p>/);
});

test('S3 a rejected declaration keeps the typed signer values and shows the mapped copy', async () => {
	const page = await renderEditor({
		consentResult: { data: { success: false, uncertain: false, error: NAME_ERROR, values: { signer: 'parent', signer_name: 'Laura Pérez', signer_document: '3012' } } },
	});
	assert.match(page.html, /<p class="notice error" role="alert">Ingresá el nombre del firmante \(hasta 200 caracteres\)\.<\/p>/);
	assert.match(page.html, /<input type="radio" name="signer" value="parent" checked/);
	assert.match(page.html, /<input type="text" name="signer_name" value="Laura Pérez"/);
	assert.match(page.html, /<input type="text" name="signer_document" value="3012"/);
	assert.match(page.html, /<form method="POST" action="\/_actions\/declareHygieneConsent\?/);
});

test('S3 an uncertain declaration says to reload, keeps the typed values and offers no second submit until a reload', async () => {
	const page = await renderEditor({
		consentResult: { data: { success: false, uncertain: true, error: UNCERTAIN, values: { signer: 'patient', signer_name: '', signer_document: '' } } },
	});
	assert.match(page.html, new RegExp(UNCERTAIN));
	assert.doesNotMatch(page.html, /id="consent-form"/);
	assert.doesNotMatch(page.html, /declareHygieneConsent\?/);
});

test('S3 a request the schema refuses shows the input copy in the consent section', async () => {
	const page = await renderEditor({ consentResult: { error: { input: true } } });
	assert.match(page.html, /Revisá los datos del consentimiento\./);
	assert.match(page.html, /id="draft-form"/);
});

test('S3 a patient signer with a name is refused with the D3 copy and the form stays available', async () => {
	const page = await renderEditor({
		consentResult: { data: { success: false, uncertain: false, error: 'Si firma el paciente, dejá vacíos el nombre y el documento del firmante.', values: { signer: 'patient', signer_name: 'Ana Pérez', signer_document: '' } } },
	});
	assert.match(page.html, /Si firma el paciente, dejá vacíos el nombre y el documento del firmante\./);
	assert.match(page.html, /<input type="text" name="signer_name" value="Ana Pérez"/);
	assert.match(page.html, /<form method="POST" action="\/_actions\/declareHygieneConsent\?/);
});

// D4: unsaved edits in the draft disable the consent button (presentation only).

test('D4 the consent button starts enabled, and the dirty notice with the D4 copy is present and hidden', async () => {
	const page = await renderEditor();
	assert.match(page.html, /<p id="dirty-notice" class="notice error" role="status" hidden>Hay cambios sin guardar en el borrador\. Guardalos antes de declarar el consentimiento o registrar procedimientos\.<\/p>/);
	assert.doesNotMatch(page.html, /<button id="consent-button"[^>]*disabled/);
});

test('D4 the page script marks the draft form dirty on input and change and disables the consent button', async () => {
	// Compiled Astro hoists <script> out of the render output, so the wiring is read from the page source.
	const source = await readFile(new URL(pagePath, root), 'utf8');
	assert.match(source, /form\?\.addEventListener\('input', markDirty\)/);
	assert.match(source, /form\?\.addEventListener\('change', markDirty\)/);
	assert.match(source, /consentButton\.disabled = true/);
	assert.match(source, /dirtyNotice\.hidden = false/);
});

test('S3 the declaration action is registered in the action registry', async () => {
	const page = await renderEditor();
	assert.ok(page.server.declareHygieneConsent, 'registered in the server');
});

test('S3 a session that expired while declaring redirects to login', async () => {
	const page = await renderEditor({
		consentResult: { data: { success: false, uncertain: false, error: 'Tu sesión venció. Iniciá sesión nuevamente.', values: { signer: 'patient', signer_name: '', signer_document: '' } } },
	});
	assert.match(page.html, /^REDIRECT:\/auth\/login\?returnTo=/);
});
