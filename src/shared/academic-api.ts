export interface AcademicPagination {
	limit: number;
	offset: number;
}

export interface AcademicPage<T> extends AcademicPagination {
	items: T[];
}

export interface AcademicPaginationNavigation {
	previousOffset: number | null;
	nextOffset: number | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

/** Parse and validate the academic APIs' bounded pagination parameters. */
export function parseAcademicPagination(params: URLSearchParams): AcademicPagination {
	const limit = parseParameter(params, 'limit', DEFAULT_LIMIT, MAX_LIMIT);
	const offset = parseParameter(params, 'offset', 0, MAX_OFFSET);
	return { limit, offset };
}

function parseParameter(
	params: URLSearchParams,
	name: 'limit' | 'offset',
	fallback: number,
	maximum: number,
): number {
	const values = params.getAll(name);
	if (values.length === 0) return fallback;

	const value = values[0];
	if (values.length !== 1 || !/^\d+$/.test(value)) {
		throw new Error(`El parámetro ${name} de paginación no es válido.`);
	}

	const parsed = Number(value);
	const minimum = name === 'limit' ? 1 : 0;
	if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`El parámetro ${name} de paginación debe estar entre ${minimum} y ${maximum}.`);
	}
	return parsed;
}

/** Serialize pagination values for an API query string. */
export function academicPaginationQuery(pagination: AcademicPagination): string {
	const params = new URLSearchParams({
		limit: String(pagination.limit),
		offset: String(pagination.offset),
	});
	return `?${params.toString()}`;
}

/** Return adjacent offsets without inferring totals from a full page. */
export function academicPaginationNavigation(input: AcademicPagination & { itemsLength: number }): AcademicPaginationNavigation {
	const { limit, offset, itemsLength } = input;
	return {
		previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
		nextOffset: itemsLength === limit && offset + limit <= MAX_OFFSET
			? offset + limit
			: null,
	};
}
