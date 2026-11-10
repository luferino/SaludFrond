import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z as realZod } from 'astro/zod';

const root = new URL('../', import.meta.url);
const accountId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherAccountId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const grantId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const otherGrantId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const actorId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const iso = '2026-01-02T03:04:05.000Z';
const later = '2026-01-03T03:04:05.000Z';
const account = (overrides = {}) => ({ id: accountId, username: 'RECEPCION01', role: 'reception', email: 'recepcion@example.invalid', createdAt: iso, ...overrides });
const grant = (overrides = {}) => ({ id: grantId, user_id: accountId, career: 'kinesiology', granted_by: actorId, granted_at: iso, revoked_by: null, revoked_at: null, ...overrides });
const revokedGrant = (overrides = {}) => grant({ revoked_by: actorId, revoked_at: later, ...overrides });
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const plain = (value) => JSON.parse(JSON.stringify(value));
const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64'), 'signature'].join('.');
const adminToken = jwt({ sub: actorId, username: 'ADMIN', role: 'admin', exp: 4102444800, iat: 1767225600 });
const receptionToken = jwt({ sub: accountId, username: 'RECEPCION01', role: 'reception', exp: 4102444800, iat: 1767225600 });
const ACCOUNT_PATH = '/auth/accounts';
const careersPath = (id) => `/auth/accounts/${id}/careers`;
const revokePath = (id) => `/auth/career-grants/${id}/revoke`;
const errorBody = { error: { code: 'BACKEND_ERROR', message: 'private backend detail' } };
const validCreate = { username: 'recepcion01', password: 'clave-de-prueba', email: 'recepcion@example.invalid' };
const publicMessages = {
	400: 'Revisá los datos ingresados e intentá nuevamente.',
	401: 'Tu sesión venció. Iniciá sesión nuevamente.',
	403: 'Tu sesión no tiene permiso para realizar esta operación.',
	404: 'No se encontró la cuenta, la carrera o el acceso indicado.',
	500: 'No se pudo completar la operación. Probá de nuevo más tarde.',
};
const GENERIC = publicMessages[500];
const CREATE_CONFLICT = 'El nombre de usuario o el correo ya están registrados.';
const GRANT_CONFLICT = 'La cuenta ya tiene un acceso activo para esta carrera.';
const REVOKE_CONFLICT = 'El acceso ya no está disponible para revocar.';

function defaultReply(method, path) {
	if (method === 'GET' && path === ACCOUNT_PATH) return { status: 200, body: { items: [], limit: 50, offset: 0 } };
	if (method === 'POST' && path === ACCOUNT_PATH) return { status: 201, body: account() };
	if (method === 'GET' && /^\/auth\/accounts\/[^/]+\/careers$/.test(path)) return { status: 200, body: { items: [] } };
	if (method === 'POST' && /^\/auth\/accounts\/[^/]+\/careers$/.test(path)) return { status: 201, body: grant({ user_id: path.split('/')[3] }) };
	if (method === 'POST' && /^\/auth\/career-grants\/[^/]+\/revoke$/.test(path)) return { status: 200, body: revokedGrant({ id: path.split('/')[3] }) };
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
	const output = ts.transpileModule(`${code}\nreturn { queryError, selectedAccount, grantState, grants, accountSearchState, accounts };`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
	const value = await new vm.Script(`(async () => { ${output} })()`).runInContext(fixture.sandbox);
	return { ...fixture, value, source };
}

test('admin account creation posts trimmed credentials to the accounts endpoint and returns the exact reception account', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	const submitted = new FormData();
	submitted.set('username', ' recepcion01 ');
	submitted.set('password', 'clave-de-prueba');
	submitted.set('email', 'recepcion@example.invalid');
	assert.equal(actions.createReceptionAccount.accept, 'form');
	assert.equal(actions.createReceptionAccount.input.safeParse(Object.fromEntries(submitted)).success, true);
	const result = await actions.createReceptionAccount.handler({ username: ' recepcion01 ', password: 'clave-de-prueba', email: ' recepcion@example.invalid ', extra: 'ignored' }, { cookies: fixture.cookies });
	assert.equal(result.success, true);
	assert.deepEqual(plain(result.account), account());
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, 'https://backend.invalid/auth/accounts');
	assert.equal(fixture.requests[0].method, 'POST');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
	assert.deepEqual(JSON.parse(fixture.requests[0].body), { username: 'recepcion01', password: 'clave-de-prueba', email: 'recepcion@example.invalid' });
});

test('account creation accepts only the exact 201 reception contract', async () => {
	const malformed = [
		account({ role: 'admin' }),
		{ ...account(), password: 'leaked' },
		without(account(), 'email'),
		account({ id: 'not-a-uuid' }),
		account({ createdAt: 'yesterday' }),
		account({ username: 'recepcion01' }),
		account({ email: 42 }),
		account({ username: 7 }),
	];
	for (const body of malformed) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === ACCOUNT_PATH ? { status: 201, body } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.createReceptionAccount.handler(validCreate, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(body));
		assert.equal(result.account, undefined);
		assert.equal(result.error, GENERIC);
	}
});

test('account creation refuses incomplete or non-string input before any request', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	for (const input of [
		{ username: '', password: 'clave-de-prueba', email: 'recepcion@example.invalid' },
		{ username: '   ', password: 'clave-de-prueba', email: 'recepcion@example.invalid' },
		{ username: 'recepcion01', email: 'recepcion@example.invalid' },
		{ username: 'recepcion01', password: '', email: 'recepcion@example.invalid' },
		{ username: 'recepcion01', password: 'clave-de-prueba', email: 42 },
	]) {
		const result = await actions.createReceptionAccount.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(input));
	}
	assert.equal(actions.createReceptionAccount.input.safeParse({ username: 'recepcion01', email: 'recepcion@example.invalid' }).success, false);
	assert.deepEqual(fixture.requests, []);
});

test('account creation maps every backend failure to its own public message without backend detail', async () => {
	for (const status of [400, 401, 403, 404, 409, 500]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === ACCOUNT_PATH ? { status, body: errorBody } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.createReceptionAccount.handler(validCreate, { cookies: fixture.cookies });
		assert.deepEqual(plain(result), { success: false, error: status === 409 ? CREATE_CONFLICT : publicMessages[status] ?? GENERIC }, `status ${status}`);
		assert.doesNotMatch(result.error, /private backend detail/);
		assert.equal(fixture.cookieState.token, status === 401 ? undefined : adminToken);
		assert.equal(fixture.requests.length, 1);
	}
});

test('grant listing reads the account careers path and keeps active and revoked periods in server order', async () => {
	const items = [revokedGrant({ id: grantId, career: 'kinesiology' }), grant({ id: otherGrantId, career: 'odontology', granted_at: later })];
	const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === careersPath(accountId) ? { status: 200, body: { items } } : undefined) });
	const api = await fixture.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await api.listReceptionCareerGrants(accountId, fixture.cookies)), { state: 'success', items });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, `https://backend.invalid${careersPath(accountId)}`);
	assert.equal(fixture.requests[0].method, 'GET');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
});

test('grant listing rejects foreign, extra, unknown-career, or half-revoked rows and malformed envelopes', async () => {
	const malformedItems = [
		[grant({ user_id: otherAccountId })],
		[{ ...grant(), extra: true }],
		[without(grant(), 'career')],
		[grant({ career: 'dentistry' })],
		[grant({ revoked_by: actorId })],
		[grant({ revoked_at: later })],
		[grant({ granted_at: 'yesterday' })],
		[grant({ id: 'not-a-uuid' })],
		[grant({ granted_by: null })],
	];
	for (const items of malformedItems) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === careersPath(accountId) ? { status: 200, body: { items } } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.listReceptionCareerGrants(accountId, fixture.cookies)), { state: 'failed' }, JSON.stringify(items));
	}
	for (const body of [{}, { items: 'none' }, []]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === careersPath(accountId) ? { status: 200, body } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.listReceptionCareerGrants(accountId, fixture.cookies)), { state: 'failed' }, JSON.stringify(body));
	}
});

test('unknown accounts are an empty success while forbidden, failing, and expired reads keep their own outcome', async () => {
	const empty = await evaluate();
	const emptyApi = await empty.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await emptyApi.listReceptionCareerGrants(otherAccountId, empty.cookies)), { state: 'success', items: [] });
	for (const [status, expected] of [[403, 'denied'], [500, 'failed']]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'GET' && path === careersPath(accountId) ? { status, body: errorBody } : undefined) });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.listReceptionCareerGrants(accountId, fixture.cookies)), { state: expected });
		assert.equal(fixture.cookieState.token, adminToken);
	}
	const network = await evaluate({ networkError: true });
	const networkApi = await network.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await networkApi.listReceptionCareerGrants(accountId, network.cookies)), { state: 'failed' });
	const expired = await evaluate({ reply: (method, path) => (method === 'GET' && path === careersPath(accountId) ? { status: 401, body: errorBody } : undefined) });
	const expiredApi = await expired.load('src/pods/reception-account/api.ts');
	await assert.rejects(expiredApi.listReceptionCareerGrants(accountId, expired.cookies), { status: 401 });
	assert.equal(expired.cookieState.token, undefined);
});

test('grant creation posts only the career to the account path and validates the active 201 grant', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	assert.equal(actions.grantReceptionCareer.input.safeParse({ account_id: accountId, career: 'kinesiology' }).success, true);
	assert.equal(actions.grantReceptionCareer.input.safeParse({ account_id: accountId, career: 'dentistry' }).success, false);
	const result = await actions.grantReceptionCareer.handler({ account_id: accountId, career: 'kinesiology', user_id: otherAccountId }, { cookies: fixture.cookies });
	assert.deepEqual(plain(result), { success: true, grant: grant() });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, `https://backend.invalid${careersPath(accountId)}`);
	assert.equal(fixture.requests[0].method, 'POST');
	assert.deepEqual(JSON.parse(fixture.requests[0].body), { career: 'kinesiology' });
});

test('grant creation refuses invalid account or career before any request', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	for (const input of [
		{ account_id: 'not-a-uuid', career: 'kinesiology' },
		{ account_id: accountId, career: 'dentistry' },
		{ account_id: accountId },
		{ career: 'odontology' },
	]) {
		const result = await actions.grantReceptionCareer.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(input));
	}
	assert.deepEqual(fixture.requests, []);
});

test('grant creation rejects 201 responses that are not an active grant for the requested account and career', async () => {
	const malformed = [
		revokedGrant(),
		grant({ user_id: otherAccountId }),
		grant({ career: 'odontology' }),
		{ ...grant(), extra: true },
	];
	for (const body of malformed) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === careersPath(accountId) ? { status: 201, body } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.grantReceptionCareer.handler({ account_id: accountId, career: 'kinesiology' }, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(body));
		assert.equal(result.grant, undefined);
		assert.equal(result.error, GENERIC);
	}
});

test('grant creation maps duplicate active access to its own conflict and other failures to public copy', async () => {
	for (const status of [400, 401, 403, 404, 409, 500]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === careersPath(accountId) ? { status, body: errorBody } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.grantReceptionCareer.handler({ account_id: accountId, career: 'odontology' }, { cookies: fixture.cookies });
		assert.deepEqual(plain(result), { success: false, error: status === 409 ? GRANT_CONFLICT : publicMessages[status] ?? GENERIC }, `status ${status}`);
		assert.doesNotMatch(result.error, /private backend detail/);
		assert.equal(fixture.cookieState.token, status === 401 ? undefined : adminToken);
	}
});

test('revocation requires explicit confirmation and a UUID grant before any request', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	assert.equal(actions.revokeReceptionCareerGrant.input.safeParse({ id: grantId }).success, true);
	assert.equal(actions.revokeReceptionCareerGrant.input.safeParse({ id: 'not-a-uuid' }).success, false);
	for (const input of [
		{ id: grantId, confirm: 'no' },
		{ id: grantId },
		{ id: 'not-a-uuid', confirm: 'yes' },
		{ id: '', confirm: 'yes' },
	]) {
		const result = await actions.revokeReceptionCareerGrant.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(input));
	}
	assert.deepEqual(fixture.requests, []);
});

test('confirmed revocation posts without a body to the grant revoke path and returns validated audit facts', async () => {
	const fixture = await evaluate();
	const actions = await fixture.load('src/pods/reception-account/actions.ts');
	const submitted = new FormData();
	submitted.set('id', grantId);
	submitted.set('confirm', 'yes');
	assert.equal(actions.revokeReceptionCareerGrant.input.safeParse(Object.fromEntries(submitted)).success, true);
	const result = await actions.revokeReceptionCareerGrant.handler({ id: grantId, confirm: 'yes', revoked_by: otherAccountId }, { cookies: fixture.cookies });
	assert.deepEqual(plain(result), { success: true, id: grantId, grant: revokedGrant() });
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, `https://backend.invalid${revokePath(grantId)}`);
	assert.equal(fixture.requests[0].method, 'POST');
	assert.equal(fixture.requests[0].body, undefined);
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
});

test('revocation rejects responses for another grant or without revocation audit and maps errors publicly', async () => {
	for (const body of [revokedGrant({ id: otherGrantId }), grant(), { ...revokedGrant(), extra: true }]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === revokePath(grantId) ? { status: 200, body } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.revokeReceptionCareerGrant.handler({ id: grantId, confirm: 'yes' }, { cookies: fixture.cookies });
		assert.equal(result.success, false, JSON.stringify(body));
		assert.equal(result.error, GENERIC);
	}
	for (const status of [400, 401, 403, 404, 409, 500]) {
		const fixture = await evaluate({ reply: (method, path) => (method === 'POST' && path === revokePath(grantId) ? { status, body: errorBody } : undefined) });
		const actions = await fixture.load('src/pods/reception-account/actions.ts');
		const result = await actions.revokeReceptionCareerGrant.handler({ id: grantId, confirm: 'yes' }, { cookies: fixture.cookies });
		assert.deepEqual(plain(result), { success: false, id: grantId, error: status === 409 ? REVOKE_CONFLICT : publicMessages[status] ?? GENERIC }, `status ${status}`);
		assert.equal(fixture.cookieState.token, status === 401 ? undefined : adminToken);
	}
});

test('server-rendered page redirects missing sessions and non-admin roles before any backend read', async () => {
	const missing = await evaluatePage('', { token: null });
	assert.deepEqual(plain(missing.value), { redirect: '/auth/login?returnTo=%2Freception-accounts' });
	assert.deepEqual(missing.requests, []);
	for (const token of [receptionToken, 'not-a-jwt']) {
		const denied = await evaluatePage(`account_id=${accountId}`, { token });
		assert.deepEqual(plain(denied.value), { redirect: '/auth/login' });
		assert.deepEqual(denied.requests, []);
	}
});

test('account search rejects duplicate, unknown, invalid-career, and out-of-range URL filters', async () => {
	const fixture = await evaluate();
	const search = await fixture.load('src/pods/reception-account/search.ts');
	for (const query of ['q=a&q=b', 'admin=true', 'career=dentistry', 'limit=0', 'limit=101', 'offset=-1', 'offset=10001', 'limit=1.5']) {
		assert.throws(() => search.parseReceptionAccountSearch(new URLSearchParams(query)), /filtros de búsqueda/);
	}
	assert.deepEqual(plain(search.parseReceptionAccountSearch(new URLSearchParams('q=%20ana%20&limit=1&offset=10000'))), { q: 'ana', career: '', limit: 1, offset: 10000 });
});

test('account search limits the trimmed term to 100 characters', async () => {
	const fixture = await evaluate();
	const search = await fixture.load('src/pods/reception-account/search.ts');
	const hundred = 'a'.repeat(100);
	assert.throws(() => search.parseReceptionAccountSearch(new URLSearchParams({ q: `${hundred}b` })), /filtros de búsqueda/);
	assert.equal(search.parseReceptionAccountSearch(new URLSearchParams({ q: hundred })).q, hundred);
	assert.equal(search.parseReceptionAccountSearch(new URLSearchParams({ q: `  ${hundred}  ` })).q, hundred);
});

test('account search offers a next page only while the next offset stays within 10000', async () => {
	const fixture = await evaluate();
	const search = await fixture.load('src/pods/reception-account/search.ts');
	assert.equal(search.nextReceptionAccountOffset(9950, 50, 50), 10000);
	assert.equal(search.nextReceptionAccountOffset(9999, 1, 1), 10000);
	assert.equal(search.nextReceptionAccountOffset(10000, 50, 50), null);
	assert.equal(search.nextReceptionAccountOffset(9951, 50, 50), null);
	assert.equal(search.nextReceptionAccountOffset(0, 50, 49), null);
});

test('form action posts keep the framework _action parameter out of search validation and refresh grants', async () => {
	const request = new Request('https://frontend.invalid/reception-accounts?_action=grantReceptionCareer', {
		method: 'POST',
		body: new URLSearchParams({ account_id: accountId, career: 'kinesiology' }),
	});
	const result = await evaluatePage('_action=grantReceptionCareer', { request, actionResults: { grantReceptionCareer: { data: { success: true, grant: grant() } } } });
	assert.equal(result.value.queryError, '');
	assert.equal(result.value.accountSearchState, 'success');
	assert.equal(result.value.selectedAccount, accountId);
	assert.equal(result.value.grantState, 'success');
	assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), [ACCOUNT_PATH, careersPath(accountId)]);
	assert.equal(new URL(result.requests[0].url).search, '?limit=50&offset=0');
});

test('account search builds encoded bounded query parameters and validates the minimal response contract', async () => {
	const rows = [{ id: accountId, username: 'RECEPCION01', email: null, active_careers: ['kinesiology'] }];
	const fixture = await evaluate({ reply: (method, path) => method === 'GET' && path === ACCOUNT_PATH ? { status: 200, body: { items: rows, limit: 25, offset: 50 } } : undefined });
	const api = await fixture.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await api.searchReceptionAccounts({ q: '  ana+@example  ', career: 'odontology', limit: 25, offset: 50 }, fixture.cookies)), { state: 'success', items: rows, limit: 25, offset: 50 });
	assert.equal(new URL(fixture.requests[0].url).pathname, ACCOUNT_PATH);
	assert.equal(new URL(fixture.requests[0].url).search, '?q=ana%2B%40example&career=odontology&limit=25&offset=50');
	assert.equal(fixture.requests[0].method, 'GET');
	assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${adminToken}`);
	for (const bad of [
		{ items: [{ ...rows[0], role: 'reception' }], limit: 25, offset: 50 },
		{ items: [{ ...rows[0], createdAt: iso }], limit: 25, offset: 50 },
		{ items: [{ ...rows[0], active_careers: ['dentistry'] }], limit: 25, offset: 50 },
		{ items: rows, limit: 101, offset: 50 },
		{ items: rows, limit: 25, offset: 10001 },
	]) {
		const invalid = await evaluate({ reply: (method, path) => method === 'GET' && path === ACCOUNT_PATH ? { status: 200, body: bad } : undefined });
		const invalidApi = await invalid.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await invalidApi.searchReceptionAccounts({ q: '', career: '', limit: 25, offset: 50 }, invalid.cookies)), { state: 'failed' });
	}
});

test('account search distinguishes denied, expired, failed and empty responses without leaking backend details', async () => {
	for (const [status, expected] of [[403, 'denied'], [500, 'failed']]) {
		const fixture = await evaluate({ reply: (method, path) => method === 'GET' && path === ACCOUNT_PATH ? { status, body: errorBody } : undefined });
		const api = await fixture.load('src/pods/reception-account/api.ts');
		assert.deepEqual(plain(await api.searchReceptionAccounts({ q: '', career: '', limit: 50, offset: 0 }, fixture.cookies)), { state: expected });
	}
	const expired = await evaluate({ reply: (method, path) => method === 'GET' && path === ACCOUNT_PATH ? { status: 401, body: errorBody } : undefined });
	const expiredApi = await expired.load('src/pods/reception-account/api.ts');
	await assert.rejects(expiredApi.searchReceptionAccounts({ q: '', career: '', limit: 50, offset: 0 }, expired.cookies), { status: 401 });
	assert.equal(expired.cookieState.token, undefined);
	const empty = await evaluate();
	const emptyApi = await empty.load('src/pods/reception-account/api.ts');
	assert.deepEqual(plain(await emptyApi.searchReceptionAccounts({ q: '', career: '', limit: 50, offset: 0 }, empty.cookies)), { state: 'success', items: [], limit: 50, offset: 0 });
});

test('admin account page searches by username/email, filters, paginates, and keeps UUID only in internal selection', async () => {
	const rows = [{ id: accountId, username: 'RECEPCION01', email: null, active_careers: ['kinesiology'] }];
	const result = await evaluatePage('q=ana%2B%40example&career=kinesiology&limit=25&offset=25', { reply: (method, path) => method === 'GET' && path === ACCOUNT_PATH ? { status: 200, body: { items: rows, limit: 25, offset: 25 } } : undefined });
	assert.deepEqual(plain(result.value.accounts), rows);
	assert.equal(result.value.accountSearchState, 'success');
	assert.equal(new URL(result.requests[0].url).search, '?q=ana%2B%40example&career=kinesiology&limit=25&offset=25');
	assert.match(result.source, /Buscar cuenta/);
	assert.match(result.source, /account\.username/);
	assert.doesNotMatch(result.source, /Todavía no existe un listado de cuentas de recepción/);
	assert.match(result.source, /name="account_id"/);
});

test('admin page reads grants only for a valid selected account and treats unknown accounts as an empty state', async () => {
	const result = await evaluatePage(`account_id=${accountId}`);
	assert.equal(result.value.selectedAccount, accountId);
	assert.equal(result.value.grantState, 'success');
	assert.deepEqual(plain(result.value.grants), []);
	assert.deepEqual(result.requests.map(({ url, method }) => [method, new URL(url).pathname]), [['GET', ACCOUNT_PATH], ['GET', careersPath(accountId)]]);
	const invalid = await evaluatePage('account_id=not-a-uuid');
	assert.notEqual(invalid.value.queryError, '');
	assert.equal(invalid.value.selectedAccount, '');
	assert.deepEqual(invalid.requests, []);
	const repeated = await evaluatePage(`account_id=${accountId}&account_id=${otherAccountId}`);
	assert.notEqual(repeated.value.queryError, '');
	assert.deepEqual(repeated.requests, []);
});

test('a successful creation becomes the selected account even when the URL points elsewhere', async () => {
	const request = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ account_id: otherAccountId, ...validCreate }),
	});
	const result = await evaluatePage('', { request, actionResults: { createReceptionAccount: { data: { success: true, account: account() } } } });
	assert.equal(result.value.selectedAccount, accountId);
	assert.equal(result.value.grantState, 'success');
	assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), [ACCOUNT_PATH, careersPath(accountId)]);
});

test('failed submissions keep the submitted account selected and ignore malformed submitted ids', async () => {
	const grantRequest = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ account_id: accountId, career: 'kinesiology' }),
	});
	const granted = await evaluatePage('', { request: grantRequest, actionResults: { grantReceptionCareer: { data: { success: false, error: GRANT_CONFLICT } } } });
	assert.equal(granted.value.selectedAccount, accountId);
	assert.equal(granted.value.grantState, 'success');
	const revokeRequest = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ account_id: accountId, id: grantId, confirm: 'yes' }),
	});
	const revoked = await evaluatePage('', { request: revokeRequest, actionResults: { revokeReceptionCareerGrant: { data: { success: false, id: grantId, error: REVOKE_CONFLICT } } } });
	assert.equal(revoked.value.selectedAccount, accountId);
	const malformedRequest = new Request('https://frontend.invalid/reception-accounts', {
		method: 'POST',
		body: new URLSearchParams({ account_id: 'not-a-uuid', ...validCreate }),
	});
	const malformed = await evaluatePage('', { request: malformedRequest, actionResults: { createReceptionAccount: { data: { success: false, error: GENERIC } } } });
	assert.equal(malformed.value.selectedAccount, '');
	assert.deepEqual(malformed.requests.map(({ url }) => new URL(url).pathname), [ACCOUNT_PATH]);
});

test('page keeps Spanish copy, explicit career labels, confirmation, and only the three documented account endpoints', async () => {
	const page = await readFile(new URL('../src/pages/reception-accounts.astro', import.meta.url), 'utf8');
	const api = await readFile(new URL('../src/pods/reception-account/api.ts', import.meta.url), 'utf8');
	assert.match(page, /export const prerender = false/);
	assert.match(page, /payload\.role !== 'admin'/);
	assert.match(page, /Buscar cuenta/);
	assert.match(page, /method="GET"[^>]*action="\/reception-accounts"|action="\/reception-accounts"[^>]*method="GET"/);
	assert.match(page, /name="account_id"/);
	assert.match(page, /name="confirm" value="yes" required/);
	for (const action of ['createReceptionAccount', 'grantReceptionCareer', 'revokeReceptionCareerGrant']) {
		assert.match(page, new RegExp(`actions\\.${action}\\b`));
	}
	assert.match(api, /kinesiology: 'Kinesiología'/);
	assert.match(api, /odontology: 'Odontología'/);
	assert.match(api, /`\/auth\/accounts\/\$\{userId\}\/careers`/);
	assert.match(api, /`\/auth\/career-grants\/\$\{grantId\}\/revoke`/);
	assert.match(api, /'\/auth\/accounts'/);
	assert.doesNotMatch(page + api, /\/students|\/teachers|listTeacher|listStudent/);
	assert.doesNotMatch(page, /<script>/, 'account lookup and forms work without JavaScript');
});
