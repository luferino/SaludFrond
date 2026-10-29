import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
import { getEvaluation, isEvaluation, type Evaluation } from '../kinesiology-evaluation/api';
import { decodeJwt } from '../../shared/jwt';

export interface ClinicalContext { patient_id: string; subject_id: string; academic_group_id: string }
export interface TeacherPatient extends ClinicalContext {
 id: string; student_habilitation_id: string; assigned_by: string;
 nombres: string; apellidos: string; documento: string; assigned_at: string;
 ended_by: null; ended_at: null; end_reason: null;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validId(value: unknown): value is string {
 return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
export function record(value: unknown): value is Record<string, unknown> {
 return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function teacherGrant(cookies: AstroCookies, permission: string): boolean {
 const token = cookies.get('session')?.value;
 const actor = token ? decodeJwt(token) : null;
 return !!actor && ['teacher', 'docente'].includes(String(actor.role).toLowerCase())
  && Array.isArray(actor.permissions) && actor.permissions.every((grant) => typeof grant === 'string') && actor.permissions.includes(permission);
}
export function parseTeacherPagination(params: URLSearchParams) {
 const parse = (key: string, fallback: number, min: number, max: number) => {
  const values = params.getAll(key);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^\d+$/.test(values[0])) throw new Error('La paginación no es válida.');
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('La paginación no es válida.');
  return value;
 };
 return { limit: parse('limit', 50, 1, 100), offset: parse('offset', 0, 0, 10000) };
}
export function parseClinicalContext(params: URLSearchParams): ClinicalContext {
 const get = (key: string) => {
  const values = params.getAll(key);
  if (values.length !== 1 || !UUID.test(values[0])) throw new Error('El contexto clínico no es válido.');
  return values[0];
 };
 return { patient_id: get('patient_id'), subject_id: get('subject_id'), academic_group_id: get('academic_group_id') };
}
function validateContext(context: ClinicalContext) {
 for (const value of Object.values(context)) if (!UUID.test(value)) throw new Error('El contexto clínico no es válido.');
}
export function originEvaluation(value: unknown, context: ClinicalContext): Evaluation {
 if (!isEvaluation(value) || value.patient_id !== context.patient_id
  || value.origin_subject_id !== context.subject_id || value.origin_group_id !== context.academic_group_id
  || ['submission_id', 'submission_ordinal', 'submitted_by', 'submitted_at', 'consent'].some((key) => Object.hasOwn(value, key))) {
  throw new Error('La ficha no está disponible en este contexto de origen.');
 }
 return value;
}
export async function listTeacherPatients(pagination: { limit: number; offset: number }, cookies: AstroCookies) {
 const validated = parseTeacherPagination(new URLSearchParams({ limit: String(pagination.limit), offset: String(pagination.offset) }));
 const response = await apiFetch<unknown>(`/patient-assignments?${new URLSearchParams({ limit: String(validated.limit), offset: String(validated.offset) })}`, { cookies });
 if (!record(response) || !Array.isArray(response.items) || response.limit !== validated.limit || response.offset !== validated.offset) {
  throw new Error('La respuesta de asignaciones no es válida.');
 }
 const items = response.items.map((item): TeacherPatient => {
  if (!record(item) || !validId(item.id)
   || !['patient_id', 'subject_id', 'academic_group_id', 'student_habilitation_id', 'assigned_by'].every((key) => typeof item[key] === 'string' && UUID.test(item[key] as string))
   || !['nombres', 'apellidos', 'documento'].every((key) => typeof item[key] === 'string' && (item[key] as string).trim())
   || typeof item.assigned_at !== 'string' || !Number.isFinite(Date.parse(item.assigned_at))
   || item.ended_at !== null || item.ended_by !== null || item.end_reason !== null) throw new Error('La asignación recibida no es válida.');
  return item as unknown as TeacherPatient;
 });
 return { items, ...validated };
}
export async function listTeacherEvaluations(context: ClinicalContext, cookies: AstroCookies): Promise<Evaluation[]> {
 validateContext(context);
 const response = await apiFetch<unknown>(`/kinesiology-evaluations?${new URLSearchParams({ ...context })}`, { cookies });
 if (!record(response) || !Array.isArray(response.items)) throw new Error('La respuesta de fichas no es válida.');
 return response.items.map((item) => originEvaluation(item, context));
}
export interface ConsentEvidence { id: string; paper_signature_date: string; verified_by: string; verified_at: string }
export interface ConsentState { evaluation_id: string; status: 'pending' | 'verified'; evidence: ConsentEvidence | null }
export function validPaperDate(value: unknown): value is string {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const date = new Date(`${value}T00:00:00Z`);
 return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function consentResponse(value: unknown, id: string): ConsentState {
 if (!record(value) || value.evaluation_id !== id) throw new Error('La respuesta de consentimiento no es válida.');
 if (value.status === 'pending' && value.evidence === null) return value as unknown as ConsentState;
 const evidence = value.evidence;
 if (value.status !== 'verified' || !record(evidence) || !validId(evidence.id)
  || !validPaperDate(evidence.paper_signature_date) || typeof evidence.verified_by !== 'string' || !UUID.test(evidence.verified_by)
  || typeof evidence.verified_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(evidence.verified_at) || !Number.isFinite(Date.parse(evidence.verified_at))) {
  throw new Error('La respuesta de consentimiento no es válida.');
 }
 return value as unknown as ConsentState;
}
export async function getConsent(id: string, cookies: AstroCookies): Promise<ConsentState> {
 if (!validId(id)) throw new Error('El identificador de ficha no es válido.');
 return consentResponse(await apiFetch<unknown>(`/kinesiology-evaluations/${id}/consent`, { cookies }), id);
}
export async function appendConsent(id: string, paper_signature_date: string, cookies: AstroCookies): Promise<ConsentState> {
 if (!validId(id) || !validPaperDate(paper_signature_date)) throw new Error('La fecha o ficha no es válida.');
 const state = consentResponse(await apiFetch<unknown>(`/kinesiology-evaluations/${id}/consent`, {
  method: 'POST', body: { paper_signature_date }, cookies,
 }), id);
 if (state.status !== 'verified' || state.evidence?.paper_signature_date !== paper_signature_date) throw new Error('El resultado de registro no se pudo confirmar.');
 return state;
}
export async function getTeacherEvaluation(id: string, context: ClinicalContext, cookies: AstroCookies): Promise<Evaluation> {
 validateContext(context);
 return originEvaluation(await getEvaluation(id, cookies), context);
}
