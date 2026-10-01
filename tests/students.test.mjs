import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const pagePath = 'src/pages/students.astro';
const formPath = 'src/pods/student/components/StudentForm.astro';
const handlerPath = 'src/pods/student/actions/students.ts';
const form = await source(formPath);
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const admin = { exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' };

// Execute real frontmatter, handlers, and helpers with fake cookies and fetch.
// Template/CSS assertions check source wiring, not browser rendering or backend behavior.
async function evaluate(path, names = [], options = {}) {
	let token = options.token;
	let requestedAction;
	const requests = [];
	const writes = [];
	const cookies = {
		get: (name) => name === 'session' && token ? { value: token } : undefined,
		set: (...args) => { writes.push(['set', ...args]); token = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); token = undefined; },
	};
	const sandbox = vm.createContext({
		atob, Date, Response,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('Offline');
			return Response.json(options.response ?? { id: 'student-id', ...JSON.parse(init.body) }, { status: options.status ?? 201 });
		},
		Astro: {
			cookies, url: new URL('https://frontend.invalid/students'),
			redirect: (location) => ({ redirect: location }),
			getActionResult: (action) => { requestedAction = action; return options.result; },
		},
	});
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, {
			context: sandbox, identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; },
		});
		await module.link(async (specifier, parent) => {
			if (specifier === 'astro:actions' || specifier === 'astro/middleware') {
				return new vm.SourceTextModule(specifier === 'astro:actions'
					? 'export const actions = { createStudent: "student-action" };'
					: 'export const defineMiddleware = (handler) => handler;', { context: sandbox });
			}
			const url = new URL(`${specifier}.ts`, parent.identifier);
			return compile(await readFile(url, 'utf8'), url.href);
		});
		return module;
	}
	let code = await source(path);
	if (path.endsWith('.astro')) {
		const frontmatter = code.split('---')[1].replace(/^import .*\.astro';\r?$/gm, '')
			.replace('export const prerender', 'const prerender');
		const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
		code = `${imports.join('\n')}\nexport function render() {
			${frontmatter.replace(/^import .*;\r?$/gm, '')}
			return { ${names.join(', ')} }; }`;
	}
	const module = await compile(code, new URL(path, root).href);
	await module.evaluate();
	return { value: path.endsWith('.astro') ? module.namespace.render() : module.namespace, requestedAction, cookies, requests, writes };
}

test('student form retains exactly seven inputs and their original submission constraints', () => {
	const inputs = [...form.matchAll(/<input\b[^>]*\/>/g)].map(([tag]) => tag.replace(/ aria-describedby="[^"]+"/g, ''));
	assert.deepEqual(inputs, [
		'<input type="text" id="username" name="username" required autocomplete="username" pattern="[A-Za-z0-9]+" />',
		'<input type="password" id="password" name="password" required minlength={10} autocomplete="new-password" />',
		'<input type="text" id="nombres" name="nombres" required />',
		'<input type="text" id="apellidos" name="apellidos" required />',
		'<input type="text" id="codalumno" name="codalumno" required pattern="[A-Za-z0-9]+" />',
		'<input type="email" id="email" name="email" autocomplete="email" />',
		'<input type="tel" id="celular" name="celular" />',
	]);
	for (const input of inputs) assert.ok(form.includes(`<label for="${input.match(/id="([^"]+)"/)[1]}">`));
	assert.match(form, /<form method="POST" action=\{actions\.createStudent\} use:form hidden=\{result\?\.data\?\.success\}/);
	assert.equal(form.match(/<button\b/g)?.length, 2);
	assert.match(form, /<button type="submit">Crear estudiante<\/button>/);
	assert.doesNotMatch(form, /<select|<textarea|<script|set:html/);
});

test('student action registration retains the form schema and handler binding', async () => {
	const registry = await source('src/actions/index.ts');
	const block = registry.match(/createStudent: defineAction\(\{([\s\S]*?)\n\t\}\),/)[1];
	assert.equal(block.replace(/\s+/g, ' ').trim(), [
		"accept: 'form', input: z.object({",
		'username: z.string().min(1), password: z.string().min(10),',
		'nombres: z.string().min(1), apellidos: z.string().min(1), codalumno: z.string().min(1),',
		'email: z.string().optional(), celular: z.string().optional(), }), handler: handleCreateStudent,',
	].join(' '));
});

test('student frontmatter requests the existing action and preserves its results unchanged', async () => {
	for (const result of [undefined, { error: { message: 'Validation error' } }, { data: { success: false, error: 'Conflict' } }, { data: { success: true } }]) {
		const evaluated = await evaluate(formPath, ['result'], { result });
		assert.equal(evaluated.requestedAction, 'student-action');
		assert.equal(evaluated.value.result, result);
		assert.equal(evaluated.requests.length, 0);
	}
});

test('student middleware, page, and navigation retain the session and admin gates', async () => {
	for (const token of [undefined, 'invalid', jwt(null), jwt({ ...admin, exp: 1 }), jwt(admin)]) {
		const { value, cookies } = await evaluate('src/middleware.ts', [], { token });
		const result = await value.onRequest({
			url: new URL('https://frontend.invalid/students'), cookies, redirect: (location) => location,
		}, () => 'next');
		assert.equal(result, token === jwt(admin) ? 'next' : '/auth/login?returnTo=%2Fstudents');
	}
	for (const token of [undefined, 'invalid', jwt(null), jwt({ ...admin, role: 'estudiante' }), jwt(admin)]) {
		const { value } = await evaluate(pagePath, ['prerender'], { token });
		if (token === jwt(admin)) assert.equal(value.prerender, false);
		else assert.equal(value.redirect, '/auth/login');
	}
	for (const role of ['admin', 'estudiante']) {
		const { value } = await evaluate('src/layouts/Layout.astro', ['isAdmin', 'isLoggedIn', 'pageTitle'], { token: jwt({ ...admin, role }) });
		assert.equal(value.isAdmin, role === 'admin');
		assert.equal(value.isLoggedIn, true);
		assert.equal(value.pageTitle, 'Estudiantes');
	}
	assert.match(await source('src/layouts/Layout.astro'), /\{isAdmin && <a href="\/students"/);
});

const input = { username: 'STUDENT1', password: 'Password123', nombres: 'Ana', apellidos: 'Pérez', codalumno: 'A123' };

test('real student handler preserves POST payload, optional omission, bearer, session, and success identity', async () => {
	for (const contact of [{}, { email: '', celular: '' }, { email: 'student@example.invalid', celular: '123456789' }]) {
		const { value, cookies, requests, writes } = await evaluate(handlerPath, [], { token: 'operator-token' });
		const submitted = { ...input, ...contact };
		const result = await value.handleCreateStudent(submitted, { cookies });
		assert.equal(result.success, true);
		assert.deepEqual(JSON.parse(JSON.stringify(result.student)), { id: 'student-id', nombres: 'Ana', apellidos: 'Pérez', codalumno: 'A123' });
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, 'https://backend.invalid/students');
		assert.equal(requests[0].method, 'POST');
		assert.equal(requests[0].headers.Authorization, 'Bearer operator-token');
		assert.equal(requests[0].headers['Content-Type'], 'application/json');
		assert.deepEqual(JSON.parse(requests[0].body), { ...input, ...(contact.email ? contact : {}) });
		assert.deepEqual(submitted, { ...input, ...contact });
		assert.equal(cookies.get('session').value, 'operator-token');
		assert.deepEqual(writes, []);
	}
});

test('inherited handler failures remain data errors, not framework alerts, without changing session behavior', async () => {
	const alert = form.match(/\{([^{}\n]+) && \(\s*<p class="error" role="alert">\{([^{}]+)\}<\/p>\s*\)}/);
	assert.ok(alert);
	for (const [status, code, expected] of [
		[400, 'BAD_REQUEST', 'Backend message'], [409, 'CONFLICT', 'Backend message'],
		[403, 'FORBIDDEN', 'Backend message'], [401, 'UNAUTHORIZED', 'HTTP 401'],
		[500, 'INTERNAL_ERROR', 'HTTP 500'], [undefined, undefined, 'Service unavailable'],
	]) {
		const { value, cookies, writes } = await evaluate(handlerPath, [], {
			token: 'operator-token', status, response: { error: { code, message: 'Backend message' } }, networkError: !status,
		});
		const result = await value.handleCreateStudent(input, { cookies });
		assert.equal(result.success, false);
		assert.equal(result.error, expected);
		const feedback = await evaluate(formPath, [`visible: Boolean(${alert[1]})`], { result: { data: result } });
		assert.equal(feedback.value.visible, false, 'Characterize the inherited data-error display gap; this delta does not fix it');
		assert.equal(cookies.get('session')?.value, status === 401 ? undefined : 'operator-token');
		assert.equal(writes.length, status === 401 ? 1 : 0);
	}
	const { value } = await evaluate(formPath, [`visible: Boolean(${alert[1]})`, `message: (${alert[2]})`], {
		result: { error: { message: 'Framework validation error' } },
	});
	assert.equal(value.visible, true);
	assert.equal(value.message, 'Framework validation error');
});

test('student success identity, conditional visibility, and create-another handler stay wired', async () => {
	const condition = form.match(/\{([^{}\n]+) \? \(\s*<div class="success">/)[1];
	const hidden = form.match(/<form[^>]*hidden=\{([^}]+)\}/)[1];
	const identity = [...form.matchAll(/\{(result\.data\.student\.[a-z]+)\}/g)].map(([, expression]) => expression);
	assert.deepEqual(identity, ['result.data.student.nombres', 'result.data.student.apellidos', 'result.data.student.codalumno']);
	for (const result of [undefined, { data: { success: false } }, { data: { success: true, student: { nombres: 'Ana', apellidos: 'Pérez', codalumno: 'A123' } } }]) {
		const { value } = await evaluate(formPath, [`success: Boolean(${condition})`, `hidden: Boolean(${hidden})`, `identity: (${condition}) ? [${identity.join(', ')}] : []`], { result });
		assert.equal(value.success, result?.data?.success === true);
		assert.equal(value.hidden, value.success);
		assert.deepEqual(Array.from(value.identity), value.success ? ['Ana', 'Pérez', 'A123'] : []);
	}
	assert.match(form, /<p role="status">Estudiante creado:/);
	assert.match(form, /<\/div>\s*\) : null}\s*<form/);
	assert.match(form, /\[hidden\]\s*\{\s*display:\s*none;/);
	const visibility = new Set(['form']);
	const panel = {
		nextElementSibling: { removeAttribute: (name) => { assert.equal(name, 'hidden'); visibility.delete('form'); } },
		setAttribute: (name, value) => { assert.equal(name, 'hidden'); assert.equal(value, ''); visibility.add('success'); },
	};
	const button = { closest: (selector) => { assert.equal(selector, '.success'); return panel; } };
	vm.runInNewContext(`(function () { ${form.match(/onclick="([^"]+)"/)[1]} }).call(button)`, { button });
	assert.deepEqual([...visibility], ['success']);
});

test('student headings, fieldsets, and associated hints describe the existing account and profile fields', async () => {
	const page = await source(pagePath);
	assert.match(page, /<main aria-labelledby="student-title">/);
	assert.match(page, /<h1 id="student-title">Registrar estudiante<\/h1>/);
	assert.match(page, /<StudentForm\s*\/>/);
	assert.equal(form.match(/<fieldset\b/g)?.length, 2);
	assert.match(form, /<legend>Cuenta de acceso<\/legend>/);
	assert.match(form, /<legend>Datos del estudiante<\/legend>/);
	assert.match(form, /id="student-required-hint">Todos los campos son obligatorios, excepto email y celular\./);
	for (const [, references] of form.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
		for (const id of references.split(' ')) assert.equal(form.match(new RegExp(`id="${id}"`, 'g'))?.length, 1);
	}
	for (const name of ['username', 'password', 'codalumno']) {
		assert.match(form, new RegExp(`<input[^>]*name="${name}"[^>]*aria-describedby="${name}-hint"`));
	}
});

test('student scoped styles retain the approved flush-left folder, focus, and responsive rules', () => {
	const styles = form.match(/<style>([\s\S]*?)<\/style>/)[1];
	const panel = styles.match(/\bform\s*\{([^}]+)\}/)[1];
	const tab = styles.match(/form::before\s*\{([^}]+)\}/)[1];
	for (const rule of ['position: relative', 'margin-block-start: 3rem', 'background: var(--paper)', 'border-top: 5px solid var(--sage)', 'border-radius: 0 12px 12px 12px']) assert.ok(panel.includes(rule));
	for (const rule of ["content: ''", 'inset-inline-start: -1px', 'inset-block-start: calc(-1.5rem - 5px)', 'width: min(45%, 14rem)', 'background: var(--sage)', 'pointer-events: none']) assert.ok(tab.includes(rule));
	assert.match(styles, /input:focus-visible, button:focus-visible\s*\{[^}]*outline: 3px solid var\(--rust\)/);
	assert.match(styles, /button\s*\{[^}]*background: var\(--rust\)/);
	assert.match(styles, /@media \(max-width: 960px\)\s*\{\s*\.field-grid\s*\{ grid-template-columns: minmax\(0, 1fr\)/);
	assert.match(styles, /@media \(max-width: 480px\)\s*\{\s*\.form-footer button\s*\{ width: 100%/);
	assert.doesNotMatch(styles, /overflow:\s*(hidden|clip)/);
	assert.doesNotMatch(form, /<style is:global|:global\(/);
});

test('student delta sources use normalized text without trailing whitespace or encoding artifacts', async () => {
	for (const path of [pagePath, formPath, 'tests/students.test.mjs']) {
		const content = await source(path);
		assert.equal(content, content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n');
		assert.doesNotMatch(content, /\uFFFD/);
	}
});

test('student page and folder geometry match the approved registration and patient references', async () => {
	const styles = (content) => content.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
	const rule = (content, selector) => {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const block = styles(content).match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`));
		assert.ok(block, `Missing style rule: ${selector}`);
		return block[1].trim().replace(/\s+/g, ' ');
	};
	assert.equal(styles(await source(pagePath)), styles(await source('src/pages/auth/register.astro')));
	for (const path of ['src/pods/auth/components/RegisterForm.astro', 'src/pods/paciente/components/form-paciente.astro']) {
		const reference = await source(path);
		for (const selector of ['form', 'form::before', '.field-grid', '.field', '.form-footer', 'button', 'input:focus-visible, button:focus-visible']) {
			assert.equal(rule(form, selector), rule(reference, selector), `${path}: ${selector}`);
		}
	}
	assert.match(rule(form, '.form-section > legend'), /font: 1\.5rem\/1\.3 var\(--serif\)/);
	assert.match(rule(form, '.error, .success'), /font-size: 0\.875rem/);
	assert.equal(rule(form, '.success'), rule(await source('src/pods/auth/components/RegisterForm.astro'), '.success'));
});

test('student fieldsets keep account credentials separate from profile fields', () => {
	const sections = [...form.matchAll(/<fieldset\b[^>]*>([\s\S]*?)<\/fieldset>/g)];
	assert.deepEqual(sections.map(([, section]) => ({
		legend: section.match(/<legend>([^<]+)<\/legend>/)[1],
		fields: [...section.matchAll(/<input\b[^>]*name="([^"]+)"/g)].map(([, name]) => name),
	})), [
		{ legend: 'Cuenta de acceso', fields: ['username', 'password'] },
		{ legend: 'Datos del estudiante', fields: ['nombres', 'apellidos', 'codalumno', 'email', 'celular'] },
	]);
});

test('encoded student forms preserve the combined account and profile POST contract', async () => {
	for (const multipart of [false, true]) {
		for (const contact of [{ email: '', celular: '' }, { email: 'student@example.invalid', celular: '+51 123456789' }]) {
			const submitted = { ...input, ...contact };
			const body = multipart ? new FormData() : new URLSearchParams();
			for (const [name, value] of Object.entries(submitted)) body.set(name, value);
			const post = new Request('https://frontend.invalid/students?_action=createStudent', { method: 'POST', body });
			const decoded = Object.fromEntries(await post.formData());
			assert.deepEqual(decoded, submitted);
			const { value, cookies, requests, writes } = await evaluate(handlerPath, [], { token: 'operator-token' });
			const result = await value.handleCreateStudent(decoded, { cookies });
			assert.equal(result.success, true);
			assert.equal(requests.length, 1);
			assert.equal(requests[0].url, 'https://backend.invalid/students');
			assert.equal(requests[0].method, 'POST');
			assert.equal(requests[0].headers.Authorization, 'Bearer operator-token');
			assert.deepEqual(JSON.parse(requests[0].body), { ...input, ...(contact.email ? contact : {}) });
			assert.equal(cookies.get('session').value, 'operator-token');
			assert.deepEqual(writes, []);
		}
	}
});
