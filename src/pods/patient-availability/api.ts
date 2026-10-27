import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';

export interface Patient { patient_id: string; nombres: string; apellidos: string }
export interface PatientPeriod { id: string; patient_id: string; subject_id: string; academic_group_id: string; enabled_by: string; enabled_at: string; withdrawn_by: string | null; withdrawn_at: string | null }
export interface Subject { id: string; name: string }
export interface Group { id: string; academic_year: number; curriculum_semester: number; name: string }
export interface Link { subject_id: string; academic_group_id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function page<T>(value: unknown, p: AcademicPagination, validate: (v: unknown) => v is T): AcademicPage<T> {
 if (!record(value) || !Array.isArray(value.items) || value.limit !== p.limit || value.offset !== p.offset || !value.items.every(validate)) throw new Error('Respuesta paginada inválida.');
 return value as unknown as AcademicPage<T>;
}
const isPatient = (v: unknown): v is Patient => record(v) && typeof v.patient_id === 'string' && UUID.test(v.patient_id) && typeof v.nombres === 'string' && !!v.nombres.trim() && typeof v.apellidos === 'string' && !!v.apellidos.trim();
export function isPatientPeriod(v: unknown): v is PatientPeriod {
 if (!record(v) || !['id','patient_id','subject_id','academic_group_id','enabled_by'].every(k => typeof v[k] === 'string' && UUID.test(v[k])) || !timestamp(v.enabled_at)) return false;
 return (v.withdrawn_by === null && v.withdrawn_at === null) || (typeof v.withdrawn_by === 'string' && UUID.test(v.withdrawn_by) && timestamp(v.withdrawn_at));
}
const isSubject = (v: unknown): v is Subject => record(v) && typeof v.id === 'string' && UUID.test(v.id) && typeof v.name === 'string' && !!v.name.trim();
const isGroup = (v: unknown): v is Group => record(v) && typeof v.id === 'string' && UUID.test(v.id) && Number.isInteger(v.academic_year) && Number.isInteger(v.curriculum_semester) && typeof v.name === 'string' && !!v.name.trim();
const isLink = (v: unknown): v is Link => record(v) && typeof v.subject_id === 'string' && UUID.test(v.subject_id) && typeof v.academic_group_id === 'string' && UUID.test(v.academic_group_id);
export function parseSelectedPatientId(params: URLSearchParams): string | null {
 const values=params.getAll('patient_id');
 if(values.length===0)return null;
 if(values.length!==1||!UUID.test(values[0]))throw new Error('Paciente seleccionado inválido.');
 return values[0];
}
export function parseAvailabilityPagination(params: URLSearchParams): AcademicPagination {
 const parse = (key: string, fallback: number, max: number) => { const all=params.getAll(key); if (!all.length) return fallback; if (all.length!==1 || !/^\d+$/.test(all[0])) throw new Error('Paginación inválida.'); const n=Number(all[0]); if (!Number.isSafeInteger(n)||n<(key==='limit'?1:0)||n>max) throw new Error('Paginación inválida.'); return n; };
 return { limit: parse('limit',50,100), offset: parse('offset',0,10000) };
}
const query = (p: AcademicPagination) => new URLSearchParams({limit:String(p.limit),offset:String(p.offset)}).toString();
export async function searchPatient(documento: string, cookies: AstroCookies): Promise<Patient[]> {
 const result = await apiFetch<unknown>('/patient-availabilities/patient-search',{method:'POST',body:{documento},cookies});
 if (!record(result)||!Array.isArray(result.items)||!result.items.every(isPatient)) throw new Error('Respuesta de búsqueda inválida.'); return result.items;
}
export async function listHistory(patientId: string,p: AcademicPagination,cookies: AstroCookies): Promise<AcademicPage<PatientPeriod>> {
 if (!UUID.test(patientId)) throw new Error('Paciente inválido.'); const res=await apiFetch<unknown>(`/patient-availabilities/manage?patient_id=${encodeURIComponent(patientId)}&${query(p)}`,{cookies}); const result=page(res,p,isPatientPeriod); if(result.items.some(item=>item.patient_id.toLowerCase()!==patientId.toLowerCase()))throw new Error('El historial no coincide con el paciente seleccionado.'); return result;
}
export async function listSubjects(p:AcademicPagination,c:AstroCookies){ return page(await apiFetch<unknown>(`/subjects?${query(p)}`,{cookies:c}),p,isSubject); }
export async function listGroups(p:AcademicPagination,c:AstroCookies){ return page(await apiFetch<unknown>(`/groups?${query(p)}`,{cookies:c}),p,isGroup); }
export async function listLinks(subjectId:string,p:AcademicPagination,c:AstroCookies){ if(!UUID.test(subjectId)) throw new Error('Asignatura inválida.'); return page(await apiFetch<unknown>(`/subject-groups?subject_id=${encodeURIComponent(subjectId)}&${query(p)}`,{cookies:c}),p,isLink); }
export { UUID as UUID_PATTERN, ApiError };
