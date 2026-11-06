import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../shared/apiClient';

/** One subject and academic group pair where the caller has an active Oral Surgery I habilitation. */
export interface OralSurgeryDiscoveryPair { subject_id: string; academic_group_id: string }

/**
 * `forbidden` means the caller may not discover Oral Surgery at all. It says nothing about the subject
 * itself, so callers must not treat it as "this context uses Kinesiology".
 */
export type OralSurgeryDiscovery = { status: 'ok'; items: OralSurgeryDiscoveryPair[] } | { status: 'forbidden' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAIR_KEYS = ['subject_id', 'academic_group_id'];

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }

function isPair(value: unknown): value is OralSurgeryDiscoveryPair {
	return record(value) && exactKeys(value, PAIR_KEYS) && uuid(value.subject_id) && uuid(value.academic_group_id);
}

/**
 * Enabled subject and group pairs for the caller. A 403 becomes `forbidden`, never an empty list;
 * 401 and every other failure propagate so the caller can redirect or show an alert instead.
 */
export async function listOralSurgeryContexts(cookies: AstroCookies): Promise<OralSurgeryDiscovery> {
	let response: unknown;
	try {
		response = await apiFetch<unknown>('/oral-surgery-subjects/mine', { cookies });
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { status: 'forbidden' };
		throw error;
	}
	if (!record(response) || !exactKeys(response, ['items']) || !Array.isArray(response.items) || !response.items.every(isPair)) {
		throw new Error('La respuesta de asignaturas habilitadas no es válida.');
	}
	const seen = new Set<string>();
	for (const item of response.items) {
		const key = `${item.subject_id.toLowerCase()}|${item.academic_group_id.toLowerCase()}`;
		if (seen.has(key)) throw new Error('La respuesta de asignaturas habilitadas repite un par.');
		seen.add(key);
	}
	return { status: 'ok', items: response.items };
}

/** Exact subject and group match only; Oral Surgery is never inferred from names or hardcoded ids. */
export function isOralSurgeryContext(items: readonly OralSurgeryDiscoveryPair[], subjectId: string, academicGroupId: string): boolean {
	return items.some((item) => item.subject_id === subjectId && item.academic_group_id === academicGroupId);
}
