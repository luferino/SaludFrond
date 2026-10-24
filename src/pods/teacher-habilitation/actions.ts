import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError } from '../../shared/apiClient';
import { createTeacherHabilitation, isTeacherHabilitationPeriod, revokeTeacherHabilitation as revokeTeacherHabilitationPeriod } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidField = () => z.string().trim().regex(UUID);
const contextField = () => {
	const uuid = UUID.source.slice(1, -1);
	return z.string().regex(new RegExp(`^${uuid}:${uuid}$`, 'i'));
};

function publicError(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.status === 400) return 'Revisá los datos seleccionados e intentá nuevamente.';
		if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
		if (error.status === 403) return 'Tu sesión no tiene permiso para realizar esta operación.';
		if (error.status === 404) return 'No se encontró el perfil o contexto académico indicado.';
		if (error.status === 409) return 'Ya existe un período activo para este contexto o el período ya no está disponible.';
	}
	return 'No se pudo completar la operación. Probá de nuevo más tarde.';
}

export async function handleActivateTeacherHabilitation(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const teacherId = typeof input.teacher_id === 'string' ? input.teacher_id.trim() : '';
	const hasContext = Object.prototype.hasOwnProperty.call(input, 'context');
	const contextValue = typeof input.context === 'string' ? input.context : '';
	const contextParts = contextValue ? contextValue.split(':') : [];
	if (hasContext && (!contextValue || contextParts.length !== 2 || !contextParts.every((value) => UUID.test(value)))) {
		return { success: false as const, error: 'Seleccioná un perfil docente y un contexto académico válidos.' };
	}
	const [contextSubject, contextGroup] = contextParts;
	const subjectId = typeof input.subject_id === 'string' ? input.subject_id.trim() : (contextSubject ?? '');
	const groupId = typeof input.academic_group_id === 'string' ? input.academic_group_id.trim() : (contextGroup ?? '');
	if (![teacherId, subjectId, groupId].every((value) => UUID.test(value))) {
		return { success: false as const, error: 'Seleccioná un perfil docente y un contexto académico válidos.' };
	}
	try {
		const period = await createTeacherHabilitation({ teacher_id: teacherId, subject_id: subjectId, academic_group_id: groupId }, context.cookies);
		return { success: true as const, period };
	} catch (error) {
		return { success: false as const, error: publicError(error) };
	}
}

export async function handleRevokeTeacherHabilitation(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
	const id = typeof input.id === 'string' ? input.id.trim() : '';
	if (!UUID.test(id) || input.confirm !== 'yes') {
		return { success: false as const, id, error: !UUID.test(id) ? 'Seleccioná un período válido.' : 'Confirmá explícitamente la revocación para continuar.' };
	}
	try {
		const period = await revokeTeacherHabilitationPeriod(id, context.cookies);
		if (!isTeacherHabilitationPeriod(period)) throw new Error('Invalid service response');
		return { success: true as const, id, period };
	} catch (error) {
		return { success: false as const, id, error: publicError(error) };
	}
}

export const activateTeacherHabilitation = defineAction({
	accept: 'form',
	input: z.object({ teacher_id: uuidField(), context: contextField() }),
	handler: handleActivateTeacherHabilitation,
});

export const revokeTeacherHabilitation = defineAction({
	accept: 'form',
	input: z.object({ id: uuidField(), confirm: z.string().optional() }),
	handler: handleRevokeTeacherHabilitation,
});
