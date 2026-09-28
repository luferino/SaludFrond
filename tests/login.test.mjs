import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Isolated source harness: real frontmatter, fake Astro bindings, no server or backend.
// Astro frontmatter is executed; template wiring is checked, not browser-rendered.
const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const pagePath = 'src/pages/auth/login.astro';
const formPath = 'src/pods/auth/components/LoginForm.astro';
const form = await source(formPath);

async function evaluate(path, names = [], options = {}) {
	const sandbox = vm.createContext({
		atob, Date, Response,
		Astro: {
			url: options.url ?? new URL('https://frontend.invalid/auth/login'),
			redirect: (location) => ({ location }),
			getActionResult: () => options.result,
		},
	});
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, { context: sandbox, identifier });
		await module.link(async (specifier, parent) => {
			if (specifier === 'astro:actions') {
				return new vm.SourceTextModule('export const actions = { login: "login-action" };', { context: sandbox });
			}
			const url = new URL(`${specifier}.ts`, parent.identifier);
			return compile(await readFile(url, 'utf8'), url.href);
		});
		return module;
	}
	const code = await source(path);
	const frontmatter = code.split('---')[1].replace(/^import .*\.astro';\r?$/gm, '')
		.replace('export const prerender', 'const prerender');
	const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
	const wrapped = `${imports.join('\n')}\nexport function render() {
		${frontmatter.replace(/^import .*;\r?$/gm, '')}
		return { ${names.join(', ')} }; }`;
	const module = await compile(wrapped, new URL(path, root).href);
	await module.evaluate();
	return module.namespace.render();
}

test('login form preserves exactly two required inputs, the hidden returnTo field, and the forgot-password link', () => {
	const inputs = [...form.matchAll(/<input\b[^>]*\/>/g)].map(([tag]) => tag);
	assert.deepEqual(inputs, [
		'<input type="hidden" name="returnTo" value={returnTo} />',
		'<input type="text" id="username" name="username" required autocomplete="username" />',
		'<input type="password" id="password" name="password" required autocomplete="current-password" />',
	]);
	assert.match(form, /<form method="POST" action=\{actions\.login\} use:form/);
	assert.equal(form.match(/<button\b/g)?.length, 1);
	assert.match(form, /<button type="submit">Iniciar Sesión<\/button>/);
	assert.match(form, /<a href="\/auth\/forgot-password" class="forgot-link">¿Olvidaste tu contraseña\?<\/a>/);
	assert.doesNotMatch(form, /<select|<textarea|<script|set:html/);
});

test('login returnTo defaults to root and echoes the query string otherwise', async () => {
	for (const [search, expected] of [['', '/'], ['?returnTo=%2Fstudents', '/students']]) {
		const { returnTo } = await evaluate(formPath, ['returnTo'], {
			url: new URL(`https://frontend.invalid/auth/login${search}`),
		});
		assert.equal(returnTo, expected);
	}
});

test('login error paragraph renders only the framework message, keyed off result.error', async () => {
	for (const result of [undefined, { error: { message: 'Credenciales inválidas' } }]) {
		const { visible, message } = await evaluate(formPath, [
			'visible: Boolean(result?.error)', 'message: result?.error?.message',
		], { result });
		assert.equal(visible, Boolean(result));
		assert.equal(message, result?.error?.message);
	}
	assert.match(form, /\{result\?\.error && \(\s*<p class="error" role="alert">\{result\.error\.message\}<\/p>/);
});

test('login page keeps prerender disabled and redirects only when the action supplies returnTo', async () => {
	for (const result of [undefined, { error: { message: 'Credenciales inválidas' } }]) {
		const { prerender } = await evaluate(pagePath, ['prerender'], { result });
		assert.equal(prerender, false);
	}
	const { location } = await evaluate(pagePath, ['prerender'], { result: { data: { returnTo: '/students' } } });
	assert.equal(location, '/students');
});

test('login page adds an intro header matching the approved register/patients folder family', async () => {
	const page = await source(pagePath);
	assert.match(page, /<main aria-labelledby="login-title">/);
	assert.match(page, /<header class="intro">/);
	assert.match(page, /<p class="eyebrow">[^<]+<\/p>/);
	assert.match(page, /<h1 id="login-title">Iniciar Sesión<\/h1>/);
	assert.match(page, /<LoginForm\s*\/>/);
	assert.doesNotMatch(page, /<h1>Iniciar Sesión<\/h1>/);
});

test('login form uses design tokens and the shared folder shell instead of the old scaffold palette', () => {
	const styles = form.match(/<style>([\s\S]*?)<\/style>/)[1];
	assert.doesNotMatch(styles, /#2563eb|#1d4ed8|#d1d5db|#dc2626|#fef2f2|#6b7280/);
	const panel = styles.match(/\bform\s*\{([^}]+)\}/)[1];
	const tab = styles.match(/form::before\s*\{([^}]+)\}/)[1];
	assert.match(panel, /position: relative/);
	assert.match(panel, /background: var\(--paper\)/);
	assert.match(tab, /content: ''/);
	assert.match(tab, /pointer-events: none/);
	assert.match(styles, /input:focus-visible, button:focus-visible\s*\{[^}]*outline: 3px solid var\(--rust\)/);
	assert.match(styles, /button\s*\{[^}]*background: var\(--rust\)/);
	assert.doesNotMatch(styles, /max-width:\s*320px/);
	assert.doesNotMatch(form, /<style is:global|:global\(/);
});

test('login form aria wiring links the legend and required hint to the fieldset', () => {
	assert.match(form, /aria-labelledby="login-form-title"/);
	assert.match(form, /<legend id="login-form-title">/);
	assert.match(form, /aria-describedby="login-required-hint"/);
	assert.match(form, /id="login-required-hint">Todos los campos son obligatorios\./);
});

test('login visual sources use normalized text without trailing whitespace or encoding artifacts', async () => {
	// Built via fromCharCode, not a literal escape, so this file's own source never embeds
	// the BOM/replacement codepoints it is asserting against.
	const bom = new RegExp('^' + String.fromCharCode(0xfeff));
	const replacementChar = new RegExp(String.fromCharCode(0xfffd));
	for (const path of [pagePath, formPath, 'tests/login.test.mjs']) {
		const content = await source(path);
		assert.equal(content, content.replace(bom, '').replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n');
		assert.doesNotMatch(content, replacementChar);
	}
});
