import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const source = (path) => readFile(new URL(path, root), 'utf8');

async function load(path, fetch) {
	const sandbox = vm.createContext({ atob, Date, Response, URLSearchParams, fetch });
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
		const module = new vm.SourceTextModule(output, {
			context: sandbox, identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; },
		});
		await module.link(async (specifier, parent) => {
			const url = new URL(`${specifier}.ts`, parent.identifier);
			return compile(await readFile(url, 'utf8'), url.href);
		});
		return module;
	}
	const module = await compile(await source(path), new URL(path, root).href);
	await module.evaluate();
	return module.namespace;
}

const sessionToken = `header.${Buffer.from(JSON.stringify({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
const cookies = { get: () => ({ value: sessionToken }), delete() {} };

async function renderListingPage(path, search, fetch, pageCookies = cookies) {
	const sandbox = vm.createContext({ atob, Date, Response, URLSearchParams, fetch });
	const route = path.includes('students') ? '/students' : '/teachers';
	const url = new URL(`https://frontend.invalid${route}${search}`);
	sandbox.Astro = { cookies: pageCookies, url, redirect: (location) => ({ redirect: location }) };
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
		const module = new vm.SourceTextModule(output, {
			context: sandbox, identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid' }; },
		});
		await module.link(async (specifier, parent) => {
			if (specifier.endsWith('.astro')) return new vm.SourceTextModule('export default "component";', { context: sandbox });
			const file = new URL(`${specifier}.ts`, parent.identifier);
			return compile(await readFile(file, 'utf8'), file.href);
		});
		return module;
	}
	const sourceText = await source(path);
	const frontmatter = sourceText.split('---')[1].replace(/^import .*\.astro';\r?$/gm, '').replace('export const prerender', 'const prerender');
	const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
	const values = ['students', 'teachers', 'q', 'limit', 'offset', 'error', 'previousHref', 'nextHref', 'prerender'].filter((name) => new RegExp(`\\b${name}\\b`).test(frontmatter));
	const code = `${imports.join('\n')}\nexport async function render() { ${frontmatter.replace(/^import .*;\r?$/gm, '')} return { ${values.join(', ')} }; }`;
	const module = await compile(code, new URL(path, root).href);
	await module.evaluate();
	const result = await module.namespace.render();
	if (result && typeof result === 'object') result.cookieEvents = pageCookies.events ?? [];
	return result;
}

async function renderListingHtml(path, search, pageCookies = cookies) {
	let code = (await transform(await source(path), { filename: path })).code;
	const ast = ts.createSourceFile('person-listing-render.ts', code, ts.ScriptTarget.Latest, true);
	const removals = ast.statements
		.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const route = path.includes('students') ? '/students' : '/teachers';
	const params = new URLSearchParams(search);
	const pagination = { limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) };
	const isStudent = route === '/students';
	const data = { items: [{ id: 'profile-id', nombres: 'Ana', apellidos: 'Pérez', ...(isStudent ? { codalumno: 'A1' } : {}) }], ...pagination };
	const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
	async function html(value) {
		value = await value;
		if (value == null || value === false) return '';
		if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
		return String(value);
	}
	const Astro = { cookies: pageCookies, url: new URL(`https://fixture.invalid${route}?${search}`), redirect: (location) => ({ redirect: location }) };
	const listingHref = (offset) => `${route}?${new URLSearchParams({ limit: String(pagination.limit), offset: String(offset) })}`;
	const mocks = {
		Layout: {}, StudentForm: {}, TeacherForm: {},
		getSession: () => sessionToken, decodeJwt: () => ({ role: 'admin' }),
		listStudents: async () => data, listTeachers: async () => data,
		parseStudentSearch: (query) => query.get('q')?.trim() || null,
		parseTeacherSearch: (query) => query.get('q')?.trim() || null,
		studentPageHref: (_pagination, _q, offset) => listingHref(offset),
		teacherPageHref: (_pagination, _q, offset) => listingHref(offset),
		parseAcademicPagination: (query) => ({ limit: Number(query.get('limit') ?? 50), offset: Number(query.get('offset') ?? 0) }),
		academicPaginationNavigation: ({ limit, offset, itemsLength }) => ({ previousOffset: offset > 0 ? offset - limit : null, nextOffset: itemsLength === limit ? offset + limit : null }),
		$$createAstro: () => ({}), $$createComponent: (component) => component,
		$$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
		$$renderComponent: async (_result, _name, _component, _props, slots) => slots?.default ? slots.default() : '',
		$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${escape(value)}"`,
		$$maybeRenderHead: () => '', $$renderHead: () => '',
	};
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	return html(exports.default({ createAstro: () => Astro }, {}, {}));
}

test('student and teacher listing readers validate q and request only the minimal paginated DTO', async () => {
	for (const [kind, fields] of [['student', ['id', 'nombres', 'apellidos', 'codalumno']], ['teacher', ['id', 'nombres', 'apellidos']]]) {
		const calls = [];
		const item = { id: 'profile-uuid', nombres: 'Ana', apellidos: 'Pérez', ...(kind === 'student' ? { codalumno: 'A_1' } : {}) };
		const listing = await load(`src/pods/${kind}/listing.ts`, async (url, init) => {
			calls.push({ url, init });
			return Response.json({ items: [item], limit: 20, offset: 40 });
		});
		const read = listing[`list${kind === 'student' ? 'Students' : 'Teachers'}`];
		const parse = listing[`parse${kind === 'student' ? 'Student' : 'Teacher'}Search`];
		const params = new URLSearchParams('q=%25_%5C%20Ana%20&limit=20&offset=40');
		const q = parse(params);
		assert.equal(q, '%_\\ Ana');
		const page = await read({ limit: 20, offset: 40 }, q, cookies);
		assert.deepEqual(JSON.parse(JSON.stringify(page)), {
			items: [item], limit: 20, offset: 40,
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, `https://backend.invalid/${kind === 'student' ? 'students' : 'teachers'}?limit=20&offset=40&q=%25_%5C+Ana`);
		assert.equal(calls[0].init.method, 'GET');
		assert.equal(calls[0].init.headers.Authorization, `Bearer ${sessionToken}`);
		assert.deepEqual(Object.keys(page.items[0]), fields);
		for (const raw of [`q=${'x'.repeat(101)}`, 'q=Ada&q=Lee', 'q%5Bfilter%5D=Ada', 'q%2Ename=Ada']) {
			assert.throws(() => parse(new URLSearchParams(raw)), /q debe ser una cadena/);
		}
		assert.equal(calls.length, 1, 'invalid search is rejected before any API request');
	}
});

test('SSR page state keeps q through pagination, resets new searches, and separates errors from empty results', async () => {
	for (const [kind, fields, size] of [['students', ['id', 'nombres', 'apellidos', 'codalumno'], 2], ['teachers', ['id', 'nombres', 'apellidos'], 2]]) {
		const calls = [];
		const page = await renderListingPage(`src/pages/${kind}.astro`, '?q=%20Ada%25_%5C%20&limit=2&offset=2', async (url) => {
			calls.push(url);
			return Response.json({ items: Array.from({ length: size }, (_, index) => ({ id: `profile-${index}`, nombres: 'Ada', apellidos: 'Lovelace', ...(kind === 'students' ? { codalumno: 'A-1' } : {}) })), limit: 2, offset: 2 });
		});
		assert.equal(page.q, 'Ada%_\\');
		assert.equal(calls.length, 1);
		assert.equal(new URL(page.previousHref, 'https://frontend.invalid').searchParams.get('q'), page.q);
		assert.equal(new URL(page.nextHref, 'https://frontend.invalid').searchParams.get('q'), page.q);
		assert.equal(new URL(page.nextHref, 'https://frontend.invalid').searchParams.get('offset'), '4');
		assert.deepEqual(Object.keys(page[kind][0]), fields);
		assert.match(await source(`src/pages/${kind}.astro`), /<form method="get" action="[^"]+" role="search">/);
		assert.doesNotMatch(await source(`src/pages/${kind}.astro`), /name="offset"/);
		for (const invalid of ['?q=Ada&q=Byron', `?q=${'x'.repeat(101)}`, '?q%5Bfilter%5D=Ada']) {
			const rejectedCalls = [];
			const rejected = await renderListingPage(`src/pages/${kind}.astro`, invalid, async (url) => {
				rejectedCalls.push(url);
				return Response.json({ items: [], limit: 50, offset: 0 });
			});
			assert.equal(rejectedCalls.length, 0);
			assert.equal(rejected.error.includes('no se muestra una lista vacía'), true);
			assert.equal(rejected[kind].length, 0);
		}
		const failed = await renderListingPage(`src/pages/${kind}.astro`, '', async () => Response.json({ error: { message: 'Backend unavailable' } }, { status: 500 }));
		assert.equal(failed.error.includes('no se muestra una lista vacía'), true);
		assert.equal(failed[kind].length, 0);
	}
});

test('listing readers reject malformed pages, malformed minimal items, and uncontracted fields', async () => {
	for (const kind of ['student', 'teacher']) {
		const item = { id: 'profile-id', nombres: 'Ana', apellidos: 'Pérez', ...(kind === 'student' ? { codalumno: 'A1' } : {}) };
		const malformedPages = [
			{ items: {}, limit: 20, offset: 40 },
			{ items: [item], limit: '20', offset: 40 },
			{ items: [item], limit: 20, offset: 41 },
			{ items: [item], limit: 20, offset: 40, total: 1 },
			{ items: [{ ...item, id: 17 }], limit: 20, offset: 40 },
			{ items: [{ ...item, extra: 'not in the minimal DTO' }], limit: 20, offset: 40 },
		];
		for (const page of malformedPages) {
			const listing = await load(`src/pods/${kind}/listing.ts`, async () => Response.json(page));
			const read = listing[kind === 'student' ? 'listStudents' : 'listTeachers'];
			await assert.rejects(read({ limit: 20, offset: 40 }, null, cookies), /Respuesta de lista inválida/);
		}
	}
});

test('SSR redirects and clears session after 401 while 403 and 500 remain errors, not empty results', async () => {
	for (const kind of ['students', 'teachers']) {
		const events = [];
		const pageCookies = { get: () => ({ value: sessionToken }), delete: (...args) => events.push(['delete', ...args]), events };
		const unauthorized = await renderListingPage(`src/pages/${kind}.astro`, '', async () => Response.json({ error: { code: 'UNAUTHORIZED', message: 'expired' } }, { status: 401 }), pageCookies);
		assert.equal(unauthorized.redirect, '/auth/login');
		assert.equal(unauthorized.error, undefined);
		assert.equal(unauthorized.cookieEvents.length, 1);
		for (const [status, code] of [[403, 'FORBIDDEN'], [500, 'INTERNAL_SERVER_ERROR']]) {
			const rejected = await renderListingPage(`src/pages/${kind}.astro`, '', async () => Response.json({ error: { code, message: 'unavailable' } }, { status }));
			assert.equal(rejected.redirect, undefined);
			assert.match(rejected.error, /no se muestra una lista vacía/);
			assert.equal(rejected[kind].length, 0);
		}
	}
});

test('compiled Astro search form retains current limit and resets offset on new search', async () => {
	for (const kind of ['students', 'teachers']) {
		const html = await renderListingHtml(`src/pages/${kind}.astro`, 'q=Ada&limit=25&offset=50');
		const start = html.indexOf('<form method="get"');
		const end = html.indexOf('</form>', start);
		const form = start >= 0 && end >= 0 ? html.slice(start, end + '</form>'.length) : '';
		assert.ok(form, 'compiled Astro output contains the rendered GET search form');
		assert.match(form, /name="q"[^>]*value="Ada"/);
		assert.match(form, /name="limit"[^>]*value="25"/);
		assert.doesNotMatch(form, /name="offset"/);
	}
});
