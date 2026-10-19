import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import { academicPaginationQuery } from '../../shared/academic-api';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';

export interface GroupSummary {
	id: string;
	academic_year: number;
	curriculum_semester: number;
	name: string;
}

export type GroupListResult =
	| { state: 'success'; page: AcademicPage<GroupSummary> }
	| { state: 'denied' }
	| { state: 'failed' };

const MAX_INT32 = 2_147_483_647;

function isPositiveInt32(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_INT32;
}

function isGroupSummary(value: unknown): value is GroupSummary {
	if (!value || typeof value !== 'object') return false;
	const group = value as Record<string, unknown>;
	return typeof group.id === 'string' && group.id.length > 0
		&& isPositiveInt32(group.academic_year)
		&& isPositiveInt32(group.curriculum_semester)
		&& typeof group.name === 'string' && group.name.trim().length > 0;
}

/** Fetches one backend-authoritative page of academic groups. */
export async function listGroups(
	pagination: AcademicPagination,
	cookies: AstroCookies,
): Promise<GroupListResult> {
	try {
		const page = await apiFetch<AcademicPage<GroupSummary>>(`/groups${academicPaginationQuery(pagination)}`, { cookies });
		if (!page || !Array.isArray(page.items)
			|| page.limit !== pagination.limit || page.offset !== pagination.offset
			|| !page.items.every(isGroupSummary)) {
			return { state: 'failed' };
		}
		return { state: 'success', page };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}
