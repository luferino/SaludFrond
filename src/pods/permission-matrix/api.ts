import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';

export interface PermissionDefinition {
	permission: string;
	enforced: boolean;
}

export interface RoleAssignment {
	role: string;
	permissions: string[];
}

export interface PermissionMatrix {
	permissions: PermissionDefinition[];
	roles: RoleAssignment[];
}

export type PermissionMatrixResult = PermissionMatrix | { state: 'denied' | 'failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPermission(value: unknown): value is PermissionDefinition {
	return isRecord(value) && typeof value.permission === 'string'
		&& value.permission.trim().length > 0 && typeof value.enforced === 'boolean';
}

function isRole(value: unknown): value is RoleAssignment {
	return isRecord(value) && typeof value.role === 'string' && value.role.trim().length > 0
		&& Array.isArray(value.permissions)
		&& value.permissions.every((permission) => typeof permission === 'string' && permission.trim().length > 0);
}

function isPermissionMatrix(value: unknown): value is PermissionMatrix {
	return isRecord(value) && Array.isArray(value.permissions) && value.permissions.every(isPermission)
		&& Array.isArray(value.roles) && value.roles.every(isRole);
}

/** Retrieves the backend-authorized, read-only permission matrix. */
export async function getPermissionMatrix(cookies: AstroCookies): Promise<PermissionMatrixResult> {
	try {
		const value: unknown = await apiFetch<unknown>('/auth/permission-matrix', { cookies });
		if (!isPermissionMatrix(value)) return { state: 'failed' };
		return {
			permissions: [...value.permissions].sort((left, right) => left.permission.localeCompare(right.permission)),
			roles: [...value.roles].sort((left, right) => left.role.localeCompare(right.role)),
		};
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) throw error;
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		return { state: 'failed' };
	}
}
