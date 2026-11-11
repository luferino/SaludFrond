import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/pods/subject/list-search.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, URLSearchParams });
const { parseListSearch, parseCareerContext, listingSearchQuery, INVALID_LIST_SEARCH } = module.exports;

test('catalog search parser trims literal text, bounds its length and rejects structured values', () => {
	assert.deepEqual(JSON.parse(JSON.stringify(parseListSearch(new URLSearchParams('q=%25_%5C+Anatom%C3%ADa+')))), {
		valid: true, term: '%_\\ Anatomía',
	});
	assert.deepEqual(JSON.parse(JSON.stringify(parseListSearch(new URLSearchParams('q=+')))), { valid: true, term: '' });
	for (const query of ['q=a&q=b', `q=${'x'.repeat(101)}`, 'q%5B%5D=grupo', 'q%2Efoo=grupo']) {
		assert.equal(parseListSearch(new URLSearchParams(query)).valid, false, query);
	}
	assert.match(INVALID_LIST_SEARCH, /100/);
});

test('career context requires one UUID when supplied and leaves omission unfiltered', () => {
	assert.deepEqual(JSON.parse(JSON.stringify(parseCareerContext(new URLSearchParams('')))), { valid: true, careerId: null });
	assert.deepEqual(JSON.parse(JSON.stringify(parseCareerContext(new URLSearchParams('career_id=11111111-1111-4111-8111-111111111111')))), {
		valid: true, careerId: '11111111-1111-4111-8111-111111111111',
	});
	for (const query of [
		'career_id=11111111-1111-4111-8111-111111111111&career_id=22222222-2222-4222-8222-222222222222',
		'career_id%5B%5D=11111111-1111-4111-8111-111111111111',
		'career_id%2Evalue=11111111-1111-4111-8111-111111111111',
		'career_id=not-a-uuid',
	]) assert.equal(parseCareerContext(new URLSearchParams(query)).valid, false, query);
});

test('catalog query encoding retains literal wildcards and career context', () => {
	assert.equal(listingSearchQuery('%_\\ Anatomía', 'career-1').toString(), 'career_id=career-1&q=%25_%5C+Anatom%C3%ADa');
});
