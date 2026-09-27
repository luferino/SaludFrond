import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';
import { isTokenValid } from '../../../shared/jwt';
import { getSession, clearSession } from '../../../shared/session';

const LOGIN_REDIRECT = '/auth/login?returnTo=%2Fauth%2Fregister';

interface RegisterInput {
	username: string;
	email: string;
	password: string;
}

export async function handleRegister(
	input: RegisterInput,
	context: { cookies: AstroCookies },
) {
	const token = getSession(context.cookies);
	// This checks local session expiry, not the JWT signature or current permissions.
	if (!token || !isTokenValid(token)) {
		if (token) clearSession(context.cookies);
		return {
			success: false as const,
			error: 'La sesión no es válida. Inicie sesión para registrar usuarios.',
			redirectTo: LOGIN_REDIRECT,
		};
	}

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

		return { success: true as const };
	} catch (error) {
		if (error instanceof ApiError) {
			if (error.status === 401) {
				return {
					success: false as const,
					error: 'La sesión no es válida. Inicie sesión nuevamente.',
					redirectTo: LOGIN_REDIRECT,
				};
			}
			if (error.status === 403) {
				return { success: false as const, error: 'No tiene permiso para registrar usuarios.' };
			}
			if (error.status === 409 || error.status === 400) {
				return { success: false as const, error: error.message };
			}
			return { success: false as const, error: `HTTP ${error.status}` };
		}
		return { success: false as const, error: 'Servicio no disponible. Intente nuevamente más tarde.' };
	}
}
