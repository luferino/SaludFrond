import type { AstroCookies } from 'astro';

const SESSION_COOKIE = 'session';

export function getSession(cookies: AstroCookies): string | null {
	const cookie = cookies.get(SESSION_COOKIE);
	return cookie?.value ?? null;
}

export function setSession(
	cookies: AstroCookies,
	token: string,
	maxAgeSec: number,
): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: import.meta.env.PROD,
		maxAge: maxAgeSec,
	});
}

export function clearSession(cookies: AstroCookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
