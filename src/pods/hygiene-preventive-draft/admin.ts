import type { AstroCookies } from 'astro';
import { decodeJwt } from '../../shared/jwt';
import { uuid, type HygieneDraftAdminFilters } from './api';

export interface HygieneAdminListing extends HygieneDraftAdminFilters { limit: number; offset: number }

const MAX_OFFSET = 2147483647;
const INVALID = 'La paginación no es válida.';

/** Presentation hint only: an administrator holding the permission. The backend re-checks every request. */
export function hygienePermissionGrant(cookies: AstroCookies, permission: string): boolean {
	const token = cookies.get('session')?.value;
	const actor = token ? decodeJwt(token) : null;
	return !!actor && actor.role === 'admin' && Array.isArray(actor.permissions)
		&& actor.permissions.every((grant) => typeof grant === 'string') && actor.permissions.includes(permission);
}

/** Administrator consultation of every draft (D9). */
export function hygieneAdminGrant(cookies: AstroCookies): boolean {
	return hygienePermissionGrant(cookies, 'hygiene-preventive-drafts:read');
}

/** Academic filters are optional UUIDs. All supported parameters can be given at most once. */
export function parseHygieneAdminListing(params: URLSearchParams): HygieneAdminListing {
	const integer = (key: string, fallback: number, min: number, max: number): number => {
		const values = params.getAll(key);
		if (values.length > 1) throw new Error(INVALID);
		const value = values[0];
		if (value === undefined) return fallback;
		if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(INVALID);
		return Number(value);
	};
	const listing: HygieneAdminListing = { limit: integer('limit', 50, 1, 100), offset: integer('offset', 0, 0, MAX_OFFSET) };
	for (const key of ['patient_id', 'subject_id', 'academic_group_id'] as const) {
		const values = params.getAll(key);
		const [value] = values;
		if (values.length > 1 || (value && !uuid(value))) throw new Error('Los filtros no son válidos.');
		if (value) listing[key] = value.toLowerCase();
	}
	return listing;
}

/** Query string of a validated listing, optionally at another offset. */
export function hygieneAdminQuery(listing: HygieneAdminListing, offset = listing.offset): string {
	const query = new URLSearchParams({ limit: String(listing.limit), offset: String(offset) });
	if (listing.patient_id) query.set('patient_id', listing.patient_id);
	if (listing.subject_id) query.set('subject_id', listing.subject_id);
	if (listing.academic_group_id) query.set('academic_group_id', listing.academic_group_id);
	return query.toString();
}

/** Previous and next offsets without totals: a full page may have a next one. */
export function hygieneAdminPagination(listing: HygieneAdminListing, itemsLength: number): { previousOffset: number | null; nextOffset: number | null } {
	return {
		previousOffset: listing.offset > 0 ? Math.max(0, listing.offset - listing.limit) : null,
		nextOffset: itemsLength === listing.limit && listing.offset + listing.limit <= MAX_OFFSET ? listing.offset + listing.limit : null,
	};
}
