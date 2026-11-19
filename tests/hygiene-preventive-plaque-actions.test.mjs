import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Plaque form mapping (D2) through the save handler: the real drafts module runs in one vm context with an
// isolated fetch, and every request is recorded. The form the page renders is built by formValuesFromHygieneContent.
const root = new URL('../', import.meta.url);
const draftsPath = 'src/pods/hygiene-preventive-draft/actions/drafts.ts';
const apiBase = 'https://backend.invalid';
const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const subjectId = '01234567-89ab-4def-8123-456789abcdef';
const groupId = 'abcdef01-2345-4789-abcd-ef0123456789';
const authorId = '11111111-2222-4333-8444-555555555555';
const habilitationId = '99999999-8888-4777-8666-555555555555';
const largeId = '9223372036854775807';
const iso = '2026-11-06T12:00:00.000Z';
const draftPath = `/hygiene-preventive-drafts/${largeId}`;
const assignmentPath = '/patient-assignments/mine';
const stainedWithoutEvaluation = 'La pieza 17 tiene superficies teñidas y no está marcada como evaluada. Marcala como evaluada o desmarcá sus superficies.';
const formInputError = 'Revisá los campos del formulario.';

// Content without plaque; medical, odontogram and indices stay as the first delivery saves them.
const served = {
	medical_history: { diabetes: false, observations: 'Línea 1\nLínea 2' },
	odontogram: { 16: { state: 'present', surfaces: { occlusal: ['caries'] } } },
	indices: { ceo_d: { c: 1, e: 0, o: 2, total: 3 } },
};
// The plaque the server returns: teeth plus computed results, consistent with the stored-mode checks.
// Löe-Silness: 16 has grades 2, 2, 2, 1; 21 has no recorded site; 36 has a grade 0 → 7 over 5 sites = 1.4 (MODERADA).
// O'Leary: 11 stains mesial, 12 is evaluated with none → 1 of 8 surfaces = 12.5 % (BUENO).
const plaqueRead = {
	loe_silness: { teeth: { 16: { distal: 2, vestibular: 2, mesial: 2, lingual: 1 }, 21: {}, 36: { mesial: 0 } }, average: 1.4, category: 'moderate' },
	oleary: {
		teeth: {
			11: { mesial: true, distal: false, vestibular: false, lingual: false },
			12: { mesial: false, distal: false, vestibular: false, lingual: false },
		},
		stained_surfaces: 1, present_surfaces: 8, percentage: 12.5, category: 'good',
	},
};
const plaqueWritten = { loe_silness: { teeth: plaqueRead.loe_silness.teeth }, oleary: { teeth: plaqueRead.oleary.teeth } };

const assignment = (overrides = {}) => ({
	id: '17', patient_id: patientId, student_habilitation_id: habilitationId, subject_id: subjectId, academic_group_id: groupId,
	assigned_by: authorId, nombres: 'Ana', apellidos: 'Pérez', documento: '123', assigned_at: iso,
	ended_by: null, ended_at: null, end_reason: null, ...overrides,
});
const draft = (overrides = {}) => ({
	id: largeId, clinical_record_id: '9223372036854775806', patient_id: patientId, author_id: authorId,
	origin_student_habilitation_id: habilitationId, origin_subject_id: subjectId, origin_group_id: groupId,
	content: served, status: 'draft', version: '3', created_at: iso, updated_at: iso, ...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const withTotals = (content) => ({
	...content,
	indices: Object.fromEntries(Object.entries(content.indices ?? {}).map(([name, index]) => [name, index ? { ...index, total: index.c + index.e + index.o } : index])),
});
/** The server's computed results for the plaque teeth it stored (stored-mode checks need them to be consistent). */
function resultsFor(plaque) {
	if (plaque === undefined) return undefined;
	const output = {};
	const loe = plaque.loe_silness;
	if (loe === null) output.loe_silness = null;
	else if (loe) {
		const grades = Object.values(loe.teeth).flatMap((tooth) => Object.values(tooth));
		const average = grades.length ? Math.round((grades.reduce((sum, grade) => sum + grade, 0) / grades.length) * 100) / 100 : null;
		const category = average === null ? null : average <= 0.5 ? 'low' : average <= 1.5 ? 'moderate' : 'abundant';
		output.loe_silness = { teeth: loe.teeth, average, category };
	}
	const oleary = plaque.oleary;
	if (oleary === null) output.oleary = null;
	else if (oleary) {
		const teeth = Object.keys(oleary.teeth).length;
		const stained = Object.values(oleary.teeth).reduce((sum, surfaces) => sum + Object.values(surfaces).filter(Boolean).length, 0);
		const present = teeth * 4;
		const percentage = present ? Math.round((stained * 1000) / present) / 10 : null;
		const category = percentage === null ? null : percentage <= 30 ? 'good' : percentage <= 60 ? 'fair' : 'poor';
		output.oleary = { teeth: oleary.teeth, stained_surfaces: stained, present_surfaces: present, percentage, category };
	}
	return output;
}
const echo = ({ body }) => ({
	body: draft({
		version: String(BigInt(body.expected_version) + 1n),
		content: { ...withTotals(body.content), ...(body.content.plaque === undefined ? {} : { plaque: resultsFor(body.content.plaque) }) },
	}),
});
const readDraft = (content = served, version = '3') => ({ body: draft({ content, version }) });

/** Real drafts module against an isolated fetch; every request is recorded with its JSON body. */
async function environment(routes) {
	const requests = [];
	const table = { [`GET ${assignmentPath}`]: { body: { items: [assignment()], limit: 50, offset: 0 } }, ...routes };
	const cookies = { get: (name) => (name === 'session' ? { value: 'session-token' } : undefined), set() {}, delete() {} };
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, BigInt, atob, btoa, Set, Map,
		fetch: async (href, init = {}) => {
			const method = init.method ?? 'GET';
			const request = { method, url: href };
			if (init.body !== undefined) request.body = JSON.parse(init.body);
			requests.push(request);
			const key = `${method} ${new URL(href).pathname}`;
			const entry = table[key];
			const response = typeof entry === 'function' ? await entry({ url: new URL(href), body: request.body }) : entry;
			if (!response) throw new Error(`Unexpected request ${key}`);
			return Response.json(response.body ?? {}, { status: response.status ?? 200 });
		},
	});
	const modules = new Map();
	function load(href) {
		if (!modules.has(href)) {
			modules.set(href, (async () => {
				const code = await readFile(new URL(href), 'utf8');
				const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
				const mod = new vm.SourceTextModule(output, {
					context: sandbox, identifier: href,
					initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: apiBase }; },
				});
				await mod.link(async (specifier, parent) => {
					if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
					if (specifier === './session') {
						return new vm.SyntheticModule(['getSession', 'clearSession'], function () {
							this.setExport('getSession', (jar) => jar.get('session')?.value ?? null);
							this.setExport('clearSession', () => undefined);
						}, { context: sandbox });
					}
					return load(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier).href);
				});
				return mod;
			})());
		}
		return modules.get(href);
	}
	const mod = await load(new URL(draftsPath, root).href);
	await mod.evaluate();
	return { requests, cookies, drafts: mod.namespace };
}

/** The form the page renders for `content`, with `edits` applied as the student's changes. */
function formInput(env, content, edits = {}) {
	return { id: largeId, expected_version: '3', assignment_id: '17', limit: '50', offset: '0', ...env.drafts.formValuesFromHygieneContent(content), ...edits };
}
/** Saves a draft read as `read` (content as the server returns it), with the page's form and `edits`. */
async function save(read, edits = {}, { version = '3' } = {}) {
	const env = await environment({
		[`GET ${draftPath}`]: readDraft(read, version),
		[`PATCH ${draftPath}`]: echo,
	});
	const result = await env.drafts.handleUpdateHygieneDraft(formInput(env, read, edits), { cookies: env.cookies });
	const patches = env.requests.filter((request) => request.method === 'PATCH');
	return { result, requests: env.requests, patches, env, content: patches[0]?.body.content };
}
const withPlaque = (plaque) => ({ ...served, plaque });
const sentPlaque = (run) => run.content.plaque;

// D2 Löe-Silness: a site is sent only when graded; grade 0 is a grade.

test('D2 a Löe-Silness site is sent as an integer only when graded, and grade 0 is sent', async () => {
	const run = await save(withPlaque(plaqueRead), { 'plaque.loe_silness.16.lingual': '' });
	assert.equal(run.result.success, true);
	assert.deepEqual(sentPlaque(run).loe_silness, { teeth: { 16: { distal: 2, vestibular: 2, mesial: 2 }, 21: {}, 36: { mesial: 0 } } });
});

test('D2 a Löe-Silness tooth with no graded site is omitted, and a stored empty tooth stays empty', async () => {
	const read = withPlaque({ loe_silness: { teeth: { 16: {}, 36: { mesial: 1 } }, average: 1, category: 'low' } });
	const run = await save(read, { 'plaque.loe_silness.36.mesial': '' });
	assert.deepEqual(sentPlaque(run).loe_silness, { teeth: { 16: {} } });
});

// D2 O'Leary: an evaluated tooth sends four booleans; a stained surface needs its tooth evaluated.

test('D2 an evaluated O\'Leary tooth sends all four surfaces as booleans, and an unstained one sends false', async () => {
	const run = await save(withPlaque(plaqueRead), {
		'plaque.oleary.11.evaluated': 'on', 'plaque.oleary.11.mesial': 'on',
		'plaque.oleary.13.evaluated': 'on',
	});
	assert.equal(run.result.success, true);
	assert.deepEqual(sentPlaque(run).oleary.teeth[11], { mesial: true, distal: false, vestibular: false, lingual: false });
	assert.deepEqual(sentPlaque(run).oleary.teeth[13], { mesial: false, distal: false, vestibular: false, lingual: false });
	assert.deepEqual(Object.keys(sentPlaque(run).oleary.teeth).sort(), ['11', '12', '13']);
});

test('D2 an O\'Leary tooth that is not evaluated is omitted from the section', async () => {
	const run = await save(withPlaque(plaqueRead), { 'plaque.oleary.11.evaluated': '', 'plaque.oleary.11.mesial': '' });
	assert.deepEqual(sentPlaque(run).oleary, { teeth: { 12: plaqueRead.oleary.teeth[12] } });
});

test('D2 a stained O\'Leary surface on a tooth not evaluated is refused with the exact copy and no PATCH', async () => {
	const run = await save(withPlaque(plaqueRead), { 'plaque.oleary.17.distal': 'on' });
	assert.equal(run.result.success, false);
	assert.equal(run.result.error, stainedWithoutEvaluation);
	assert.equal(run.patches.length, 0);
});

// D2 section outcomes: absent, null, {teeth: {}} and loaded teeth cleared.

test('D2 nothing stored and nothing entered sends no plaque key', async () => {
	const run = await save(served);
	assert.equal(run.result.success, true);
	assert.equal(Object.hasOwn(run.content, 'plaque'), false);
});

test('D2 a stored null section stays null and an absent section stays absent', async () => {
	const run = await save(withPlaque({ loe_silness: null }));
	assert.deepEqual(sentPlaque(run), { loe_silness: null });
});

test('D2 a stored {teeth: {}} section stays {teeth: {}} when nothing is entered', async () => {
	const run = await save(withPlaque({ oleary: { teeth: {}, stained_surfaces: 0, present_surfaces: 0, percentage: null, category: null } }));
	assert.deepEqual(sentPlaque(run), { oleary: { teeth: {} } });
});

test('D2 loaded teeth cleared in the form become a null section', async () => {
	const run = await save(withPlaque({ loe_silness: { teeth: { 16: { distal: 2 } }, average: 2, category: 'abundant' } }), { 'plaque.loe_silness.16.distal': '' });
	assert.deepEqual(sentPlaque(run), { loe_silness: null });
});

// D2 computed results and refused values.

test('D2 computed plaque results never reach the PATCH body', async () => {
	const run = await save(withPlaque(plaqueRead));
	const body = JSON.stringify(run.patches[0].body);
	for (const computed of ['average', 'category', 'percentage', 'stained_surfaces', 'present_surfaces']) assert.equal(body.includes(computed), false, computed);
});

test('D2 an unknown Löe-Silness grade is refused without a PATCH', async () => {
	const run = await save(withPlaque(plaqueRead), { 'plaque.loe_silness.16.distal': '4' });
	assert.equal(run.result.success, false);
	assert.equal(run.result.error, formInputError);
	assert.equal(run.patches.length, 0);
});

test('D2 an O\'Leary checkbox value other than on is refused without a PATCH', async () => {
	const run = await save(withPlaque(plaqueRead), { 'plaque.oleary.11.mesial': 'yes' });
	assert.equal(run.result.success, false);
	assert.equal(run.result.error, formInputError);
	assert.equal(run.patches.length, 0);
});

// Round trip: the form built from the stored draft and saved without edits leaves every plaque tooth identical.

test('round trip: formValuesFromHygieneContent then a save with no edits keeps the plaque teeth identical', async () => {
	const run = await save(withPlaque(plaqueRead));
	assert.equal(run.result.success, true);
	assert.deepEqual(sentPlaque(run), plaqueWritten);
});

// Labels and control names: every plaque control is a form field with a readable retained-value label.

test('every plaque control is listed once in HYGIENE_FORM_FIELDS: 24 Löe-Silness and 260 O\'Leary controls', async () => {
	const env = await environment({});
	const names = env.drafts.HYGIENE_FORM_FIELDS.filter((name) => name.startsWith('plaque.'));
	assert.equal(names.length, 284);
	assert.equal(new Set(names).size, 284);
	assert.ok(names.includes('plaque.loe_silness.44.lingual'));
	assert.ok(names.includes('plaque.oleary.85.evaluated'));
	assert.equal(env.drafts.HYGIENE_MARK_FIELDS.some((name) => name.startsWith('plaque.')), false);
});

test('retained plaque values list with readable labels: Löe-Silness grades and O\'Leary evaluated and stained surfaces', async () => {
	const env = await environment({});
	const entries = env.drafts.hygieneUnsavedEntries({
		'plaque.loe_silness.16.distal': '2', 'plaque.loe_silness.16.lingual': '', 'plaque.oleary.11.evaluated': 'on',
		'plaque.oleary.11.mesial': 'on', 'plaque.oleary.11.distal': '',
	});
	assert.deepEqual(plain(entries), [
		{ label: 'Löe-Silness · Pieza 16 · Distal', value: '2' },
		{ label: "O'Leary · Pieza 11 · Evaluada", value: 'Sí' },
		{ label: "O'Leary · Pieza 11 · Mesial teñida", value: 'Sí' },
	]);
	for (const name of env.drafts.HYGIENE_FORM_FIELDS.filter((field) => field.startsWith('plaque.'))) {
		assert.ok(env.drafts.HYGIENE_CONTROL_LABELS.has(name), name);
	}
});
