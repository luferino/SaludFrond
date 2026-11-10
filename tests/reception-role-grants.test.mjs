import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z as realZod } from 'astro/zod';

const root = new URL('../', import.meta.url);
const accountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const studentId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const otherStudentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const roleGrantId = '11111111-1111-1111-1111-111111111111';
const otherRoleGrantId = '22222222-2222-2222-2222-222222222222';
const actorId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const iso = '2026-01-02T03:04:05.000Z';
const later = '2026-01-03T03:04:05.000Z';
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const plain = (value) => JSON.parse(JSON.stringify(value));
const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64'), 'signature'].join('.');
const adminToken = jwt({ sub: actorId, username: 'ADMIN', role: 'admin', exp: 4102444800, iat: 1767225600 });
const candidate = (overrides = {}) => ({ id: studentId, username: 'estudiante01', email: 'estudiante@example.invalid', ...overrides });
const roleGrant = (overrides = {}) => ({ id: roleGrantId, user_id: studentId, role: 'reception', granted_by: actorId, granted_at: iso, revoked_by: null, revoked_at: null, ...overrides });
const revokedRoleGrant = (overrides = {}) => roleGrant({ revoked_by: actorId, revoked_at: later, ...overrides });
const ACCOUNT_PATH = '/auth/accounts';
const CANDIDATES_PATH = '/auth/reception-role-candidates';
const rolePath = (id) => `/auth/accounts/${id}/reception-role`;
const revokeRolePath = (id) => `/auth/reception-role-grants/${id}/revoke`;
const careersPath = (id) => `/auth/accounts/${id}/careers`;
const errorBody = { error: { code: 'BACKEND_ERROR', message: 'private backend detail' } };
const validGrant = { student_id: studentId };
const publicMessages = {
	400: 'Revisá los datos ingresados e intentá nuevamente.',
	401: 'Tu sesión venció. Iniciá sesión nuevamente.',
	403: 'Tu sesión no tiene permiso para realizar esta operación.',
	500: 'No se pudo completar la operación. Probá de nuevo más tarde.',
};
const GENERIC = publicMessages[500];
const ROLE_NOT_FOUND = 'No se encontró el estudiante o el rol indicado.';
const ROLE_CONFLICT = 'El estudiante ya tiene el rol de Recepción activo.';
const REVOKE_ROLE_CONFLICT = 'El rol de Recepción ya no está disponible para revocar.';

function defaultReply(method, path) {
	if (method === 'GET' && path === ACCOUNT_PATH) return { status: 200, body: { items: [], limit: 50, offset: 0 } };
	if (method === 'GET' && path === CANDIDATES_PATH) return { status: 200, body: { items: [], limit: 20, offset: 0 } };
	if (method === 'GET' && /^\/auth\/accounts\/[^/]+\/careers$/.test(path)) return { status: 200, body: { items: [] } };
	if (method === 'GET' && /^\/auth\/accounts\/[^/]+\/reception-role$/.test(path)) return { status: 200, body: { items: [] } };
	if (method === 'POST' && /^\/auth\/accounts\/[^/]+\/reception-role$/.test(path)) return { status: 201, body: roleGrant({ user_id: path.split('/')[3] }) };
	if (method === 'POST' && /^\/auth\/reception-role-grants\/[^/]+\/revoke$/.test(path)) return { status: 200, body: revokedRoleGrant({ id: path.split('/')[3] }) };
	return { status: 404, body: errorBody };
}

async function evaluate(options = {}) {
	const token = 'token' in options ? options.token : adminToken;
	const cookieState = { token, writes: [] };
	const cookies = {
		get: (name) => name === 'session' && cookieState.token ? { value: cookieState.token } : undefined,
		set: (...args) => { cookieState.writes.push(['set', ...args]); cookieState.token = args[1]; },
		delete: (...args) => { cookieState.writes.push(['delete', ...args]); cookieState.token = undefined; },
	};
	const requests = [];
	const sandbox = vm.createContext({ URL, URLSearchParams, Response, Request, Error, Date, atob,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('offline');
			const { pathname } = new URL(url);
			const reply = options.reply?.(init.method, pathname) ?? defaultReply(init.method, pathname);
			return Response.json(reply.body, { status: reply.status });
		},
	});
	// Cache the in-flight promise of a fully linked module: shared dependencies can be requested by sibling imports at once.
	const modules = new Map();
	function compile(code, identifier) {
		if (!modules.has(identifier)) {
			modules.set(identifier, (async () => {
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const module = new vm.SourceTextModule(output, { context: sandbox, identifier,
					initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; },
				});
				await module.link(async (specifier, parent) => {
					if (specifier === 'astro:actions') return new vm.SourceTextModule('export const defineAction = (definition) => definition;', { context: sandbox });
					if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () { this.setExport('z', realZod); }, { context: sandbox });
					const resolved = new URL(/\.(?:ts|astro)$/.test(specifier) ? specifier : `${specifier}.ts`, parent.identifier);
					return compile(await readFile(resolved, 'utf8'), resolved.href);
				});
				return module;
			})());
		}
		return modules.get(identifier);
	}
	async function load(path) {
		const url = new URL(path, root);
		const module = await compile(await readFile(url, 'utf8'), url.href);
		if (module.status === 'linked') await module.evaluate();
		return module.namespace;
	}
	return { cookies, cookieState, requests, sandbox, load };
}

async function evaluatePage(query = '', options = {}) {
	const fixture = await evaluate(options);
	const pageUrl = new URL('src/pages/reception-accounts.astro', root);
	const source = await readFile(pageUrl, 'utf8');
	const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	assert.ok(frontmatter, 'page has server frontmatter');
	const parsed = ts.createSourceFile(pageUrl.pathname, frontmatter[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const removals = [];
	let actionModule;
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		removals.push([statement.getFullStart(), statement.getEnd()]);
		const clause = statement.importClause;
		if (!clause || statement.getText(parsed).startsWith('import type ')) continue;
		const specifier = statement.moduleSpecifier.text;
		let namespace;
		if (specifier === 'astro:actions') {
			actionModule = await fixture.load('src/pods/reception-account/actions.ts');
			namespace = { actions: actionModule };
		} else if (specifier.endsWith('.astro') || specifier.endsWith('.css')) namespace = { default: {} };
		else namespace = await fixture.load(new URL(/\.(?:ts|astro)$/.test(specifier) ? specifier : `${specifier}.ts`, pageUrl).href);
		if (clause.name) fixture.sandbox[clause.name.text] = namespace.default;
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) fixture.sandbox[element.name.text] = namespace[element.propertyName?.text ?? element.name.text];
		}
	}
	let code = frontmatter[1];
	for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + code.slice(end);
	code = code.replace(/^export const prerender = false;\s*$/m, '');
	const requestUrl = `https://frontend.invalid/reception-accounts${query ? `?${query}` : ''}`;
	fixture.sandbox.Astro = {
		cookies: fixture.cookies,
		url: new URL(requestUrl),
		request: options.request ?? new Request(requestUrl),
		redirect: (location) => ({ redirect: location }),
		getActionResult: (action) => {
			const name = Object.keys(actionModule).find((key) => actionModule[key] === action);
			return options.actionResults?.[name];
		},
	};
	const output = ts.transpileModule(`${code}\nreturn { queryError, selectedAccount, grantState, grants, accountSearchState, accounts, roleQueryError, roleSearchQuery, selectedStudent, candidateState, candidates, roleState, roleGrants, studentName, roleCopy };`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
	const value = await new vm.Script(`(async () => { ${output} })()`).runInContext(fixture.sandbox);
	return { ...fixture, value, source };
}

const roleRequests = (requests) => requests.filter(({ url }) => new URL(url).pathname.includes('reception-role') || new URL(url).pathname === CANDIDATES_PATH);

test('candidate lookup sends one bounded GET with the trimmed term, fixed page size, requested offset, and bearer', async () => {
	const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status: 200, body: { items: [candidate()], limit: 20, offset: 20 } } : undefined) });
	const api = await fixture.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await api.searchReceptionRoleCandidates({ q: '  ana@example  ', offset: 20 }, fixture.cookies)), { state: 'success', items: [candidate()], limit: 20, offset: 20 });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url.split('?')[0], `https://backend.invalid${CANDIDATES_PATH}`);
	assert.equal(new URL(fixture.requests[0].url).search, '?q=ana%40example&limit=20&offset=20');
	assert.equal(fixture.requests[0].method, 'GET');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
});

test('candidate lookup refuses blank or over-long terms before any request', async () => {
	const fixture = await evaluate();
	const api = await fixture.load('src/pods/reception-account/api.ts');
	for (const q of ['', '   ', 'a'.repeat(101), `${'a'.repeat(100)}b`]) {
		assert.deepEqual(plain(await api.searchReceptionRoleCandidates({ q, offset: 0 }, fixture.cookies)), { state: 'invalid' }, JSON.stringify(q));
	}
	assert.deepEqual(fixture.requests, []);
	const exact = await evaluate();
	const exactApi = await exact.load('src/pods/reception-account/api.ts');
	await exactApi.searchReceptionRoleCandidates({ q: 'a'.repeat(100), offset: 0 }, exact.cookies);
	assert.equal(exact.requests.length, 1);
});

test('candidate lookup accepts only the exact {items,limit,offset} envelope with exact item keys', async () => {
	const malformed = [
		{ items: [candidate()], limit: 20, offset: 0, total: 1 },
		{ items: [candidate()], limit: 20 },
		{ items: [{ ...candidate(), role: 'reception' }], limit: 20, offset: 0 },
		{ items: [without(candidate(), 'email')], limit: 20, offset: 0 },
		{ items: [without(candidate(), 'username')], limit: 20, offset: 0 },
		{ items: [candidate({ id: 'not-a-uuid' })], limit: 20, offset: 0 },
		{ items: [candidate({ username: '' })], limit: 20, offset: 0 },
		{ items: [candidate({ username: 7 })], limit: 20, offset: 0 },
		{ items: [candidate({ email: '' })], limit: 20, offset: 0 },
		{ items: [candidate({ email: 42 })], limit: 20, offset: 0 },
		{ items: [candidate()], limit: 25, offset: 0 },
		{ items: [candidate()], limit: 20, offset: 5 },
		{ items: Array.from({ length: 21 }, (_, index) => candidate({ id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}` })), limit: 20, offset: 0 },
		{ items: 'none', limit: 20, offset: 0 },
		[],
	];
	for (const body of malformed) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status: 200, body } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.searchReceptionRoleCandidates({ q: 'ana', offset: 0 }, fixture.cookies)), { state: 'failed' }, JSON.stringify(body));
	}
});

test('candidate lookup keeps email null as a valid identity and maps denied, failed, and expired reads separately', async () => {
	const nullEmail = await evaluate({ reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status: 200, body: { items: [candidate({ email: null })], limit: 20, offset: 0 } } : undefined) });
	const nullApi = await nullEmail.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await nullApi.searchReceptionRoleCandidates({ q: 'ana', offset: 0 }, nullEmail.cookies)), { state: 'success', items: [candidate({ email: null })], limit: 20, offset: 0 });
	for (const [status, expected] of [[403, 'denied'], [500, 'failed']]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status, body: errorBody } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.searchReceptionRoleCandidates({ q: 'ana', offset: 0 }, fixture.cookies)), { state: expected });
		assert.equal(fixture.cookieState.token, adminToken);
	}
	const expired = await evaluate({ reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status: 401, body: errorBody } : undefined) });
	const expiredApi = await expired.load('src/pods/reception-account/api.ts');
	await assert.rejects(expiredApi.searchReceptionRoleCandidates({ q: 'ana', offset: 0 }, expired.cookies), { status: 401 });
	assert.equal(expired.cookieState.token, undefined);
});

test('role history reads the account reception-role path and returns validated grants in server order', async () => {
	const items = [revokedRoleGrant(), roleGrant({ id: otherRoleGrantId, granted_at: later })];
	const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 200, body: { items: [items[0]] } } : undefined) });
	const api = await fixture.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await api.listReceptionRoleGrants(studentId, fixture.cookies)), { state: 'success', items: [items[0]] });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, `https://backend.invalid${rolePath(studentId)}`);
	assert.equal(fixture.requests[0].method, 'GET');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
	const history = await evaluate({ reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 200, body: { items } } : undefined) });
	const historyApi = await history.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await historyApi.listReceptionRoleGrants(studentId, history.cookies)), { state: 'success', items });
});

test('role history rejects extra or missing keys, non-reception roles, bad dates, half-revoked rows, foreign users, and two active grants', async () => {
	const malformed = [
		{ items: [{ ...roleGrant(), extra: true }] },
		{ items: [without(roleGrant(), 'role')] },
		{ items: [roleGrant({ role: 'admin' })] },
		{ items: [roleGrant({ role: 'student' })] },
		{ items: [roleGrant({ granted_at: 'yesterday' })] },
		{ items: [roleGrant({ revoked_at: 'yesterday', revoked_by: actorId })] },
		{ items: [roleGrant({ revoked_at: later })] },
		{ items: [roleGrant({ revoked_by: actorId })] },
		{ items: [roleGrant({ user_id: otherStudentId })] },
		{ items: [roleGrant({ id: 'not-a-uuid' })] },
		{ items: [roleGrant(), roleGrant({ id: otherRoleGrantId })] },
		{ items: [roleGrant(), { ...without(roleGrant(), 'id') }] },
		{ items: [roleGrant()], extra: true },
		{ items: [] , limit: 20 },
		{},
		{ items: 'none' },
		[],
	];
	for (const body of malformed) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 200, body } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.listReceptionRoleGrants(studentId, fixture.cookies)), { state: 'failed' }, JSON.stringify(body));
	}
});

test('role history separates missing or non-student targets from denied, failed, and expired reads', async () => {
	for (const [status, expected] of [[404, 'not_found'], [403, 'denied'], [500, 'failed']]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status, body: errorBody } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.listReceptionRoleGrants(studentId, fixture.cookies)), { state: expected }, `status ${status}`);
		assert.equal(fixture.cookieState.token, adminToken);
	}
	const expired = await evaluate({ reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 401, body: errorBody } : undefined) });
	const expiredApi = await expired.load('src/pods/reception-account/api.ts');
	await assert.rejects(expiredApi.listReceptionRoleGrants(studentId, expired.cookies), { status: 401 });
	assert.equal(expired.cookieState.token, undefined);
});

test('role grant posts an empty object to the account reception-role path and returns the active grant', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	assert.equal(actions.grantReceptionRole.accept, 'form');
	assert.equal(actions.grantReceptionRole.input.safeParse(validGrant).success, true);
	assert.equal(actions.grantReceptionRole.input.safeParse({ student_id: 'not-a-uuid' }).success, false);
	const result = await actions.grantReceptionRole.handler({ student_id: studentId, role: 'admin', user_id: otherStudentId }, { cookies: fixture.cookies });
	assert.deepEqual(plain(result), { success: true, grant: roleGrant() });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, `https://backend.invalid${rolePath(studentId)}`);
	assert.equal(fixture.requests[0].method, 'POST');
	assert.equal(fixture.requests[0].body, '{}');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
});

test('role grant refuses invalid student input before any request', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	for (const input of [{ student_id: 'not-a-uuid' }, { student_id: '' }, {}]) {
		const result = await actions.grantReceptionRole.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(input));
	}
	assert.deepEqual(fixture.requests, []);
});

test('role grant rejects 201 responses that are not an active reception grant for the requested student', async () => {
	const malformed = [
		revokedRoleGrant(),
		roleGrant({ user_id: otherStudentId }),
		roleGrant({ role: 'admin' }),
		{ ...roleGrant(), extra: true },
		without(roleGrant(), 'granted_by'),
	];
	for (const body of malformed) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === rolePath(studentId) ? { status: 201, body } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.grantReceptionRole.handler(validGrant, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(body));
		assert.equal(result.grant, undefined);
		assert.equal(result.error, GENERIC);
	}
});

test('role grant maps 409 to the active-role conflict, 404 to the missing student or role copy, and other failures to public copy', async () => {
	for (const status of [400, 401, 403, 404, 409, 500]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === rolePath(studentId) ? { status, body: errorBody } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.grantReceptionRole.handler(validGrant, { cookies: fixture.cookies });
		const expected = status === 409 ? ROLE_CONFLICT : status === 404 ? ROLE_NOT_FOUND : publicMessages[status] ?? GENERIC;
		assert.deepEqual(plain(result), { success: false, error: expected }, `status ${status}`);
		assert.doesNotMatch(result.error, /private backend detail/);
		assert.equal(fixture.cookieState.token, status === 401 ? undefined : adminToken);
		assert.equal(fixture.requests.length, 1);
	}
});

test('role revocation sends nothing without explicit confirmation or a valid grant id', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	assert.equal(actions.revokeReceptionRole.accept, 'form');
	assert.equal(actions.revokeReceptionRole.input.safeParse({ id: roleGrantId, confirm: 'yes' }).success, true);
	assert.equal(actions.revokeReceptionRole.input.safeParse({ id: 'not-a-uuid', confirm: 'yes' }).success, false);
	for (const input of [
		{ id: roleGrantId },
		{ id: roleGrantId, confirm: 'no' },
		{ id: roleGrantId, confirm: '' },
		{ id: 'not-a-uuid', confirm: 'yes' },
		{ id: '', confirm: 'yes' },
	]) {
		const result = await actions.revokeReceptionRole.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(input));
	}
	assert.deepEqual(fixture.requests, []);
});

test('confirmed role revocation posts an empty object to the exact grant path and validates the revoked audit row', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	const result = await actions.revokeReceptionRole.handler({ id: roleGrantId, confirm: 'yes' }, { cookies: fixture.cookies });
	assert.deepEqual(plain(result), { success: true, id: roleGrantId, grant: revokedRoleGrant() });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, `https://backend.invalid${revokeRolePath(roleGrantId)}`);
	assert.equal(fixture.requests[0].method, 'POST');
	assert.equal(fixture.requests[0].body, '{}');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
});

test('role revocation rejects responses for another grant or without revocation audit and maps errors publicly', async () => {
	for (const body of [revokedRoleGrant({ id: otherRoleGrantId }), roleGrant(), { ...revokedRoleGrant(), extra: true }]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === revokeRolePath(roleGrantId) ? { status: 200, body } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.revokeReceptionRole.handler({ id: roleGrantId, confirm: 'yes' }, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(body));
		assert.equal(result.error, GENERIC);
	}
	for (const status of [400, 401, 403, 404, 409, 500]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === revokeRolePath(roleGrantId) ? { status, body: errorBody } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.revokeReceptionRole.handler({ id: roleGrantId, confirm: 'yes' }, { cookies: fixture.cookies });
		// Revocation is idempotent in the contract; an unexpected 409 is a generic failure, never an assumed revocation.
		const expected = status === 404 ? ROLE_NOT_FOUND : publicMessages[status] ?? GENERIC;
		assert.deepEqual(plain(result), { success: false, id: roleGrantId, error: expected }, `status ${status}`);
		assert.equal(fixture.cookieState.token, status === 401 ? undefined : adminToken);
	}
});

test('page without a role selection or lookup makes no role requests and keeps every role state idle', async () => {
	const result = await evaluatePage('');
	assert.equal(result.value.roleQueryError, '');
	assert.equal(result.value.selectedStudent, '');
	assert.equal(result.value.candidateState, 'idle');
	assert.equal(result.value.roleState, 'idle');
	assert.deepEqual(roleRequests(result.requests), []);
	assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), [ACCOUNT_PATH]);
});

test('page never searches students for blank or over-long terms and rejects malformed role parameters without requests', async () => {
	for (const query of ['student_q=%20%20', `student_q=${'a'.repeat(101)}`]) {
		const result = await evaluatePage(query);
		assert.equal(result.value.candidateState, 'idle', query);
		assert.deepEqual(roleRequests(result.requests), [], query);
		if (query.includes('%20')) assert.equal(result.value.roleQueryError, '');
		else assert.notEqual(result.value.roleQueryError, '');
	}
	for (const query of [`student_id=not-a-uuid`, `student_id=${studentId}&student_id=${otherStudentId}`, 'student_q=ana&student_offset=-1', 'student_q=ana&student_offset=10001']) {
		const result = await evaluatePage(query);
		assert.notEqual(result.value.roleQueryError, '', query);
		assert.equal(result.value.selectedStudent, '', query);
		assert.deepEqual(roleRequests(result.requests), [], query);
	}
});

test('page searches students with the trimmed term, 20-item page size, and offset without touching account search', async () => {
	const result = await evaluatePage('student_q=%20ana%40example%20&student_offset=20', {
		reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status: 200, body: { items: [candidate()], limit: 20, offset: 20 } } : undefined),
	});
	assert.equal(result.value.candidateState, 'success');
	assert.deepEqual(plain(result.value.candidates), [candidate()]);
	assert.equal(result.value.roleSearchQuery.q, 'ana@example');
	assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), [ACCOUNT_PATH, CANDIDATES_PATH]);
	assert.equal(new URL(result.requests[0].url).search, '?limit=50&offset=0');
	assert.equal(new URL(result.requests[1].url).search, '?q=ana%40example&limit=20&offset=20');
});

test('page maps candidate denied and failed states without a selected student', async () => {
	for (const [status, expected] of [[403, 'denied'], [500, 'failed']]) {
		const result = await evaluatePage('student_q=ana', { reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status, body: errorBody } : undefined) });
		assert.equal(result.value.candidateState, expected);
		assert.deepEqual(plain(result.value.candidates), []);
	}
});

test('page reports active, revoked-only, and empty role history for the selected student', async () => {
	const active = await evaluatePage(`student_id=${studentId}`, { reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 200, body: { items: [roleGrant()] } } : undefined) });
	assert.equal(active.value.selectedStudent, studentId);
	assert.equal(active.value.roleState, 'active');
	assert.deepEqual(plain(active.value.roleGrants), [roleGrant()]);
	assert.deepEqual(active.requests.map(({ url, method }) => [method, new URL(url).pathname]), [['GET', ACCOUNT_PATH], ['GET', rolePath(studentId)]]);
	const revoked = await evaluatePage(`student_id=${studentId}`, { reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 200, body: { items: [revokedRoleGrant()] } } : undefined) });
	assert.equal(revoked.value.roleState, 'revoked');
	const none = await evaluatePage(`student_id=${studentId}`);
	assert.equal(none.value.roleState, 'none');
	assert.deepEqual(plain(none.value.roleGrants), []);
});

test('page maps denied, missing-target, and failed role reads without leaking backend details', async () => {
	for (const [status, expected] of [[403, 'denied'], [404, 'not_found'], [500, 'failed']]) {
		const result = await evaluatePage(`student_id=${studentId}`, { reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status, body: errorBody } : undefined) });
		assert.equal(result.value.roleState, expected, `status ${status}`);
		assert.doesNotMatch(result.source, /private backend detail/);
	}
	const expired = await evaluatePage(`student_id=${studentId}`, { reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 401, body: errorBody } : undefined) });
	assert.deepEqual(plain(expired.value), { redirect: '/auth/login?returnTo=%2Freception-accounts' });
});

test('page labels the selected student from the bounded candidate list when it is present', async () => {
	const result = await evaluatePage(`student_q=estudiante01&student_id=${studentId}`, {
		reply: (method, path) => (method === 'GET' && path === CANDIDATES_PATH ? { status: 200, body: { items: [candidate()], limit: 20, offset: 0 } } : undefined),
	});
	assert.equal(result.value.studentName, 'estudiante01');
	const unlabeled = await evaluatePage(`student_id=${studentId}`);
	assert.equal(unlabeled.value.studentName, 'el estudiante');
});

test('a successful role grant selects the granted student and reloads its history', async () => {
	const request = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ student_id: otherStudentId }),
	});
	const result = await evaluatePage('', { request, actionResults: { grantReceptionRole: { data: { success: true, grant: roleGrant({ user_id: studentId }) } } } });
	assert.equal(result.value.selectedStudent, studentId);
	assert.equal(result.value.roleState, 'none');
	assert.deepEqual(result.requests.map(({ url, method }) => [method, new URL(url).pathname]), [['GET', ACCOUNT_PATH], ['GET', rolePath(studentId)]]);
});

test('a successful role revocation selects the revoked student and shows its revoked history', async () => {
	const request = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ student_id: otherStudentId, id: roleGrantId, confirm: 'yes' }),
	});
	const result = await evaluatePage('', {
		request,
		reply: (method, path) => (method === 'GET' && path === rolePath(studentId) ? { status: 200, body: { items: [revokedRoleGrant()] } } : undefined),
		actionResults: { revokeReceptionRole: { data: { success: true, id: roleGrantId, grant: revokedRoleGrant() } } },
	});
	assert.equal(result.value.selectedStudent, studentId);
	assert.equal(result.value.roleState, 'revoked');
});

test('failed role submissions keep the submitted student selected and ignore malformed submitted ids', async () => {
	const failed = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ student_id: studentId }),
	});
	const grant = await evaluatePage('', { request: failed, actionResults: { grantReceptionRole: { data: { success: false, error: ROLE_CONFLICT } } } });
	assert.equal(grant.value.selectedStudent, studentId);
	assert.equal(grant.value.roleState, 'none');
	const malformed = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ student_id: 'not-a-uuid' }),
	});
	const ignored = await evaluatePage('', { request: malformed, actionResults: { revokeReceptionRole: { data: { success: false, id: roleGrantId, error: REVOKE_ROLE_CONFLICT } } } });
	assert.equal(ignored.value.selectedStudent, '');
	assert.deepEqual(ignored.requests.map(({ url }) => new URL(url).pathname), [ACCOUNT_PATH]);
});

test('role parameters never reach the account parser, so the career panel and account search keep their behavior', async () => {
	const rows = [{ id: accountId, username: 'RECEPCION01', email: null, active_careers: ['kinesiology'] }];
	const result = await evaluatePage(`account_id=${accountId}&q=ana&limit=25&offset=0&student_q=estudiante&student_offset=20&student_id=${studentId}`, {
		reply: (method, path) => {
			if (method === 'GET' && path === ACCOUNT_PATH) return { status: 200, body: { items: rows, limit: 25, offset: 0 } };
			if (method === 'GET' && path === CANDIDATES_PATH) return { status: 200, body: { items: [candidate()], limit: 20, offset: 20 } };
			return undefined;
		},
	});
	assert.equal(result.value.queryError, '');
	assert.equal(result.value.roleQueryError, '');
	assert.equal(result.value.selectedAccount, accountId);
	assert.deepEqual(plain(result.value.accounts), rows);
	assert.equal(new URL(result.requests[0].url).search, '?q=ana&limit=25&offset=0');
	assert.equal(new URL(result.requests[1].url).pathname, careersPath(accountId));
	assert.equal(result.value.grantState, 'success');
	assert.equal(new URL(result.requests[2].url).pathname, CANDIDATES_PATH);
	assert.equal(result.value.roleState, 'none');
});

test('page copy is exactly the approved Spanish copy, with the revoke confirmation and success messages formatted per student', async () => {
	const result = await evaluatePage('');
	assert.equal(result.value.roleCopy.revokeConfirm('estudiante01'), 'Revocar Recepción para estudiante01. También se revocan todas sus carreras de recepción. Si se vuelve a habilitar, empezará sin carreras.');
	assert.equal(result.value.roleCopy.grantSuccess('estudiante01'), 'Recepción habilitada para estudiante01.');
	assert.equal(result.value.roleCopy.revokeSuccess('estudiante01'), 'Recepción revocada para estudiante01. Sus carreras quedaron revocadas.');
	for (const copy of ['Rol de Recepción adicional', 'Buscar estudiante por usuario o correo', 'Habilitar Recepción', 'Revocar Recepción', 'Recepción activa', 'Recepción revocada', 'Sin rol de Recepción']) {
		assert.match(result.source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), copy);
	}
});

test('page exposes the role section as admin-only and links active role holders to the unchanged career panel', async () => {
	const page = await readFile(new URL('../src/pages/reception-accounts.astro', import.meta.url), 'utf8');
	const actions = await readFile(new URL('../src/actions/index.ts', import.meta.url), 'utf8');
	assert.match(page, /payload\.role !== 'admin'/);
	assert.match(page, /name="student_q"/);
	assert.match(page, /name="student_id" value=\{/);
	assert.match(page, /reception-accounts\?account_id=\$\{/);
	// Role writes keep the current query so the result can still name the selected student.
	assert.match(page, /action=\{receptionActionUrl\(Astro\.url, String\(actions\.grantReceptionRole\)\)\}/);
	assert.match(page, /action=\{receptionActionUrl\(Astro\.url, String\(actions\.revokeReceptionRole\)\)\}/);
	assert.match(page, /name="confirm" value="yes" required/);
	assert.match(actions, /\bgrantReceptionRole\b/);
	assert.match(actions, /\brevokeReceptionRole\b/);
	assert.doesNotMatch(page + (await readFile(new URL('../src/pods/reception-account/api.ts', import.meta.url), 'utf8')), /\/auth\/roles|\/students|\/teachers/);
});
