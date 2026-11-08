import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { parseClinicalContext, teacherGrant, type ClinicalContext } from '../../teacher-clinical/api';
import { authorizeOralSurgeryDraft, getOralSurgeryDraft, validId } from '../api';

const FIELDS = ['id', 'patient_id', 'subject_id', 'academic_group_id', 'expected_version', 'consent_declaration_id', 'paper_consent_verified'];
const UNAVAILABLE = 'El borrador no está disponible en este contexto de origen.';
const VERSION_CHANGED = 'El alumno guardó una versión nueva. Revisala antes de autorizar.';
const UNCERTAIN = 'No se pudo confirmar la autorización. Actualizá la ficha y revisá el historial antes de volver a intentarlo; no repetimos el envío automáticamente.';

/** Typed backend rejections are safe to show; the caller must not retry them. Null means outcome unknown. */
function knownRejection(error: unknown): string | null {
 if (!(error instanceof ApiError)) return null;
 if (error.status === 400) return 'La solicitud de autorización no es válida.';
 if (error.status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
 if (error.status === 403) return 'No tenés permiso vigente para autorizar este borrador.';
 if (error.status === 404) return 'El borrador no está disponible en este contexto.';
 if (error.status === 409) {
  if (error.message === 'current signed paper consent declaration is required') return 'Falta una declaración vigente de consentimiento en papel para el plan actual.';
  if (error.message === 'draft version changed; reload before saving') return VERSION_CHANGED;
  return 'El borrador ya no admite esta autorización. Actualizá la ficha antes de volver a intentarlo.';
 }
 return null;
}

/** Authorize one reviewed version: re-read the draft under the origin guard, then send exactly one POST. */
export async function handleAuthorizeOralSurgeryDraft(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
 const failure = (error: string, uncertain = false) => ({ success: false as const, error, uncertain });
 if (!teacherGrant(context.cookies, 'oral-surgery-drafts:authorize')) return failure('No tenés permiso vigente para autorizar este borrador.');
 if (Object.keys(input).length !== FIELDS.length || FIELDS.some((key) => !Object.hasOwn(input, key))) return failure('El formulario contiene campos no permitidos.');
 if (input.paper_consent_verified !== 'on') return failure('Confirmá que verificaste el consentimiento firmado en papel.');
 if (!validId(input.id) || !validId(input.expected_version) || !validId(input.consent_declaration_id)) {
  return failure('Revisá el borrador, la versión y la declaración seleccionados.');
 }
 const text = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';
 let selected: ClinicalContext;
 try {
  selected = parseClinicalContext(new URLSearchParams({ patient_id: text('patient_id'), subject_id: text('subject_id'), academic_group_id: text('academic_group_id') }));
 } catch {
  return failure('El contexto clínico no es válido.');
 }
 let writing = false;
 try {
  const draft = await getOralSurgeryDraft(input.id, context.cookies);
  if (draft.patient_id !== selected.patient_id || draft.origin_subject_id !== selected.subject_id || draft.origin_group_id !== selected.academic_group_id) {
   return failure(UNAVAILABLE);
  }
  if (draft.version !== input.expected_version) return failure(VERSION_CHANGED);
  writing = true;
  await authorizeOralSurgeryDraft(input.id, input.expected_version, input.consent_declaration_id, context.cookies);
  return { success: true as const, id: input.id, ...selected };
 } catch (error) {
  const rejection = knownRejection(error);
  if (rejection) return failure(rejection);
  return writing ? failure(UNCERTAIN, true) : failure('No se pudo verificar el borrador. No se envió ninguna autorización.');
 }
}
