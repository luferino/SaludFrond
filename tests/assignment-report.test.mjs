import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const jwtSource = await readFile(new URL('src/shared/jwt.ts', root), 'utf8');
const jwtOutput = ts.transpileModule(jwtSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const jwt = {};
const now = 2_000_000_000;
vm.runInNewContext(jwtOutput, { exports: jwt, atob, Date: { now: () => now * 1000 } });

function session(actor, exp = now + 60) {
	const payload = Buffer.from(JSON.stringify(actor && { ...actor, exp })).toString('base64url');
	return { get: () => ({ value: `synthetic.${payload}.signature` }) };
}

async function loadReport(options = {}) {
	const source = await readFile(new URL('src/pods/assignment-report/report.ts', root), 'utf8');
	const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	const calls = [];
	const ApiError = class ApiError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } };
	vm.runInNewContext(output, { exports, module: { exports }, require: (name) => name.includes('jwt') ? jwt : name.includes('apiClient') ? {
		apiFetch: async (path) => { calls.push(path); if (options.failure) throw new ApiError(options.failure); return options.response ?? { total: 1, items: [{ career: 'kinesiology', subject_id: 's', academic_group_id: 'g', assignment_count: 1 }] }; }, ApiError,
	} : name.includes('subject/api') ? { listSubjects: async () => { calls.push('subjects'); return { state: 'success', page: { items: [{ id: 's', name: 'Nombre asignatura' }] } }; } } : name.includes('group/api') ? { listGroups: async () => { calls.push('groups'); return { state: 'success', page: { items: [{ id: 'g', name: 'Nombre grupo' }] } }; } } : {}, Date, URLSearchParams, Error, Number, String, Array, Object, Math, Intl });
	exports.calls = calls;
	return exports;
}

test('report page state avoids data calls until authorized dates are valid', async () => {
	const query = new URLSearchParams('from=2025-01-01&to=2025-01-02');
	for (const [params, actor, expected] of [
		[new URLSearchParams(), { role: 'admin', permissions: ['assignment-reports:read'] }, 'initial'],
		[query, { role: 'teacher', permissions: ['assignment-reports:read'] }, 'denied'],
		[new URLSearchParams('from=2025-02-30&to=2025-03-01'), { role: 'admin', permissions: ['assignment-reports:read'] }, 'invalid'],
	]) {
		const report = await loadReport();
		const state = JSON.parse(JSON.stringify(await report.loadAssignmentReportPage(params, session(actor))));
		assert.equal(state.state, expected);
		assert.deepEqual(report.calls, []);
	}
});

test('an expired admin session with the report grant makes no report or catalog requests', async () => {
	const report = await loadReport();
	const query = new URLSearchParams('from=2025-01-01&to=2025-01-02');
	const actor = { role: 'admin', permissions: ['assignment-reports:read'] };
	const result = await report.loadAssignmentReportPage(query, session(actor, now));
	assert.deepEqual({ state: result.state, calls: report.calls }, { state: 'denied', calls: [] });
});

test('report page state distinguishes populated, empty, forbidden, and failed results', async () => {
	const params = new URLSearchParams('from=2025-01-01&to=2025-01-02');
	const jar = session({ role: 'admin', permissions: ['assignment-reports:read'] });
	let report = await loadReport();
	let state = JSON.parse(JSON.stringify(await report.loadAssignmentReportPage(params, jar)));
	assert.equal(state.state, 'success');
	assert.deepEqual(state.subjectNames, { s: 'Nombre asignatura' });
	assert.deepEqual(state.groupNames, { g: 'Nombre grupo' });
	assert.equal(report.calls.length, 3);
	report = await loadReport({ response: { total: 0, items: [] } });
	state = JSON.parse(JSON.stringify(await report.loadAssignmentReportPage(params, jar)));
	assert.equal(state.state, 'empty');
	assert.deepEqual(report.calls, ['/reports/assignments?from=2025-01-01&to=2025-01-02']);
	for (const [failure, expected] of [[403, 'forbidden'], [500, 'error']]) {
		report = await loadReport({ failure });
		state = JSON.parse(JSON.stringify(await report.loadAssignmentReportPage(params, jar)));
		assert.equal(state.state, expected);
		assert.deepEqual(report.calls, ['/reports/assignments?from=2025-01-01&to=2025-01-02']);
	}
});

test('assignment report accepts valid inclusive Paraguay date ranges up to 366 days', async () => {
	const report = await loadReport();
	assert.deepEqual(JSON.parse(JSON.stringify(report.parseAssignmentReportDates(new URLSearchParams('from=2024-02-29&to=2025-02-28')))), { from: '2024-02-29', to: '2025-02-28' });
	assert.deepEqual(JSON.parse(JSON.stringify(report.parseAssignmentReportDates(new URLSearchParams('from=2025-01-01&to=2025-01-01')))), { from: '2025-01-01', to: '2025-01-01' });
	for (const query of [
		'', 'from=2025-01-01', 'to=2025-01-01', 'from=2025-01-01&to=2025-01-01&from=2025-01-02',
		'from=2025-02-29&to=2025-03-01', 'from=2025-1-01&to=2025-01-02', 'from=2025-02-02&to=2025-02-01',
		'from=2024-01-01&to=2025-01-01', 'from=0000-01-01&to=0000-01-01',
	]) assert.throws(() => report.parseAssignmentReportDates(new URLSearchParams(query)), Error, query);
});

test('assignment report API uses only the date-filtered aggregate endpoint', async () => {
	const report = await loadReport();
	const result = await report.getAssignmentReport({ from: '2025-01-01', to: '2025-01-02' }, {});
	assert.equal(report.calls.length, 1);
	assert.ok(report.calls[0].startsWith('/reports/assignments?'));
	assert.deepEqual(new URLSearchParams(report.calls[0].split('?')[1]).toString(), 'from=2025-01-01&to=2025-01-02');
	assert.equal(result.total, 1);
});

test('assignment report grant requires an admin with a well-formed existing read permission', async () => {
	const report = await loadReport();
	assert.equal(report.assignmentReportGrant(session({ role: 'admin', permissions: ['assignment-reports:read'] })), true);
	for (const actor of [null, { role: 'teacher', permissions: ['assignment-reports:read'] }, { role: 'admin', permissions: [] },
		{ role: 'admin', permissions: ['assignment-reports:read', null] }, { role: 'admin', permissions: 'assignment-reports:read' }]) {
		assert.equal(report.assignmentReportGrant(session(actor)), false);
	}
});

test('assignment report DTO accepts only aggregate rows and safe nonnegative integer counts', async () => {
	const report = await loadReport();
	const valid = { total: 2, items: [{ career: 'kinesiology', subject_id: 'subject-id', academic_group_id: 'group-id', assignment_count: 2 }] };
	assert.deepEqual(JSON.parse(JSON.stringify(report.validateAssignmentReport(valid))), valid);
	for (const invalid of [
		{ ...valid, personal_data: [] }, { ...valid, total: -1 }, { ...valid, items: [{ ...valid.items[0], assignment_count: 1.5 }] },
		{ ...valid, items: [{ ...valid.items[0], patient_name: 'Ana' }] },
	]) assert.throws(() => report.validateAssignmentReport(invalid), Error);
});
