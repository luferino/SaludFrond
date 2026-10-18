import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';

export interface SubjectSummary {
	id: string;
	name: string;
}

export type SubjectListResult =
	| { state: 'success'; page: AcademicPage<SubjectSummary> }
	| { state: 'denied' }
	| { state: 'failed' };

/** Fetches one backend-authoritative subject page for the current session. */
export async function listSubjects(
	pagination: AcademicPagination,
	cookies: AstroCookies,
): Promise<SubjectListResult> {
	const query = new URLSearchParams({
		limit: String(pagination.limit),
		offset: String(pagination.offset),
	});

	try {
		const page = await apiFetch<AcademicPage<SubjectSummary>>(`/subjects?${query}`, { cookies });
		if (!page || !Array.isArray(page.items)
			|| page.limit !== pagination.limit || page.offset !== pagination.offset
			|| !page.items.every((item) => item && typeof item.id === 'string' && typeof item.name === 'string')) {
			return { state: 'failed' };
		}
		return { state: 'success', page };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}
