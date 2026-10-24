import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';

export interface AssignedPatient {
	id: string;
	patient_id: string;
	student_habilitation_id: string;
	subject_id: string;
	academic_group_id: string;
	assigned_by: string;
	nombres: string;
	apellidos: string;
	documento: string;
	assigned_at: string;
	ended_by: string | null;
	ended_at: string | null;
	end_reason: string | null;
}

export interface AssignmentPage {
	items: AssignedPatient[];
	limit: number;
	offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SAFE_OFFSET = Number.MAX_SAFE_INTEGER;

export function parseAssignmentPagination(params: URLSearchParams): { limit: number; offset: number } {
	return {
		limit: parseParameter(params, 'limit', DEFAULT_LIMIT, MAX_LIMIT, 1),
		offset: parseParameter(params, 'offset', 0, MAX_SAFE_OFFSET, 0),
	};
}

function parseParameter(params: URLSearchParams, name: 'limit' | 'offset', fallback: number, maximum: number, minimum: number): number {
	const values = params.getAll(name);
	if (values.length === 0) return fallback;
	if (values.length !== 1 || !/^\d+$/.test(values[0])) throw new Error(`El parámetro ${name} no es válido.`);
	const parsed = Number(values[0]);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`El parámetro ${name} no es válido.`);
	return parsed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_ID = /^[1-9]\d{0,18}$/;
const MAX_ID = 9223372036854775807n;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Fetch and validate the authenticated user's active patient assignments. */
export async function listAssignedPatients(
	pagination: { limit: number; offset: number },
	cookies: AstroCookies,
): Promise<AssignmentPage> {
	const query = new URLSearchParams({ limit: String(pagination.limit), offset: String(pagination.offset) });
	const response = await apiFetch<unknown>(`/patient-assignments/mine?${query}`, { cookies });
	if (!isRecord(response) || !Array.isArray(response.items)
		|| response.limit !== pagination.limit || response.offset !== pagination.offset) {
		throw new Error('La respuesta de asignaciones no es válida.');
	}
	return {
		items: response.items.map(validateAssignedPatient),
		limit: response.limit,
		offset: response.offset,
	};
}

function validateAssignedPatient(value: unknown): AssignedPatient {
	if (!isRecord(value) || typeof value.id !== 'string' || !DECIMAL_ID.test(value.id) || BigInt(value.id) > MAX_ID) {
		throw new Error('La respuesta de asignaciones contiene un identificador no válido.');
	}
	for (const field of ['patient_id', 'student_habilitation_id', 'subject_id', 'academic_group_id', 'assigned_by']) {
		if (typeof value[field] !== 'string' || !UUID.test(value[field])) throw new Error('La respuesta de asignaciones contiene referencias no válidas.');
	}
	for (const field of ['nombres', 'apellidos', 'documento']) {
		if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error('La respuesta de asignaciones contiene datos incompletos.');
	}
	if (typeof value.assigned_at !== 'string' || !TIMESTAMP.test(value.assigned_at) || Number.isNaN(Date.parse(value.assigned_at))) {
		throw new Error('La respuesta de asignaciones contiene una fecha no válida.');
	}
	if (value.ended_at !== null && (typeof value.ended_at !== 'string' || !TIMESTAMP.test(value.ended_at) || Number.isNaN(Date.parse(value.ended_at)))) {
		throw new Error('La respuesta de asignaciones contiene una fecha no válida.');
	}
	if (value.ended_by !== null || value.ended_at !== null || value.end_reason !== null) {
		throw new Error('La asignación ya no está activa.');
	}
	return {
		id: value.id,
		patient_id: value.patient_id,
		student_habilitation_id: value.student_habilitation_id,
		subject_id: value.subject_id,
		academic_group_id: value.academic_group_id,
		assigned_by: value.assigned_by,
		nombres: value.nombres,
		apellidos: value.apellidos,
		documento: value.documento,
		assigned_at: value.assigned_at,
		ended_by: value.ended_by,
		ended_at: value.ended_at,
		end_reason: value.end_reason,
	};
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
