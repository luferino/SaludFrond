import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import { academicPaginationNavigation, parseAcademicPagination as parseSharedAcademicPagination } from '../../shared/academic-api';
import type { AcademicPage, AcademicPagination } from '../../shared/academic-api';

export interface TeacherProfile { id: string; nombres: string; apellidos: string }
export interface LinkedSubjectGroup { subject_id: string; academic_group_id: string; created_by: string | null; created_at: string }
export interface TeacherHabilitationPeriod {
	id: string; teacher_id: string; subject_id: string; academic_group_id: string;
	activated_by: string; activated_at: string; revoked_by: string | null; revoked_at: string | null;
}
export interface TeacherHabilitationFilter {
	teacherId: string | null; subjectId: string | null; academicGroupId: string | null; status: 'active' | 'revoked' | null;
}
export type ListResult<T> = { state: 'success'; page: AcademicPage<T> } | { state: 'denied' } | { state: 'failed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value));

export function parseTeacherHabilitationFilter(params: URLSearchParams): TeacherHabilitationFilter {
	const readUuid = (name: string) => {
		const values = params.getAll(name);
		if (values.length === 0) return null;
		if (values.length !== 1) throw new Error(`El filtro ${name} debe ser un UUID válido.`);
		if (values[0] === '') return null;
		if (!uuid(values[0])) throw new Error(`El filtro ${name} debe ser un UUID válido.`);
		return values[0];
	};
	const statuses = params.getAll('status');
	if (statuses.length > 1 || (statuses.length === 1 && statuses[0] !== '' && statuses[0] !== 'active' && statuses[0] !== 'revoked')) {
		throw new Error('El filtro de estado no es válido.');
	}
	return { teacherId: readUuid('teacher_id'), subjectId: readUuid('subject_id'), academicGroupId: readUuid('academic_group_id'), status: (statuses[0] as 'active' | 'revoked' | undefined) || null };
}

export function parseCatalogSelection(params: URLSearchParams, name: string): string {
	const values = params.getAll(name);
	if (values.length === 0) return '';
	if (values.length !== 1) throw new Error(`La selección de ${name} no es válida.`);
	if (values[0] === '') return '';
	if (!uuid(values[0])) throw new Error(`La selección de ${name} no es válida.`);
	return values[0];
}

export function parseContextSelection(params: URLSearchParams, name: string): string {
	const values = params.getAll(name);
	if (values.length === 0) return '';
	if (values.length === 1 && values[0] === '') return '';
	const parts = values.length === 1 ? values[0].split(':') : [];
	if (parts.length !== 2 || !uuid(parts[0]) || !uuid(parts[1])) throw new Error('La selección de contexto no es válida.');
	return values[0];
}

export function parseCatalogPagination(params: URLSearchParams, prefix: string): AcademicPagination {
	const values = new URLSearchParams();
	for (const [source, target] of [['limit', 'limit'], ['offset', 'offset']] as const) {
		for (const value of params.getAll(`${prefix}_${source}`)) values.append(target, value);
	}
	const pagination = parseAcademicPagination(values);
	const pages = params.getAll(`${prefix}_page`);
	if (pages.length === 0) return pagination;
	if (pages.length !== 1 || (pages[0] !== 'next' && pages[0] !== 'previous')) {
		throw new Error(`La dirección de página de ${prefix} no es válida.`);
	}
	const offset = pages[0] === 'next' ? pagination.offset + pagination.limit : Math.max(0, pagination.offset - pagination.limit);
	if (offset > 10000) throw new Error(`La página de ${prefix} excede el límite permitido.`);
	return { ...pagination, offset };
}

export const parseAcademicPagination = parseSharedAcademicPagination;

function validPage<T>(value: unknown, pagination: AcademicPagination, item: (item: unknown) => item is T): value is AcademicPage<T> {
	if (!value || typeof value !== 'object') return false;
	const page = value as Record<string, unknown>;
	return Array.isArray(page.items) && page.limit === pagination.limit && page.offset === pagination.offset && page.items.every(item);
}
function isTeacher(value: unknown): value is TeacherProfile {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return uuid(item.id) && typeof item.nombres === 'string' && typeof item.apellidos === 'string';
}
function isLinkedContext(value: unknown): value is LinkedSubjectGroup {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return uuid(item.subject_id) && uuid(item.academic_group_id)
		&& (item.created_by === null || uuid(item.created_by)) && iso(item.created_at);
}
export function isTeacherHabilitationPeriod(value: unknown): value is TeacherHabilitationPeriod {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return uuid(item.id) && uuid(item.teacher_id) && uuid(item.subject_id) && uuid(item.academic_group_id)
		&& uuid(item.activated_by) && iso(item.activated_at)
		&& (item.revoked_by === null || uuid(item.revoked_by))
		&& (item.revoked_at === null || iso(item.revoked_at))
		&& ((item.revoked_by === null) === (item.revoked_at === null));
}
function queryFor(pagination: AcademicPagination, filter?: TeacherHabilitationFilter): string {
	const query = new URLSearchParams({ limit: String(pagination.limit), offset: String(pagination.offset) });
	if (filter?.teacherId) query.set('teacher_id', filter.teacherId);
	if (filter?.subjectId) query.set('subject_id', filter.subjectId);
	if (filter?.academicGroupId) query.set('academic_group_id', filter.academicGroupId);
	if (filter?.status) query.set('status', filter.status);
	return query.toString();
}
async function list<T>(path: string, pagination: AcademicPagination, cookies: AstroCookies, validate: (item: unknown) => item is T): Promise<ListResult<T>> {
	try {
		const page = await apiFetch<AcademicPage<T>>(`${path}?${queryFor(pagination)}`, { cookies });
		return validPage(page, pagination, validate) ? { state: 'success', page } : { state: 'failed' };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}
export function listTeacherProfiles(pagination: AcademicPagination, cookies: AstroCookies) {
	return list('/teachers', pagination, cookies, isTeacher);
}
export function listLinkedSubjectGroups(pagination: AcademicPagination, cookies: AstroCookies) {
	return list('/subject-groups', pagination, cookies, isLinkedContext);
}
export async function listTeacherHabilitations(pagination: AcademicPagination, filter: TeacherHabilitationFilter, cookies: AstroCookies): Promise<ListResult<TeacherHabilitationPeriod>> {
	try {
		const page = await apiFetch<AcademicPage<TeacherHabilitationPeriod>>(`/teacher-habilitations?${queryFor(pagination, filter)}`, { cookies });
		return validPage(page, pagination, isTeacherHabilitationPeriod) ? { state: 'success', page } : { state: 'failed' };
	} catch (error) {
		if (error instanceof ApiError && error.status === 403) return { state: 'denied' };
		if (error instanceof ApiError && error.status === 401) throw error;
		return { state: 'failed' };
	}
}
export const teacherHabilitationNavigation = academicPaginationNavigation;

export async function createTeacherHabilitation(input: { teacher_id: string; subject_id: string; academic_group_id: string }, cookies: AstroCookies): Promise<TeacherHabilitationPeriod> {
	const response = await apiFetch<unknown>('/teacher-habilitations', { method: 'POST', body: input, cookies });
	if (!isTeacherHabilitationPeriod(response) || response.teacher_id !== input.teacher_id
		|| response.subject_id !== input.subject_id || response.academic_group_id !== input.academic_group_id
		|| response.revoked_at !== null || response.revoked_by !== null) throw new Error('Invalid service response');
	return response;
}
export async function revokeTeacherHabilitation(id: string, cookies: AstroCookies): Promise<TeacherHabilitationPeriod> {
	const response = await apiFetch<unknown>(`/teacher-habilitations/${id}/revoke`, { method: 'POST', cookies });
	if (!isTeacherHabilitationPeriod(response) || response.id !== id || response.revoked_at === null || response.revoked_by === null) throw new Error('Invalid service response');
	return response;
}
