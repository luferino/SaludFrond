import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';

export type ReceptionCareer = 'kinesiology' | 'odontology';
export interface ReceptionAccount { id: string; username: string; role: 'reception'; email: string; createdAt: string }
export interface ReceptionCareerGrant {
	id: string; user_id: string; career: ReceptionCareer; granted_by: string; granted_at: string;
	revoked_by: string | null; revoked_at: string | null;
}
export type GrantListResult = { state: 'success'; items: ReceptionCareerGrant[] } | { state: 'denied' } | { state: 'failed' };

export const receptionCareers: ReceptionCareer[] = ['kinesiology', 'odontology'];
export const receptionCareerLabels: Record<ReceptionCareer, string> = { kinesiology: 'Kinesiología', odontology: 'Odontología' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[A-Z0-9]+$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ACCOUNT_KEYS = ['createdAt', 'email', 'id', 'role', 'username'];
const GRANT_KEYS = ['career', 'granted_at', 'granted_by', 'id', 'revoked_at', 'revoked_by', 'user_id'];

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
