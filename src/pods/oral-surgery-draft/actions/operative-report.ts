import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { parseClinicalContext, teacherGrant, type ClinicalContext } from '../../teacher-clinical/api';
import type { AssignmentListingFilters } from '../../patient-assignment/api';
import {
	closeOperativeReport,
	createOperativeReport,
	getOperativeReport,
	getOralSurgeryDraft,
	OPERATIVE_REPORT_LAYOUT,
	updateOperativeReport,
	validateOperativeReportContent,
	validId,
	type OperativeReport,
	type OperativeReportContent,
	type OperativeReportSection,
} from '../api';
import { activeAssignment, isTyped, sameContext, type ActiveAssignment, type FormValues } from './drafts';

/** Spanish copy for the operative report. Uncertain outcomes never claim that nothing was stored. */
export const OPERATIVE_REPORT_COPY = {
	formInput: 'Revisá los campos del parte quirúrgico.',
	identifierInvalid: 'El borrador, el parte o sus versiones no son válidos.',
	assignmentUnavailable: 'La asignación ya no está disponible. Volvé a la lista de pacientes.',
	draftUnavailable: 'El borrador no está disponible en esta asignación.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	forbidden: 'No tenés permiso para guardar este parte quirúrgico.',
	badRequest: 'Revisá los datos del parte quirúrgico.',
	generic: 'No se pudo completar la acción. Intentá nuevamente más tarde.',
	readFailure: 'No se pudo verificar el parte quirúrgico. No se guardó nada.',
	draftChanged: 'El borrador clínico cambió desde que abriste la página. Se muestra la versión actual; tus valores no guardados quedan abajo para copiarlos.',
	reportChanged: 'El parte quirúrgico cambió o ya fue cerrado. Se muestra la versión actual; tus valores no guardados quedan abajo para copiarlos.',
	alreadyExists: 'Ya existe un parte quirúrgico para este encuentro. Se muestra el parte guardado; tus valores no guardados quedan abajo para copiarlos.',
	authorizationRequired: 'Hace falta una autorización docente vigente para la versión actual del borrador antes de guardar el parte.',
	saveUncertain: 'No se pudo confirmar el guardado del parte quirúrgico. Recargá la página para ver la versión guardada antes de volver a intentarlo.',
} as const;

const CLOSE_COPY = {
	forbidden: 'No tenés permiso vigente para cerrar este parte quirúrgico.',
	fields: 'El formulario contiene campos no permitidos.',
	confirm: 'Confirmá que revisaste el parte y que está listo para cerrarse.',
	identifiers: 'Revisá el borrador y las versiones seleccionadas.',
	context: 'El contexto clínico no es válido.',
	unavailable: 'El parte quirúrgico no está disponible en este contexto de origen.',
	draftChanged: 'El borrador clínico cambió. Revisá la versión actual antes de cerrar.',
	reportChanged: 'El parte cambió o ya fue cerrado. Revisá la versión actual antes de cerrar.',
	closed: 'El parte quirúrgico ya está cerrado.',
	missing: 'No hay un parte quirúrgico para cerrar en este encuentro.',
	mismatch: 'El parte se guardó contra otra versión clínica. El alumno debe volver a guardarlo antes del cierre.',
	role: 'Solo un docente instructor puede cerrar el parte quirúrgico.',
	badRequest: 'La solicitud de cierre no es válida.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	conflict: 'El parte ya no admite este cierre. Actualizá la ficha antes de volver a intentarlo.',
	readFailure: 'No se pudo verificar el parte quirúrgico. No se envió ningún cierre.',
	uncertain: 'No se pudo confirmar el cierre. Actualizá la ficha antes de volver a intentarlo; no repetimos el envío automáticamente.',
} as const;

const HIDDEN_FIELDS = ['id', 'expected_draft_version', 'expected_version', 'assignment_id', 'limit', 'offset', 'list_limit', 'list_offset', 'list_patient_id', 'list_student_id', 'list_subject_id', 'list_academic_group_id'];
const CLOSE_FIELDS = ['id', 'patient_id', 'subject_id', 'academic_group_id', 'expected_version', 'expected_draft_version', 'ready_confirmed'];

/** Form control names in contract order: a top-level text, or `<section>.<field>`. */
export const OPERATIVE_REPORT_FORM_FIELDS: string[] = OPERATIVE_REPORT_LAYOUT.flatMap(({ key, fields }) =>
	fields === null ? [key] : fields.map((field) => `${key}.${field}`));

export interface ReportSaveSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; list_filters?: AssignmentListingFilters; report: OperativeReport }
/** `values` are the submitted controls, kept so the page can re-render or list them; versions are the ones submitted. */
export interface ReportSaveFailure {
	success: false; uncertain: boolean; conflict: boolean; error: string;
	expected_version: string; expected_draft_version: string; values?: FormValues;
}
export type ReportCloseResult = { success: true; id: string } & ClinicalContext | { success: false; uncertain: boolean; error: string };

class FormInputError extends Error {}

/** Form values that reproduce a stored report; absent and null both render as an empty control. */
export function operativeReportFormValues(content: OperativeReportContent): FormValues {
	const values: FormValues = {};
	for (const { key, fields } of OPERATIVE_REPORT_LAYOUT) {
		if (fields === null) {
			values[key] = typeof content[key] === 'string' ? content[key] as string : '';
			continue;
		}
		const section = content[key];
		for (const field of fields) {
			const answer = typeof section === 'object' && section !== null ? section[field] : undefined;
			values[`${key}.${field}`] = typeof answer === 'string' ? answer : '';
		}
	}
	return values;
}

function sameLines(a: string, b: string): boolean {
	const lines = (text: string) => text.replace(/\r\n|\r/g, '\n');
	return lines(a) === lines(b);
}

/** Same rule as the clinical editor: an empty control keeps absent, null or '' as stored; clearing stores null; CRLF-only changes keep the stored text. */
function answerFor(raw: string, stored: unknown): string | null | undefined {
	if (raw === '') return stored === undefined || stored === null || stored === '' ? stored as string | null | undefined : null;
	return typeof stored === 'string' && sameLines(raw, stored) ? stored : raw;
}

/** Replacement content from the submitted controls; the stored report decides what an empty control means. */
export function operativeReportContentFromForm(values: FormValues, stored: OperativeReportContent): OperativeReportContent {
	const content: OperativeReportContent = {};
	for (const { key, fields } of OPERATIVE_REPORT_LAYOUT) {
		if (fields === null) {
			const answer = answerFor(values[key] ?? '', stored[key]);
			if (answer !== undefined) content[key] = answer;
			continue;
		}
		const storedSection = typeof stored[key] === 'object' && stored[key] !== null ? stored[key] as OperativeReportSection : undefined;
		const section: OperativeReportSection = {};
		for (const field of fields) {
			const answer = answerFor(values[`${key}.${field}`] ?? '', storedSection?.[field]);
			if (answer !== undefined) section[field] = answer;
		}
		// An absent section stays absent until it gains an answer; a stored {} stays {}.
		if (storedSection !== undefined || Object.keys(section).length > 0) content[key] = section;
	}
	return validateOperativeReportContent(content);
}

/** Only report controls and hidden context are accepted; anything else is rejected before any request. */
function controlValues(input: Record<string, unknown>): FormValues {
	for (const key of Object.keys(input)) {
		if (!HIDDEN_FIELDS.includes(key) && !OPERATIVE_REPORT_FORM_FIELDS.includes(key)) throw new FormInputError(OPERATIVE_REPORT_COPY.formInput);
	}
	const values: FormValues = {};
	for (const name of OPERATIVE_REPORT_FORM_FIELDS) {
		// Astro normalizes blank optional native controls to undefined; that is an empty answer.
		const raw = input[name];
		if (raw !== undefined && typeof raw !== 'string') throw new FormInputError(OPERATIVE_REPORT_COPY.formInput);
		values[name] = raw ?? '';
	}
	return values;
}

/** Backend 409 messages of the report writes, each with its own reload guidance. */
function saveConflict(message: string): { error: string; conflict: boolean } {
	if (message === 'draft version changed; reload before saving') return { error: OPERATIVE_REPORT_COPY.draftChanged, conflict: true };
	if (message === 'operative report already exists; reload before saving') return { error: OPERATIVE_REPORT_COPY.alreadyExists, conflict: true };
	if (message === 'current instructor authorization is required') return { error: OPERATIVE_REPORT_COPY.authorizationRequired, conflict: false };
	return { error: OPERATIVE_REPORT_COPY.reportChanged, conflict: true };
}

function safeSaveError(error: ApiError): string {
	if (error.status === 401) return OPERATIVE_REPORT_COPY.session;
	if (error.status === 400) return OPERATIVE_REPORT_COPY.badRequest;
	if (error.status === 403) return OPERATIVE_REPORT_COPY.forbidden;
	if (error.status === 404) return OPERATIVE_REPORT_COPY.draftUnavailable;
	return OPERATIVE_REPORT_COPY.generic;
}

/**
 * Student save: an empty `expected_version` creates the report, otherwise it replaces it. The draft and report versions
 * are re-read first; exactly one POST or PATCH is sent and never retried.
 */
export async function handleSaveOperativeReport(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<ReportSaveSuccess | ReportSaveFailure> {
	const id = typeof input.id === 'string' ? input.id : '';
	const expectedDraftVersion = typeof input.expected_draft_version === 'string' ? input.expected_draft_version : '';
	const expectedVersion = typeof input.expected_version === 'string' ? input.expected_version : '';
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean; values?: FormValues } = {}): ReportSaveFailure => ({
		success: false, uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error,
		expected_version: expectedVersion, expected_draft_version: expectedDraftVersion, values: detail.values,
	});
	if (!validId(id) || !validId(expectedDraftVersion) || (expectedVersion !== '' && !validId(expectedVersion))) {
		return failure(OPERATIVE_REPORT_COPY.identifierInvalid);
	}
	let values: FormValues;
	try {
		values = controlValues(input);
	} catch {
		return failure(OPERATIVE_REPORT_COPY.formInput);
	}
	let current: ActiveAssignment;
	let content: OperativeReportContent;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(OPERATIVE_REPORT_COPY.assignmentUnavailable, { values });
		const draft = await getOralSurgeryDraft(id, context.cookies);
		if (!sameContext(draft, active.assignment)) return failure(OPERATIVE_REPORT_COPY.draftUnavailable, { values });
		if (draft.version !== expectedDraftVersion) return failure(OPERATIVE_REPORT_COPY.draftChanged, { conflict: true, values });
		const stored = await getOperativeReport(id, context.cookies);
		if (expectedVersion === '' && stored) return failure(OPERATIVE_REPORT_COPY.alreadyExists, { conflict: true, values });
		if (expectedVersion !== '' && (!stored || stored.status !== 'draft' || stored.version !== expectedVersion)) {
			return failure(OPERATIVE_REPORT_COPY.reportChanged, { conflict: true, values });
		}
		current = active;
		try {
			content = operativeReportContentFromForm(values, stored?.content ?? {});
		} catch (error) {
			return failure(error instanceof Error ? error.message : OPERATIVE_REPORT_COPY.formInput, { values });
		}
	} catch (error) {
		return failure(error instanceof ApiError && error.status < 500 ? safeSaveError(error) : OPERATIVE_REPORT_COPY.readFailure, { values });
	}
	try {
		const report = expectedVersion === ''
			? await createOperativeReport(id, expectedDraftVersion, content, context.cookies)
			: await updateOperativeReport(id, expectedVersion, expectedDraftVersion, content, context.cookies);
		return {
			success: true, id, assignment_id: current.assignment.id, limit: String(current.page.limit), offset: String(current.page.offset),
			...(Object.keys(input).some((key) => key.startsWith('list_')) ? { list_filters: current.filters } : {}), report,
		};
	} catch (error) {
		if (error instanceof ApiError && error.status === 409) return failure(saveConflict(error.message).error, { conflict: saveConflict(error.message).conflict, values });
		if (isTyped(error)) return failure(safeSaveError(error), { values });
		return failure(OPERATIVE_REPORT_COPY.saveUncertain, { uncertain: true, values });
	}
}

/** Typed backend rejections of the close POST; null means the outcome is unknown. */
function closeRejection(error: unknown): string | null {
	if (!(error instanceof ApiError) || !isTyped(error)) return null;
	if (error.status === 400) return CLOSE_COPY.badRequest;
	if (error.status === 401) return CLOSE_COPY.session;
	if (error.status === 403) return error.message === 'teacher instructor role required' ? CLOSE_COPY.role : CLOSE_COPY.forbidden;
	if (error.status === 404) return error.message === 'oral surgery operative report was not found' ? CLOSE_COPY.missing : CLOSE_COPY.unavailable;
	if (error.status === 409) {
		if (error.message === 'operative report does not match current clinical version; save it before closing') return CLOSE_COPY.mismatch;
		if (error.message === 'draft version changed; reload before saving') return CLOSE_COPY.draftChanged;
		if (error.message === 'operative report changed or is closed; reload before saving') return CLOSE_COPY.reportChanged;
		return CLOSE_COPY.conflict;
	}
	return null;
}

/** Teacher closure: re-read draft and report under the origin guard, then send exactly one POST with both versions. */
export async function handleCloseOperativeReport(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<ReportCloseResult> {
	const failure = (error: string, uncertain = false) => ({ success: false as const, error, uncertain });
	if (!teacherGrant(context.cookies, 'oral-surgery-drafts:close')) return failure(CLOSE_COPY.forbidden);
	if (Object.keys(input).length !== CLOSE_FIELDS.length || CLOSE_FIELDS.some((key) => !Object.hasOwn(input, key))) return failure(CLOSE_COPY.fields);
	if (input.ready_confirmed !== 'on') return failure(CLOSE_COPY.confirm);
	if (!validId(input.id) || !validId(input.expected_version) || !validId(input.expected_draft_version)) return failure(CLOSE_COPY.identifiers);
	const text = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';
	let selected: ClinicalContext;
	try {
		selected = parseClinicalContext(new URLSearchParams({ patient_id: text('patient_id'), subject_id: text('subject_id'), academic_group_id: text('academic_group_id') }));
	} catch {
		return failure(CLOSE_COPY.context);
	}
	const id = input.id;
	let writing = false;
	try {
		const draft = await getOralSurgeryDraft(id, context.cookies);
		if (draft.patient_id !== selected.patient_id || draft.origin_subject_id !== selected.subject_id || draft.origin_group_id !== selected.academic_group_id) {
			return failure(CLOSE_COPY.unavailable);
		}
		if (draft.version !== input.expected_draft_version) return failure(CLOSE_COPY.draftChanged);
		const report = await getOperativeReport(id, context.cookies);
		if (!report) return failure(CLOSE_COPY.missing);
		if (report.status === 'closed') return failure(CLOSE_COPY.closed);
		if (report.version !== input.expected_version) return failure(CLOSE_COPY.reportChanged);
		if (report.draft_version !== draft.version) return failure(CLOSE_COPY.mismatch);
		writing = true;
		await closeOperativeReport(id, input.expected_version, input.expected_draft_version, context.cookies);
		return { success: true as const, id, ...selected };
	} catch (error) {
		const rejection = closeRejection(error);
		if (rejection) return failure(rejection);
		return writing ? failure(CLOSE_COPY.uncertain, true) : failure(CLOSE_COPY.readFailure);
	}
}
