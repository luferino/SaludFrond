import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import { clinicalFilterQuery, parseClinicalListFilters, type ClinicalListFilters } from '../kinesiology-evaluation/list-filters';

export interface KinesiologyEvolutionListItem {
 id: string; clinical_record_id: string; evaluation_id: string; patient_id: string; author_id: string;
 origin_student_habilitation_id: string; origin_subject_id: string; origin_group_id: string;
 content: Record<string, unknown>; status: 'draft' | 'submitted' | 'validated'; created_at: string; updated_at: string;
 amendment_of_evolution_id?: string; validation_status?: 'pending_validation' | 'validated';
 submission_id?: string; submitted_by?: string; submitted_at?: string; reviewed_by?: string; reviewed_at?: string;
}
export type EvolutionFilters = ClinicalListFilters & { evaluation_id?: string };
export function parseEvolutionListFilters(params: URLSearchParams): EvolutionFilters {
 const result: EvolutionFilters = { ...parseClinicalListFilters(params) };
 const names = [...params.keys()].filter((name) => name === 'evaluation_id' || name.startsWith('evaluation_id[') || name.startsWith('evaluation_id.'));
 const values = params.getAll('evaluation_id');
 if (names.length > 1 || (names.length === 1 && names[0] !== 'evaluation_id') || values.length > 1) throw new Error('El filtro evaluation_id no es válido.');
 if (values.length) {
  if (!id(values[0])) throw new Error('El identificador de evaluación no es válido.');
  result.evaluation_id = values[0];
 }
 return result;
}
const MAX_BIGINT = 9223372036854775807n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown): value is string { return typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) <= MAX_BIGINT; }
function scalar(value: unknown, name: string) {
 if (typeof value !== 'string' || !value) throw new Error(`El filtro ${name} no es válido.`);
}
function validateItem(value: unknown): KinesiologyEvolutionListItem {
 if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('La respuesta de evoluciones no es válida.');
 const row = value as Record<string, unknown>;
 if (!id(row.id) || !id(row.clinical_record_id) || !id(row.evaluation_id)
  || !['patient_id', 'author_id', 'origin_student_habilitation_id', 'origin_subject_id', 'origin_group_id'].every((key) => typeof row[key] === 'string' && UUID.test(row[key] as string))
  || !['draft', 'submitted', 'validated'].includes(String(row.status)) || typeof row.content !== 'object' || row.content === null || Array.isArray(row.content)
  || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
  || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('La respuesta de evoluciones no es válida.');
 return row as unknown as KinesiologyEvolutionListItem;
}
export async function listKinesiologyEvolutions(context: { patient_id: string; subject_id?: string; academic_group_id?: string }, cookies: AstroCookies, filters: EvolutionFilters = {}): Promise<KinesiologyEvolutionListItem[]> {
 if (!UUID.test(context.patient_id)) throw new Error('El contexto patient_id no es válido.');
 for (const key of ['subject_id', 'academic_group_id'] as const) {
  const value = context[key];
  if (value !== undefined && !UUID.test(value)) throw new Error(`El contexto ${key} no es válido.`);
 }
 if (filters.evaluation_id !== undefined) {
  scalar(filters.evaluation_id, 'evaluation_id');
  if (!id(filters.evaluation_id)) throw new Error('El identificador de evaluación no es válido.');
 }
 const query = new URLSearchParams({ patient_id: context.patient_id });
 if (context.subject_id !== undefined) query.set('subject_id', context.subject_id);
 if (context.academic_group_id !== undefined) query.set('academic_group_id', context.academic_group_id);
 const optional = clinicalFilterQuery(filters);
 for (const [key, value] of optional) query.set(key, value);
 if (filters.evaluation_id !== undefined) query.set('evaluation_id', filters.evaluation_id);
 const response = await apiFetch<unknown>(`/kinesiology-evolutions?${query}`, { cookies });
 if (typeof response !== 'object' || response === null || !Array.isArray((response as { items?: unknown }).items)) throw new Error('La respuesta de evoluciones no es válida.');
 return (response as { items: unknown[] }).items.map(validateItem);
}
