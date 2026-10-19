import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/group/api.ts';
const pagePath = 'src/pages/groups.astro';
const componentPath = 'src/pods/group/components/GroupList.astro';
const source = (path) => readFile(new URL(path, root), 'utf8');
const sample = (overrides = {}) => ({
	id: 'group-1', academic_year: 2025, curriculum_semester: 3, name: 'Cohorte Norte', ...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

async function evaluate(path, options = {}) {
	const cookieState = { value: Object.hasOwn(options, 'token') ? options.token : 'operator-token' };
	const writes = [];
	const requests = [];
	const cookies = {
		get: (name) => name === 'session' && cookieState.value ? { value: cookieState.value } : undefined,
		set: (...args) => { writes.push(['set', ...args]); cookieState.value = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); cookieState.value = undefined; },
	};
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, atob,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('Offline');
			return Response.json(options.response ?? { items: [sample()], limit: 50, offset: 0 }, {
				status: options.status ?? 200,
			});
		},
		Astro: { cookies, url: new URL(options.url ?? 'https://frontend.invalid/groups'), redirect: (location) => ({ redirect: location }) },
	});
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, {
			context: sandbox,
			identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; },
		});
		await module.link(async (specifier, parent) => {
			if (specifier.endsWith('.astro')) return new vm.SyntheticModule([], function () {}, { context: sandbox });
			const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
			return compile(await readFile(resolved, 'utf8'), resolved.href);
		});
		return module;
	}
	let code = await source(path);
	if (path.endsWith('.astro')) {
		const frontmatter = code.split('---')[1].replace(/^export const prerender[^\n]*\n/m, '');
		const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
		code = `${imports.join('\n')}\nexport async function render() { ${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn { state, items, limit, previousOffset, nextOffset, invalidMessage }; }`;
	}
	const module = await compile(code, new URL(path, root).href);
	await module.evaluate();
	const value = path.endsWith('.astro') ? await module.namespace.render() : module.namespace;
	return { value, cookies, requests, writes, cookieState };
}

async function evaluateApi(options = {}) {
	const result = await evaluate(apiPath, options);
	return { ...result, api: result.value };
}

const pagination = { limit: 7, offset: 14 };

test('listGroups sends an authenticated bounded GET and preserves backend identifying fields', async () => {
	const result = await evaluateApi({ response: { items: [sample()], ...pagination } });
	const listed = await result.api.listGroups(pagination, result.cookies);
	assert.equal(listed.state, 'success');
	assert.deepEqual(plain(listed.page), { items: [sample()], ...pagination });
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, 'https://backend.invalid/groups?limit=7&offset=14');
	assert.equal(result.requests[0].method, 'GET');
	assert.equal(result.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.cookieState.value, 'operator-token');
	assert.deepEqual(result.writes, []);
});

test('listGroups validates page metadata and identifying fields including positive int32 values', async () => {
	const badPages = [
		{}, { items: {}, limit: 7, offset: 14 },
		{ items: [sample({ id: '' })], limit: 7, offset: 14 },
		{ items: [sample({ academic_year: 0 })], limit: 7, offset: 14 },
		{ items: [sample({ academic_year: 2_147_483_648 })], limit: 7, offset: 14 },
		{ items: [sample({ academic_year: 1.5 })], limit: 7, offset: 14 },
		{ items: [sample({ curriculum_semester: -1 })], limit: 7, offset: 14 },
		{ items: [sample({ curriculum_semester: 1.5 })], limit: 7, offset: 14 },
		{ items: [sample({ curriculum_semester: 2_147_483_648 })], limit: 7, offset: 14 },
		{ items: [sample({ name: '' })], limit: 7, offset: 14 },
		{ items: [sample({ name: '  ' })], limit: 7, offset: 14 },
		{ items: [sample({ id: 1 })], limit: 7, offset: 14 },
		{ items: [sample()], limit: 6, offset: 14 },
		{ items: [sample()], limit: 7, offset: 0 },
	];
	for (const response of badPages) {
		const result = await evaluateApi({ response });
		assert.deepEqual(plain(await result.api.listGroups(pagination, result.cookies)), { state: 'failed' });
	}
	const maximum = await evaluateApi({
		response: {
			items: [sample({ academic_year: 2_147_483_647, curriculum_semester: 2_147_483_647 })],
			...pagination,
		},
	});
	assert.equal((await maximum.api.listGroups(pagination, maximum.cookies)).state, 'success');
});

test('403 is denied while 500 and network failures fail without clearing session', async () => {
	for (const [options, state] of [[{ status: 403 }, 'denied'], [{ status: 500 }, 'failed'], [{ networkError: true }, 'failed']]) {
		const result = await evaluateApi(options);
		assert.deepEqual(plain(await result.api.listGroups(pagination, result.cookies)), { state });
		assert.equal(result.cookieState.value, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
});

test('401 propagates through apiFetch and clears the session cookie', async () => {
	const result = await evaluateApi({ status: 401 });
	await assert.rejects(result.api.listGroups(pagination, result.cookies), (error) => error.status === 401);
	assert.equal(result.requests.length, 1);
	assert.equal(result.cookieState.value, undefined);
	assert.deepEqual(plain(result.writes), [['delete', 'session', { path: '/' }]]);
});

test('groups listing applies default and custom pagination to authenticated requests', async () => {
	const defaults = await evaluate(pagePath);
	assert.equal(defaults.value.state, 'success');
	assert.equal(defaults.requests[0].url, 'https://backend.invalid/groups?limit=50&offset=0');
	assert.equal(defaults.requests[0].method, 'GET');
	assert.equal(defaults.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(defaults.value.limit, 50);
	const custom = await evaluate(pagePath, { url: 'https://frontend.invalid/groups?limit=7&offset=14', response: { items: [sample()], limit: 7, offset: 14 } });
	assert.equal(custom.requests[0].url, 'https://backend.invalid/groups?limit=7&offset=14');
	assert.equal(custom.value.previousOffset, 7);
	assert.deepEqual(custom.writes, []);
});

test('missing session redirects and invalid or repeated pagination never fetches', async () => {
	const missing = await evaluate(pagePath, { token: undefined });
	assert.deepEqual(missing.value, { redirect: '/auth/login?returnTo=%2Fgroups' });
	assert.equal(missing.requests.length, 0);
	for (const query of ['?limit=0', '?limit=101', '?offset=10001', '?limit=1&limit=2', '?offset=1.5', '?limit=-1']) {
		const result = await evaluate(pagePath, { url: `https://frontend.invalid/groups${query}` });
		assert.equal(result.value.state, 'invalid-pagination', query);
		assert.equal(result.requests.length, 0, query);
	}
});

test('listing preserves backend order and distinct group identities', async () => {
	const groups = [
		sample({ id: 'g-3', academic_year: 2026, curriculum_semester: 1, name: 'Trayecto' }),
		sample({ id: 'g-1', academic_year: 2025, curriculum_semester: 4, name: 'Trayecto' }),
		sample({ id: 'g-2', academic_year: 2025, curriculum_semester: 5, name: 'Trayecto' }),
	];
	const result = await evaluate(pagePath, { response: { items: groups, limit: 50, offset: 0 } });
	assert.deepEqual(plain(result.value.items), groups);
	assert.deepEqual(result.value.items.map(({ id }) => id), ['g-3', 'g-1', 'g-2']);
});

test('empty and maximum-offset pages navigate without claiming totals', async () => {
	for (const [query, offset, previous] of [['', 0, null], ['?offset=10000', 10000, 9950]]) {
		const result = await evaluate(pagePath, { url: `https://frontend.invalid/groups${query}`, response: { items: [], limit: 50, offset } });
		assert.equal(result.value.state, 'success');
		assert.deepEqual(plain(result.value.items), []);
		assert.equal(result.value.previousOffset, previous);
		assert.equal(result.value.nextOffset, null);
	}
	const full = await evaluate(pagePath, { url: 'https://frontend.invalid/groups?limit=50&offset=10000', response: { items: Array.from({ length: 50 }, (_, i) => sample({ id: `g-${i}` })), limit: 50, offset: 10000 } });
	assert.equal(full.value.previousOffset, 9950);
	assert.equal(full.value.nextOffset, null);
});

test('listing presents safe distinct denial, failure and 401 session states', async () => {
	for (const [status, expected] of [[403, 'denied'], [500, 'failed'], [400, 'failed']]) {
		const result = await evaluate(pagePath, { status });
		assert.equal(result.value.state, expected);
		assert.equal(result.cookieState.value, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const offline = await evaluate(pagePath, { networkError: true });
	assert.equal(offline.value.state, 'failed');
	assert.equal(offline.cookieState.value, 'operator-token');
	const expired = await evaluate(pagePath, { status: 401 });
	assert.deepEqual(expired.value, { redirect: '/auth/login?returnTo=%2Fgroups' });
	assert.equal(expired.cookieState.value, undefined);
	assert.deepEqual(plain(expired.writes), [['delete', 'session', { path: '/' }]]);
});

test('group list exposes Spanish labels, accessible states, bounded navigation and shared palette', async () => {
	const component = await source(componentPath);
	const page = await source(pagePath);
	for (const text of ['Grupos académicos', 'Año académico', 'Semestre curricular', 'Nombre', 'No hay grupos académicos en esta página', 'Sin permiso para consultar', 'No se pudo cargar el catálogo', 'Paginación no válida']) {
		assert.ok(component.includes(text) || page.includes(text));
	}
	assert.match(component, /role="status"/);
	assert.match(component, /role="alert"/);
	assert.match(component, /aria-label="Paginación de grupos académicos"/);
	assert.match(component, /rel="prev"/);
	assert.match(component, /rel="next"/);
	assert.match(component, /new URLSearchParams\(\{/);
	assert.match(component, /var\(--paper\)/);
	assert.match(component, /var\(--sage\)/);
	assert.match(component, /var\(--rust\)/);
	assert.doesNotMatch(component, /total(?:es)?\s*(?:de|:|=)/i);
});
