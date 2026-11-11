import type { AstroCookies } from 'astro';
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError } from '../../shared/apiClient';
import { setSession } from '../../shared/session';
import { sessionMaxAge } from '../auth/actions/login';
import { mayHoldAdditionalRole, ROLE_PATTERN, requestActiveRole } from './api';

const FORBIDDEN = 'Tu cuenta no tiene habilitado ese rol. Pedile a un administrador que lo revise.';
const GENERIC = 'No se pudo cambiar el rol. Intentá nuevamente.';

export async function handleSwitchActiveRole(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	const role = typeof input.role === 'string' ? input.role.trim() : '';
	// Only the switchable Student and Reception roles are ever requested; the backend still decides.
	if (!ROLE_PATTERN.test(role) || !mayHoldAdditionalRole(role)) return { success: false as const, reason: 'failed' as const, error: GENERIC };
	try {
		const token = await requestActiveRole(role, context.cookies);
		setSession(context.cookies, token, sessionMaxAge(token));
		return { success: true as const };
	} catch (error) {
		// apiFetch already cleared the session on 401, so the page only has to send the user to login.
		if (error instanceof ApiError && error.status === 401) return { success: false as const, reason: 'unauthorized' as const };
		if (error instanceof ApiError && error.status === 403) return { success: false as const, reason: 'forbidden' as const, error: FORBIDDEN };
		return { success: false as const, reason: 'failed' as const, error: GENERIC };
	}
}

export const switchActiveRole = defineAction({
	accept: 'form',
	input: z.object({ role: z.string().trim().min(1).max(32) }),
	handler: handleSwitchActiveRole,
});
