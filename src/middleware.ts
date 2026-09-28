import { defineMiddleware } from 'astro/middleware';
import { isTokenValid } from './shared/jwt';
import { getSession } from './shared/session';

const PUBLIC_PATHS = ['/login', '/auth/login', '/auth/register'];

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
		return next();
	}

	const token = getSession(context.cookies);

	if (token && isTokenValid(token)) {
		return next();
	}

	const returnTo = encodeURIComponent(pathname);
	return context.redirect(`/login?returnTo=${returnTo}`);
});
