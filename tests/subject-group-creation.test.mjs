import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'astro/zod';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const registryPath = 'src/actions/index.ts';
const actionPath = 'src/pods/subject-group/actions/subject-groups.ts';
const subjectId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const groupId = '01234567-89ab-cdef-0123-456789abcdef';
const attribution = 'abcdef01-2345-6789-abcd-ef0123456789';
const created = {
	subject_id: subjectId,
	academic_group_id: groupId,
	created_by: attribution,
	created_at: '2026-02-01T12:00:00Z',
};

async function evaluate(path, options = {}) {
	const cookieState = { value: 'session-token' };
	const writes = [];
	const requests = [];
	const cookies = {
		get: (name) => name === 'session' && cookieState.value ? { value: cookieState.value } : undefined,
		set: (...args) => { writes.push(['set', ...args]); cookieState.value = args[1]; },
		delete: (...args) => { writes.push(['delete', ...args]); cookieState.value = undefined; },
	};
	const sandbox = vm.createContext({
		URL, URLSearchParams, Response, Error, Date, atob,
		fetch: async (url, init) => {
			requests.push({ url, ...init });
			if (options.networkError) throw new Error('offline');
			const response = options.responses?.shift() ?? { status: options.status ?? 201, body: options.body ?? created };
			return Response.json(response.body, { status: response.status });
		},
	});
	async function compile(code, identifier) {
		const output = ts.transpileModule(code, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
		}).outputText;
		const module = new vm.SourceTextModule(output, {
			context: sandbox,
			identifier,
			initializeImportMeta: (meta) => { meta.env = { PUBLIC_API_URL: 'https://backend.invalid', PROD: false }; },
		});
		await module.link(async (specifier, parent) => {
			if (specifier === 'astro:actions') return new vm.SyntheticModule(['defineAction'], function () {
				this.setExport('defineAction', (definition) => definition);
			}, { context: sandbox });
			if (specifier === 'astro/zod') return new vm.SyntheticModule(['z'], function () {
				this.setExport('z', z);
			}, { context: sandbox });
			if (specifier === '../pods/subject-group/actions/subject-groups' && parent.identifier.endsWith(registryPath)) {
				const resolved = new URL('../pods/subject-group/actions/subject-groups.ts', parent.identifier);
				return compile(await readFile(resolved, 'utf8'), resolved.href);
			}
			if (parent.identifier.endsWith(registryPath)) {
				const exports = {
					'../pods/auth/actions': ['handleLogin', 'handleLogout', 'handleRegister', 'handleForgotPassword', 'handleResetPassword'],
					'../pods/subject/actions/subjects': ['handleCreateSubject'],
					'../pods/group/actions/groups': ['handleCreateGroup'],
					'../pods/student/actions/students': ['handleCreateStudent'],
					'../pods/teacher/actions/teachers': ['handleCreateTeacher'],
					'../pods/paciente/actions/patients': ['handleCreatePatient'],
					'../pods/teacher-habilitation/actions': ['activateTeacherHabilitation', 'revokeTeacherHabilitation'],
					'../pods/student-habilitation/actions': ['activateStudentHabilitation', 'revokeStudentHabilitation'],
					'../pods/patient-availability/actions': ['searchAvailablePatient', 'enablePatientAvailability', 'withdrawPatientAvailability'],
					'../pods/teacher-assignment/actions': ['createTeacherAssignment'],
					'../pods/teacher-clinical/actions/consent': ['handleRecordTeacherConsent'],
					'../pods/kinesiology-evaluation/actions/evaluations': ['handleCreateKinesiologyEvaluation', 'handleUpdateKinesiologyEvaluation', 'handleSubmitKinesiologyEvaluation'],
				};
				return new vm.SyntheticModule(exports[specifier], function () {
					for (const name of exports[specifier]) this.setExport(name, () => undefined);
				}, { context: sandbox });
			}
			if (specifier === 'astro') return new vm.SyntheticModule([], function () {}, { context: sandbox });
			const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent.identifier);
			return compile(await readFile(resolved, 'utf8'), resolved.href);
		});
		return module;
	}
	const module = await compile(await source(path), new URL(path, root).href);
	await module.evaluate();
	return { module, cookies, cookieState, writes, requests };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('registered action uses real Astro Zod and accepts trimmed UUIDs without version restrictions', async () => {
	const { module } = await evaluate(registryPath);
	const schema = module.namespace.server.createSubjectGroup.input;
	const parsed = schema.safeParse({ subject_id: ` ${subjectId.toUpperCase()} `, academic_group_id: ` ${groupId} ` });
	assert.equal(parsed.success, true);
	assert.deepEqual(plain(parsed.data), { subject_id: subjectId.toUpperCase(), academic_group_id: groupId });
	for (const field of ['subject_id', 'academic_group_id']) {
		for (const invalid of [undefined, null, '', '   ', 'not-a-uuid', 'a1b2c3d4-e5f6-7890-abcd-ef012345678']) {
			const input = { subject_id: subjectId, academic_group_id: groupId, [field]: invalid };
			assert.equal(schema.safeParse(input).success, false, `${field}: ${String(invalid)}`);
		}
	}
});

test('handler independently rejects invalid identifiers before fetch', async () => {
	const result = await evaluate(actionPath);
	for (const field of ['subject_id', 'academic_group_id']) {
		for (const invalid of [undefined, null, '', '   ', 'not-a-uuid', 42]) {
			const action = await result.module.namespace.handleCreateSubjectGroup({
				subject_id: subjectId, academic_group_id: groupId, [field]: invalid,
			}, { cookies: result.cookies });
			assert.equal(action.success, false, `${field}: ${String(invalid)}`);
		}
	}
	assert.equal(result.requests.length, 0);
});

test('POST 201 uses exact pair, bearer session and preserves backend identity and attribution', async () => {
	const result = await evaluate(actionPath);
	const action = await result.module.namespace.handleCreateSubjectGroup({
		subject_id: ` ${subjectId.toUpperCase()} `, academic_group_id: ` ${groupId} `,
	}, { cookies: result.cookies });
	assert.deepEqual(plain(action), {
		success: true, subjectId: subjectId.toUpperCase(), academicGroupId: groupId,
		association: created,
	});
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0].url, 'https://backend.invalid/subject-groups');
	assert.equal(result.requests[0].method, 'POST');
	assert.equal(result.requests[0].headers.Authorization, 'Bearer session-token');
	assert.deepEqual(JSON.parse(result.requests[0].body), {
		subject_id: subjectId.toUpperCase(), academic_group_id: groupId,
	});
	assert.deepEqual(Object.keys(JSON.parse(result.requests[0].body)).sort(), ['academic_group_id', 'subject_id']);
	assert.equal(result.cookieState.value, 'session-token');
	assert.deepEqual(result.writes, []);
});

test('400, 401, 403, 404, 409, 500 and network failures have safe distinct feedback', async () => {
	for (const [status, phrase, clears] of [
		[400, 'Revisá los identificadores', false], [401, 'Tu sesión venció', true],
		[403, 'no tiene permiso', false], [404, 'no se encontró la asignatura o el grupo', false],
		[409, 'ya existe esta asociación', false], [500, 'No se pudo crear la asociación', false],
	]) {
		const result = await evaluate(actionPath, { status, body: { error: { code: 'PRIVATE', message: 'private backend detail' } } });
		const action = await result.module.namespace.handleCreateSubjectGroup({
			subject_id: subjectId, academic_group_id: groupId,
		}, { cookies: result.cookies });
		assert.equal(action.success, false);
		assert.equal(action.subjectId, subjectId);
		assert.equal(action.academicGroupId, groupId);
		assert.match(action.error, new RegExp(phrase, 'i'));
		assert.doesNotMatch(action.error, /PRIVATE|private backend detail/);
		assert.equal(result.cookieState.value, clears ? undefined : 'session-token');
		assert.deepEqual(result.writes.map(([kind]) => kind), clears ? ['delete'] : []);
	}
	const offline = await evaluate(actionPath, { networkError: true });
	const failed = await offline.module.namespace.handleCreateSubjectGroup({ subject_id: subjectId, academic_group_id: groupId }, { cookies: offline.cookies });
	assert.match(failed.error, /No se pudo conectar con el servicio/i);
	assert.equal(offline.cookieState.value, 'session-token');
	assert.deepEqual(offline.writes, []);
});

test('malformed 201 payloads are rejected without exposing unrelated catalog data', async () => {
	for (const body of [
		{ ...created, subject_id: 'bad' }, { ...created, academic_group_id: 'bad' },
		{ ...created, created_by: 'bad' }, { ...created, created_by: undefined },
		{ ...created, created_at: 'not-a-date' },
	]) {
		const result = await evaluate(actionPath, { body });
		const action = await result.module.namespace.handleCreateSubjectGroup({
			subject_id: subjectId, academic_group_id: groupId,
		}, { cookies: result.cookies });
		assert.equal(action.success, false);
		assert.match(action.error, /datos incompletos/i);
		assert.equal(action.subjectId, subjectId);
		assert.equal(action.academicGroupId, groupId);
	}
	const extra = await evaluate(actionPath, { body: { ...created, subject_name: 'catalog name', id: 'association-id' } });
	const success = await extra.module.namespace.handleCreateSubjectGroup({
		subject_id: subjectId, academic_group_id: groupId,
	}, { cookies: extra.cookies });
	assert.equal(success.success, true);
	assert.deepEqual(Object.keys(success.association).sort(), ['academic_group_id', 'created_at', 'created_by', 'subject_id']);
});
