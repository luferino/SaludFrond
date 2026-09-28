import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';
import { decodeJwt } from '../../../shared/jwt';
import { setSession } from '../../../shared/session';

const FALLBACK_MAX_AGE_SEC = 7200;

interface LoginInput {
	username: string;
	password: string;
	returnTo?: string;
}

interface LoginResponse {
	token: string;
}

export async function handleLogin(
	input: LoginInput,
	context: { cookies: AstroCookies },
) {
	try {
		const result = await apiFetch<LoginResponse>('/auth/login', {
			method: 'POST',
			body: { username: input.username, password: input.password },
			cookies: context.cookies,
		});

		setSession(context.cookies, result.token, sessionMaxAge(result.token));

		return {
			success: true as const,
			returnTo: sanitizeReturnTo(input.returnTo),
		};
	} catch (error) {
		if (error instanceof ApiError) {
			if (error.code === 'UNAUTHORIZED') {
				return { success: false as const, error: 'Credenciales inválidas' };
			}
			if (error.code === 'BAD_REQUEST') {
				return { success: false as const, error: error.message };
			}
			return { success: false as const, error: `HTTP ${error.status}` };
		}
		return { success: false as const, error: 'Service unavailable' };
	}
}

function sessionMaxAge(token: string): number {
	const exp = decodeJwt(token)?.exp;
	if (exp === undefined) {
		return FALLBACK_MAX_AGE_SEC;
	}

	const remaining = exp - Math.floor(Date.now() / 1000);
	return remaining > 0 ? remaining : FALLBACK_MAX_AGE_SEC;
}

function sanitizeReturnTo(returnTo?: string): string {
	if (
		!returnTo ||
		!returnTo.startsWith('/') ||
		returnTo.startsWith('//') ||
		returnTo.includes('://')
	) {
		return '/';
	}
	return returnTo;
}