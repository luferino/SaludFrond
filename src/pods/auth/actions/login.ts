import type { AstroCookies } from 'astro';
import { apiFetch } from '../../../shared/apiClient';
import { setSession } from '../../../shared/session';

interface LoginInput {
	username: string;
	password: string;
	returnTo?: string;
}

interface LoginResponse {
	token: string;
	exp: number;
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

		const maxAge = result.exp - Math.floor(Date.now() / 1000);
		setSession(context.cookies, result.token, maxAge);

		return {
			success: true as const,
			returnTo: sanitizeReturnTo(input.returnTo),
		};
	} catch (error) {
		if (error instanceof Error && error.message === 'UNAUTHORIZED') {
			return { success: false as const, error: 'Credenciales inválidas' };
		}
		return { success: false as const, error: 'Service unavailable' };
	}
}

function sanitizeReturnTo(returnTo?: string): string {
	if (!returnTo || !returnTo.startsWith('/') || returnTo.includes('://')) {
		return '/';
	}
	return returnTo;
}
