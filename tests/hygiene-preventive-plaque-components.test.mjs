import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Compiled output of the plaque editor fields (D1) and of the read-only plaque section (D8 pattern), with the
// real pods modules. Imports are replaced by the modules' own exports; no page or browser is involved.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const editorPage = 'src/components/clinical/HygienePlaqueFields.astro';
const readOnlyPage = 'src/components/clinical/HygieneReadOnly.astro';
const plaqueStored = {
	loe_silness: { teeth: { 16: { distal: 2, vestibular: 2, mesial: 2, lingual: 1 }, 36: { mesial: 0 } }, average: 1.75, category: 'abundant' },
	oleary: { teeth: { 11: { mesial: true, distal: false, vestibular: false, lingual: false } }, stained_surfaces: 1, present_surfaces: 4, percentage: 25, category: 'good' },
};
const content = {
	medical_history: { diabetes: false },
	odontogram: { 16: { state: 'present' } },
	indices: { cpo_d: { c: 2, p: 1, o: 3, total: 6 }, ceo_d: null },
};

// Pods modules load with a stand-in for apiClient and session; api.ts reads the session only for an empty delete.
class FixtureApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const apiShim = { apiFetch: async () => { throw new Error('no request expected'); }, ApiError: FixtureApiError };
const sessionShim = { getSession: () => null, clearSession: () => undefined };

async function loadCjs(path, shims = {}) {
	const output = ts.transpileModule(await readFile(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', 'require', '__env', output.replaceAll('import.meta.env', '__env'))(exports, (name) => { if (!(name in shims)) throw new Error(`unshimmed ${name}`); return shims[name]; }, { PUBLIC_API_URL: 'https://backend.invalid' });
	return exports;
}
const hygieneApi = await loadCjs('src/pods/hygiene-preventive-draft/api.ts', { '../../shared/apiClient': apiShim, '../../shared/session': sessionShim });
const labels = await loadCjs('src/pods/hygiene-preventive-draft/labels.ts');
const odontogram = await loadCjs('src/pods/hygiene-preventive-draft/odontogram.ts');

async function html(value) {
	value = await value;
	if (value == null || value === false) return '';
	if (Array.isArray(value)) return (await Promise.all(value.map(html))).join('');
	return String(value);
}
const helpers = {
	$$createAstro: () => ({}), $$createComponent: (component) => component,
	$$render: async (strings, ...values) => { let output = ''; for (let i = 0; i < strings.length; i++) output += strings[i] + await html(values[i]); return output; },
	$$addAttribute: (value, name) => value === false || value == null ? '' : value === true ? ` ${name}` : ` ${name}="${value}"`,
	$$maybeRenderHead: () => '', $$renderHead: () => '',
};
const renderComponent = async (_result, _name, component, props, slots) => (typeof component === 'function' ? component({ createAstro: () => ({ props }) }, props, slots) : slots?.default?.() ?? '');

/** Strips the imports and runs the compiled component body with the given mocks; the mocks replace every import. */
async function compileAstro(path, mocks) {
	let code = (await transform(await readFile(new URL(path, root), 'utf8'), { filename: path })).code;
	const ast = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true);
	const removals = ast.statements.filter((s) => ts.isImportDeclaration(s) || s.getText(ast).startsWith('export const $$metadata')).map((s) => [s.getFullStart(), s.getEnd()]);
	for (const [start, end] of removals.reverse()) code = code.slice(0, start) + code.slice(end);
	const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function('exports', ...Object.keys(mocks), output)(exports, ...Object.values(mocks));
	return exports.default;
}
const mocks = { ...hygieneApi, ...labels, ...odontogram, ...helpers, Fragment: null, $$renderComponent: renderComponent };
const editorComponent = (...args) => compileAstro(editorPage, mocks).then((component) => component(...args));
const readOnlyComponent = (...args) => compileAstro(readOnlyPage, mocks).then((component) => component(...args));

const renderEditor = async (props) => String(await editorComponent({ createAstro: () => ({ props }) }, props, {}));
const renderReadOnly = async (props) => String(await readOnlyComponent({ createAstro: () => ({ props }) }, props, {}));
const count = (text, pattern) => (text.match(pattern) ?? []).length;

// D1 editor fields: controls, disabled state and the server results shown read-only.

test('D1 the plaque fieldset is titled «Índices de placa» and is disabled when the editor is read-only', async () => {
	const readOnly = await renderEditor({ values: {}, stored: undefined, editable: false });
	assert.match(readOnly, /<fieldset[^>]*\bdisabled\b[^>]*class="plaque[^"]*"/);
	assert.match(readOnly, /<legend[^>]*>Índices de placa<\/legend>/);
	const editable = await renderEditor({ values: {}, stored: undefined, editable: true });
	assert.doesNotMatch(editable, /<fieldset[^>]*\bdisabled\b[^>]*class="plaque[^"]*"/);
	assert.match(editable, /<fieldset[^>]*class="plaque[^"]*"/);
});

test('D1 the Löe-Silness table has one row per index tooth with four site selects and the grade options', async () => {
	const out = await renderEditor({ values: {}, stored: undefined, editable: true });
	assert.equal(count(out, /<select name="plaque\.loe_silness\.\d+\.(distal|vestibular|mesial|lingual)"/g), 24);
	assert.equal(count(out, /<tr[ >]/g), 7);
	for (const code of ['16', '21', '24', '36', '41', '44']) assert.match(out, new RegExp(`<select name="plaque\\.loe_silness\\.${code}\\.distal"`));
	assert.match(out, /<option value="" [^>]*>No presente<\/option>/);
	for (const grade of ['0', '1', '2', '3']) assert.match(out, new RegExp(`<option value="${grade}"[^>]*>${grade}<\/option>`));
	assert.match(out, /aria-label="Pieza 16 · Lingual \/ palatino"/);
});

test('D1 selects and checkboxes show the values they are given as selected and checked', async () => {
	const out = await renderEditor({
		values: { 'plaque.loe_silness.16.distal': '2', 'plaque.loe_silness.16.lingual': '0', 'plaque.oleary.11.evaluated': 'on', 'plaque.oleary.11.mesial': 'on' },
		stored: undefined,
		editable: true,
	});
	assert.match(out, /<option value="2" selected[^>]*>2<\/option>/);
	assert.match(out, /<option value="0" selected[^>]*>0<\/option>/);
	assert.match(out, /name="plaque\.oleary\.11\.evaluated" value="on" checked/);
	assert.match(out, /name="plaque\.oleary\.11\.mesial" value="on" checked/);
	assert.doesNotMatch(out, /name="plaque\.oleary\.11\.distal" value="on" checked/);
});

test('D1 O\'Leary groups all 52 teeth by chart row, each with an evaluated box and four surface boxes named by tooth and surface', async () => {
	const out = await renderEditor({ values: {}, stored: undefined, editable: true });
	assert.equal(count(out, /name="plaque\.oleary\.\d+\.evaluated" value="on"/g), 52);
	assert.equal(count(out, /name="plaque\.oleary\.\d+\.(mesial|distal|vestibular|lingual)" value="on"/g), 208);
	assert.match(out, /Evaluada/);
	assert.match(out, /Pieza 11 · Mesial teñida/);
	assert.match(out, /Pieza 85 · Lingual \/ palatino teñida/);
	for (const row of ['Permanentes superiores', 'Temporales superiores', 'Temporales inferiores', 'Permanentes inferiores']) assert.match(out, new RegExp(row));
});

test('D1 loaded server results show Spanish decimal copy and «Sin datos» when a result is null', async () => {
	const out = await renderEditor({ values: {}, stored: plaqueStored, editable: true });
	assert.match(out, /Calculado por el servidor: promedio 1,75 · ABUNDANTE/);
	assert.match(out, /Calculado por el servidor: 1 de 4 superficies teñidas · 25 % · BUENO/);
	const nullResults = await renderEditor({
		values: {},
		stored: { loe_silness: { teeth: {}, average: null, category: null }, oleary: { teeth: {}, stained_surfaces: 0, present_surfaces: 0, percentage: null, category: null } },
		editable: true,
	});
	assert.match(nullResults, /Calculado por el servidor: Sin datos/);
	assert.equal(count(nullResults, /Sin datos/g), 2);
});

test('D1 an absent or null stored section shows no server result', async () => {
	const absent = await renderEditor({ values: {}, stored: undefined, editable: true });
	assert.doesNotMatch(absent, /Calculado por el servidor/);
	const nulls = await renderEditor({ values: {}, stored: { loe_silness: null, oleary: null }, editable: true });
	assert.doesNotMatch(nulls, /Calculado por el servidor/);
});

test('D1 the editor is script-free and its styles keep narrow screens from widening the page', async () => {
	const out = await renderEditor({ values: {}, stored: plaqueStored, editable: true });
	assert.doesNotMatch(out, /<script|onclick|onchange/);
	const source = await readFile(new URL(editorPage, root), 'utf8');
	assert.match(source, /min-inline-size:\s*0/);
	assert.match(source, /overflow-x:\s*auto/);
});

test('the plaque table keeps readable cells and exposes a keyboard-accessible scroll region', async () => {
	const out = await renderEditor({ values: {}, stored: plaqueStored, editable: true });
	assert.match(out, /role="region"[^>]*aria-labelledby="plaque-loe-title"[^>]*tabindex="0"/);
	assert.match(out, /Desplazá la tabla horizontalmente para ver todos los sitios\./);
	const source = await readFile(new URL(editorPage, root), 'utf8');
	assert.match(source, /table\s*\{[^}]*inline-size:\s*max-content/);
	assert.match(source, /th, td\s*\{[^}]*white-space:\s*nowrap/);
});

// D8 pattern read-only plaque section after Índices (D4 teacher and admin view).

test('the read-only plaque section follows Índices and lists recorded Löe-Silness teeth with their graded sites and the average', async () => {
	const out = await renderReadOnly({ content: { ...content, plaque: plaqueStored } });
	const indices = out.indexOf('id="hygiene-indices-title"');
	const plaque = out.indexOf('id="hygiene-plaque-title"');
	assert.ok(indices > 0 && plaque > indices);
	assert.match(out, /Pieza 16 · Distal: 2 · Vestibular: 2 · Mesial: 2 · Lingual \/ palatino: 1/);
	assert.match(out, /Pieza 36 · Mesial: 0/);
	assert.match(out, /Promedio: 1,75 · ABUNDANTE/);
});

test('the read-only O\'Leary list names stained surfaces or none, and gives the server count, percentage and category', async () => {
	const out = await renderReadOnly({ content: { ...content, plaque: plaqueStored } });
	assert.match(out, /Pieza 11 · teñidas: mesial/);
	assert.match(out, /1 de 4 superficies teñidas · 25 % · BUENO/);
	const unstained = await renderReadOnly({
		content: { ...content, plaque: { oleary: { teeth: { 12: { mesial: false, distal: false, vestibular: false, lingual: false } }, stained_surfaces: 0, present_surfaces: 4, percentage: 0, category: 'good' } } },
	});
	assert.match(unstained, /Pieza 12 · sin superficies teñidas/);
});

test('a null average or percentage shows «Sin datos» in the read-only plaque section', async () => {
	const out = await renderReadOnly({
		content: { ...content, plaque: { loe_silness: { teeth: {}, average: null, category: null }, oleary: { teeth: {}, stained_surfaces: 0, present_surfaces: 0, percentage: null, category: null } } },
	});
	assert.match(out, /Promedio: Sin datos/);
	assert.match(out, /Sin datos/);
});

test('an absent or null plaque section shows «No cargado» in the read-only view, and no form controls appear', async () => {
	const absent = await renderReadOnly({ content });
	const plaqueAbsent = absent.slice(absent.indexOf('id="hygiene-plaque-title"'));
	assert.equal(count(plaqueAbsent, /No cargado/g), 2);
	const nulls = await renderReadOnly({ content: { ...content, plaque: { loe_silness: null, oleary: null } } });
	assert.equal(count(nulls.slice(nulls.indexOf('id="hygiene-plaque-title"')), /No cargado/g), 2);
	for (const out of [absent, nulls, await renderReadOnly({ content: { ...content, plaque: plaqueStored } })]) {
		assert.doesNotMatch(out, /<form|<input|<select|<button|<script/);
	}
});
