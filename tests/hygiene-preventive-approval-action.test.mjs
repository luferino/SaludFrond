import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

// Teacher approval action for Hygiene and Preventive Dentistry II (S5, D5). The handler checks the grant hint, the
// confirmation and the origin guard, reads the list, refuses locally what the list already proves, then sends exactly one
// POST. Real modules run in one vm context; every request is recorded.
const root = new URL('../', import.meta.url);
const approvalPath = 'src/pods/hygiene-preventive-draft/actions/approval.ts';
const approvalSpecifier = '../pods/hygiene-preventive-draft/actions/approval';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const teacherId = '77777777-7777-4777-8777-777777777777';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const procedureId = '21';
const iso = '2026-11-06T12:00:00.000Z';
const approvedIso = '2026-11-18T09:00:00.000Z';
const draftPath = `/hygiene-preventive-drafts/${largeId}`;
const proceduresPath = `${draftPath}/procedures`;
const approvalPathname = `${proceduresPath}/${procedureId}/approval`;
const approveGrant = 'hygiene-preventive-drafts:approve';
const readGrant = 'hygiene-preventive-drafts:read';

const COPY = {
	forbidden: 'No tenés permiso vigente para aprobar procedimientos.',
	confirmation: 'Confirmá que entendés que la aprobación es definitiva.',
	unavailable: 'El borrador no está disponible en este contexto de origen.',
	gone: 'El procedimiento ya no está en el registro. Recargá la página para ver la lista actual.',
	already: 'El procedimiento ya estaba aprobado.',
	stale: 'El alumno modificó el procedimiento. Revisalo antes de aprobar.',
	uncertain: 'No se pudo confirmar la aprobación. Recargá la página y revisá el registro antes de volver a intentarlo.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	badRequest: 'Revisá los datos de la aprobación.',
	identifierInvalid: 'El procedimiento o el borrador no es válido.',
	readFailure: 'No se pudo verificar el borrador. No se guardó ni se envió nada.',
};

const token = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
/** A teacher session with the given grants; the real teacherGrant reads it from the cookie. */
const cookiesFor = (permissions = [approveGrant, readGrant], role = 'teacher') => {
	const value = token({ sub: teacherId, username: 'marta', role, permissions, exp: 4102444800, iat: 1 });
	return { get: (name) => (name === 'session' ? { value } : undefined), set() {}, delete() {} };
};

const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: {}, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const entry = (overrides = {}) => ({
	id: procedureId, draft_id: largeId, procedure_date: '2026-11-10', description: 'Profilaxis', author_id: authorId,
	student_name: 'Ana Pérez', version: '4', approved_by: null, teacher_name: null, approved_at: null,
	created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});
const approvedEntry = (overrides = {}) => entry({
	version: '5', approved_by: teacherId, teacher_name: 'Marta Gómez', approved_at: approvedIso, status: 'approved', ...overrides,
});
const errorBody = (code, message) => ({ error: { code, message } });
const plain = (value) => JSON.parse(JSON.stringify(value));
const baseRoutes = (overrides = {}) => ({
	[`GET ${draftPath}`]: { body: draft() },
	[`GET ${proceduresPath}`]: { body: { items: [entry()] } },
	[`POST ${approvalPathname}`]: ({ body }) => ({
		body: approvedEntry({ version: String(BigInt(body.expected_version) + 1n) }),
	}),
	...overrides,
});

/** Real approval module against an isolated fetch; every request is recorded with its method, path and JSON body. */
async function environment(routes = baseRoutes(), cookies = cookiesFor()) {
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
	const mod = await load(new URL(approvalPath, root).href);
	await mod.evaluate();
	return { requests, approval: mod.namespace, cookies };
}

const writes = (env) => env.requests.filter((request) => request.method !== 'GET');
const form = (overrides = {}) => ({
	id: largeId, procedure_id: procedureId, expected_version: '4',
	patient_id: patientId, subject_id: subjectId, academic_group_id: groupId, approval_confirmed: 'on', ...overrides,
});
const approve = (env, input) => env.approval.handleApproveHygieneProcedure(input, { cookies: env.cookies });

// S5: exact request and the confirmation.

test('S5 approve sends one POST to the approval path with exactly expected_version, and returns the origin context for the redirect', async () => {
	const env = await environment();
	const result = await approve(env, form());
	assert.equal(result.success, true);
	assert.equal(result.id, largeId);
	assert.equal(result.procedure_id, procedureId);
	assert.equal(result.patient_id, patientId);
	assert.equal(result.subject_id, subjectId);
	assert.equal(result.academic_group_id, groupId);
	const sent = writes(env);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].method, 'POST');
	assert.equal(sent[0].path, approvalPathname);
	assert.deepEqual(sent[0].body, { expected_version: '4' });
});

test('S5 the confirmation checkbox is required: without it nothing is read or sent', async () => {
	const env = await environment();
	const result = await approve(env, form({ approval_confirmed: undefined }));
	assert.equal(result.success, false);
	assert.equal(result.error, COPY.confirmation);
	assert.equal(env.requests.length, 0);
});

// D5: the grant hint is checked before anything else.

test('D5 without the approve grant the handler refuses before any request', async () => {
	const withoutApprove = await environment(baseRoutes(), cookiesFor([readGrant]));
	const refused = await approve(withoutApprove, form());
	assert.equal(refused.error, COPY.forbidden);
	assert.equal(withoutApprove.requests.length, 0);
});

test('D5 a session that is not a teacher is refused before any request, even with the approve grant', async () => {
	const student = await environment(baseRoutes(), cookiesFor([approveGrant], 'estudiante'));
	assert.equal((await approve(student, form())).error, COPY.forbidden);
	assert.equal(student.requests.length, 0);
});

// D5: local refusals send no write. The list is read first and proves the state.

test('D5 an entry that is gone, approved, at another version or in a foreign origin sends no write', async () => {
	const cases = [
		[baseRoutes({ [`GET ${proceduresPath}`]: { body: { items: [] } } }), COPY.gone],
		[baseRoutes({ [`GET ${proceduresPath}`]: { body: { items: [approvedEntry()] } } }), COPY.already],
		[baseRoutes({ [`GET ${proceduresPath}`]: { body: { items: [entry({ version: '6' })] } } }), COPY.stale],
		[baseRoutes({ [`GET ${draftPath}`]: { body: draft({ patient_id: '22222222-3333-4444-8555-666666666666' }) } }), COPY.unavailable],
		[baseRoutes({ [`GET ${draftPath}`]: { body: draft({ origin_group_id: '22222222-3333-4444-8555-666666666666' }) } }), COPY.unavailable],
		[baseRoutes({ [`GET ${draftPath}`]: { body: draft({ origin_subject_id: '22222222-3333-4444-8555-666666666666' }) } }), COPY.unavailable],
	];
	for (const [routes, message] of cases) {
		const env = await environment(routes);
		const result = await approve(env, form());
		assert.equal(result.success, false, message);
		assert.equal(result.error, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(writes(env).length, 0, message);
	}
});

test('D5 a stale expected_version with a pending entry is refused locally, with no write', async () => {
	const env = await environment();
	const result = await approve(env, form({ expected_version: '3' }));
	assert.equal(result.error, COPY.stale);
	assert.equal(writes(env).length, 0);
});

test('D5 an unreadable draft or list sends no write and says that nothing was sent', async () => {
	const draftFails = await environment(baseRoutes({ [`GET ${draftPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	assert.equal((await approve(draftFails, form())).error, COPY.readFailure);
	assert.equal(writes(draftFails).length, 0);
	const listFails = await environment(baseRoutes({ [`GET ${proceduresPath}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	assert.equal((await approve(listFails, form())).error, COPY.readFailure);
	assert.equal(writes(listFails).length, 0);
});

// D5: each backend rejection maps to its copy, is never retried, and the write was sent once.

test('D5 each backend rejection maps to its copy and is never retried', async () => {
	const cases = [
		[409, 'procedure entry is already approved', COPY.already],
		[409, 'procedure entry version changed; reload before saving', COPY.stale],
		[403, "Permission 'hygiene-preventive-drafts:approve' required", COPY.forbidden],
		[403, 'teacher instructor role required', COPY.forbidden],
		[404, 'hygiene preventive draft was not found', COPY.unavailable],
		[404, 'procedure entry was not found', COPY.gone],
		[400, 'allowed fields: expected_version', COPY.badRequest],
		[401, 'expired', COPY.session],
	];
	for (const [status, message, copy] of cases) {
		const env = await environment(baseRoutes({ [`POST ${approvalPathname}`]: { status, body: errorBody('CODE', message) } }));
		const result = await approve(env, form());
		assert.equal(result.success, false, message);
		assert.equal(result.error, copy, message);
		assert.equal(result.uncertain, false, message);
		assert.equal(writes(env).length, 1, `one write for ${message}`);
	}
});

// D5: outcomes the server did not confirm are uncertain, with the reload copy, and are never retried.

test('D5 a dropped connection, a 500 or an unconfirmed answer is uncertain and is not retried', async () => {
	const network = await environment(baseRoutes({ [`POST ${approvalPathname}`]: { network: true } }));
	const networkResult = await approve(network, form());
	assert.equal(networkResult.uncertain, true);
	assert.equal(networkResult.error, COPY.uncertain);
	assert.equal(writes(network).length, 1);

	const server = await environment(baseRoutes({ [`POST ${approvalPathname}`]: { status: 500, body: errorBody('INTERNAL', 'boom') } }));
	const serverResult = await approve(server, form());
	assert.equal(serverResult.uncertain, true);
	assert.equal(serverResult.error, COPY.uncertain);
	assert.equal(writes(server).length, 1);

	const unconfirmed = await environment(baseRoutes({ [`POST ${approvalPathname}`]: { body: entry() } }));
	const unconfirmedResult = await approve(unconfirmed, form());
	assert.equal(unconfirmedResult.uncertain, true);
	assert.equal(unconfirmedResult.error, COPY.uncertain);
	assert.equal(writes(unconfirmed).length, 1);
});

// Malformed identifiers and context are refused before any request.

test('D5 malformed ids or an incomplete origin context are refused before any request', async () => {
	const env = await environment();
	assert.equal((await approve(env, form({ procedure_id: '0' }))).error, COPY.identifierInvalid);
	assert.equal((await approve(env, form({ expected_version: 'abc' }))).error, COPY.identifierInvalid);
	assert.equal((await approve(env, form({ patient_id: 'not-a-uuid' }))).success, false);
	assert.equal(env.requests.length, 0);
});

// The registered action accepts the form fields the teacher page posts, with the list carriers as optional fields.

test('S5 the registered approval action accepts its form fields and rejects other shapes', async () => {
	const { server } = await loadRegisteredActions(async () => Response.json({}), { realModules: [approvalSpecifier] });
	const schema = server.approveHygieneProcedure.input;
	assert.equal(schema.safeParse(form()).success, true);
	assert.equal(schema.safeParse({ ...form(), assignment_id: '17', list_limit: '50', list_offset: '0' }).success, true);
	assert.equal(schema.safeParse(form({ approval_confirmed: undefined })).success, false);
	assert.equal(schema.safeParse(form({ approval_confirmed: 'true' })).success, false);
	assert.equal(schema.safeParse({ ...form(), expected_version: '4', status: 'approved' }).success, false);
	assert.equal(schema.safeParse(form({ procedure_id: undefined })).success, false);
});
