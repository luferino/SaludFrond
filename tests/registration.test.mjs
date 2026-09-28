import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Isolated source harness: real handlers/helpers, fake cookies and fetch, no server or backend.
// Astro frontmatter is executed; template wiring is checked, not browser-rendered.
const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
let requests = [];
let responseStatus = 201;
let actionResult;
const sandbox = vm.createContext({
	atob, Date, Response,
	Astro: { getActionResult: () => actionResult },
	fetch: async (url, options) => {
		requests.push({ url, ...options });
		return Response.json(responseStatus === 201 ? { id: 'new-account' } : {
			error: { code: 'BACKEND_ERROR', message: 'Backend validation message' },
		}, { status: responseStatus });
	},
});
const modules = new Map();
async function compile(code, identifier) {
	const output = ts.transpileModule(code, {
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = new vm.SourceTextModule(output, {
		context: sandbox, identifier,
		initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; },
	});
	await module.link(async (specifier, parent) => {
		if (specifier === 'astro/middleware' || specifier === 'astro:actions') {
			return new vm.SourceTextModule(specifier === 'astro/middleware'
				? 'export const defineMiddleware = (handler) => handler;'
				: 'export const actions = { register: "register" };', { context: sandbox });
		}
		const url = new URL(`${specifier}.ts`, parent.identifier);
		if (!modules.has(url.href)) modules.set(url.href, compile(await readFile(url, 'utf8'), url.href));
		return modules.get(url.href);
	});
	return module;
}
async function load(path, code) {
	const module = await compile(code ?? await source(path), new URL(path, root).href);
	await module.evaluate();
	return module.namespace;
}
const { handleRegister } = await load('src/pods/auth/actions/register.ts');
const { onRequest } = await load('src/middleware.ts');
const input = { username: 'NEWUSER', email: 'new@example.invalid', password: 'Password123' };
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const validPayload = { exp: Math.floor(Date.now() / 1000) + 3600, role: 'estudiante' };
function cookiesFor(token) {
	let value = token;
	const writes = [];
	return {
		writes,
		get: (name) => name === 'session' && value ? { value } : undefined,
		set: (...args) => { writes.push(['set', ...args]); value = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); value = undefined; },
	};
}

test('direct registration action rejects anonymous, malformed, and expired sessions before fetch', async () => {
	for (const token of [undefined, 'invalid', jwt(null), jwt({}),
		jwt({ exp: 1 }), jwt({ exp: String(validPayload.exp) }), jwt({ exp: [validPayload.exp] })]) {
		requests = [];
		const result = await handleRegister(input, {
			cookies: cookiesFor(token), url: new URL('https://frontend.invalid/auth/login?_action=register'),
		});
		assert.equal(result.success, false);
		assert.equal(result.redirectTo, '/auth/login?returnTo=%2Fauth%2Fregister');
		assert.equal(requests.length, 0);
	}
});

test('success sends the operator bearer and preserves session even without the permission hint', async () => {
	requests = [];
	responseStatus = 201;
	const token = jwt(validPayload);
	const cookies = cookiesFor(token);
	const result = await handleRegister(input, { cookies });
	assert.equal(result.success, true);
	assert.equal(result.redirectTo, undefined);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, 'https://backend.invalid/auth/register');
	assert.equal(requests[0].method, 'POST');
	assert.equal(requests[0].headers.Authorization, `Bearer ${token}`);
	assert.deepEqual(JSON.parse(requests[0].body), input);
	assert.equal(cookies.get('session').value, token);
	assert.deepEqual(cookies.writes, []);
});

test('backend 403 overrides a stale permission hint without clearing the operator session', async () => {
	requests = [];
	responseStatus = 403;
	const token = jwt({ ...validPayload, permissions: ['users:write'] });
	const cookies = cookiesFor(token);
	const result = await handleRegister(input, { cookies });
	assert.equal(requests.length, 1);
	assert.equal(result.success, false);
	assert.equal(result.error, 'No tiene permiso para registrar usuarios.');
	assert.equal(result.redirectTo, undefined);
	assert.equal(cookies.get('session').value, token);
	assert.deepEqual(cookies.writes, []);
});

test('backend 401 clears the session and requests login', async () => {
	responseStatus = 401;
	const cookies = cookiesFor(jwt(validPayload));
	const result = await handleRegister(input, { cookies });
	assert.equal(result.success, false);
	assert.equal(result.redirectTo, '/auth/login?returnTo=%2Fauth%2Fregister');
	assert.equal(cookies.get('session'), undefined);
	assert.equal(cookies.writes.length, 1);
	assert.equal(cookies.writes[0][0], 'delete');
});

test('validation and duplicate messages reach form frontmatter along with framework errors', async () => {
	const form = await source('src/pods/auth/components/RegisterForm.astro');
	const frontmatter = form.split('---')[1];
	for (const status of [400, 409]) {
		responseStatus = status;
		actionResult = { data: await handleRegister(input, { cookies: cookiesFor(jwt(validPayload)) }) };
		const { errorMessage } = await load('src/pods/auth/components/RegisterForm.astro',
			`${frontmatter}\nexport { errorMessage };`);
		assert.equal(errorMessage, 'Backend validation message');
	}
	actionResult = { error: { message: 'Framework validation error' } };
	const { errorMessage } = await load('src/pods/auth/components/RegisterForm.astro',
		`${frontmatter}\nexport { errorMessage };`);
	assert.equal(errorMessage, 'Framework validation error');
	assert.match(form, /role="alert">\{errorMessage\}/);
	assert.match(form, /result\?\.data\?\.success && \(/);
	assert.match(form, /role="status"/);
});

test('registration route requires a session while login and recovery remain public', async () => {
	for (const token of [undefined, 'invalid', jwt({ exp: 1 }), jwt(validPayload)]) {
		const result = await onRequest({
			url: new URL('https://frontend.invalid/auth/register'), cookies: cookiesFor(token),
			redirect: (location) => location,
		}, () => 'next');
		assert.equal(result, token === jwt(validPayload) ? 'next' : '/auth/login?returnTo=%2Fauth%2Fregister');
	}
	for (const path of ['/auth/login', '/auth/forgot-password', '/auth/reset-password']) {
		assert.equal(await onRequest({ url: new URL(path, 'https://frontend.invalid') }, () => 'next'), 'next');
	}
});

test('navigation uses a defensive users:write hint, never a registration role gate', async () => {
	const layout = await source('src/layouts/Layout.astro');
	const frontmatter = layout.split('---')[1];
	const cases = [
		[undefined, false], ['invalid', false],
		[jwt({ ...validPayload, exp: 1, permissions: ['users:write'] }), false],
		[jwt({ ...validPayload, permissions: ['users:write'] }), true],
		[jwt({ ...validPayload, role: 'admin' }), false],
		...[undefined, null, [], ['users:read'], 'users:write', {}, ['users:write', null]]
			.map((permissions) => [jwt({ ...validPayload, permissions }), false]),
	];
	for (const [token, expected] of cases) {
		sandbox.Astro.cookies = cookiesFor(token);
		const { canRegister } = await load('src/layouts/Layout.astro', `${frontmatter}\nexport { canRegister };`);
		assert.equal(canRegister, expected);
	}
	assert.equal(layout.match(/href="\/auth\/register"/g)?.length, 1);
	assert.match(layout, /\{canRegister && <a href="\/auth\/register">/);
});

test('registration presentation retains exactly three required inputs and the POST action', async () => {
	const form = await source('src/pods/auth/components/RegisterForm.astro');
	const inputs = [...form.matchAll(/<input\b[^>]*\/>/g)].map(([tag]) => tag);
	assert.deepEqual(inputs, [
		'<input type="text" id="username" name="username" required autocomplete="username" />',
		'<input type="email" id="email" name="email" required autocomplete="email" />',
		'<input type="password" id="password" name="password" required autocomplete="new-password" />',
	]);
	for (const name of ['username', 'email', 'password']) assert.match(form, new RegExp(`<label for="${name}">`));
	assert.match(form, /<form method="POST" action=\{actions\.register\} use:form/);
	assert.equal(form.match(/<button\b/g)?.length, 1);
	assert.match(form, /<button type="submit">Registrar usuario<\/button>/);
	assert.doesNotMatch(form, /<select|<textarea|<script|\bhidden[\s=>]|set:html/);
	assert.match(form, /aria-labelledby="register-form-title"/);
	assert.match(form, /<legend id="register-form-title">Datos de acceso<\/legend>/);
	assert.match(form, /aria-describedby="register-role-hint register-required-hint"/);
	assert.match(form, /id="register-role-hint">La nueva cuenta tendrá el rol de estudiante\./);
	assert.match(form, /id="register-required-hint">Todos los campos son obligatorios\./);
});

test('registration feedback keeps framework precedence, fallback, and inline success', async () => {
	const form = await source('src/pods/auth/components/RegisterForm.astro');
	for (const [result, expected] of [
		[undefined, undefined],
		[{ data: { success: true } }, undefined],
		[{ error: { message: 'Framework error' }, data: { error: 'Backend error' } }, 'Framework error'],
		[{ error: { message: '' }, data: { error: 'Backend error' } }, 'Backend error'],
	]) {
		actionResult = result;
		const value = await load('src/pods/auth/components/RegisterForm.astro',
			`${form.split('---')[1]}\nexport { result, errorMessage };`);
		assert.equal(value.result, result);
		assert.equal(value.errorMessage, expected);
	}
	assert.match(form, /\{errorMessage && \(\s*<p class="error" role="alert">\{errorMessage\}<\/p>/);
	assert.match(form, /\{result\?\.data\?\.success && \(\s*<p class="success" role="status">Usuario registrado correctamente\. Su sesión permanece activa\.<\/p>/);
});

test('registration page redirects only when the action requests it, using HTTP 303', async () => {
	const page = await source('src/pages/auth/register.astro');
	const frontmatter = page.split('---')[1].replace(/^import .*\.astro';\r?$/gm, '');
	const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
	const body = frontmatter.replace(/^import .*;\r?$/gm, '').replace('export const prerender', 'const prerender');
	sandbox.Astro.redirect = (location, status) => ({ location, status });
	const { render } = await load('src/pages/auth/register.astro',
		`${imports.join('\n')}\nexport function render() { ${body}\nreturn { prerender }; }`);
	for (const result of [undefined, { data: { success: true } }, { data: { error: 'Forbidden' } }]) {
		actionResult = result;
		assert.equal(render().prerender, false);
	}
	actionResult = { data: { redirectTo: '/auth/login?returnTo=%2Fauth%2Fregister' } };
	assert.equal(render().location, actionResult.data.redirectTo);
	assert.equal(render().status, 303);
	assert.match(page, /<main aria-labelledby="register-title">/);
	assert.match(page, /<h1 id="register-title">Registrar usuario<\/h1>/);
	assert.match(page, /<RegisterForm\s*\/>/);
});

test('registration folder styles reserve tab space, align the left border, and keep responsive focus rules', async () => {
	const form = await source('src/pods/auth/components/RegisterForm.astro');
	const styles = form.match(/<style>([\s\S]*?)<\/style>/)[1];
	const panel = styles.match(/\bform\s*\{([^}]+)\}/)[1];
	const tab = styles.match(/form::before\s*\{([^}]+)\}/)[1];
	assert.match(panel, /position: relative/);
	assert.match(panel, /margin-block-start: 3rem/);
	assert.match(panel, /background: var\(--paper\)/);
	assert.match(panel, /border-radius: 0 12px 12px 12px/);
	assert.match(tab, /inset-inline-start: -1px/);
	assert.match(tab, /inset-block-start: calc\(-1\.5rem - 5px\)/);
	assert.match(tab, /width: min\(45%, 14rem\)/);
	assert.match(tab, /content: ''/);
	assert.match(tab, /pointer-events: none/);
	assert.match(styles, /input:focus-visible, button:focus-visible\s*\{[^}]*outline: 3px solid var\(--rust\)/);
	assert.match(styles, /@media \(max-width: 960px\)\s*\{\s*\.field-grid\s*\{ grid-template-columns: minmax\(0, 1fr\)/);
	assert.match(styles, /@media \(max-width: 480px\)\s*\{\s*\.form-footer button\s*\{ width: 100%/);
	assert.doesNotMatch(styles, /overflow:\s*(hidden|clip)/);
	assert.doesNotMatch(form, /<style is:global|:global\(/);
});

test('registration visual sources use normalized text without trailing whitespace or encoding artifacts', async () => {
	for (const path of ['src/pages/auth/register.astro', 'src/pods/auth/components/RegisterForm.astro', 'tests/registration.test.mjs']) {
		const content = await source(path);
		assert.equal(content, content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n');
		assert.doesNotMatch(content, /\uFFFD/);
	}
});
