import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const astroPackage = require.resolve('astro/package.json');
const { ActionInputError, createActionsProxy, isInputError } = await import(pathToFileURL(join(dirname(astroPackage), 'dist/actions/runtime/client.js')).href);

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
	const cookieState = options.cookieState ?? { token: Object.hasOwn(options, 'token') ? options.token : 'operator-token' };
	const writes = cookieState.writes ?? [];
	cookieState.writes = writes;
	const requests = [];
	const cookies = {
		get: (name) => name === 'session' && cookieState.token ? { value: cookieState.token } : undefined,
		set: (...args) => { writes.push(['set', ...args]); cookieState.token = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); cookieState.token = undefined; },
	};
	const actions = createActionsProxy({ handleAction: async () => ({ data: undefined, error: undefined }) });
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date,
		actions,
		isInputError,
		fetch: async (url, init) => {
			const isPost = init.method === 'POST';
			const endpoint = new URL(url).pathname;
			const isSubjectCatalog = endpoint === '/subjects' && !isPost;
			const status = isPost ? (options.postStatus ?? 201)
				: isSubjectCatalog ? (options.subjectStatus ?? options.status ?? 200)
					: (options.associationStatus ?? options.status ?? 200);
			requests.push({ url, ...init, responseStatus: status });
			if (options.networkError || (isSubjectCatalog && options.subjectNetworkError) || (!isSubjectCatalog && !isPost && options.associationNetworkError)) throw new Error('Offline');
			const params = new URL(url).searchParams;
			const response = isPost ? (options.postResponse ?? association()) : isSubjectCatalog
				? options.subjectResponse ?? (status >= 400
					? { error: { code: status === 401 ? 'UNAUTHORIZED' : 'DENIED', message: 'Request failed' } }
					: { items: [], limit: Number(params.get('limit')), offset: Number(params.get('offset')) })
				: options.response ?? (status >= 400
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
	return { api: module.namespace, actions, cookies, cookieState, writes, requests, sandbox, loadModule };
}

async function evaluateForm(props = {}) {
	const componentUrl = new URL('../src/pods/subject-group/components/SubjectGroupForm.astro', import.meta.url);
	const source = await readFile(componentUrl, 'utf8');
	const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	assert.ok(frontmatter, 'form has Astro frontmatter');
	const parsed = ts.createSourceFile(componentUrl.pathname, frontmatter[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const imports = parsed.statements.filter(ts.isImportDeclaration);
	let code = frontmatter[1];
	for (const statement of imports) code = code.replace(statement.getFullText(parsed), '');
	const result = await evaluateApi();
	result.sandbox.Astro = { props };
	const output = ts.transpileModule(`${code}\nreturn { fieldErrors, feedback, success, submittedSubjectId, submittedAcademicGroupId, visibleSubjects, subjectCatalogState, subjectCatalogMessage, actionUrl: String(actionUrl ?? actions.createSubjectGroup) };`, {
		compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const value = await new vm.Script(`(() => { ${output} })()`).runInContext(result.sandbox);
	return { ...value, source };
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

async function runSubjectSelectorScript({ withInput = true } = {}) {
	const source = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupForm.astro', import.meta.url), 'utf8');
	const script = source.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
	assert.ok(script, 'component has an executable client script');
	let listener;
	const subject = { value: 'manual-subject' };
	const group = { value: 'manual-group' };
	const choice = {
		value: subjectId,
		disabled: true,
		addEventListener: (name, callback) => { assert.equal(name, 'change'); assert.equal(choice.disabled, true, 'bind before enabling'); listener = callback; },
	};
	const form = { querySelector: (selector) => selector.includes('subject-choice') ? choice : selector.includes('subject_id') ? (withInput ? subject : null) : group };
	const root = { querySelector: () => form };
	const context = vm.createContext({ document: { querySelector: () => root } });
	const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	new vm.Script(code).runInContext(context);
	return { subject, group, choice, get listener() { return listener; } };
}

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
		getActionResult: () => options.actionResult,
		request: options.request ?? new Request(`https://app.invalid/subject-groups${query ? `?${query}` : ''}`),
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
		if (specifier === 'astro:actions') continue;
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
	const output = ts.transpileModule(`${code}\nreturn { state, items, limit, offset, subjectId, previousHref, nextHref, invalidMessage, actionUrl, actionResult, recoveredSubjectId, recoveredAcademicGroupId, subjectCatalogState, subjects, subjectLimit, subjectOffset, subjectCatalogMessage };`, {
		compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const value = await new vm.Script(`(async () => { ${output} })()`).runInContext(simulation.sandbox);
	return { source, value, ...simulation };
}

test('subject catalog uses independent bounded pagination and preserves association requests', async () => {
	const subject = { id: subjectId, name: 'Álgebra' };
	const result = await evaluateRoute('limit=7&offset=14&subject_limit=2&subject_offset=2', {
		subjectResponse: { items: [subject], limit: 2, offset: 2 },
		response: { items: [], limit: 7, offset: 14 },
	});
	assert.equal(result.value.state, 'success');
	assert.equal(result.value.subjectCatalogState, 'success');
	assert.deepEqual(plain(result.value.subjects), [subject]);
	assert.deepEqual(result.requests.map(({ url, method }) => [url, method]), [
		['https://backend.invalid/subjects?limit=2&offset=2', 'GET'],
		['https://backend.invalid/subject-groups?limit=7&offset=14', 'GET'],
	]);
	assert.equal(result.requests[1].headers.Authorization, 'Bearer operator-token');
	assert.deepEqual(result.writes, []);

	for (const query of ['subject_limit=1&subject_limit=2', 'subject_offset=1&subject_offset=2', 'subject_limit=0', 'subject_offset=10001']) {
		const invalid = await evaluateRoute(query);
		assert.equal(invalid.value.subjectCatalogState, 'invalid-pagination', query);
		assert.equal(invalid.requests.length, 1, 'invalid subject pagination skips only its own GET');
		assert.equal(invalid.requests[0].url, 'https://backend.invalid/subject-groups?limit=50&offset=0');
		assert.equal(invalid.value.actionUrl, '/subject-groups?_action=createSubjectGroup&limit=50&offset=0&subject_limit=50&subject_offset=0');
	}
	const invalidAssociation = await evaluateRoute('limit=1&limit=2&subject_limit=3');
	assert.equal(invalidAssociation.value.state, 'invalid-pagination');
	assert.equal(invalidAssociation.requests.length, 1);
	assert.equal(invalidAssociation.requests[0].url, 'https://backend.invalid/subjects?limit=3&offset=0');
});

test('subject catalog denial, failure, empty, and malformed pages remain independent', async () => {
	for (const [options, expected] of [
		[{ subjectStatus: 403 }, 'denied'], [{ subjectStatus: 500 }, 'failed'],
		[{ subjectNetworkError: true }, 'failed'],
		[{ subjectResponse: { items: [{ id: 42, name: 'X' }], limit: 50, offset: 0 } }, 'failed'],
	]) {
		const result = await evaluateRoute('', options);
		assert.equal(result.value.state, 'success');
		assert.equal(result.value.subjectCatalogState, expected);
		assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), ['/subjects', '/subject-groups']);
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const empty = await evaluateRoute('', { subjectResponse: { items: [], limit: 50, offset: 0 } });
	assert.deepEqual(plain(empty.value.subjects), []);
});

test('route evaluator records the real authenticated GET and cookie lifecycle', async () => {
	const result = await evaluateRoute();
	assert.equal(result.requests.length, 2);
	assert.equal(result.requests[1].url, 'https://backend.invalid/subject-groups?limit=50&offset=0');
	assert.equal(result.requests[1].method, 'GET');
	assert.equal(result.requests[1].headers.Authorization, 'Bearer operator-token');
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
	assert.equal(result.requests.length, 2);
	assert.equal(result.requests[1].url, `https://backend.invalid/subject-groups?limit=2&offset=2&subject_id=${uppercaseId}`);
	assert.equal(result.requests[1].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.value.previousHref, `/subject-groups?limit=2&offset=0&subject_id=${uppercaseId}`);
	assert.equal(result.value.nextHref, `/subject-groups?limit=2&offset=4&subject_id=${uppercaseId}`);
});

test('real pagination and filter helpers reject invalid, fractional, blank and repeated values before fetching', async () => {
	for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=', 'limit=1&limit=2', 'offset=-1', 'offset=10001', 'offset=1.5', 'offset=', 'offset=1&offset=2', 'subject_id=', 'subject_id=bad', `subject_id=${subjectId}&subject_id=${groupId}`]) {
		const result = await evaluateRoute(query);
		assert.ok(['invalid-pagination', 'invalid-filter'].includes(result.value.state), query);
		const invalidSubjectPagination = /subject_(?:limit|offset)/.test(query);
		assert.equal(result.requests.length, invalidSubjectPagination ? 0 : 1, query);
		if (!invalidSubjectPagination) assert.equal(new URL(result.requests[0].url).pathname, '/subjects', query);
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
		assert.equal(result.requests.length, 2);
		assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), ['/subjects', '/subject-groups']);
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const unauthorized = await evaluateRoute('', { status: 401 });
	assert.deepEqual(unauthorized.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.equal(unauthorized.requests.length, 1);
	assert.equal(new URL(unauthorized.requests[0].url).pathname, '/subjects');
	assert.equal(unauthorized.cookieState.token, undefined);
	assert.deepEqual(plain(unauthorized.writes), [['delete', 'session', { path: '/' }]]);
});

test('association 401 clears the session after an independent successful subject catalog GET', async () => {
	const result = await evaluateRoute('', { subjectStatus: 200, associationStatus: 401 });
	assert.deepEqual(result.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.deepEqual(result.requests.map(({ url, responseStatus }) => [new URL(url).pathname, responseStatus]), [
		['/subjects', 200], ['/subject-groups', 401],
	]);
	assert.equal(result.cookieState.token, undefined);
	assert.deepEqual(plain(result.writes), [['delete', 'session', { path: '/' }]]);
});

test('real POST 201 identity survives independent GET denial with the same session state', async () => {
	for (const status of [403, 500]) {
		const cookieState = { token: 'u13-distinctive-session', writes: [] };
		const post = await evaluateApi({ postStatus: 201, cookieState });
		const handler = await post.loadModule(new URL('../src/pods/subject-group/actions/subject-groups.ts', import.meta.url).href);
		const created = await handler.handleCreateSubjectGroup(
			{ subject_id: subjectId, academic_group_id: groupId }, { cookies: post.cookies },
		);
		assert.equal(post.requests[0].method, 'POST');
		assert.equal(post.requests[0].responseStatus, 201);
		assert.equal(post.requests[0].headers.Authorization, 'Bearer u13-distinctive-session');
		assert.deepEqual(JSON.parse(post.requests[0].body), { subject_id: subjectId, academic_group_id: groupId });
		assert.equal(created.success, true);
		const writesBeforeGet = [...post.writes];
		const refreshed = await evaluateRoute('', {
			status, subjectStatus: status, response: { error: { message: 'Unavailable' } }, actionResult: { data: created },
			cookieState: post.cookieState,
		});
		assert.strictEqual(refreshed.cookieState, post.cookieState);
		assert.deepEqual(refreshed.requests.map(({ url, responseStatus }) => [new URL(url).pathname, responseStatus]), [
			['/subjects', status], ['/subject-groups', status],
		]);
		assert.equal(refreshed.value.subjectCatalogState, status === 403 ? 'denied' : 'failed');
		assert.deepEqual(refreshed.value.actionResult.data, created);
		const form = await evaluateForm({ result: refreshed.value.actionResult });
		assert.equal(form.success, true);
		assert.equal(form.submittedSubjectId, subjectId);
		assert.equal(form.submittedAcademicGroupId, groupId);
		assert.equal(refreshed.cookieState.token, 'u13-distinctive-session');
		assert.deepEqual(refreshed.writes, writesBeforeGet);
	}
});

test('subject form props preserve catalog states, manual identity, and off-page selected identity', async () => {
	const subject = { id: subjectId, name: 'Álgebra' };
	const onPage = await evaluateForm({ subjects: [subject], subjectCatalogState: 'success', subjectId, academicGroupId: groupId });
	assert.deepEqual(plain(onPage.visibleSubjects), [subject]);
	assert.equal(onPage.submittedSubjectId, subjectId);
	assert.equal(onPage.submittedAcademicGroupId, groupId);
	const offPage = await evaluateForm({ subjects: [subject], subjectCatalogState: 'success', subjectId: creatorId, academicGroupId: groupId });
	assert.deepEqual(plain(offPage.visibleSubjects), [
		{ id: creatorId, name: 'Asignatura seleccionada fuera de esta página' }, subject,
	]);
	for (const state of ['denied', 'failed', 'invalid-pagination']) {
		const form = await evaluateForm({ subjectCatalogState: state, subjectCatalogMessage: 'Parámetro inválido', subjectId: creatorId, academicGroupId: groupId });
		assert.equal(form.subjectCatalogState, state);
		assert.equal(form.submittedSubjectId, creatorId);
		assert.equal(form.submittedAcademicGroupId, groupId);
	}
});

test('subject selector script binds before enabling and updates only the submit subject input', async () => {
	const fixture = await runSubjectSelectorScript();
	assert.equal(fixture.choice.disabled, false);
	assert.equal(typeof fixture.listener, 'function');
	fixture.listener();
	assert.equal(fixture.subject.value, subjectId);
	assert.equal(fixture.group.value, 'manual-group');
	const unbound = await runSubjectSelectorScript({ withInput: false });
	assert.equal(unbound.choice.disabled, true);
	assert.equal(unbound.listener, undefined);
});

test('form frontmatter evaluates real action proxy, framework errors, and submitted identities', async () => {
	const success = await evaluateForm({
		result: { data: { success: true, subjectId, academicGroupId: groupId } },
		subjectId: 'fallback-subject', academicGroupId: 'fallback-group',
	});
	assert.equal(success.submittedSubjectId, subjectId);
	assert.equal(success.submittedAcademicGroupId, groupId);
	assert.equal(success.success, true);
	assert.equal(success.actionUrl, '?_action=createSubjectGroup');
	const fields = await evaluateForm({ result: { error: new ActionInputError([
		{ path: ['subject_id'], message: 'Invalid subject UUID' },
		{ path: ['academic_group_id'], message: 'Invalid group UUID' },
	]) } });
	assert.deepEqual(plain(fields.fieldErrors), {
		subject_id: ['Invalid subject UUID'], academic_group_id: ['Invalid group UUID'],
	});
	const frameworkError = new ActionInputError([{ path: ['subject_id'], message: 'Framework message' }]);
	const precedence = await evaluateForm({ result: {
		error: frameworkError,
		data: { error: 'Handler message', subjectId, academicGroupId: groupId },
	}, subjectId: 'fallback-subject', academicGroupId: 'fallback-group' });
	assert.equal(precedence.feedback, frameworkError.message);
	assert.equal(precedence.submittedSubjectId, subjectId);
	assert.equal(precedence.submittedAcademicGroupId, groupId);
});

test('real POST 403 survives GET 200 with field feedback, identities, and the same session', async () => {
	const cookieState = { token: 'u13-post-error-session', writes: [] };
	const post = await evaluateApi({ postStatus: 403, cookieState });
	const handler = await post.loadModule(new URL('../src/pods/subject-group/actions/subject-groups.ts', import.meta.url).href);
	const failed = await handler.handleCreateSubjectGroup(
		{ subject_id: subjectId, academic_group_id: groupId }, { cookies: post.cookies },
	);
	assert.equal(post.requests[0].method, 'POST');
	assert.equal(post.requests[0].responseStatus, 403);
	assert.deepEqual(JSON.parse(post.requests[0].body), { subject_id: subjectId, academic_group_id: groupId });
	const writesBeforeGet = [...post.writes];
	const refreshed = await evaluateRoute('', {
		status: 200, response: { items: [], limit: 50, offset: 0 }, actionResult: { data: failed },
		cookieState: post.cookieState,
	});
	assert.strictEqual(refreshed.cookieState, cookieState);
	assert.equal(refreshed.value.state, 'success');
	assert.deepEqual(refreshed.writes, writesBeforeGet);
	const form = await evaluateForm({ result: { data: failed } });
	assert.equal(form.submittedSubjectId, subjectId);
	assert.equal(form.submittedAcademicGroupId, groupId);
	assert.equal(form.feedback, failed.error);
	assert.equal(cookieState.token, 'u13-post-error-session');
});

test('manual UUID feedback retains identities and framework field recovery safely', async () => {
	const fresh = await evaluateRoute(`subject_id=${subjectId}`);
	assert.equal(fresh.value.recoveredSubjectId, '');
	assert.equal(fresh.value.recoveredAcademicGroupId, '');
	const freshForm = await evaluateForm({ subjectId: fresh.value.recoveredSubjectId, academicGroupId: fresh.value.recoveredAcademicGroupId });
	assert.equal(freshForm.submittedSubjectId, '');
	assert.equal(freshForm.submittedAcademicGroupId, '');
	const request = new Request('https://app.invalid/subject-groups', {
		method: 'POST', body: new URLSearchParams({ subject_id: 'invalid-input', academic_group_id: groupId }),
	});
	const frameworkError = await evaluateRoute('', {
		actionResult: { error: new ActionInputError([{ path: ['subject_id'], message: 'Invalid UUID' }]) }, request,
	});
	assert.equal(frameworkError.value.recoveredSubjectId, 'invalid-input');
	assert.equal(frameworkError.value.recoveredAcademicGroupId, groupId);
	const frameworkForm = await evaluateForm({
		result: frameworkError.value.actionResult,
		subjectId: frameworkError.value.recoveredSubjectId,
		academicGroupId: frameworkError.value.recoveredAcademicGroupId,
	});
	assert.equal(frameworkForm.fieldErrors.subject_id[0], 'Invalid UUID');
	assert.equal(frameworkForm.submittedSubjectId, 'invalid-input');
	assert.equal(frameworkForm.submittedAcademicGroupId, groupId);
});

test('manual association creation UI is present without catalog requests or GET draft recovery', async () => {
	const page = await readFile(new URL('../src/pages/subject-groups.astro', import.meta.url), 'utf8');
	const form = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupForm.astro', import.meta.url), 'utf8');
	assert.match(page, /<SubjectGroupForm/);
	assert.match(page, /listSubjects/);
	assert.doesNotMatch(page, /listGroups|draft_subject_id|draft_academic_group_id/);
	const filtered = await evaluateRoute(`limit=7&offset=14&subject_id=${subjectId}&_action=evil&redirect=https://evil.invalid`);
	assert.equal(filtered.value.actionUrl, `/subject-groups?_action=createSubjectGroup&limit=7&offset=14&subject_limit=50&subject_offset=0&subject_id=${subjectId}`);
	assert.doesNotMatch(filtered.value.actionUrl, /evil|redirect/);
	for (const query of [
		'limit=7&limit=8', 'limit=0', 'offset=10001',
		`subject_id=${subjectId}&subject_id=${groupId}`, 'subject_id=invalid',
	]) {
		const invalid = await evaluateRoute(query);
		assert.equal(invalid.value.actionUrl, '/subject-groups?_action=createSubjectGroup&limit=50&offset=0&subject_limit=50&subject_offset=0', query);
		assert.doesNotMatch(invalid.value.actionUrl, /evil|redirect/);
	}
	assert.match(form, /name="subject_id"/);
	assert.match(form, /name="academic_group_id"/);
	assert.match(form, /UUID de asignatura/);
	assert.match(form, /UUID de grupo académico/);
	assert.match(form, /data-subject-choice/);
	assert.match(form, /disabled value=\{visibleSubjects/);
	assert.match(form, /\{item\.name\} — \{item\.id\}/);
	assert.doesNotMatch(form, /name="subject-group-subject-choice"|data-group-choice|draft_/i);
});

test('subject-group route retains listing-only Spanish markup and excludes deferred UI', async () => {
	const source = (await readFile(new URL('../src/pages/subject-groups.astro', import.meta.url), 'utf8'));
	assert.match(source, /<SubjectGroupList/);
	assert.match(source, /<Layout>/);
	assert.match(source, /Grupos por asignatura/);
	assert.match(source, /Consultá las asociaciones registradas entre asignaturas y grupos académicos\./);
	assert.match(source, /<SubjectGroupForm/);
	assert.doesNotMatch(source, /listGroups|draft_/);
});
