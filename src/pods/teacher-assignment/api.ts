import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';

export interface AssignmentContext {
 subject_id: string; subject_name: string; academic_group_id: string; academic_group_name: string; academic_year: number; curriculum_semester: number;
}
export interface AssignmentStudent { student_habilitation_id: string; student_id: string; nombres: string; apellidos: string }
export interface AvailablePatient { patient_id: string; nombres: string; apellidos: string }
export interface TeacherAssignmentInput { patient_id: string; student_habilitation_id: string; subject_id: string; academic_group_id: string }
export interface TeacherAssignment extends TeacherAssignmentInput { id: string; assigned_by: string; assigned_at: string; ended_by: null; ended_at: null; end_reason: null }
export interface Page<T> { items: T[]; limit: number; offset: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ID = 9223372036854775807n;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export function parseTeacherAssignmentPagination(params: URLSearchParams) {
 return { limit: parameter(params, 'limit', 50, 100, 1), offset: parameter(params, 'offset', 0, 10000, 0) };
}
function parameter(params: URLSearchParams, name: string, fallback: number, max: number, min: number) {
 const values = params.getAll(name); if (!values.length) return fallback;
 if (values.length !== 1 || !/^\d+$/.test(values[0])) throw new Error(`El parámetro ${name} no es válido.`);
 const n = Number(values[0]); if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`El parámetro ${name} no es válido.`); return n;
}
export async function listTeacherContexts(page: {limit:number;offset:number}, cookies: AstroCookies): Promise<Page<AssignmentContext>> {
 assertPagination(page);
 const result = await apiFetch<unknown>(`/patient-assignment-options/contexts?${paginationQuery(page)}`, { cookies });
 return validatePage(result, page, (v) => {
  if (!record(v) || !uuid(v.subject_id) || !text(v.subject_name) || !uuid(v.academic_group_id) || !text(v.academic_group_name) || !Number.isInteger(v.academic_year) || !Number.isInteger(v.curriculum_semester)) throw new Error('La respuesta de contextos docentes no es válida.');
  return { subject_id:v.subject_id, subject_name:v.subject_name, academic_group_id:v.academic_group_id, academic_group_name:v.academic_group_name, academic_year:v.academic_year, curriculum_semester:v.curriculum_semester };
 });
}
export async function listTeacherStudents(query: {subject_id:string;academic_group_id:string;limit:number;offset:number}, cookies: AstroCookies): Promise<Page<AssignmentStudent>> {
 assertPagination(query);
 if (!uuid(query.subject_id) || !uuid(query.academic_group_id)) throw new Error('Seleccioná un contexto docente válido.');
 const params = new URLSearchParams({subject_id:query.subject_id,academic_group_id:query.academic_group_id,limit:String(query.limit),offset:String(query.offset)});
 const result = await apiFetch<unknown>(`/patient-assignment-options/students?${params}`, { cookies });
 return validatePage(result, query, (v) => { if (!record(v)||!uuid(v.student_habilitation_id)||!uuid(v.student_id)||!text(v.nombres)||!text(v.apellidos)) throw new Error('La respuesta de estudiantes no es válida.'); return {student_habilitation_id:v.student_habilitation_id,student_id:v.student_id,nombres:v.nombres,apellidos:v.apellidos}; });
}
export async function listAvailablePatients(query: {subject_id:string;academic_group_id:string;limit:number;offset:number}, cookies: AstroCookies): Promise<Page<AvailablePatient>> {
 assertPagination(query);
 if (!uuid(query.subject_id) || !uuid(query.academic_group_id)) throw new Error('Seleccioná un contexto docente válido.');
 const params = new URLSearchParams({subject_id:query.subject_id,academic_group_id:query.academic_group_id,limit:String(query.limit),offset:String(query.offset)});
 const result = await apiFetch<unknown>(`/patient-availabilities?${params}`, { cookies });
 return validatePage(result, query, (v) => { if (!record(v)||!uuid(v.patient_id)||!text(v.nombres)||!text(v.apellidos)) throw new Error('La respuesta de pacientes disponibles no es válida.'); return {patient_id:v.patient_id,nombres:v.nombres,apellidos:v.apellidos}; });
}
export async function createTeacherAssignment(input: TeacherAssignmentInput, cookies: AstroCookies): Promise<TeacherAssignment> {
 const result = await apiFetch<unknown>('/patient-assignments', { method:'POST', body:input, cookies });
 if (!record(result) || typeof result.id !== 'string' || !/^[1-9]\d{0,18}$/.test(result.id) || BigInt(result.id) > MAX_ID || !uuid(result.assigned_by) || !timestamp(result.assigned_at) || result.ended_by !== null || result.ended_at !== null || result.end_reason !== null) throw new Error('La respuesta de creación de asignación no es válida.');
 for (const key of ['patient_id','student_habilitation_id','subject_id','academic_group_id'] as const) if (!uuid(result[key]) || result[key] !== input[key]) throw new Error('La respuesta de creación no coincide con la solicitud.');
 return { id:result.id, patient_id:result.patient_id, student_habilitation_id:result.student_habilitation_id, subject_id:result.subject_id, academic_group_id:result.academic_group_id, assigned_by:result.assigned_by, assigned_at:result.assigned_at, ended_by:null, ended_at:null, end_reason:null };
}
function assertPagination(page:{limit:number;offset:number}) { if (!Number.isInteger(page.limit)||page.limit<1||page.limit>100||!Number.isInteger(page.offset)||page.offset<0||page.offset>10000) throw new Error('La paginación no es válida.'); }
function paginationQuery(page:{limit:number;offset:number}) { assertPagination(page); return new URLSearchParams({limit:String(page.limit),offset:String(page.offset)}); }
function validatePage<T>(value:unknown, page:{limit:number;offset:number}, validate:(v:unknown)=>T):Page<T> { if (!record(value)||!Array.isArray(value.items)||value.limit!==page.limit||value.offset!==page.offset) throw new Error('La respuesta paginada no es válida.'); return {items:value.items.map(validate),limit:value.limit,offset:value.offset}; }
function record(v:unknown):v is Record<string,any> { return typeof v==='object'&&v!==null&&!Array.isArray(v); }
function uuid(v:unknown):v is string { return typeof v==='string'&&UUID.test(v); }
function text(v:unknown):v is string { return typeof v==='string'&&!!v.trim(); }
function timestamp(v:unknown):v is string { return typeof v==='string'&&TIMESTAMP.test(v)&&!Number.isNaN(Date.parse(v)); }
