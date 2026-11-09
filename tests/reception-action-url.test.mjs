import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const HELPER = 'src/pods/reception/action-url.ts';
const PAGES = ['src/pages/reception/patients.astro', 'src/pages/reception/availability.astro'];
const PAGE_URL = 'http://localhost:4321/reception/patients';

// The helper has no imports, so it is transpiled and loaded from a data: URL.
async function loadHelper() {
	const code = await readFile(new URL(HELPER, root), 'utf8');
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
	return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

test('helper keeps career, patient_id and pagination and appends the action last', async () => {
	const { receptionActionUrl } = await loadHelper();
	const current = new URL('http://localhost:4321/reception/availability?career=kinesiology&patient_id=11111111-1111-4111-8111-111111111111&contexts_limit=10&contexts_offset=20&history_limit=5&history_offset=40');
	assert.equal(
		receptionActionUrl(current, '?_action=searchReceptionAvailabilityPatient'),
		'?career=kinesiology&patient_id=11111111-1111-4111-8111-111111111111&contexts_limit=10&contexts_offset=20&history_limit=5&history_offset=40&_action=searchReceptionAvailabilityPatient',
	);
});

test('helper output resolves against the page URL and keeps its pathname', async () => {
	const { receptionActionUrl } = await loadHelper();
	const current = new URL(`${PAGE_URL}?career=kinesiology&patient_id=11111111-1111-4111-8111-111111111111`);
	assert.equal(
		new URL(receptionActionUrl(current, '?_action=matchReceptionPatient'), current).href,
		`${PAGE_URL}?career=kinesiology&patient_id=11111111-1111-4111-8111-111111111111&_action=matchReceptionPatient`,
	);
});

test('helper replaces an existing _action so it appears exactly once, last', async () => {
	const { receptionActionUrl } = await loadHelper();
	const current = new URL(`${PAGE_URL}?career=kinesiology&_action=oldAction&patient_id=11111111-1111-4111-8111-111111111111`);
	assert.equal(
		receptionActionUrl(current, '?_action=reuseReceptionPatient'),
		'?career=kinesiology&patient_id=11111111-1111-4111-8111-111111111111&_action=reuseReceptionPatient',
	);
});

test('helper encodes preserved values and the action name', async () => {
	const { receptionActionUrl } = await loadHelper();
	const current = new URL(`${PAGE_URL}?career=kinesiology&note=a+b%26c%3D1&documento=12%2B3`);
	const output = receptionActionUrl(current, '?_action=updateReceptionPatientContact');
	assert.equal(output, '?career=kinesiology&note=a+b%26c%3D1&documento=12%2B3&_action=updateReceptionPatientContact');
	const params = new URLSearchParams(output.slice(1));
	assert.equal(params.get('note'), 'a b&c=1');
	assert.equal(params.get('documento'), '12+3');
});

test('helper works with no current query', async () => {
	const { receptionActionUrl } = await loadHelper();
	assert.equal(receptionActionUrl(new URL(PAGE_URL), '?_action=matchReceptionPatient'), '?_action=matchReceptionPatient');
});

test('helper keeps repeated career values so the page still treats them as ambiguous', async () => {
	const { receptionActionUrl } = await loadHelper();
	const current = new URL(`${PAGE_URL}?career=kinesiology&career=odontology`);
	const params = new URLSearchParams(receptionActionUrl(current, '?_action=matchReceptionPatient').slice(1));
	assert.deepEqual(params.getAll('career'), ['kinesiology', 'odontology']);
});

test('helper rejects a query string that names no action', async () => {
	const { receptionActionUrl } = await loadHelper();
	assert.throws(() => receptionActionUrl(new URL(PAGE_URL), '?career=kinesiology'), /action/);
});

test('reception pages never render a bare action={actions.X} URL', async () => {
	for (const path of PAGES) {
		const source = await readFile(new URL(path, root), 'utf8');
		assert.doesNotMatch(source, /action=\{actions\./, path);
	}
});

test('every POST form on the reception pages posts through the helper', async () => {
	for (const path of PAGES) {
		const source = await readFile(new URL(path, root), 'utf8');
		assert.match(source, /import \{ receptionActionUrl \} from '\.\.\/\.\.\/pods\/reception\/action-url';/, path);
		const postForms = [...source.matchAll(/<form\b[^>]*\bmethod="POST"[^>]*>/g)];
		assert.ok(postForms.length > 0, `${path} has POST forms`);
		for (const [tag] of postForms) {
			assert.match(tag, /action=\{receptionActionUrl\(Astro\.url, String\(actions\.\w+\)\)\}/, `${path}: ${tag}`);
		}
	}
});
