import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../../shared/apiClient';

interface ResetPasswordInput {
	token: string;
	newPassword: string;
}

interface ResetPasswordResponse {
	message: string;
}

export async function handleResetPassword(
	input: ResetPasswordInput,
	context: { cookies: AstroCookies },
) {
	try {
		const result = await apiFetch<ResetPasswordResponse>(
			'/auth/reset-password',
			{
				method: 'POST',
				body: {
					token: input.token,
					newPassword: input.newPassword,
				},
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
