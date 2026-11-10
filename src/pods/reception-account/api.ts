import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';

export type ReceptionCareer = 'kinesiology' | 'odontology';
export interface ReceptionAccount { id: string; username: string; role: 'reception'; email: string; createdAt: string }
export interface ReceptionAccountSearchItem { id: string; username: string; email: string | null; active_careers: ReceptionCareer[] }
export type ReceptionAccountSearchResult = { state: 'success'; items: ReceptionAccountSearchItem[]; limit: number; offset: number } | { state: 'denied' } | { state: 'failed' };
export interface ReceptionCareerGrant {
	id: string; user_id: string; career: ReceptionCareer; granted_by: string; granted_at: string;
	revoked_by: string | null; revoked_at: string | null;
}
export type GrantListResult = { state: 'success'; items: ReceptionCareerGrant[] } | { state: 'denied' } | { state: 'failed' };

export interface ReceptionRoleCandidate { id: string; username: string; email: string | null }
export type ReceptionRoleCandidateResult = { state: 'success'; items: ReceptionRoleCandidate[]; limit: number; offset: number } | { state: 'invalid' } | { state: 'denied' } | { state: 'failed' };
export interface ReceptionRoleGrant {
	id: string; user_id: string; role: 'reception'; granted_by: string; granted_at: string;
	revoked_by: string | null; revoked_at: string | null;
}
export type RoleGrantListResult = { state: 'success'; items: ReceptionRoleGrant[] } | { state: 'denied' } | { state: 'not_found' } | { state: 'failed' };

export const receptionCareers: ReceptionCareer[] = ['kinesiology', 'odontology'];
export const receptionCareerLabels: Record<ReceptionCareer, string> = { kinesiology: 'Kinesiología', odontology: 'Odontología' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[A-Z0-9]+$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ACCOUNT_KEYS = ['createdAt', 'email', 'id', 'role', 'username'];
const GRANT_KEYS = ['career', 'granted_at', 'granted_by', 'id', 'revoked_at', 'revoked_by', 'user_id'];
const SEARCH_ITEM_KEYS = ['active_careers', 'email', 'id', 'username'];
const ROLE_CANDIDATE_KEYS = ['email', 'id', 'username'];
const ROLE_CANDIDATE_PAGE_KEYS = ['items', 'limit', 'offset'];
const ROLE_GRANT_KEYS = ['granted_at', 'granted_by', 'id', 'revoked_at', 'revoked_by', 'role', 'user_id'];
const ROLE_HISTORY_KEYS = ['items'];
export const ROLE_CANDIDATE_LIMIT = 20;
const ROLE_CANDIDATE_MAX_QUERY = 100;

const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

export function isAccountId(value: string): boolean {
	return uuid(value);
}

export function isReceptionCareer(value: unknown): value is ReceptionCareer {
	return value === 'kinesiology' || value === 'odontology';
}

export function parseRoleStudentSelection(params: URLSearchParams): string {
	const values = params.getAll('student_id');
	if (values.length === 0 || (values.length === 1 && values[0] === '')) return '';
	if (values.length !== 1 || !uuid(values[0])) throw new Error('El estudiante seleccionado no es válido.');
	return values[0];
}

export function parseAccountSelection(params: URLSearchParams): string {
	const values = params.getAll('account_id');
	if (values.length === 0 || (values.length === 1 && values[0] === '')) return '';
	if (values.length !== 1 || !uuid(values[0])) throw new Error('La cuenta seleccionada no es válida.');
	return values[0];
}

export function isReceptionAccount(value: unknown): value is ReceptionAccount {
	if (!isRecord(value) || !hasExactKeys(value, ACCOUNT_KEYS)) return false;
	return uuid(value.id) && value.role === 'reception'
		&& typeof value.username === 'string' && USERNAME.test(value.username)
		&& typeof value.email === 'string' && value.email.length > 0
		&& iso(value.createdAt);
}

export function isReceptionCareerGrant(value: unknown): value is ReceptionCareerGrant {
	if (!isRecord(value) || !hasExactKeys(value, GRANT_KEYS)) return false;
	return uuid(value.id) && uuid(value.user_id) && isReceptionCareer(value.career)
		&& uuid(value.granted_by) && iso(value.granted_at)
		&& (value.revoked_by === null || uuid(value.revoked_by))
		&& (value.revoked_at === null || iso(value.revoked_at))
		&& ((value.revoked_by === null) === (value.revoked_at === null));
}

export async function createReceptionAccount(input: { username: string; password: string; email: string }, cookies: AstroCookies): Promise<ReceptionAccount> {
	const response = await apiFetch<unknown>('/auth/accounts', { method: 'POST', body: input, cookies });
	if (!isReceptionAccount(response)) throw new Error('Invalid service response');
	return response;
}

function isReceptionAccountSearchItem(value: unknown): value is ReceptionAccountSearchItem {
	if (!isRecord(value) || !hasExactKeys(value, SEARCH_ITEM_KEYS)) return false;
	return uuid(value.id) && typeof value.username === 'string' && USERNAME.test(value.username)
		&& (value.email === null || (typeof value.email === 'string' && value.email.length > 0))
		&& Array.isArray(value.active_careers) && value.active_careers.every(isReceptionCareer)
		&& new Set(value.active_careers).size === value.active_careers.length;
}

export async function searchReceptionAccounts(query: { q: string; career: ReceptionCareer | ''; limit: number; offset: number }, cookies: AstroCookies): Promise<ReceptionAccountSearchResult> {
	const params = new URLSearchParams();
	const q = query.q.trim();
	if (q) params.set('q', q);
	if (query.career) params.set('career', query.career);
	params.set('limit', String(query.limit));
	params.set('offset', String(query.offset));
	try {
		const response = await apiFetch<unknown>(`/auth/accounts?${params.toString()}`, { cookies });
		if (!isRecord(response) || !hasExactKeys(response, ['items', 'limit', 'offset']) || !Array.isArray(response.items)
			|| response.limit !== query.limit || response.offset !== query.offset
			|| !response.items.every(isReceptionAccountSearchItem) || response.items.length > query.limit) return { state: 'failed' };
		return { state: 'success', items: response.items as ReceptionAccountSearchItem[], limit: response.limit, offset: response.offset };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}

export async function listReceptionCareerGrants(userId: string, cookies: AstroCookies): Promise<GrantListResult> {
	try {
		const response = await apiFetch<unknown>(`/auth/accounts/${userId}/careers`, { cookies });
		if (!isRecord(response) || !Array.isArray(response.items)) return { state: 'failed' };
		const items = response.items;
		return items.every((item) => isReceptionCareerGrant(item) && item.user_id === userId)
			? { state: 'success', items: items as ReceptionCareerGrant[] }
			: { state: 'failed' };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}

export async function grantReceptionCareer(userId: string, career: ReceptionCareer, cookies: AstroCookies): Promise<ReceptionCareerGrant> {
	const response = await apiFetch<unknown>(`/auth/accounts/${userId}/careers`, { method: 'POST', body: { career }, cookies });
	if (!isReceptionCareerGrant(response) || response.user_id !== userId || response.career !== career
		|| response.revoked_at !== null || response.revoked_by !== null) throw new Error('Invalid service response');
	return response;
}

export async function revokeReceptionCareerGrant(grantId: string, cookies: AstroCookies): Promise<ReceptionCareerGrant> {
	const response = await apiFetch<unknown>(`/auth/career-grants/${grantId}/revoke`, { method: 'POST', cookies });
	if (!isReceptionCareerGrant(response) || response.id !== grantId || response.revoked_at === null || response.revoked_by === null) throw new Error('Invalid service response');
	return response;
}

// Additional Reception role (admin-only). Candidate usernames are student identities, so they are not forced to the Reception uppercase pattern.
function isReceptionRoleCandidate(value: unknown): value is ReceptionRoleCandidate {
	if (!isRecord(value) || !hasExactKeys(value, ROLE_CANDIDATE_KEYS)) return false;
	return uuid(value.id) && typeof value.username === 'string' && value.username.length > 0
		&& (value.email === null || (typeof value.email === 'string' && value.email.length > 0));
}

export function isReceptionRoleGrant(value: unknown): value is ReceptionRoleGrant {
	if (!isRecord(value) || !hasExactKeys(value, ROLE_GRANT_KEYS)) return false;
	return uuid(value.id) && uuid(value.user_id) && value.role === 'reception'
		&& uuid(value.granted_by) && iso(value.granted_at)
		&& (value.revoked_by === null || uuid(value.revoked_by))
		&& (value.revoked_at === null || iso(value.revoked_at))
		&& ((value.revoked_by === null) === (value.revoked_at === null));
}

export async function searchReceptionRoleCandidates(query: { q: string; offset: number }, cookies: AstroCookies): Promise<ReceptionRoleCandidateResult> {
	const q = query.q.trim();
	if (!q || q.length > ROLE_CANDIDATE_MAX_QUERY) return { state: 'invalid' };
	const params = new URLSearchParams({ q, limit: String(ROLE_CANDIDATE_LIMIT), offset: String(query.offset) });
	try {
		const response = await apiFetch<unknown>(`/auth/reception-role-candidates?${params.toString()}`, { cookies });
		if (!isRecord(response) || !hasExactKeys(response, ROLE_CANDIDATE_PAGE_KEYS) || !Array.isArray(response.items)
			|| response.limit !== ROLE_CANDIDATE_LIMIT || response.offset !== query.offset
			|| response.items.length > ROLE_CANDIDATE_LIMIT || !response.items.every(isReceptionRoleCandidate)) return { state: 'failed' };
		return { state: 'success', items: response.items as ReceptionRoleCandidate[], limit: ROLE_CANDIDATE_LIMIT, offset: query.offset };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}

export async function listReceptionRoleGrants(userId: string, cookies: AstroCookies): Promise<RoleGrantListResult> {
	if (!uuid(userId)) return { state: 'not_found' };
	try {
		const response = await apiFetch<unknown>(`/auth/accounts/${userId}/reception-role`, { cookies });
		if (!isRecord(response) || !hasExactKeys(response, ROLE_HISTORY_KEYS) || !Array.isArray(response.items)) return { state: 'failed' };
		const items = response.items;
		// One account holds at most one active additional Reception role; the backend enforces it, the parser refuses to render an ambiguous history.
		if (!items.every((item) => isReceptionRoleGrant(item) && item.user_id === userId)
			|| items.filter((item) => item.revoked_at === null).length > 1) return { state: 'failed' };
		return { state: 'success', items: items as ReceptionRoleGrant[] };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 404) return { state: 'not_found' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}

export async function createReceptionRoleGrant(userId: string, cookies: AstroCookies): Promise<ReceptionRoleGrant> {
	if (!uuid(userId)) throw new Error('Invalid service request');
	const response = await apiFetch<unknown>(`/auth/accounts/${userId}/reception-role`, { method: 'POST', body: {}, cookies });
	if (!isReceptionRoleGrant(response) || response.user_id !== userId || response.revoked_at !== null || response.revoked_by !== null) throw new Error('Invalid service response');
	return response;
}

export async function revokeReceptionRoleGrant(grantId: string, cookies: AstroCookies): Promise<ReceptionRoleGrant> {
	if (!uuid(grantId)) throw new Error('Invalid service request');
	const response = await apiFetch<unknown>(`/auth/reception-role-grants/${grantId}/revoke`, { method: 'POST', body: {}, cookies });
	if (!isReceptionRoleGrant(response) || response.id !== grantId || response.revoked_at === null || response.revoked_by === null) throw new Error('Invalid service response');
	return response;
}
