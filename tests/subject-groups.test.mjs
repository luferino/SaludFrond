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
			const isGroupCatalog = endpoint === '/groups' && !isPost;
			const status = isPost ? (options.postStatus ?? 201)
				: isSubjectCatalog ? (options.subjectStatus ?? options.status ?? 200)
					: isGroupCatalog ? (options.groupStatus ?? options.status ?? 200)
						: (options.associationStatus ?? options.status ?? 200);
			requests.push({ url, ...init, responseStatus: status });
			if (options.networkError || (isSubjectCatalog && options.subjectNetworkError) || (isGroupCatalog && options.groupNetworkError) || (!isSubjectCatalog && !isGroupCatalog && !isPost && options.associationNetworkError)) throw new Error('Offline');
			const params = new URL(url).searchParams;
			const response = isPost ? (options.postResponse ?? association()) : isSubjectCatalog
				? options.subjectResponse ?? (status >= 400
					? { error: { code: status === 401 ? 'UNAUTHORIZED' : 'DENIED', message: 'Request failed' } }
					: { items: [], limit: Number(params.get('limit')), offset: Number(params.get('offset')) })
				: isGroupCatalog ? options.groupResponse ?? (status >= 400
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
	const output = ts.transpileModule(`${code}\nreturn { fieldErrors, feedback, success, submittedSubjectId, submittedAcademicGroupId, visibleSubjects, visibleGroups: groups, subjectCatalogState, subjectCatalogMessage, hasSubmittedGroup, groupCatalogState, groupCatalogMessage, groupLimit, groupOffset, groupPreviousHref, groupNextHref, actionUrl: String(actionUrl ?? actions.createSubjectGroup) };`, {
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

async function runSubjectSelectorScript({ withInput = true, withGroupInput = true } = {}) {
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
	let groupListener;
	const groupChoice = { value: groupId, disabled: true, addEventListener: (name, callback) => { assert.equal(name, 'change'); assert.equal(groupChoice.disabled, true); groupListener = callback; } };
	const form = { querySelector: (selector) => selector.includes('subject-choice') ? choice : selector.includes('group-choice') ? groupChoice : selector.includes('subject_id') ? (withInput ? subject : null) : (withGroupInput ? group : null) };
	const root = { querySelector: (selector) => selector === 'form' ? form : selector.includes('subject-choice') ? choice : selector.includes('group-choice') ? groupChoice : selector.includes('subject_id') ? (withInput ? subject : null) : (withGroupInput ? group : null), querySelectorAll: () => [] };
	const context = vm.createContext({ document: { querySelector: () => root } });
	const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	new vm.Script(code).runInContext(context);
	return { subject, group, choice, groupChoice, get listener() { return listener; }, get groupListener() { return groupListener; } };
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
	const output = ts.transpileModule(`${code}\nreturn { state, items, limit, offset, subjectId, previousHref, nextHref, invalidMessage, actionUrl, actionResult, recoveredSubjectId, recoveredAcademicGroupId, subjectCatalogState, subjects, subjectLimit, subjectOffset, subjectPreviousHref, subjectNextHref, subjectCatalogMessage, groupCatalogState, groups, groupLimit, groupOffset, groupPreviousHref, groupNextHref, groupCatalogMessage, subjectNavigation: { previous: subjectPreviousHref, next: subjectNextHref }, groupNavigation: { previous: groupPreviousHref, next: groupNextHref } };`, {
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
		['https://backend.invalid/subject-groups?limit=7&offset=14', 'GET'],
		['https://backend.invalid/subjects?limit=2&offset=2', 'GET'],
		['https://backend.invalid/groups?limit=50&offset=0', 'GET'],
	]);
	assert.equal(result.requests.find(({ url }) => new URL(url).pathname === '/subject-groups').headers.Authorization, 'Bearer operator-token');
	assert.deepEqual(result.writes, []);

	for (const query of ['subject_limit=1&subject_limit=2', 'subject_offset=1&subject_offset=2', 'subject_limit=0', 'subject_offset=10001']) {
		const invalid = await evaluateRoute(query);
		assert.equal(invalid.value.subjectCatalogState, 'invalid-pagination', query);
		assert.deepEqual(invalid.requests.map(({ url }) => new URL(url).pathname), ['/subject-groups', '/groups'], 'invalid subject pagination skips only its own GET');
		assert.equal(invalid.requests[0].url, 'https://backend.invalid/subject-groups?limit=50&offset=0');
		assert.equal(invalid.value.actionUrl, '/subject-groups?_action=createSubjectGroup&limit=50&offset=0&subject_limit=50&subject_offset=0&group_limit=50&group_offset=0');
	}
	const invalidAssociation = await evaluateRoute('limit=1&limit=2&subject_limit=3');
	assert.equal(invalidAssociation.value.state, 'invalid-pagination');
	assert.deepEqual(invalidAssociation.requests.map(({ url }) => new URL(url).pathname), ['/subjects', '/groups']);
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
		assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), ['/subject-groups', '/subjects', '/groups']);
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const empty = await evaluateRoute('', { subjectResponse: { items: [], limit: 50, offset: 0 } });
	assert.deepEqual(plain(empty.value.subjects), []);
});

test('route evaluator records the real authenticated GET and cookie lifecycle', async () => {
	const result = await evaluateRoute();
	assert.equal(result.requests.length, 3);
	const associationRequest = result.requests.find(({ url }) => new URL(url).pathname === '/subject-groups');
	assert.equal(associationRequest.url, 'https://backend.invalid/subject-groups?limit=50&offset=0');
	assert.equal(associationRequest.method, 'GET');
	assert.equal(associationRequest.headers.Authorization, 'Bearer operator-token');
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
	assert.equal(result.requests.length, 3);
	const associationRequest = result.requests.find(({ url }) => new URL(url).pathname === '/subject-groups');
	assert.equal(associationRequest.url, `https://backend.invalid/subject-groups?limit=2&offset=2&subject_id=${uppercaseId}`);
	assert.equal(associationRequest.headers.Authorization, 'Bearer operator-token');
	assert.equal(result.value.previousHref, `/subject-groups?limit=2&offset=0&subject_id=${uppercaseId}`);
	assert.equal(result.value.nextHref, `/subject-groups?limit=2&offset=4&subject_id=${uppercaseId}`);
});

test('real pagination and filter helpers reject invalid, fractional, blank and repeated values before fetching', async () => {
	for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=', 'limit=1&limit=2', 'offset=-1', 'offset=10001', 'offset=1.5', 'offset=', 'offset=1&offset=2', 'subject_id=', 'subject_id=bad', `subject_id=${subjectId}&subject_id=${groupId}`]) {
		const result = await evaluateRoute(query);
		assert.ok(['invalid-pagination', 'invalid-filter'].includes(result.value.state), query);
		const invalidSubjectPagination = /subject_(?:limit|offset)/.test(query);
		assert.equal(result.requests.length, 2, query);
		assert.equal(new URL(result.requests.at(-1).url).pathname, '/groups', query);
		if (!invalidSubjectPagination) assert.ok(result.requests.some(({ url }) => new URL(url).pathname === '/subjects'), query);
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
		assert.equal(result.requests.length, 3);
		assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), ['/subject-groups', '/subjects', '/groups']);
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const unauthorized = await evaluateRoute('', { status: 401 });
	assert.deepEqual(unauthorized.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.equal(unauthorized.requests.length, 1);
	assert.equal(new URL(unauthorized.requests[0].url).pathname, '/subject-groups');
	assert.equal(unauthorized.cookieState.token, undefined);
	assert.deepEqual(plain(unauthorized.writes), [['delete', 'session', { path: '/' }]]);
});

test('association 401 clears the session after an independent successful subject catalog GET', async () => {
	const result = await evaluateRoute('', { subjectStatus: 200, associationStatus: 401 });
	assert.deepEqual(result.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.deepEqual(result.requests.map(({ url, responseStatus }) => [new URL(url).pathname, responseStatus]), [
		['/subject-groups', 401],
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
			['/subject-groups', status], ['/subjects', status], ['/groups', status],
		]);
		assert.equal(refreshed.value.subjectCatalogState, status === 403 ? 'denied' : 'failed');
		assert.equal(refreshed.value.groupCatalogState, status === 403 ? 'denied' : 'failed');
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
	assert.equal(unbound.group.value, 'manual-group');
	const unboundGroup = await runSubjectSelectorScript({ withGroupInput: false });
	assert.equal(unboundGroup.groupChoice.disabled, true);
	assert.equal(unboundGroup.groupListener, undefined);
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
	assert.match(page, /listGroups/);
	const filtered = await evaluateRoute(`limit=7&offset=14&subject_id=${subjectId}&_action=evil&redirect=https://evil.invalid`);
	assert.equal(filtered.value.actionUrl, `/subject-groups?_action=createSubjectGroup&limit=7&offset=14&subject_id=${subjectId}&subject_limit=50&subject_offset=0&group_limit=50&group_offset=0`);
	assert.doesNotMatch(filtered.value.actionUrl, /evil|redirect/);
	for (const query of [
		'limit=7&limit=8', 'limit=0', 'offset=10001',
		`subject_id=${subjectId}&subject_id=${groupId}`, 'subject_id=invalid',
	]) {
		const invalid = await evaluateRoute(query);
		assert.equal(invalid.value.actionUrl, '/subject-groups?_action=createSubjectGroup&limit=50&offset=0&subject_limit=50&subject_offset=0&group_limit=50&group_offset=0', query);
		assert.doesNotMatch(invalid.value.actionUrl, /evil|redirect/);
	}
	assert.match(form, /name="subject_id"/);
	assert.match(form, /name="academic_group_id"/);
	assert.match(form, /UUID de asignatura/);
	assert.match(form, /UUID de grupo académico/);
	assert.match(form, /data-subject-choice/);
	assert.match(form, /disabled value=\{visibleSubjects/);
	assert.match(form, /\{item\.name\} — \{item\.id\}/);
	assert.doesNotMatch(form, /name="subject-group-subject-choice"|name="draft_/i);
	assert.match(form, /data-group-choice/);
});

test('subject-group route retains listing-only Spanish markup and excludes deferred UI', async () => {
	const source = (await readFile(new URL('../src/pages/subject-groups.astro', import.meta.url), 'utf8'));
	assert.match(source, /<SubjectGroupList/);
	assert.match(source, /<Layout>/);
	assert.match(source, /Grupos por asignatura/);
	assert.match(source, /Consultá las asociaciones registradas entre asignaturas y grupos académicos\./);
	assert.match(source, /<SubjectGroupForm/);
	assert.match(source, /listGroups/);
});

test('GET drafts recover one value per UUID and pagination preserves both draft values', async () => {
	const query = `limit=7&offset=14&subject_id=${subjectId}&subject_limit=2&subject_offset=2&draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}&_action=evil&redirect=https://evil.invalid`;
	const result = await evaluateRoute(query, { subjectResponse: { items: [{ id: subjectId, name: 'A' }, { id: groupId, name: 'B' }], limit: 2, offset: 2 }, request: new Request(`https://app.invalid/subject-groups?${query}`) });
	assert.deepEqual([result.value.recoveredSubjectId, result.value.recoveredAcademicGroupId], [creatorId, groupId]);
	assert.deepEqual(plain(result.value.subjectNavigation), {
		previous: `/subject-groups?limit=7&offset=14&subject_limit=2&subject_offset=0&group_limit=50&group_offset=0&subject_id=${subjectId}&draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}`,
		next: `/subject-groups?limit=7&offset=14&subject_limit=2&subject_offset=4&group_limit=50&group_offset=0&subject_id=${subjectId}&draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}`,
	});
	assert.equal(result.value.actionUrl, `/subject-groups?_action=createSubjectGroup&limit=7&offset=14&subject_id=${subjectId}&subject_limit=2&subject_offset=2&group_limit=50&group_offset=0`);
	assert.doesNotMatch(result.value.actionUrl, /draft_|evil|redirect/);
	for (const [drafts, expected] of [
		[`draft_subject_id=${creatorId}&draft_subject_id=${groupId}`, ['', '']],
		['draft_subject_id=&draft_academic_group_id=bad%ZZ', ['', 'bad%ZZ']],
		[`draft_subject_id=${creatorId}`, [creatorId, '']],
	]) {
		const parsed = await evaluateRoute(drafts, { request: new Request(`https://app.invalid/subject-groups?${drafts}`) });
		assert.deepEqual([parsed.value.recoveredSubjectId, parsed.value.recoveredAcademicGroupId], expected, drafts);
	}
});

test('drafts are GET-only and action results take precedence over query drafts', async () => {
	const body = new URLSearchParams({ draft_subject_id: creatorId, draft_academic_group_id: groupId });
	const post = await evaluateRoute('', { request: new Request('https://app.invalid/subject-groups', { method: 'POST', body }), actionResult: null });
	assert.deepEqual([post.value.recoveredSubjectId, post.value.recoveredAcademicGroupId], ['', '']);
	const result = { data: { success: true, subjectId, academicGroupId: groupId } };
	const precedence = await evaluateRoute(`draft_subject_id=${creatorId}&draft_academic_group_id=${creatorId}`, {
		actionResult: result, request: new Request(`https://app.invalid/subject-groups?draft_subject_id=${creatorId}&draft_academic_group_id=${creatorId}`),
	});
	assert.deepEqual([precedence.value.recoveredSubjectId, precedence.value.recoveredAcademicGroupId], [subjectId, groupId]);
	const framework = await evaluateRoute(`draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}`, {
		actionResult: { error: new ActionInputError([{ path: ['subject_id'], message: 'Invalid UUID' }]) },
		request: new Request(`https://app.invalid/subject-groups?draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}`, {
			method: 'POST', body: new URLSearchParams({ subject_id: 'invalid', academic_group_id: groupId }),
		}),
	});
	assert.deepEqual([framework.value.recoveredSubjectId, framework.value.recoveredAcademicGroupId], ['invalid', groupId]);
});

test('catalog navigation remains safe without JavaScript and binds controls outside the form', async () => {
	const formSource = await readFile(new URL('../src/pods/subject-group/components/SubjectGroupForm.astro', import.meta.url), 'utf8');
	assert.match(formSource, /<button type="button" data-catalog-kind="subject" data-catalog-offset=.*disabled>Asignaturas anteriores/);
	assert.match(formSource, /<button type="button" data-catalog-kind="subject" data-catalog-offset=.*disabled>Más asignaturas/);
	assert.match(formSource, /<button type="button" data-catalog-kind="group" data-catalog-offset=.*disabled>Grupos anteriores/);
	assert.match(formSource, /<button type="button" data-catalog-kind="group" data-catalog-offset=.*disabled>Más grupos académicos/);
	assert.match(formSource, /<noscript>/);
	assert.match(formSource, /disabled value=\{visibleSubjects/);
	const formMarkup = formSource.match(/<form[\s\S]*?<\/form>/)?.[0];
	assert.ok(formMarkup, 'selectors and UUID inputs are in the form');
	assert.match(formMarkup, /data-subject-choice/);
	assert.match(formMarkup, /data-group-choice/);
	assert.ok(formSource.indexOf('</form>') < formSource.indexOf('Páginas del catálogo de asignaturas'), 'catalog navigation controls are siblings outside the form');
	assert.ok(formSource.indexOf('</form>') < formSource.indexOf('Páginas del catálogo de grupos académicos'), 'group navigation controls are siblings outside the form');
	const source = formSource.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
	assert.ok(source);
	assert.doesNotMatch(source, /\bhistory\./, 'catalog navigation does not mutate browser history');
	const listeners = [];
	const subject = { value: 'manual-subject' };
	const group = { value: 'manual-group' };
	const choice = { value: subjectId, disabled: true, addEventListener: (event, callback) => { assert.equal(event, 'change'); assert.equal(choice.disabled, true); listeners.push(callback); } };
	const groupChoice = { value: groupId, disabled: true, addEventListener: (event, callback) => { assert.equal(event, 'change'); assert.equal(groupChoice.disabled, true); listeners.push(callback); } };
	const form = { dataset: { listLimit: '7', listOffset: '14', listSubjectId: subjectId, subjectLimit: '2', subjectOffset: '2', groupLimit: '3', groupOffset: '6' }, querySelector: (selector) => selector.includes('subject-choice') ? choice : selector.includes('group-choice') ? groupChoice : selector.includes('subject_id') ? subject : group };
	let navigated;
	const button = { dataset: { catalogKind: 'subject', catalogOffset: '4' }, disabled: true, addEventListener: (event, callback) => { assert.equal(event, 'click'); assert.equal(button.disabled, true); listeners.push(callback); } };
	const root = { querySelector: (selector) => selector === 'form' ? form : selector.includes('subject-choice') ? choice : selector.includes('group-choice') ? groupChoice : selector.includes('subject_id') ? subject : group, querySelectorAll: () => [button] };
	const context = vm.createContext({ document: { querySelector: () => root }, URLSearchParams, URL, window: { location: { origin: 'https://app.invalid', assign: (href) => { navigated = href; } } } });
	new vm.Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(context);
	assert.equal(choice.disabled, false);
	assert.equal(groupChoice.disabled, false);
	assert.equal(typeof listeners[2], 'function');
	choice.value = creatorId;
	listeners[0]();
	assert.equal(subject.value, creatorId);
	groupChoice.value = subjectId;
	listeners[1]();
	assert.equal(group.value, subjectId);
	assert.equal(subject.value, creatorId);
	listeners[2]();
	const url = new URL(navigated);
	assert.equal(url.origin, 'https://app.invalid');
	assert.deepEqual([...url.searchParams], [
		['limit', '7'], ['offset', '14'], ['subject_limit', '2'], ['subject_offset', '4'],
		['group_limit', '3'], ['group_offset', '6'], ['subject_id', subjectId],
		['draft_subject_id', creatorId], ['draft_academic_group_id', subjectId],
	]);
	button.dataset.catalogKind = 'group';
	button.dataset.catalogOffset = '9';
	listeners[2]();
	const groupUrl = new URL(navigated);
	assert.equal(groupUrl.searchParams.get('subject_offset'), '2', 'group navigation retains subject pagination');
	assert.equal(groupUrl.searchParams.get('group_offset'), '9', 'group navigation changes only group pagination');
	assert.equal(groupUrl.searchParams.get('draft_subject_id'), creatorId);
	assert.equal(groupUrl.searchParams.get('draft_academic_group_id'), subjectId);
});

test('group catalog uses independent bounded pagination, authenticated GET, labels and paired navigation', async () => {
	const group = { id: groupId, academic_year: 2025, curriculum_semester: 3, name: 'Neurociencias' };
	const query = `limit=7&offset=14&subject_id=${subjectId}&subject_limit=2&subject_offset=4&group_limit=3&group_offset=3&draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}&_action=bad&redirect=bad`;
	const result = await evaluateRoute(query, {
		groupResponse: { items: [group, { ...group, id: creatorId }, { ...group, id: subjectId }], limit: 3, offset: 3 },
		subjectResponse: { items: [], limit: 2, offset: 4 },
		response: { items: [], limit: 7, offset: 14 },
	});
	assert.equal(result.value.groupCatalogState, 'success');
	assert.deepEqual(plain(result.value.groups), [group, { ...group, id: creatorId }, { ...group, id: subjectId }]);
	assert.deepEqual(result.requests.map(({ url, method, responseStatus }) => [new URL(url).pathname, new URL(url).search, method, responseStatus]), [
		['/subject-groups', `?limit=7&offset=14&subject_id=${subjectId}`, 'GET', 200],
		['/subjects', '?limit=2&offset=4', 'GET', 200],
		['/groups', '?limit=3&offset=3', 'GET', 200],
	]);
	for (const request of result.requests) {
		assert.equal(request.method, 'GET');
		assert.equal(request.responseStatus, 200);
		assert.equal(request.headers.Authorization, 'Bearer operator-token');
		assert.equal(request.headers['Content-Type'], 'application/json');
	}
	assert.equal(result.cookieState.token, 'operator-token');
	assert.deepEqual(result.writes, []);
	assert.deepEqual(plain(result.value.groupNavigation), {
		previous: `/subject-groups?limit=7&offset=14&subject_limit=2&subject_offset=4&group_limit=3&group_offset=0&subject_id=${subjectId}&draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}`,
		next: `/subject-groups?limit=7&offset=14&subject_limit=2&subject_offset=4&group_limit=3&group_offset=6&subject_id=${subjectId}&draft_subject_id=${creatorId}&draft_academic_group_id=${groupId}`,
	});
	assert.equal(result.value.actionUrl, `/subject-groups?_action=createSubjectGroup&limit=7&offset=14&subject_id=${subjectId}&subject_limit=2&subject_offset=4&group_limit=3&group_offset=3`);
	assert.doesNotMatch(result.value.actionUrl, /draft_|redirect|bad/);
});

test('group pagination rejects blank, repeated and out-of-bounds values without skipping other catalog GETs', async () => {
	for (const query of ['group_limit=', 'group_limit=1&group_limit=2', 'group_limit=0', 'group_limit=101', 'group_limit=1.5', 'group_offset=', 'group_offset=1&group_offset=2', 'group_offset=-1', 'group_offset=10001', 'group_offset=1.5']) {
		const result = await evaluateRoute(query);
		assert.equal(result.value.groupCatalogState, 'invalid-pagination', query);
		assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), ['/subject-groups', '/subjects'], query);
		assert.equal(result.value.groupLimit, 50, query);
		assert.equal(result.value.groupOffset, 0, query);
	}
});

test('group catalog accepts minimum and maximum page coordinates without navigation beyond the cap', async () => {
	for (const [limit, offset] of [[1, 0], [100, 10000]]) {
		const group = { id: groupId, academic_year: 2025, curriculum_semester: 3, name: 'Neurociencias' };
		const result = await evaluateRoute(`group_limit=${limit}&group_offset=${offset}`, {
			groupResponse: { items: Array.from({ length: limit }, () => group), limit, offset },
		});
		assert.equal(result.value.groupCatalogState, 'success');
		assert.equal(result.requests.find(({ url }) => new URL(url).pathname === '/groups').url,
			`https://backend.invalid/groups?limit=${limit}&offset=${offset}`);
		assert.equal(result.value.groupNextHref === null, offset === 10000);
		assert.equal(result.value.groupPreviousHref === null, offset === 0);
	}
});

test('group catalog errors and 401 remain independent of association and subject reads', async () => {
	for (const [options, expected] of [[{ groupStatus: 403 }, 'denied'], [{ groupStatus: 500 }, 'failed'], [{ groupNetworkError: true }, 'failed'], [{ groupResponse: { items: [{ ...association(), academic_year: 2025 }], limit: 50, offset: 0 } }, 'failed']]) {
		const result = await evaluateRoute('', options);
		assert.equal(result.value.state, 'success');
		assert.equal(result.value.subjectCatalogState, 'success');
		assert.equal(result.value.groupCatalogState, expected);
		assert.deepEqual(result.requests.map(({ url }) => new URL(url).pathname), ['/subject-groups', '/subjects', '/groups']);
		assert.equal(result.cookieState.token, 'operator-token');
		assert.deepEqual(result.writes, []);
	}
	const unauthorized = await evaluateRoute('', { groupStatus: 401 });
	assert.deepEqual(unauthorized.value, { redirected: '/auth/login?returnTo=%2Fsubject-groups' });
	assert.deepEqual(unauthorized.requests.map(({ url, responseStatus, method, headers }) => [new URL(url).pathname, responseStatus, method, headers.Authorization]), [
		['/subject-groups', 200, 'GET', 'Bearer operator-token'],
		['/subjects', 200, 'GET', 'Bearer operator-token'],
		['/groups', 401, 'GET', 'Bearer operator-token'],
	]);
	assert.equal(unauthorized.cookieState.token, undefined);
	assert.deepEqual(plain(unauthorized.writes), [['delete', 'session', { path: '/' }]]);
});

test('group selector preserves exactly one selected option for empty, on-page and off-page identities', async () => {
	const group = { id: groupId, academic_year: 2025, curriculum_semester: 3, name: 'Neurociencias' };
	const form = await evaluateForm({ groups: [group], groupCatalogState: 'success', academicGroupId: groupId });
	assert.equal(form.hasSubmittedGroup, true);
	assert.deepEqual(plain(form.visibleGroups), [group]);
	const source = form.source;
	assert.match(source, /\{!hasSubmittedGroup && submittedAcademicGroupId && <option value=\{submittedAcademicGroupId\} selected>/);
	assert.match(source, /\{groups\.map\(\(item\) => <option value=\{item\.id\} selected=\{item\.id === submittedAcademicGroupId\}/);
	assert.match(source, /\{item\.academic_year\} — \{item\.curriculum_semester\} — \{item\.name\} — \{item\.id\}/);
	const offPage = await evaluateForm({ groups: [group], groupCatalogState: 'success', academicGroupId: creatorId });
	assert.equal(offPage.hasSubmittedGroup, false);
	assert.deepEqual(plain(offPage.visibleGroups), [group]);
	assert.match(offPage.source, /Grupo seleccionado fuera de esta página/);
	assert.match(source, /<option value="" selected=\{!submittedAcademicGroupId\}>Elegir grupo académico…/);
	for (const [submitted, expected] of [['', 1], [groupId, 1], [creatorId, 1]]) {
		const state = await evaluateForm({ groups: [group], groupCatalogState: 'success', academicGroupId: submitted });
		const selectedCount = Number(!state.submittedAcademicGroupId)
			+ Number(!state.hasSubmittedGroup && Boolean(state.submittedAcademicGroupId))
			+ state.visibleGroups.filter((item) => item.id === state.submittedAcademicGroupId).length;
		assert.equal(selectedCount, expected, `one selected option for ${submitted || 'empty'} group UUID`);
	}
});
