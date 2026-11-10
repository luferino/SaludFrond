import type { ReceptionCareer } from './api';

export interface ReceptionAccountSearchQuery {
	q: string;
	career: ReceptionCareer | '';
	limit: number;
	offset: number;
}

// Astro form actions post back to `?_action=<name>`; that framework key carries no search state.
const allowed = new Set(['account_id', 'q', 'career', 'limit', 'offset', '_action']);
const MAX_QUERY_LENGTH = 100;
const MAX_OFFSET = 10000;
const fail = () => new Error('Los filtros de búsqueda no son válidos.');

export function parseReceptionAccountSearch(params: URLSearchParams): ReceptionAccountSearchQuery {
	for (const key of params.keys()) {
		if (!allowed.has(key)) throw fail();
	}
	const one = (key: string): string | undefined => {
		const values = params.getAll(key);
		if (values.length > 1) throw fail();
		return values[0];
	};
	const q = (one('q') ?? '').trim();
	if (q.length > MAX_QUERY_LENGTH) throw fail();
	const careerValue = one('career') ?? '';
	if (careerValue !== '' && careerValue !== 'kinesiology' && careerValue !== 'odontology') throw fail();
	const number = (key: 'limit' | 'offset', fallback: number, min: number, max: number) => {
		const value = one(key);
		if (value === undefined || value === '') return fallback;
		if (!/^(0|[1-9]\d*)$/.test(value)) throw fail();
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw fail();
		return parsed;
	};
	return { q, career: careerValue as ReceptionCareer | '', limit: number('limit', 50, 1, 100), offset: number('offset', 0, 0, MAX_OFFSET) };
}

/** A full page suggests more results; the backend rejects offsets beyond 10000. */
export function nextReceptionAccountOffset(offset: number, limit: number, count: number): number | null {
	const next = offset + limit;
	return count === limit && next <= MAX_OFFSET ? next : null;
}
