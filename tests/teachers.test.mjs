import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const pagePath = 'src/pages/teachers.astro';
const formPath = 'src/pods/teacher/components/TeacherForm.astro';
const handlerPath = 'src/pods/teacher/actions/teachers.ts';
const form = await source(formPath);
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const admin = { exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' };

// File-local harness: real frontmatter, handlers, and helpers; fake cookies and fetch.
// Template/CSS checks inspect wiring, not browser rendering or Astro HTTP integration.
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
			return Response.json(options.response ?? { id: 'teacher-id', ...JSON.parse(init.body) }, { status: options.status ?? 201 });
		},
		Astro: {
			cookies, url: new URL('https://frontend.invalid/teachers'),
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
					? 'export const actions = { createTeacher: "teacher-action" };'
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

test('teacher form preserves exactly six inputs, original constraints, and account/profile grouping', () => {
	const inputs = [...form.matchAll(/<input\b[^>]*\/>/g)].map(([tag]) => tag.replace(/ aria-describedby="[^"]+"/g, ''));
	assert.deepEqual(inputs, [
		'<input type="text" id="username" name="username" required autocomplete="username" pattern="[A-Za-z0-9]+" />',
		'<input type="password" id="password" name="password" required minlength={10} autocomplete="new-password" />',
		'<input type="text" id="nombres" name="nombres" required />',
		'<input type="text" id="apellidos" name="apellidos" required />',
		'<input type="email" id="email" name="email" autocomplete="email" />',
		'<input type="tel" id="celular" name="celular" />',
	]);
	const sections = [...form.matchAll(/<fieldset\b[^>]*>([\s\S]*?)<\/fieldset>/g)];
	assert.deepEqual(sections.map(([, section]) => ({
		legend: section.match(/<legend>([^<]+)<\/legend>/)[1],
		fields: [...section.matchAll(/<input\b[^>]*name="([^"]+)"/g)].map(([, name]) => name),
	})), [
		{ legend: 'Cuenta de acceso', fields: ['username', 'password'] },
		{ legend: 'Datos del profesor', fields: ['nombres', 'apellidos', 'email', 'celular'] },
	]);
	assert.match(form, /<form method="POST" action=\{actions\.createTeacher\} use:form hidden=\{result\?\.data\?\.success\}/);
	assert.equal(form.match(/<button\b/g)?.length, 2);
	assert.match(form, /<button type="submit">Crear profesor<\/button>/);
	assert.doesNotMatch(form, /codalumno|<select|<textarea|<script|set:html/);
});

test('teacher action registration retains its form schema and handler binding', async () => {
	const registry = await source('src/actions/index.ts');
	const block = registry.match(/createTeacher: defineAction\(\{([\s\S]*?)\n\t\}\),/)[1];
	assert.equal(block.replace(/\s+/g, ' ').trim(), [
		"accept: 'form', input: z.object({",
		'username: z.string().min(1), password: z.string().min(10),',
		'nombres: z.string().min(1), apellidos: z.string().min(1),',
		'email: z.string().optional(), celular: z.string().optional(), }), handler: handleCreateTeacher,',
	].join(' '));
});

test('teacher frontmatter requests the existing action and preserves results unchanged', async () => {
	for (const result of [undefined, { error: { message: 'Validation error' } }, { data: { success: false, error: 'Conflict' } }, { data: { success: true } }]) {
		const evaluated = await evaluate(formPath, ['result'], { result });
		assert.equal(evaluated.requestedAction, 'teacher-action');
		assert.equal(evaluated.value.result, result);
		assert.deepEqual(evaluated.requests, []);
	}
});

test('teacher middleware and page retain session expiry and admin gates without cookie writes', async () => {
	for (const token of [undefined, 'invalid', jwt(null), jwt({ ...admin, exp: 1 }), jwt(admin)]) {
		const { value, cookies, writes } = await evaluate('src/middleware.ts', [], { token });
		const result = await value.onRequest({
			url: new URL('https://frontend.invalid/teachers'), cookies, redirect: (location) => location,
		}, () => 'next');
		assert.equal(result, token === jwt(admin) ? 'next' : '/auth/login?returnTo=%2Fteachers');
		assert.deepEqual(writes, []);
	}
	for (const token of [undefined, 'invalid', jwt(null), jwt({ ...admin, role: 'profesor' }), jwt({ ...admin, role: 'estudiante' }), jwt(admin)]) {
		const { value, writes } = await evaluate(pagePath, ['prerender'], { token });
		if (token === jwt(admin)) assert.equal(value.prerender, false);
		else assert.equal(value.redirect, '/auth/login');
		assert.deepEqual(writes, []);
	}
});

const input = { username: 'TEACHER1', password: 'Password123', nombres: 'Ana', apellidos: 'Pérez' };

test('teacher POST preserves payload, independently optional contacts, bearer, identity, and session', async () => {
	for (const contact of [{}, { email: '', celular: '' }, { email: 'teacher@example.invalid' }, { celular: '+51 123456789' }, { email: 'teacher@example.invalid', celular: '123456789' }]) {
		const { value, cookies, requests, writes } = await evaluate(handlerPath, [], { token: 'operator-token' });
		const submitted = { ...input, ...contact };
		const result = await value.handleCreateTeacher(submitted, { cookies });
		assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, teacher: { id: 'teacher-id', nombres: 'Ana', apellidos: 'Pérez' } });
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, 'https://backend.invalid/teachers');
		assert.equal(requests[0].method, 'POST');
		assert.equal(requests[0].headers.Authorization, 'Bearer operator-token');
		assert.equal(requests[0].headers['Content-Type'], 'application/json');
		assert.deepEqual(JSON.parse(requests[0].body), { ...input, ...Object.fromEntries(Object.entries(contact).filter(([, value]) => value)) });
		assert.deepEqual(submitted, { ...input, ...contact });
		assert.equal(cookies.get('session').value, 'operator-token');
		assert.deepEqual(writes, []);
	}
});

test('teacher business errors retain the inherited data-error display gap and 401 session clearing', async () => {
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
		const result = await value.handleCreateTeacher(input, { cookies });
		assert.equal(result.success, false);
		assert.equal(result.error, expected);
		const feedback = await evaluate(formPath, [`visible: Boolean(${alert[1]})`], { result: { data: result } });
		assert.equal(feedback.value.visible, false, 'Existing business-error display gap is not fixed by this visual delta');
		assert.equal(cookies.get('session')?.value, status === 401 ? undefined : 'operator-token');
		assert.equal(writes.length, status === 401 ? 1 : 0);
	}
	const { value } = await evaluate(formPath, [`visible: Boolean(${alert[1]})`, `message: (${alert[2]})`], {
		result: { error: { message: 'Framework validation error' } },
	});
	assert.equal(value.visible, true);
	assert.equal(value.message, 'Framework validation error');
});

test('teacher success identity and create-another preserve sibling visibility without reset or navigation', async () => {
	const condition = form.match(/\{([^{}\n]+) \? \(\s*<div class="success">/)[1];
	const hidden = form.match(/<form[^>]*hidden=\{([^}]+)\}/)[1];
	const identity = [...form.matchAll(/\{(result\.data\.teacher\.[a-z]+)\}/g)].map(([, expression]) => expression);
	assert.deepEqual(identity, ['result.data.teacher.nombres', 'result.data.teacher.apellidos']);
	for (const result of [undefined, { data: { success: false } }, { data: { success: true, teacher: input } }]) {
		const { value } = await evaluate(formPath, [`success: Boolean(${condition})`, `hidden: Boolean(${hidden})`, `identity: (${condition}) ? [${identity.join(', ')}] : []`], { result });
		assert.equal(value.success, result?.data?.success === true);
		assert.equal(value.hidden, value.success);
		assert.deepEqual(Array.from(value.identity), value.success ? ['Ana', 'Pérez'] : []);
	}
	assert.match(form, /<p role="status">Profesor creado:/);
	assert.match(form, /<\/div>\s*\) : null}\s*<form/);
	assert.match(form, /\[hidden\]\s*\{\s*display:\s*none;/);
	const events = [];
	const panel = {
		nextElementSibling: { removeAttribute: (name) => events.push(['form', name]) },
		setAttribute: (name, value) => events.push(['success', name, value]),
	};
	const button = { closest: (selector) => { assert.equal(selector, '.success'); return panel; } };
	vm.runInNewContext(`(function () { ${form.match(/onclick="([^"]+)"/)[1]} }).call(button)`, { button });
	assert.deepEqual(events, [['form', 'hidden'], ['success', 'hidden', '']]);
});

test('teacher labels, headings, hints, and scoped presentation match the approved student folder', async () => {
	const page = await source(pagePath);
	assert.match(page, /<main aria-labelledby="teacher-title">/);
	assert.match(page, /<h1 id="teacher-title">Registrar profesor<\/h1>/);
	assert.match(page, /<TeacherForm\s*\/>/);
	assert.match(form, /id="teacher-required-hint">Todos los campos son obligatorios, excepto email y celular\./);
	for (const [, id] of form.matchAll(/<input\b[^>]*id="([^"]+)"/g)) assert.ok(form.includes(`<label for="${id}">`));
	for (const [, references] of form.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
		for (const id of references.split(' ')) assert.equal(form.match(new RegExp(`id="${id}"`, 'g'))?.length, 1);
	}
	for (const name of ['username', 'password']) assert.match(form, new RegExp(`<input[^>]*name="${name}"[^>]*aria-describedby="${name}-hint"`));
	const styles = (content) => content.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
	const reference = styles(await source('src/pods/student/components/StudentForm.astro'))
		.replace(/^\s*\.full-width[^\n]*\n/m, '');
	assert.equal(styles(page), styles(await source('src/pages/students.astro')));
	assert.equal(styles(form), reference, 'Retain all approved folder, focus, feedback, and responsive rules without the unused student-only full-width rule');
	assert.doesNotMatch(form, /<style is:global|:global\(|overflow:\s*(hidden|clip)/);
});

test('teacher delta files use normalized text without trailing whitespace or encoding artifacts', async () => {
	for (const path of [pagePath, formPath, 'tests/teachers.test.mjs']) {
		const content = await source(path);
		assert.equal(content, content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n');
		assert.doesNotMatch(content, /\uFFFD/);
	}
});
