import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';

interface RegisterInput {
	username: string;
	email: string;
	password: string;
}

export async function handleRegister(
	input: RegisterInput,
	context: { cookies: AstroCookies },
) {
	try {
		await apiFetch('/auth/register', {
			method: 'POST',
			body: {
				username: input.username,
				email: input.email,
				password: input.password,
			},
			cookies: context.cookies,
		});

		return { success: true as const, redirectTo: '/auth/login' };
	} catch (error) {
		if (error instanceof ApiError) {
			if (error.code === 'CONFLICT' || error.code === 'BAD_REQUEST') {
				return { success: false as const, error: error.message };
			}
			return { success: false as const, error: `HTTP ${error.status}` };
		}
		return { success: false as const, error: 'Service unavailable' };
	}
}