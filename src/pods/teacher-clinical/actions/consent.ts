import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { appendConsent, getConsent, getTeacherEvaluation, parseClinicalContext, teacherGrant, validId, validPaperDate } from '../api';

export async function handleRecordTeacherConsent(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
 const date = typeof input.paper_signature_date === 'string' ? input.paper_signature_date : '';
 const failed = (error: string, uncertain = false) => ({ success: false as const, error, paper_signature_date: date, uncertain });
 if (!teacherGrant(context.cookies, 'kinesiology-evaluations:read') || !teacherGrant(context.cookies, 'kinesiology-evaluations:verify-consent')) {
  return failed('No tenés permiso para registrar el consentimiento como docente.');
 }
 if (!validId(input.id) || !validPaperDate(date)) return failed('Revisá la ficha y la fecha de firma en papel (AAAA-MM-DD).');
 if (Object.keys(input).some((key) => !['id', 'patient_id', 'subject_id', 'academic_group_id', 'paper_signature_date'].includes(key))) {
  return failed('El formulario contiene campos no permitidos.');
 }
 let writing = false;
 try {
  const selected = parseClinicalContext(new URLSearchParams({
   patient_id: String(input.patient_id ?? ''), subject_id: String(input.subject_id ?? ''), academic_group_id: String(input.academic_group_id ?? ''),
  }));
  await getTeacherEvaluation(input.id, selected, context.cookies);
  // A successful origin-only GET is not write authority; POST rechecks the teacher/grant.
  await getConsent(input.id, context.cookies);
  writing = true;
  await appendConsent(input.id, date, context.cookies);
  return { success: true as const };
 } catch (error) {
  if (error instanceof ApiError) {
   if (error.status === 401) return failed('Tu sesión venció. Iniciá sesión nuevamente.');
   if (error.status === 400) return failed('Revisá la fecha de firma en papel.');
   if (error.status === 403) return failed('No tenés permiso vigente para registrar este consentimiento.');
   if (error.status === 404) return failed('La ficha no está disponible en este contexto.');
  }
  return writing
   ? failed('No se pudo confirmar el registro. Consultá el estado antes de decidir si corresponde registrar otra constancia; no repetimos el envío automáticamente.', true)
   : failed('No se pudo verificar el contexto y el consentimiento. No se envió ninguna constancia.');
 }
}
