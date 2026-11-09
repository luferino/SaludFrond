import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import type { ReceptionCareer } from '../reception/careers';

export interface ReceptionPatient {
	id: string; documento: string; nombres: string; apellidos: string; fecha_nacimiento: string | null;
	email: string; celular: string; sexo: string; direccion: string;
}
export type PatientMatch = { match: false } | { match: true; patient_id: string };
export interface PatientEnrollment { patient_id: string; career: ReceptionCareer; enrolled: true }
export interface RegisterPatientInput {
	career: ReceptionCareer; documento: string; nombres: string; apellidos: string; fecha_nacimiento: string;
	email: string; celular: string; sexo: string; direccion: string;
}
export interface ContactInput { email: string; celular: string; direccion: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENTO = /^[0-9]{4,8}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PATIENT_KEYS = ['id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion'];

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const text = (value: unknown): value is string => typeof value === 'string';

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const isDocumento = (value: unknown): value is string => typeof value === 'string' && DOCUMENTO.test(value);
function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isReceptionPatient(value: unknown): value is ReceptionPatient {
	return record(value) && hasExactKeys(value, PATIENT_KEYS) && isUuid(value.id)
		&& text(value.documento) && text(value.nombres) && text(value.apellidos)
		&& (value.fecha_nacimiento === null || isIsoDate(value.fecha_nacimiento))
		&& text(value.email) && text(value.celular) && text(value.sexo) && text(value.direccion);
}

export async function listReceptionPatients(career: ReceptionCareer, cookies: AstroCookies): Promise<ReceptionPatient[]> {
	const response = await apiFetch<unknown>(`/reception/patients?career=${encodeURIComponent(career)}`, { cookies });
	if (!record(response) || !hasExactKeys(response, ['items']) || !Array.isArray(response.items) || !response.items.every(isReceptionPatient)) {
		throw new Error('Respuesta de pacientes inválida.');
	}
	return response.items;
}

export async function matchReceptionPatient(career: ReceptionCareer, documento: string, cookies: AstroCookies): Promise<PatientMatch> {
	const response = await apiFetch<unknown>('/reception/patients/match', { method: 'POST', body: { career, documento }, cookies });
	if (record(response) && hasExactKeys(response, ['match']) && response.match === false) return { match: false };
	if (record(response) && hasExactKeys(response, ['match', 'patient_id']) && response.match === true && isUuid(response.patient_id)) {
		return { match: true, patient_id: response.patient_id };
	}
	throw new Error('Respuesta de coincidencia inválida.');
}

export async function reuseReceptionPatient(career: ReceptionCareer, patientId: string, documento: string, cookies: AstroCookies): Promise<PatientEnrollment> {
	const response = await apiFetch<unknown>('/reception/patients/reuse', { method: 'POST', body: { career, patient_id: patientId, documento }, cookies });
	if (!record(response) || !hasExactKeys(response, ['patient_id', 'career', 'enrolled']) || response.patient_id !== patientId || response.career !== career || response.enrolled !== true) {
		throw new Error('Respuesta de vinculación inválida.');
	}
	return { patient_id: patientId, career, enrolled: true };
}

export async function registerReceptionPatient(input: RegisterPatientInput, cookies: AstroCookies): Promise<ReceptionPatient> {
	const body = {
		career: input.career, documento: input.documento, nombres: input.nombres, apellidos: input.apellidos,
		fecha_nacimiento: input.fecha_nacimiento, email: input.email, celular: input.celular, sexo: input.sexo, direccion: input.direccion,
	};
	const response = await apiFetch<unknown>('/reception/patients/register', { method: 'POST', body, cookies });
	if (!isReceptionPatient(response)) throw new Error('Respuesta de registro inválida.');
	return response;
}

// Only contact fields are ever sent; identity and birth-date corrections stay admin-owned.
export async function updateReceptionPatientContact(patientId: string, career: ReceptionCareer, contact: ContactInput, cookies: AstroCookies): Promise<ReceptionPatient> {
	const body = { email: contact.email, celular: contact.celular, direccion: contact.direccion };
	const response = await apiFetch<unknown>(`/reception/patients/${encodeURIComponent(patientId)}?career=${encodeURIComponent(career)}`, { method: 'PATCH', body, cookies });
	if (!isReceptionPatient(response) || response.id !== patientId) throw new Error('Respuesta de contacto inválida.');
	return response;
}
