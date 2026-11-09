import type { AstroCookies } from 'astro';
import { ApiError } from '../../shared/apiClient';
import { decodeJwt } from '../../shared/jwt';
import { academicPaginationNavigation, parseAcademicPagination } from '../../shared/academic-api';
import type { AcademicPagination, AcademicPaginationNavigation } from '../../shared/academic-api';
import { loadCareerScope, parseRequestedCareer } from '../reception/careers';
import type { ReceptionCareer } from '../reception/careers';
import { isUuid, listAvailabilityContexts, listAvailabilityHistory } from './api';
import type { AvailabilityActivity, AvailabilityContext } from './api';

export type ReceptionAvailabilityState =
	| { kind: 'session-expired' }
	| { kind: 'unavailable'; careers: ReceptionCareer[]; career: null; message: string }
	| { kind: 'no-careers'; careers: ReceptionCareer[] }
	| { kind: 'select'; careers: ReceptionCareer[]; requested: string | null }
	| { kind: 'career-unavailable'; careers: ReceptionCareer[]; career: ReceptionCareer; message: string }
	| {
		kind: 'ready';
		careers: ReceptionCareer[];
		career: ReceptionCareer;
		patientId: string | null;
		patientError: string | null;
		contexts: AvailabilityContext[];
		contextsPage: AcademicPagination;
		contextsNavigation: AcademicPaginationNavigation;
		contextsError: string | null;
		history: AvailabilityActivity[];
		historyPage: AcademicPagination;
		historyNavigation: AcademicPaginationNavigation;
		historyError: string | null;
		queryError: string | null;
	};

const CAREERS_UNAVAILABLE = 'No se pudieron cargar tus carreras habilitadas. Probá de nuevo más tarde.';
const CONTEXTS_UNAVAILABLE = 'No se pudieron cargar los contextos de la carrera. Probá de nuevo más tarde.';
const HISTORY_UNAVAILABLE = 'No se pudo cargar el historial. Probá de nuevo más tarde.';
const HISTORY_NOT_FOUND = 'No encontramos el paciente en la carrera seleccionada.';
const CAREER_UNAVAILABLE = 'La carrera seleccionada ya no está habilitada para tu cuenta. Elegí una de tus carreras para continuar.';
const FORBIDDEN = 'Tu cuenta no tiene permiso para gestionar disponibilidad en recepción.';
const PATIENT_INVALID = 'El paciente seleccionado no es válido.';
const QUERY_INVALID = 'Revisá los parámetros de paginación.';
const DEFAULT_PAGINATION: AcademicPagination = { limit: 50, offset: 0 };
const UNNAMED_SUBJECT = 'Asignatura (nombre no disponible)';
const UNNAMED_GROUP = 'Grupo (nombre no disponible)';

const isStatus = (error: unknown, status: number) => error instanceof ApiError && error.status === status;

// Each section reads its own prefixed pagination (contexts_limit, history_offset, ...).
// An invalid value is reported and replaced by the defaults; it is never forwarded.
function sectionPagination(params: URLSearchParams, section: 'contexts' | 'history'): { page: AcademicPagination; invalid: boolean } {
	const scoped = new URLSearchParams();
	for (const key of ['limit', 'offset'] as const) {
		for (const value of params.getAll(`${section}_${key}`)) scoped.append(key, value);
	}
	try {
		return { page: parseAcademicPagination(scoped), invalid: false };
	} catch {
		return { page: DEFAULT_PAGINATION, invalid: true };
	}
}

// Careers are read fresh on every render; availability data is requested only for a career granted in this request.
export async function loadReceptionAvailabilityState(params: URLSearchParams, cookies: AstroCookies): Promise<ReceptionAvailabilityState> {
	let scope;
	try {
		scope = await loadCareerScope(params, cookies);
	} catch (error) {
		if (isStatus(error, 401)) return { kind: 'session-expired' };
		return { kind: 'unavailable', careers: [], career: null, message: isStatus(error, 403) ? FORBIDDEN : CAREERS_UNAVAILABLE };
	}
	const { careers, selected } = scope;
	if (careers.length === 0) return { kind: 'no-careers', careers };
	if (!selected) return { kind: 'select', careers, requested: parseRequestedCareer(params) };

	const contextsRead = sectionPagination(params, 'contexts');
	const historyRead = sectionPagination(params, 'history');
	const queryError = contextsRead.invalid || historyRead.invalid ? QUERY_INVALID : null;

	const patientValues = params.getAll('patient_id');
	const patientId = patientValues.length === 1 && isUuid(patientValues[0]) ? patientValues[0] : null;
	const patientError = patientValues.length > 0 && patientId === null ? PATIENT_INVALID : null;

	let contexts: AvailabilityContext[] = [];
	let contextsError: string | null = null;
	try {
		contexts = (await listAvailabilityContexts(selected, contextsRead.page, cookies)).items;
	} catch (error) {
		if (isStatus(error, 401)) return { kind: 'session-expired' };
		// Contexts are career-level, so a 404 means the career scope is gone.
		if (isStatus(error, 404)) return { kind: 'career-unavailable', careers, career: selected, message: CAREER_UNAVAILABLE };
		contextsError = isStatus(error, 403) ? FORBIDDEN : CONTEXTS_UNAVAILABLE;
	}

	let history: AvailabilityActivity[] = [];
	let historyError: string | null = null;
	if (patientId) {
		try {
			history = (await listAvailabilityHistory(selected, patientId, historyRead.page, cookies)).items;
		} catch (error) {
			if (isStatus(error, 401)) return { kind: 'session-expired' };
			// Neutral copy: a 404 covers a missing enrollment without saying anything about other careers.
			if (isStatus(error, 404)) historyError = HISTORY_NOT_FOUND;
			else historyError = isStatus(error, 403) ? FORBIDDEN : HISTORY_UNAVAILABLE;
		}
	}

	return {
		kind: 'ready',
		careers,
		career: selected,
		patientId,
		patientError,
		contexts,
		contextsPage: contextsRead.page,
		contextsNavigation: academicPaginationNavigation({ ...contextsRead.page, itemsLength: contexts.length }),
		contextsError,
		history,
		historyPage: historyRead.page,
		historyNavigation: academicPaginationNavigation({ ...historyRead.page, itemsLength: history.length }),
		historyError,
		queryError,
	};
}

// Activity has no labels, so names come from the contexts page; without a match the copy stays neutral.
export function activityLabels(activity: AvailabilityActivity, contexts: AvailabilityContext[]): { subject: string; group: string } {
	const match = contexts.find((context) => context.subject_id.toLowerCase() === activity.subject_id.toLowerCase()
		&& context.academic_group_id.toLowerCase() === activity.academic_group_id.toLowerCase());
	return match
		? { subject: match.subject_name, group: match.academic_group_name }
		: { subject: UNNAMED_SUBJECT, group: UNNAMED_GROUP };
}

// Action results are only rendered when they belong to the career selected in this request.
export function resultForCareer<T extends { career: ReceptionCareer | null }>(result: T | undefined, career: ReceptionCareer): T | undefined {
	return result && result.career === career ? result : undefined;
}

// Presentation hint only; the backend re-checks the role and the career grant on every request.
export function resolveReceptionAvailabilityAccess(token: string | null): 'login' | 'home' | 'ok' {
	if (!token) return 'login';
	return decodeJwt(token)?.role === 'reception' ? 'ok' : 'home';
}
