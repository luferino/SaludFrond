import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRegisteredActions } from './helpers/clinical-form-submit.mjs';

const patientId = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const grant = 'patient-personal-data:read';
const fixture = {
	id: patientId, nombres: 'Ana', apellidos: 'Prueba', documento: '123456',
	fecha_nacimiento: '1995-06-24', sexo: 'F', direccion: null,
	marital_status: null, medical_insurance: 'none',
};

async function read({ role = 'estudiante', permissions = [grant], serve = () => Response.json(fixture) } = {}) {
	const harness = await loadRegisteredActions(serve);
	const { readHygienePatientHeader } = await harness.importModule('src/pods/paciente/clinical-header.ts');
	const token = 'fixture.' + Buffer.from(JSON.stringify({ role, permissions, exp: 4102444800 })).toString('base64url') + '.fixture';
	const cookies = { get: (name) => name === 'session' ? { value: token } : undefined };
	const result = await readHygienePatientHeader(patientId, cookies);
	return { result: JSON.parse(JSON.stringify(result)), requests: harness.requests, token };
}

test('student and teacher: one authenticated GET, no query/body, only the header projection', async () => {
	for (const role of ['estudiante', 'docente']) {
		const { result, requests, token } = await read({ role });
		assert.deepEqual(result, { name: 'Ana Prueba', maritalStatus: 'No registrado', insurance: 'Sin seguro' });
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, `https://backend.invalid/patients/${patientId}/personal-data`);
		assert.equal(requests[0].method, 'GET');
		assert.equal(requests[0].headers.Authorization, `Bearer ${token}`);
		assert.equal(requests[0].body, undefined);
	}
});

test('null insurance does not imply uninsured', async () => {
	const { result } = await read({ serve: () => Response.json({ ...fixture, marital_status: 'civil_union', medical_insurance: null }) });
	assert.deepEqual(result, { name: 'Ana Prueba', maritalStatus: 'Unión civil', insurance: 'No registrado' });
});

test('no request for a missing/malformed grant or unrelated role', async () => {
	for (const options of [{ permissions: [] }, { permissions: grant }, { role: 'admin' }, { role: 'reception' }]) {
		const { result, requests } = await read(options);
		assert.equal(result, null);
		assert.deepEqual(requests, []);
	}
});

test('denials, unavailability and invalid responses stay local to the header', async () => {
	const { medical_insurance: _insurance, ...partial } = fixture;
	for (const serve of [
		...([401, 403, 404, 503].map((status) => () => Response.json({ error: { message: 'backend detail' } }, { status }))),
		() => { throw new Error('network unavailable'); },
		() => new Response('invalid JSON'),
		() => Response.json(partial),
		() => Response.json({ ...fixture, id: '11111111-2222-4333-8444-555555555555' }),
		() => Response.json({ ...fixture, medical_insurance: 'unknown' }),
		() => Response.json({ ...fixture, email: 'fixture@example.invalid' }),
	]) {
		const { result, requests } = await read({ serve });
		assert.equal(result, null);
		assert.equal(requests.length, 1);
	}
});
