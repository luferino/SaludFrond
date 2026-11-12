export type ClinicalListFilters = { status?: 'draft' | 'submitted' | 'validated'; date_from?: string; date_to?: string };
const DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
export function realClinicalDate(value: unknown): value is string {
 if (typeof value !== 'string' || !DATE.test(value)) return false;
 const date = new Date(`${value}T00:00:00Z`);
 return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseClinicalListFilters(params: URLSearchParams): ClinicalListFilters {
 const result: ClinicalListFilters = {};
 for (const key of ['status', 'date_from', 'date_to'] as const) {
  const names = [...params.keys()].filter((name) => name === key || name.startsWith(`${key}[`) || name.startsWith(`${key}.`));
  const values = params.getAll(key);
  if (names.length > 1 || (names.length === 1 && names[0] !== key) || values.length > 1) throw new Error(`El filtro ${key} no es válido.`);
  const value = values[0];
  if (value === undefined) continue;
  if (key === 'status') {
   if (!['draft', 'submitted', 'validated'].includes(value)) throw new Error('El estado clínico no es válido.');
   result.status = value as ClinicalListFilters['status'];
  } else {
   if (!realClinicalDate(value)) throw new Error(`La fecha ${key} no es válida.`);
   result[key] = value;
  }
 }
 if (result.date_from && result.date_to && result.date_from > result.date_to) throw new Error('El rango de fechas no es válido.');
 return result;
}
export function clinicalFilterQuery(filters: ClinicalListFilters = {}): URLSearchParams {
 const query = new URLSearchParams();
 if (filters.status !== undefined) query.set('status', filters.status);
 if (filters.date_from !== undefined) query.set('date_from', filters.date_from);
 if (filters.date_to !== undefined) query.set('date_to', filters.date_to);
 return query;
}
