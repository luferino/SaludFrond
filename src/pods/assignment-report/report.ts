import type { AstroCookies } from 'astro';
import { decodeJwt, isTokenValid } from '../../shared/jwt';
import { ApiError, apiFetch } from '../../shared/apiClient';
import { listSubjects } from '../subject/api';
import { listGroups } from '../group/api';

export interface AssignmentReportDates { from: string; to: string }
export interface AssignmentReportItem { career: string; subject_id: string; academic_group_id: string; assignment_count: number }
export interface AssignmentReport { total: number; items: AssignmentReportItem[] }

export function assignmentReportGrant(cookies: AstroCookies): boolean {
	const token = cookies.get('session')?.value;
	if (!token || !isTokenValid(token)) return false;
	const actor = decodeJwt(token);
	return !!actor && actor.role === 'admin' && Array.isArray(actor.permissions)
		&& actor.permissions.every((grant) => typeof grant === 'string')
		&& actor.permissions.includes('assignment-reports:read');
}

function validDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	if (year < 1) return false;
	const date = new Date(0);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCFullYear(year, month - 1, day);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseAssignmentReportDates(params: URLSearchParams): AssignmentReportDates {
	const fromValues = params.getAll('from');
	const toValues = params.getAll('to');
	if (fromValues.length !== 1 || toValues.length !== 1 || !validDate(fromValues[0]) || !validDate(toValues[0]) || fromValues[0] > toValues[0]) {
		throw new Error('Las fechas son obligatorias y deben formar un período válido de hasta 366 días.');
	}
	const [fy, fm, fd] = fromValues[0].split('-').map(Number);
	const [ty, tm, td] = toValues[0].split('-').map(Number);
	const instant = (year: number, month: number, day: number) => {
		const date = new Date(0);
		date.setUTCHours(0, 0, 0, 0);
		date.setUTCFullYear(year, month - 1, day);
		return date.getTime();
	};
	const start = instant(fy, fm, fd);
	const end = instant(ty, tm, td);
	if ((end - start) / 86400000 + 1 > 366) throw new Error('El período no puede superar 366 días.');
	return { from: fromValues[0], to: toValues[0] };
}

export function validateAssignmentReport(value: unknown): AssignmentReport {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El informe no es válido.');
	const result = value as Record<string, unknown>;
	if (Object.keys(result).length !== 2 || !Number.isSafeInteger(result.total) || (result.total as number) < 0 || !Array.isArray(result.items)) {
		throw new Error('El informe no es válido.');
	}
	const items = result.items.map((entry): AssignmentReportItem => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Una fila del informe no es válida.');
		const row = entry as Record<string, unknown>;
		if (Object.keys(row).length !== 4 || typeof row.career !== 'string' || typeof row.subject_id !== 'string'
			|| typeof row.academic_group_id !== 'string' || !Number.isSafeInteger(row.assignment_count) || (row.assignment_count as number) < 0) {
			throw new Error('Una fila del informe no es válida.');
		}
		return { career: row.career, subject_id: row.subject_id, academic_group_id: row.academic_group_id, assignment_count: row.assignment_count as number };
	});
	return { total: result.total as number, items };
}

export async function getAssignmentReport(dates: AssignmentReportDates, cookies: AstroCookies): Promise<AssignmentReport> {
	const query = new URLSearchParams({ from: dates.from, to: dates.to });
	return validateAssignmentReport(await apiFetch<unknown>(`/reports/assignments?${query}`, { cookies }));
}

export type AssignmentReportPageState =
	| { state: 'initial' | 'invalid' | 'denied' | 'forbidden' | 'error' }
	| { state: 'empty'; report: AssignmentReport }
	| { state: 'success'; report: AssignmentReport; subjectNames: Record<string, string>; groupNames: Record<string, string> };

/** Resolve labels only after a permitted, valid, nonempty report; the catalog helpers enforce their own backend authorization. */
export async function loadAssignmentReportPage(params: URLSearchParams, cookies: AstroCookies): Promise<AssignmentReportPageState> {
	if (!assignmentReportGrant(cookies)) return { state: 'denied' };
	const submitted = params.has('from') || params.has('to');
	if (!submitted) return { state: 'initial' };
	let dates: AssignmentReportDates;
	try { dates = parseAssignmentReportDates(params); } catch { return { state: 'invalid' }; }
	let report: AssignmentReport;
	try { report = await getAssignmentReport(dates, cookies); } catch (failure) {
		if (failure instanceof ApiError && failure.status === 403) return { state: 'forbidden' };
		if (failure instanceof ApiError && failure.status === 401) throw failure;
		return { state: 'error' };
	}
	if (report.items.length === 0) return { state: 'empty', report };
	const [subjects, groups] = await Promise.all([
		listSubjects({ limit: 100, offset: 0 }, cookies).catch((failure) => { if (failure instanceof ApiError && failure.status === 401) throw failure; return null; }),
		listGroups({ limit: 100, offset: 0 }, cookies).catch((failure) => { if (failure instanceof ApiError && failure.status === 401) throw failure; return null; }),
	]);
	const subjectNames: Record<string, string> = {};
	const groupNames: Record<string, string> = {};
	if (subjects?.state === 'success') for (const subject of subjects.page.items) subjectNames[subject.id] = subject.name;
	if (groups?.state === 'success') for (const group of groups.page.items) groupNames[group.id] = group.name;
	return { state: 'success', report, subjectNames, groupNames };
}

export { ApiError };
