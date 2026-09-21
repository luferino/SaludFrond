import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';

interface PatientInput {
	documento: string;
	nombres: string;
	apellidos: string;
	fecha_nacimiento: string;
	email: string;
	celular: string;
	sexo: string;
	direccion: string;
}

interface PatientResponse {
	id: string;
	documento: string;
	nombres: string;
	apellidos: string;
	fecha_nacimiento: string;
	email: string;
	celular: string;
	sexo: string;
	direccion: string;
	created_by: string;
	created_at: string;
}

export async function handleCreatePatient(
	input: PatientInput,
	context: { cookies: AstroCookies },
) {
	try {
		const result = await apiFetch<PatientResponse>('/patients', {
			method: 'POST',
			body: {
				documento: input.documento,
				nombres: input.nombres,
				apellidos: input.apellidos,
				fecha_nacimiento: input.fecha_nacimiento,
				email: input.email,
				celular: input.celular,
				sexo: input.sexo,
				direccion: input.direccion,
			},
			cookies: context.cookies,
		});

		return {
			success: true as const,
			patient: {
				id: result.id,
				documento: result.documento,
				nombres: result.nombres,
				apellidos: result.apellidos,
			},
		};
	} catch (error) {
		if (error instanceof ApiError) {
			if (
				error.code === 'CONFLICT' ||
				error.code === 'BAD_REQUEST' ||
				error.code === 'FORBIDDEN'
			) {
				return { success: false as const, error: error.message };
			}
			return { success: false as const, error: `HTTP ${error.status}` };
		}
		return { success: false as const, error: 'Service unavailable' };
	}
}
