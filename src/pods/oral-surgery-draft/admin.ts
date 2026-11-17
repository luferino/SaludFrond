import type { AstroCookies } from 'astro';
import { decodeJwt } from '../../shared/jwt';
import { realClinicalDate } from '../kinesiology-evaluation/list-filters';

export interface OralSurgeryAdminListing { limit: number; offset: number; filters: { date_from?: string; date_to?: string } }

const MAX_OFFSET = 2147483647;
const INVALID = 'Los filtros o la paginación no son válidos.';

/** Presentation hint only: an administrator with the read grant. The backend re-checks every request. */
export function oralSurgeryAdminGrant(cookies: AstroCookies): boolean {
	const token = cookies.get('session')?.value;
	const actor = token ? decodeJwt(token) : null;
	return !!actor && actor.role === 'admin' && Array.isArray(actor.permissions)
		&& actor.permissions.every((grant) => typeof grant === 'string') && actor.permissions.includes('oral-surgery-drafts:read');
}

/** Administrator list query: limit 1–100 (default 50), offset (default 0) and optional real dates, each given at most once. */
export function parseOralSurgeryAdminListing(params: URLSearchParams): OralSurgeryAdminListing {
	const single = (key: string): string | undefined => {
		const values = params.getAll(key);
		if (values.length > 1) throw new Error(INVALID);
		return values[0];
	};
	const integer = (key: string, fallback: number, min: number, max: number): number => {
		const value = single(key);
		if (value === undefined) return fallback;
		if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(INVALID);
		return Number(value);
	};
	const listing: OralSurgeryAdminListing = { limit: integer('limit', 50, 1, 100), offset: integer('offset', 0, 0, MAX_OFFSET), filters: {} };
	for (const key of ['date_from', 'date_to'] as const) {
		const value = single(key);
		// An empty date input submits an empty value: no filter.
		if (value === undefined || value === '') continue;
		if (!realClinicalDate(value)) throw new Error(INVALID);
		listing.filters[key] = value;
	}
	if (listing.filters.date_from && listing.filters.date_to && listing.filters.date_from > listing.filters.date_to) throw new Error(INVALID);
	return listing;
}

/** Query string of a validated listing, optionally at another offset. */
export function oralSurgeryAdminQuery(listing: OralSurgeryAdminListing, offset = listing.offset): string {
	const query = new URLSearchParams({ limit: String(listing.limit), offset: String(offset) });
	for (const key of ['date_from', 'date_to'] as const) {
		const value = listing.filters[key];
		if (value) query.set(key, value);
	}
	return query.toString();
}

/** Previous/next offsets without totals: a full page may have a next one. */
export function oralSurgeryAdminPagination(listing: OralSurgeryAdminListing, itemsLength: number): { previousOffset: number | null; nextOffset: number | null } {
	return {
		previousOffset: listing.offset > 0 ? Math.max(0, listing.offset - listing.limit) : null,
		nextOffset: itemsLength === listing.limit && listing.offset + listing.limit <= MAX_OFFSET ? listing.offset + listing.limit : null,
	};
}
