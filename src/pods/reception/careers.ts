import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';

// Shared by every reception area (patients now, availability next). Careers are
// re-read from the backend on each call: grants can be revoked at any time.
export const RECEPTION_CAREERS = ['kinesiology', 'odontology'] as const;
export type ReceptionCareer = (typeof RECEPTION_CAREERS)[number];

export const RECEPTION_CAREER_LABELS: Record<ReceptionCareer, string> = {
	kinesiology: 'Kinesiología',
	odontology: 'Odontología',
};

export interface CareerScope {
	careers: ReceptionCareer[];
	selected: ReceptionCareer | null;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function isReceptionCareer(value: unknown): value is ReceptionCareer {
	return typeof value === 'string' && (RECEPTION_CAREERS as readonly string[]).includes(value);
}

function isCareersResponse(value: unknown): value is { careers: ReceptionCareer[] } {
	if (!record(value) || Object.keys(value).join() !== 'careers' || !Array.isArray(value.careers)) return false;
	const careers = value.careers;
	return careers.every(isReceptionCareer) && new Set(careers).size === careers.length;
}

export async function listGrantedCareers(cookies: AstroCookies): Promise<ReceptionCareer[]> {
	const response = await apiFetch<unknown>('/reception/careers', { cookies });
	if (!isCareersResponse(response)) throw new Error('Respuesta de carreras inválida.');
	return response.careers;
}

// Repeated ?career= values are ambiguous, so they select nothing.
export function parseRequestedCareer(params: URLSearchParams): string | null {
	const values = params.getAll('career');
	return values.length === 1 ? values[0] : null;
}

export function selectGrantedCareer(requested: string | null | undefined, careers: readonly ReceptionCareer[]): ReceptionCareer | null {
	return isReceptionCareer(requested) && careers.includes(requested) ? requested : null;
}

export async function loadCareerScope(params: URLSearchParams, cookies: AstroCookies): Promise<CareerScope> {
	const careers = await listGrantedCareers(cookies);
	return { careers, selected: selectGrantedCareer(parseRequestedCareer(params), careers) };
}
