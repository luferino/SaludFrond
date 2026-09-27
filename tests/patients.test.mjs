import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const pagePath = 'src/pages/patients.astro';
const formPath = 'src/pods/paciente/components/form-paciente.astro';
const form = await source(formPath);
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

// Execute real frontmatter and middleware with isolated cookies, never a backend or browser.
async function evaluate(path, names, token, actionResult, options = {}) {
	let requestedAction;
	const requests = [];
	const cookies = { get: (name) => name === 'session' && token ? { value: token } : undefined };
	const sandbox = vm.createContext({
		atob, Date: options.Date ?? Date, Response,
		document: options.document,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			return Response.json({ id: 'patient-id', ...JSON.parse(init.body) }, { status: 201 });
		},
		Astro: {
			cookies,
			redirect: (location) => ({ redirect: location }),
			getActionResult: (action) => { requestedAction = action; return actionResult; },
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
					? 'export const actions = { createPatient: "patient-action" };'
					: 'export const defineMiddleware = (handler) => handler;', { context: sandbox });
			}
			const url = new URL(`${specifier}.ts`, parent.identifier);
			return compile(await readFile(url, 'utf8'), url.href);
		});
		return module;
	}
	const content = await source(path);
	let code = content;
	if (options.script) {
		code = content.match(/<script>([\s\S]*?)<\/script>/)[1];
	} else if (path.endsWith('.astro')) {
		const frontmatter = content.split('---')[1]
			.replace(/^import .*\.astro';\r?$/gm, '')
			.replace('export const prerender', 'const prerender');
		const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
		code = `${imports.join('\n')}\nexport function render() {
			${frontmatter.replace(/^import .*;\r?$/gm, '')}
			return { ${names.join(', ')} }; }`;
	}
	const module = await compile(code, new URL(path, root).href);
	await module.evaluate();
	return { value: path.endsWith('.astro') && !options.script ? module.namespace.render() : module.namespace, requestedAction, cookies, requests };
}

test('patient form retains exactly eight required fields, types, constraints, and radio values', () => {
	const inputs = [...form.matchAll(/<input\b[^>]*\/>/g)].map(([tag]) => tag);
	const fields = {
		documento: 'text', nombres: 'text', apellidos: 'text', fecha_nacimiento: 'text',
		email: 'email', celular: 'tel', sexo: 'radio', direccion: 'text',
	};
	assert.deepEqual([...new Set(inputs.map((tag) => tag.match(/name="([^"]+)"/)[1]))].sort(), Object.keys(fields).sort());
	assert.equal(inputs.length, 9);
	for (const [name, type] of Object.entries(fields)) {
		for (const tag of inputs.filter((input) => input.includes(`name="${name}"`))) {
			assert.ok(tag.includes(`type="${type}"`));
			assert.match(tag, /\srequired(?:\s|\/)/);
			const id = tag.match(/id="([^"]+)"/)[1];
			assert.ok(form.includes(`for="${id}"`));
		}
	}
	assert.ok(inputs.find((tag) => tag.includes('name="documento"')).includes('pattern="[0-9]{4,8}"'));
	const birthDate = inputs.find((tag) => tag.includes('name="fecha_nacimiento"'));
	assert.match(birthDate, /data-max=\{today\}/);
	assert.match(birthDate, /placeholder="dd\/mm\/yyyy"/);
	assert.match(birthDate, /aria-describedby="fecha-nacimiento-hint"/);
	assert.match(form, /id="fecha-nacimiento-hint"/);
	const datePattern = new RegExp(`^(?:${birthDate.match(/pattern="([^"]+)"/)[1]})$`, 'v');
	assert.equal(datePattern.test('31/12/2000'), true);
	assert.equal(datePattern.test('2000-12-31'), false);
	assert.match(inputs.find((tag) => tag.includes('name="email"')), /autocomplete="email"/);
	assert.deepEqual(inputs.filter((tag) => tag.includes('name="sexo"')).map((tag) => tag.match(/value="([^"]+)"/)[1]), ['M', 'F']);
	assert.match(form, /aria-describedby="documento-hint"/);
	assert.match(form, /id="documento-hint"/);
	assert.match(form, /<fieldset[^>]*>\s*<legend>Sexo<\/legend>/);
});

test('patient action lookup preserves results and UTC date maximum with the existing POST binding', async () => {
	for (const result of [undefined, { error: { message: 'Validation error' } }, { data: { success: true } }]) {
		const before = new Date().toISOString().split('T')[0];
		const { value, requestedAction } = await evaluate(formPath, ['result', 'today'], undefined, result);
		assert.equal(requestedAction, 'patient-action');
		assert.equal(value.result, result);
		assert.ok([before, new Date().toISOString().split('T')[0]].includes(value.today));
	}
	assert.match(form, /<form\b[^>]*method="POST"[^>]*action=\{actions\.createPatient\}[^>]*use:form[^>]*hidden=\{result\?\.data\?\.success\}/);
});

test('patient middleware and page preserve session and admin gates', async () => {
	const valid = { exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' };
	for (const token of [undefined, 'invalid', jwt({ ...valid, exp: 1 }), jwt(valid)]) {
		const { value, cookies } = await evaluate('src/middleware.ts', [], token);
		const result = await value.onRequest({
			url: new URL('https://frontend.invalid/patients'), cookies,
			redirect: (location) => location,
		}, () => 'next');
		assert.equal(result, token === jwt(valid) ? 'next' : '/auth/login?returnTo=%2Fpatients');
	}
	for (const token of [undefined, 'invalid', jwt(null), jwt({ ...valid, role: 'estudiante' }), jwt(valid)]) {
		const { value } = await evaluate(pagePath, ['prerender'], token);
		if (token === jwt(valid)) assert.equal(value.prerender, false);
		else assert.equal(value.redirect, '/auth/login');
	}
});

const errorAlert = form.match(/\{([^{}\n]+) && \(\s*<p class="error" role="alert">\{([^{}]+)\}<\/p>\s*\)}/);

for (const { name, result, expected } of [
	{ name: 'duplicate patient', result: { data: { success: false, error: 'El documento ya está registrado.' } }, expected: 'El documento ya está registrado.' },
	{ name: 'backend validation', result: { data: { success: false, error: 'La fecha de nacimiento no es válida.' } }, expected: 'La fecha de nacimiento no es válida.' },
	{ name: 'generic failure', result: { data: { success: false, error: 'Service unavailable' } }, expected: 'Service unavailable' },
	{ name: 'HTTP failure', result: { data: { success: false, error: 'HTTP 500' } }, expected: 'HTTP 500' },
	{ name: 'framework failure', result: { error: { message: 'Validation error' } }, expected: 'Validation error' },
	{ name: 'framework error takes precedence', result: { error: { message: 'Framework error' }, data: { success: false, error: 'Business error' } }, expected: 'Framework error' },
	{ name: 'empty framework message falls back', result: { error: { message: '' }, data: { success: false, error: 'Business error' } }, expected: 'Business error' },
	{ name: 'success has no alert', result: { data: { success: true, patient: { nombres: 'Ana', apellidos: 'Pérez', documento: '12345678' } } }, expected: undefined },
	{ name: 'no result has no alert', result: undefined, expected: undefined },
]) {
	test(`patient error feedback: ${name}`, async () => {
		assert.ok(errorAlert, 'The alert must use a conditional escaped text expression');
		// Evaluate the actual frontmatter and template expressions, not a copy of the error logic.
		const [, condition, message] = errorAlert;
		const { value } = await evaluate(formPath, [
			`visible: Boolean(${condition})`,
			`message: (${condition}) ? (${message}) : undefined`,
		], undefined, result);
		assert.equal(value.message, expected);
		assert.equal(value.visible, expected !== undefined);
	});
}

test('feedback keeps action messages, success identity, and register-another visibility behavior', () => {
	assert.match(form, /result\?\.data\?\.success \? \(/);
	assert.ok(errorAlert);
	assert.doesNotMatch(form, /set:html/);
	assert.match(form, /role="status"/);
	for (const field of ['nombres', 'apellidos', 'documento']) assert.ok(form.includes(`{result.data.patient.${field}}`));
	assert.match(form, /<\/div>\s*\) : null}\s*<form/);
	assert.match(form, /\[hidden\]\s*\{\s*display:\s*none;/);
	const hidden = new Set(['form']);
	const panel = {
		nextElementSibling: { removeAttribute: (name) => { assert.equal(name, 'hidden'); hidden.delete('form'); } },
		setAttribute: (name) => { assert.equal(name, 'hidden'); hidden.add('success'); },
	};
	const button = { closest: (selector) => { assert.equal(selector, '.success'); return panel; } };
	vm.runInNewContext(`(function () { ${form.match(/onclick="([^"]+)"/)[1]} }).call(button)`, { button });
	assert.deepEqual([...hidden], ['success']);
});

test('changed sources use normalized text without trailing whitespace or encoding artifacts', async () => {
	for (const path of [pagePath, formPath, 'src/pods/paciente/birth-date.ts', 'src/pods/paciente/actions/patients.ts', 'tests/patients.test.mjs']) {
		const content = await source(path);
		assert.equal(content, content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n');
		assert.doesNotMatch(content, /\uFFFD/);
	}
});

const maximum = '2026-09-26';
class FixedDate extends Date {
	constructor(...args) { super(...(args.length ? args : [`${maximum}T12:00:00Z`])); }
}
const validDates = [
	['09/08/2000', '2000-08-09'], ['31/01/1990', '1990-01-31'],
	['29/02/2000', '2000-02-29'], ['29/02/2024', '2024-02-29'],
	['01/01/0001', '0001-01-01'], ['26/09/2026', maximum],
];
const invalidDates = [
	'', '1/2/2000', '2000-02-01', '12/31/2000', '31/04/2000', '31/06/2000',
	'29/02/1900', '29/02/2025', '30/02/2000', '00/01/2000', '01/00/2000',
	'01/13/2000', '01/01/0000', '27/09/2026', '01/01/9999',
	' 01/01/2000', '01/01/2000 ', '01/01/2000\n', 'aa/bb/cccc',
];

test('birth date parser uses day/month order, Gregorian leap years, and the inclusive UTC maximum', async () => {
	const { value: { parseBirthDate } } = await evaluate('src/pods/paciente/birth-date.ts', []);
	for (const [display, iso] of validDates) assert.equal(parseBirthDate(display, maximum), iso, display);
	for (const display of invalidDates) assert.equal(parseBirthDate(display, maximum), null, display);
});

const patientInput = {
	documento: '12345678', nombres: 'Ana', apellidos: 'Pérez', fecha_nacimiento: '09/08/2000',
	email: 'patient@example.invalid', celular: '123456789', sexo: 'F', direccion: 'Calle 123',
};

test('normal POST bodies work without client JavaScript and the real handler sends only ISO dates', async () => {
	const { value, cookies, requests } = await evaluate('src/pods/paciente/actions/patients.ts', [], 'operator-token', undefined, { Date: FixedDate });
	for (const multipart of [false, true]) {
		for (const [display, iso] of validDates) {
			const input = { ...patientInput, fecha_nacimiento: display };
			const body = multipart ? new FormData() : new URLSearchParams();
			for (const [name, field] of Object.entries(input)) body.set(name, field);
			const post = new Request('https://frontend.invalid/patients?_action=createPatient', { method: 'POST', body });
			const submitted = Object.fromEntries(await post.formData());
			const result = await value.handleCreatePatient(submitted, { cookies });
			assert.equal(result.success, true);
			assert.equal(submitted.fecha_nacimiento, display, 'Do not mutate the submitted display value');
			const request = requests.at(-1);
			assert.equal(request.url, 'https://backend.invalid/patients');
			assert.equal(request.method, 'POST');
			assert.equal(request.headers.Authorization, 'Bearer operator-token');
			assert.deepEqual(JSON.parse(request.body), { ...input, fecha_nacimiento: iso });
		}
	}
	assert.equal(requests.length, validDates.length * 2);
});

test('invalid and future dates are rejected by the real handler before any backend request', async () => {
	const { value, cookies, requests } = await evaluate('src/pods/paciente/actions/patients.ts', [], undefined, undefined, { Date: FixedDate });
	for (const display of invalidDates) {
		const result = await value.handleCreatePatient({ ...patientInput, fecha_nacimiento: display }, { cookies });
		assert.equal(result.success, false, display);
		assert.match(result.error, /dd\/mm\/yyyy/);
		const feedback = await evaluate(formPath, ['errorMessage'], undefined, { data: result });
		assert.equal(feedback.value.errorMessage, result.error);
	}
	assert.equal(requests.length, 0);
});

test('actual component script validates edits and clears errors without rewriting the visible date', async () => {
	const listeners = new Map();
	const input = {
		value: '31/04/2000', dataset: { max: maximum }, validationMessage: '',
		setCustomValidity(message) { this.validationMessage = message; },
		addEventListener(event, callback) { listeners.set(event, callback); },
	};
	const document = { querySelector: (selector) => { assert.equal(selector, '#fecha_nacimiento'); return input; } };
	await evaluate(formPath, [], undefined, undefined, { script: true, document });
	assert.match(input.validationMessage, /dd\/mm\/yyyy/);
	for (const event of ['input', 'change']) {
		for (const display of [...invalidDates.filter(Boolean), ...validDates.map(([date]) => date), '']) {
			input.value = display;
			listeners.get(event)();
			assert.equal(Boolean(input.validationMessage), Boolean(display) && invalidDates.includes(display), display);
			assert.equal(input.value, display);
		}
	}
	await evaluate(formPath, [], undefined, undefined, { script: true, document: { querySelector: () => null } });
});

test('folder tab reserves space and remains decorative without clipping text or focus', () => {
	const styles = form.match(/<style>([\s\S]*?)<\/style>/)[1];
	const panel = styles.match(/\bform\s*\{([^}]+)\}/)[1];
	const tab = styles.match(/form::before\s*\{([^}]+)\}/)[1];
	assert.match(panel, /position: relative/);
	assert.match(panel, /margin-block-start: 3rem/);
	assert.match(tab, /inset-block-start: calc\(-1\.5rem - 5px\)/);
	assert.match(tab, /width: min\(45%, 14rem\)/);
	assert.match(tab, /content: ''/);
	assert.match(tab, /pointer-events: none/);
	assert.doesNotMatch(styles, /overflow:\s*(hidden|clip)/);
	assert.match(styles, /:focus-visible/);
});
