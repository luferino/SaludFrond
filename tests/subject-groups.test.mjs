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
			if (options.networkError) throw new Error('Offline');
			const status = options.status ?? 200;
			requests.push({ url, ...init, responseStatus: status });
			return Response.json(options.response ?? { items: [association()], limit: 7, offset: 14 }, { status });
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
			const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
			return compile(await readFile(resolved, 'utf8'), resolved.href);
		});
		return module;
	}
	const module = await compile(await readFile(new URL(apiPath, root), 'utf8'), new URL(apiPath, root).href);
	await module.evaluate();
	return { api: module.namespace, cookies, cookieState, writes, requests };
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
