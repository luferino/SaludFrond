import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import type { AssignmentListingFilters } from '../../patient-assignment/api';
import { declareHygieneConsent, getHygieneDraft, validId, type HygieneConsentDeclaration, type HygieneSignerInput } from '../api';
import { activeAssignment, contextReadFailure, isTyped, returnCoordinates, sameContext, type ActiveAssignment } from './drafts';

/** Spanish copy for the paper consent section (D3) and the dirty notice (D4). Uncertain outcomes never claim that nothing was stored. */
export const HYGIENE_CONSENT_COPY = {
	consentInput: 'Revisá los datos del consentimiento.',
	identifierInvalid: 'El borrador no es válido.',
	patientWithData: 'Si firma el paciente, dejá vacíos el nombre y el documento del firmante.',
	signerName: 'Ingresá el nombre del firmante (hasta 200 caracteres).',
	signerDocument: 'El documento del firmante debe tener entre 4 y 8 dígitos.',
	underAge: 'El paciente es menor de 18 años: debe firmar la madre, el padre o el tutor.',
	assignmentUnavailable: 'La asignación ya no está disponible. Volvé a la lista de pacientes.',
	draftUnavailable: 'El borrador no está disponible en esta asignación.',
	forbidden: 'No tenés permiso para realizar esta acción.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	badRequest: 'Revisá los datos del consentimiento.',
	generic: 'No se pudo completar la acción. Intentá nuevamente más tarde.',
	uncertain: 'No se pudo confirmar la declaración. Recargá la página y revisá el historial antes de volver a intentarlo.',
	unsavedDraft: 'Hay cambios sin guardar en el borrador. Guardalos antes de declarar el consentimiento o registrar procedimientos.',
} as const;

const PARENT_DOCUMENT = /^\d{4,8}$/;
const NAME_MAX = 200;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** The typed signer controls, kept so a rejected declaration shows what the student typed. */
export interface ConsentValues { signer: string; signer_name: string; signer_document: string }
export interface DeclareSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; list_filters?: AssignmentListingFilters; declaration: HygieneConsentDeclaration }
export interface DeclareFailure { success: false; uncertain: boolean; error: string; values: ConsentValues }
export type DeclareResult = DeclareSuccess | DeclareFailure;

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** D3 local rules, checked before any request. Blank text counts as empty; the backend re-checks every rule. */
function signerBody(input: Record<string, unknown>): { ok: true; body: HygieneSignerInput } | { ok: false; error: string } {
	const name = textOf(input.signer_name);
	const document = textOf(input.signer_document);
	if (input.signer === 'patient') {
		// A patient signer sends neither field: the server copies the patient record.
		if (name.trim() !== '' || document.trim() !== '') return { ok: false, error: HYGIENE_CONSENT_COPY.patientWithData };
		return { ok: true, body: { signer: 'patient' } };
	}
	if (input.signer !== 'parent') return { ok: false, error: HYGIENE_CONSENT_COPY.badRequest };
	if (name.trim() === '' || [...name].length > NAME_MAX || name.includes('\u0000') || LONE_SURROGATE.test(name)) {
		return { ok: false, error: HYGIENE_CONSENT_COPY.signerName };
	}
	if (!PARENT_DOCUMENT.test(document)) return { ok: false, error: HYGIENE_CONSENT_COPY.signerDocument };
	return { ok: true, body: { signer: 'parent', signer_name: name, signer_document: document } };
}

function rejectionCopy(error: ApiError): string {
	if (error.status === 401) return HYGIENE_CONSENT_COPY.session;
	if (error.status === 403) return HYGIENE_CONSENT_COPY.forbidden;
	if (error.status === 404) return HYGIENE_CONSENT_COPY.draftUnavailable;
	if (error.status !== 400) return HYGIENE_CONSENT_COPY.generic;
	if (error.message === 'a parent must sign for a patient under 18') return HYGIENE_CONSENT_COPY.underAge;
	if (error.message === 'signer_document must be 4-8 digits') return HYGIENE_CONSENT_COPY.signerDocument;
	if (error.message.startsWith('signer_name must be')) return HYGIENE_CONSENT_COPY.signerName;
	if (error.message === 'signer_name and signer_document are only accepted for a parent signer') return HYGIENE_CONSENT_COPY.patientWithData;
	return HYGIENE_CONSENT_COPY.badRequest;
}

/**
 * Declares that signed paper consent exists for the draft. Exactly one POST and never retried. The local D3 rules run
 * first, so a refused form sends nothing; the assignment and draft context are checked as the editor save does.
 */
export async function handleDeclareHygieneConsent(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<DeclareResult> {
	const id = textOf(input.id);
	const values: ConsentValues = { signer: textOf(input.signer), signer_name: textOf(input.signer_name), signer_document: textOf(input.signer_document) };
	const failure = (error: string, uncertain = false): DeclareFailure => ({ success: false, uncertain, error, values });
	if (!validId(id)) return failure(HYGIENE_CONSENT_COPY.identifierInvalid);
	if (input.paper_signed !== 'on') return failure(HYGIENE_CONSENT_COPY.consentInput);
	const signer = signerBody(input);
	if (!signer.ok) return failure(signer.error);
	let current: ActiveAssignment;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(HYGIENE_CONSENT_COPY.assignmentUnavailable);
		const draft = await getHygieneDraft(id, context.cookies);
		if (!sameContext(draft, active.assignment)) return failure(HYGIENE_CONSENT_COPY.draftUnavailable);
		current = active;
	} catch (error) {
		return failure(contextReadFailure(error));
	}
	try {
		const declaration = await declareHygieneConsent(id, signer.body, context.cookies);
		return { success: true, id, ...returnCoordinates(input, current), declaration };
	} catch (error) {
		if (isTyped(error)) return failure(rejectionCopy(error));
		return failure(HYGIENE_CONSENT_COPY.uncertain, true);
	}
}
