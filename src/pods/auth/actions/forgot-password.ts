import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';

interface ForgotPasswordInput {
	username: string;
}

interface ForgotPasswordResponse {
	message: string;
}

export async function handleForgotPassword(
	input: ForgotPasswordInput,
	context: { cookies: AstroCookies },
) {
	try {
		const result = await apiFetch<ForgotPasswordResponse>(
			'/auth/forgot-password',
			{
				method: 'POST',
				body: { username: input.username },
				cookies: context.cookies,
			},
		);

		return { success: true as const, message: result.message };
	} catch (error) {
		if (error instanceof ApiError) {
			if (error.code === 'BAD_REQUEST') {
				return { success: false as const, error: error.message };
			}
			return { success: false as const, error: `HTTP ${error.status}` };
		}
		return { success: false as const, error: 'Service unavailable' };
	}
}
