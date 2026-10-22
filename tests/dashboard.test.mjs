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

test('home preserves the original nonacademic visibility matrix and adds academic links for every valid session', async () => {
	const cases = [
		[valid, []],
		[{ ...valid, role: 'admin' }, ['/patients', '/students', '/teachers']],
		[{ ...valid, permissions: ['users:write'] }, ['/auth/register']],
		[{ ...valid, role: 'admin', permissions: ['users:write'] }, ['/patients', '/students', '/teachers', '/auth/register']],
		...[null, [], {}, 'users:write', ['users:read'], ['users:write', null], ['academic:read'], ['subjects:write']]
			.map((permissions) => [{ ...valid, permissions }, []]),
		[{ ...valid, role: 'student', permissions: ['subjects:read', 'groups:write'] }, []],
		[{ ...valid, role: undefined, permissions: undefined }, []],
		[{ ...valid, role: 'unknown' }, []],
	];
	const academic = ['/subjects', '/groups', '/subject-groups', '/teacher-habilitations', '/student-habilitations'];
	for (const [payload, expected] of cases) {
		const token = jwt(payload);
		const home = await evaluate('src/pages/index.astro', ['modules', 'canRegister'], token);
		const shell = await evaluate('src/layouts/Layout.astro', ['canRegister', 'academicLinks'], token);
		const homeLinks = Array.from(home.modules, (module) => module.href);
		assert.deepEqual(homeLinks.filter((href) => !academic.includes(href)), expected);
		assert.deepEqual(homeLinks.filter((href) => academic.includes(href)), academic);
		const sidebarLinks = Array.from(shell.academicLinks, (link) => link.href);
		assert.deepEqual(sidebarLinks, academic);
		assert.equal(new Set(sidebarLinks).size, academic.length);
		assert.equal(home.canRegister, shell.canRegister);
	}
});

test('shell resolves academic titles and keeps exact active paths across query strings and trailing slashes', async () => {
	for (const [pathname, title, path] of [
		['/', 'Inicio', '/'], ['/patients/', 'Pacientes', '/patients'], ['/auth/register', 'Registrar usuario', '/auth/register'],
		['/subjects?limit=20', 'Asignaturas', '/subjects'], ['/groups/', 'Grupos académicos', '/groups'],
		['/subject-groups/?subject_id=abc', 'Asignaturas y grupos', '/subject-groups'],
		['/teacher-habilitations/', 'Habilitaciones docentes', '/teacher-habilitations'],
		['/student-habilitations?status=revoked', 'Habilitaciones de estudiantes', '/student-habilitations'],
	]) {
		const result = await evaluate('src/layouts/Layout.astro', ['pageTitle', 'currentPath', 'academicLinks'], jwt(valid), pathname);
		assert.equal(result.pageTitle, title);
		assert.equal(result.currentPath, path);
		assert.deepEqual(Array.from(result.academicLinks, (link) => link.href), ['/subjects', '/groups', '/subject-groups', '/teacher-habilitations', '/student-habilitations']);
	}
	for (const token of [undefined, 'invalid', jwt({ ...valid, exp: 1 })]) {
		const anonymous = await evaluate('src/layouts/Layout.astro', ['academicLinks'], token);
		assert.deepEqual(Array.from(anonymous.academicLinks), []);
	}
});

test('templates expose authenticated academic navigation and cards without scripts or fetches', async () => {
	const home = await source('src/pages/index.astro');
	const shell = await source('src/layouts/Layout.astro');
	assert.match(home, /modules\.map\(/);
	assert.match(home, /href=\{module\.href\}/);
	assert.match(home, /modules\.length > 0/);
	assert.match(home, /No hay accesos de gestión disponibles/);
	assert.match(home, /label: 'Catálogo académico'/);
	assert.match(home, /label: 'Gestión académica'/);
	assert.match(home, /label: 'Asociación académica'/);
	assert.match(home, /<span class="card-action">\{module\.action \?\? 'Abrir formulario'/);
	assert.doesNotMatch(home, /<form|<script|fetch\(/);
	assert.match(shell, /\{academicLinks\.map\(/);
	assert.match(shell, /<nav class="module-nav" aria-label="Principal">[\s\S]*academicLinks\.map/);
	assert.match(shell, /aria-current=\{currentPath === link\.href \? 'page' : undefined\}/);
	assert.match(shell, /href="#page-content"/);
	assert.match(shell, /id="page-content"[^>]*tabindex="-1"/);
	assert.match(shell, /aria-current=\{currentPath === '\/' \? 'page' : undefined\}/);
});
