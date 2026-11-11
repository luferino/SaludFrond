import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z as realZod } from 'astro/zod';

// Isolated harness: real TypeScript modules and Astro frontmatter, fake cookies and backend.
const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const grantId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const exp = 4102444800;
const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join('.');
const studentToken = jwt({ sub: userId, username: 'ALUMNO01', role: 'estudiante', permissions: ['kinesiology-evaluations:write'], exp, iat: 1767225600 });
const receptionToken = jwt({ sub: userId, username: 'ALUMNO01', role: 'reception', role_grant_id: grantId, permissions: ['reception:patients:write'], exp, iat: 1767225600 });
const errorBody = (code) => ({ error: { code, message: 'private backend detail' } });
const FORBIDDEN = 'Tu cuenta no tiene habilitado ese rol. Pedile a un administrador que lo revise.';
const GENERIC = 'No se pudo cambiar el rol. Intentá nuevamente.';
const dual = { active_role: 'estudiante', available_roles: ['estudiante', 'reception'] };

function defaultReply(method, path) {
	if (method === 'GET' && path === '/auth/roles') return { status: 200, body: dual };
	if (method === 'POST' && path === '/auth/active-role') return { status: 200, body: { token: receptionToken } };
	return { status: 404, body: errorBody('NOT_FOUND') };
}

async function fixture(options = {}) {
	const token = 'token' in options ? options.token : studentToken;
	const cookieState = { token, writes: [] };
	const cookies = {
		get: (name) => name === 'session' && cookieState.token ? { value: cookieState.token } : undefined,
		set: (...args) => { cookieState.writes.push(['set', ...args]); cookieState.token = args[1]; },
		delete: (...args) => { cookieState.writes.push(['delete', ...args]); cookieState.token = undefined; },
	};
	const requests = [];
	const sandbox = vm.createContext({ URL, URLSearchParams, Response, Request, Error, Date, atob, Math, JSON,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('offline');
			const { pathname } = new URL(url);
			const reply = options.reply?.(init.method, pathname) ?? defaultReply(init.method, pathname);
			return Response.json(reply.body, { status: reply.status });
		},
	});
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

// Runs Astro frontmatter with its real imports; `astro:actions` resolves to the active-role actions module.
async function evaluateAstro(path, names, options = {}) {
	const context = await fixture(options);
	const url = new URL(path, root);
	const code = await readFile(url, 'utf8');
	const frontmatter = code.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
	const parsed = ts.createSourceFile(url.pathname, frontmatter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const removals = [];
	const actionModule = await context.load('src/pods/active-role/actions.ts');
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		removals.push([statement.getFullStart(), statement.getEnd()]);
		const clause = statement.importClause;
		if (!clause || statement.getText(parsed).startsWith('import type ')) continue;
		const specifier = statement.moduleSpecifier.text;
		let namespace;
		if (specifier === 'astro:actions') namespace = { actions: actionModule };
		else if (specifier.endsWith('.astro')) namespace = { default: {} };
		else namespace = await context.load(new URL(/\.ts$/.test(specifier) ? specifier : `${specifier}.ts`, url).href);
		if (clause.name) context.sandbox[clause.name.text] = namespace.default;
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) context.sandbox[element.name.text] = namespace[element.propertyName?.text ?? element.name.text];
		}
	}
	let body = frontmatter;
	for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) body = body.slice(0, start) + body.slice(end);
	body = body.replace(/^export const prerender = false;\s*$/m, '');
	const response = { status: 200 };
	context.sandbox.Astro = {
		cookies: context.cookies,
		response,
		url: new URL('https://frontend.invalid/active-role'),
		redirect: (location) => ({ redirect: location }),
		getActionResult: (action) => action === actionModule.switchActiveRole ? options.result : undefined,
	};
	const output = ts.transpileModule(`${body}\nreturn { ${names.join(', ')} };`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
	const value = await new vm.Script(`(async () => { ${output} })()`).runInContext(context.sandbox);
	return { ...context, value, response, source: code };
}

test('roles parser accepts only the exact frozen discovery shape', async () => {
	const { isRolesResponse } = await (await fixture()).load('src/pods/active-role/api.ts');
	assert.equal(isRolesResponse(dual), true);
	assert.equal(isRolesResponse({ active_role: 'reception', available_roles: ['estudiante', 'reception'] }), true);
	assert.equal(isRolesResponse({ active_role: 'admin', available_roles: ['admin'] }), true);
	for (const value of [
		null, [], 'estudiante', {},
		{ active_role: 'estudiante' },
		{ available_roles: ['estudiante'] },
		{ ...dual, extra: true },
		{ active_role: 1, available_roles: ['estudiante'] },
		{ active_role: 'estudiante', available_roles: 'estudiante' },
		{ active_role: 'estudiante', available_roles: [] },
		{ active_role: 'estudiante', available_roles: ['estudiante', 'estudiante'] },
		{ active_role: 'estudiante', available_roles: ['estudiante', null] },
		{ active_role: 'estudiante', available_roles: ['estudiante', ''] },
		{ active_role: 'reception', available_roles: ['estudiante'] },
	]) assert.equal(isRolesResponse(value), false, JSON.stringify(value));
});

test('switch targets list labelled non-active roles only for Student and Reception accounts', async () => {
	const { switchTargets, roleLabel, mayHoldAdditionalRole } = await (await fixture()).load('src/pods/active-role/api.ts');
	assert.deepEqual(plain(switchTargets(dual)), [{ role: 'reception', label: 'Recepción' }]);
	assert.deepEqual(plain(switchTargets({ active_role: 'reception', available_roles: ['estudiante', 'reception'] })), [{ role: 'estudiante', label: 'Estudiante' }]);
	assert.deepEqual(plain(switchTargets({ active_role: 'student', available_roles: ['student', 'reception'] })), [{ role: 'reception', label: 'Recepción' }]);
	assert.deepEqual(plain(switchTargets({ active_role: 'estudiante', available_roles: ['estudiante'] })), []);
	assert.deepEqual(plain(switchTargets({ active_role: 'estudiante', available_roles: ['estudiante', 'admin'] })), []);
	assert.equal(roleLabel('estudiante'), 'Estudiante');
	assert.equal(roleLabel('student'), 'Estudiante');
	assert.equal(roleLabel('reception'), 'Recepción');
	assert.equal(roleLabel('admin'), undefined);
	for (const role of ['estudiante', 'student', 'reception']) assert.equal(mayHoldAdditionalRole(role), true);
	for (const role of ['admin', 'teacher', 'docente', 'Reception', undefined, null, 1]) assert.equal(mayHoldAdditionalRole(role), false);
});

test('role discovery reads GET /auth/roles with the session and fails closed without touching cookies', async () => {
	const ok = await fixture();
	const { getActiveRoles } = await ok.load('src/pods/active-role/api.ts');
	assert.deepEqual(plain(await getActiveRoles(ok.cookies)), { state: 'success', roles: dual });
	assert.equal(ok.requests.length, 1);
	assert.equal(ok.requests[0].url, 'https://backend.invalid/auth/roles');
	assert.equal(ok.requests[0].method, 'GET');
	assert.equal(ok.requests[0].headers.Authorization, `Bearer ${studentToken}`);
	assert.equal(ok.requests[0].body, undefined);
	for (const options of [
		{ reply: () => ({ status: 401, body: errorBody('UNAUTHORIZED') }) },
		{ reply: () => ({ status: 403, body: errorBody('FORBIDDEN') }) },
		{ reply: () => ({ status: 500, body: errorBody('INTERNAL_SERVER_ERROR') }) },
		{ reply: () => ({ status: 200, body: { ...dual, extra: 1 } }) },
		{ networkError: true },
	]) {
		const failed = await fixture(options);
		const api = await failed.load('src/pods/active-role/api.ts');
		assert.deepEqual(plain(await api.getActiveRoles(failed.cookies)), { state: 'failed' });
		assert.deepEqual(failed.cookieState.writes, []);
		assert.equal(failed.cookieState.token, studentToken);
	}
});

test('switch posts exactly {role}, replaces the session cookie and keeps the same identity', async () => {
	const context = await fixture();
	const { handleSwitchActiveRole } = await context.load('src/pods/active-role/actions.ts');
	const before = Date.now();
	assert.deepEqual(plain(await handleSwitchActiveRole({ role: 'reception' }, { cookies: context.cookies })), { success: true });
	assert.equal(context.requests.length, 1);
	assert.equal(context.requests[0].url, 'https://backend.invalid/auth/active-role');
	assert.equal(context.requests[0].method, 'POST');
	assert.equal(context.requests[0].headers.Authorization, `Bearer ${studentToken}`);
	assert.equal(context.requests[0].body, JSON.stringify({ role: 'reception' }));
	assert.equal(context.cookieState.writes.length, 1);
	const [kind, name, value, cookieOptions] = context.cookieState.writes[0];
	assert.equal(kind, 'set');
	assert.equal(name, 'session');
	assert.equal(value, receptionToken);
	assert.equal(cookieOptions.path, '/');
	assert.equal(cookieOptions.httpOnly, true);
	assert.equal(cookieOptions.sameSite, 'lax');
	const expected = exp - Math.floor(before / 1000);
	assert.ok(Math.abs(cookieOptions.maxAge - expected) <= 2, `maxAge ${cookieOptions.maxAge} tracks token expiry`);
	const back = await fixture({ token: receptionToken, reply: (method, path) => method === 'POST' && path === '/auth/active-role' ? { status: 200, body: { token: studentToken } } : undefined });
	const actions = await back.load('src/pods/active-role/actions.ts');
	assert.deepEqual(plain(await actions.handleSwitchActiveRole({ role: 'estudiante' }, { cookies: back.cookies })), { success: true });
	assert.equal(back.cookieState.token, studentToken);
});

test('switch maps 401 to re-login, 403 to the role notice and every other failure to the generic notice', async () => {
	const cases = [
		[{ reply: () => ({ status: 401, body: errorBody('UNAUTHORIZED') }) }, { success: false, reason: 'unauthorized' }, [['delete', 'session', { path: '/' }]]],
		[{ reply: () => ({ status: 403, body: errorBody('FORBIDDEN') }) }, { success: false, reason: 'forbidden', error: FORBIDDEN }, []],
		[{ reply: () => ({ status: 400, body: errorBody('BAD_REQUEST') }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ reply: () => ({ status: 500, body: errorBody('INTERNAL_SERVER_ERROR') }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ networkError: true }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ reply: () => ({ status: 200, body: { token: receptionToken, role: 'reception' } }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ reply: () => ({ status: 200, body: { token: 'not-a-jwt' } }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ reply: () => ({ status: 200, body: { token: studentToken } }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ reply: () => ({ status: 200, body: { token: jwt({ sub: 'cccccccc-cccc-cccc-cccc-cccccccccccc', username: 'OTRO', role: 'reception', exp, iat: 1 }) } }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ reply: () => ({ status: 200, body: { token: jwt({ sub: userId, username: 'OTRO', role: 'reception', exp, iat: 1 }) } }) }, { success: false, reason: 'failed', error: GENERIC }, []],
		[{ token: jwt({ username: 'ALUMNO01', role: 'estudiante', exp, iat: 1 }), reply: () => ({ status: 200, body: { token: jwt({ username: 'ALUMNO01', role: 'reception', exp, iat: 1 }) } }) }, { success: false, reason: 'failed', error: GENERIC }, []],
	];
	for (const [options, expected, writes] of cases) {
		const context = await fixture(options);
		const { handleSwitchActiveRole } = await context.load('src/pods/active-role/actions.ts');
		assert.deepEqual(plain(await handleSwitchActiveRole({ role: 'reception' }, { cookies: context.cookies })), expected);
		assert.deepEqual(plain(context.cookieState.writes), writes);
		// One request only: a refused or revoked switch never falls back to another role.
		assert.equal(context.requests.length, 1);
		if (!writes.length) assert.equal(context.cookieState.token, options.token ?? studentToken);
	}
});

test('switch rejects malformed roles before calling the backend', async () => {
	for (const input of [{}, { role: '' }, { role: '   ' }, { role: 1 }, { role: 'Reception' }, { role: 'a'.repeat(33) }, { role: 'reception;admin' }, { role: 'admin' }, { role: 'teacher' }]) {
		const context = await fixture();
		const { handleSwitchActiveRole } = await context.load('src/pods/active-role/actions.ts');
		assert.deepEqual(plain(await handleSwitchActiveRole(input, { cookies: context.cookies })), { success: false, reason: 'failed', error: GENERIC });
		assert.equal(context.requests.length, 0);
		assert.deepEqual(context.cookieState.writes, []);
	}
	const { switchActiveRole } = await (await fixture()).load('src/pods/active-role/actions.ts');
	assert.equal(switchActiveRole.accept, 'form');
	assert.equal(switchActiveRole.input.safeParse({ role: 'reception' }).success, true);
	assert.equal(switchActiveRole.input.safeParse({ role: '' }).success, false);
});

test('active-role page redirects home on success, to login on 401 and shows public notices otherwise', async () => {
	const page = 'src/pages/active-role.astro';
	for (const [result, location] of [
		[undefined, '/'],
		[{ data: { success: true } }, '/'],
		[{ data: { success: false, reason: 'unauthorized' } }, '/auth/login'],
	]) {
		const { value } = await evaluateAstro(page, ['message'], { result });
		assert.equal(value.redirect, location);
	}
	for (const [result, message, status] of [
		[{ data: { success: false, reason: 'forbidden', error: FORBIDDEN } }, FORBIDDEN, 403],
		[{ data: { success: false, reason: 'failed', error: GENERIC } }, GENERIC, 400],
		[{ error: { message: 'private validation detail' } }, GENERIC, 400],
	]) {
		const { value, response } = await evaluateAstro(page, ['message'], { result });
		assert.equal(value.message, message);
		assert.equal(response.status, status);
	}
	const markup = await source(page);
	assert.match(markup, /export const prerender = false;/);
	assert.match(markup, /role="alert"/);
	assert.match(markup, /<a href="\/">Volver al inicio<\/a>/);
	assert.doesNotMatch(markup, /set:html/);
});

test('role switch shows the active role and posts each target to the active-role page', async () => {
	const component = 'src/pods/active-role/components/RoleSwitch.astro';
	const shown = await evaluateAstro(component, ['activeLabel', 'targets']);
	assert.equal(shown.value.activeLabel, 'Estudiante');
	assert.deepEqual(plain(shown.value.targets), [{ role: 'reception', label: 'Recepción' }]);
	assert.equal(shown.requests.length, 1);
	const reception = await evaluateAstro(component, ['activeLabel', 'targets'], { token: receptionToken, reply: () => ({ status: 200, body: { active_role: 'reception', available_roles: ['estudiante', 'reception'] } }) });
	assert.equal(reception.value.activeLabel, 'Recepción');
	assert.deepEqual(plain(reception.value.targets), [{ role: 'estudiante', label: 'Estudiante' }]);
	for (const options of [
		{ reply: () => ({ status: 200, body: { active_role: 'estudiante', available_roles: ['estudiante'] } }) },
		{ reply: () => ({ status: 401, body: errorBody('UNAUTHORIZED') }) },
		{ networkError: true },
	]) {
		const hidden = await evaluateAstro(component, ['activeLabel', 'targets'], options);
		assert.deepEqual(plain(hidden.value.targets), []);
		assert.deepEqual(hidden.cookieState.writes, []);
	}
	const markup = await source(component);
	assert.match(markup, /targets\.length > 0 && activeLabel &&/);
	assert.match(markup, /Rol activo: <strong>\{activeLabel\}<\/strong>/);
	assert.match(markup, /<form method="POST" action=\{`\/active-role\$\{actions\.switchActiveRole\}`\}>/);
	assert.match(markup, /<input type="hidden" name="role" value=\{target\.role\} \/>/);
	assert.match(markup, /<button type="submit">Cambiar a \{target\.label\}<\/button>/);
	assert.doesNotMatch(markup, /set:html|<script/);
});

test('layout renders the role switch only for Student and Reception sessions and keeps the session badge', async () => {
	const layout = await source('src/layouts/Layout.astro');
	assert.match(layout, /^import RoleSwitch from '\.\.\/pods\/active-role\/components\/RoleSwitch\.astro';$/m);
	assert.match(layout, /const showRoleSwitch = isLoggedIn && mayHoldAdditionalRole\(payload\?\.role\);/);
	assert.match(layout, /\{showRoleSwitch && <RoleSwitch \/>\}/);
	assert.match(layout, /\{isLoggedIn && <span class="session-badge">Sesión activa<\/span>\}/);
	const actions = await source('src/actions/index.ts');
	assert.match(actions, /import \{ switchActiveRole \} from '\.\.\/pods\/active-role\/actions';/);
	assert.match(actions, /^\tswitchActiveRole,$/m);
});

test('login keeps storing the returned token with an expiry-derived session cookie', async () => {
	const context = await fixture({ token: undefined, reply: (method, path) => method === 'POST' && path === '/auth/login' ? { status: 200, body: { token: studentToken } } : undefined });
	const { handleLogin } = await context.load('src/pods/auth/actions/login.ts');
	const before = Date.now();
	assert.deepEqual(plain(await handleLogin({ username: 'alumno01', password: 'clave', returnTo: '/my-patients' }, { cookies: context.cookies })), { success: true, returnTo: '/my-patients' });
	assert.equal(context.requests[0].body, JSON.stringify({ username: 'alumno01', password: 'clave' }));
	const [kind, name, value, cookieOptions] = context.cookieState.writes[0];
	assert.deepEqual([kind, name, value], ['set', 'session', studentToken]);
	assert.ok(Math.abs(cookieOptions.maxAge - (exp - Math.floor(before / 1000))) <= 2);
});

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}
