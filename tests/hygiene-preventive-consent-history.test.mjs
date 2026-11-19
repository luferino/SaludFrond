import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Shared read-only consent history (S3, D5/D6 consumers): the same list for the editor, the teacher and the admin pages.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const componentPath = 'src/components/clinical/HygieneConsentHistory.astro';
const iso = '2026-11-06T12:00:00.000Z';
const authorId = '11111111-2222-4333-8444-555555555555';
const draftId = '9223372036854775807';

const declaration = (overrides = {}) => ({
	id: '11', draft_id: draftId, signer: 'patient', signer_name: 'Ana Pérez', signer_document: '12345678', declared_by: authorId, declared_at: iso, ...overrides,
});
const twoDeclarations = {
	current_declaration_id: '12',
	declarations: [
		declaration({ id: '11' }),
		declaration({ id: '12', signer: 'parent', signer_name: 'Laura Pérez', signer_document: '30123456', declared_at: '2026-11-07T09:30:00.000Z' }),
	],
};

async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}

/** Compiles the component with the real labels; its only import is the labels module. */
async function render(props) {
	const source = await readFile(new URL(componentPath, root), 'utf8');
	const code = (await transform(source, { filename: componentPath })).code;
	const ast = ts.createSourceFile('history.ts', code, ts.ScriptTarget.Latest, true);
	let stripped = code;
	const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) stripped = stripped.slice(0, start) + stripped.slice(end);
	const output = ts.transpileModule(stripped, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const labelsSource = await readFile(new URL('src/pods/hygiene-preventive-draft/labels.ts', root), 'utf8');
	const labelsOutput = ts.transpileModule(labelsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const labelsExports = {};
	new Function('exports', 'require', labelsOutput)(labelsExports, () => ({}));
	const mocks = {
		...labelsExports, ...helpers(), Fragment: null,
	};
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	return html(await exports.default({ createAstro: () => ({ props }) }, props, {}));
}

function helpers() {
	return {
		$$createAstro: () => ({}), $$createComponent: (component) => component,
		$$render: async (strings, ...values) => { let output = ''; for (let index = 0; index < strings.length; index++) output += strings[index] + await html(values[index]); return output; },
		$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
		$$maybeRenderHead: () => '', $$renderHead: () => '', $$unescapeHTML: (value) => value,
	};
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('S3 the history lists declarations oldest first with the signer, the name, the documento and the declaration time', async () => {
	const out = await render({ consent: twoDeclarations });
	assert.equal(count(out, /<li[ >]/g), 2);
	assert.ok(out.indexOf('Ana Pérez') < out.indexOf('Laura Pérez'), 'oldest first');
	assert.match(out, /Paciente/);
	assert.match(out, /Madre, padre o tutor/);
	assert.match(out, /12345678/);
	assert.match(out, /30123456/);
	assert.match(out, /<time datetime="2026-11-07T09:30:00\.000Z"/);
});

test('S3 only the current declaration carries the vigente mark', async () => {
	const out = await render({ consent: twoDeclarations });
	const items = out.split(/<li[ >]/).slice(1);
	assert.equal(count(out, /vigente/g), 1);
	assert.doesNotMatch(items[0], /vigente/);
	assert.match(items[1], /vigente/);
});

test('S3 an empty history says that no declaration exists', async () => {
	const out = await render({ consent: { current_declaration_id: null, declarations: [] } });
	assert.match(out, /No hay consentimiento declarado para este borrador\./);
	assert.doesNotMatch(out, /<li[ >]/);
});

test('S3 the history is read-only: no form, no action and no script', async () => {
	const out = await render({ consent: twoDeclarations });
	assert.doesNotMatch(out, /<form|method="POST"|<button|<script|<input/);
});
