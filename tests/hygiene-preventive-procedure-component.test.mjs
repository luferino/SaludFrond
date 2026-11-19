import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Shared procedure log (S4, D4): the same list for the editor, the teacher and the admin pages. Read-only by default; the
// `editing` prop adds the author's edit and delete forms under each pending entry.
const require = createRequire(import.meta.resolve('astro/package.json'));
const { transform } = require('@astrojs/compiler');
const root = new URL('../', import.meta.url);
const componentPath = 'src/components/clinical/HygieneProcedureLog.astro';
const iso = '2026-11-06T12:00:00.000Z';
const approvedIso = '2026-11-07T09:30:00.000Z';
const authorId = '11111111-2222-4333-8444-555555555555';
const draftId = '9223372036854775807';
const UPDATE = '/_actions/updateHygieneProcedure?assignment_id=17';
const DELETE = '/_actions/deleteHygieneProcedure?assignment_id=17';
const carriers = [['id', draftId], ['assignment_id', '17'], ['limit', '50'], ['offset', '0']];
const editing = { updateHref: UPDATE, deleteHref: DELETE, carriers, maxDate: '2026-11-19' };

const entry = (overrides = {}) => ({
	id: '21', draft_id: draftId, procedure_date: '2026-11-10', description: 'Profilaxis\nAplicación de flúor', author_id: authorId,
	student_name: 'Ana Pérez', version: '4', approved_by: null, teacher_name: null, approved_at: null,
	created_at: iso, updated_at: iso, status: 'pending', ...overrides,
});
const approved = (overrides = {}) => entry({
	id: '22', procedure_date: '2026-11-08', description: 'Destartraje', version: '5',
	approved_by: '77777777-7777-4777-8777-777777777777', teacher_name: 'Marta Gómez', approved_at: approvedIso, status: 'approved', ...overrides,
});

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
	const ast = ts.createSourceFile('procedures.ts', code, ts.ScriptTarget.Latest, true);
	let stripped = code;
	const removals = ast.statements.filter((statement) => ts.isImportDeclaration(statement) || statement.getText(ast).startsWith('export const $$metadata'))
		.map((statement) => [statement.getFullStart(), statement.getEnd()]);
	for (const [start, end] of removals.reverse()) stripped = stripped.slice(0, start) + stripped.slice(end);
	const output = ts.transpileModule(stripped, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const labelsSource = await readFile(new URL('src/pods/hygiene-preventive-draft/labels.ts', root), 'utf8');
	const labelsOutput = ts.transpileModule(labelsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const labels = {};
	new Function('exports', 'require', labelsOutput)(labels, () => ({}));
	const mocks = { ...labels, ...helpers(), Fragment: null };
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
		// Astro compiles <> fragments through this helper; the slot holds their content.
		$$renderComponent: async (_result, _name, component, props, slots) => (typeof component === 'function' ? component({ createAstro: () => ({ props }) }, props, slots) : slots?.default?.() ?? ''),
	};
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;
/** One form, from its opening tag (found through its id) to its closing tag. */
const formOf = (text, id) => {
	const marker = text.indexOf(`id="${id}"`);
	if (marker < 0) return '';
	return text.slice(text.lastIndexOf('<form', marker), text.indexOf('</form>', marker));
};

test('S4 the log lists entries in the order given, with date, description, author and status', async () => {
	const out = await render({ procedures: [entry(), approved()] });
	assert.equal(count(out, /<li[ >]/g), 2);
	assert.ok(out.indexOf('Profilaxis') < out.indexOf('Destartraje'), 'creation order is kept');
	assert.match(out, /2026-11-10/);
	assert.match(out, /Registrado por Ana Pérez/);
	assert.match(out, /Pendiente/);
});

test('D4 an approved entry shows the approving teacher and the approval time instead of the pending status', async () => {
	const out = await render({ procedures: [approved()] });
	assert.match(out, /Aprobado por Marta Gómez · <time/);
	assert.doesNotMatch(out, /Pendiente/);
});

test('D4 the description keeps its line breaks through the stylesheet, which the rendered markup does not carry', async () => {
	const out = await render({ procedures: [entry({ description: 'Nota\nSegunda línea' })] });
	assert.match(out, /Segunda línea/);
	const source = await readFile(new URL(componentPath, root), 'utf8');
	assert.match(source, /\.description \{ white-space: pre-wrap;/);
});

test('D4 an empty log says that no procedure is registered yet', async () => {
	const out = await render({ procedures: [] });
	assert.match(out, /Todavía no hay procedimientos registrados\./);
	assert.doesNotMatch(out, /<li[ >]/);
});

test('D4 without the editing prop the log is read-only: no form and no button', async () => {
	const out = await render({ procedures: [entry(), approved()] });
	assert.doesNotMatch(out, /<form|<button|<input/);
});

test('D4 with the editing prop each pending entry gets an edit and a delete form, and approved entries get none', async () => {
	const out = await render({ procedures: [entry(), approved()], editing });
	assert.equal(count(out, /<form /g), 2, 'one edit and one delete form, for the pending entry only');
	assert.match(formOf(out, 'procedure-edit-21'), /action="\/_actions\/updateHygieneProcedure\?assignment_id=17"/);
	assert.match(formOf(out, 'procedure-delete-21'), /action="\/_actions\/deleteHygieneProcedure\?assignment_id=17"/);
	assert.doesNotMatch(out, /procedure-edit-22|procedure-delete-22/);
});

test('D4 each form carries the draft and list coordinates, and the entry id and its own version', async () => {
	const out = await render({ procedures: [entry({ version: '7' })], editing });
	for (const id of ['procedure-edit-21', 'procedure-delete-21']) {
		const form = formOf(out, id);
		assert.match(form, /<input type="hidden" name="id" value="9223372036854775807"/, id);
		assert.match(form, /<input type="hidden" name="assignment_id" value="17"/, id);
		assert.match(form, /<input type="hidden" name="limit" value="50"/, id);
		assert.match(form, /<input type="hidden" name="offset" value="0"/, id);
		assert.match(form, /<input type="hidden" name="procedure_id" value="21"/, id);
		assert.match(form, /<input type="hidden" name="expected_version" value="7"/, id);
	}
});

test('D4 the edit form has the date input with max and the description with its limit, and the delete form asks for confirmation', async () => {
	const out = await render({ procedures: [entry()], editing });
	const edit = formOf(out, 'procedure-edit-21');
	assert.match(edit, /<input type="date" name="procedure_date" max="2026-11-19" value="2026-11-10" required/);
	assert.match(edit, /<textarea name="description" maxlength="1000" required[^>]*>\nProfilaxis\nAplicación de flúor<\/textarea>/);
	assert.match(formOf(out, 'procedure-delete-21'), /data-confirm="¿Eliminar este procedimiento\? No se puede deshacer\."/);
});

test('D4 a retained edit keeps its typed values in that entry only; the other entries show what is stored', async () => {
	const out = await render({
		procedures: [entry({ id: '21' }), entry({ id: '23', procedure_date: '2026-11-11', description: 'Otra' })],
		editing: { ...editing, retained: { procedureId: '21', values: { procedure_date: '2026-11-09', description: 'Typed text' } } },
	});
	const first = formOf(out, 'procedure-edit-21');
	assert.match(first, /name="procedure_date" max="2026-11-19" value="2026-11-09"/);
	assert.match(first, /<textarea name="description" maxlength="1000" required[^>]*>\nTyped text<\/textarea>/);
	const second = formOf(out, 'procedure-edit-23');
	assert.match(second, /value="2026-11-11"/);
	assert.doesNotMatch(second, /Typed text/);
});
