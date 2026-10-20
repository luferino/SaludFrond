import type { AstroCookies } from 'astro';
import { createSubjectGroup } from '../api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubjectGroupInput {
	subject_id: unknown;
	academic_group_id: unknown;
}

function normalizedUuid(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return UUID_PATTERN.test(normalized) ? normalized : null;
}

function isIsoDateTime(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		return false;
	}
	return Number.isFinite(Date.parse(value));
}

function isCreatedSubjectGroup(value: unknown): value is {
	subject_id: string;
	academic_group_id: string;
	created_by: string | null;
	created_at: string;
} {
	if (!value || typeof value !== 'object') return false;
	const association = value as Record<string, unknown>;
	return typeof association.subject_id === 'string' && UUID_PATTERN.test(association.subject_id)
		&& typeof association.academic_group_id === 'string' && UUID_PATTERN.test(association.academic_group_id)
		&& (association.created_by === null || (typeof association.created_by === 'string' && UUID_PATTERN.test(association.created_by)))
		&& isIsoDateTime(association.created_at);
}

export async function handleCreateSubjectGroup(
	input: SubjectGroupInput,
	context: { cookies: AstroCookies },
) {
	const subjectId = normalizedUuid(input.subject_id);
	const academicGroupId = normalizedUuid(input.academic_group_id);
	if (!subjectId || !academicGroupId) {
		return {
			success: false as const,
			subjectId: typeof input.subject_id === 'string' ? input.subject_id.trim() : '',
			academicGroupId: typeof input.academic_group_id === 'string' ? input.academic_group_id.trim() : '',
			error: 'Ingresá UUID válidos para la asignatura y el grupo académico.',
		};
	}

	try {
		const association = await createSubjectGroup({ subject_id: subjectId, academic_group_id: academicGroupId }, context.cookies);
		if (!isCreatedSubjectGroup(association)) {
			return {
				success: false as const, subjectId, academicGroupId,
				error: 'El servicio devolvió datos incompletos de la asociación. Probá de nuevo más tarde.',
			};
		}
		return {
			success: true as const, subjectId, academicGroupId,
			association: {
				subject_id: association.subject_id,
				academic_group_id: association.academic_group_id,
				created_by: association.created_by,
				created_at: association.created_at,
			},
		};
	} catch (error) {
		let message = 'No se pudo crear la asociación. Probá de nuevo más tarde.';
		if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
			if (error.status === 400) message = 'Revisá los identificadores e intentá nuevamente.';
			else if (error.status === 401) message = 'Tu sesión venció. Iniciá sesión nuevamente.';
			else if (error.status === 403) message = 'Tu sesión no tiene permiso para crear asociaciones académicas.';
			else if (error.status === 404) message = 'No se encontró la asignatura o el grupo académico indicado.';
			else if (error.status === 409) message = 'Ya existe esta asociación entre la asignatura y el grupo académico.';
			return { success: false as const, subjectId, academicGroupId, error: message };
		}
		if (error instanceof Error && error.message === 'Service unavailable') {
			message = 'No se pudo conectar con el servicio. Probá de nuevo más tarde.';
		}
		return { success: false as const, subjectId, academicGroupId, error: message };
	}
}
