import type { AstroCookies } from 'astro';
import { ApiError } from '../../shared/apiClient';
import { decodeJwt } from '../../shared/jwt';
import { loadCareerScope, parseRequestedCareer } from '../reception/careers';
import type { ReceptionCareer } from '../reception/careers';
import { listReceptionPatients } from './api';
import type { ReceptionPatient } from './api';
import { academicPaginationNavigation } from '../../shared/academic-api';
import type { AcademicPagination, AcademicPaginationNavigation } from '../../shared/academic-api';

export type ReceptionPatientsState =
	| { kind: 'session-expired' }
	| { kind: 'unavailable'; careers: ReceptionCareer[]; career: ReceptionCareer | null; message: string }
	| { kind: 'no-careers'; careers: ReceptionCareer[] }
	| { kind: 'select'; careers: ReceptionCareer[]; requested: string | null }
	| { kind: 'career-unavailable'; careers: ReceptionCareer[]; career: ReceptionCareer; message: string }
	| { kind: 'list'; careers: ReceptionCareer[]; career: ReceptionCareer; patients: ReceptionPatient[]; q: string; page: AcademicPagination; navigation: AcademicPaginationNavigation }
	| { kind: 'invalid-search'; careers: ReceptionCareer[]; career: ReceptionCareer | null; message: string; q: string; page: AcademicPagination };

const CAREERS_UNAVAILABLE = 'No se pudieron cargar tus carreras habilitadas. Probá de nuevo más tarde.';
const PATIENTS_UNAVAILABLE = 'No se pudieron cargar los pacientes. Probá de nuevo más tarde.';
const CAREER_UNAVAILABLE = 'La carrera seleccionada ya no está habilitada para tu cuenta. Elegí una de tus carreras para continuar.';
const FORBIDDEN = 'Tu cuenta no tiene permiso para gestionar pacientes en recepción.';

const isStatus = (error: unknown, status: number) => error instanceof ApiError && error.status === status;
const DEFAULT_PAGE: AcademicPagination = { limit: 100, offset: 0 };
function parseReceptionListing(params: URLSearchParams): AcademicPagination & { q: string } {
	if ([...params.keys()].some((key) => key.startsWith('q[') || key.startsWith('q.'))) {
		throw new Error('La búsqueda debe ser texto plano.');
	}
	const values = params.getAll('q');
	if (values.length > 1) throw new Error('La búsqueda debe aparecer una sola vez.');
	const q = (values[0] ?? '').trim();
	if (q.length > 100) throw new Error('La búsqueda debe tener como máximo 100 caracteres.');
	const readPageValue = (name: 'limit' | 'offset', fallback: number, maximum: number) => {
		const entries = params.getAll(name);
		if (entries.length === 0) return fallback;
		if (entries.length !== 1 || !/^\d+$/.test(entries[0])) throw new Error(`El parámetro ${name} no es válido.`);
		const value = Number(entries[0]);
		if (!Number.isSafeInteger(value) || value < 0 || value > maximum || (name === 'limit' && value === 0)) {
			throw new Error(`El parámetro ${name} no es válido.`);
		}
		return value;
	};
	return { limit: readPageValue('limit', 100, 100), offset: readPageValue('offset', 0, 10_000), q };
}

// Careers are always read fresh; patient data is requested only for a career granted in this request.
export async function loadReceptionPatientsState(params: URLSearchParams, cookies: AstroCookies): Promise<ReceptionPatientsState> {
	let listing: AcademicPagination & { q: string };
	let invalidMessage: string | undefined;
	try {
		listing = parseReceptionListing(params);
	} catch (error) {
		invalidMessage = error instanceof Error ? error.message : 'Revisá la búsqueda y la paginación.';
		listing = { ...DEFAULT_PAGE, q: '' };
	}
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
	if (invalidMessage) return { kind: 'invalid-search', careers, career: selected, message: invalidMessage, q: '', page: listing };
	try {
		const patients = await listReceptionPatients(selected, cookies, listing);
		return {
			kind: 'list', careers, career: selected, patients, q: listing.q, page: listing,
			navigation: academicPaginationNavigation({ ...listing, itemsLength: patients.length }),
		};
	} catch (error) {
		if (isStatus(error, 401)) return { kind: 'session-expired' };
		if (isStatus(error, 404)) return { kind: 'career-unavailable', careers, career: selected, message: CAREER_UNAVAILABLE };
		return { kind: 'unavailable', careers, career: selected, message: isStatus(error, 403) ? FORBIDDEN : PATIENTS_UNAVAILABLE };
	}
}

// Presentation hint only; the backend re-checks the role and the career grant on every request.
export function resolveReceptionPatientsAccess(token: string | null): 'login' | 'home' | 'ok' {
	if (!token) return 'login';
	return decodeJwt(token)?.role === 'reception' ? 'ok' : 'home';
}
