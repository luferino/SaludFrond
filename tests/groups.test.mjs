import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'astro/zod';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/group/api.ts';
const actionPath = 'src/pods/group/actions/groups.ts';
const formPath = 'src/pods/group/components/GroupForm.astro';
const registryPath = 'src/actions/index.ts';
const pagePath = 'src/pages/groups.astro';
const componentPath = 'src/pods/group/components/GroupList.astro';
const source = (path) => readFile(new URL(path, root), 'utf8');
const sample = (overrides = {}) => ({
	id: 'group-1', academic_year: 2025, curriculum_semester: 3, name: 'Cohorte Norte', ...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

async function evaluate(path, options = {}) {
	const cookieState = options.cookieState ?? { value: Object.hasOwn(options, 'token') ? options.token : 'operator-token' };
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
			if (options.networkError) throw new Error('Offline');
			const response = options.responses?.shift();
			const status = response?.status ?? options.status ?? 200;
			requests.push({ url, ...init, responseStatus: status });
			return Response.json(response?.body ?? response ?? options.response ?? { items: [sample()], limit: 50, offset: 0 }, { status });
		},
		Astro: {
			cookies,
			props: {},
			url: new URL(options.url ?? 'https://frontend.invalid/groups'),
			getActionResult: () => options.actionResult,
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
			if (specifier === 'astro:actions') return new vm.SyntheticModule(['actions', 'isInputError'], function () {
				this.setExport('actions', { createGroup: 'createGroup' });
				this.setExport('isInputError', (error) => Boolean(error?.fields));
			}, { context: sandbox });
			if (specifier.endsWith('.astro') || specifier.endsWith('.css')) return new vm.SyntheticModule([], function () {}, { context: sandbox });
			const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
			return compile(await readFile(resolved, 'utf8'), resolved.href);
		});
		return module;
	}
	let code = await source(path);
	if (path.endsWith('.astro')) {
		const frontmatter = code.split('---')[1].replace(/^export const prerender[^\n]*\n/m, '');
		const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
		code = `${imports.join('\n')}\nexport async function render() { ${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn { state, items, limit, previousOffset, nextOffset, invalidMessage, actionResult }; }`;
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

async function evaluateForm(actionResult) {
	const code = await source(formPath);
	const frontmatter = code.split('---')[1];
	const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
	const body = `${imports.join('\n')}\nexport function render() { ${frontmatter.replace(/^import .*;\r?$/gm, '')}\nreturn { success, frameworkError, fieldErrors, feedback }; }`;
	const output = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
	const sandbox = vm.createContext({ Astro: { props: { result: actionResult } } });
	const module = new vm.SourceTextModule(output, { context: sandbox, identifier: new URL(formPath, root).href });
	await module.link(async () => new vm.SyntheticModule(['actions', 'isInputError'], function () {
		this.setExport('actions', { createGroup: 'createGroup' });
		this.setExport('isInputError', (error) => Boolean(error?.fields));
	}, { context: sandbox }));
	await module.evaluate();
	return module.namespace.render();
}

async function evaluateRegistry() {
	const names = {
		'astro:actions': ['defineAction'],
		'astro/zod': ['z'],
		'../pods/auth/actions': ['handleLogin', 'handleLogout', 'handleRegister', 'handleForgotPassword', 'handleResetPassword'],
		'../pods/subject/actions/subjects': ['handleCreateSubject'],
		'../pods/group/actions/groups': ['handleCreateGroup'],
		'../pods/subject-group/actions/subject-groups': ['handleCreateSubjectGroup'],
		'../pods/student/actions/students': ['handleCreateStudent'],
		'../pods/teacher/actions/teachers': ['handleCreateTeacher'],
		'../pods/paciente/actions/patients': ['handleCreatePatient'],
		'../pods/teacher-habilitation/actions': ['activateTeacherHabilitation', 'revokeTeacherHabilitation'],
		'../pods/student-habilitation/actions': ['activateStudentHabilitation', 'revokeStudentHabilitation'],
	};
	const sandbox = vm.createContext({});
	const code = await source(registryPath);
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
	const module = new vm.SourceTextModule(output, { context: sandbox, identifier: new URL(registryPath, root).href });
	await module.link(async (specifier) => new vm.SyntheticModule(names[specifier], function () {
		for (const name of names[specifier]) this.setExport(name, name === 'z' ? z : name === 'defineAction' ? (definition) => definition : () => undefined);
	}, { context: sandbox }));
	await module.evaluate();
	return module.namespace.server.createGroup;
}

const pagination = { limit: 7, offset: 14 };

test('createGroup posts exactly the trimmed three-field payload with bearer auth and preserves cookies', async () => {
	const created = {
		id: 'group-201', academic_year: 2026, curriculum_semester: 8, name: 'Trayecto Norte',
		created_by: 'backend-user', created_at: '2026-02-01T12:00:00Z',
	};
	const result = await evaluate(actionPath, { status: 201, response: created });
	const group = await result.value.handleCreateGroup({
		academic_year: 2026, curriculum_semester: 8, name: '  Trayecto Norte  ',
	}, { cookies: result.cookies });
	assert.deepEqual(plain(group), { success: true, group: created });
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, 'https://backend.invalid/groups');
	assert.equal(result.requests[0].method, 'POST');
	assert.equal(result.requests[0].responseStatus, 201);
	assert.equal(result.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.requests[0].headers['Content-Type'], 'application/json');
	assert.deepEqual(JSON.parse(result.requests[0].body), {
		academic_year: 2026, curriculum_semester: 8, name: 'Trayecto Norte',
	});
	assert.deepEqual(Object.keys(JSON.parse(result.requests[0].body)).sort(), ['academic_year', 'curriculum_semester', 'name']);
	assert.equal(result.cookieState.value, 'operator-token');
	assert.deepEqual(result.writes, []);
});

test('registered group schema preprocesses form values and enforces positive int32', async () => {
	const action = await evaluateRegistry();
	const schema = action.input;
	assert.deepEqual(plain(schema.parse({ academic_year: '2025', curriculum_semester: '8', name: '  Nombre  ' })), {
		academic_year: 2025, curriculum_semester: 8, name: 'Nombre',
	});
	assert.deepEqual(plain(schema.parse({ academic_year: '2147483647', curriculum_semester: '2147483647', name: ' Grupo ' })), {
		academic_year: 2_147_483_647, curriculum_semester: 2_147_483_647, name: 'Grupo',
	});
	for (const invalid of ['', undefined, 'abc', '0', '-1', '1.5', '2147483648']) {
		assert.equal(schema.safeParse({ academic_year: invalid, curriculum_semester: '8', name: 'Grupo' }).success, false);
		assert.equal(schema.safeParse({ academic_year: '2025', curriculum_semester: invalid, name: 'Grupo' }).success, false);
	}
	assert.equal(schema.safeParse({ academic_year: '2025', curriculum_semester: '8', name: '  ' }).success, false);
});

test('create handler rejects invalid values before requests and maps backend outcomes safely', async () => {
	const invalid = await evaluate(actionPath);
	for (const value of [undefined, null, '', '8', 'abc', 0, -1, 1.5, 2_147_483_648, NaN]) {
		for (const field of ['academic_year', 'curriculum_semester']) {
			const input = { academic_year: 2025, curriculum_semester: 8, name: 'Grupo', [field]: value };
			const response = await invalid.value.handleCreateGroup(input, { cookies: invalid.cookies });
			assert.equal(response.success, false, `${field}: ${String(value)}`);
		}
	}
	for (const name of [undefined, null, '', '   ', 42]) {
		const response = await invalid.value.handleCreateGroup({ academic_year: 2025, curriculum_semester: 8, name }, { cookies: invalid.cookies });
		assert.equal(response.success, false, `name: ${String(name)}`);
	}
	assert.equal(invalid.requests.length, 0);
	for (const [status, phrase, clears] of [
		[400, 'Revisá los datos', false], [401, 'Tu sesión venció', true], [403, 'no tiene permiso', false],
		[409, 'año académico, semestre curricular y nombre exactos', false], [500, 'No se pudo crear el grupo', false],
	]) {
		const result = await evaluate(actionPath, { status, response: { error: { code: 'PRIVATE', message: 'Backend detail' } } });
		const response = await result.value.handleCreateGroup({ academic_year: 2025, curriculum_semester: 8, name: ' Grupo ' }, { cookies: result.cookies });
		assert.equal(response.success, false);
		assert.match(response.error, new RegExp(phrase, 'i'));
		assert.doesNotMatch(response.error, /PRIVATE|Backend detail/);
		assert.equal(result.cookieState.value, clears ? undefined : 'operator-token');
		assert.deepEqual(result.writes.map(([kind]) => kind), clears ? ['delete'] : []);
	}
	const offline = await evaluate(actionPath, { networkError: true });
	const response = await offline.value.handleCreateGroup({ academic_year: 2025, curriculum_semester: 8, name: 'Grupo' }, { cookies: offline.cookies });
	assert.equal(response.error, 'No se pudo conectar con el servicio. Probá de nuevo más tarde.');
	assert.equal(offline.cookieState.value, 'operator-token');
	assert.deepEqual(offline.writes, []);
});

test('409 feedback comes from the backend tuple and same-name creation remains allowed', async () => {
	const result = await evaluate(actionPath, {
		responses: [
			{ status: 409, body: { error: { message: 'duplicate' } } },
			{ status: 201, body: { id: 'group-new', academic_year: 2025, curriculum_semester: 8, name: 'Grupo', created_by: null, created_at: '2026-01-01' } },
		],
	});
	const input = { academic_year: 2025, curriculum_semester: 8, name: 'Grupo' };
	const conflict = await result.value.handleCreateGroup(input, { cookies: result.cookies });
	const created = await result.value.handleCreateGroup(input, { cookies: result.cookies });
	assert.match(conflict.error, /año académico, semestre curricular y nombre exactos/i);
	assert.equal(created.success, true);
	assert.equal(result.requests.length, 2);
	assert.equal(result.requests[0].responseStatus, 409);
	assert.equal(result.requests[1].responseStatus, 201);
});

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

test('POST 201 identity survives independent GET 403 and 500 with the same session', async () => {
	const created = {
		id: 'group-created', academic_year: 2026, curriculum_semester: 8, name: 'Cohorte Norte',
		created_by: 'backend-user', created_at: '2026-02-01T12:00:00Z',
	};
	for (const status of [403, 500]) {
		const sessionToken = 'distinctive-group-session';
		const post = await evaluate(actionPath, { status: 201, response: created, token: sessionToken });
		const actionResult = { data: await post.value.handleCreateGroup({
			academic_year: 2026, curriculum_semester: 8, name: ' Cohorte Norte ',
		}, { cookies: post.cookies }) };
		const page = await evaluate(pagePath, {
			status, cookieState: post.cookieState, actionResult,
			response: { error: { code: 'PRIVATE', message: 'Backend details' } },
		});
		assert.equal(page.value.state, status === 403 ? 'denied' : 'failed');
		assert.equal(page.value.actionResult, actionResult);
		assert.strictEqual(page.cookieState, post.cookieState);
		assert.equal(page.cookieState.value, sessionToken);
		assert.deepEqual(post.writes, []);
		assert.deepEqual(page.writes, []);
		assert.equal(post.requests.length, 1);
		assert.equal(page.requests.length, 1);
		assert.equal(page.requests[0].method, 'GET');
		assert.equal(page.requests[0].headers.Authorization, `Bearer ${sessionToken}`);
		assert.equal(page.cookieState.value, sessionToken);
		const form = await evaluateForm(page.value.actionResult);
		assert.deepEqual(plain(form.success), created);
		assert.equal(form.feedback, undefined);
	}
});

test('GET 200 and POST 403 remain independent and form displays framework and handler errors', async () => {
	const sessionToken = 'distinctive-group-session';
	const post = await evaluate(actionPath, { status: 403, response: { error: { message: 'forbidden' } }, token: sessionToken });
	const actionResult = { data: await post.value.handleCreateGroup({
		academic_year: 2025, curriculum_semester: 8, name: 'Grupo',
	}, { cookies: post.cookies }) };
	const list = await evaluate(pagePath, {
		cookieState: post.cookieState,
		response: { items: [sample()], limit: 50, offset: 0 },
		actionResult,
	});
	assert.equal(list.value.state, 'success');
	assert.strictEqual(list.cookieState, post.cookieState);
	assert.equal(list.cookieState.value, sessionToken);
	assert.deepEqual(post.writes, []);
	assert.deepEqual(list.writes, []);
	assert.equal(post.requests.length, 1);
	assert.equal(post.requests[0].method, 'POST');
	assert.equal(post.requests[0].responseStatus, 403);
	assert.equal(list.requests.length, 1);
	assert.equal(list.requests[0].method, 'GET');
	assert.equal(list.requests[0].responseStatus, 200);
	assert.equal(post.cookieState.value, sessionToken);
	assert.equal((await evaluateForm(list.value.actionResult)).feedback, 'Tu sesión no tiene permiso para crear grupos académicos.');
	const framework = await evaluateForm({ error: { message: 'Hay campos inválidos.', fields: { academic_year: ['Número inválido'] } } });
	assert.equal(framework.feedback, 'Hay campos inválidos.');
	assert.deepEqual(plain(framework.fieldErrors), { academic_year: ['Número inválido'] });
});

test('group form exposes labeled bounded fields, accessible feedback and created identity', async () => {
	const pageSource = await source(pagePath);
	assert.match(pageSource, /<GroupForm result={actionResult} \/>/);
	const form = await source(formPath);
	for (const text of ['Año académico', 'Semestre curricular', 'Nombre', 'min="1"', 'max="2147483647"', 'step="1"', 'role="status"', 'role="alert"', 'created_by', 'created_at', 'result?.data?.success ? result.data.group']) {
		assert.ok(form.includes(text), `missing form contract: ${text}`);
	}
	assert.match(form, /fieldErrors\.academic_year/);
	assert.match(form, /fieldErrors\.curriculum_semester/);
	assert.match(form, /fieldErrors\.name/);
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
