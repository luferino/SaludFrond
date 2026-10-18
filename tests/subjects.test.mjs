import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const apiPath = 'src/pods/subject/api.ts';

async function evaluate(options = {}) {
	let token = 'operator-token';
	const writes = [];
	const requests = [];
	const cookies = {
		get: (name) => name === 'session' && token ? { value: token } : undefined,
		delete: (...args) => { writes.push(['delete', ...args]); token = undefined; },
	};
	const context = vm.createContext({
		URL, URLSearchParams, Response, Error,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('Offline');
			const response = options.response ?? { items: [], limit: 50, offset: 0 };
			return Response.json(response, { status: options.status ?? 200 });
		},
	});

	async function compile(code, identifier) {
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, {
			context,
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
	return { listSubjects: module.namespace.listSubjects, cookies, requests, writes };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('listSubjects sends bounded authenticated pagination through apiFetch', async () => {
	const evaluated = await evaluate({
		response: { items: [{ id: 'subject-1', name: 'Anatomía' }], limit: 2, offset: 4 },
	});
	const result = await evaluated.listSubjects({ limit: 2, offset: 4 }, evaluated.cookies);
	assert.deepEqual(plain(result), {
		state: 'success',
		page: { items: [{ id: 'subject-1', name: 'Anatomía' }], limit: 2, offset: 4 },
	});
	assert.equal(evaluated.requests.length, 1);
	assert.equal(evaluated.requests[0].url, 'https://backend.invalid/subjects?limit=2&offset=4');
	assert.equal(evaluated.requests[0].method, 'GET');
	assert.equal(evaluated.requests[0].headers.Authorization, 'Bearer operator-token');
	assert.equal(evaluated.requests[0].headers['Content-Type'], 'application/json');
	assert.deepEqual(evaluated.writes, []);

	const defaults = await evaluate();
	await defaults.listSubjects({ limit: 50, offset: 0 }, defaults.cookies);
	assert.equal(defaults.requests[0].url, 'https://backend.invalid/subjects?limit=50&offset=0');
	assert.equal(defaults.requests[0].headers.Authorization, 'Bearer operator-token');
});

test('listSubjects accepts the pagination ceiling and an empty page', async () => {
	const evaluated = await evaluate({ response: { items: [], limit: 100, offset: 10000 } });
	const result = await evaluated.listSubjects({ limit: 100, offset: 10000 }, evaluated.cookies);
	assert.deepEqual(plain(result), { state: 'success', page: { items: [], limit: 100, offset: 10000 } });
	assert.equal(evaluated.requests[0].url, 'https://backend.invalid/subjects?limit=100&offset=10000');
	assert.equal(evaluated.requests[0].method, 'GET');
	assert.equal(evaluated.requests[0].headers.Authorization, 'Bearer operator-token');
});

test('listSubjects rejects malformed items and pagination echoes', async () => {
	for (const response of [
		{ items: [{ id: 'subject-1' }], limit: 50, offset: 0 },
		{ items: [{ id: 42, name: 'Anatomía' }], limit: 50, offset: 0 },
		{ items: [{ id: 'subject-1', name: null }], limit: 50, offset: 0 },
		{ items: {}, limit: 50, offset: 0 },
		{ items: [], limit: 25, offset: 0 },
		{ items: [], limit: 50, offset: 1 },
	]) {
		const evaluated = await evaluate({ response });
		const result = await evaluated.listSubjects({ limit: 50, offset: 0 }, evaluated.cookies);
		assert.deepEqual(plain(result), { state: 'failed' });
		assert.equal(evaluated.cookies.get('session').value, 'operator-token');
		assert.deepEqual(evaluated.writes, []);
	}
});

test('403 is denied while 500 and network failures are failed without clearing session', async () => {
	for (const [options, expected] of [
		[{ status: 403, response: { error: { message: 'Forbidden' } } }, 'denied'],
		[{ status: 500, response: { error: { message: 'Unavailable' } } }, 'failed'],
		[{ networkError: true }, 'failed'],
	]) {
		const evaluated = await evaluate(options);
		const result = await evaluated.listSubjects({ limit: 50, offset: 0 }, evaluated.cookies);
		assert.deepEqual(plain(result), { state: expected });
		assert.equal(evaluated.cookies.get('session').value, 'operator-token');
		assert.deepEqual(evaluated.writes, []);
	}
});

test('401 propagates from apiFetch and clears the session', async () => {
	const evaluated = await evaluate({ status: 401, response: { error: { message: 'Expired' } } });
	await assert.rejects(
		evaluated.listSubjects({ limit: 50, offset: 0 }, evaluated.cookies),
		(error) => error.status === 401 && error.code === 'UNAUTHORIZED',
	);
	assert.equal(evaluated.cookies.get('session'), undefined);
	assert.deepEqual(plain(evaluated.writes), [['delete', 'session', { path: '/' }]]);
});
