import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';
import { isReceptionCareer } from '../reception/careers';
import type { ReceptionCareer } from '../reception/careers';

export interface AvailabilityPatient { patient_id: string; nombres: string; apellidos: string }
export interface AvailabilityActivity { id: string; subject_id: string; academic_group_id: string; enabled_at: string; withdrawn_at: string | null }
export interface AvailabilityContext { career: ReceptionCareer; subject_id: string; academic_group_id: string; subject_name: string; academic_group_name: string }
export interface AvailabilityEnableInput { career: ReceptionCareer; patient_id: string; subject_id: string; academic_group_id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENTO = /^[0-9]{4,8}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;
const SEARCH_KEYS = ['patient_id', 'nombres', 'apellidos'];
const ACTIVITY_KEYS = ['id', 'subject_id', 'academic_group_id', 'enabled_at', 'withdrawn_at'];
const CONTEXT_KEYS = ['career', 'subject_id', 'academic_group_id', 'subject_name', 'academic_group_name'];

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const isDocumento = (value: unknown): value is string => typeof value === 'string' && DOCUMENTO.test(value);
const isIsoDateTime = (value: unknown): value is string => typeof value === 'string' && ISO_DATETIME.test(value) && Number.isFinite(Date.parse(value));

// Pagination is validated before any request so out-of-range values never reach the backend.
function assertCareer(career: unknown): asserts career is ReceptionCareer {
	if (!isReceptionCareer(career)) throw new Error('Carrera inválida.');
}
function assertUuid(value: unknown, label: string): asserts value is string {
	if (!isUuid(value)) throw new Error(`${label} inválido.`);
}
function assertPagination(pagination: AcademicPagination) {
	const { limit, offset } = pagination;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
		throw new Error('Paginación inválida.');
	}
}

// Parameters are emitted in a fixed order; values are already validated, so no encoding surprises.
function scopedQuery(entries: Record<string, string>, pagination: AcademicPagination): string {
	return `?${new URLSearchParams({ ...entries, limit: String(pagination.limit), offset: String(pagination.offset) })}`;
}

// Activity carries no labels or patient identity; it is only checked for its exact shape.
export function isAvailabilityActivity(value: unknown): value is AvailabilityActivity {
	return record(value) && hasExactKeys(value, ACTIVITY_KEYS)
		&& isUuid(value.id) && isUuid(value.subject_id) && isUuid(value.academic_group_id)
		&& isIsoDateTime(value.enabled_at)
		&& (value.withdrawn_at === null || isIsoDateTime(value.withdrawn_at));
}

function isSearchPatient(value: unknown): value is AvailabilityPatient {
	return record(value) && hasExactKeys(value, SEARCH_KEYS)
		&& isUuid(value.patient_id) && text(value.nombres) && text(value.apellidos);
}

function isContextFor(career: ReceptionCareer, value: unknown): value is AvailabilityContext {
	return record(value) && hasExactKeys(value, CONTEXT_KEYS)
		&& value.career === career && isUuid(value.subject_id) && isUuid(value.academic_group_id)
		&& text(value.subject_name) && text(value.academic_group_name);
}

function page<T>(value: unknown, pagination: AcademicPagination, isItem: (item: unknown) => item is T): AcademicPage<T> {
	if (!record(value) || !hasExactKeys(value, ['items', 'limit', 'offset']) || !Array.isArray(value.items)
		|| value.limit !== pagination.limit || value.offset !== pagination.offset || !value.items.every(isItem)) {
		throw new Error('Respuesta paginada inválida.');
	}
	return { items: value.items as T[], limit: pagination.limit, offset: pagination.offset };
}

// Reads the "subject_id:academic_group_id" value used by the enable selector.
export function parseContextPair(value: string): { subject_id: string; academic_group_id: string } | null {
	const parts = value.split(':');
	if (parts.length !== 2 || !isUuid(parts[0]) || !isUuid(parts[1])) return null;
	return { subject_id: parts[0], academic_group_id: parts[1] };
}

export async function searchAvailabilityPatients(career: ReceptionCareer, documento: string, pagination: AcademicPagination, cookies: AstroCookies): Promise<AcademicPage<AvailabilityPatient>> {
	assertCareer(career);
	if (!isDocumento(documento)) throw new Error('Documento inválido.');
	assertPagination(pagination);
	const response = await apiFetch<unknown>(`/reception/availability/search${scopedQuery({ career, documento }, pagination)}`, { cookies });
	return page(response, pagination, isSearchPatient);
}

export async function listAvailabilityContexts(career: ReceptionCareer, pagination: AcademicPagination, cookies: AstroCookies): Promise<AcademicPage<AvailabilityContext>> {
	assertCareer(career);
	assertPagination(pagination);
	const response = await apiFetch<unknown>(`/reception/availability/contexts${scopedQuery({ career }, pagination)}`, { cookies });
	return page(response, pagination, (item): item is AvailabilityContext => isContextFor(career, item));
}

export async function listAvailabilityHistory(career: ReceptionCareer, patientId: string, pagination: AcademicPagination, cookies: AstroCookies): Promise<AcademicPage<AvailabilityActivity>> {
	assertCareer(career);
	assertUuid(patientId, 'Paciente');
	assertPagination(pagination);
	const response = await apiFetch<unknown>(`/reception/availability/history${scopedQuery({ career, patient_id: patientId }, pagination)}`, { cookies });
	return page(response, pagination, isAvailabilityActivity);
}

export async function enableAvailability(input: AvailabilityEnableInput, cookies: AstroCookies): Promise<AvailabilityActivity> {
	assertCareer(input.career);
	assertUuid(input.patient_id, 'Paciente');
	assertUuid(input.subject_id, 'Asignatura');
	assertUuid(input.academic_group_id, 'Grupo');
	const body = { career: input.career, patient_id: input.patient_id, subject_id: input.subject_id, academic_group_id: input.academic_group_id };
	const response = await apiFetch<unknown>('/reception/availability', { method: 'POST', body, cookies });
	if (!isAvailabilityActivity(response) || response.withdrawn_at !== null
		|| response.subject_id.toLowerCase() !== input.subject_id.toLowerCase()
		|| response.academic_group_id.toLowerCase() !== input.academic_group_id.toLowerCase()) {
		throw new Error('Respuesta de disponibilidad inválida.');
	}
	return response;
}

export async function withdrawAvailability(career: ReceptionCareer, activityId: string, cookies: AstroCookies): Promise<AvailabilityActivity> {
	assertCareer(career);
	assertUuid(activityId, 'Disponibilidad');
	const response = await apiFetch<unknown>(`/reception/availability/${encodeURIComponent(activityId)}/withdraw`, { method: 'POST', body: { career }, cookies });
	if (!isAvailabilityActivity(response) || response.id.toLowerCase() !== activityId.toLowerCase() || response.withdrawn_at === null) {
		throw new Error('Respuesta de retiro inválida.');
	}
	return response;
}
