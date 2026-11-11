export const INVALID_LIST_SEARCH = 'La búsqueda debe tener como máximo 100 caracteres.';
export const INVALID_CAREER_CONTEXT = 'El identificador de carrera no es válido.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCareerContext(params: URLSearchParams): { valid: true; careerId: string | null } | { valid: false; careerId: null } {
	const values = params.getAll('career_id');
	const structured = [...params.keys()].some((key) => key.startsWith('career_id[') || key.startsWith('career_id.'));
	if (structured || values.length > 1 || (values.length === 1 && !UUID_PATTERN.test(values[0]))) {
		return { valid: false, careerId: null };
	}
	return { valid: true, careerId: values[0] ?? null };
}

export function parseListSearch(params: URLSearchParams): { valid: true; term: string } | { valid: false; term: '' } {
	const values = params.getAll('q');
	if (values.length > 1 || [...params.keys()].some((key) => key.startsWith('q[') || key.startsWith('q.'))) {
		return { valid: false, term: '' };
	}
	const term = (values[0] ?? '').trim();
	if (term.length > 100) return { valid: false, term: '' };
	return { valid: true, term };
}

export function listingSearchQuery(term: string, careerId: string | null): URLSearchParams {
	const query = new URLSearchParams();
	if (careerId) query.set('career_id', careerId);
	if (term) query.set('q', term);
	return query;
}
