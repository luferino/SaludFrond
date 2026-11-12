import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';
import { listingSearchQuery, parseListSearch } from './list-search';

export interface SubjectSummary {
	id: string;
	name: string;
}

export interface CreatedSubject {
	id: string;
	name: string;
	created_by: string | null;
	created_at: string;
}

export async function createSubject(name: string, cookies: AstroCookies): Promise<CreatedSubject> {
	return apiFetch<CreatedSubject>('/subjects', {
		method: 'POST',
		body: { name: name.trim() },
		cookies,
	});
}

export type SubjectListResult =
	| { state: 'success'; page: AcademicPage<SubjectSummary> }
	| { state: 'denied' }
	| { state: 'failed' };

/** Fetches one backend-authoritative subject page for the current session. */
export async function listSubjects(
	pagination: AcademicPagination,
	cookies: AstroCookies,
	q?: string,
	careerId?: string,
): Promise<SubjectListResult> {
	const search = parseListSearch(new URLSearchParams(q === undefined ? '' : `q=${encodeURIComponent(q)}`));
	if (!search.valid) return { state: 'failed' };
	const query = new URLSearchParams({
		limit: String(pagination.limit),
		offset: String(pagination.offset),
	});
	for (const [key, value] of listingSearchQuery(search.term, careerId ?? null)) query.set(key, value);

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
