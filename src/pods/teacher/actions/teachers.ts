import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';

interface TeacherInput {
	username: string;
	password: string;
	nombres: string;
	apellidos: string;
	email?: string;
	celular?: string;
}

interface TeacherResponse {
	id: string;
	nombres: string;
	apellidos: string;
	email: string | null;
	celular: string | null;
	created_by: string;
	created_at: string;
}

export async function handleCreateTeacher(
	input: TeacherInput,
	context: { cookies: AstroCookies },
) {
	try {
		const result = await apiFetch<TeacherResponse>('/teachers', {
			method: 'POST',
			body: {
				username: input.username,
				password: input.password,
				nombres: input.nombres,
				apellidos: input.apellidos,
				email: input.email || undefined,
				celular: input.celular || undefined,
			},
			cookies: context.cookies,
		});

		return {
			success: true as const,
			teacher: {
				id: result.id,
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
