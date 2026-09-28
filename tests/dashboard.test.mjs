import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const valid = { exp: Math.floor(Date.now() / 1000) + 3600, role: 'estudiante' };

// Execute real frontmatter with isolated cookies and no backend or browser.
async function evaluate(path, names, token, pathname = '/') {
	const sandbox = vm.createContext({
		atob, Date,
		Astro: {
			cookies: { get: (name) => name === 'session' && token ? { value: token } : undefined },
			url: new URL(pathname, 'https://frontend.invalid'),
			redirect: (location) => ({ redirect: location }),
		},
	});
	const frontmatter = (await source(path)).split('---')[1]
		.replace(/^import .*\.astro';\r?$/gm, '')
		.replace('export const prerender', 'const prerender');
	const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
	const body = frontmatter.replace(/^import .*;\r?$/gm, '');
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, { context: sandbox, identifier });
		await module.link(async (specifier, parent) => {
			const url = new URL(`${specifier}.ts`, parent.identifier);
			return compile(await readFile(url, 'utf8'), url.href);
		});
		return module;
	}
	const module = await compile(`${imports.join('\n')}
		export function render() { ${body}\nreturn { ${names.join(', ')} }; }`, new URL(path, root).href);
	await module.evaluate();
	return module.namespace.render();
}

test('home keeps the session redirect for absent, malformed, and expired tokens', async () => {
	for (const token of [undefined, 'invalid', jwt({ ...valid, exp: 1 })]) {
		const result = await evaluate('src/pages/index.astro', ['modules'], token);
		assert.equal(result.redirect, '/auth/login?returnTo=%2F');
	}
});

test('home module links preserve admin gates and defensive registration permission hints', async () => {
	const cases = [
		[valid, []],
		[{ ...valid, role: 'admin' }, ['/patients', '/students', '/teachers']],
		[{ ...valid, permissions: ['users:write'] }, ['/auth/register']],
		[{ ...valid, role: 'admin', permissions: ['users:write'] }, ['/patients', '/students', '/teachers', '/auth/register']],
		...[null, [], {}, 'users:write', ['users:read'], ['users:write', null]]
			.map((permissions) => [{ ...valid, permissions }, []]),
	];
	for (const [payload, expected] of cases) {
		const token = jwt(payload);
		const home = await evaluate('src/pages/index.astro', ['modules', 'canRegister'], token);
		const shell = await evaluate('src/layouts/Layout.astro', ['canRegister'], token);
		assert.deepEqual(Array.from(home.modules, (module) => module.href), expected);
		assert.equal(home.canRegister, shell.canRegister);
	}
});

test('shell resolves known page titles and normalizes trailing slashes', async () => {
	for (const [pathname, title] of [['/', 'Inicio'], ['/patients/', 'Pacientes'], ['/auth/register', 'Registrar usuario']]) {
		const result = await evaluate('src/layouts/Layout.astro', ['pageTitle', 'currentPath'], jwt(valid), pathname);
		assert.equal(result.pageTitle, title);
		assert.equal(result.currentPath, pathname.replace(/\/$/, '') || '/');
	}
});

test('templates wire real module links, an empty state, and keyboard navigation without new controls', async () => {
	const home = await source('src/pages/index.astro');
	const shell = await source('src/layouts/Layout.astro');
	assert.match(home, /modules\.map\(/);
	assert.match(home, /href=\{module\.href\}/);
	assert.match(home, /modules\.length > 0/);
	assert.match(home, /No hay accesos de gestión disponibles/);
	assert.doesNotMatch(home, /<form|<script|fetch\(/);
	assert.match(shell, /href="#page-content"/);
	assert.match(shell, /id="page-content"[^>]*tabindex="-1"/);
	assert.match(shell, /aria-current=\{currentPath === '\/' \? 'page' : undefined\}/);
});
