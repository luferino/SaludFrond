import type { AstroCookies } from 'astro';
import { clearSession } from '../../../shared/session';

export async function handleLogout(
	_input: FormData,
	context: { cookies: AstroCookies },
) {
	clearSession(context.cookies);
	return { success: true as const };
}
