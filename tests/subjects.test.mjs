import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const pagePath = 'src/pages/subjects.astro';
const formPath = 'src/pods/subject/components/SubjectForm.astro';
const handlerPath = 'src/pods/subject/actions/subjects.ts';
const componentPath = 'src/pods/subject/components/SubjectList.astro';
const component = await source(componentPath);

async function evaluate(path, options = {}) {
	let token = Object.hasOwn(options, 'token') ? options.token : 'operator-token';
	const writes = [];
	const requests = [];
	const localCookies = {
		get: (name) => name === 'session' && token ? { value: token } : undefined,
		set: (...args) => { writes.push(['set', ...args]); token = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); token = undefined; },
	};
	const cookies = options.cookies ?? localCookies;
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, atob,
		fetch: async (url, init) => {
			if (options.networkError) throw new Error('Offline');
			const response = options.responses?.shift();
			const responseStatus = response?.status ?? options.status ?? 200;
			requests.push({ url, ...init, responseStatus });
			return Response.json(response?.body ?? response ?? options.response ?? {
				items: [{ id: 'subject-1', name: 'Anatomía' }],
				limit: 50, offset: 0,
			}, { status: responseStatus });
		},
		Astro: {
			cookies,
			props: options.props ?? {},
			getActionResult: () => options.actionResult,
			url: new URL(options.url ?? 'https://frontend.invalid/subjects'),
			redirect: (location) => ({ redirect: location }),
		},
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
			if (specifier === 'astro:actions') return new vm.SyntheticModule(['actions'], function () { this.setExport('actions', { createSubject: '/_actions/createSubject' }); }, { context: sandbox });
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
		const returnValue = path === pagePath
			? '{ state, items, limit, previousOffset, nextOffset, invalidMessage, actionResult }'
			: '{ success, feedback }';
		code = `${imports.join('\n')}\nexport async function render() { ${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn ${returnValue}; }`;
	}
	const module = await compile(code, new URL(path, root).href);
	await module.evaluate();
	const value = path.endsWith('.astro') ? await module.namespace.render() : module.namespace;
	return { value, cookies, requests, writes };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('subjects page sends bounded pagination to authenticated backend and renders the returned page', async () => {
	const { value, requests, cookies, writes } = await evaluate(pagePath, {
		url: 'https://frontend.invalid/subjects?limit=2&offset=4',
		response: { items: [{ id: 's-1', name: 'Biología' }], limit: 2, offset: 4 },
	});
	assert.equal(value.state, 'success');
	assert.deepEqual(plain(value.items), [{ id: 's-1', name: 'Biología' }]);
	assert.equal(value.previousOffset, 2);
	assert.equal(value.nextOffset, null);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, 'https://backend.invalid/subjects?limit=2&offset=4');
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(cookies.get('session').value, 'operator-token');
	assert.deepEqual(writes, []);
});

test('missing session redirects and locally invalid or repeated pagination never calls backend', async () => {
	const unauthenticated = await evaluate(pagePath, { token: undefined });
	assert.deepEqual(unauthenticated.value, { redirect: '/auth/login?returnTo=%2Fsubjects' });
	assert.equal(unauthenticated.requests.length, 0);
	for (const query of ['?limit=0', '?offset=10001', '?limit=1&limit=2', '?offset=1.5']) {
		const { value, requests } = await evaluate(pagePath, { url: `https://frontend.invalid/subjects${query}` });
		assert.equal(value.state, 'invalid-pagination', query);
		assert.equal(requests.length, 0, query);
	}
});

test('empty first and later pages are independent, with return navigation and no false totals', async () => {
	for (const [query, expectedPrevious] of [['', null], ['?offset=10000&limit=50', 9950]]) {
		const { value, requests } = await evaluate(pagePath, {
			url: `https://frontend.invalid/subjects${query}`,
			response: { items: [], limit: query ? 50 : 50, offset: query ? 10000 : 0 },
		});
		assert.equal(value.state, 'success');
		assert.deepEqual(plain(value.items), []);
		assert.equal(value.previousOffset, expectedPrevious);
		assert.equal(value.nextOffset, null);
		assert.equal(requests.length, 1);
	}
	assert.match(component, /No hay asignaturas en esta página/);
	assert.doesNotMatch(component, /total(?:es)?\s*(?:de|:|=)/i);
});

test('backend denial and service failures remain distinct without clearing session', async () => {
	for (const [status, expected] of [[403, 'denied'], [500, 'failed']]) {
		const { value, cookies, writes } = await evaluate(pagePath, {
			status,
			response: { error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR', message: 'Backend response' } },
		});
		assert.equal(value.state, expected);
		assert.equal(cookies.get('session').value, 'operator-token');
		assert.deepEqual(writes, []);
	}
	const network = await evaluate(pagePath, { networkError: true });
	assert.equal(network.value.state, 'failed');
	assert.equal(network.cookies.get('session').value, 'operator-token');
	assert.deepEqual(network.writes, []);
});

test('backend 401 still clears the session through apiFetch and redirects to login', async () => {
	const { value, cookies, writes, requests } = await evaluate(pagePath, {
		status: 401,
		response: { error: { code: 'UNAUTHORIZED', message: 'Expired' } },
	});
	assert.deepEqual(value, { redirect: '/auth/login?returnTo=%2Fsubjects' });
	assert.equal(requests.length, 1);
	assert.equal(cookies.get('session'), undefined);
	assert.deepEqual(plain(writes), [['delete', 'session', { path: '/' }]]);
});

test('invalid backend payload becomes a failed state rather than an empty catalog', async () => {
	const { value, cookies, writes } = await evaluate(pagePath, {
		response: { items: [{ id: 'subject-1' }], limit: 50, offset: 0 },
	});
	assert.equal(value.state, 'failed');
	assert.equal(cookies.get('session').value, 'operator-token');
	assert.deepEqual(writes, []);
});

test('subject list provides distinct accessible feedback and bounded navigation links', () => {
	for (const text of [
		'No hay asignaturas en esta página', 'Sin permiso para consultar',
		'No se pudo cargar el catálogo', 'Paginación no válida',
	]) assert.ok(component.includes(text));
	assert.match(component, /Página anterior/);
	assert.match(component, /Página siguiente/);
	assert.match(component, /aria-label="Paginación de asignaturas"/);
	assert.match(component, /new URLSearchParams\(\{/);
	assert.match(component, /var\(--paper\)/);
	assert.match(component, /var\(--sage\)/);
});

test('subject creation trims and POSTs only the name with authenticated headers; duplicate names remain allowed', async () => {
	const subject = { id: 'subject-uuid', name: 'Anatomía', created_by: null, created_at: '2025-01-02T03:04:05.000Z' };
	for (let index = 0; index < 2; index += 1) {
		const evaluated = await evaluate(handlerPath, {
			response: subject,
			status: 201,
		});
		const result = await evaluated.value.handleCreateSubject({ name: '  Anatomía  ' }, { cookies: evaluated.cookies });
		assert.deepEqual(plain(result), { success: true, subject: { id: subject.id, name: subject.name } });
		assert.equal(evaluated.requests[0].url, 'https://backend.invalid/subjects');
		assert.equal(evaluated.requests[0].method, 'POST');
		assert.equal(evaluated.requests[0].responseStatus, 201);
		assert.equal(evaluated.requests[0].headers.Authorization, 'Bearer operator-token');
		assert.deepEqual(JSON.parse(evaluated.requests[0].body), { name: 'Anatomía' });
	}
});

test('blank and non-string subject names fail locally without a backend request', async () => {
	for (const name of ['', '   ', null, 12, {}]) {
		const evaluated = await evaluate(handlerPath);
		const result = await evaluated.value.handleCreateSubject({ name }, { cookies: evaluated.cookies });
		assert.equal(result.success, false);
		assert.match(result.error, /nombre/i);
		assert.equal(evaluated.requests.length, 0);
	}
});

test('create action reports safe feedback for 400, 401, 403, 500, and network failures', async () => {
	const cases = [
		[400, 'Revisá el nombre'],
		[401, 'sesión venció'],
		[403, 'no tiene permiso'],
		[500, 'No se pudo crear'],
	];
	for (const [status, message] of cases) {
		const evaluated = await evaluate(handlerPath, {
			status,
			response: { error: { code: 'BACKEND_DETAIL', message: 'unsafe backend detail' } },
		});
		const result = await evaluated.value.handleCreateSubject({ name: 'Física' }, { cookies: evaluated.cookies });
		assert.equal(result.success, false);
		assert.match(result.error, new RegExp(message, 'i'));
		assert.doesNotMatch(result.error, /unsafe backend detail|HTTP 500/);
		assert.equal(evaluated.cookies.get('session')?.value, status === 401 ? undefined : 'operator-token');
	}
	const network = await evaluate(handlerPath, { networkError: true });
	const result = await network.value.handleCreateSubject({ name: 'Física' }, { cookies: network.cookies });
	assert.equal(result.success, false);
	assert.match(result.error, /conectar/i);
	assert.equal(network.cookies.get('session').value, 'operator-token');
});

test('framework and handler errors both produce visible accessible form feedback', async () => {
	const framework = await evaluate(formPath, { props: { result: { error: { message: 'Nombre inválido' } } } });
	assert.equal(framework.value.feedback, 'Nombre inválido');
	const handler = await evaluate(formPath, { props: { result: { data: { success: false, error: 'Sin permiso' } } } });
	assert.equal(handler.value.feedback, 'Sin permiso');
	const formSource = await source(formPath);
	assert.match(formSource, /result\?\.error\?\.message \?\? result\?\.data\?\.error/);
	assert.match(formSource, /role="alert"/);
});

test('POST success identity survives list 403 and 500 through page and form frontmatter with shared cookies', async () => {
	const created = { id: 'subject-uuid', name: 'Química', created_by: 'user-1', created_at: '2025-01-02T03:04:05.000Z' };
	const action = await evaluate(handlerPath, { response: created, status: 201 });
	const actionData = await action.value.handleCreateSubject({ name: 'Química' }, { cookies: action.cookies });
	assert.equal(actionData.success, true);
	assert.equal(action.requests[0].url, 'https://backend.invalid/subjects');
	assert.equal(action.requests[0].method, 'POST');
	assert.equal(action.requests[0].responseStatus, 201);
	assert.equal(action.cookies.get('session').value, 'operator-token');
	for (const status of [403, 500]) {
		const actionResult = { data: actionData };
		const page = await evaluate(pagePath, {
			cookies: action.cookies,
			actionResult,
			status,
			response: { error: { code: 'DENIED', message: 'List unavailable' } },
		});
		assert.equal(page.value.state, status === 403 ? 'denied' : 'failed');
		assert.equal(page.value.actionResult, actionResult);
		assert.equal(page.cookies.get('session').value, 'operator-token');
		assert.equal(page.requests.length, 1);
		assert.equal(page.requests[0].method, 'GET');
		assert.equal(page.requests[0].responseStatus, status);
		const form = await evaluate(formPath, { props: { result: page.value.actionResult } });
		assert.equal(form.value.success.id, created.id);
		assert.equal(form.value.success.name, created.name);
		assert.equal(form.value.feedback, undefined);
	}
	const pageSource = await source(pagePath);
	assert.match(pageSource, /Astro\.getActionResult\(actions\.createSubject\)/);
	assert.match(pageSource, /<SubjectForm result=\{actionResult\}/);
});
