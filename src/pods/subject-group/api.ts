import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';

export interface SubjectGroupAssociation {
	subject_id: string;
	academic_group_id: string;
	created_by: string | null;
	created_at: string;
}

export interface SubjectGroupFilter {
	subjectId: string | null;
}

export type SubjectGroupListResult =
	| { state: 'success'; page: AcademicPage<SubjectGroupAssociation> }
	| { state: 'denied' }
	| { state: 'failed' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse the optional subject filter; repeated and explicitly blank values are invalid. */
export function parseSubjectGroupFilter(params: URLSearchParams): SubjectGroupFilter {
	const values = params.getAll('subject_id');
	if (values.length === 0) return { subjectId: null };
	if (values.length !== 1 || !UUID_PATTERN.test(values[0])) {
		throw new Error('El filtro de asignatura debe ser un UUID válido.');
	}
	return { subjectId: values[0] };
}

/** Allowlist page size, offset and subject filter in a local listing URL; discard other parameters. */
export function subjectGroupPageHref(
	current: URLSearchParams,
	pagination: AcademicPagination,
	offset: number,
): string {
	const params = new URLSearchParams({
		limit: String(pagination.limit),
		offset: String(offset),
	});
	const subjectId = current.get('subject_id');
	if (subjectId !== null) params.set('subject_id', subjectId);
	return `/subject-groups?${params.toString()}`;
}

/** Allowlist the new subject filter and page size, reset offset, and discard other parameters. */
export function subjectGroupFilterHref(
	current: URLSearchParams,
	subjectId: string,
	limit: number,
): string {
	const params = new URLSearchParams({
		limit: String(limit),
		offset: '0',
		subject_id: subjectId,
	});
	return `/subject-groups?${params.toString()}`;
}

/** Allowlist page size and reset offset, omitting the subject filter and all unrelated parameters. */
export function subjectGroupClearFilterHref(current: URLSearchParams, limit: number): string {
	return `/subject-groups?${new URLSearchParams({ limit: String(limit), offset: '0' }).toString()}`;
}

function isIsoDateTime(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		return false;
	}
	return Number.isFinite(Date.parse(value));
}

function isAssociation(value: unknown): value is SubjectGroupAssociation {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return typeof item.subject_id === 'string' && UUID_PATTERN.test(item.subject_id)
		&& typeof item.academic_group_id === 'string' && UUID_PATTERN.test(item.academic_group_id)
		&& (item.created_by === null || (typeof item.created_by === 'string' && UUID_PATTERN.test(item.created_by)))
		&& isIsoDateTime(item.created_at);
}

export async function listSubjectGroups(
	pagination: AcademicPagination,
	filter: SubjectGroupFilter,
	cookies: AstroCookies,
): Promise<SubjectGroupListResult> {
	const query = new URLSearchParams({
		limit: String(pagination.limit),
		offset: String(pagination.offset),
	});
	if (filter.subjectId !== null) query.set('subject_id', filter.subjectId);

	try {
		const page = await apiFetch<AcademicPage<SubjectGroupAssociation>>(`/subject-groups?${query}`, { cookies });
		if (!page || typeof page !== 'object' || !Array.isArray(page.items)
			|| page.limit !== pagination.limit || page.offset !== pagination.offset
			|| !page.items.every(isAssociation)) {
			return { state: 'failed' };
		}
		return { state: 'success', page };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}
