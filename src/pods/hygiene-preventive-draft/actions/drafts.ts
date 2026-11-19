import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { listAssignedPatients, type AssignedPatient } from '../../patient-assignment/api';
import { parseAssignmentActionCoordinates } from '../../patient-assignment/list-coordinates';
import {
	createHygieneDraft,
	FDI_TEETH,
	getHygieneDraft,
	HYGIENE_INDICES,
	HYGIENE_MEDICAL_QUESTIONS,
	HYGIENE_MEDICAL_TEXTS,
	TOOTH_FACES,
	TOOTH_STATES,
	FACE_MARKS,
	updateHygieneDraft,
	validateHygieneContent,
	validId,
	writableHygieneContent,
	type FaceMark,
	type HygieneContent,
	type HygieneContext,
	type HygieneDraft,
	type HygieneIndex,
	type HygieneIndexName,
	type ToothFace,
	type ToothRecord,
	type ToothState,
} from '../api';
import {
	FACE_MARK_LABELS, HYGIENE_COMPONENT_LABELS, HYGIENE_DETAIL_LABEL, HYGIENE_INDEX_LABELS, HYGIENE_QUESTION_LABELS, HYGIENE_TEXT_LABELS,
	TOOTH_FACE_LABELS, TOOTH_STATE_LABELS,
} from '../labels';

/** Submitted controls: one string per select, radio, text or number control; one array of marks per face. */
export type FormValues = Record<string, string | string[]>;
export interface ActiveAssignment { assignment: AssignedPatient; page: { limit: number; offset: number }; filters: import('../../patient-assignment/api').AssignmentListingFilters }

/** Spanish copy for the student editor. Uncertain outcomes never claim that nothing was stored. */
export const HYGIENE_COPY = {
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
	createUncertain: 'No se pudo confirmar la creación del borrador. Revisá la lista de borradores antes de volver a intentarlo: cada intento puede crear un encuentro nuevo.',
	editable: 'Podés editar este borrador. Cada guardado reemplaza todo el contenido del borrador.',
	readOnly: 'Este borrador se muestra en modo de solo lectura. Solo su autor, con permiso de escritura, puede editarlo; el servicio vuelve a comprobarlo al guardar.',
	toothWithoutState: (code: string) => `La pieza ${code} tiene caras marcadas y no tiene estado. Elegí presente, ausente o a extraer, o desmarcá sus caras.`,
	absentWithMarks: (code: string) => `La pieza ${code} está ausente y no puede tener caras marcadas. Desmarcá sus caras o cambiá el estado.`,
	indexPartial: (label: string) => `Completá los tres valores del índice ${label} o dejalos vacíos.`,
	indexNumber: (label: string, component: string) => `${label}: ${component} debe ser un número entero mayor o igual a 0.`,
} as const;

const HIDDEN_FIELDS = ['id', 'expected_version', 'assignment_id', 'limit', 'offset', 'list_limit', 'list_offset', 'list_patient_id', 'list_student_id', 'list_subject_id', 'list_academic_group_id'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDICAL_ANSWERS: readonly string[] = ['', 'true', 'false'];
const STATE_CONTROLS: readonly string[] = ['', ...TOOTH_STATES];

/** Medical history controls in form order: each answer, then its `<name>_detail` text; then the free-text fields. */
const MEDICAL_FIELDS = [
	...HYGIENE_MEDICAL_QUESTIONS.flatMap((question) => [`medical_history.${question}`, `medical_history.${question}_detail`]),
	...HYGIENE_MEDICAL_TEXTS.map((field) => `medical_history.${field}`),
];
/** Face checkboxes: one name per face with values `caries` and/or `filled`, so the registry accepts several values. */
export const HYGIENE_MARK_FIELDS: string[] = FDI_TEETH.flatMap((code) => TOOTH_FACES.map((face) => `odontogram.${code}.${face}`));
const TOOTH_FIELDS = FDI_TEETH.flatMap((code) => [`odontogram.${code}.state`, ...TOOTH_FACES.map((face) => `odontogram.${code}.${face}`)]);
const INDEX_FIELDS = Object.entries(HYGIENE_INDICES).flatMap(([name, { components }]) => components.map((component) => `indices.${name}.${component}`));
/** Every editable control name. The registry builds its schema from this list and from HYGIENE_MARK_FIELDS. */
export const HYGIENE_FORM_FIELDS: string[] = [...MEDICAL_FIELDS, ...TOOTH_FIELDS, ...INDEX_FIELDS];
const FORM_FIELD_SET = new Set(HYGIENE_FORM_FIELDS);
const MARK_FIELD_SET = new Set(HYGIENE_MARK_FIELDS);
const ANSWER_FIELD_SET = new Set(HYGIENE_MEDICAL_QUESTIONS.map((question) => `medical_history.${question}`));
const STATE_FIELD_SET = new Set(FDI_TEETH.map((code) => `odontogram.${code}.state`));

/** Labels of every control, so a retained value can be listed with its question or tooth. */
export const HYGIENE_CONTROL_LABELS = new Map<string, string>();
for (const question of HYGIENE_MEDICAL_QUESTIONS) {
	HYGIENE_CONTROL_LABELS.set(`medical_history.${question}`, HYGIENE_QUESTION_LABELS[question]);
	HYGIENE_CONTROL_LABELS.set(`medical_history.${question}_detail`, `${HYGIENE_QUESTION_LABELS[question]} · ${HYGIENE_DETAIL_LABEL}`);
}
for (const field of HYGIENE_MEDICAL_TEXTS) HYGIENE_CONTROL_LABELS.set(`medical_history.${field}`, HYGIENE_TEXT_LABELS[field]);
for (const code of FDI_TEETH) {
	HYGIENE_CONTROL_LABELS.set(`odontogram.${code}.state`, `Pieza ${code} · Estado`);
	for (const face of TOOTH_FACES) HYGIENE_CONTROL_LABELS.set(`odontogram.${code}.${face}`, `Pieza ${code} · ${TOOTH_FACE_LABELS[face]}`);
}
for (const [name, { components }] of Object.entries(HYGIENE_INDICES)) {
	for (const component of components) {
		HYGIENE_CONTROL_LABELS.set(`indices.${name}.${component}`, `${HYGIENE_INDEX_LABELS[name as keyof typeof HYGIENE_INDEX_LABELS]} · ${HYGIENE_COMPONENT_LABELS[component]}`);
	}
}

/** Answered controls only: an empty control has nothing to copy. */
export function hygieneUnsavedEntries(values: FormValues | undefined): { label: string; value: string }[] {
	return Object.entries(values ?? {}).flatMap(([name, value]) => {
		const label = HYGIENE_CONTROL_LABELS.get(name);
		if (!label) return [];
		let shown: string;
		if (Array.isArray(value)) shown = value.map((mark) => FACE_MARK_LABELS[mark as keyof typeof FACE_MARK_LABELS]).join(', ');
		else if (name.endsWith('.state')) shown = value === '' ? '' : TOOTH_STATE_LABELS[value as keyof typeof TOOTH_STATE_LABELS];
		else if (value === 'true') shown = 'Sí';
		else if (value === 'false') shown = 'No';
		else shown = value;
		return shown === '' ? [] : [{ label, value: shown }];
	});
}

/** Textarea body for a stored text. The HTML parser drops one line break right after `<textarea>`, so one is added. */
export function hygieneTextareaText(value: string): string {
	return `\n${value}`;
}

function sameLines(a: string, b: string): boolean {
	const lines = (text: string) => text.replace(/\r\n|\r/g, '\n');
	return lines(a) === lines(b);
}

function answerText(value: boolean | string | null | undefined): string {
	return value === true ? 'true' : value === false ? 'false' : '';
}

function textOf(value: boolean | string | null | undefined): string {
	return typeof value === 'string' ? value : '';
}

/** Form values that reproduce a stored content in the editor; absent and null answers both render as unanswered. */
export function formValuesFromHygieneContent(content: HygieneContent): FormValues {
	const values: FormValues = {};
	const medical = content.medical_history ?? {};
	for (const question of HYGIENE_MEDICAL_QUESTIONS) {
		values[`medical_history.${question}`] = answerText(medical[question]);
		values[`medical_history.${question}_detail`] = textOf(medical[`${question}_detail`]);
	}
	for (const field of HYGIENE_MEDICAL_TEXTS) values[`medical_history.${field}`] = textOf(medical[field]);
	for (const code of FDI_TEETH) {
		const tooth = content.odontogram?.[code];
		values[`odontogram.${code}.state`] = tooth?.state ?? '';
		for (const face of TOOTH_FACES) values[`odontogram.${code}.${face}`] = [...(tooth?.surfaces?.[face] ?? [])];
	}
	for (const [name, { components }] of Object.entries(HYGIENE_INDICES)) {
		const index = content.indices?.[name as HygieneIndexName];
		for (const component of components) values[`indices.${name}.${component}`] = index ? String(index[component]) : '';
	}
	return values;
}

function raw(values: FormValues, name: string): string {
	const value = values[name];
	return typeof value === 'string' ? value : '';
}

/** Marks in caries, filled order; anything else was refused by the registry before the handler ran. */
function marksOf(values: FormValues, name: string): FaceMark[] {
	const value = values[name];
	const submitted = Array.isArray(value) ? value : [];
	return FACE_MARKS.filter((mark) => submitted.includes(mark));
}

/** A medical answer: a submitted Yes or No, otherwise a stored absent, null or '' is kept and a stored Yes or No becomes null. */
function answerFromForm(value: string, stored: unknown): boolean | string | null | undefined {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return stored === undefined || stored === null || stored === '' ? (stored as null | undefined | '') : null;
}

/** Text as typed; a line break the browser changed to CRLF keeps the stored text, an empty control follows answerFromForm. */
function textFromForm(value: string, stored: unknown): string | null | undefined {
	if (value !== '') return typeof stored === 'string' && sameLines(value, stored) ? stored : value;
	return stored === undefined || stored === null || stored === '' ? (stored as null | undefined | '') : null;
}

function medicalFromForm(values: FormValues, stored: HygieneContent['medical_history']): HygieneContent['medical_history'] {
	const section: Record<string, boolean | string | null> = {};
	const put = (key: string, answer: boolean | string | null | undefined) => {
		if (answer !== undefined) section[key] = answer;
	};
	for (const question of HYGIENE_MEDICAL_QUESTIONS) {
		put(question, answerFromForm(raw(values, `medical_history.${question}`), stored?.[question]));
		put(`${question}_detail`, textFromForm(raw(values, `medical_history.${question}_detail`), stored?.[`${question}_detail`]));
	}
	for (const field of HYGIENE_MEDICAL_TEXTS) put(field, textFromForm(raw(values, `medical_history.${field}`), stored?.[field]));
	// An absent section stays absent until it gains an answer; a stored {} stays {}.
	return stored === undefined && Object.keys(section).length === 0 ? undefined : section;
}

function odontogramFromForm(values: FormValues, stored: HygieneContent['odontogram']): HygieneContent['odontogram'] {
	const teeth: Record<string, ToothRecord> = {};
	for (const code of FDI_TEETH) {
		const state = raw(values, `odontogram.${code}.state`);
		const marked = TOOTH_FACES.flatMap((face) => {
			const marks = marksOf(values, `odontogram.${code}.${face}`);
			return marks.length > 0 ? [[face, marks] as const] : [];
		});
		if (!STATE_CONTROLS.includes(state)) throw new Error(HYGIENE_COPY.formInput);
		// An unrecorded tooth is omitted; marks on it would be lost, so they are refused instead.
		if (state === '') {
			if (marked.length > 0) throw new Error(HYGIENE_COPY.toothWithoutState(code));
			continue;
		}
		if (state === 'absent' && marked.length > 0) throw new Error(HYGIENE_COPY.absentWithMarks(code));
		const tooth: ToothRecord = { state: state as ToothState };
		const storedTooth = stored?.[code];
		if (marked.length > 0) tooth.surfaces = Object.fromEntries(marked) as Partial<Record<ToothFace, FaceMark[]>>;
		else if (storedTooth && Object.hasOwn(storedTooth, 'surfaces')) tooth.surfaces = {};
		teeth[code] = tooth;
	}
	return stored === undefined && Object.keys(teeth).length === 0 ? undefined : teeth;
}

function indicesFromForm(values: FormValues, stored: HygieneContent['indices']): HygieneContent['indices'] {
	const output: Partial<Record<HygieneIndexName, HygieneIndex | null>> = {};
	for (const [name, { components }] of Object.entries(HYGIENE_INDICES) as [HygieneIndexName, { components: readonly string[] }][]) {
		const entries = components.map((component) => [component, raw(values, `indices.${name}.${component}`)] as const);
		const filled = entries.filter(([, value]) => value !== '').length;
		// All empty: an absent index stays absent, a stored null stays null and a loaded index is cleared to null.
		if (filled === 0) {
			if (stored?.[name] !== undefined) output[name] = null;
			continue;
		}
		const label = HYGIENE_INDEX_LABELS[name];
		if (filled < components.length) throw new Error(HYGIENE_COPY.indexPartial(label));
		const loaded: HygieneIndex = {};
		for (const [component, value] of entries) {
			if (!/^\d+$/.test(value)) throw new Error(HYGIENE_COPY.indexNumber(label, HYGIENE_COMPONENT_LABELS[component]));
			loaded[component] = Number(value);
		}
		output[name] = loaded;
	}
	return stored === undefined && Object.keys(output).length === 0 ? undefined : output;
}

/**
 * Replacement content from the submitted controls, mapped against the stored draft (D3). Totals never appear: the
 * baseline comes from writableHygieneContent, and the mapping only writes components.
 */
export function hygieneContentFromForm(values: FormValues, stored: HygieneContent): HygieneContent {
	const content: HygieneContent = {};
	const medical = medicalFromForm(values, stored.medical_history);
	if (medical !== undefined) content.medical_history = medical;
	const odontogram = odontogramFromForm(values, stored.odontogram);
	if (odontogram !== undefined) content.odontogram = odontogram;
	const indices = indicesFromForm(values, stored.indices);
	if (indices !== undefined) content.indices = indices;
	// The form has no plaque controls yet: the stored plaque is carried over exactly as it was read, and an absent one stays absent.
	if (stored.plaque !== undefined) content.plaque = stored.plaque;
	return validateHygieneContent(content);
}

/** Only the submitted controls are read; hidden context fields are allowed and unknown names are refused. */
class FormInputError extends Error {}
function controlValues(input: Record<string, unknown>): FormValues {
	for (const key of Object.keys(input)) {
		if (!HIDDEN_FIELDS.includes(key) && !FORM_FIELD_SET.has(key)) throw new FormInputError(HYGIENE_COPY.formInput);
	}
	const values: FormValues = {};
	for (const name of HYGIENE_FORM_FIELDS) {
		const value = input[name];
		if (MARK_FIELD_SET.has(name)) {
			if (value === undefined) {
				values[name] = [];
				continue;
			}
			if (!Array.isArray(value) || !value.every((mark) => typeof mark === 'string' && (FACE_MARKS as readonly string[]).includes(mark))) {
				throw new FormInputError(HYGIENE_COPY.formInput);
			}
			values[name] = [...value];
			continue;
		}
		if (value !== undefined && typeof value !== 'string') throw new FormInputError(HYGIENE_COPY.formInput);
		// Astro normalizes blank optional native controls to undefined; that is an empty answer.
		const text = value ?? '';
		if (ANSWER_FIELD_SET.has(name) && !MEDICAL_ANSWERS.includes(text)) throw new FormInputError(HYGIENE_COPY.formInput);
		if (STATE_FIELD_SET.has(name) && !STATE_CONTROLS.includes(text)) throw new FormInputError(HYGIENE_COPY.formInput);
		values[name] = text;
	}
	return values;
}

function safeError(error: ApiError, notFound: string = HYGIENE_COPY.draftUnavailable): string {
	if (error.status === 401) return HYGIENE_COPY.session;
	if (error.status === 400) return HYGIENE_COPY.badRequest;
	if (error.status === 403) return HYGIENE_COPY.forbidden;
	if (error.status === 404) return notFound;
	return HYGIENE_COPY.generic;
}

/** A typed rejection proves nothing was stored; any other failure after a write may have committed. */
function isTyped(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status);
}

function readFailure(error: unknown): string {
	return error instanceof ApiError && error.status < 500 ? safeError(error) : HYGIENE_COPY.readFailure;
}

function pagination(input: Record<string, unknown>): { page: ActiveAssignment['page']; filters: ActiveAssignment['filters'] } | null {
	try {
		const coordinates = parseAssignmentActionCoordinates(input, true);
		return { page: { limit: coordinates.limit, offset: coordinates.offset }, filters: coordinates.filters };
	} catch { return null; }
}

/** The assignment must still be active in the caller's own list; the backend re-checks every write. */
async function activeAssignment(input: Record<string, unknown>, cookies: AstroCookies): Promise<ActiveAssignment | null> {
	const selected = pagination(input);
	if (!selected || !validId(input.assignment_id)) return null;
	const list = await listAssignedPatients(selected.page, cookies, selected.filters);
	const assignment = list.items.find((item) => item.id === input.assignment_id && item.ended_at === null);
	return assignment ? { assignment, page: selected.page, filters: selected.filters } : null;
}

function contextOf(assignment: AssignedPatient): HygieneContext {
	return { patient_id: assignment.patient_id, subject_id: assignment.subject_id, academic_group_id: assignment.academic_group_id };
}

function sameContext(draft: HygieneDraft, assignment: AssignedPatient): boolean {
	return draft.patient_id === assignment.patient_id
		&& draft.origin_subject_id === assignment.subject_id
		&& draft.origin_group_id === assignment.academic_group_id;
}

function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

/** Editor coordinates: list filters are carried only when the form posted them. */
function returnCoordinates(input: Record<string, unknown>, active: ActiveAssignment) {
	return {
		assignment_id: active.assignment.id,
		limit: String(active.page.limit),
		offset: String(active.page.offset),
		...(Object.keys(input).some((key) => key.startsWith('list_')) ? { list_filters: active.filters } : {}),
	};
}

export interface SaveSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; list_filters?: ActiveAssignment['filters']; draft: HygieneDraft }
/** `values` are the submitted controls, kept so the page can re-render them; `expected_version` is the version the student submitted. */
export interface SaveFailure { success: false; uncertain: boolean; conflict: boolean; error: string; expected_version: string; values?: FormValues }
export type SaveResult = SaveSuccess | SaveFailure;
export interface CreateSuccess { success: true; id: string; assignment_id: string; limit: string; offset: string; list_filters?: ActiveAssignment['filters']; draft: HygieneDraft }
export interface CreateFailure { success: false; uncertain: boolean; error: string }
export type CreateResult = CreateSuccess | CreateFailure;

/** One PATCH per submission, only after the draft's version and context are confirmed. Never retried. */
export async function handleUpdateHygieneDraft(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<SaveResult> {
	const id = typeof input.id === 'string' ? input.id : '';
	const expectedVersion = typeof input.expected_version === 'string' ? input.expected_version : '';
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean; values?: FormValues } = {}): SaveFailure => ({
		success: false, uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error, expected_version: expectedVersion, values: detail.values,
	});
	if (!validId(id) || !validId(expectedVersion)) return failure(HYGIENE_COPY.identifierInvalid);
	let values: FormValues;
	try {
		values = controlValues(input);
	} catch (error) {
		return failure(error instanceof FormInputError ? error.message : HYGIENE_COPY.formInput);
	}
	let current: ActiveAssignment;
	let baseline: HygieneContent;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(HYGIENE_COPY.assignmentUnavailable, { values });
		const draft = await getHygieneDraft(id, context.cookies);
		if (!sameContext(draft, active.assignment)) return failure(HYGIENE_COPY.draftUnavailable, { values });
		if (draft.version !== expectedVersion) return failure(HYGIENE_COPY.conflict, { conflict: true, values });
		current = active;
		baseline = writableHygieneContent(draft.content);
	} catch (error) {
		return failure(readFailure(error), { values });
	}
	let content: HygieneContent;
	try {
		content = hygieneContentFromForm(values, baseline);
	} catch (error) {
		return failure(error instanceof Error ? error.message : HYGIENE_COPY.formInput, { values });
	}
	try {
		const saved = await updateHygieneDraft(id, expectedVersion, content, contextOf(current.assignment), context.cookies);
		return { success: true, id: saved.id, ...returnCoordinates(input, current), draft: saved };
	} catch (error) {
		if (error instanceof ApiError && error.status === 409) return failure(HYGIENE_COPY.conflict, { conflict: true, values });
		if (isTyped(error)) return failure(safeError(error), { values });
		return failure(HYGIENE_COPY.saveUncertain, { uncertain: true, values });
	}
}

/** One POST per deliberate creation; each call starts a new encounter, so the result is never retried. */
export async function handleCreateHygieneDraft(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<CreateResult> {
	const failure = (error: string, uncertain = false): CreateFailure => ({ success: false, uncertain, error });
	if (!isUuid(input.patient_id) || !isUuid(input.subject_id) || !isUuid(input.academic_group_id)) return failure(HYGIENE_COPY.contextInvalid);
	let current: ActiveAssignment;
	try {
		const active = await activeAssignment(input, context.cookies);
		if (!active) return failure(HYGIENE_COPY.assignmentUnavailable);
		const { assignment } = active;
		if (assignment.patient_id !== input.patient_id || assignment.subject_id !== input.subject_id || assignment.academic_group_id !== input.academic_group_id) {
			return failure(HYGIENE_COPY.assignmentMismatch);
		}
		current = active;
	} catch (error) {
		return failure(readFailure(error));
	}
	try {
		const draft = await createHygieneDraft({ ...contextOf(current.assignment), content: {} }, context.cookies);
		return { success: true, id: draft.id, ...returnCoordinates(input, current), draft };
	} catch (error) {
		if (isTyped(error)) return failure(safeError(error, HYGIENE_COPY.patientUnavailable));
		return failure(HYGIENE_COPY.createUncertain, true);
	}
}

