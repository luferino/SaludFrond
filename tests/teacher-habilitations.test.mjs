import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z as realZod } from 'astro/zod';

const root = new URL('../', import.meta.url);
const teacherId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const subjectId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const groupId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const periodId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const actorId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const iso = '2026-01-02T03:04:05.000Z';
const period = (overrides = {}) => ({ id: periodId, teacher_id: teacherId, subject_id: subjectId, academic_group_id: groupId, activated_by: actorId, activated_at: iso, revoked_by: null, revoked_at: null, ...overrides });
const plain = (value) => JSON.parse(JSON.stringify(value));

function serializeOwnedForm(formMarkup, fields, submitter) {
	const names = new Set([...formMarkup.matchAll(/<(?:input|select)\b[^>]*\bname="([^"]+)"[^>]*>/g)].map(([, name]) => name));
	const formData = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		assert.ok(names.has(name), `successful control ${name} belongs to the submitted form`);
		formData.append(name, value);
	}
	if (submitter) {
		const button = [...formMarkup.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag).find((tag) => tag.includes(`name="${submitter.name}"`));
		assert.ok(button, `submitter ${submitter.name} belongs to the submitted form`);
		if (submitter.method === 'GET') assert.match(button, /formnovalidate/, 'GET submitter bypasses only the required activation selectors');
		formData.append(submitter.name, submitter.value);
	}
	return formData;
}

async function evaluate(options = {}) {
	const cookieState = { token: options.token === undefined ? 'session-token' : options.token, writes: [] };
	const cookies = {
		get: (name) => name === 'session' && cookieState.token ? { value: cookieState.token } : undefined,
		set: (...args) => { cookieState.writes.push(['set', ...args]); cookieState.token = args[1]; },
		delete: (...args) => { cookieState.writes.push(['delete', ...args]); cookieState.token = undefined; },
	};
	const requests = [];
	const sandbox = vm.createContext({ URL, URLSearchParams, Response, Request, Error, Date,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('offline');
			const pathname = new URL(url).pathname;
			const status = options.statuses?.[pathname] ?? options.status ?? 200;
			let body = options.responses?.[pathname];
			if (body === undefined) {
				if (status >= 400) body = { error: { code: 'BACKEND_ERROR', message: 'private backend detail' } };
				else if (pathname.endsWith('/revoke')) body = period({ revoked_by: actorId, revoked_at: iso });
				else if (init.method === 'POST') body = period();
				else if (pathname === '/teacher-habilitations') body = { items: [period()], limit: Number(new URL(url).searchParams.get('limit')), offset: Number(new URL(url).searchParams.get('offset')) };
				else if (pathname === '/teachers') body = { items: [{ id: teacherId, nombres: 'Ana', apellidos: 'Pérez' }], limit: Number(new URL(url).searchParams.get('limit')), offset: Number(new URL(url).searchParams.get('offset')) };
				else if (pathname === '/subject-groups') body = { items: [{ subject_id: subjectId, academic_group_id: groupId, created_by: actorId, created_at: iso }], limit: Number(new URL(url).searchParams.get('limit')), offset: Number(new URL(url).searchParams.get('offset')) };
				else if (pathname === '/subjects') body = { items: [{ id: subjectId, name: 'Anatomía' }], limit: Number(new URL(url).searchParams.get('limit')), offset: Number(new URL(url).searchParams.get('offset')) };
				else if (pathname === '/groups') body = { items: [{ id: groupId, academic_year: 2026, curriculum_semester: 1, name: 'A' }], limit: Number(new URL(url).searchParams.get('limit')), offset: Number(new URL(url).searchParams.get('offset')) };
			}
			return Response.json(body, { status });
		},
	});
	const modules = new Map();
	async function compile(code, identifier) {
		if (modules.has(identifier)) return modules.get(identifier);
		const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
		const module = new vm.SourceTextModule(output, { context: sandbox, identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; },
		});
		modules.set(identifier, module);
		await module.link(async (specifier, parent) => {
			if (specifier === 'astro:actions') return new vm.SourceTextModule('export const defineAction = (definition) => definition;', { context: sandbox });
			if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () { this.setExport('z', realZod); }, { context: sandbox });
			const resolved = new URL(/\.(?:ts|astro)$/.test(specifier) ? specifier : `${specifier}.ts`, parent.identifier);
			return compile(await readFile(resolved, 'utf8'), resolved.href);
		});
		return module;
	}
	async function load(path) {
		const url = new URL(path, root);
		const module = await compile(await readFile(url, 'utf8'), url.href);
		if (module.status === 'linked') await module.evaluate();
		return module.namespace;
	}
	return { cookies, cookieState, requests, sandbox, load };
}

async function evaluatePage(query = '', options = {}) {
	const fixture = await evaluate(options);
	const pageUrl = new URL('src/pages/teacher-habilitations.astro', root);
	const source = await readFile(pageUrl, 'utf8');
	const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	assert.ok(frontmatter, 'page has server frontmatter');
	const parsed = ts.createSourceFile(pageUrl.pathname, frontmatter[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const removals = [];
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		removals.push([statement.getFullStart(), statement.getEnd()]);
		const clause = statement.importClause;
		if (!clause || clause.isTypeOnly || statement.getText(parsed).startsWith('import type ')) continue;
		const specifier = statement.moduleSpecifier.text;
		let namespace;
		if (specifier === 'astro:actions') {
			await fixture.load('src/pods/teacher-habilitation/api.ts');
			const actionModule = await fixture.load('src/pods/teacher-habilitation/actions.ts');
			namespace = { actions: { activateTeacherHabilitation: actionModule.activateTeacherHabilitation, revokeTeacherHabilitation: actionModule.revokeTeacherHabilitation } };
		} else if (specifier.endsWith('.astro')) namespace = { default: {} };
		else {
			const resolved = new URL(/\.(?:ts|astro)$/.test(specifier) ? specifier : `${specifier}.ts`, pageUrl);
			namespace = await fixture.load(resolved.href);
		}
		if (clause.name) fixture.sandbox[clause.name.text] = namespace.default;
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) fixture.sandbox[element.name.text] = namespace[element.propertyName?.text ?? element.name.text];
		}
	}
	let code = frontmatter[1];
	for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + code.slice(end);
	code = code.replace(/^export const prerender = false;\s*$/m, '');
	fixture.sandbox.Astro = {
		cookies: fixture.cookies,
		url: new URL(`https://frontend.invalid/teacher-habilitations${query ? `?${query}` : ''}`),
		request: options.request ?? new Request(`https://frontend.invalid/teacher-habilitations${query ? `?${query}` : ''}`),
		redirect: (location) => ({ redirect: location }),
		getActionResult: (action) => action === fixture.sandbox.actions.activateTeacherHabilitation ? options.activationResult : options.revocationResult,
	};
	const output = ts.transpileModule(`${code}\nreturn { queryError, teacherPagination, contextPagination, teacherState, contextState, subjectState, groupState, periodState, periods, selectedTeacher, selectedContext, filter, previousOffset, nextOffset };`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
	const value = await new vm.Script(`(async () => { ${output} })()`).runInContext(fixture.sandbox);
	return { ...fixture, value, source };
}

test('activation sends only selected profile and linked context through authenticated POST', async () => {
	const fixture = await evaluate();
	await fixture.load('src/pods/teacher-habilitation/api.ts');
	const { activateTeacherHabilitation } = await fixture.load('src/pods/teacher-habilitation/actions.ts');
	assert.equal(typeof activateTeacherHabilitation.handler, 'function');
	const submitted = new FormData();
	submitted.set('teacher_id', teacherId);
	submitted.set('context', `${subjectId}:${groupId}`);
	const parsedForm = activateTeacherHabilitation.input.safeParse(Object.fromEntries(submitted));
	assert.equal(parsedForm.success, true, JSON.stringify(parsedForm.error?.issues));
	assert.equal(activateTeacherHabilitation.accept, 'form');
	const result = await activateTeacherHabilitation.handler({ teacher_id: teacherId, context: `${subjectId}:${groupId}`, activated_by: actorId, activated_at: iso, extra: 'ignored' }, { cookies: fixture.cookies });
	assert.equal(result.success, true);
	assert.equal(fixture.requests.length, 1);
	assert.equal(fixture.requests[0].url, 'https://backend.invalid/teacher-habilitations');
	assert.equal(fixture.requests[0].method, 'POST');
	assert.equal(fixture.requests[0].headers.Authorization, 'Bearer session-token');
	assert.deepEqual(JSON.parse(fixture.requests[0].body), { teacher_id: teacherId, subject_id: subjectId, academic_group_id: groupId });
	assert.equal(fixture.cookieState.token, 'session-token');
});

test('invalid activation and unconfirmed or malformed revoke never issue a request', async () => {
	const fixture = await evaluate();
	await fixture.load('src/pods/teacher-habilitation/api.ts');
	const actions = await fixture.load('src/pods/teacher-habilitation/actions.ts');
	for (const input of [
		{ teacher_id: 'bad', subject_id: subjectId, academic_group_id: groupId },
		{ teacher_id: teacherId, subject_id: subjectId, academic_group_id: '' },
	]) {
		const result = await actions.activateTeacherHabilitation.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false);
	}
	for (const input of [{ id: periodId, confirm: 'no' }, { id: 'bad', confirm: 'yes' }]) {
		const result = await actions.revokeTeacherHabilitation.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false);
	}
	assert.deepEqual(fixture.requests, []);
});

test('confirmed revocation POST has no client audit/body fields and returns validated audit facts', async () => {
	const fixture = await evaluate();
	await fixture.load('src/pods/teacher-habilitation/api.ts');
	const { revokeTeacherHabilitation } = await fixture.load('src/pods/teacher-habilitation/actions.ts');
	const submitted = new FormData();
	submitted.set('id', periodId);
	submitted.set('confirm', 'yes');
	assert.equal(revokeTeacherHabilitation.input.safeParse(Object.fromEntries(submitted)).success, true, 'the real Zod revoke schema accepts browser confirmation FormData');
	const result = await revokeTeacherHabilitation.handler({ id: periodId, confirm: 'yes', revoked_by: teacherId, revoked_at: iso }, { cookies: fixture.cookies });
	assert.equal(result.success, true);
	assert.equal(fixture.requests[0].url, `https://backend.invalid/teacher-habilitations/${periodId}/revoke`);
	assert.equal(fixture.requests[0].method, 'POST');
	assert.equal(fixture.requests[0].headers.Authorization, 'Bearer session-token');
	assert.equal(fixture.requests[0].body, undefined);
	assert.equal(result.period.revoked_by, actorId);
	assert.equal(result.period.revoked_at, iso);
});

test('period listing combines validated profile/context/status filters and exact pagination', async () => {
	const fixture = await evaluate();
	const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
	const result = await api.listTeacherHabilitations({ limit: 7, offset: 14 }, { teacherId, subjectId, academicGroupId: groupId, status: 'revoked' }, fixture.cookies);
	assert.equal(result.state, 'success');
	assert.deepEqual(plain(result.page.items), [period()]);
	assert.equal(fixture.requests[0].url, `https://backend.invalid/teacher-habilitations?limit=7&offset=14&teacher_id=${teacherId}&subject_id=${subjectId}&academic_group_id=${groupId}&status=revoked`);
	assert.equal(fixture.requests[0].method, 'GET');
	assert.equal(fixture.requests[0].headers.Authorization, 'Bearer session-token');
	assert.deepEqual(plain(api.parseTeacherHabilitationFilter(new URLSearchParams(`teacher_id=${teacherId}&subject_id=${subjectId}&academic_group_id=${groupId}&status=active`))), { teacherId, subjectId, academicGroupId: groupId, status: 'active' });
	for (const query of ['teacher_id=bad', `teacher_id=${teacherId}&teacher_id=${groupId}`, 'status=other']) {
		assert.throws(() => api.parseTeacherHabilitationFilter(new URLSearchParams(query)));
	}
});

test('safe period validation rejects malformed rows and pagination boundaries do not overrun', async () => {
	for (const response of [
		{}, { items: [period({ id: 'bad' })], limit: 2, offset: 4 },
		{ items: [period({ activated_at: 'yesterday' })], limit: 2, offset: 4 },
		{ items: [period({ revoked_by: actorId, revoked_at: null })], limit: 2, offset: 4 },
		{ items: [], limit: 3, offset: 4 },
	]) {
		const fixture = await evaluate({ responses: { '/teacher-habilitations': response } });
		const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
		assert.deepEqual(plain(await api.listTeacherHabilitations({ limit: 2, offset: 4 }, {}, fixture.cookies)), { state: 'failed' });
	}
	const fixture = await evaluate({ responses: { '/teacher-habilitations': { items: [], limit: 1, offset: 10000 } } });
	const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
	assert.deepEqual(plain(api.teacherHabilitationNavigation({ limit: 1, offset: 10000, itemsLength: 1 })), { previousOffset: 9999, nextOffset: null });
	for (const query of ['limit=0', 'limit=101', 'offset=10001', 'offset=1.5', 'offset=0&offset=1']) assert.throws(() => api.parseAcademicPagination(new URLSearchParams(query)));
});

test('profile and linked-context catalogs validate independent paginated reads and response denial', async () => {
	const fixture = await evaluate();
	const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
	const profiles = await api.listTeacherProfiles({ limit: 3, offset: 6 }, fixture.cookies);
	const contexts = await api.listLinkedSubjectGroups({ limit: 4, offset: 8 }, fixture.cookies);
	assert.equal(profiles.state, 'success');
	assert.equal(contexts.state, 'success');
	assert.deepEqual(fixture.requests.map(({ url }) => new URL(url).pathname + new URL(url).search), [
		'/teachers?limit=3&offset=6', '/subject-groups?limit=4&offset=8',
	]);
	for (const path of ['/teachers', '/subject-groups']) {
		for (const status of [403, 500]) {
			const failed = await evaluate({ statuses: { [path]: status } });
			const failedApi = await failed.load('src/pods/teacher-habilitation/api.ts');
			const getter = path === '/teachers' ? 'listTeacherProfiles' : 'listLinkedSubjectGroups';
			assert.equal((await failedApi[getter]({ limit: 50, offset: 0 }, failed.cookies)).state, status === 403 ? 'denied' : 'failed');
			assert.equal(failed.cookieState.token, 'session-token');
		}
	}
});

test('activation and revocation refuse mismatched identities or malformed server audit facts', async () => {
	for (const response of [
		period({ teacher_id: groupId }), period({ revoked_by: actorId, revoked_at: iso }),
		period({ activated_by: 'not-an-actor' }), period({ activated_at: 'not-a-time' }),
	]) {
		const fixture = await evaluate({ responses: { '/teacher-habilitations': response } });
		const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
		await assert.rejects(api.createTeacherHabilitation({ teacher_id: teacherId, subject_id: subjectId, academic_group_id: groupId }, fixture.cookies));
	}
	for (const response of [period({ id: groupId, revoked_by: actorId, revoked_at: iso }), period({ revoked_by: null, revoked_at: iso })]) {
		const fixture = await evaluate({ responses: { [`/teacher-habilitations/${periodId}/revoke`]: response } });
		const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
		await assert.rejects(api.revokeTeacherHabilitation(periodId, fixture.cookies));
	}
});

test('period read permission is independent; empty pages are success and forbidden reads stay denied', async () => {
	for (const [status, expected] of [[403, 'denied'], [500, 'failed']]) {
		const fixture = await evaluate({ status });
		const api = await fixture.load('src/pods/teacher-habilitation/api.ts');
		assert.equal((await api.listTeacherHabilitations({ limit: 50, offset: 0 }, { teacherId: null, subjectId: null, academicGroupId: null, status: null }, fixture.cookies)).state, expected);
		assert.equal(fixture.cookieState.token, 'session-token');
	}
	const empty = await evaluate({ responses: { '/teacher-habilitations': { items: [], limit: 50, offset: 0 } } });
	const api = await empty.load('src/pods/teacher-habilitation/api.ts');
	assert.equal((await api.listTeacherHabilitations({ limit: 50, offset: 0 }, { teacherId: null, subjectId: null, academicGroupId: null, status: null }, empty.cookies)).state, 'success');
});

test('all 400 401 403 404 409 500 failures stay safe and only 401 clears session', async () => {
	for (const status of [400, 401, 403, 404, 409, 500]) {
		const fixture = await evaluate({ status });
		await fixture.load('src/pods/teacher-habilitation/api.ts');
		const actions = await fixture.load('src/pods/teacher-habilitation/actions.ts');
		const result = await actions.activateTeacherHabilitation.handler({ teacher_id: teacherId, subject_id: subjectId, academic_group_id: groupId }, { cookies: fixture.cookies });
		assert.equal(result.success, false);
		assert.doesNotMatch(result.error, /private backend detail/);
		assert.equal(fixture.cookieState.token, status === 401 ? undefined : 'session-token');
		assert.equal(fixture.requests.length, 1);
	}
	const network = await evaluate({ networkError: true });
	await network.load('src/pods/teacher-habilitation/api.ts');
	const actions = await network.load('src/pods/teacher-habilitation/actions.ts');
	assert.equal((await actions.activateTeacherHabilitation.handler({ teacher_id: teacherId, subject_id: subjectId, academic_group_id: groupId }, { cookies: network.cookies })).success, false);
});

test('server-rendered page executes list reads and preserves selected drafts through native GET pagination', async () => {
	const query = `teacher_offset=50&context_offset=100&subject_offset=25&group_offset=75&teacher_id=${teacherId}&context=${subjectId}:${groupId}&filter_teacher_id=${teacherId}&filter_subject_id=${subjectId}&filter_academic_group_id=${groupId}&filter_status=revoked&limit=7&offset=14`;
	const result = await evaluatePage(query);
	assert.equal(result.value.selectedTeacher, teacherId);
	assert.equal(result.value.selectedContext, `${subjectId}:${groupId}`);
	assert.equal(result.value.filter.status, 'revoked');
	assert.equal(result.value.teacherPagination.offset, 50);
	assert.equal(result.value.contextPagination.offset, 100);
	assert.equal(result.value.periodState, 'success');
	assert.equal(result.value.filter.teacherId, teacherId);
	assert.equal(result.value.filter.subjectId, subjectId);
	assert.equal(result.value.filter.academicGroupId, groupId);
	assert.deepEqual(result.requests.map(({ url }) => [new URL(url).pathname, new URL(url).search]), [
		['/teachers', '?limit=50&offset=50'], ['/subject-groups', '?limit=50&offset=100'],
		['/subjects', '?limit=50&offset=25'], ['/groups', '?limit=50&offset=75'],
		['/teacher-habilitations', `?limit=7&offset=14&teacher_id=${teacherId}&subject_id=${subjectId}&academic_group_id=${groupId}&status=revoked`],
	]);
	assert.match(result.source, /name="context"/);
	assert.ok(result.source.includes('formmethod="GET" formaction="/teacher-habilitations" formnovalidate name="teacher_page"'));
	assert.ok(result.source.includes('formmethod="GET" formaction="/teacher-habilitations" formnovalidate name="context_page"'));
	assert.ok(result.source.includes('<option value={contextValue(item)}'));
	assert.doesNotMatch(result.source, /<script>/, 'linked context selection and paging work without JavaScript');
	assert.ok(result.source.includes('name="filter_teacher_id"'));
	assert.ok(result.source.includes('name="filter_subject_id"'));
	assert.ok(result.source.includes('name="filter_academic_group_id"'));
	assert.ok(result.source.includes('name="filter_status"'));
	assert.ok(result.source.includes('formmethod="GET" formaction="/teacher-habilitations" formnovalidate name="subject_page"'));
	assert.ok(result.source.includes('formmethod="GET" formaction="/teacher-habilitations" formnovalidate name="group_page"'));
	assert.ok(result.source.includes('draft_teacher_id'));
	assert.ok(result.source.includes('draft_context'));
});

test('server-rendered page keeps catalog grants independent from period reads and treats invalid page state safely', async () => {
	const deniedCatalog = await evaluatePage('', { statuses: { '/teachers': 403, '/subject-groups': 403 } });
	assert.equal(deniedCatalog.value.teacherState, 'denied');
	assert.equal(deniedCatalog.value.contextState, 'denied');
	assert.equal(deniedCatalog.value.periodState, 'success');
	const deniedPeriods = await evaluatePage('', { statuses: { '/teacher-habilitations': 403 } });
	assert.equal(deniedPeriods.value.periodState, 'denied');
	assert.equal(deniedPeriods.value.teacherState, 'success');
	const invalid = await evaluatePage('teacher_offset=10001&draft_teacher_id=bad');
	assert.match(invalid.value.queryError, /paginación|selección/i);
	assert.equal(invalid.value.periods.length, 0);
	assert.equal(invalid.requests.some(({ url }) => new URL(url).pathname === '/teacher-habilitations'), false);
});

test('native filter FormData accepts the single empty value for every optional filter', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	const form = page.match(/<form class="habilitation-form" method="POST" action=\{actions\.activateTeacherHabilitation\}>([\s\S]*?)<\/form>/)?.[1] ?? '';
	const submitted = serializeOwnedForm(form, { teacher_id: '', context: '', filter_teacher_id: '', filter_subject_id: '', filter_academic_group_id: '', filter_status: '' }, { name: 'apply_filter', value: 'yes', method: 'GET' });
	const query = new URLSearchParams(submitted).toString();
	const result = await evaluatePage(query);
	assert.equal(result.value.queryError, '');
	assert.deepEqual(plain(result.value.filter), { teacherId: null, subjectId: null, academicGroupId: null, status: null });
	assert.equal(result.value.periodState, 'success');
	assert.equal(result.requests.at(-1).url, 'https://backend.invalid/teacher-habilitations?limit=50&offset=0');
	for (const malformed of [
		`filter_teacher_id=&filter_teacher_id=${teacherId}`,
		`filter_subject_id=${subjectId}&filter_subject_id=`,
		'filter_status=&filter_status=active',
		'filter_academic_group_id=not-a-uuid',
	]) {
		const invalid = await evaluatePage(malformed);
		assert.notEqual(invalid.value.queryError, '', malformed);
		assert.equal(invalid.requests.some(({ url }) => new URL(url).pathname === '/teacher-habilitations'), false, malformed);
	}
});

test('one native form owns activation and period filters, with GET submitters bypassing activation constraints only', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	const activationForm = page.match(/<form class="habilitation-form" method="POST" action=\{actions\.activateTeacherHabilitation\}>([\s\S]*?)<\/form>/)?.[1];
	assert.ok(activationForm, 'the shared native form owns activation and GET controls');
	for (const control of ['name="teacher_id"', 'name="context"', 'name="filter_teacher_id"', 'name="filter_subject_id"', 'name="filter_academic_group_id"', 'name="filter_status"']) {
		assert.ok(activationForm.includes(control), `${control} belongs to the shared form`);
	}
	assert.match(activationForm, /name="teacher_id" required/);
	assert.match(activationForm, /name="context" required/);
	const getButtons = [...activationForm.matchAll(/<button\b[^>]*formmethod="GET"[^>]*>/g)].map(([button]) => button);
	assert.ok(getButtons.length >= 6, 'catalog and filter paging submitters are in the shared form');
	for (const button of getButtons) assert.match(button, /formnovalidate/, button);
	const activateButton = activationForm.match(/<button class="activate-button" type="submit"[^>]*>/)?.[0];
	assert.ok(activateButton);
	assert.doesNotMatch(activateButton, /formnovalidate/);
});

test('native GET paging serializes one offset plus a direction and advances linked labels', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	for (const catalog of ['subject', 'group']) {
		assert.ok(page.includes(`name="${catalog}_offset" value={`), `${catalog} form carries its current offset once`);
		assert.ok(page.includes(`name="${catalog}_page" value="next"`), `${catalog} paging button submits a distinct direction`);
		assert.doesNotMatch(page, new RegExp(`name="${catalog}_offset" value=\\{(?:subject|group)Navigation\\.(?:next|previous)Offset\\}`), 'submitter must not duplicate the hidden offset');
	}
	const form = page.match(/<form class="habilitation-form" method="POST" action=\{actions\.activateTeacherHabilitation\}>([\s\S]*?)<\/form>/)?.[1] ?? '';
	const submitted = serializeOwnedForm(form, { teacher_id: '', context: '', teacher_limit: '11', teacher_offset: '33', context_limit: '12', context_offset: '48', subject_limit: '50', subject_offset: '0', group_limit: '13', group_offset: '65' }, { name: 'subject_page', value: 'next', method: 'GET' });
	const query = new URLSearchParams(submitted).toString();
	const result = await evaluatePage(query);
	assert.equal(result.value.queryError, '');
	assert.equal(result.requests.find(({ url }) => new URL(url).pathname === '/subjects').url, 'https://backend.invalid/subjects?limit=50&offset=50');
	assert.deepEqual(result.requests.filter(({ url }) => ['/teachers', '/subject-groups', '/groups'].includes(new URL(url).pathname)).map(({ url }) => new URL(url).searchParams.get('offset')), ['33', '48', '65']);
	const groupSubmission = serializeOwnedForm(form, { teacher_id: '', context: '', teacher_limit: '11', teacher_offset: '33', context_limit: '12', context_offset: '48', subject_limit: '13', subject_offset: '65', group_limit: '50', group_offset: '0' }, { name: 'group_page', value: 'next', method: 'GET' });
	const groupResult = await evaluatePage(new URLSearchParams(groupSubmission).toString());
	assert.equal(groupResult.requests.find(({ url }) => new URL(url).pathname === '/groups').url, 'https://backend.invalid/groups?limit=50&offset=50');
	assert.deepEqual(groupResult.requests.filter(({ url }) => ['/teachers', '/subject-groups', '/subjects'].includes(new URL(url).pathname)).map(({ url }) => new URL(url).searchParams.get('offset')), ['33', '48', '65']);
});

test('GET paging preserves each other catalog offset and supports blank required activation selectors', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	const activationForm = page.match(/<form class="habilitation-form" method="POST" action=\{actions\.activateTeacherHabilitation\}>([\s\S]*?)<\/form>/)?.[1] ?? '';
	for (const name of ['teacher_offset', 'context_offset', 'subject_offset', 'group_offset']) assert.ok(activationForm.includes(`name="${name}"`));
	const submitted = serializeOwnedForm(activationForm, { teacher_id: '', context: '', teacher_limit: '50', teacher_offset: '100', context_limit: '50', context_offset: '100', subject_limit: '50', subject_offset: '100', group_limit: '50', group_offset: '100' }, { name: 'teacher_page', value: 'next', method: 'GET' });
	const query = new URLSearchParams(submitted).toString();
	const result = await evaluatePage(query);
	assert.equal(result.value.queryError, '');
	assert.deepEqual(plain({ teacher: result.value.teacherPagination.offset, context: result.value.contextPagination.offset, subject: new URL(result.requests.find(({ url }) => new URL(url).pathname === '/subjects').url).searchParams.get('offset'), group: new URL(result.requests.find(({ url }) => new URL(url).pathname === '/groups').url).searchParams.get('offset') }), { teacher: 150, context: 100, subject: '100', group: '100' });
});

test('activation data failures preserve submitted profile and linked context', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	const form = page.match(/<form class="habilitation-form" method="POST" action=\{actions\.activateTeacherHabilitation\}>([\s\S]*?)<\/form>/)?.[1] ?? '';
	const submitted = serializeOwnedForm(form, { teacher_id: teacherId, context: `${subjectId}:${groupId}` });
	const request = new Request('https://frontend.invalid/teacher-habilitations', { method: 'POST', body: new URLSearchParams(submitted) });
	const result = await evaluatePage('', { request, activationResult: { data: { success: false, error: 'No autorizado.' } } });
	assert.equal(result.value.selectedTeacher, teacherId);
	assert.equal(result.value.selectedContext, `${subjectId}:${groupId}`);
});

test('filter submission shares current activation selections and preserves all independent paging state', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	const activationForm = page.match(/<form class="habilitation-form" method="POST" action=\{actions\.activateTeacherHabilitation\}>([\s\S]*?)<\/form>/)?.[1] ?? '';
	for (const name of ['teacher_id', 'context', 'filter_teacher_id', 'filter_subject_id', 'filter_academic_group_id', 'filter_status', 'teacher_offset', 'context_offset', 'subject_offset', 'group_offset']) assert.ok(activationForm.includes(`name="${name}"`), name);
	const submitted = serializeOwnedForm(activationForm, { teacher_id: teacherId, context: `${subjectId}:${groupId}`, filter_teacher_id: groupId, filter_subject_id: subjectId, filter_academic_group_id: groupId, filter_status: 'active', limit: '7', offset: '0', teacher_limit: '10', teacher_offset: '20', context_limit: '11', context_offset: '33', subject_limit: '12', subject_offset: '48', group_limit: '13', group_offset: '65' }, { name: 'apply_filter', value: 'yes', method: 'GET' });
	const result = await evaluatePage(new URLSearchParams(submitted).toString());
	assert.equal(result.value.selectedTeacher, teacherId);
	assert.equal(result.value.selectedContext, `${subjectId}:${groupId}`);
	assert.equal(result.value.filter.teacherId, groupId);
	assert.equal(result.value.filter.subjectId, subjectId);
	assert.equal(result.value.filter.academicGroupId, groupId);
	assert.equal(result.value.filter.status, 'active');
	assert.deepEqual([result.value.teacherPagination.offset, result.value.contextPagination.offset, new URL(result.requests.find(({ url }) => new URL(url).pathname === '/subjects').url).searchParams.get('offset'), new URL(result.requests.find(({ url }) => new URL(url).pathname === '/groups').url).searchParams.get('offset')], [20, 33, '48', '65']);
});

test('applying period filters resets only the period offset and preserves catalog coordinates', async () => {
	const query = new URLSearchParams({
		apply_filter: 'yes', teacher_id: teacherId, context: `${subjectId}:${groupId}`,
		filter_teacher_id: groupId, filter_subject_id: subjectId, filter_academic_group_id: groupId, filter_status: 'active',
		limit: '7', offset: '50', teacher_limit: '10', teacher_offset: '20', context_limit: '11', context_offset: '33', subject_limit: '12', subject_offset: '48', group_limit: '13', group_offset: '65',
	}).toString();
	const result = await evaluatePage(query);
	assert.equal(result.value.filter.teacherId, groupId);
	assert.equal(result.value.filter.subjectId, subjectId);
	assert.equal(result.value.filter.academicGroupId, groupId);
	assert.equal(result.value.filter.status, 'active');
	assert.deepEqual([result.value.teacherPagination.offset, result.value.contextPagination.offset, new URL(result.requests.find(({ url }) => new URL(url).pathname === '/subjects').url).searchParams.get('offset'), new URL(result.requests.find(({ url }) => new URL(url).pathname === '/groups').url).searchParams.get('offset')], [20, 33, '48', '65']);
	const periodUrl = new URL(result.requests.find(({ url }) => new URL(url).pathname === '/teacher-habilitations').url);
	assert.equal(periodUrl.searchParams.get('offset'), '0');
	assert.equal(periodUrl.searchParams.get('limit'), '7');
});

test('activation accepts uppercase and mixed-case UUIDs in the schema and handler', async () => {
	const mixedSubject = subjectId.toUpperCase();
	const mixedGroup = `${groupId.slice(0, 4).toUpperCase()}${groupId.slice(4)}`;
	const fixture = await evaluate({ responses: { '/teacher-habilitations': period({ subject_id: mixedSubject, academic_group_id: mixedGroup }) } });
	await fixture.load('src/pods/teacher-habilitation/api.ts');
	const action = (await fixture.load('src/pods/teacher-habilitation/actions.ts')).activateTeacherHabilitation;
	const input = { teacher_id: teacherId, context: `${mixedSubject}:${mixedGroup}` };
	assert.equal(action.input.safeParse(input).success, true);
	const result = await action.handler(input, { cookies: fixture.cookies });
	assert.equal(result.success, true);
	assert.equal(fixture.requests.length, 1);
	assert.deepEqual(JSON.parse(fixture.requests[0].body), { teacher_id: teacherId, subject_id: mixedSubject, academic_group_id: mixedGroup });
});

test('activation context schema and handler reject trailing components even with valid direct IDs', async () => {
	const fixture = await evaluate();
	await fixture.load('src/pods/teacher-habilitation/api.ts');
	const action = (await fixture.load('src/pods/teacher-habilitation/actions.ts')).activateTeacherHabilitation;
	for (const context of [`${subjectId}:${groupId}:unexpected`, '', 42]) {
		const input = { teacher_id: teacherId, context, subject_id: subjectId, academic_group_id: groupId };
		assert.equal(action.input.safeParse(input).success, false);
		const result = await action.handler(input, { cookies: fixture.cookies });
		assert.equal(result.success, false);
	}
	assert.deepEqual(fixture.requests, []);
	assert.deepEqual(fixture.cookieState.writes, []);
});

test('server-rendered page wires independent profile/context catalogs and never role-gates grants', async () => {
	const page = await readFile(new URL('../src/pages/teacher-habilitations.astro', import.meta.url), 'utf8');
	assert.match(page, /export const prerender = false/);
	assert.match(page, /listTeacherProfiles/);
	assert.match(page, /listLinkedSubjectGroups/);
	assert.match(page, /listTeacherHabilitations/);
	assert.match(page, /actions\.activateTeacherHabilitation/);
	assert.match(page, /actions\.revokeTeacherHabilitation/);
	assert.doesNotMatch(page, /payload\.role|role\s*===|permissions/);
	assert.match(page, /activationResult/);
	assert.match(page, /revocationResult/);
	assert.match(page, /revoked_at/);
	assert.match(page, /Confirmo que quiero revocar este período/);
	assert.match(page, /La revocación quita el acceso docente asociado a este período/);
	assert.match(page, /No revoca períodos estudiantiles ni cierra asignaciones o documentos clínicos/);
});
