import type { AstroCookies } from 'astro';
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError } from '../../shared/apiClient';
import { academicPaginationNavigation, parseAcademicPagination } from '../../shared/academic-api';
import type { AcademicPagination } from '../../shared/academic-api';
import { isReceptionCareer, RECEPTION_CAREERS } from '../reception/careers';
import {
	enableAvailability,
	isDocumento,
	isUuid,
	parseContextPair,
	searchAvailabilityPatients,
	withdrawAvailability,
} from './api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFLICT_ENABLE = 'Ya existe una disponibilidad activa para este paciente en este contexto.';
const CONFLICT_WITHDRAW = 'El estado de la disponibilidad cambió. Revisá el historial e intentá nuevamente.';
const careerField = z.enum(RECEPTION_CAREERS);
const uuidField = () => z.string().trim().regex(UUID_PATTERN);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

// Backend messages are never shown; each status maps to fixed Spanish copy.
function publicError(error: unknown, operation: string, conflict: string): string {
	if (error instanceof ApiError) {
		if (error.status === 400) return 'Revisá los datos enviados e intentá nuevamente.';
		if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
		if (error.status === 403) return 'Tu cuenta no tiene permiso para gestionar disponibilidad en recepción.';
		if (error.status === 404) return 'No encontramos el paciente, el contexto o el período en la carrera seleccionada. Revisá la carrera e intentá nuevamente.';
		if (error.status === 409) return conflict;
	}
	return `No se pudo ${operation}. Probá de nuevo más tarde.`;
}

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

// Pagination arrives as optional form strings; an absent value keeps the default.
function paginationFrom(input: Record<string, unknown>): AcademicPagination | null {
	const params = new URLSearchParams();
	for (const key of ['limit', 'offset']) {
		const value = text(input[key]);
		if (value) params.set(key, value);
	}
	try {
		return parseAcademicPagination(params);
	} catch {
		return null;
	}
}

export async function handleSearchReceptionAvailabilityPatient(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const documento = text(input.documento);
	if (!career || !isDocumento(documento)) {
		return { success: false as const, career, documento, error: 'Ingresá un documento de 4 a 8 dígitos.' };
	}
	const pagination = paginationFrom(input);
	if (!pagination) {
		return { success: false as const, career, documento, error: 'Revisá los parámetros de paginación.' };
	}
	try {
		const result = await searchAvailabilityPatients(career, documento, pagination, context.cookies);
		return {
			success: true as const,
			career,
			documento,
			patients: result.items,
			limit: result.limit,
			offset: result.offset,
			navigation: academicPaginationNavigation({ limit: result.limit, offset: result.offset, itemsLength: result.items.length }),
		};
	} catch (error) {
		return { success: false as const, career, documento, error: publicError(error, 'buscar el paciente', CONFLICT_ENABLE), unauthorized: isUnauthorized(error) };
	}
}

export async function handleEnableReceptionAvailability(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const patientId = text(input.patient_id);
	const pair = parseContextPair(text(input.context_pair));
	if (!career || !isUuid(patientId) || !pair) {
		return { success: false as const, career, patientId: null, error: 'Seleccioná un paciente y un contexto válidos.' };
	}
	try {
		const activity = await enableAvailability({ career, patient_id: patientId, subject_id: pair.subject_id, academic_group_id: pair.academic_group_id }, context.cookies);
		return { success: true as const, career, patientId, activityId: activity.id };
	} catch (error) {
		return { success: false as const, career, patientId, error: publicError(error, 'habilitar la disponibilidad', CONFLICT_ENABLE), unauthorized: isUnauthorized(error) };
	}
}

// Withdrawal is irreversible for the period, so it needs the explicit confirm=yes field.
export async function handleWithdrawReceptionAvailability(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const career = isReceptionCareer(input.career) ? input.career : null;
	const activityId = text(input.id);
	const patientId = text(input.patient_id);
	const safePatientId = isUuid(patientId) ? patientId : null;
	if (!career || !isUuid(activityId)) {
		return { success: false as const, career, patientId: safePatientId, error: 'Revisá la disponibilidad seleccionada.' };
	}
	if (input.confirm !== 'yes') {
		return { success: false as const, career, patientId: safePatientId, error: 'Confirmá el retiro de la disponibilidad para continuar.' };
	}
	try {
		const activity = await withdrawAvailability(career, activityId, context.cookies);
		return { success: true as const, career, patientId: safePatientId, activityId: activity.id };
	} catch (error) {
		return { success: false as const, career, patientId: safePatientId, error: publicError(error, 'retirar la disponibilidad', CONFLICT_WITHDRAW), unauthorized: isUnauthorized(error) };
	}
}

export const searchReceptionAvailabilityPatient = defineAction({
	accept: 'form',
	input: z.object({ career: careerField, documento: z.string(), limit: z.string().optional(), offset: z.string().optional() }),
	handler: handleSearchReceptionAvailabilityPatient,
});

export const enableReceptionAvailability = defineAction({
	accept: 'form',
	input: z.object({ career: careerField, patient_id: uuidField(), context_pair: z.string() }),
	handler: handleEnableReceptionAvailability,
});

export const withdrawReceptionAvailability = defineAction({
	accept: 'form',
	input: z.object({ career: careerField, id: uuidField(), patient_id: z.string().optional(), confirm: z.string().optional() }),
	handler: handleWithdrawReceptionAvailability,
});
