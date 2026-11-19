import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { createHygieneProcedure, deleteHygieneProcedure, getHygieneDraft, listHygieneProcedures, updateHygieneProcedure, validId, type HygieneProcedure } from '../api';
import { activeAssignment, contextReadFailure, HYGIENE_COPY, isTyped, returnCoordinates, sameContext, sameLines, type ActiveAssignment } from './drafts';

/** Spanish copy for the procedure log (D4). Uncertain outcomes never claim that nothing was stored. */
export const HYGIENE_PROCEDURE_COPY = {
	formInput: 'Revisá los datos del procedimiento.',
	badRequest: 'Revisá los datos del procedimiento.',
	identifierInvalid: 'El procedimiento o el borrador no es válido.',
	dateInvalid: 'Ingresá una fecha válida.',
	dateFuture: 'La fecha no puede ser posterior a hoy.',
	description: 'La descripción es obligatoria y admite hasta 1000 caracteres.',
	gate: 'Falta declarar el consentimiento en papel antes de registrar procedimientos.',
	stale: 'El procedimiento cambió en otra pestaña. Se muestra la versión actual; revisalo antes de volver a guardar.',
	approved: 'Este procedimiento ya fue aprobado por un docente y no se puede modificar.',
	gone: 'El procedimiento ya no está en el registro. Recargá la página para ver la lista actual.',
	createUncertain: 'No se pudo confirmar el registro. Revisá la lista antes de volver a intentarlo: cada intento puede crear una entrada nueva.',
	changeUncertain: 'No se pudo confirmar el cambio. Recargá la página antes de volver a intentarlo.',
	frameworkUncertain: 'No se pudo confirmar la operación. Recargá la página y revisá el registro antes de volver a intentarlo.',
	readFailure: 'No se pudo cargar el registro de procedimientos. El borrador se muestra igual; intentá recargar la página.',
} as const;

export type ProcedureAction = 'create' | 'update' | 'delete';
/** The typed controls of an entry, kept so a rejected submit can show them again. */
export interface ProcedureValues { procedure_date: string; description: string }
export interface ProcedureSuccess { success: true; action: ProcedureAction; id: string; assignment_id: string; limit: string; offset: string; list_filters?: ActiveAssignment['filters']; procedure_id: string }
/** `procedure_id` is empty for create; `expected_version` is the version the submit carried; `values` is absent for delete. */
export interface ProcedureFailure { success: false; action: ProcedureAction; procedure_id: string; expected_version: string; uncertain: boolean; conflict: boolean; error: string; values?: ProcedureValues }
export type ProcedureResult = ProcedureSuccess | ProcedureFailure;

const PROCEDURE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DESCRIPTION_MAX = 1000;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const STALE_MESSAGE = 'procedure entry version changed; reload before saving';

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function valuesOf(input: Record<string, unknown>): ProcedureValues {
	return { procedure_date: textOf(input.procedure_date), description: textOf(input.description) };
}

/** A date that exists in the calendar, written as YYYY-MM-DD. The future is left to the backend, which uses its own clock. */
function calendarDate(value: string): boolean {
	if (!PROCEDURE_DATE.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The same rules the API client checks before sending, so a refused form sends nothing. */
function localError(values: ProcedureValues): string | null {
	if (!calendarDate(values.procedure_date)) return HYGIENE_PROCEDURE_COPY.dateInvalid;
	const text = values.description;
	if (text.trim() === '' || [...text].length > DESCRIPTION_MAX || text.includes('\u0000') || LONE_SURROGATE.test(text)) {
		return HYGIENE_PROCEDURE_COPY.description;
	}
	return null;
}

/** Backend answers as typed copy. Messages are matched exactly; anything unknown falls back to the generic copy. */
function rejectionCopy(error: ApiError): string {
	const message = error.message;
	if (error.status === 401) return HYGIENE_COPY.session;
	if (error.status === 403) return HYGIENE_COPY.forbidden;
	if (error.status === 404) return message === 'procedure entry was not found' ? HYGIENE_PROCEDURE_COPY.gone : HYGIENE_COPY.draftUnavailable;
	if (error.status === 409) {
		if (message === 'signed paper consent is required before logging procedures') return HYGIENE_PROCEDURE_COPY.gate;
		if (message === STALE_MESSAGE) return HYGIENE_PROCEDURE_COPY.stale;
		if (message === 'approved procedure entries cannot be changed' || message === 'procedure entry is already approved') return HYGIENE_PROCEDURE_COPY.approved;
		return HYGIENE_COPY.generic;
	}
	if (error.status === 400) {
		if (message === 'procedure_date cannot be in the future') return HYGIENE_PROCEDURE_COPY.dateFuture;
		if (message === 'procedure_date must be a valid YYYY-MM-DD date') return HYGIENE_PROCEDURE_COPY.dateInvalid;
		if (message.startsWith('description must be')) return HYGIENE_PROCEDURE_COPY.description;
		return HYGIENE_PROCEDURE_COPY.badRequest;
	}
	return HYGIENE_COPY.generic;
}

/** The assignment and the draft must match the submitted context. Reads only: nothing is written here. */
async function draftContext(input: Record<string, unknown>, cookies: AstroCookies, draftId: string): Promise<{ ok: true; active: ActiveAssignment } | { ok: false; error: string }> {
	try {
		const active = await activeAssignment(input, cookies);
		if (!active) return { ok: false, error: HYGIENE_COPY.assignmentUnavailable };
		const draft = await getHygieneDraft(draftId, cookies);
		if (!sameContext(draft, active.assignment)) return { ok: false, error: HYGIENE_COPY.draftUnavailable };
		return { ok: true, active };
	} catch (error) {
		return { ok: false, error: contextReadFailure(error) };
	}
}

/**
 * Edit and delete read the current list first. A missing entry, an approved one or one at another version is refused
 * locally, so no write is sent for a state the list already proves.
 */
async function pendingEntry(
	input: Record<string, unknown>,
	cookies: AstroCookies,
	draftId: string,
	procedureId: string,
	expectedVersion: string,
): Promise<{ ok: true; active: ActiveAssignment; entry: HygieneProcedure } | { ok: false; error: string; conflict: boolean }> {
	const guard = await draftContext(input, cookies, draftId);
	if (!guard.ok) return { ok: false, error: guard.error, conflict: false };
	let entries: HygieneProcedure[];
	try {
		entries = await listHygieneProcedures(draftId, cookies);
	} catch (error) {
		return { ok: false, error: contextReadFailure(error), conflict: false };
	}
	const entry = entries.find((item) => item.id === procedureId);
	if (!entry) return { ok: false, error: HYGIENE_PROCEDURE_COPY.gone, conflict: false };
	if (entry.status === 'approved') return { ok: false, error: HYGIENE_PROCEDURE_COPY.approved, conflict: false };
	if (entry.version !== expectedVersion) return { ok: false, error: HYGIENE_PROCEDURE_COPY.stale, conflict: true };
	return { ok: true, active: guard.active, entry };
}

function successOf(action: ProcedureAction, input: Record<string, unknown>, active: ActiveAssignment, draftId: string, procedureId: string): ProcedureSuccess {
	return { success: true, action, id: draftId, ...returnCoordinates(input, active), procedure_id: procedureId };
}

/** One POST per submit, never retried. Refused locally: an invalid date or text. */
export async function handleCreateHygieneProcedure(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<ProcedureResult> {
	const draftId = textOf(input.id);
	const values = valuesOf(input);
	const failure = (error: string, uncertain = false): ProcedureFailure => ({
		success: false, action: 'create', procedure_id: '', expected_version: '', uncertain, conflict: false, error, values,
	});
	if (!validId(draftId)) return failure(HYGIENE_PROCEDURE_COPY.identifierInvalid);
	const local = localError(values);
	if (local) return failure(local);
	const guard = await draftContext(input, context.cookies, draftId);
	if (!guard.ok) return failure(guard.error);
	try {
		await createHygieneProcedure(draftId, { procedure_date: values.procedure_date, description: values.description }, context.cookies);
		return successOf('create', input, guard.active, draftId, '');
	} catch (error) {
		if (isTyped(error)) return failure(rejectionCopy(error));
		return failure(HYGIENE_PROCEDURE_COPY.createUncertain, true);
	}
}

/** One PATCH per submit, after the local checks. A description that only changed its line breaks keeps the stored text. */
export async function handleUpdateHygieneProcedure(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<ProcedureResult> {
	const draftId = textOf(input.id);
	const procedureId = textOf(input.procedure_id);
	const expectedVersion = textOf(input.expected_version);
	const values = valuesOf(input);
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean } = {}): ProcedureFailure => ({
		success: false, action: 'update', procedure_id: procedureId, expected_version: expectedVersion,
		uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error, values,
	});
	if (!validId(draftId) || !validId(procedureId) || !validId(expectedVersion)) return failure(HYGIENE_PROCEDURE_COPY.identifierInvalid);
	const local = localError(values);
	if (local) return failure(local);
	const guard = await pendingEntry(input, context.cookies, draftId, procedureId, expectedVersion);
	if (!guard.ok) return failure(guard.error, { conflict: guard.conflict });
	const description = sameLines(values.description, guard.entry.description) ? guard.entry.description : values.description;
	try {
		await updateHygieneProcedure(draftId, procedureId, expectedVersion, { procedure_date: values.procedure_date, description }, context.cookies);
		return successOf('update', input, guard.active, draftId, procedureId);
	} catch (error) {
		if (isTyped(error)) return failure(rejectionCopy(error), { conflict: error.status === 409 && error.message === STALE_MESSAGE });
		return failure(HYGIENE_PROCEDURE_COPY.changeUncertain, { uncertain: true });
	}
}

/** One DELETE per submit, after the same list checks as edit. */
export async function handleDeleteHygieneProcedure(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<ProcedureResult> {
	const draftId = textOf(input.id);
	const procedureId = textOf(input.procedure_id);
	const expectedVersion = textOf(input.expected_version);
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean } = {}): ProcedureFailure => ({
		success: false, action: 'delete', procedure_id: procedureId, expected_version: expectedVersion,
		uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error,
	});
	if (!validId(draftId) || !validId(procedureId) || !validId(expectedVersion)) return failure(HYGIENE_PROCEDURE_COPY.identifierInvalid);
	const guard = await pendingEntry(input, context.cookies, draftId, procedureId, expectedVersion);
	if (!guard.ok) return failure(guard.error, { conflict: guard.conflict });
	try {
		await deleteHygieneProcedure(draftId, procedureId, expectedVersion, context.cookies);
		return successOf('delete', input, guard.active, draftId, procedureId);
	} catch (error) {
		if (isTyped(error)) return failure(rejectionCopy(error), { conflict: error.status === 409 && error.message === STALE_MESSAGE });
		return failure(HYGIENE_PROCEDURE_COPY.changeUncertain, { uncertain: true });
	}
}
