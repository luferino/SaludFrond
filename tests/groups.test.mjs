import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const apiPath = 'src/pods/group/api.ts';
const source = (path) => readFile(new URL(path, root), 'utf8');
const sample = (overrides = {}) => ({
	id: 'group-1', academic_year: 2025, curriculum_semester: 3, name: 'Cohorte Norte', ...overrides,
});

async function evaluateApi(options = {}) {
	const cookieState = { value: 'operator-token' };
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
			return Response.json(options.response ?? { items: [sample()], limit: 7, offset: 14 }, {
				status: options.status ?? 200,
			});
		},
		Astro: { cookies },
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
			const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
			return compile(await readFile(resolved, 'utf8'), resolved.href);
		});
		return module;
	}
	const module = await compile(await source(apiPath), new URL(apiPath, root).href);
	await module.evaluate();
	return { api: module.namespace, cookies, cookieState, writes, requests };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const pagination = { limit: 7, offset: 14 };

test('listGroups sends an authenticated bounded GET and preserves backend identifying fields', async () => {
	const result = await evaluateApi();
	const listed = await result.api.listGroups(pagination, result.cookies);
	assert.equal(listed.state, 'success');
	assert.deepEqual(plain(listed.page), {
		items: [sample()], limit: 7, offset: 14,
	});
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, 'https://backend.invalid/groups?limit=7&offset=14');
	assert.equal(result.requests[0].method, 'GET');
	assert.equal(result.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(result.cookieState.value, 'operator-token');
	assert.deepEqual(result.writes, []);
});

test('listGroups validates page metadata and every identifying field including positive int32 values', async () => {
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
		response: { items: [sample({ academic_year: 2_147_483_647, curriculum_semester: 2_147_483_647 })], limit: 7, offset: 14 },
	});
	assert.equal((await maximum.api.listGroups(pagination, maximum.cookies)).state, 'success');
});

test('403 is denied while 500 and network failures are failed without clearing session', async () => {
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
