import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { ApiError } from '../../shared/apiClient';
import { createTeacherAssignment as postTeacherAssignment, type TeacherAssignmentInput } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function publicError(error: unknown): string {
 if (error instanceof ApiError) {
  if (error.status === 400) return 'Revisá las selecciones e intentá nuevamente.';
  if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
  if (error.status === 403) return 'No tenés permiso o el contexto docente ya no está activo.';
  if (error.status === 404) return 'El estudiante habilitado o el paciente ya no está disponible.';
  if (error.status === 409 && error.code === 'CONFLICT') {
   if (/destination context|not available/i.test(error.message)) return 'El paciente ya no está disponible en este contexto. Actualizá los selectores.';
   if (/active assignment for this subject/i.test(error.message)) return 'El paciente ya tiene una asignación activa para esta asignatura.';
   return 'No se pudo crear la asignación por un conflicto. Actualizá los selectores e intentá nuevamente.';
  }
 }
 return 'No se pudo crear la asignación. Probá de nuevo más tarde.';
}
export async function handleCreateTeacherAssignment(input: Record<string, unknown>, context: { cookies: import('astro').AstroCookies }) {
 const keys = ['patient_id','student_habilitation_id','subject_id','academic_group_id'] as const;
 if (!keys.every((key) => typeof input[key] === 'string' && UUID.test(input[key] as string))) return { success:false as const, error:'Seleccioná un estudiante, paciente y contexto válidos.' };
 const body = Object.fromEntries(keys.map((key) => [key, input[key]])) as unknown as TeacherAssignmentInput;
 try { return { success:true as const, assignment: await postTeacherAssignment(body, context.cookies) }; }
 catch (error) { return { success:false as const, error:publicError(error) }; }
}
export const createTeacherAssignment = defineAction({
 accept:'form',
 input:z.object({ patient_id:z.string().regex(UUID), student_habilitation_id:z.string().regex(UUID), subject_id:z.string().regex(UUID), academic_group_id:z.string().regex(UUID) }),
 handler:handleCreateTeacherAssignment,
});
