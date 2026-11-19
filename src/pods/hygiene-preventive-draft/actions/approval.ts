import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { parseClinicalContext, teacherGrant, type ClinicalContext } from '../../teacher-clinical/api';
import { approveHygieneProcedure, getHygieneDraft, listHygieneProcedures, validId } from '../api';
import { isTyped } from './drafts';

/** Spanish copy for the teacher approval (D5). Uncertain outcomes never claim that nothing was stored. */
export const HYGIENE_APPROVAL_COPY = {
	identifierInvalid: 'El procedimiento o el borrador no es válido.',
	context: 'El contexto clínico no es válido.',
	confirmation: 'Confirmá que entendés que la aprobación es definitiva.',
	forbidden: 'No tenés permiso vigente para aprobar procedimientos.',
	unavailable: 'El borrador no está disponible en este contexto de origen.',
	gone: 'El procedimiento ya no está en el registro. Recargá la página para ver la lista actual.',
	already: 'El procedimiento ya estaba aprobado.',
	stale: 'El alumno modificó el procedimiento. Revisalo antes de aprobar.',
	badRequest: 'Revisá los datos de la aprobación.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	generic: 'No se pudo completar la aprobación. Recargá la página antes de volver a intentarlo.',
	readFailure: 'No se pudo verificar el borrador. No se guardó ni se envió nada.',
	uncertain: 'No se pudo confirmar la aprobación. Recargá la página y revisá el registro antes de volver a intentarlo.',
} as const;

const APPROVE_GRANT = 'hygiene-preventive-drafts:approve';
const STALE_MESSAGE = 'procedure entry version changed; reload before saving';

export interface ApprovalSuccess { success: true; id: string; procedure_id: string; patient_id: string; subject_id: string; academic_group_id: string }
export interface ApprovalFailure { success: false; uncertain: boolean; error: string; procedure_id: string; expected_version: string }
export type ApprovalResult = ApprovalSuccess | ApprovalFailure;

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** A typed rejection proves nothing was stored: each one maps to its own copy. */
function rejectionCopy(error: ApiError): string {
	if (error.status === 401) return HYGIENE_APPROVAL_COPY.session;
	if (error.status === 403) return HYGIENE_APPROVAL_COPY.forbidden;
	if (error.status === 404) return error.message === 'procedure entry was not found' ? HYGIENE_APPROVAL_COPY.gone : HYGIENE_APPROVAL_COPY.unavailable;
	if (error.status === 409) {
		if (error.message === 'procedure entry is already approved') return HYGIENE_APPROVAL_COPY.already;
		if (error.message === STALE_MESSAGE) return HYGIENE_APPROVAL_COPY.stale;
		return HYGIENE_APPROVAL_COPY.generic;
	}
	if (error.status === 400) return HYGIENE_APPROVAL_COPY.badRequest;
	return HYGIENE_APPROVAL_COPY.generic;
}

/** A failed read proves nothing was written: only a typed answer has its own copy. */
function readFailure(error: unknown): string {
	if (!isTyped(error)) return HYGIENE_APPROVAL_COPY.readFailure;
	if (error.status === 401) return HYGIENE_APPROVAL_COPY.session;
	if (error.status === 403) return HYGIENE_APPROVAL_COPY.forbidden;
	return HYGIENE_APPROVAL_COPY.unavailable;
}

/**
 * Approves one pending entry (D5). The grant hint and the confirmation are checked first. The draft is re-read under the
 * origin guard and the list must show the entry pending at the same version; every local refusal sends no write. Then
 * exactly one POST, never retried.
 */
export async function handleApproveHygieneProcedure(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<ApprovalResult> {
	const procedureId = textOf(input.procedure_id);
	const expectedVersion = textOf(input.expected_version);
	const failure = (error: string, uncertain = false): ApprovalFailure => ({ success: false, uncertain, error, procedure_id: procedureId, expected_version: expectedVersion });
	if (!teacherGrant(context.cookies, APPROVE_GRANT)) return failure(HYGIENE_APPROVAL_COPY.forbidden);
	if (input.approval_confirmed !== 'on') return failure(HYGIENE_APPROVAL_COPY.confirmation);
	const id = textOf(input.id);
	if (!validId(id) || !validId(procedureId) || !validId(expectedVersion)) return failure(HYGIENE_APPROVAL_COPY.identifierInvalid);
	let selected: ClinicalContext;
	try {
		selected = parseClinicalContext(new URLSearchParams({
			patient_id: textOf(input.patient_id), subject_id: textOf(input.subject_id), academic_group_id: textOf(input.academic_group_id),
		}));
	} catch {
		return failure(HYGIENE_APPROVAL_COPY.context);
	}
	try {
		const draft = await getHygieneDraft(id, context.cookies);
		if (draft.patient_id !== selected.patient_id || draft.origin_subject_id !== selected.subject_id || draft.origin_group_id !== selected.academic_group_id) {
			return failure(HYGIENE_APPROVAL_COPY.unavailable);
		}
		const entry = (await listHygieneProcedures(id, context.cookies)).find((item) => item.id === procedureId);
		if (!entry) return failure(HYGIENE_APPROVAL_COPY.gone);
		if (entry.status === 'approved') return failure(HYGIENE_APPROVAL_COPY.already);
		if (entry.version !== expectedVersion) return failure(HYGIENE_APPROVAL_COPY.stale);
	} catch (error) {
		return failure(readFailure(error));
	}
	try {
		await approveHygieneProcedure(id, procedureId, expectedVersion, context.cookies);
	} catch (error) {
		if (isTyped(error)) return failure(rejectionCopy(error));
		// Network, 5xx or an answer that does not confirm the approval: the write may have landed.
		return failure(HYGIENE_APPROVAL_COPY.uncertain, true);
	}
	return { success: true, id, procedure_id: procedureId, patient_id: selected.patient_id, subject_id: selected.subject_id, academic_group_id: selected.academic_group_id };
}
