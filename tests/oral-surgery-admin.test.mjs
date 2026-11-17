import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const listPage = 'src/pages/oral-surgery-admin.astro';
const detailPage = 'src/pages/oral-surgery-admin/[id].astro';
const adminPath = 'src/pods/oral-surgery-draft/admin.ts';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const teacherId = '55555555-5555-4555-8555-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const draftId = '9007199254741061';
const iso = '2026-11-16T12:00:00.000Z';
const draftPath = `/oral-surgery-drafts/${draftId}`;

const draft = (overrides = {}) => ({
	id: draftId, clinical_record_id: '9007199254741060', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: { treatment_plan: { procedure: 'Exodoncia' } }, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const consent = { draft_version: '3', plan_revision: '2', current_declaration_id: null, declarations: [] };
const authorizations = {
	draft_version: '3', current_authorization_id: '11', authorizations: [{
		id: '11', draft_id: draftId, draft_version: '3', consent_declaration_id: '7', reviewed_content: { treatment_plan: { procedure: 'Exodoncia' } },
		authorized_by: teacherId, teacher_habilitation_id: habilitationId, authorized_at: iso,
	}],
};
const report = (overrides = {}) => ({
	draft_id: draftId, draft_version: '3', authorization_id: '11', content: { narrative: 'Sin complicaciones' }, version: '2', status: 'draft',
	created_by: authorId, created_at: iso, updated_at: iso, closed_by: null, closed_at: null, teacher_habilitation_id: null, ...overrides,
});
const closedReport = report({ version: '3', status: 'closed', closed_by: teacherId, closed_at: iso, teacher_habilitation_id: habilitationId });
const errorBody = (code, message) => ({ error: { code, message } });
const admin = (overrides = {}) => ({ sub: authorId, username: 'admin', role: 'admin', permissions: ['oral-surgery-drafts:read'], exp: 4102444800, iat: 1, ...overrides });
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const plain = (value) => JSON.parse(JSON.stringify(value));
const detailRoutes = (overrides = {}) => ({
	[`GET ${draftPath}`]: { body: draft() },
	[`GET ${draftPath}/consent`]: { body: consent },
	[`GET ${draftPath}/authorizations`]: { body: authorizations },
	[`GET ${draftPath}/operative-report`]: { body: report() },
	...overrides,
});

/** Real pods and page frontmatter run in one vm context; fetch is a route table and every request is recorded. */
async function environment(routes = {}) {
	const requests = [];
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Headers, Error, Date, BigInt, atob, btoa,
		fetch: async (href, init = {}) => {
			const method = init.method ?? 'GET';
			requests.push({ method, url: href });
			const key = `${method} ${new URL(href).pathname}`;
			const entry = routes[key];
			const response = typeof entry === 'function' ? await entry({ url: new URL(href) }) : entry;
			if (!response) throw new Error(`Unexpected request ${key}`);
			if (response.network) throw new TypeError('fetch failed');
			return Response.json(response.body ?? {}, { status: response.status ?? 200 });
		},
	});
	const modules = new Map();
	function load(href) {
		if (!modules.has(href)) {
			modules.set(href, (async () => {
				const code = await readFile(new URL(href), 'utf8');
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const mod = new vm.SourceTextModule(output, {
					context: sandbox, identifier: href, initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: apiBase }; },
				});
				await mod.link(async (specifier, parent) => {
					if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
					if (specifier === './session') {
						return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
							this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
							this.setExport('clearSession', () => undefined);
						}, { context: sandbox });
					}
					return load(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
				});
				return mod;
			})());
		}
		return modules.get(href);
	}
	async function importModule(href) {
		const mod = await load(href);
		if (mod.status === 'linked') await mod.evaluate();
		else if (mod.status === 'evaluating') await new Promise((resolve) => setTimeout(resolve, 0));
		return mod.namespace;
	}
	const cookiesFor = (actor) => {
		const token = actor ? jwt(actor) : undefined;
		return { get: (name) => (name === 'session' && token ? { value: token } : undefined), set() {}, delete() {} };
	};

	/** Evaluate the page frontmatter with real pods; returns the named state, or { redirect }. */
	async function renderPage(path, { url, id = draftId, actor = admin(), state = [] } = {}) {
		const headers = new Headers();
		sandbox.Astro = {
			params: { id }, url: new URL(url, 'http://localhost'), cookies: cookiesFor(actor),
			response: { headers }, redirect: (location) => ({ redirect: location }),
		};
		sandbox.__import = (specifier) => importModule(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, new URL(path, root)).href);
		const source = await readFile(new URL(path, root), 'utf8');
		const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
		const declarations = frontmatter
			.replace(/^export const prerender = false;\s*$/m, '')
			.replace(/^import type .*;\s*$/gm, '')
			.replace(/^import \w+ from '[^']+\.astro';\s*$/gm, '')
			.replace(/^import (\{[^}]*\}) from '([^']+)';\s*$/gm, (_, names, specifier) => `const ${names.replace(/\s+as\s+/g, ': ')} = await __import('${specifier}');`);
		const script = `async function renderPage() {${declarations}\nreturn { ${state.join(', ')} };\n}`;
		const output = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
		vm.runInContext(output, sandbox);
		const result = plain(await sandbox.renderPage());
		return { ...result, cacheControl: headers.get('Cache-Control') };
	}
	return { requests, renderPage, cookiesFor, admin: await importModule(new URL(adminPath, root).href) };
}

const LIST_STATE = ['allowed', 'listing', 'items', 'error', 'forbidden', 'loaded', 'previousOffset', 'nextOffset', 'listQuery'];
const DETAIL_STATE = ['allowed', 'unavailable', 'forbidden', 'loadError', 'draft', 'consent', 'consentError', 'authorizationHistory', 'authorizationError', 'report', 'reportError', 'backHref'];

// A1: admin gate and query parsing (S6).

test('A1 only an admin session with the read grant passes the gate', async () => {
	const env = await environment();
	assert.equal(env.admin.oralSurgeryAdminGrant(env.cookiesFor(admin())), true);
	for (const actor of [
		null, admin({ role: 'teacher' }), admin({ role: 'student' }), admin({ permissions: [] }), admin({ permissions: 'oral-surgery-drafts:read' }),
		admin({ permissions: ['oral-surgery-drafts:read', null] }), admin({ permissions: undefined }),
	]) {
		assert.equal(env.admin.oralSurgeryAdminGrant(env.cookiesFor(actor)), false, JSON.stringify(actor));
	}
});

test('A1 the listing query keeps defaults, bounds and optional real dates; anything else is rejected', async () => {
	const env = await environment();
	const parse = (query) => plain(env.admin.parseOralSurgeryAdminListing(new URLSearchParams(query)));
	assert.deepEqual(parse(''), { limit: 50, offset: 0, filters: {} });
	assert.deepEqual(parse('limit=100&offset=200&date_from=2026-11-01&date_to=2026-11-16'), { limit: 100, offset: 200, filters: { date_from: '2026-11-01', date_to: '2026-11-16' } });
	assert.deepEqual(parse('date_from=&date_to='), { limit: 50, offset: 0, filters: {} });
	for (const query of [
		'limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'offset=-1', 'offset=2147483648', 'limit=10&limit=20', 'date_from=2026-11-31',
		'date_to=16/11/2026', 'date_from=2026-11-16&date_to=2026-11-01', 'date_from=2026-11-01&date_from=2026-11-02',
	]) {
		assert.throws(() => env.admin.parseOralSurgeryAdminListing(new URLSearchParams(query)), Error, query);
	}
	assert.equal(env.admin.oralSurgeryAdminQuery({ limit: 20, offset: 40, filters: { date_to: '2026-11-16' } }), 'limit=20&offset=40&date_to=2026-11-16');
	assert.equal(env.admin.oralSurgeryAdminQuery({ limit: 20, offset: 40, filters: {} }, 60), 'limit=20&offset=60');
	assert.deepEqual(plain(env.admin.oralSurgeryAdminPagination({ limit: 20, offset: 0, filters: {} }, 20)), { previousOffset: null, nextOffset: 20 });
	assert.deepEqual(plain(env.admin.oralSurgeryAdminPagination({ limit: 20, offset: 30, filters: {} }, 5)), { previousOffset: 10, nextOffset: null });
});

// A2: global list page (S6).

test('A2 the list sends one request with the validated query and offers next only on a full page', async () => {
	const items = Array.from({ length: 2 }, (_, index) => draft({ id: String(10 + index) }));
	const env = await environment({ 'GET /oral-surgery-drafts': { body: { items } } });
	const page = await env.renderPage(listPage, { url: '/oral-surgery-admin?limit=2&offset=4&date_from=2026-11-01', state: LIST_STATE });
	assert.deepEqual(env.requests, [{ method: 'GET', url: `${apiBase}/oral-surgery-drafts?limit=2&offset=4&date_from=2026-11-01` }]);
	assert.equal(page.allowed, true);
	assert.equal(page.loaded, true);
	assert.deepEqual(page.items.map((item) => item.id), ['10', '11']);
	assert.deepEqual([page.previousOffset, page.nextOffset], [2, 6]);
	assert.equal(page.listQuery, 'limit=2&offset=4&date_from=2026-11-01');
	assert.equal(page.cacheControl, 'no-store');
});

test('A2 non-admin sessions and invalid queries send no request', async () => {
	for (const [actor, url] of [
		[admin({ role: 'teacher' }), '/oral-surgery-admin'], [admin({ permissions: [] }), '/oral-surgery-admin'], [null, '/oral-surgery-admin'],
		[admin(), '/oral-surgery-admin?limit=500'], [admin(), '/oral-surgery-admin?date_from=2026-02-30'],
	]) {
		const env = await environment();
		const page = await env.renderPage(listPage, { url, actor, state: LIST_STATE });
		assert.equal(env.requests.length, 0, url);
		assert.equal(page.loaded, false);
		assert.deepEqual(page.items, []);
		if (page.allowed) assert.match(page.error, /no son válidos/);
	}
});

test('A2 401 redirects to login, 403 is a permission notice, other failures and malformed items are an alert', async () => {
	let env = await environment({ 'GET /oral-surgery-drafts': { status: 401, body: errorBody('UNAUTHORIZED', 'x') } });
	let page = await env.renderPage(listPage, { url: '/oral-surgery-admin?limit=50', state: LIST_STATE });
	assert.deepEqual(page.redirect, `/auth/login?returnTo=${encodeURIComponent('/oral-surgery-admin?limit=50')}`);
	env = await environment({ 'GET /oral-surgery-drafts': { status: 403, body: errorBody('FORBIDDEN', 'x') } });
	page = await env.renderPage(listPage, { url: '/oral-surgery-admin', state: LIST_STATE });
	assert.deepEqual([page.forbidden, page.error, page.loaded], [true, '', false]);
	for (const response of [{ status: 500, body: {} }, { network: true }, { body: { items: [{ ...draft(), status: 'closed' }] } }]) {
		env = await environment({ 'GET /oral-surgery-drafts': response });
		page = await env.renderPage(listPage, { url: '/oral-surgery-admin', state: LIST_STATE });
		assert.equal(page.forbidden, false);
		assert.match(page.error, /No se pudieron cargar/);
		assert.deepEqual(page.items, []);
	}
});

// A3: read-only detail page (S6).

test('A3 the detail reads the draft, consent, authorizations and report, and keeps the list query for the back link', async () => {
	const env = await environment(detailRoutes());
	const page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}?limit=20&offset=40`, state: DETAIL_STATE });
	assert.deepEqual(env.requests.map((request) => request.url), [
		`${apiBase}${draftPath}`, `${apiBase}${draftPath}/consent`, `${apiBase}${draftPath}/authorizations`, `${apiBase}${draftPath}/operative-report`,
	]);
	assert.equal(page.draft.id, draftId);
	assert.equal(page.report.status, 'draft');
	assert.equal(page.authorizationHistory.current_authorization_id, '11');
	assert.equal(page.backHref, '/oral-surgery-admin?limit=20&offset=40');
	assert.equal(page.cacheControl, 'no-store');
	const invalidBack = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}?limit=x`, state: DETAIL_STATE });
	assert.equal(invalidBack.backHref, '/oral-surgery-admin');
});

test('A3 a report 404 means no report, and a closed report is returned with its closure', async () => {
	let env = await environment(detailRoutes({ [`GET ${draftPath}/operative-report`]: { status: 404, body: errorBody('NOT_FOUND', 'oral surgery operative report was not found') } }));
	let page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}`, state: DETAIL_STATE });
	assert.deepEqual([page.report, page.reportError], [null, '']);
	env = await environment(detailRoutes({ [`GET ${draftPath}/operative-report`]: { body: closedReport } }));
	page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}`, state: DETAIL_STATE });
	assert.deepEqual([page.report.status, page.report.closed_by, page.report.closed_at], ['closed', teacherId, iso]);
});

test('A3 each history failure is isolated in its own alert and the draft still renders', async () => {
	const failing = { status: 500, body: {} };
	for (const [path, field] of [['consent', 'consentError'], ['authorizations', 'authorizationError'], ['operative-report', 'reportError']]) {
		const env = await environment(detailRoutes({ [`GET ${draftPath}/${path}`]: failing }));
		const page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}`, state: DETAIL_STATE });
		assert.equal(page.draft.id, draftId);
		for (const other of ['consentError', 'authorizationError', 'reportError']) {
			if (other === field) assert.match(page[other], /No se pudo/);
			else assert.equal(page[other], '', `${path} → ${other}`);
		}
	}
});

test('A3 invalid ids and non-admin sessions send no request; draft 404, 403, 401 and failures have their own states', async () => {
	for (const [id, actor] of [['0', admin()], ['abc', admin()], [draftId, admin({ role: 'teacher' })], [draftId, null]]) {
		const env = await environment(detailRoutes());
		const page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${id}`, id, actor, state: DETAIL_STATE });
		assert.equal(env.requests.length, 0);
		assert.equal(page.draft, null);
	}
	let env = await environment(detailRoutes({ [`GET ${draftPath}`]: { status: 404, body: errorBody('NOT_FOUND', 'x') } }));
	let page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}`, state: DETAIL_STATE });
	assert.deepEqual([page.unavailable, page.draft, env.requests.length], [true, null, 1]);
	env = await environment(detailRoutes({ [`GET ${draftPath}`]: { status: 403, body: errorBody('FORBIDDEN', 'x') } }));
	page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}`, state: DETAIL_STATE });
	assert.deepEqual([page.forbidden, page.draft], [true, null]);
	env = await environment(detailRoutes({ [`GET ${draftPath}`]: { status: 500, body: {} } }));
	page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}`, state: DETAIL_STATE });
	assert.match(page.loadError, /No se pudo cargar/);
	for (const path of ['', '/consent', '/operative-report']) {
		env = await environment(detailRoutes({ [`GET ${draftPath}${path}`]: { status: 401, body: errorBody('UNAUTHORIZED', 'x') } }));
		page = await env.renderPage(detailPage, { url: `/oral-surgery-admin/${draftId}?limit=50`, state: DETAIL_STATE });
		assert.equal(page.redirect, `/auth/login?returnTo=${encodeURIComponent(`/oral-surgery-admin/${draftId}?limit=50`)}`, path);
	}
});

// A4: read-only markup, compilation and navigation (S6).

test('A4 both pages compile and offer no mutating form or action', async () => {
	for (const path of [listPage, detailPage]) {
		const source = await readFile(new URL(path, root), 'utf8');
		const compiled = await transform(source, { filename: path });
		assert.equal(compiled.diagnostics.filter((item) => item.severity === 1).length, 0, path);
		assert.doesNotMatch(source, /method="POST"|astro:actions/i, path);
	}
	const list = await readFile(new URL(listPage, root), 'utf8');
	assert.match(list, /<form method="GET"/);
	assert.match(list, /No hay encuentros de Cirugía Oral I para estos filtros\./);
	assert.match(list, /Ver encuentro/);
	const detail = await readFile(new URL(detailPage, root), 'utf8');
	assert.match(detail, /<OperativeReportReadOnly report=\{report\} \/>/);
	assert.match(detail, /Sin parte quirúrgico registrado\./);
});

test('A4 the navigation shows Cirugía Oral I only to administrators with the read grant', async () => {
	const source = await readFile(new URL('src/layouts/Layout.astro', root), 'utf8');
	const frontmatter = source.split('---')[1].replace(/^import .*\.astro';\r?$/gm, '');
	const imports = frontmatter.match(/^import .*;\r?$/gm) ?? [];
	const body = frontmatter.replace(/^import .*;\r?$/gm, '');
	const layoutUrl = new URL('src/layouts/Layout.astro', root).href;
	async function shell(payload, pathname = '/') {
		const sandbox = vm.createContext({
			atob, Date,
			Astro: { cookies: { get: (name) => (name === 'session' ? { value: jwt({ exp: 4102444800, ...payload }) } : undefined) }, url: new URL(pathname, 'https://frontend.invalid') },
		});
		async function compile(code, identifier) {
			const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
			const module = new vm.SourceTextModule(output, { context: sandbox, identifier });
			await module.link(async (specifier, parent) => {
				const url = new URL(`${specifier}.ts`, parent.identifier);
				return compile(await readFile(url, 'utf8'), url.href);
			});
			return module;
		}
		const module = await compile(`${imports.join('\n')}\nexport function render() { ${body}\nreturn { clinicalLinks, peopleLinks, pageTitle }; }`, layoutUrl);
		await module.evaluate();
		return plain(module.namespace.render());
	}
	const visible = await shell({ role: 'admin', permissions: ['oral-surgery-drafts:read'] }, '/oral-surgery-admin/12');
	assert.deepEqual(visible.clinicalLinks, [{ href: '/oral-surgery-admin', label: 'Cirugía Oral I' }]);
	assert.equal(visible.pageTitle, 'Cirugía Oral I');
	assert.equal(visible.peopleLinks.length, 5);
	for (const payload of [
		{ role: 'admin' }, { role: 'admin', permissions: ['oral-surgery-drafts:read', null] }, { role: 'reception', permissions: ['oral-surgery-drafts:read'] },
	]) {
		assert.deepEqual((await shell(payload)).clinicalLinks, []);
	}
	assert.deepEqual((await shell({ role: 'student', permissions: ['oral-surgery-drafts:read'] })).clinicalLinks, [{ href: '/my-patients', label: 'Mis pacientes asignados' }]);
});
