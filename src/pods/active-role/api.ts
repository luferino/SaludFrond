import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import { decodeJwt } from '../../shared/jwt';

export interface RolesResponse { active_role: string; available_roles: string[] }
export type RolesResult = { state: 'success'; roles: RolesResponse } | { state: 'failed' };
export interface SwitchTarget { role: string; label: string }

export const ROLE_PATTERN = /^[a-z_]{1,32}$/;
const ROLE_KEYS = ['active_role', 'available_roles'];
// Only these primary or additional roles take part in explicit active-role switching.
const ROLE_LABELS: Record<string, string> = { estudiante: 'Estudiante', student: 'Estudiante', reception: 'Recepción' };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isRole = (value: unknown): value is string => typeof value === 'string' && ROLE_PATTERN.test(value);

export function roleLabel(role: string): string | undefined {
	return Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role] : undefined;
}

export function mayHoldAdditionalRole(role: unknown): boolean {
	return typeof role === 'string' && roleLabel(role) !== undefined;
}

export function isRolesResponse(value: unknown): value is RolesResponse {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value);
	if (keys.length !== ROLE_KEYS.length || !ROLE_KEYS.every((key) => keys.includes(key))) return false;
	const { active_role: active, available_roles: available } = value;
	return isRole(active) && Array.isArray(available) && available.length > 0
		&& available.every(isRole) && new Set(available).size === available.length
		&& available.includes(active);
}

export function switchTargets(roles: RolesResponse): SwitchTarget[] {
	if (!roleLabel(roles.active_role)) return [];
	return roles.available_roles
		.filter((role) => role !== roles.active_role)
		.flatMap((role) => {
			const label = roleLabel(role);
			return label ? [{ role, label }] : [];
		});
}

// Layout rendering only reads the session: a stale token is cleared by the next page request instead.
function readOnly(cookies: AstroCookies): AstroCookies {
	return { get: (name: string) => cookies.get(name), delete: () => {}, set: () => {} } as unknown as AstroCookies;
}

export async function getActiveRoles(cookies: AstroCookies): Promise<RolesResult> {
	try {
		const response = await apiFetch<unknown>('/auth/roles', { cookies: readOnly(cookies) });
		return isRolesResponse(response) ? { state: 'success', roles: response } : { state: 'failed' };
	} catch {
		return { state: 'failed' };
	}
}

// The reissued token must carry the requested role for the same person; anything else is rejected.
export async function requestActiveRole(role: string, cookies: AstroCookies): Promise<string> {
	const current = decodeJwt(cookies.get('session')?.value ?? '');
	const response = await apiFetch<unknown>('/auth/active-role', { method: 'POST', body: { role }, cookies });
	if (!isRecord(response) || Object.keys(response).length !== 1 || typeof response.token !== 'string') {
		throw new Error('Invalid active-role response');
	}
	const next = decodeJwt(response.token);
	if (!next || !current || next.role !== role || typeof next.sub !== 'string' || next.sub !== current.sub
		|| next.username !== current.username || typeof next.exp !== 'number') {
		throw new Error('Invalid active-role token');
	}
	return response.token;
}
