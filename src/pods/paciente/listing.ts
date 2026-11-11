import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import { parseAcademicPagination } from '../../shared/academic-api';
import type { AcademicPagination } from '../../shared/academic-api';

export interface PatientListItem {
	id: string;
	documento: string;
	nombres: string;
	apellidos: string;
	fecha_nacimiento: string | null;
	email: string;
	celular: string;
	sexo: string;
	direccion: string;
}
export interface PatientListing extends AcademicPagination { items: PatientListItem[] }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
function isPatient(value: unknown): value is PatientListItem {
	return isRecord(value) && exactKeys(value, [
		'id', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion',
	])
		&& typeof value.id === 'string' && typeof value.documento === 'string'
		&& typeof value.nombres === 'string' && typeof value.apellidos === 'string'
		&& (value.fecha_nacimiento === null || typeof value.fecha_nacimiento === 'string')
		&& typeof value.email === 'string' && typeof value.celular === 'string'
		&& typeof value.sexo === 'string' && typeof value.direccion === 'string';
}

export function parsePatientListing(params: URLSearchParams): AcademicPagination & { q: string } {
	if ([...params.keys()].some((key) => key.startsWith('q[') || key.startsWith('q.'))) {
		throw new Error('El parámetro q debe ser texto plano.');
	}
	const values = params.getAll('q');
	if (values.length > 1) throw new Error('El parámetro q debe ser único.');
	const q = (values[0] ?? '').trim();
	if (q.length > 100) throw new Error('La búsqueda debe tener como máximo 100 caracteres.');
	return { ...parseAcademicPagination(params), q };
}

export async function listPatients(input: AcademicPagination & { q: string }, cookies: AstroCookies): Promise<PatientListing> {
	const q = input.q.trim();
	if (q.length > 100) throw new Error('La búsqueda debe tener como máximo 100 caracteres.');
	const query = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) });
	if (q) query.set('q', q);
	const response = await apiFetch<unknown>(`/patients?${query.toString()}`, { cookies });
	if (!isRecord(response) || !exactKeys(response, ['items', 'limit', 'offset'])
		|| !Array.isArray(response.items) || !response.items.every(isPatient)
		|| response.limit !== input.limit || response.offset !== input.offset) {
		throw new Error('Respuesta de pacientes inválida.');
	}
	return { items: response.items, limit: response.limit, offset: response.offset };
}
