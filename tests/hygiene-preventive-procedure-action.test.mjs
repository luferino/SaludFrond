import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

// Procedure log actions for Hygiene and Preventive Dentistry II (S4, D4). Each handler revalidates the assignment and the
// draft, refuses locally what the list already proves (gone, approved, stale), sends at most one write and maps every
// outcome to copy. Real modules run in one vm context; every request is recorded.
const root = new URL('../', import.meta.url);
const procedurePath = 'src/pods/hygiene-preventive-draft/actions/procedures.ts';
const procedureSpecifier = '../pods/hygiene-preventive-draft/actions/procedures';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const procedureId = '21';
const iso = '2026-11-06T12:00:00.000Z';
const draftPath = `/hygiene-preventive-drafts/${largeId}`;
const proceduresPath = `${draftPath}/procedures`;
const assignmentPath = '/patient-assignments/mine';
const context = { cookies: { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} } };

const COPY = {
	identifierInvalid: 'El procedimiento o el borrador no es válido.',
	dateInvalid: 'Ingresá una fecha válida.',
	dateFuture: 'La fecha no puede ser posterior a hoy.',
	description: 'La descripción es obligatoria y admite hasta 1000 caracteres.',
	gate: 'Falta declarar el consentimiento en papel antes de registrar procedimientos.',
	stale: 'El procedimiento cambió en otra pestaña. Se muestra la versión actual; revisalo antes de volver a guardar.',
	approved: 'Este procedimiento ya fue aprobado por un docente y no se puede modificar.',
	gone: 'El procedimiento ya no está en el registro. Recargá la página para ver la lista actual.',
	createUncertain: 'No se pudo confirmar el registro. Revisá la lista antes de volver a intentarlo: cada intento puede crear una entrada nueva.',
	changeUncertain: 'No se pudo confirmar el cambio. Recargá la página antes de volver a intentarlo.',
	assignmentUnavailable: 'La asignación ya no está disponible. Volvé a la lista de pacientes.',
	draftUnavailable: 'El borrador no está disponible en esta asignación.',
	forbidden: 'No tenés permiso para realizar esta acción.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	badRequest: 'Revisá los datos del procedimiento.',
	readFailure: 'No se pudo verificar el borrador. No se guardó ni se envió nada.',
};

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
const entry = (overrides = {}) => ({
	id: procedureId, draft_id: largeId, procedure_date: '2026-11-10', description: 'Profilaxis y educación', author_id: authorId,
	student_name: 'Ana Pérez', version: '4', approved_by: null, teacher_name: null, approved_at: null,
	created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});
const approvedEntry = () => entry({ version: '5', approved_by: '77777777-7777-4777-8777-777777777777', teacher_name: 'Marta Gómez', approved_at: iso, status: 'approved' });
const errorBody = (code, message) => ({ error: { code, message } });
const plain = (value) => JSON.parse(JSON.stringify(value));
const listOf = (...items) => ({ body: { items } });
const baseRoutes = (overrides = {}) => ({
	[`GET ${assignmentPath}`]: { body: { items: [assignment()], limit: 50, offset: 0 } },
	[`GET ${draftPath}`]: { body: draft() },
	[`GET ${proceduresPath}`]: listOf(entry()),
	[`POST ${proceduresPath}`]: ({ body }) => ({ status: 201, body: entry({ procedure_date: body.procedure_date, description: body.description }) }),
	[`PATCH ${proceduresPath}/${procedureId}`]: ({ body }) => ({
		body: entry({ procedure_date: body.procedure_date, description: body.description, version: String(BigInt(body.expected_version) + 1n) }),
	}),
	[`DELETE ${proceduresPath}/${procedureId}`]: { status: 204 },
	...overrides,
});

/** Real procedure module against an isolated fetch; every request is recorded with its method, path, query and JSON body. */
async function environment(routes = baseRoutes()) {
	const requests = [];
	const table = { ...routes };
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, BigInt, atob, btoa, Set, Map,
		fetch: async (href, init = {}) => {
			const method = init.method ?? 'GET';
			const request = { method, url: href, path: new URL(href).pathname, query: new URL(href).search };
			if (init.body !== undefined) request.body = JSON.parse(init.body);
			requests.push(request);
			const key = `${method} ${new URL(href).pathname}`;
			const entryRoute = table[key];
			const response = typeof entryRoute === 'function' ? await entryRoute({ url: new URL(href), body: request.body }) : entryRoute;
			if (!response) throw new Error(`Unexpected request ${key}`);
			if (response.network) throw new TypeError('fetch failed');
			if (response.status === 204) return new Response(null, { status: 204 });
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
	const mod = await load(new URL(procedurePath, root).href);
	await mod.evaluate();
	return { requests, procedures: mod.namespace };
}

const writes = (env) => env.requests.filter((request) => request.method !== 'GET');
const base = { id: largeId, assignment_id: '17', limit: '50', offset: '0' };
const createForm = (overrides = {}) => ({ ...base, procedure_date: '2026-11-10', description: 'Profilaxis y educación', ...overrides });
const updateForm = (overrides = {}) => ({ ...base, procedure_id: procedureId, expected_version: '4', procedure_date: '2026-11-10', description: 'Profilaxis y educación', ...overrides });
const deleteForm = (overrides = {}) => ({ ...base, procedure_id: procedureId, expected_version: '4', ...overrides });
const create = (env, input) => env.procedures.handleCreateHygieneProcedure(input, context);
const update = (env, input) => env.procedures.handleUpdateHygieneProcedure(input, context);
const remove = (env, input) => env.procedures.handleDeleteHygieneProcedure(input, context);

// S4 create: one POST with exactly the two fields, and the list coordinates back.

test('S4 create sends one POST with exactly procedure_date and description and returns the coordinates', async () => {
	const env = await environment();
	const result = await create(env, createForm());
	assert.equal(result.success, true);
	assert.equal(result.action, 'create');
	assert.equal(result.id, largeId);
	assert.equal(result.assignment_id, '17');
	assert.equal(result.limit, '50');
	assert.equal(result.offset, '0');
	const sent = writes(env);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, 'POST');
	assert.equal(sent[0].path, proceduresPath);
	assert.deepEqual(sent[0].body, { procedure_date: '2026-11-10', description: 'Profilaxis y educación' });
});

test('S4 create stores the description exactly as typed, surrounding whitespace included', async () => {
	const env = await environment();
	await create(env, createForm({ description: '  Limpieza\r\nsupragingival  ' }));
	assert.deepEqual(writes(env)[0].body, { procedure_date: '2026-11-10', description: '  Limpieza\r\nsupragingival  ' });
});

// Local refusals: format and text are checked before any request.

test('S4 create refuses an invalid date or blank text locally and sends nothing', async () => {
	const cases = [
		[createForm({ procedure_date: '2026-02-30' }), COPY.dateInvalid],
		[createForm({ procedure_date: '26-11-10' }), COPY.dateInvalid],
		[createForm({ procedure_date: undefined }), COPY.dateInvalid],
		[createForm({ description: '   ' }), COPY.description],
		[createForm({ description: undefined }), COPY.description],
		[createForm({ description: 'a'.repeat(1001) }), COPY.description],
		[createForm({ description: 'nul\u0000' }), COPY.description],
	];
	for (const [input, message] of cases) {
		const env = await environment();
		const result = await create(env, input);
		assert.equal(result.success, false, JSON.stringify(input));
		assert.equal(result.error, message, JSON.stringify(input));
		assert.equal(env.requests.length, 0, JSON.stringify(input));
	}
	const env = await environment();
	assert.equal((await create(env, createForm({ description: 'a'.repeat(1000) }))).success, true);
});

test('S4 a malformed draft id is refused before any request', async () => {
	const env = await environment();
	const result = await create(env, createForm({ id: '0' }));
	assert.equal(result.error, COPY.identifierInvalid);
	assert.equal(env.requests.length, 0);
});

// Backend rejections: each D4 message keeps its copy and the typed values; one POST, never retried.

test('D4 each backend rejection of create maps to its copy, keeps the typed values and is never retried', async () => {
	const cases = [
		[409, 'signed paper consent is required before logging procedures', COPY.gate],
		[400, 'procedure_date cannot be in the future', COPY.dateFuture],
		[400, 'procedure_date must be a valid YYYY-MM-DD date', COPY.dateInvalid],
		[400, 'description must be non-empty text of at most 1000 characters without NUL', COPY.description],
		[400, 'allowed fields: procedure_date, description', COPY.badRequest],
		[403, "Permission 'hygiene-preventive-drafts:write' required", COPY.forbidden],
		[404, 'hygiene preventive draft was not found', COPY.draftUnavailable],
	];
	for (const [status, message, copy] of cases) {
		const env = await environment(baseRoutes({ [`POST ${proceduresPath}`]: { status, body: errorBody('VALIDATION', message) } }));
		const result = await create(env, createForm());
		assert.equal(result.success, false, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(result.error, copy, message);
		assert.equal(writes(env).length, 1, `one write for ${message}`);
		assert.deepEqual(plain(result.values), { procedure_date: '2026-11-10', description: 'Profilaxis y educación' }, message);
	}
});

test('D4 a session that expired while creating is a session notice', async () => {
	const env = await environment(baseRoutes({ [`POST ${proceduresPath}`]: { status: 401, body: errorBody('UNAUTHORIZED', 'expired') } }));
	const result = await create(env, createForm());
	assert.equal(result.error, COPY.session);
	assert.equal(result.uncertain, false);
	assert.equal(writes(env).length, 1);
});

test('D4 a 500, a dropped connection or an unconfirmed answer on create is uncertain and is not retried', async () => {
	const server = await environment(baseRoutes({ [`POST ${proceduresPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	const serverResult = await create(server, createForm());
	assert.equal(serverResult.uncertain, true);
	assert.equal(serverResult.error, COPY.createUncertain);
	assert.equal(writes(server).length, 1);

	const network = await environment(baseRoutes({ [`POST ${proceduresPath}`]: { network: true } }));
	const networkResult = await create(network, createForm());
	assert.equal(networkResult.uncertain, true);
	assert.equal(writes(network).length, 1);

	const unconfirmed = await environment(baseRoutes({ [`POST ${proceduresPath}`]: { status: 201, body: entry({ procedure_date: '2026-11-09', description: 'Otra' }) } }));
	const unconfirmedResult = await create(unconfirmed, createForm());
	assert.equal(unconfirmedResult.uncertain, true);
	assert.equal(unconfirmedResult.error, COPY.createUncertain);
	assert.equal(writes(unconfirmed).length, 1);
});

// Guards: the assignment and the draft context are checked before any write.

test('S4 create with an ended assignment, another patient or an unreadable draft sends no write', async () => {
	const ended = await environment(baseRoutes({ [`GET ${assignmentPath}`]: { body: { items: [], limit: 50, offset: 0 } } }));
	assert.equal((await create(ended, createForm())).error, COPY.assignmentUnavailable);
	assert.equal(writes(ended).length, 0);

	const other = await environment(baseRoutes({ [`GET ${draftPath}`]: { body: draft({ patient_id: '22222222-3333-4444-8555-666666666666' }) } }));
	assert.equal((await create(other, createForm())).error, COPY.draftUnavailable);
	assert.equal(writes(other).length, 0);

	const unreadable = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	assert.equal((await create(unreadable, createForm())).error, COPY.readFailure);
	assert.equal(writes(unreadable).length, 0);
});

// S4 edit: the list is read first; an entry that is gone, approved or at another version is refused without a write.

test('S4 edit sends one PATCH with expected_version, date and description, to the entry path', async () => {
	const env = await environment();
	const result = await update(env, updateForm({ description: 'Profilaxis con control' }));
	assert.equal(result.success, true);
	assert.equal(result.action, 'update');
	assert.equal(result.procedure_id, procedureId);
	assert.equal(result.assignment_id, '17');
	const sent = writes(env);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, 'PATCH');
	assert.equal(sent[0].path, `${proceduresPath}/${procedureId}`);
	assert.deepEqual(sent[0].body, { expected_version: '4', procedure_date: '2026-11-10', description: 'Profilaxis con control' });
});

test('S4 edit keeps the stored line breaks when the browser only changed them to CRLF', async () => {
	const env = await environment(baseRoutes({ [`GET ${proceduresPath}`]: listOf(entry({ description: 'Línea 1\nLínea 2' })) }));
	await update(env, updateForm({ description: 'Línea 1\r\nLínea 2' }));
	assert.equal(writes(env)[0].body.description, 'Línea 1\nLínea 2');
});

test('S4 edit and delete refuse locally, with no write, when the entry is gone, approved or at another version', async () => {
	const cases = [
		[baseRoutes({ [`GET ${proceduresPath}`]: listOf() }), COPY.gone, false],
		[baseRoutes({ [`GET ${proceduresPath}`]: listOf(approvedEntry()) }), COPY.approved, false],
		[baseRoutes({ [`GET ${proceduresPath}`]: listOf(entry({ version: '6' })) }), COPY.stale, true],
	];
	for (const [routes, message, conflict] of cases) {
		const edit = await environment(routes);
		const editResult = await update(edit, updateForm());
		assert.equal(editResult.success, false, message);
		assert.equal(editResult.error, message);
		assert.equal(editResult.conflict, conflict, message);
		assert.equal(writes(edit).length, 0, message);

		const drop = await environment(routes);
		const dropResult = await remove(drop, deleteForm());
		assert.equal(dropResult.success, false, message);
		assert.equal(dropResult.error, message);
		assert.equal(dropResult.conflict, conflict, message);
		assert.equal(writes(drop).length, 0, message);
	}
});

test('S4 edit refuses an invalid date or blank text locally and reads nothing about the entry', async () => {
	const env = await environment();
	const result = await update(env, updateForm({ description: '  ' }));
	assert.equal(result.error, COPY.description);
	assert.equal(env.requests.length, 0);
});

test('D4 edit rejections map to their copy: stale conflict, approved, gone, future date and the session notice', async () => {
	const cases = [
		[409, 'procedure entry version changed; reload before saving', COPY.stale, true],
		[409, 'approved procedure entries cannot be changed', COPY.approved, false],
		[404, 'procedure entry was not found', COPY.gone, false],
		[400, 'procedure_date cannot be in the future', COPY.dateFuture, false],
		[401, 'expired', COPY.session, false],
	];
	for (const [status, message, copy, conflict] of cases) {
		const env = await environment(baseRoutes({ [`PATCH ${proceduresPath}/${procedureId}`]: { status, body: errorBody('CODE', message) } }));
		const result = await update(env, updateForm());
		assert.equal(result.success, false, message);
		assert.equal(result.error, copy, message);
		assert.equal(result.conflict, conflict, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(writes(env).length, 1, message);
	}
});

test('D4 a dropped connection or a 500 on edit is uncertain, with the reload copy, and is not retried', async () => {
	for (const response of [{ network: true }, { status: 500, body: errorBody('INTERNAL', 'boom') }]) {
		const env = await environment(baseRoutes({ [`PATCH ${proceduresPath}/${procedureId}`]: response }));
		const result = await update(env, updateForm());
		assert.equal(result.uncertain, true);
		assert.equal(result.error, COPY.changeUncertain);
		assert.equal(writes(env).length, 1);
	}
});

// S4 delete: one DELETE with the version in the query string; no body.

test('S4 delete sends one DELETE with expected_version in the query string and no body', async () => {
	const env = await environment();
	const result = await remove(env, deleteForm());
	assert.equal(result.success, true);
	assert.equal(result.action, 'delete');
	assert.equal(result.procedure_id, procedureId);
	const sent = writes(env);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, 'DELETE');
	assert.equal(sent[0].path, `${proceduresPath}/${procedureId}`);
	assert.equal(sent[0].query, '?expected_version=4');
	assert.equal(sent[0].body, undefined);
});

test('D4 delete rejections and uncertain outcomes keep their copy and are never retried', async () => {
	const env = await environment(baseRoutes({ [`DELETE ${proceduresPath}/${procedureId}`]: { status: 409, body: errorBody('CONFLICT', 'approved procedure entries cannot be changed') } }));
	const rejected = await remove(env, deleteForm());
	assert.equal(rejected.error, COPY.approved);
	assert.equal(writes(env).length, 1);

	const network = await environment(baseRoutes({ [`DELETE ${proceduresPath}/${procedureId}`]: { network: true } }));
	const uncertain = await remove(network, deleteForm());
	assert.equal(uncertain.uncertain, true);
	assert.equal(uncertain.error, COPY.changeUncertain);
	assert.equal(writes(network).length, 1);
});

test('S4 edit and delete check the assignment and draft context before any write', async () => {
	const ended = await environment(baseRoutes({ [`GET ${assignmentPath}`]: { body: { items: [], limit: 50, offset: 0 } } }));
	assert.equal((await update(ended, updateForm())).error, COPY.assignmentUnavailable);
	assert.equal((await remove(ended, deleteForm())).error, COPY.assignmentUnavailable);
	assert.equal(writes(ended).length, 0);

	const other = await environment(baseRoutes({ [`GET ${draftPath}`]: { body: draft({ origin_group_id: '22222222-3333-4444-8555-666666666666' }) } }));
	assert.equal((await remove(other, deleteForm())).error, COPY.draftUnavailable);
	assert.equal(writes(other).length, 0);
});

test('S4 identifiers that are not positive BIGINT strings are refused before any request', async () => {
	const env = await environment();
	assert.equal((await update(env, updateForm({ procedure_id: '0' }))).error, COPY.identifierInvalid);
	assert.equal((await remove(env, deleteForm({ expected_version: 'abc' }))).error, COPY.identifierInvalid);
	assert.equal(env.requests.length, 0);
});

// The registered actions accept exactly the form fields the page posts.

test('S4 the registered procedure actions accept their form fields and reject other shapes', async () => {
	const { server } = await loadRegisteredActions(async () => Response.json({}), { realModules: [procedureSpecifier] });
	assert.equal(server.createHygieneProcedure.input.safeParse(createForm()).success, true);
	assert.equal(server.createHygieneProcedure.input.safeParse({ ...createForm(), expected_version: '4' }).success, false);
	assert.equal(server.updateHygieneProcedure.input.safeParse(updateForm()).success, true);
	assert.equal(server.updateHygieneProcedure.input.safeParse({ ...updateForm(), procedure_id: undefined }).success, false);
	assert.equal(server.deleteHygieneProcedure.input.safeParse(deleteForm()).success, true);
	assert.equal(server.deleteHygieneProcedure.input.safeParse({ ...deleteForm(), procedure_date: '2026-11-10' }).success, false);
});
