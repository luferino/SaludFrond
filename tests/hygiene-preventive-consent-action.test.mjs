import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

// Paper consent action for Hygiene and Preventive Dentistry II (S3, D3). The handler runs the D3 local rules before any
// request, revalidates the active assignment and the draft context, sends exactly one POST and maps every outcome to copy.
const root = new URL('../', import.meta.url);
const consentPath = 'src/pods/hygiene-preventive-draft/actions/consent.ts';
const consentSpecifier = '../pods/hygiene-preventive-draft/actions/consent';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const draftPath = `/hygiene-preventive-drafts/${largeId}`;
const consentPathname = `${draftPath}/consent`;
const assignmentPath = '/patient-assignments/mine';
const context = { cookies: { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} } };

const UNCERTAIN = 'No se pudo confirmar la declaración. Recargá la página y revisá el historial antes de volver a intentarlo.';
const PATIENT_WITH_DATA = 'Si firma el paciente, dejá vacíos el nombre y el documento del firmante.';
const NAME_ERROR = 'Ingresá el nombre del firmante (hasta 200 caracteres).';
const DOCUMENT_ERROR = 'El documento del firmante debe tener entre 4 y 8 dígitos.';
const UNDER_18 = 'El paciente es menor de 18 años: debe firmar la madre, el padre o el tutor.';
const DRAFT_UNAVAILABLE = 'El borrador no está disponible en esta asignación.';
const ASSIGNMENT_UNAVAILABLE = 'La asignación ya no está disponible. Volvé a la lista de pacientes.';
const FORBIDDEN = 'No tenés permiso para realizar esta acción.';
const SESSION = 'Tu sesión venció. Iniciá sesión nuevamente.';
const READ_FAILURE = 'No se pudo verificar el borrador. No se guardó ni se envió nada.';
const IDENTIFIER_INVALID = 'El borrador no es válido.';

const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '12345678', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: {}, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
// Server echo: a parent declaration keeps what was sent; a patient declaration carries the patient record snapshot.
const declaration = (overrides = {}) => ({
	id: '12', draft_id: largeId, signer: 'patient', signer_name: 'Ana Pérez', signer_document: '12345678',
	declared_by: authorId, declared_at: iso, ...overrides,
});
const errorBody = (code, message) => ({ error: { code, message } });
// Results cross the vm realm; compare plain copies so prototypes do not take part in the comparison.
const plain = (value) => JSON.parse(JSON.stringify(value));
const echo = ({ body }) => ({
	status: 201,
	body: declaration(body.signer === 'parent' ? { signer: 'parent', signer_name: body.signer_name, signer_document: body.signer_document } : {}),
});
const baseRoutes = (overrides = {}) => ({
	[`GET ${assignmentPath}`]: { body: { items: [assignment()], limit: 50, offset: 0 } },
	[`GET ${draftPath}`]: { body: draft() },
	[`POST ${consentPathname}`]: echo,
	...overrides,
});

/** Real consent module against an isolated fetch; every request is recorded with its JSON body. */
async function environment(routes = baseRoutes()) {
	const requests = [];
	const table = { ...routes };
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, BigInt, atob, btoa, Set, Map,
		fetch: async (href, init = {}) => {
			const method = init.method ?? 'GET';
			const request = { method, url: href };
			if (init.body !== undefined) request.body = JSON.parse(init.body);
			requests.push(request);
			const key = `${method} ${new URL(href).pathname}`;
			const entry = table[key];
			const response = typeof entry === 'function' ? await entry({ url: new URL(href), body: request.body }) : entry;
			if (!response) throw new Error(`Unexpected request ${key}`);
			if (response.network) throw new TypeError('fetch failed');
			return Response.json(response.body ?? {}, { status: response.status ?? 200 });
		},
	});
	const modules = new Map();
	function load(href) {
		if (!modules.has(href)) {
			modules.set(href, (async () => {
				const code = await readFile(new URL(href), 'utf8');
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const mod = new vm.SourceTextModule(output, {
					context: sandbox, identifier: href,
					initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: apiBase }; },
				});
				await mod.link(async (specifier, parent) => {
					if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
					if (specifier === './session') {
						return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
							this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
							this.setExport('clearSession', () => undefined);
						}, { context: sandbox });
					}
					return load(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
				});
				return mod;
			})());
		}
		return modules.get(href);
	}
	const mod = await load(new URL(consentPath, root).href);
	await mod.evaluate();
	return { requests, consent: mod.namespace };
}

const form = (overrides = {}) => ({ id: largeId, assignment_id: '17', limit: '50', offset: '0', paper_signed: 'on', signer: 'patient', ...overrides });
const parent = (overrides = {}) => form({ signer: 'parent', signer_name: 'Laura Pérez', signer_document: '30123456', ...overrides });
const posts = (env) => env.requests.filter((request) => request.method === 'POST');
const declare = (env, input) => env.consent.handleDeclareHygieneConsent(input, context);

test('S3 a patient signer sends exactly paper_signed and signer, once, and returns the declaration with the list coordinates', async () => {
	const env = await environment();
	const result = await declare(env, form());
	assert.equal(result.success, true);
	assert.equal(result.id, largeId);
	assert.equal(result.assignment_id, '17');
	assert.equal(result.limit, '50');
	assert.equal(result.offset, '0');
	assert.equal(result.declaration.signer, 'patient');
	const sent = posts(env);
	assert.equal(sent.length, 1);
	assert.equal(new URL(sent[0].url).pathname, consentPathname);
	assert.deepEqual(sent[0].body, { paper_signed: true, signer: 'patient' });
});

test('S3 a parent signer sends name and document exactly as typed, once', async () => {
	const env = await environment();
	const result = await declare(env, parent({ signer_name: 'Laura  Pérez ' }));
	assert.equal(result.success, true);
	assert.equal(result.declaration.signer_name, 'Laura  Pérez ');
	const sent = posts(env);
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0].body, { paper_signed: true, signer: 'parent', signer_name: 'Laura  Pérez ', signer_document: '30123456' });
});

test('D3 a patient signer with a name or a document is refused before any request, and blank text counts as empty', async () => {
	for (const overrides of [{ signer_name: 'Ana Pérez' }, { signer_document: '12345678' }, { signer_name: '', signer_document: '12345678' }]) {
		const env = await environment();
		const result = await declare(env, form(overrides));
		assert.equal(result.success, false, JSON.stringify(overrides));
		assert.equal(result.uncertain, false);
		assert.equal(result.error, PATIENT_WITH_DATA);
		assert.equal(env.requests.length, 0, JSON.stringify(overrides));
	}
	// Decision not fixed by the spec: whitespace-only text is what the form shows as empty, so it is not sent as a name.
	const env = await environment();
	const result = await declare(env, form({ signer_name: '   ' }));
	assert.equal(result.success, true);
	assert.deepEqual(posts(env)[0].body, { paper_signed: true, signer: 'patient' });
});

test('D3 a parent signer needs a non-blank name of at most 200 characters and a 4 to 8 digit document, checked before any request', async () => {
	const cases = [
		[parent({ signer_document: '123' }), DOCUMENT_ERROR],
		[parent({ signer_document: '123456789' }), DOCUMENT_ERROR],
		[parent({ signer_document: '12a4' }), DOCUMENT_ERROR],
		[parent({ signer_document: '' }), DOCUMENT_ERROR],
		[parent({ signer_name: '   ' }), NAME_ERROR],
		[parent({ signer_name: undefined }), NAME_ERROR],
		[parent({ signer_name: 'a'.repeat(201) }), NAME_ERROR],
	];
	for (const [input, message] of cases) {
		const env = await environment();
		const result = await declare(env, input);
		assert.equal(result.success, false, JSON.stringify(input));
		assert.equal(result.error, message, JSON.stringify(input));
		assert.equal(env.requests.length, 0, JSON.stringify(input));
	}
	const env = await environment();
	assert.equal((await declare(env, parent({ signer_name: 'a'.repeat(200) }))).success, true);
});

test('D3 each backend rejection maps to its copy, keeps the typed signer values and is never retried', async () => {
	const cases = [
		[parent(), 400, 'a parent must sign for a patient under 18', UNDER_18],
		[parent(), 400, 'signer_document must be 4-8 digits', DOCUMENT_ERROR],
		[parent(), 400, 'signer_name must be non-empty text of at most 200 characters without NUL', NAME_ERROR],
		[form(), 400, 'signer_name and signer_document are only accepted for a parent signer', PATIENT_WITH_DATA],
		[parent(), 404, 'hygiene preventive draft was not found', DRAFT_UNAVAILABLE],
		[parent(), 403, "Permission 'hygiene-preventive-drafts:write' required", FORBIDDEN],
		[parent(), 400, 'signer must be patient or parent', 'Revisá los datos del consentimiento.'],
	];
	for (const [input, status, message, copy] of cases) {
		const env = await environment(baseRoutes({ [`POST ${consentPathname}`]: { status, body: errorBody('VALIDATION', message) } }));
		const result = await declare(env, input);
		assert.equal(result.success, false, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(result.error, copy, message);
		assert.equal(posts(env).length, 1, `one POST for ${message}`);
		assert.deepEqual(plain(result.values), { signer: input.signer, signer_name: input.signer_name ?? '', signer_document: input.signer_document ?? '' }, message);
	}
});

test('D3 a 401 is a session notice; a 500 or a dropped connection is uncertain; none of them is retried', async () => {
	const session = await environment(baseRoutes({ [`POST ${consentPathname}`]: { status: 401, body: errorBody('UNAUTHORIZED', 'expired') } }));
	const sessionResult = await declare(session, form());
	assert.equal(sessionResult.error, SESSION);
	assert.equal(sessionResult.uncertain, false);
	assert.equal(posts(session).length, 1);

	const server = await environment(baseRoutes({ [`POST ${consentPathname}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	const serverResult = await declare(server, form());
	assert.equal(serverResult.success, false);
	assert.equal(serverResult.uncertain, true);
	assert.equal(serverResult.error, UNCERTAIN);
	assert.equal(posts(server).length, 1);

	const network = await environment(baseRoutes({ [`POST ${consentPathname}`]: { network: true } }));
	const networkResult = await declare(network, parent());
	assert.equal(networkResult.uncertain, true);
	assert.equal(networkResult.error, UNCERTAIN);
	assert.equal(posts(network).length, 1);
});

test('D3 a success body that does not confirm the sent declaration is uncertain and is not retried', async () => {
	const env = await environment(baseRoutes({
		[`POST ${consentPathname}`]: { status: 201, body: declaration({ signer: 'parent', signer_name: 'Otra Persona', signer_document: '30123456' }) },
	}));
	const result = await declare(env, parent());
	assert.equal(result.success, false);
	assert.equal(result.uncertain, true);
	assert.equal(result.error, UNCERTAIN);
	assert.equal(posts(env).length, 1);
});

test('D3 the assignment must still be active and the draft must match it: no request is sent otherwise', async () => {
	// The list only carries active assignments, so an ended one is absent and the list is parsed as is.
	const ended = await environment(baseRoutes({ [`GET ${assignmentPath}`]: { body: { items: [], limit: 50, offset: 0 } } }));
	assert.equal((await declare(ended, form())).error, ASSIGNMENT_UNAVAILABLE);
	assert.equal(posts(ended).length, 0);

	const other = await environment(baseRoutes({ [`GET ${draftPath}`]: { body: draft({ patient_id: '22222222-3333-4444-8555-666666666666' }) } }));
	assert.equal((await declare(other, form())).error, DRAFT_UNAVAILABLE);
	assert.equal(posts(other).length, 0);

	const missing = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 404, body: errorBody('NOT_FOUND', 'hygiene preventive draft was not found') } }));
	assert.equal((await declare(missing, form())).error, DRAFT_UNAVAILABLE);
	assert.equal(posts(missing).length, 0);

	const unreadable = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	assert.equal((await declare(unreadable, form())).error, READ_FAILURE);
	assert.equal(posts(unreadable).length, 0);
});

test('D3 a malformed draft id or an unconfirmed paper checkbox is refused before any request', async () => {
	const env = await environment();
	const invalid = await declare(env, form({ id: '0' }));
	assert.equal(invalid.error, IDENTIFIER_INVALID);
	assert.equal(env.requests.length, 0);
	const unchecked = await declare(env, form({ paper_signed: undefined }));
	assert.equal(unchecked.success, false);
	assert.equal(env.requests.length, 0);
});

test('S3 the registered action accepts the consent form fields and rejects other shapes', async () => {
	const { server } = await loadRegisteredActions(async () => Response.json({}), { realModules: [consentSpecifier] });
	const schema = server.declareHygieneConsent.input;
	assert.equal(schema.safeParse(form()).success, true);
	assert.equal(schema.safeParse(parent()).success, true);
	assert.equal(schema.safeParse({ ...form(), paper_signed: undefined }).success, false);
	assert.equal(schema.safeParse({ ...form(), paper_signed: 'true' }).success, false);
	assert.equal(schema.safeParse({ ...form(), signer: 'guardian' }).success, false);
	assert.equal(schema.safeParse({ ...form(), expected_version: '3' }).success, false);
	assert.equal(schema.safeParse({ ...form(), id: '0' }).success, false);
});
