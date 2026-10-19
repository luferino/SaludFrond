import type { AstroCookies } from 'astro';
import { createGroup } from '../api';

const MAX_INT32 = 2_147_483_647;

interface GroupInput {
	academic_year: unknown;
	curriculum_semester: unknown;
	name: unknown;
}

function isPositiveInt32(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_INT32;
}

function isCreatedGroup(value: unknown): value is {
	id: string;
	academic_year: number;
	curriculum_semester: number;
	name: string;
	created_by: string | null;
	created_at: string;
} {
	if (!value || typeof value !== 'object') return false;
	const group = value as Record<string, unknown>;
	return typeof group.id === 'string' && group.id.length > 0
		&& isPositiveInt32(group.academic_year)
		&& isPositiveInt32(group.curriculum_semester)
		&& typeof group.name === 'string' && group.name.trim().length > 0
		&& (group.created_by === null || typeof group.created_by === 'string')
		&& typeof group.created_at === 'string' && group.created_at.length > 0;
}

export async function handleCreateGroup(
	input: GroupInput,
	context: { cookies: AstroCookies },
) {
	if (!isPositiveInt32(input.academic_year) || !isPositiveInt32(input.curriculum_semester)) {
		return { success: false as const, error: 'Ingresá un año académico y un semestre curricular enteros entre 1 y 2147483647.' };
	}
	if (typeof input.name !== 'string' || input.name.trim().length === 0) {
		return { success: false as const, error: 'Ingresá un nombre para el grupo.' };
	}

	try {
		const group = await createGroup({
			academic_year: input.academic_year,
			curriculum_semester: input.curriculum_semester,
			name: input.name.trim(),
		}, context.cookies);
		if (!isCreatedGroup(group)) {
			return { success: false as const, error: 'El servicio devolvió datos incompletos del grupo. Probá de nuevo más tarde.' };
		}
		return {
			success: true as const,
			group: {
				id: group.id,
				academic_year: group.academic_year,
				curriculum_semester: group.curriculum_semester,
				name: group.name,
				created_by: group.created_by,
				created_at: group.created_at,
			},
		};
	} catch (error) {
		if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
			if (error.status === 400) {
				return { success: false as const, error: 'Revisá los datos del grupo e intentá nuevamente.' };
			}
			if (error.status === 401) {
				return { success: false as const, error: 'Tu sesión venció. Iniciá sesión nuevamente.' };
			}
			if (error.status === 403) {
				return { success: false as const, error: 'Tu sesión no tiene permiso para crear grupos académicos.' };
			}
			if (error.status === 409) {
				return { success: false as const, error: 'Ya existe un grupo con este año académico, semestre curricular y nombre exactos.' };
			}
			return { success: false as const, error: 'No se pudo crear el grupo. Probá de nuevo más tarde.' };
		}
		return { success: false as const, error: 'No se pudo conectar con el servicio. Probá de nuevo más tarde.' };
	}
}
