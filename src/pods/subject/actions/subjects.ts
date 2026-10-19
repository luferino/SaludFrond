import type { AstroCookies } from 'astro';
import { createSubject } from '../api';

interface SubjectInput {
	name: unknown;
}

export async function handleCreateSubject(
	input: SubjectInput,
	context: { cookies: AstroCookies },
) {
	if (typeof input.name !== 'string' || input.name.trim().length === 0) {
		return { success: false as const, error: 'Ingresá un nombre para la asignatura.' };
	}

	try {
		const subject = await createSubject(input.name.trim(), context.cookies);
		return {
			success: true as const,
			subject: { id: subject.id, name: subject.name },
		};
	} catch (error) {
		if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
			if (error.status === 400) {
				return { success: false as const, error: 'Revisá el nombre e intentá nuevamente.' };
			}
			if (error.status === 403) {
				return { success: false as const, error: 'Tu sesión no tiene permiso para crear asignaturas.' };
			}
			if (error.status === 401) {
				return { success: false as const, error: 'Tu sesión venció. Iniciá sesión nuevamente.' };
			}
			return { success: false as const, error: 'No se pudo crear la asignatura. Probá de nuevo más tarde.' };
		}
		return { success: false as const, error: 'No se pudo conectar con el servicio. Probá de nuevo más tarde.' };
	}
}
