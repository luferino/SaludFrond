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
		const result = await evaluate('src/pages/index.astro', ['isAuthed'], token);
		assert.equal(result.redirect, '/auth/login?returnTo=%2F');
	}
});

test('sidebar preserves role and permission visibility for grouped navigation', async () => {
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
		const shell = await evaluate('src/layouts/Layout.astro', ['canRegister', 'academicLinks', 'peopleLinks'], token);
		const peopleLinks = Array.from(shell.peopleLinks, (link) => link.href);
		assert.deepEqual(peopleLinks, expected.filter((href) => href !== '/auth/register'));
		assert.equal(shell.canRegister, expected.includes('/auth/register'));
		const sidebarLinks = Array.from(shell.academicLinks, (link) => link.href);
		assert.deepEqual(sidebarLinks, academic);
		assert.equal(new Set(sidebarLinks).size, academic.length);
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

test('home is a simple welcome without module cards or quick links', async () => {
	const home = await source('src/pages/index.astro');
	assert.match(home, /<h1 id="home-title">Bienvenido a Salud<\/h1>/);
	assert.match(home, /menú de navegación/);
	assert.doesNotMatch(home, /module-card|module-grid|session-panel|modules|<a\s|<form|<script|fetch\(/);
});

test('shell groups navigation and preserves active links and keyboard access', async () => {
	const shell = await source('src/layouts/Layout.astro');
	assert.match(shell, /aria-label="Personas"/);
	assert.match(shell, /aria-label="Académico"/);
	assert.match(shell, /id="account-title">Cuenta/);
	assert.match(shell, /peopleLinks\.length > 0/);
	assert.match(shell, /\{canRegister && <a href="\/auth\/register"/);
	assert.match(shell, /\{academicLinks\.map\(/);
	assert.match(shell, /<nav class="module-nav" aria-label="Académico">[\s\S]*academicLinks\.map/);
	assert.match(shell, /aria-current=\{currentPath === link\.href \? 'page' : undefined\}/);
	assert.match(shell, /href="#page-content"/);
	assert.match(shell, /id="page-content"[^>]*tabindex="-1"/);
	assert.match(shell, /aria-current=\{currentPath === '\/' \? 'page' : undefined\}/);
});
