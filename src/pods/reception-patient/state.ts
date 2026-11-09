import type { AstroCookies } from 'astro';
import { ApiError } from '../../shared/apiClient';
import { decodeJwt } from '../../shared/jwt';
import { loadCareerScope, parseRequestedCareer } from '../reception/careers';
import type { ReceptionCareer } from '../reception/careers';
import { listReceptionPatients } from './api';
import type { ReceptionPatient } from './api';

export type ReceptionPatientsState =
	| { kind: 'session-expired' }
	| { kind: 'unavailable'; careers: ReceptionCareer[]; career: ReceptionCareer | null; message: string }
	| { kind: 'no-careers'; careers: ReceptionCareer[] }
	| { kind: 'select'; careers: ReceptionCareer[]; requested: string | null }
	| { kind: 'career-unavailable'; careers: ReceptionCareer[]; career: ReceptionCareer; message: string }
	| { kind: 'list'; careers: ReceptionCareer[]; career: ReceptionCareer; patients: ReceptionPatient[] };

const CAREERS_UNAVAILABLE = 'No se pudieron cargar tus carreras habilitadas. Probá de nuevo más tarde.';
const PATIENTS_UNAVAILABLE = 'No se pudieron cargar los pacientes. Probá de nuevo más tarde.';
const CAREER_UNAVAILABLE = 'La carrera seleccionada ya no está habilitada para tu cuenta. Elegí una de tus carreras para continuar.';
const FORBIDDEN = 'Tu cuenta no tiene permiso para gestionar pacientes en recepción.';

const isStatus = (error: unknown, status: number) => error instanceof ApiError && error.status === status;

// Careers are always read fresh; patient data is requested only for a career granted in this request.
export async function loadReceptionPatientsState(params: URLSearchParams, cookies: AstroCookies): Promise<ReceptionPatientsState> {
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
	try {
		return { kind: 'list', careers, career: selected, patients: await listReceptionPatients(selected, cookies) };
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
