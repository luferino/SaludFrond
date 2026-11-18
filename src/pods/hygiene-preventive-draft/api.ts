import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';

/** Yes/No questions of the medical history, in form order (backend contract). Each admits an optional `<name>_detail` text. */
export const HYGIENE_MEDICAL_QUESTIONS = [
	'taking_medication', 'allergy_local_anesthetic', 'allergy_penicillin', 'allergy_other_medication', 'dental_treatment_problem',
	'cardiovascular_disease', 'diabetes', 'hypertension', 'renal_disease', 'tuberculosis', 'venereal_disease', 'blood_disease',
	'other_disease', 'pregnant',
] as const;
/** Free-text fields of the medical history besides the `<name>_detail` texts. */
export const HYGIENE_MEDICAL_TEXTS = ['treating_physician', 'observations'] as const;

const range = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
/** Valid FDI tooth codes: permanent 11–48 and deciduous 51–85. */
export const FDI_TEETH: readonly string[] = [
	...range(11, 18), ...range(21, 28), ...range(31, 38), ...range(41, 48),
	...range(51, 55), ...range(61, 65), ...range(71, 75), ...range(81, 85),
];
export const TOOTH_STATES = ['present', 'absent', 'to_extract'] as const;
export const TOOTH_FACES = ['occlusal', 'mesial', 'distal', 'vestibular', 'lingual'] as const;
export const FACE_MARKS = ['caries', 'filled'] as const;

/** Index components and the maximum of their sum. The server computes and returns `total`; clients never send it. */
export const HYGIENE_INDICES = {
	ceo_d: { components: ['c', 'e', 'o'], max: 20 },
	cpo_d: { components: ['c', 'p', 'o'], max: 32 },
	cpo_first_molars: { components: ['c', 'p', 'o'], max: 4 },
} as const satisfies Record<string, { components: readonly string[]; max: number }>;

export type ToothState = (typeof TOOTH_STATES)[number];
export type ToothFace = (typeof TOOTH_FACES)[number];
export type FaceMark = (typeof FACE_MARKS)[number];
export type HygieneIndexName = keyof typeof HYGIENE_INDICES;
export interface ToothRecord { state: ToothState; surfaces?: Partial<Record<ToothFace, FaceMark[]>> }
export type HygieneIndex = Record<string, number>;
/** Absent keys mean "not captured"; null means unanswered or not loaded. Both are kept exactly as stored. */
export interface HygieneContent {
	medical_history?: Record<string, boolean | string | null>;
	odontogram?: Record<string, ToothRecord>;
	indices?: Partial<Record<HygieneIndexName, HygieneIndex | null>>;
}

export interface HygieneContext { patient_id: string; subject_id: string; academic_group_id: string }

export interface HygieneDraft {
	id: string;
	clinical_record_id: string;
	patient_id: string;
	author_id: string;
	origin_student_habilitation_id: string;
	origin_subject_id: string;
	origin_group_id: string;
	content: HygieneContent;
	status: 'draft';
	version: string;
	created_at: string;
	updated_at: string;
}

/** An Odontology subject enabled for this form by an administrator. */
export interface HygieneSubjectLink { subject_id: string; career_id: string; created_by: string; created_at: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const MAX_ID = 9223372036854775807n;
const MAX_TEXT = 4000;
const MAX_OFFSET = 2147483647;
const DRAFT_KEYS = [
	'id', 'clinical_record_id', 'patient_id', 'author_id', 'origin_student_habilitation_id', 'origin_subject_id',
	'origin_group_id', 'content', 'status', 'version', 'created_at', 'updated_at',
];
const LINK_KEYS = ['subject_id', 'career_id', 'created_by', 'created_at'];
const SECTIONS = ['medical_history', 'odontogram', 'indices'];
const MEDICAL_BOOLEANS: readonly string[] = HYGIENE_MEDICAL_QUESTIONS;
const MEDICAL_TEXTS: readonly string[] = [...HYGIENE_MEDICAL_QUESTIONS.map((name) => `${name}_detail`), ...HYGIENE_MEDICAL_TEXTS];
const CONFIRMATION_ERROR = 'El resultado no se pudo confirmar. Consultá el estado antes de volver a intentarlo.';

/** Positive BIGINT decimal string: the only accepted form for draft ids and versions. */
export function validId(value: unknown): value is string {
	return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function iso(value: unknown): value is string {
	return typeof value === 'string'
		&& /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
		&& Number.isFinite(Date.parse(value));
}

function validateMedicalHistory(value: unknown): Record<string, boolean | string | null> {
	if (!record(value)) throw new Error('La sección de antecedentes médicos no es válida.');
	const output: Record<string, boolean | string | null> = {};
	for (const [key, answer] of Object.entries(value)) {
		if (MEDICAL_BOOLEANS.includes(key)) {
			if (answer !== null && typeof answer !== 'boolean') throw new Error(`La respuesta ${key} debe ser Sí, No o sin responder.`);
		} else if (MEDICAL_TEXTS.includes(key)) {
			if (answer !== null && typeof answer !== 'string') throw new Error(`El campo ${key} debe ser texto o vacío.`);
			if (typeof answer === 'string' && (answer.includes('\u0000') || LONE_SURROGATE.test(answer))) {
				throw new Error(`El campo ${key} contiene caracteres no permitidos.`);
			}
			if (typeof answer === 'string' && [...answer].length > MAX_TEXT) throw new Error(`El campo ${key} supera los ${MAX_TEXT} caracteres.`);
		} else {
			throw new Error(`Campo clínico desconocido: medical_history.${key}`);
		}
		output[key] = answer as boolean | string | null;
	}
	return output;
}

function validateTooth(code: string, value: unknown): ToothRecord {
	if (!record(value)) throw new Error(`La pieza ${code} no es válida.`);
	for (const key of Object.keys(value)) {
		if (key !== 'state' && key !== 'surfaces') throw new Error(`Campo clínico desconocido: odontogram.${code}.${key}`);
	}
	if (!(TOOTH_STATES as readonly unknown[]).includes(value.state)) {
		throw new Error(`El estado de la pieza ${code} debe ser presente, ausente o a extraer.`);
	}
	const tooth: ToothRecord = { state: value.state as ToothState };
	if (!Object.hasOwn(value, 'surfaces')) return tooth;
	if (!record(value.surfaces)) throw new Error(`Las caras de la pieza ${code} no son válidas.`);
	const surfaces: Partial<Record<ToothFace, FaceMark[]>> = {};
	for (const [face, marks] of Object.entries(value.surfaces)) {
		if (!(TOOTH_FACES as readonly string[]).includes(face)) throw new Error(`Campo clínico desconocido: odontogram.${code}.surfaces.${face}`);
		if (!Array.isArray(marks) || marks.length === 0 || new Set(marks).size !== marks.length
			|| !marks.every((mark) => (FACE_MARKS as readonly unknown[]).includes(mark))) {
			throw new Error(`La cara ${face} de la pieza ${code} debe tener caries, obturada o ambas, sin repetir.`);
		}
		surfaces[face as ToothFace] = [...marks] as FaceMark[];
	}
	if (tooth.state === 'absent' && Object.keys(surfaces).length > 0) throw new Error(`La pieza ${code} está ausente y no puede tener caras marcadas.`);
	tooth.surfaces = surfaces;
	return tooth;
}

function validateOdontogram(value: unknown): Record<string, ToothRecord> {
	if (!record(value)) throw new Error('El odontograma no es válido.');
	const output: Record<string, ToothRecord> = {};
	for (const [code, tooth] of Object.entries(value)) {
		if (!FDI_TEETH.includes(code)) throw new Error(`El código ${code} no es una pieza FDI válida.`);
		output[code] = validateTooth(code, tooth);
	}
	return output;
}

type IndexMode = 'write' | 'stored';

/** `write`: components only, total refused. `stored`: components plus the server total, which must be their sum. */
function validateIndices(value: unknown, mode: IndexMode): Partial<Record<HygieneIndexName, HygieneIndex | null>> {
	if (!record(value)) throw new Error('Los índices no son válidos.');
	const output: Partial<Record<HygieneIndexName, HygieneIndex | null>> = {};
	for (const [name, index] of Object.entries(value)) {
		if (!Object.hasOwn(HYGIENE_INDICES, name)) throw new Error(`Campo clínico desconocido: indices.${name}`);
		const { components, max } = HYGIENE_INDICES[name as HygieneIndexName];
		if (index === null) { output[name as HygieneIndexName] = null; continue; }
		if (!record(index)) throw new Error(`El índice ${name} debe estar cargado completo o vacío.`);
		if (mode === 'write' && Object.hasOwn(index, 'total')) throw new Error(`El total del índice ${name} lo calcula el servidor y no se envía.`);
		const keys: string[] = mode === 'stored' ? [...components, 'total'] : [...components];
		if (!exactKeys(index, keys)) throw new Error(`El índice ${name} debe tener ${components.join(', ')} completos.`);
		const loaded: HygieneIndex = {};
		for (const component of components) {
			const count = index[component];
			if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
				throw new Error(`El índice ${name}: ${component} debe ser un entero mayor o igual a 0.`);
			}
			loaded[component] = count;
		}
		const sum = components.reduce((total, component) => total + loaded[component], 0);
		if (sum > max) throw new Error(`El índice ${name} no puede sumar más de ${max}.`);
		if (mode === 'stored') {
			if (index.total !== sum) throw new Error(`El total del índice ${name} no coincide con sus componentes.`);
			loaded.total = sum;
		}
		output[name as HygieneIndexName] = loaded;
	}
	return output;
}

function validateContent(value: unknown, mode: IndexMode): HygieneContent {
	if (!record(value)) throw new Error('El contenido clínico debe ser un objeto.');
	const output: HygieneContent = {};
	for (const [key, section] of Object.entries(value)) {
		if (!SECTIONS.includes(key)) throw new Error(`Sección clínica desconocida: ${key}`);
		if (key === 'medical_history') output.medical_history = validateMedicalHistory(section);
		else if (key === 'odontogram') output.odontogram = validateOdontogram(section);
		else output.indices = validateIndices(section, mode);
	}
	return output;
}

/** Validate content to send; keeps absent and null answers exactly as given and refuses any index total. */
export function validateHygieneContent(value: unknown): HygieneContent {
	return validateContent(value, 'write');
}

/** Content of a read draft, ready to send back: every server total is checked and removed. */
export function writableHygieneContent(value: unknown): HygieneContent {
	const stored = validateContent(value, 'stored');
	if (stored.indices) {
		for (const index of Object.values(stored.indices)) if (index) delete index.total;
	}
	return stored;
}

function validStoredContent(value: unknown): boolean {
	try { validateContent(value, 'stored'); return true; } catch { return false; }
}

export function isHygieneDraft(value: unknown): value is HygieneDraft {
	return record(value) && exactKeys(value, DRAFT_KEYS)
		&& validId(value.id) && validId(value.clinical_record_id) && validId(value.version)
		&& ['patient_id', 'author_id', 'origin_student_habilitation_id', 'origin_subject_id', 'origin_group_id'].every((key) => uuid(value[key]))
		&& value.status === 'draft' && validStoredContent(value.content)
		&& iso(value.created_at) && iso(value.updated_at);
}

function validateContext(context: HygieneContext) {
	if (!uuid(context.patient_id) || !uuid(context.subject_id) || !uuid(context.academic_group_id)) {
		throw new Error('El contexto de paciente, asignatura y grupo no es válido.');
	}
}

function validatePage(page: { limit: number; offset: number }) {
	if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100
		|| !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > MAX_OFFSET) {
		throw new Error('La paginación no es válida.');
	}
}

function draftResponse(value: unknown, expected: { id?: string; context?: HygieneContext }): HygieneDraft {
	if (!isHygieneDraft(value)) throw new Error('El servicio devolvió datos incompletos o desconocidos.');
	if ((expected.id && value.id !== expected.id)
		|| (expected.context && (value.patient_id !== expected.context.patient_id
			|| value.origin_subject_id !== expected.context.subject_id
			|| value.origin_group_id !== expected.context.academic_group_id))) {
		throw new Error('El borrador recibido no coincide con el contexto solicitado.');
	}
	return value;
}

function draftItems(response: unknown): unknown[] {
	if (!record(response) || !exactKeys(response, ['items']) || !Array.isArray(response.items)) {
		throw new Error('La respuesta de borradores no es válida.');
	}
	return response.items;
}

/** One page of drafts in one origin context, newest id first. The response carries no paging metadata. */
export async function listHygieneDrafts(
	context: HygieneContext,
	cookies: AstroCookies,
	page: { limit: number; offset: number },
): Promise<HygieneDraft[]> {
	validateContext(context);
	validatePage(page);
	const query = new URLSearchParams({ ...context, limit: String(page.limit), offset: String(page.offset) });
	const response = await apiFetch<unknown>(`/hygiene-preventive-drafts?${query}`, { cookies });
	return draftItems(response).map((item) => draftResponse(item, { context }));
}

/** Administrator consultation: one page of every visible draft, newest id first, with no origin context. */
export async function listAllHygieneDrafts(cookies: AstroCookies, page: { limit: number; offset: number }): Promise<HygieneDraft[]> {
	validatePage(page);
	const query = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
	const response = await apiFetch<unknown>(`/hygiene-preventive-drafts?${query}`, { cookies });
	return draftItems(response).map((item) => draftResponse(item, {}));
}

export async function getHygieneDraft(id: string, cookies: AstroCookies): Promise<HygieneDraft> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	return draftResponse(await apiFetch<unknown>(`/hygiene-preventive-drafts/${id}`, { cookies }), { id });
}

/** Every call creates a new clinical encounter; callers resume existing drafts by id instead of retrying. */
export async function createHygieneDraft(input: HygieneContext & { content: unknown }, cookies: AstroCookies): Promise<HygieneDraft> {
	const context = { patient_id: input.patient_id, subject_id: input.subject_id, academic_group_id: input.academic_group_id };
	validateContext(context);
	const body = { ...context, content: validateHygieneContent(input.content) };
	return draftResponse(await apiFetch<unknown>('/hygiene-preventive-drafts', { method: 'POST', body, cookies }), { context });
}

/** Replace the whole content; a stale expected_version is rejected by the backend with 409 and nothing is stored. */
export async function updateHygieneDraft(
	id: string,
	expectedVersion: string,
	content: unknown,
	context: HygieneContext,
	cookies: AstroCookies,
): Promise<HygieneDraft> {
	if (!validId(id) || !validId(expectedVersion)) throw new Error('El borrador o su versión no es válido.');
	validateContext(context);
	const body = { expected_version: expectedVersion, content: validateHygieneContent(content) };
	const draft = draftResponse(await apiFetch<unknown>(`/hygiene-preventive-drafts/${id}`, { method: 'PATCH', body, cookies }), { id, context });
	if (BigInt(draft.version) <= BigInt(expectedVersion)) throw new Error(CONFIRMATION_ERROR);
	return draft;
}

function isSubjectLink(value: unknown): value is HygieneSubjectLink {
	return record(value) && exactKeys(value, LINK_KEYS)
		&& uuid(value.subject_id) && uuid(value.career_id) && uuid(value.created_by) && iso(value.created_at);
}

/** Administrator list of enabled Odontology subjects, ordered by subject id. */
export async function listHygieneSubjects(cookies: AstroCookies): Promise<HygieneSubjectLink[]> {
	const response = await apiFetch<unknown>('/hygiene-preventive-subjects', { cookies });
	if (!record(response) || !exactKeys(response, ['items']) || !Array.isArray(response.items) || !response.items.every(isSubjectLink)) {
		throw new Error('La respuesta de asignaturas habilitadas no es válida.');
	}
	return response.items;
}

/** Enable one Odontology subject. There is no undo through the API; a duplicate is a 409 and changes nothing. */
export async function enableHygieneSubject(subjectId: string, cookies: AstroCookies): Promise<HygieneSubjectLink> {
	if (!uuid(subjectId)) throw new Error('La asignatura no es válida.');
	const value = await apiFetch<unknown>('/hygiene-preventive-subjects', { method: 'POST', body: { subject_id: subjectId }, cookies });
	if (!isSubjectLink(value) || value.subject_id !== subjectId) throw new Error(CONFIRMATION_ERROR);
	return value;
}
