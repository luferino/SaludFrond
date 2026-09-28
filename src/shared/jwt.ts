export interface JwtPayload {
	sub: string;
	username: string;
	role: string;
	exp: number;
	iat: number;
}

export function decodeJwt(token: string): JwtPayload | null {
	try {
		const segments = token.split('.');
		if (segments.length !== 3) return null;

		const payload = segments[1];
		const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

export function isTokenValid(token: string): boolean {
	const payload = decodeJwt(token);
	if (!payload) return false;
	return payload.exp > Date.now() / 1000;
}
