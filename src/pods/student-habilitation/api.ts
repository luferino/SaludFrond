import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../shared/apiClient';
import { academicPaginationQuery, parseAcademicPagination } from '../../shared/academic-api';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export interface StudentProfile { id: string; nombres: string; apellidos: string; codalumno: string }
export interface StudentPeriod {
 id: string; student_id: string; subject_id: string; academic_group_id: string;
 activated_by: string; activated_at: string; revoked_by: string | null; revoked_at: string | null;
}
export interface StudentFilters {
 studentId: string | null; subjectId: string | null; academicGroupId: string | null;
 status: 'active' | 'revoked' | null;
}
export type Listing<T> = { state: 'success'; page: AcademicPage<T> } | { state: 'denied' | 'failed' };

export function isIsoUtc(value: unknown): value is string {
 return typeof value === 'string' && ISO_UTC.test(value) && Number.isFinite(Date.parse(value));
}
export function isStudentPeriod(value: unknown): value is StudentPeriod {
 if (!value || typeof value !== 'object') return false;
 const period = value as Record<string, unknown>;
 const uuidFields = ['id', 'student_id', 'subject_id', 'academic_group_id', 'activated_by'];
 if (!uuidFields.every((field) => typeof period[field] === 'string' && UUID_PATTERN.test(period[field] as string))) return false;
 if (!isIsoUtc(period.activated_at)) return false;
 const hasRevoker = period.revoked_by !== null;
 const hasRevokedAt = period.revoked_at !== null;
 if (hasRevoker !== hasRevokedAt) return false;
 if (hasRevoker && (typeof period.revoked_by !== 'string' || !UUID_PATTERN.test(period.revoked_by) || !isIsoUtc(period.revoked_at))) return false;
 return !hasRevokedAt || Date.parse(period.revoked_at as string) >= Date.parse(period.activated_at);
}
function isStudentProfile(value: unknown): value is StudentProfile {
 if (!value || typeof value !== 'object') return false;
 const profile = value as Record<string, unknown>;
 return typeof profile.id === 'string' && UUID_PATTERN.test(profile.id)
  && ['nombres', 'apellidos', 'codalumno'].every((field) => typeof profile[field] === 'string');
}
async function listing<T>(path: string, pagination: AcademicPagination, cookies: AstroCookies, validate: (value: unknown) => value is T): Promise<Listing<T>> {
 try {
  const query = academicPaginationQuery(pagination).slice(1);
  const response = await apiFetch<AcademicPage<T>>(`${path}${path.includes('?') ? '&' : '?'}${query}`, { cookies });
  if (!response || !Array.isArray(response.items) || response.limit !== pagination.limit
   || response.offset !== pagination.offset || !response.items.every(validate)) return { state: 'failed' };
  return { state: 'success', page: response };
 } catch (error) {
  if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
  if (error instanceof ApiError && error.status === 401) throw error;
  return { state: 'failed' };
 }
}
export const listStudents = (pagination: AcademicPagination, cookies: AstroCookies) => listing('/students', pagination, cookies, isStudentProfile);
export const listStudentHabilitations = (pagination: AcademicPagination, filters: StudentFilters, cookies: AstroCookies) => {
 const query = new URLSearchParams();
 if (filters.studentId) query.set('student_id', filters.studentId);
 if (filters.subjectId) query.set('subject_id', filters.subjectId);
 if (filters.academicGroupId) query.set('academic_group_id', filters.academicGroupId);
 if (filters.status) query.set('status', filters.status);
 return listing(`/student-habilitations?${query}`, pagination, cookies, isStudentPeriod);
};

function optionalUuid(params: URLSearchParams, key: string): string | null {
 const values = params.getAll(key);
 if (values.length === 0) return null;
 if (values.length !== 1) throw new Error(`El filtro ${key} está repetido.`);
 if (values[0] === '') return null;
 if (!UUID_PATTERN.test(values[0])) throw new Error(`El filtro ${key} no es válido.`);
 return values[0];
}
export function parseStudentFilters(params: URLSearchParams): StudentFilters {
 const studentId = optionalUuid(params, 'student_id');
 const subjectId = optionalUuid(params, 'subject_id');
 const academicGroupId = optionalUuid(params, 'academic_group_id');
 const statuses = params.getAll('status');
 if (statuses.length > 1) throw new Error('El filtro de estado está repetido.');
 const statusValue = statuses[0] ?? '';
 if (statusValue !== '' && statusValue !== 'active' && statusValue !== 'revoked') throw new Error('El filtro de estado no es válido.');
 return { studentId, subjectId, academicGroupId, status: statusValue || null };
}

export function parseSelectorPagination(params: URLSearchParams, prefix: 'student' | 'context' | 'subject' | 'group'): AcademicPagination {
 const namespaced = new URLSearchParams();
 for (const coordinate of ['limit', 'offset'] as const) {
  const values = params.getAll(`${prefix}_${coordinate}`);
  for (const value of values) namespaced.append(coordinate, value);
 }
 return parseAcademicPagination(namespaced);
}
