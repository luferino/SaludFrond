import type { AstroCookies } from 'astro';
import { apiFetch } from '../../../shared/apiClient';

interface RegisterInput {
	username: string;
	password: string;
}

export async function handleRegister(
	input: RegisterInput,
	context: { cookies: AstroCookies },
) {
	try {
		await apiFetch('/auth/register', {
			method: 'POST',
			body: { username: input.username, password: input.password },
			cookies: context.cookies,
		});

		return { success: true as const, redirectTo: '/login' };
	} catch (error) {
		if (error instanceof Error) {
			const msg = error.message;

			if (msg.includes('409') || msg.toLowerCase().includes('duplicate')) {
				return { success: false as const, error: 'El nombre de usuario ya está en uso' };
			}

			if (msg.includes('400') || msg.toLowerCase().includes('validation')) {
				return { success: false as const, error: msg || 'Datos inválidos' };
			}

			return { success: false as const, error: 'Service unavailable' };
		}

		return { success: false as const, error: 'Service unavailable' };
	}
}
