import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/subject-group/api.ts';
const subjectId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const groupId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const creatorId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const association = (overrides = {}) => ({
	subject_id: subjectId,
	academic_group_id: groupId,
	created_by: null,
	created_at: '2025-01-02T03:04:05.000Z',
	...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

async function evaluateApi(options = {}) {
	const cookieState = { token: Object.hasOwn(options, 'token') ? options.token : 'operator-token' };
	const writes = [];
	const requests = [];
	const cookies = {
		get: (name) => name === 'session' && cookieState.token ? { value: cookieState.token } : undefined,
		set: (...args) => { writes.push(['set', ...args]); cookieState.token = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); cookieState.token = undefined; },
	};
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date,
		fetch: async (url, init) => {
			const status = options.status ?? 200;
			requests.push({ url, ...init, responseStatus: status });
			if (options.networkError) throw new Error('Offline');
			const params = new URL(url).searchParams;
			const response = options.response ?? (status >= 400
				? { error: { code: status === 401 ? 'UNAUTHORIZED' : 'DENIED', message: 'Request failed' } }
				: { items: [association()], limit: Number(params.get('limit')), offset: Number(params.get('offset')) });
			return Response.json(response, { status });
		},
	});
	const modules = new Map();
	async function compile(code, identifier) {
		if (modules.has(identifier)) return modules.get(identifier);
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, {
			context: sandbox,
			identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; },
		});
		modules.set(identifier, module);
		await module.link(async (specifier, parent) => {
			const resolved = new URL(/\.(?:ts|astro)$/.test(specifier) ? specifier : `${specifier}.ts`, parent.identifier);
			const code = resolved.pathname.endsWith('.astro') ? 'export default {};' : await readFile(resolved, 'utf8');
			return compile(code, resolved.href);
		});
		return module;
	}
	const module = await compile(await readFile(new URL(apiPath, root), 'utf8'), new URL(apiPath, root).href);
	await module.evaluate();
	async function loadModule(identifier) {
		const requested = new URL(identifier);
		const resolved = /\.(?:ts|astro)$/.test(requested.pathname) ? requested : new URL(`${identifier}.ts`);
		const dependency = await compile(resolved.pathname.endsWith('.astro') ? 'export default {};' : await readFile(resolved, 'utf8'), resolved.href);
		if (dependency.status === 'linked') await dependency.evaluate();
		return dependency.namespace;
	}
	return { api: module.namespace, cookies, cookieState, writes, requests, sandbox, loadModule };
}

test('listSubjectGroups sends exact authenticated pagination and optional filter query', async () => {
	const result = await evaluateApi();
	const page = await result.api.listSubjectGroups({ limit: 7, offset: 14 }, { subjectId }, result.cookies);
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, `https://backend.invalid/subject-groups?limit=7&offset=14&subject_id=${subjectId}`);
	assert.equal(result.requests[0].method, 'GET');
	assert.equal(result.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.requests[0].headers['Content-Type'], 'application/json');
	assert.deepEqual(plain(page), { state: 'success', page: { items: [association()], limit: 7, offset: 14 } });
	assert.equal(result.cookieState.token, 'operator-token');
	assert.deepEqual(result.writes, []);
	const unfiltered = await evaluateApi();
	await unfiltered.api.listSubjectGroups({ limit: 50, offset: 0 }, { subjectId: null }, unfiltered.cookies);
	assert.equal(unfiltered.requests[0].url, 'https://backend.invalid/subject-groups?limit=50&offset=0');
});

test('subject UUID filter accepts canonical hexadecimal and rejects blank or repeated values', async () => {
	const result = await evaluateApi();
	const { parseSubjectGroupFilter } = result.api;
	assert.deepEqual(plain(parseSubjectGroupFilter(new URLSearchParams())), { subjectId: null });
	assert.deepEqual(plain(parseSubjectGroupFilter(new URLSearchParams(`subject_id=${subjectId}`))), { subjectId });
	assert.deepEqual(plain(parseSubjectGroupFilter(new URLSearchParams('subject_id=ABCDEF12-3456-789A-BCDE-F0123456789A'))), {
		subjectId: 'ABCDEF12-3456-789A-BCDE-F0123456789A',
	});
	for (const query of ['subject_id=', 'subject_id=bad', `subject_id=${subjectId}&subject_id=${groupId}`]) {
		assert.throws(() => parseSubjectGroupFilter(new URLSearchParams(query)), /UUID válido/);
	}
});

test('association response wrapper, page coordinates, fields and item order are validated', async () => {
	const malformed = [
		{}, { items: {}, limit: 7, offset: 14 }, { items: [null], limit: 7, offset: 14 },
		{ items: [{}], limit: 7, offset: 14 },
		{ items: [association({ subject_id: 'bad' })], limit: 7, offset: 14 },
		{ items: [association({ academic_group_id: 'bad' })], limit: 7, offset: 14 },
		{ items: [association({ created_by: 'bad' })], limit: 7, offset: 14 },
		{ items: [association({ created_at: 'yesterday' })], limit: 7, offset: 14 },
		{ items: [association()], limit: 6, offset: 14 }, { items: [association()], limit: 7, offset: 0 },
	];
	for (const response of malformed) {
		const result = await evaluateApi({ response });
		assert.deepEqual(plain(await result.api.listSubjectGroups({ limit: 7, offset: 14 }, { subjectId: null }, result.cookies)), { state: 'failed' });
	}
	const items = [association({ subject_id: groupId }), association({ academic_group_id: subjectId, created_by: creatorId })];
	const valid = await evaluateApi({ response: { items, limit: 7, offset: 14 } });
	assert.deepEqual(plain(await valid.api.listSubjectGroups({ limit: 7, offset: 14 }, { subjectId: null }, valid.cookies)), {
		state: 'success', page: { items, limit: 7, offset: 14 },
	});
});

test('403 is denied; 500 and network failures fail without clearing the session', async () => {
	for (const [options, state] of [[{ status: 403 }, 'denied'], [{ status: 500 }, 'failed'], [{ networkError: true }, 'failed']]) {
		const result = await evaluateApi(options);
		assert.deepEqual(plain(await result.api.listSubjectGroups({ limit: 7, offset: 14 }, { subjectId: null }, result.cookies)), { state });
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
});

test('all listing URL helpers allowlist contract parameters and reset only supported state', async () => {
	const { api } = await evaluateApi();
	const current = new URLSearchParams(`limit=9&offset=36&subject_id=${subjectId}&view=compact&sort=asc&_action=evil&redirect=https://evil.invalid`);
	const before = current.toString();
	assert.equal(api.subjectGroupPageHref(current, { limit: 9, offset: 36 }, 27),
		`/subject-groups?limit=9&offset=27&subject_id=${subjectId}`);
	assert.equal(api.subjectGroupFilterHref(current, groupId, 9),
		`/subject-groups?limit=9&offset=0&subject_id=${groupId}`);
	assert.equal(api.subjectGroupClearFilterHref(current, 9), '/subject-groups?limit=9&offset=0');
	assert.equal(api.subjectGroupPageHref(new URLSearchParams('sort=asc'), { limit: 9, offset: 0 }, 9),
		'/subject-groups?limit=9&offset=9');
	assert.equal(current.toString(), before, 'URL construction does not mutate the caller parameters');
});

test('401 propagates from apiFetch after clearing the session cookie', async () => {
	const result = await evaluateApi({ status: 401 });
	await assert.rejects(
		result.api.listSubjectGroups({ limit: 7, offset: 14 }, { subjectId: null }, result.cookies),
		(error) => error.status === 401 && error.code === 'UNAUTHORIZED',
	);
	assert.equal(result.cookieState.token, undefined);
	assert.deepEqual(plain(result.writes), [['delete', 'session', { path: '/' }]]);
});

test('association list component receives listing, filter, and navigation props', async () => {
	const component = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupList.astro', import.meta.url), 'utf8');
	assert.match(component, /interface Props/);
	for (const prop of ['state:', 'items:', 'limit:', 'offset:', 'subjectId:', 'filterHref:', 'clearFilterHref:', 'previousHref:', 'nextHref:', 'invalidMessage:']) {
		assert.ok(component.includes(prop), `component accepts ${prop}`);
	}
	assert.match(component, /const \{ state, items, limit, offset, subjectId, filterHref, clearFilterHref, previousHref, nextHref, invalidMessage \} = Astro\.props/);
});

test('association filter applies and clears its allowlisted UUID filter accessibly', async () => {
	const component = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupList.astro', import.meta.url), 'utf8');
	assert.match(component, /<form action="\/subject-groups" method="get">/);
	assert.match(component, /name="limit" value=\{limit\}/);
	assert.match(component, /name="subject_id"/);
	assert.match(component, /value=\{subjectId \?\? ''\}/);
	assert.match(component, /required/);
	assert.match(component, /aria-describedby="subject-id-help"/);
	assert.match(component, /Ingresá el UUID completo de la asignatura/);
	assert.match(component, /<button type="submit">Aplicar filtro<\/button>/);
	assert.match(component, /<a href=\{clearFilterHref\}>Limpiar filtro<\/a>/);
	assert.match(component, /<code>\{association\.subject_id\}<\/code>/);
	assert.match(component, /<code>\{association\.academic_group_id\}<\/code>/);
});

test('association list exposes accessible states and contract-filtered pagination', async () => {
	const component = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupList.astro', import.meta.url), 'utf8');
	assert.match(component, /role="status"/);
	assert.match(component, /role="alert"/);
	assert.match(component, /aria-labelledby="state-title"/);
	assert.match(component, /<nav class="pagination" aria-label="Paginación de asociaciones académicas">/);
	assert.match(component, /href=\{previousHref\} rel="prev"/);
	assert.match(component, /href=\{nextHref\} rel="next"/);
	assert.match(component, /href=\{clearFilterHref\}/);
});

test('association list empty states remain neutral and use the academic palette without totals', async () => {
	const component = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupList.astro', import.meta.url), 'utf8');
	assert.match(component, /No hay asociaciones en esta página/);
	assert.match(component, /La consulta filtrada no devolvió asociaciones/);
	assert.match(component, /var\(--paper\)/);
	assert.match(component, /var\(--sage\)/);
	assert.match(component, /var\(--rust\)/);
	assert.match(component, /overflow-wrap: anywhere/);
	assert.doesNotMatch(component, /total(?:es)?\s*(?:de|:|=)|created_by|created_at|association_id|habilitaciones/i);
});

async function evaluateRoute(query = '', options = {}) {
	const pageUrl = new URL('../src/pages/subject-groups.astro', import.meta.url);
	const source = await readFile(pageUrl, 'utf8');
	const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	assert.ok(frontmatter, 'route has Astro frontmatter');
	const simulation = await evaluateApi(options);
	simulation.sandbox.Astro = {
		cookies: simulation.cookies,
		url: new URL(`https://app.invalid/subject-groups${query ? `?${query}` : ''}`),
		redirect: (url) => ({ redirected: url }),
	};
	const routeCode = frontmatter[1];
	const parsed = ts.createSourceFile(pageUrl.pathname, routeCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const removals = [];
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		removals.push([statement.getFullStart(), statement.getEnd()]);
		const clause = statement.importClause;
		if (!clause || statement.getText(parsed).startsWith('import type ')) continue;
		const specifier = statement.moduleSpecifier.text;
		const moduleUrl = new URL(specifier, pageUrl);
		const namespace = await simulation.loadModule(moduleUrl.href);
		if (clause.name) simulation.sandbox[clause.name.text] = namespace.default;
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) {
				simulation.sandbox[element.name.text] = namespace[element.propertyName?.text ?? element.name.text];
			}
		}
	}
	let code = routeCode;
	for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + code.slice(end);
	code = code.replace(/^export const prerender = false;\s*$/m, '');
	const output = ts.transpileModule(`${code}\nreturn { state, items, limit, offset, subjectId, previousHref, nextHref, invalidMessage };`, {
		compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const value = await new vm.Script(`(async () => { ${output} })()`).runInContext(simulation.sandbox);
	return { source, value, ...simulation };
}

test('route evaluator records the real authenticated GET and cookie lifecycle', async () => {
	const result = await evaluateRoute();
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, 'https://backend.invalid/subject-groups?limit=50&offset=0');
	assert.equal(result.requests[0].method, 'GET');
	assert.equal(result.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.cookieState.token, 'operator-token');
	assert.deepEqual(result.writes, []);
});

test('subject-group route uses real pagination, API filtering and allowlisted navigation', async () => {
	const uppercaseId = 'ABCDEF12-3456-789A-BCDE-F0123456789A';
	const items = [association({ subject_id: uppercaseId }), association({ academic_group_id: subjectId })];
	const result = await evaluateRoute(`limit=2&offset=2&subject_id=${uppercaseId}&sort=asc&_action=evil`, {
		response: { items, limit: 2, offset: 2 },
	});
	assert.equal(result.value.state, 'success');
	assert.deepEqual([result.value.limit, result.value.offset, result.value.subjectId], [2, 2, uppercaseId]);
	assert.deepEqual(plain(result.value.items), items);
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, `https://backend.invalid/subject-groups?limit=2&offset=2&subject_id=${uppercaseId}`);
	assert.equal(result.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.value.previousHref, `/subject-groups?limit=2&offset=0&subject_id=${uppercaseId}`);
	assert.equal(result.value.nextHref, `/subject-groups?limit=2&offset=4&subject_id=${uppercaseId}`);
});

test('real pagination and filter helpers reject invalid, fractional, blank and repeated values before fetching', async () => {
	for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=', 'limit=1&limit=2', 'offset=-1', 'offset=10001', 'offset=1.5', 'offset=', 'offset=1&offset=2', 'subject_id=', 'subject_id=bad', `subject_id=${subjectId}&subject_id=${groupId}`]) {
		const result = await evaluateRoute(query);
		assert.ok(['invalid-pagination', 'invalid-filter'].includes(result.value.state), query);
		assert.equal(result.requests.length, 0, query);
		assert.deepEqual(result.writes, [], query);
	}
});

test('actual session guard redirects before fetching when the session cookie is absent', async () => {
	const result = await evaluateRoute('', { token: null });
	assert.deepEqual(result.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.equal(result.requests.length, 0);
	assert.deepEqual(result.writes, []);
});

test('actual list result handles empty, full, maximum-offset, and stable item order', async () => {
	const empty = await evaluateRoute('limit=2&offset=0', { response: { items: [], limit: 2, offset: 0 } });
	assert.equal(empty.value.state, 'success');
	assert.equal(empty.value.previousHref, null);
	assert.equal(empty.value.nextHref, null);
	const items = [association({ subject_id: groupId }), association({ academic_group_id: subjectId })];
	const full = await evaluateRoute('limit=2&offset=2', { response: { items, limit: 2, offset: 2 } });
	assert.deepEqual(plain(full.value.items), items);
	assert.equal(full.value.previousHref, '/subject-groups?limit=2&offset=0');
	assert.equal(full.value.nextHref, '/subject-groups?limit=2&offset=4');
	const maximum = await evaluateRoute('limit=2&offset=10000', { response: { items, limit: 2, offset: 10000 } });
	assert.equal(maximum.value.previousHref, '/subject-groups?limit=2&offset=9998');
	assert.equal(maximum.value.nextHref, null);
});

test('actual API 403, 500 and network failures preserve cookies; 401 clears then redirects', async () => {
	for (const [options, state] of [[{ status: 403 }, 'denied'], [{ status: 500 }, 'failed'], [{ networkError: true }, 'failed']]) {
		const result = await evaluateRoute('', options);
		assert.equal(result.value.state, state);
		assert.equal(result.requests.length, 1);
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const unauthorized = await evaluateRoute('', { status: 401 });
	assert.deepEqual(unauthorized.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.equal(unauthorized.requests.length, 1);
	assert.equal(unauthorized.cookieState.token, undefined);
	assert.deepEqual(plain(unauthorized.writes), [['delete', 'session', { path: '/' }]]);
});

test('subject-group route retains listing-only Spanish markup and excludes deferred UI', async () => {
	const source = (await readFile(new URL('../src/pages/subject-groups.astro', import.meta.url), 'utf8'));
	assert.match(source, /<SubjectGroupList/);
	assert.match(source, /<Layout>/);
	assert.match(source, /Grupos por asignatura/);
	assert.match(source, /Consultá las asociaciones registradas entre asignaturas y grupos académicos\./);
	assert.doesNotMatch(source, /actions\.|SubjectGroupForm|listSubjects|listGroups|catalog|draft_|actionResult|recovered/);
});
