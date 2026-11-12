export const ASSIGNMENT_FILTER_KEYS = ['patient_id', 'student_id', 'subject_id', 'academic_group_id'] as const;
export type AssignmentListingFilters = Partial<Record<typeof ASSIGNMENT_FILTER_KEYS[number], string>>;
export interface AssignmentListCoordinates { filters: AssignmentListingFilters; limit: number; offset: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_FILTER_KEYS = ASSIGNMENT_FILTER_KEYS.map((key) => `list_${key}`);
const LIST_KEYS = new Set([...LIST_FILTER_KEYS, 'list_limit', 'list_offset']);

function parseFilters(params: URLSearchParams, prefix: string): AssignmentListingFilters {
 const filters: AssignmentListingFilters = {};
 for (const key of ASSIGNMENT_FILTER_KEYS) {
  const name = `${prefix}${key}`;
  const related = [...params.keys()].filter((candidate) => candidate === name || candidate.startsWith(`${name}[`) || candidate.startsWith(`${name}.`));
  const values = params.getAll(name);
  if (related.length > 1 || (related.length === 1 && related[0] !== name) || values.length > 1) throw new Error('El contexto de la lista no es válido.');
  const value = values[0]?.trim();
  if (!value) continue;
  if (!UUID.test(value)) throw new Error('El contexto de la lista no es válido.');
  filters[key] = value;
 }
 return filters;
}
function parsePage(params: URLSearchParams, prefix: string) {
 const parse = (key: 'limit' | 'offset', fallback: number, minimum: number, maximum: number) => {
  const values = params.getAll(`${prefix}${key}`);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^\d+$/.test(values[0])) throw new Error('El contexto de la lista no es válido.');
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('El contexto de la lista no es válido.');
  return value;
 };
 return { limit: parse('limit', 50, 1, 100), offset: parse('offset', 0, 0, Number.MAX_SAFE_INTEGER) };
}

/** Parse list state separately from clinical origin keys; downstream routes use list_* names. */
export function parseAssignmentListCoordinates(params: URLSearchParams, namespaced = false): AssignmentListCoordinates {
 const prefix = namespaced ? 'list_' : '';
 const hasCarrier = namespaced && [...params.keys()].some((name) => name.startsWith('list_'));
 const pagePrefix = hasCarrier ? 'list_' : '';
 const allowed = new Set([...ASSIGNMENT_FILTER_KEYS.map((key) => `${prefix}${key}`), `${pagePrefix}limit`, `${pagePrefix}offset`]);
 for (const name of params.keys()) {
  const filterLike = ASSIGNMENT_FILTER_KEYS.some((key) => name === `${prefix}${key}` || name.startsWith(`${prefix}${key}[`) || name.startsWith(`${prefix}${key}.`));
  const pageLike = name === `${pagePrefix}limit` || name === `${pagePrefix}offset`;
  if (((filterLike || pageLike) && !allowed.has(name)) || (name.startsWith('list_') && (!namespaced || !allowed.has(name)))) throw new Error('El contexto de la lista no es válido.');
 }
 return { filters: parseFilters(params, prefix), ...parsePage(params, pagePrefix) };
}

/** Validates action carriers before any lookup or write. Legacy limit/offset remain supported without filters. */
export function parseAssignmentActionCoordinates(input: Record<string, unknown>, requireLegacyPagination = false): AssignmentListCoordinates {
 const legacy = new URLSearchParams();
 for (const key of ['limit', 'offset'] as const) {
  const value = input[key];
  if (value === undefined) {
   if (requireLegacyPagination) throw new Error('El contexto de la lista no es válido.');
  } else {
   if (typeof value !== 'string') throw new Error('El contexto de la lista no es válido.');
   legacy.set(key, value);
  }
 }
 const legacyPage = requireLegacyPagination ? parsePage(legacy, '') : null;
 const params = new URLSearchParams();
 for (const [key, value] of Object.entries(input)) {
  if (!key.startsWith('list_')) continue;
  if (!LIST_KEYS.has(key) || typeof value !== 'string') throw new Error('El contexto de la lista no es válido.');
  params.append(key, value);
 }
 const hasNamespaced = Object.keys(input).some((key) => key.startsWith('list_'));
 if (hasNamespaced) return parseAssignmentListCoordinates(params, true);
 return { filters: {}, ...(legacyPage ?? parsePage(legacy, '')) };
}

export function assignmentListCarrier(coordinates: AssignmentListCoordinates): Record<string, string> {
 const result: Record<string, string> = { list_limit: String(coordinates.limit), list_offset: String(coordinates.offset) };
 for (const key of ASSIGNMENT_FILTER_KEYS) {
  const value = coordinates.filters[key];
  if (value && UUID.test(value)) result[`list_${key}`] = value;
 }
 return result;
}

export function assignmentListQuery(coordinates: AssignmentListCoordinates, namespaced = false): string {
 const prefix = namespaced ? 'list_' : '';
 const query = new URLSearchParams({ [`${prefix}limit`]: String(coordinates.limit), [`${prefix}offset`]: String(coordinates.offset) });
 for (const key of ASSIGNMENT_FILTER_KEYS) {
  const value = coordinates.filters[key];
  if (value) query.set(`${prefix}${key}`, value);
 }
 return query.toString();
}
