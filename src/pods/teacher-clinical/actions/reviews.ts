import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { getTeacherEvaluation, listTeacherSubmissions, parseClinicalContext, teacherGrant, validId, type ClinicalContext } from '../api';
import { requestTeacherCorrection, validateTeacherSubmission } from '../api';

const FIELDS = ['id', 'patient_id', 'subject_id', 'academic_group_id', 'submission_id'];
const CONTEXT_FIELDS = ['patient_id', 'subject_id', 'academic_group_id'];
type ReviewInput = Record<string, unknown>;
type ReviewContext = { cookies: AstroCookies };

function allowedFields(input: ReviewInput, correction: boolean): boolean {
 const fields = new Set([...FIELDS, ...(correction ? ['reason'] : [])]);
 return Object.keys(input).every((key) => fields.has(key))
  && [...FIELDS, ...(correction ? ['reason'] : [])].every((key) => Object.hasOwn(input, key));
}

function readContext(input: ReviewInput): ClinicalContext {
 const values: Record<string, string> = {};
 for (const key of CONTEXT_FIELDS) {
  const value = input[key];
  if (typeof value !== 'string') throw new Error('El contexto clínico no es válido.');
  values[key] = value;
 }
 return parseClinicalContext(new URLSearchParams(values));
}

function knownRejection(error: unknown): string | null {
 if (!(error instanceof ApiError)) return null;
 if (error.status === 400) return 'La solicitud de revisión no es válida.';
 if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
 if (error.status === 403) return 'No tenés permiso vigente para revisar esta ficha.';
 if (error.status === 404) return 'La ficha o versión no está disponible en este contexto.';
 if (error.status === 409) return 'La ficha o versión cambió y ya no admite esta revisión. Actualizá el estado antes de volver a decidir.';
 return null;
}

async function review(input: ReviewInput, context: ReviewContext, correction: boolean) {
 const reason = typeof input.reason === 'string' ? input.reason : '';
 const failure = (error: string, uncertain = false) => ({ success: false as const, error, uncertain, ...(correction ? { reason } : {}) });
 if (!allowedFields(input, correction)) return failure('El formulario contiene campos no permitidos.');
 if (!teacherGrant(context.cookies, 'kinesiology-evaluations:review')) return failure('No tenés permiso vigente para revisar esta ficha.');
 if (!validId(input.id) || !validId(input.submission_id)) return failure('Revisá la ficha y la versión seleccionadas.');
 if (correction && (!reason.trim() || typeof input.reason !== 'string')) return failure('Ingresá un motivo para solicitar la corrección.');
 let selected: ClinicalContext;
 try { selected = readContext(input); }
 catch { return failure('El contexto clínico no es válido.'); }
 let writing = false;
 try {
  const evaluation = await getTeacherEvaluation(input.id, selected, context.cookies);
  if (evaluation.id !== input.id || evaluation.patient_id !== selected.patient_id
   || evaluation.origin_subject_id !== selected.subject_id || evaluation.origin_group_id !== selected.academic_group_id) {
   return failure('La ficha no está disponible en este contexto de origen.');
  }
  if (evaluation.status !== 'submitted') return failure('La ficha ya no está pendiente de revisión.');
  const history = await listTeacherSubmissions(input.id, selected, context.cookies);
  const latest = history.items.at(-1);
  if (!latest || latest.id !== input.submission_id || latest.status !== 'pending_validation') {
   return failure('La versión seleccionada ya no es la última pendiente de revisión.');
  }
  writing = true;
  const result = correction
   ? await requestTeacherCorrection(input.id, latest.id, reason.trim(), context.cookies)
   : await validateTeacherSubmission(input.id, latest.id, context.cookies);
  return { success: true as const, id: input.id, context: selected, result, outcome: correction ? 'corrections-requested' as const : 'validated' as const };
 } catch (error) {
  const rejection = knownRejection(error);
  if (rejection) return failure(rejection);
  return writing
   ? failure('No se pudo confirmar el resultado de la revisión. Actualizá la ficha antes de decidir si corresponde otra acción; no repetimos el envío automáticamente.', true)
   : failure('No se pudo verificar la ficha y su última versión. No se envió ninguna revisión.');
 }
}

export async function handleValidateTeacherSubmission(input: ReviewInput, context: ReviewContext) {
 return review(input, context, false);
}

export async function handleRequestTeacherCorrection(input: ReviewInput, context: ReviewContext) {
 return review(input, context, true);
}
