import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadRegisteredActions, nativeFormData } from './helpers/clinical-form-submit.mjs';

// Registered schemas parsed exactly as Astro parses a native form post (real astro/zod and Astro's formDataToObject).
const require = createRequire(import.meta.resolve('astro/package.json'));
const { formDataToObject } = await import(pathToFileURL(join(dirname(require.resolve('astro/package.json')), 'dist/actions/runtime/server.js')));
const draftsSpecifier = '../pods/hygiene-preventive-draft/actions/drafts';
const load = () => loadRegisteredActions(async () => Response.json({}), { realModules: [draftsSpecifier] });
const updateBase = [['id', '9223372036854775807'], ['expected_version', '3'], ['assignment_id', '17'], ['limit', '50'], ['offset', '0']];
const createBase = [['patient_id', 'a1b2c3d4-e5f6-4890-abcd-ef0123456789'], ['subject_id', '01234567-89ab-4def-8123-456789abcdef'], ['academic_group_id', 'abcdef01-2345-4789-abcd-ef0123456789'], ['assignment_id', '17'], ['limit', '50'], ['offset', '0']];

/** Parse a native form post the way Astro's action handler does before the handler runs. */
function parse(server, name, entries) {
	const input = server[name].input;
	return input.safeParse(formDataToObject(nativeFormData(entries), input));
}

test('both Hygiene actions are registered as native form actions with strict input schemas', async () => {
	const { server } = await load();
	assert.equal(server.createHygieneDraft.accept, 'form');
	assert.equal(server.updateHygieneDraft.accept, 'form');
	assert.equal(parse(server, 'createHygieneDraft', [...createBase, ['content', '{}']]).success, false, 'create takes no content');
	assert.equal(parse(server, 'updateHygieneDraft', [...updateBase, ['unknown.field', 'x']]).success, false, 'unknown names are rejected');
	assert.equal(parse(server, 'updateHygieneDraft', [...updateBase, ['indices.ceo_d.total', '3']]).success, false, 'clients cannot send a total');
});

test('create accepts the context fields of the assignment page form', async () => {
	const { server } = await load();
	const parsed = parse(server, 'createHygieneDraft', createBase);
	assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
	assert.equal(parsed.data.subject_id, '01234567-89ab-4def-8123-456789abcdef');
});

test('update accepts empty and filled text, select and number controls', async () => {
	const { server } = await load();
	const parsed = parse(server, 'updateHygieneDraft', [...updateBase,
		['medical_history.diabetes', 'true'], ['medical_history.diabetes_detail', ''], ['medical_history.observations', 'Línea 1\r\nLínea 2'],
		['odontogram.16.state', 'present'], ['odontogram.12.state', ''], ['indices.cpo_d.c', '0'],
	]);
	assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
	assert.equal(parsed.data['odontogram.16.state'], 'present');
	assert.equal(parsed.data['medical_history.observations'], 'Línea 1\r\nLínea 2');
});

test('two checked marks on one face arrive as both values in the form order', async () => {
	const { server } = await load();
	const parsed = parse(server, 'updateHygieneDraft', [...updateBase, ['odontogram.11.occlusal', 'caries'], ['odontogram.11.occlusal', 'filled']]);
	assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
	assert.deepEqual(parsed.data['odontogram.11.occlusal'], ['caries', 'filled']);
});

test('one checked mark arrives as a one-item array and an unchecked face as an empty array', async () => {
	const { server } = await load();
	const parsed = parse(server, 'updateHygieneDraft', [...updateBase, ['odontogram.11.mesial', 'filled']]);
	assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
	assert.deepEqual(parsed.data['odontogram.11.mesial'], ['filled']);
	assert.deepEqual(parsed.data['odontogram.11.distal'], []);
});

test('a face value outside caries and filled is rejected', async () => {
	const { server } = await load();
	assert.equal(parse(server, 'updateHygieneDraft', [...updateBase, ['odontogram.11.mesial', 'secondary']]).success, false);
});
