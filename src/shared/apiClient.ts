import type { AstroCookies } from 'astro';
import { getSession, clearSession } from './session';

interface ApiClientOptions {
	method?: string;
	body?: unknown;
	cookies: AstroCookies;
}

export async function apiFetch<T>(
	path: string,
	opts: ApiClientOptions,
): Promise<T> {
	const token = getSession(opts.cookies);
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const baseUrl = import.meta.env.PUBLIC_API_URL as string;

	try {
		const response = await fetch(`${baseUrl}${path}`, {
			method: opts.method ?? 'GET',
			headers,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
		});

		if (response.status === 401) {
			clearSession(opts.cookies);
			throw new Error('UNAUTHORIZED');
		}

		if (!response.ok) {
			const errorBody = await response.text().catch(() => '');
			throw new Error(errorBody || `HTTP ${response.status}`);
		}

		return (await response.json()) as T;
	} catch (error) {
		if (error instanceof Error && error.message === 'UNAUTHORIZED') {
			throw error;
		}
		throw new Error('Service unavailable');
	}
}
