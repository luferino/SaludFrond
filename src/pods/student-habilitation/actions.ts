import type { AstroCookies } from 'astro';
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError, apiFetch } from '../../shared/apiClient';
import { isStudentPeriod, UUID_PATTERN } from './api';

const CONTEXT_PAIR = new RegExp(`^(${UUID_PATTERN.source.slice(1, -1)})\\|(${UUID_PATTERN.source.slice(1, -1)})$`, 'i');
const uuid = z.string().regex(UUID_PATTERN);
const contextPair = z.string().regex(CONTEXT_PAIR);
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
function safeDraft(input: Record<string, unknown>, key: string): string {
 const value = input[key];
 return typeof value === 'string' && UUID_PATTERN.test(value) ? value : '';
}
function safeDraftContext(value: unknown): string {
 return typeof value === 'string' && CONTEXT_PAIR.test(value) ? value : '';
}
function errorMessage(error: unknown, operation: string): string {
 if (error instanceof ApiError) {
  if (error.status === 400) return 'Revisá los datos e intentá nuevamente.';
  if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
  if (error.status === 403) return 'No tenés permiso o contexto docente activo para esta operación.';
  if (error.status === 404) return 'No se encontró el perfil, contexto o período indicado.';
  if (error.status === 409) return 'La operación entra en conflicto con el estado actual del período.';
 }
 return `No se pudo ${operation}. Probá de nuevo más tarde.`;
}
function withDraft<T extends { success: boolean }>(result: T, input: Record<string, unknown>) {
 return { ...result, draftStudentId: safeDraft(input, 'student_id'), draftContext: safeDraftContext(input.context_pair) };
}
export async function handleActivateStudentHabilitation(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
 const studentId = typeof input.student_id === 'string' && UUID_PATTERN.test(input.student_id) ? input.student_id : '';
 const pair = typeof input.context_pair === 'string' ? input.context_pair.match(CONTEXT_PAIR) : null;
 if (!studentId || !pair) return withDraft({ success: false as const, error: 'Seleccioná un estudiante y una asociación vinculada válidos.' }, input);
 const subjectId = pair[1], academicGroupId = pair[2];
 try {
  const response = await apiFetch<unknown>('/student-habilitations', {
   method: 'POST', body: { student_id: studentId, subject_id: subjectId, academic_group_id: academicGroupId }, cookies: context.cookies,
  });
  if (!isStudentPeriod(response) || response.revoked_at !== null || !sameId(response.student_id, studentId)
   || !sameId(response.subject_id, subjectId) || !sameId(response.academic_group_id, academicGroupId)) {
   return withDraft({ success: false as const, error: 'El servicio devolvió datos incompletos o inconsistentes del período.' }, input);
  }
  return withDraft({ success: true as const, period: response }, input);
 } catch (error) { return withDraft({ success: false as const, error: errorMessage(error, 'activar el período') }, input); }
}
export async function handleRevokeStudentHabilitation(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
 const id = typeof input.id === 'string' && UUID_PATTERN.test(input.id) ? input.id : '';
 if (!id || input.confirm_consequences !== 'yes') return { success: false as const, error: 'Confirmá la revocación y sus consecuencias para continuar.' };
 try {
  const response = await apiFetch<unknown>(`/student-habilitations/${id}/revoke`, { method: 'POST', cookies: context.cookies });
  if (!isStudentPeriod(response) || !sameId(response.id, id) || response.revoked_at === null) {
   return { success: false as const, error: 'El servicio devolvió datos incompletos o inconsistentes del período revocado.' };
  }
  return { success: true as const, period: response };
 } catch (error) { return { success: false as const, error: errorMessage(error, 'revocar el período') }; }
}

export const activateStudentHabilitation = defineAction({
 accept: 'form',
 input: z.object({ student_id: uuid, context_pair: contextPair }),
 handler: handleActivateStudentHabilitation,
});
export const revokeStudentHabilitation = defineAction({
 accept: 'form',
 input: z.object({ id: uuid, confirm_consequences: z.literal('yes') }),
 handler: handleRevokeStudentHabilitation,
});
