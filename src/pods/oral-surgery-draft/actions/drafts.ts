import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { listAssignedPatients, parseAssignmentPagination, type AssignedPatient } from '../../patient-assignment/api';
import {
	createOralSurgeryDraft,
	declarePaperConsent,
	getOralSurgeryDraft,
	ORAL_SURGERY_SECTIONS,
	updateOralSurgeryDraft,
	validateOralSurgeryContent,
	validId,
	type AuthorizationHistory,
	type ConsentDeclaration,
	type OralSurgeryContent,
	type OralSurgeryContext,
	type OralSurgeryDraft,
	type OralSurgerySection,
	type OralSurgerySectionName,
} from '../api';

export type FormValues = Record<string, string>;
type AnswerKind = 'date' | 'boolean' | 'text';
type Answer = boolean | string | null;
export interface FormControl { section: OralSurgerySectionName | null; field: string; kind: AnswerKind }
interface Pagination { limit: number; offset: number }
interface ActiveAssignment { assignment: AssignedPatient; page: Pagination }

/** Spanish copy for the student editor. Uncertain outcomes never claim that nothing was stored. */
export const ORAL_SURGERY_COPY = {
	formInput: 'Revisá los campos del formulario.',
	identifierInvalid: 'El borrador o su versión no es válido.',
	contextInvalid: 'Revisá el contexto de paciente, asignatura y grupo.',
	assignmentUnavailable: 'La asignación ya no está disponible. Volvé a la lista de pacientes.',
	assignmentMismatch: 'La asignación ya no coincide con este paciente y su contexto.',
	draftUnavailable: 'El borrador no está disponible en esta asignación.',
	patientUnavailable: 'El paciente no está disponible en este contexto.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	forbidden: 'No tenés permiso para realizar esta acción.',
	badRequest: 'Revisá los datos del borrador.',
	generic: 'No se pudo completar la acción. Intentá nuevamente más tarde.',
	readFailure: 'No se pudo verificar el borrador. No se guardó ni se envió nada.',
	conflict: 'Otra pestaña o persona guardó una versión más nueva. Se muestra la versión actual; tus valores no guardados quedan abajo para copiarlos.',
	saveUncertain: 'No se pudo confirmar el guardado. Recargá la página para ver la versión guardada antes de volver a editar.',
	declareMissingConfirmation: 'Confirmá que el paciente firmó el consentimiento en papel.',
	declareConflict: 'El borrador cambió desde que lo abriste. Recargá la página antes de declarar el consentimiento.',
	declareUncertain: 'No se pudo confirmar la declaración. Recargá la página y revisá el historial antes de volver a intentarlo.',
	createUncertain: 'No se pudo confirmar la creación del borrador. Revisá la lista de borradores antes de volver a intentarlo: cada intento puede crear un encuentro nuevo.',
	editable: 'Podés editar este borrador. Cada guardado reemplaza todo el contenido y exige una nueva autorización docente.',
	readOnly: 'Este borrador se muestra en modo de solo lectura. Solo su autor, con permiso de escritura, puede editarlo; el servicio vuelve a comprobarlo al guardar.',
} as const;

const HIDDEN_FIELDS = ['id', 'expected_version', 'assignment_id', 'limit', 'offset'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Editor sections in contract order, each with its Yes/No and free-text field names. */
export const ORAL_SURGERY_FORM_SECTIONS = (Object.keys(ORAL_SURGERY_SECTIONS) as OralSurgerySectionName[]).map((section) => {
	const { booleans, texts } = ORAL_SURGERY_SECTIONS[section] as { booleans: readonly string[]; texts: readonly string[] };
	return { section, booleans: [...booleans], texts: [...texts] };
});

/** Every editable control keyed by its form name: `<section>.<field>`, or `admission_date` at the content root. */
export const ORAL_SURGERY_FORM_CONTROLS: ReadonlyMap<string, FormControl> = (() => {
	const controls = new Map<string, FormControl>([['admission_date', { section: null, field: 'admission_date', kind: 'date' }]]);
	for (const { section, booleans, texts } of ORAL_SURGERY_FORM_SECTIONS) {
		for (const field of booleans) controls.set(`${section}.${field}`, { section, field, kind: 'boolean' });
		for (const field of texts) controls.set(`${section}.${field}`, { section, field, kind: 'text' });
	}
	return controls;
})();

/** Names the registry schema must accept; the page renders one control per name. */
export const ORAL_SURGERY_FORM_FIELDS: string[] = [...ORAL_SURGERY_FORM_CONTROLS.keys()];

export interface SaveSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; draft: OralSurgeryDraft }
/** `values` are the submitted controls, kept so the page can re-render them; `expected_version` is the version the student submitted. */
export interface SaveFailure { success: false; uncertain: boolean; conflict: boolean; error: string; expected_version: string; values?: FormValues }
export type SaveResult = SaveSuccess | SaveFailure;
export interface DeclareSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; declaration: ConsentDeclaration }
export interface DeclareFailure { success: false; uncertain: boolean; error: string }
export interface CreateSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; draft: OralSurgeryDraft }
export interface CreateFailure { success: false; uncertain: boolean; error: string }

class FormInputError extends Error {}

function answerText(value: Answer | undefined): string {
	return value === true ? 'true' : value === false ? 'false' : '';
}

/** Form values that reproduce a stored content in the editor; absent and null answers both render as unanswered. */
export function formValuesFromContent(content: OralSurgeryContent): FormValues {
	const values: FormValues = { admission_date: content.admission_date ?? '' };
	for (const { section, booleans, texts } of ORAL_SURGERY_FORM_SECTIONS) {
		const stored = content[section];
		for (const field of booleans) values[`${section}.${field}`] = answerText(stored?.[field]);
		for (const field of texts) {
			const answer = stored?.[field];
			values[`${section}.${field}`] = typeof answer === 'string' ? answer : '';
		}
	}
	return values;
}

/**
 * Textarea body for a stored text. The HTML parser drops one line break right after `<textarea>`, so a leading
 * line break is added to keep a stored leading line break.
 */
export function oralSurgeryTextareaText(value: string): string {
	return `\n${value}`;
}

function sameLines(a: string, b: string): boolean {
	const lines = (text: string) => text.replace(/\r\n|\r/g, '\n');
	return lines(a) === lines(b);
}

/**
 * Empty controls keep an absent, null or '' answer exactly as stored; a cleared answer becomes null.
 * Browsers submit textarea line breaks as CRLF, so text that differs from the stored one only in line
 * endings keeps the stored text.
 */
function answerFor(raw: string, kind: AnswerKind, stored: unknown): Answer | undefined {
	if (raw === '') {
		return stored === undefined || stored === null || stored === '' ? (stored as Answer | undefined) : null;
	}
	if (kind === 'boolean') return raw === 'true';
	return typeof stored === 'string' && sameLines(raw, stored) ? stored : raw;
}

/** Replacement content from the submitted controls. The stored draft decides what an empty control means. */
export function oralSurgeryContentFromForm(values: FormValues, stored: OralSurgeryContent): OralSurgeryContent {
	const content: Record<string, unknown> = {};
	const admission = answerFor(values.admission_date ?? '', 'date', stored.admission_date);
	if (admission !== undefined) content.admission_date = admission;
	for (const { section, booleans, texts } of ORAL_SURGERY_FORM_SECTIONS) {
		const storedSection: OralSurgerySection | undefined = stored[section];
		const fields: OralSurgerySection = {};
		const put = (field: string, kind: AnswerKind) => {
			const answer = answerFor(values[`${section}.${field}`] ?? '', kind, storedSection?.[field]);
			if (answer !== undefined) fields[field] = answer;
		};
		booleans.forEach((field) => put(field, 'boolean'));
		texts.forEach((field) => put(field, 'text'));
		// An absent section stays absent until it gains an answer; a stored {} stays {}.
		if (storedSection !== undefined || Object.keys(fields).length > 0) content[section] = fields;
	}
	return validateOralSurgeryContent(content);
}

/** Read-only status line: a current authorization counts only for the exact version shown. */
export function authorizationStatusLine(history: AuthorizationHistory, version: string): string {
	const current = history.authorizations.find((item) => item.id === history.current_authorization_id);
	return current?.draft_version === version
		? `Autorización docente vigente para la versión ${version}`
		: `Sin autorización docente vigente para la versión guardada (${version}). Cada guardado exige una nueva autorización.`;
}

/** Only the submitted controls are read; hidden context fields and unknown names are rejected before any request. */
function controlValues(input: Record<string, unknown>): FormValues {
	for (const key of Object.keys(input)) {
		if (!HIDDEN_FIELDS.includes(key) && !ORAL_SURGERY_FORM_CONTROLS.has(key)) throw new FormInputError(ORAL_SURGERY_COPY.formInput);
	}
	const values: FormValues = {};
	for (const [name, control] of ORAL_SURGERY_FORM_CONTROLS) {
		// Astro normalizes blank optional native controls to undefined; that is an empty answer.
		const raw = input[name];
		if (raw !== undefined && typeof raw !== 'string') throw new FormInputError(ORAL_SURGERY_COPY.formInput);
		const value = raw ?? '';
		if (control.kind === 'boolean' && !['', 'true', 'false'].includes(value)) throw new FormInputError(ORAL_SURGERY_COPY.formInput);
		values[name] = value;
	}
	return values;
}

function safeError(error: ApiError, notFound: string = ORAL_SURGERY_COPY.draftUnavailable): string {
	if (error.status === 401) return ORAL_SURGERY_COPY.session;
	if (error.status === 400) return ORAL_SURGERY_COPY.badRequest;
	if (error.status === 403) return ORAL_SURGERY_COPY.forbidden;
	if (error.status === 404) return notFound;
	return ORAL_SURGERY_COPY.generic;
}

/** A typed rejection proves nothing was stored; any other failure after a write may have committed. */
function isTyped(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status);
}

function readFailure(error: unknown): string {
	return error instanceof ApiError && error.status < 500 ? safeError(error) : ORAL_SURGERY_COPY.readFailure;
}

function pagination(input: Record<string, unknown>): Pagination | null {
	try {
		return parseAssignmentPagination(new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) }));
	} catch {
		return null;
	}
}

/** The assignment must still be active in the caller's own list; the backend re-checks every write. */
async function activeAssignment(input: Record<string, unknown>, cookies: AstroCookies): Promise<ActiveAssignment | null> {
	const page = pagination(input);
	if (!page || !validId(input.assignment_id)) return null;
	const list = await listAssignedPatients(page, cookies);
	const assignment = list.items.find((item) => item.id === input.assignment_id && item.ended_at === null);
	return assignment ? { assignment, page } : null;
}

function contextOf(assignment: AssignedPatient): OralSurgeryContext {
	return { patient_id: assignment.patient_id, subject_id: assignment.subject_id, academic_group_id: assignment.academic_group_id };
}

function sameContext(draft: OralSurgeryDraft, assignment: AssignedPatient): boolean {
	return draft.patient_id === assignment.patient_id
		&& draft.origin_subject_id === assignment.subject_id
		&& draft.origin_group_id === assignment.academic_group_id;
}

function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

/** One PATCH per submission, only after the draft's version and context are confirmed. Never retried. */
export async function handleUpdateOralSurgeryDraft(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<SaveResult> {
	const id = typeof input.id === 'string' ? input.id : '';
	const expectedVersion = typeof input.expected_version === 'string' ? input.expected_version : '';
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean; values?: FormValues } = {}): SaveFailure => ({
		success: false, uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error, expected_version: expectedVersion, values: detail.values,
	});
	if (!validId(id) || !validId(expectedVersion)) return failure(ORAL_SURGERY_COPY.identifierInvalid);
	let values: FormValues;
	try {
		values = controlValues(input);
	} catch (error) {
		return failure(error instanceof FormInputError ? error.message : ORAL_SURGERY_COPY.formInput);
	}
	let current: ActiveAssignment;
	let content: OralSurgeryContent;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(ORAL_SURGERY_COPY.assignmentUnavailable, { values });
		const draft = await getOralSurgeryDraft(id, context.cookies);
		if (!sameContext(draft, active.assignment)) return failure(ORAL_SURGERY_COPY.draftUnavailable, { values });
		if (draft.version !== expectedVersion) return failure(ORAL_SURGERY_COPY.conflict, { conflict: true, values });
		current = active;
		try {
			content = oralSurgeryContentFromForm(values, draft.content);
		} catch (error) {
			return failure(error instanceof Error ? error.message : ORAL_SURGERY_COPY.formInput, { values });
		}
	} catch (error) {
		return failure(readFailure(error), { values });
	}
	try {
		const saved = await updateOralSurgeryDraft(id, expectedVersion, content, contextOf(current.assignment), context.cookies);
		return {
			success: true, id: saved.id, assignment_id: current.assignment.id,
			limit: String(current.page.limit), offset: String(current.page.offset), draft: saved,
		};
	} catch (error) {
		if (error instanceof ApiError && error.status === 409) return failure(ORAL_SURGERY_COPY.conflict, { conflict: true, values });
		if (isTyped(error)) return failure(safeError(error), { values });
		return failure(ORAL_SURGERY_COPY.saveUncertain, { uncertain: true, values });
	}
}

/** One POST declaring that signed paper consent exists for the saved version. Never retried. */
export async function handleDeclareOralSurgeryConsent(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<DeclareSuccess | DeclareFailure> {
	const id = typeof input.id === 'string' ? input.id : '';
	const expectedVersion = typeof input.expected_version === 'string' ? input.expected_version : '';
	const failure = (error: string, uncertain = false): DeclareFailure => ({ success: false, uncertain, error });
	if (!validId(id) || !validId(expectedVersion)) return failure(ORAL_SURGERY_COPY.identifierInvalid);
	if (input.paper_signed !== 'on') return failure(ORAL_SURGERY_COPY.declareMissingConfirmation);
	let current: ActiveAssignment;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(ORAL_SURGERY_COPY.assignmentUnavailable);
		const draft = await getOralSurgeryDraft(id, context.cookies);
		if (!sameContext(draft, active.assignment)) return failure(ORAL_SURGERY_COPY.draftUnavailable);
		if (draft.version !== expectedVersion) return failure(ORAL_SURGERY_COPY.declareConflict);
		current = active;
	} catch (error) {
		return failure(readFailure(error));
	}
	try {
		const declaration = await declarePaperConsent(id, expectedVersion, context.cookies);
		return {
			success: true, id, assignment_id: current.assignment.id,
			limit: String(current.page.limit), offset: String(current.page.offset), declaration,
		};
	} catch (error) {
		if (error instanceof ApiError && error.status === 409) return failure(ORAL_SURGERY_COPY.declareConflict);
		if (isTyped(error)) return failure(safeError(error));
		return failure(ORAL_SURGERY_COPY.declareUncertain, true);
	}
}

/** One POST per deliberate creation; each call starts a new encounter, so the result is never retried. */
export async function handleCreateOralSurgeryDraft(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<CreateSuccess | CreateFailure> {
	const failure = (error: string, uncertain = false): CreateFailure => ({ success: false, uncertain, error });
	if (!isUuid(input.patient_id) || !isUuid(input.subject_id) || !isUuid(input.academic_group_id)) return failure(ORAL_SURGERY_COPY.contextInvalid);
	let current: ActiveAssignment;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(ORAL_SURGERY_COPY.assignmentUnavailable);
		const { assignment } = active;
		if (assignment.patient_id !== input.patient_id || assignment.subject_id !== input.subject_id || assignment.academic_group_id !== input.academic_group_id) {
			return failure(ORAL_SURGERY_COPY.assignmentMismatch);
		}
		current = active;
	} catch (error) {
		return failure(readFailure(error));
	}
	try {
		const draft = await createOralSurgeryDraft({ ...contextOf(current.assignment), content: {} }, context.cookies);
		return {
			success: true, id: draft.id, assignment_id: current.assignment.id,
			limit: String(current.page.limit), offset: String(current.page.offset), draft,
		};
	} catch (error) {
		if (isTyped(error)) return failure(safeError(error, ORAL_SURGERY_COPY.patientUnavailable));
		return failure(ORAL_SURGERY_COPY.createUncertain, true);
	}
}
