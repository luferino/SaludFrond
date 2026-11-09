import type { AstroCookies } from 'astro';
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError } from '../../shared/apiClient';
import { isReceptionCareer, RECEPTION_CAREERS } from '../reception/careers';
import { birthDateError, parseBirthDate } from '../paciente/birth-date';
import {
	isDocumento, isUuid,
	matchReceptionPatient as requestPatientMatch,
	registerReceptionPatient as createReceptionPatient,
	reuseReceptionPatient as reusePatientEnrollment,
	updateReceptionPatientContact as patchPatientContact,
} from './api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const careerField = z.enum(RECEPTION_CAREERS);
const uuidField = () => z.string().trim().regex(UUID_PATTERN);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function publicError(error: unknown, operation: string): string {
	if (error instanceof ApiError) {
		if (error.status === 400) return 'Revisá los datos enviados e intentá nuevamente.';
		if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
		if (error.status === 403) return 'Tu cuenta no tiene permiso para gestionar pacientes en recepción.';
		if (error.status === 404) return 'La carrera ya no está habilitada para tu cuenta o el paciente no figura en esa carrera.';
		if (error.status === 409) return 'El estado del paciente cambió. Revisá la lista e intentá nuevamente.';
	}
	return `No se pudo ${operation}. Probá de nuevo más tarde.`;
}

export async function handleMatchReceptionPatient(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const documento = text(input.documento);
	if (!career || !isDocumento(documento)) {
		return { success: false as const, career, documento, error: 'Ingresá un documento de 4 a 8 dígitos.' };
	}
	try {
		const result = await requestPatientMatch(career, documento, context.cookies);
		return result.match
			? { success: true as const, career, documento, match: true as const, patientId: result.patient_id }
			: { success: true as const, career, documento, match: false as const };
	} catch (error) {
		return { success: false as const, career, documento, error: publicError(error, 'buscar el paciente'), unauthorized: error instanceof ApiError && error.status === 401 };
	}
}

export async function handleReuseReceptionPatient(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const patientId = text(input.patient_id);
	const documento = text(input.documento);
	if (!career || !isUuid(patientId) || !isDocumento(documento)) {
		return { success: false as const, career, error: 'Revisá los datos del paciente antes de vincularlo.' };
	}
	try {
		const enrollment = await reusePatientEnrollment(career, patientId, documento, context.cookies);
		return { success: true as const, career, patientId: enrollment.patient_id, documento };
	} catch (error) {
		return { success: false as const, career, error: publicError(error, 'vincular el paciente'), unauthorized: error instanceof ApiError && error.status === 401 };
	}
}

export async function handleRegisterReceptionPatient(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const documento = text(input.documento);
	const nombres = text(input.nombres);
	const apellidos = text(input.apellidos);
	const email = text(input.email);
	const celular = text(input.celular);
	const direccion = text(input.direccion);
	const sexo = input.sexo === 'M' || input.sexo === 'F' ? input.sexo : null;
	const birthDate = parseBirthDate(text(input.fecha_nacimiento));
	if (!career || !isDocumento(documento) || !nombres || !apellidos || !email || !celular || !direccion || !sexo) {
		return { success: false as const, career, documento, error: 'Revisá la ficha: todos los campos son obligatorios.' };
	}
	if (!birthDate) return { success: false as const, career, documento, error: birthDateError };
	try {
		const patient = await createReceptionPatient({ career, documento, nombres, apellidos, fecha_nacimiento: birthDate, email, celular, sexo, direccion }, context.cookies);
		return { success: true as const, career, documento, patient: { id: patient.id, documento: patient.documento, nombres: patient.nombres, apellidos: patient.apellidos } };
	} catch (error) {
		return { success: false as const, career, documento, error: publicError(error, 'registrar el paciente'), unauthorized: error instanceof ApiError && error.status === 401 };
	}
}

export async function handleUpdateReceptionPatientContact(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const id = text(input.id);
	const email = text(input.email);
	const celular = text(input.celular);
	const direccion = text(input.direccion);
	if (!career || !isUuid(id) || !email || !celular || !direccion) {
		return { success: false as const, career, error: 'Revisá los datos de contacto: todos los campos son obligatorios.' };
	}
	try {
		const patient = await patchPatientContact(id, career, { email, celular, direccion }, context.cookies);
		return { success: true as const, career, patientId: patient.id };
	} catch (error) {
		return { success: false as const, career, error: publicError(error, 'actualizar el contacto'), unauthorized: error instanceof ApiError && error.status === 401 };
	}
}

export const matchReceptionPatient = defineAction({
	accept: 'form',
	input: z.object({ career: careerField, documento: z.string() }),
	handler: handleMatchReceptionPatient,
});

export const reuseReceptionPatient = defineAction({
	accept: 'form',
	input: z.object({ career: careerField, patient_id: uuidField(), documento: z.string() }),
	handler: handleReuseReceptionPatient,
});

export const registerReceptionPatient = defineAction({
	accept: 'form',
	input: z.object({
		career: careerField, documento: z.string(), nombres: z.string(), apellidos: z.string(),
		fecha_nacimiento: z.string(), email: z.string(), celular: z.string(), sexo: z.enum(['M', 'F']), direccion: z.string(),
	}),
	handler: handleRegisterReceptionPatient,
});

export const updateReceptionPatientContact = defineAction({
	accept: 'form',
	input: z.object({ id: uuidField(), career: careerField, email: z.string(), celular: z.string(), direccion: z.string() }),
	handler: handleUpdateReceptionPatientContact,
});
