import type { AstroCookies } from 'astro';
import { getSession, clearSession } from './session';

interface ApiClientOptions {
	method?: string;
	body?: unknown;
	cookies: AstroCookies;
}

interface ErrorEnvelope {
	error?: {
		code?: unknown;
		message?: unknown;
	};
}

export class ApiError extends Error {
	status: number;
	code?: string;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		if (code !== undefined) {
			this.code = code;
		}
	}
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

		if (!response.ok) {
			if (response.status === 401) {
				clearSession(opts.cookies);
			}

			const envelope = await parseErrorEnvelope(response);
			throw new ApiError(
				response.status,
				envelope.message,
				response.status === 401 ? 'UNAUTHORIZED' : envelope.code,
			);
		}

		return (await response.json()) as T;
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw new Error('Service unavailable');
	}
}

async function parseErrorEnvelope(
	response: Response,
): Promise<{ code?: string; message: string }> {
	const fallback = { message: `HTTP ${response.status}` };

	try {
		const body = (await response.json()) as ErrorEnvelope;
		if (!body || typeof body !== 'object' || !body.error) {
			return fallback;
		}

		const result: { code?: string; message: string } = { ...fallback };
		if (typeof body.error.code === 'string') {
			result.code = body.error.code;
		}
		if (typeof body.error.message === 'string') {
			result.message = body.error.message;
		}
		return result;
	} catch {
		return fallback;
	}
}