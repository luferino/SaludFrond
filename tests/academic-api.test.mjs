import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/shared/academic-api.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = vm.createContext({ URLSearchParams });
const module = new vm.SourceTextModule(output, { context });
await module.link(() => { throw new Error('academic-api.ts must remain dependency-free'); });
await module.evaluate();
const { parseAcademicPagination, academicPaginationQuery, academicPaginationNavigation } = module.namespace;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('academic pagination parses defaults and bounded decimal values', () => {
	assert.deepEqual(plain(parseAcademicPagination(new URLSearchParams())), { limit: 50, offset: 0 });
	assert.deepEqual(plain(parseAcademicPagination(new URLSearchParams('limit=1&offset=10000'))), { limit: 1, offset: 10000 });
	assert.deepEqual(plain(parseAcademicPagination(new URLSearchParams('limit=100&offset=9'))), { limit: 100, offset: 9 });
});

test('academic pagination rejects invalid, repeated, and out-of-range values in Spanish', () => {
	for (const query of [
		'limit=', 'limit=0', 'limit=101', 'limit=-1', 'limit=+1', 'limit=1.5',
		'limit=Infinity', 'limit=1&limit=2', 'offset=', 'offset=-1', 'offset=10001',
		'offset=1.5', 'offset=Infinity', 'offset=0&offset=1', 'offset=999999999999999999999999999999999999999',
	]) {
		assert.throws(() => parseAcademicPagination(new URLSearchParams(query)), /paginación/i, query);
	}
});

test('academic pagination serializes query parameters and calculates bounded navigation', () => {
	assert.equal(academicPaginationQuery({ limit: 25, offset: 50 }), '?limit=25&offset=50');
	assert.deepEqual(plain(academicPaginationNavigation({ limit: 50, offset: 0, itemsLength: 50 })), {
		previousOffset: null, nextOffset: 50,
	});
	assert.deepEqual(plain(academicPaginationNavigation({ limit: 50, offset: 75, itemsLength: 50 })), {
		previousOffset: 25, nextOffset: 125,
	});
	assert.deepEqual(plain(academicPaginationNavigation({ limit: 50, offset: 10000, itemsLength: 50 })), {
		previousOffset: 9950, nextOffset: null,
	});
	assert.deepEqual(plain(academicPaginationNavigation({ limit: 50, offset: 10000, itemsLength: 0 })), {
		previousOffset: 9950, nextOffset: null,
	});
	assert.deepEqual(plain(academicPaginationNavigation({ limit: 50, offset: 30, itemsLength: 4 })), {
		previousOffset: 0, nextOffset: null,
	});
});
