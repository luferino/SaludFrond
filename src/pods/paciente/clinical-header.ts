import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import { decodeJwt, isTokenValid } from '../../shared/jwt';
import { hasPatientResponseKeys, type PatientPersonalDataResponse } from './personal-data';

type RecordedData = Extract<PatientPersonalDataResponse, { marital_status: unknown }>;

const MARITAL_LABELS: Record<NonNullable<RecordedData['marital_status']>, string> = {
	single: 'Soltero/a', married: 'Casado/a', divorced: 'Divorciado/a',
	widowed: 'Viudo/a', civil_union: 'Unión civil',
};
const INSURANCE_LABELS: Record<NonNullable<RecordedData['medical_insurance']>, string> = {
	ips: 'IPS', police_health: 'Sanidad policial', military_health: 'Sanidad militar', none: 'Sin seguro',
};
const BASE_KEYS = ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'sexo', 'direccion'];

// Called only after validating the draft's origin. The API checks live access independently.
export async function readHygienePatientHeader(patientId: string, cookies: AstroCookies) {
	const token = cookies.get('session')?.value;
	const actor = token ? decodeJwt(token) : null;
	if (!token || !isTokenValid(token) || !actor || !['student', 'estudiante', 'teacher', 'docente'].includes(actor.role)
		|| !Array.isArray(actor.permissions) || !actor.permissions.every((grant) => typeof grant === 'string')
		|| !actor.permissions.includes('patient-personal-data:read')) return null;

	try {
		const value = await apiFetch<unknown>(`/patients/${encodeURIComponent(patientId)}/personal-data`, { cookies });
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
		const record = value as Record<string, unknown>;
		if (!hasPatientResponseKeys(record, BASE_KEYS) || !Object.hasOwn(record, 'marital_status')
			|| record.id !== patientId || typeof record.nombres !== 'string' || typeof record.apellidos !== 'string') return null;
		const name = [record.nombres.trim(), record.apellidos.trim()].filter(Boolean).join(' ');
		if (!name) return null;
		const { marital_status, medical_insurance } = record as RecordedData;
		return {
			name,
			maritalStatus: marital_status === null ? 'No registrado' : MARITAL_LABELS[marital_status],
			insurance: medical_insurance === null ? 'No registrado' : INSURANCE_LABELS[medical_insurance],
		};
	} catch {
		// A denial or service failure must not hide the already-authorized draft.
		return null;
	}
}
