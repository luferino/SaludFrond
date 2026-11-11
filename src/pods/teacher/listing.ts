import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import { academicPaginationQuery, type AcademicPage, type AcademicPagination } from '../../shared/academic-api';

export interface TeacherListingItem {
	id: string;
	nombres: string;
	apellidos: string;
}

function rejectStructuredSearch(params: URLSearchParams): void {
	if ([...params.keys()].some((key) => key.startsWith('q[') || key.startsWith('q.'))) {
		throw new Error('El parámetro q debe ser una cadena de hasta 100 caracteres.');
	}
}

export function parseTeacherSearch(params: URLSearchParams): string | null {
	rejectStructuredSearch(params);
	const values = params.getAll('q');
	if (values.length > 1) throw new Error('El parámetro q debe ser una cadena de hasta 100 caracteres.');
	if (values.length === 0) return null;
	const value = values[0].trim();
	if (value.length > 100) throw new Error('El parámetro q debe ser una cadena de hasta 100 caracteres.');
	return value || null;
}

export function teacherPageHref(pagination: AcademicPagination, q: string | null, offset: number): string {
	const params = new URLSearchParams(academicPaginationQuery({ ...pagination, offset }).slice(1));
	if (q) params.set('q', q);
	return `/teachers?${params.toString()}`;
}

function validTeacherPage(value: unknown, pagination: AcademicPagination): value is AcademicPage<TeacherListingItem> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const page = value as Record<string, unknown>;
	if (Object.keys(page).sort().join(',') !== 'items,limit,offset'
		|| page.limit !== pagination.limit || page.offset !== pagination.offset
		|| !Array.isArray(page.items) || page.items.length > pagination.limit) return false;
	return page.items.every((item) => {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
		const row = item as Record<string, unknown>;
		const keys = Object.keys(row).sort();
		return keys.length === 3 && keys.join(',') === 'apellidos,id,nombres'
			&& typeof row.id === 'string' && row.id.length > 0
			&& typeof row.nombres === 'string' && typeof row.apellidos === 'string';
	});
}

export async function listTeachers(
	pagination: AcademicPagination,
	q: string | null,
	cookies: AstroCookies,
): Promise<AcademicPage<TeacherListingItem>> {
	const params = new URLSearchParams(academicPaginationQuery(pagination).slice(1));
	if (q) params.set('q', q);
	const page = await apiFetch<unknown>(`/teachers?${params.toString()}`, { cookies });
	if (!validTeacherPage(page, pagination)) throw new Error('Respuesta de lista inválida.');
	return page;
}
