import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { listAssignedPatients, type AssignedPatient, type AssignmentListingFilters } from '../../patient-assignment/api';
import { parseAssignmentActionCoordinates } from '../../patient-assignment/list-coordinates';
import { declareHygieneConsent, getHygieneDraft, validId, type HygieneConsentDeclaration, type HygieneDraft, type HygieneSignerInput } from '../api';

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
	readFailure: 'No se pudo verificar el borrador. No se guardó ni se envió nada.',
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
interface ActiveAssignment { assignment: AssignedPatient; page: { limit: number; offset: number }; filters: AssignmentListingFilters }

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

/** A typed rejection proves nothing was stored; any other failure after the POST may have committed. */
function isTyped(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status);
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

function readFailure(error: unknown): string {
	if (!(error instanceof ApiError) || error.status >= 500) return HYGIENE_CONSENT_COPY.readFailure;
	if (error.status === 401) return HYGIENE_CONSENT_COPY.session;
	if (error.status === 403) return HYGIENE_CONSENT_COPY.forbidden;
	return HYGIENE_CONSENT_COPY.draftUnavailable;
}

/** The assignment must still be active in the caller's own list; the backend re-checks the write. */
async function activeAssignment(input: Record<string, unknown>, cookies: AstroCookies): Promise<ActiveAssignment | null> {
	let selected: { page: { limit: number; offset: number }; filters: AssignmentListingFilters };
	try {
		const coordinates = parseAssignmentActionCoordinates(input, true);
		selected = { page: { limit: coordinates.limit, offset: coordinates.offset }, filters: coordinates.filters };
	} catch {
		return null;
	}
	if (!validId(input.assignment_id)) return null;
	const list = await listAssignedPatients(selected.page, cookies, selected.filters);
	const assignment = list.items.find((item) => item.id === input.assignment_id && item.ended_at === null);
	return assignment ? { assignment, page: selected.page, filters: selected.filters } : null;
}

function sameContext(draft: HygieneDraft, assignment: AssignedPatient): boolean {
	return draft.patient_id === assignment.patient_id
		&& draft.origin_subject_id === assignment.subject_id
		&& draft.origin_group_id === assignment.academic_group_id;
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
		return failure(readFailure(error));
	}
	try {
		const declaration = await declareHygieneConsent(id, signer.body, context.cookies);
		return {
			success: true, id, assignment_id: current.assignment.id,
			limit: String(current.page.limit), offset: String(current.page.offset),
			...(Object.keys(input).some((key) => key.startsWith('list_')) ? { list_filters: current.filters } : {}),
			declaration,
		};
	} catch (error) {
		if (isTyped(error)) return failure(rejectionCopy(error));
		return failure(HYGIENE_CONSENT_COPY.uncertain, true);
	}
}
