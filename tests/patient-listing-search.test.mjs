import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const API = 'https://api.invalid';
const patient = {
	id: '11111111-1111-4111-8111-111111111111', documento: '12345678', nombres: 'Ana', apellidos: 'Pérez',
};
const canonicalPatient = {
	...patient, fecha_nacimiento: '1990-05-17', email: 'ana@example.invalid', celular: '5550100', sexo: 'F', direccion: 'Calle 1',
};

async function load(path, fetchImpl = async () => Response.json({})) {
	const context = vm.createContext({ URL, URLSearchParams, Response, Error, Date, atob, fetch: fetchImpl });
	const modules = new Map();
	async function resolve(href) {
		if (!modules.has(href)) {
			const pending = (async () => {
				const code = await readFile(new URL(href), 'utf8');
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const module = new vm.SourceTextModule(output, { context, identifier: href,
					initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: API }; },
				});
				await module.link((specifier, parent) => {
					if (specifier === 'astro') return new vm.SyntheticModule(['AstroCookies'], function () {}, { context });
					return resolve(new URL(`${specifier}.ts`, parent.identifier).href);
				});
				return module;
			})();
			modules.set(href, pending);
		}
		return modules.get(href);
	}
	const module = await resolve(new URL(path, root).href);
	await module.evaluate();
	return module.namespace;
}

function backend(body) {
	const calls = [];
	return {
		calls,
		fetch: async (url, init = {}) => {
			calls.push({ url: new URL(url), init });
			return Response.json(body);
		},
	};
}
const cookies = () => ({ get: () => ({ value: 'session-token' }), set() {}, delete() {} });
class TestApiError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }

async function renderAstroPage(path, options = {}) {
	let code = (await transform(await readFile(new URL(path, root), 'utf8'), { filename: path })).code;
	const ast = ts.createSourceFile('listing-page.ts', code, ts.ScriptTarget.Latest, true);
	const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement)
		|| statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
	async function html(value) {
		value = await value;
		if (value == null || value === false) return '';
		if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
		return String(value);
	}
	const Astro = {
		cookies: cookies(), url: new URL(`https://fixture.invalid${path === 'src/pages/patients.astro' ? '/patients' : '/reception/patients'}${options.query ? `?${options.query}` : ''}`),
		response: { headers: new Headers() }, redirect: (url) => ({ redirect: url }), getActionResult: () => undefined,
	};
	const actions = { matchReceptionPatient: 'match', reuseReceptionPatient: 'reuse', registerReceptionPatient: 'register', updateReceptionPatientContact: 'contact' };
	const mocks = {
		actions, ApiError: TestApiError, $$createAstro: () => Astro,
		isInputError: () => false, Layout: (_context, _props, slots) => slots?.default?.() ?? '',
		Fragment: (_context, _props, slots) => slots?.default?.() ?? '',
		PatientForm: () => '<form id="patient-create">patient creation</form>',
		getSession: () => 'session-token', decodeJwt: () => ({ role: path === 'src/pages/patients.astro' ? 'admin' : 'reception' }),
		listPatients: async () => {
			if (options.listError) throw options.listError;
			return { items: options.items ?? [], limit: options.limit ?? 50, offset: options.offset ?? 0 };
		},
		parsePatientListing: (params) => ({ q: (params.get('q') ?? '').trim(), limit: Number(params.get('limit') ?? 50), offset: Number(params.get('offset') ?? 0) }),
		academicPaginationNavigation: ({ limit, offset, itemsLength }) => ({ previousOffset: offset > 0 ? Math.max(0, offset - limit) : null, nextOffset: itemsLength === limit ? offset + limit : null }),
		loadReceptionPatientsState: async () => options.receptionState,
		resolveReceptionPatientsAccess: () => 'ok', RECEPTION_CAREER_LABELS: { kinesiology: 'Kinesiología', odontology: 'Odontología' },
		receptionActionUrl: () => '?_action=fixture', isUuid: () => false,
		$$createAstro: () => ({}), $$createComponent: (component) => component,
		$$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
		$$renderComponent: async (_result, _name, component, props, slots) => typeof component === 'function' ? component({ createAstro: () => Astro }, props, slots) : slots?.default?.() ?? '',
		$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${escape(value)}"`,
		$$maybeRenderHead: () => '', $$renderHead: () => '',
	};
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	const rendered = await exports.default({ createAstro: () => Astro }, {}, {});
	const isRedirect = rendered && typeof rendered === 'object' && 'redirect' in rendered;
	return { html: isRedirect ? '' : await html(rendered), result: rendered, Astro };
}

test('admin patient listing serializes literal q and pagination and validates paginated DTO', async () => {
	const net = backend({ items: [canonicalPatient], limit: 50, offset: 0 });
	const api = await load('src/pods/paciente/listing.ts', net.fetch);
	const result = await api.listPatients({ q: '  Ana%_\\  ', limit: 50, offset: 0 }, cookies());
	assert.equal(result.items.length, 1);
	assert.deepEqual(JSON.parse(JSON.stringify(result.items[0])), canonicalPatient);
	assert.equal(net.calls[0].url.pathname, '/patients');
	assert.equal(net.calls[0].url.searchParams.get('q'), 'Ana%_\\');
	assert.equal(net.calls[0].url.searchParams.get('limit'), '50');
	assert.equal(net.calls[0].url.searchParams.get('offset'), '0');
	assert.equal(net.calls[0].init.method, 'GET');
	for (const invalid of [null, {}, { items: [patient], limit: 50, offset: 0, total: 1 }, { items: [{}], limit: 50, offset: 0 }]) {
		const bad = backend(invalid);
		await assert.rejects((await load('src/pods/paciente/listing.ts', bad.fetch)).listPatients({ q: '', limit: 50, offset: 0 }, cookies()), /inválid/i);
	}
});

test('admin listing accepts the exact canonical nine-field patient DTO without requiring numeric-only documents', async () => {
	const canonical = { ...canonicalPatient, documento: 'D-123' };
	const net = backend({ items: [canonical], limit: 50, offset: 0 });
	const api = await load('src/pods/paciente/listing.ts', net.fetch);
	const result = await api.listPatients({ q: '', limit: 50, offset: 0 }, cookies());
	assert.deepEqual(JSON.parse(JSON.stringify(result.items[0])), canonical);
});

test('compiled admin HTML renders search state, canonical DTO names, and q-preserving pager links', async () => {
	const rows = Array.from({ length: 50 }, (_, index) => ({ ...canonicalPatient, id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111` }));
	const result = await renderAstroPage('src/pages/patients.astro', { query: 'q=Ana%25&limit=50&offset=0', items: rows });
	assert.match(result.html, /name="q" type="search"[^>]*value="Ana%"/);
	assert.match(result.html, /<strong[^>]*>Pérez, Ana<\/strong> · Doc\. 12345678/);
	assert.match(result.html, /href="\?limit=50&amp;offset=50&amp;q=Ana%25"/);
	assert.match(result.html, /id="patient-create"/);
	assert.equal(result.Astro.response.headers.get('Cache-Control'), 'no-store');
});

test('compiled admin HTML redirects 401 and keeps 403/500 as errors rather than empty results', async () => {
	const unauthorized = await renderAstroPage('src/pages/patients.astro', { listError: new TestApiError(401) });
	assert.deepEqual(unauthorized.result, { redirect: '/auth/login?returnTo=%2Fpatients' });
	assert.equal(unauthorized.Astro.response.headers.get('Cache-Control'), 'no-store');
	for (const status of [403, 500]) {
		const failed = await renderAstroPage('src/pages/patients.astro', { listError: new TestApiError(status) });
		assert.match(failed.html, /role="alert"/);
		assert.doesNotMatch(failed.html, /No se encontraron pacientes/);
	}
});

test('compiled Reception HTML distinguishes filtered/page-empty results from an empty career registry', async () => {
	for (const { q, offset, expected } of [
		{ q: 'Bea', offset: 0, expected: 'No se encontraron pacientes con estos filtros.' },
		{ q: '', offset: 100, expected: 'No se encontraron pacientes con estos filtros.' },
		{ q: '', offset: 0, expected: 'Todavía no hay pacientes vinculados a esta carrera.' },
	]) {
		const rendered = await renderAstroPage('src/pages/reception/patients.astro', { query: `career=kinesiology&q=${encodeURIComponent(q)}&offset=${offset}`, receptionState: {
			kind: 'list', careers: ['kinesiology'], career: 'kinesiology', patients: [], q,
			page: { limit: 100, offset }, navigation: { previousOffset: offset ? 0 : null, nextOffset: null },
		} });
		assert.ok(rendered.html.includes(expected));
		assert.match(rendered.html, /type="hidden" name="career" value="kinesiology"/);
		if (q || offset) assert.doesNotMatch(rendered.html, /Todavía no hay pacientes vinculados a esta carrera/);
		else assert.doesNotMatch(rendered.html, /No se encontraron pacientes con estos filtros/);
	}
});

test('admin listing rejects duplicate or overlong q before any request and leaves exact document action distinct', async () => {
	const net = backend({ items: [], limit: 50, offset: 0 });
	const api = await load('src/pods/paciente/listing.ts', net.fetch);
	for (const params of [new URLSearchParams('q=Ana&q=Bea'), new URLSearchParams(`q=${'x'.repeat(101)}`), new URLSearchParams('q[name]=Ana')]) {
		assert.throws(() => api.parsePatientListing(params), /q/i);
	}
	assert.equal(net.calls.length, 0);
});

test('Reception listing carries current career, literal q and pagination; old page size defaults to 100', async () => {
	const receptionPatient = { ...patient, fecha_nacimiento: '1990-05-17', email: 'ana@example.invalid', celular: '5550100', sexo: 'F', direccion: 'Calle 1' };
	const net = backend({ items: [receptionPatient], limit: 100, offset: 100 });
	const api = await load('src/pods/reception-patient/api.ts', net.fetch);
	const result = await api.listReceptionPatients('kinesiology', cookies(), { q: 'A%_\\', limit: 100, offset: 100 });
	assert.equal(result.length, 1);
	assert.equal(net.calls[0].url.pathname, '/reception/patients');
	assert.equal(net.calls[0].url.searchParams.get('career'), 'kinesiology');
	assert.equal(net.calls[0].url.searchParams.get('q'), 'A%_\\');
	assert.equal(net.calls[0].url.searchParams.get('limit'), '100');
	assert.equal(net.calls[0].url.searchParams.get('offset'), '100');
});

test('Reception state rejects duplicate and overlong q without requesting a patient list', async () => {
	for (const search of ['career=kinesiology&q=a&q=b', `career=kinesiology&q=${'x'.repeat(101)}`, 'career=kinesiology&q[name]=Ana']) {
		const calls = [];
		const api = await load('src/pods/reception-patient/state.ts', async (url) => {
			calls.push(new URL(url).pathname);
			return Response.json(new URL(url).pathname === '/reception/careers' ? { careers: ['kinesiology'] } : { items: [] });
		});
		const state = await api.loadReceptionPatientsState(new URLSearchParams(search), cookies());
		assert.equal(state.kind, 'invalid-search');
		assert.deepEqual(calls, ['/reception/careers']);
	}
});

test('Reception state uses limit 100 by default and preserves q and career in adjacent pages', async () => {
	const receptionPatient = { ...patient, fecha_nacimiento: null, email: 'ana@example.invalid', celular: '5550100', sexo: 'F', direccion: 'Calle 1' };
	const calls = [];
	const api = await load('src/pods/reception-patient/state.ts', async (url) => {
		const parsed = new URL(url);
		calls.push(`${parsed.pathname}${parsed.search}`);
		return Response.json(parsed.pathname === '/reception/careers'
			? { careers: ['kinesiology'] }
			: { items: [receptionPatient], limit: 100, offset: 100 });
	});
	const state = await api.loadReceptionPatientsState(new URLSearchParams('career=kinesiology&q=Ana%25_%5C&offset=100'), cookies());
	assert.equal(state.kind, 'list');
	assert.equal(state.q, 'Ana%_\\');
	assert.deepEqual(JSON.parse(JSON.stringify(state.page)), { limit: 100, offset: 100, q: 'Ana%_\\' });
	assert.deepEqual(JSON.parse(JSON.stringify(state.navigation)), { previousOffset: 0, nextOffset: null });
	assert.equal(calls[1], '/reception/patients?career=kinesiology&limit=100&offset=100&q=Ana%25_%5C');
});
