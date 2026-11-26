import type { AstroCookies } from 'astro';
import { ApiError, apiFetch } from '../../shared/apiClient';
import { clearSession, getSession } from '../../shared/session';

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
/** Löe-Silness index teeth and sites, and O'Leary surfaces, in the order of the backend contract. */
export const LOE_SILNESS_TEETH: readonly string[] = ['16', '21', '24', '36', '41', '44'];
export const LOE_SILNESS_SITES = ['distal', 'vestibular', 'mesial', 'lingual'] as const;
export const OLEARY_SURFACES = ['mesial', 'distal', 'vestibular', 'lingual'] as const;

/** Index components and the maximum of their sum. The server computes and returns `total`; clients never send it. */
export const HYGIENE_INDICES = {
	ceo_d: { components: ['c', 'e', 'o'], max: 20 },
	cpo_d: { components: ['c', 'p', 'o'], max: 32 },
	cpo_first_molars: { components: ['c', 'p', 'o'], max: 4 },
} as const satisfies Record<string, { components: readonly string[]; max: number }>;

export type ToothState = (typeof TOOTH_STATES)[number];
export type ToothFace = (typeof TOOTH_FACES)[number];
export type FaceMark = (typeof FACE_MARKS)[number];
export type LoeSilnessSite = (typeof LOE_SILNESS_SITES)[number];
export type OlearySurface = (typeof OLEARY_SURFACES)[number];
export type LoeSilnessCategory = 'low' | 'moderate' | 'abundant';
export type OlearyCategory = 'good' | 'fair' | 'poor';
export type HygieneIndexName = keyof typeof HYGIENE_INDICES;
export interface ToothRecord { state: ToothState; surfaces?: Partial<Record<ToothFace, FaceMark[]>> }
export type HygieneIndex = Record<string, number>;
/** Absent keys mean "not captured"; null means unanswered or not loaded. Both are kept exactly as stored. */
export interface HygieneContent {
	medical_history?: Record<string, boolean | string | null>;
	odontogram?: Record<string, ToothRecord>;
	indices?: Partial<Record<HygieneIndexName, HygieneIndex | null>>;
	plaque?: HygienePlaque;
}

/** Löe-Silness: `teeth` is sent and stored; `average` and `category` are computed by the server and never sent. */
export interface LoeSilnessSection {
	teeth: Record<string, Partial<Record<LoeSilnessSite, number>>>;
	average?: number | null;
	category?: LoeSilnessCategory | null;
}
/** O'Leary: `teeth` is sent and stored; the other fields are computed by the server and never sent. */
export interface OlearySection {
	teeth: Record<string, Record<OlearySurface, boolean>>;
	stained_surfaces?: number;
	present_surfaces?: number;
	percentage?: number | null;
	category?: OlearyCategory | null;
}
export interface HygienePlaque { loe_silness?: LoeSilnessSection | null; oleary?: OlearySection | null }

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
const SECTIONS = ['medical_history', 'odontogram', 'indices', 'plaque'];
const LOE_SILNESS_RESULTS = ['average', 'category'];
const OLEARY_RESULTS = ['stained_surfaces', 'present_surfaces', 'percentage', 'category'];
const LOE_SILNESS_CATEGORIES: readonly unknown[] = ['low', 'moderate', 'abundant'];
const OLEARY_CATEGORIES: readonly unknown[] = ['good', 'fair', 'poor'];
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
export function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
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

/** `write`: what a client sends. `stored`: what the server returns, with its computed results. */
type ContentMode = 'write' | 'stored';

/** `write`: components only, total refused. `stored`: components plus the server total, which must be their sum. */
function validateIndices(value: unknown, mode: ContentMode): Partial<Record<HygieneIndexName, HygieneIndex | null>> {
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

function validateLoeSilnessTeeth(value: unknown): Record<string, Partial<Record<LoeSilnessSite, number>>> {
	if (!record(value)) throw new Error('plaque.loe_silness.teeth debe ser un objeto.');
	const teeth: Record<string, Partial<Record<LoeSilnessSite, number>>> = {};
	for (const [code, tooth] of Object.entries(value)) {
		if (!LOE_SILNESS_TEETH.includes(code)) throw new Error(`plaque.loe_silness.teeth.${code} debe ser una de 16, 21, 24, 36, 41, 44.`);
		if (!record(tooth)) throw new Error(`plaque.loe_silness.teeth.${code} debe ser un objeto.`);
		const sites: Partial<Record<LoeSilnessSite, number>> = {};
		for (const [site, grade] of Object.entries(tooth)) {
			if (!(LOE_SILNESS_SITES as readonly string[]).includes(site)) throw new Error(`Campo clínico desconocido: plaque.loe_silness.teeth.${code}.${site}`);
			if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 0 || grade > 3) {
				throw new Error(`plaque.loe_silness.teeth.${code}.${site} debe ser un entero de 0 a 3.`);
			}
			sites[site as LoeSilnessSite] = grade;
		}
		teeth[code] = sites;
	}
	return teeth;
}

function validateOlearyTeeth(value: unknown): Record<string, Record<OlearySurface, boolean>> {
	if (!record(value)) throw new Error('plaque.oleary.teeth debe ser un objeto.');
	const teeth: Record<string, Record<OlearySurface, boolean>> = {};
	for (const [code, tooth] of Object.entries(value)) {
		if (!FDI_TEETH.includes(code)) throw new Error(`plaque.oleary.teeth.${code} no es un código FDI válido.`);
		if (!record(tooth)) throw new Error(`plaque.oleary.teeth.${code} debe ser un objeto.`);
		for (const key of Object.keys(tooth)) {
			if (!(OLEARY_SURFACES as readonly string[]).includes(key)) throw new Error(`Campo clínico desconocido: plaque.oleary.teeth.${code}.${key}`);
		}
		const surfaces = {} as Record<OlearySurface, boolean>;
		for (const surface of OLEARY_SURFACES) {
			const stained = tooth[surface];
			if (typeof stained !== 'boolean') throw new Error(`plaque.oleary.teeth.${code}.${surface} debe ser booleano.`);
			surfaces[surface] = stained;
		}
		teeth[code] = surfaces;
	}
	return teeth;
}

/** Results are refused when a client sends them, and required (with no other key) when the server stored them. */
function checkPlaqueKeys(section: Record<string, unknown>, name: 'loe_silness' | 'oleary', results: string[], mode: ContentMode): void {
	for (const key of Object.keys(section)) {
		if (key !== 'teeth' && !results.includes(key)) throw new Error(`Campo clínico desconocido: plaque.${name}.${key}`);
	}
	if (mode === 'write') {
		const computed = results.find((key) => Object.hasOwn(section, key));
		if (computed !== undefined) throw new Error(`plaque.${name}.${computed} lo calcula el servidor y no se envía.`);
	} else if (!exactKeys(section, ['teeth', ...results])) {
		throw new Error(`plaque.${name} debe tener ${['teeth', ...results].join(', ')}.`);
	}
}

function loeSilnessSection(value: unknown, mode: ContentMode): LoeSilnessSection {
	if (!record(value)) throw new Error('plaque.loe_silness debe ser un objeto o null.');
	checkPlaqueKeys(value, 'loe_silness', LOE_SILNESS_RESULTS, mode);
	const section: LoeSilnessSection = { teeth: validateLoeSilnessTeeth(value.teeth) };
	if (mode === 'stored') {
		const { average, category } = value;
		if (average !== null && (typeof average !== 'number' || !Number.isFinite(average))) throw new Error('plaque.loe_silness.average debe ser un número o null.');
		if (category !== null && !LOE_SILNESS_CATEGORIES.includes(category)) throw new Error('plaque.loe_silness.category debe ser low, moderate, abundant o null.');
		section.average = average as number | null;
		section.category = category as LoeSilnessCategory | null;
	}
	return section;
}

/** Stored counts must match the recorded teeth: four surfaces per tooth, and one count per stained surface. */
function olearySection(value: unknown, mode: ContentMode): OlearySection {
	if (!record(value)) throw new Error('plaque.oleary debe ser un objeto o null.');
	checkPlaqueKeys(value, 'oleary', OLEARY_RESULTS, mode);
	const teeth = validateOlearyTeeth(value.teeth);
	const section: OlearySection = { teeth };
	if (mode === 'stored') {
		const { stained_surfaces: stained, present_surfaces: present, percentage, category } = value;
		const stainedSurfaces = Object.values(teeth).reduce((total, surfaces) => total + OLEARY_SURFACES.filter((surface) => surfaces[surface]).length, 0);
		if (present !== Object.keys(teeth).length * OLEARY_SURFACES.length) {
			throw new Error(`plaque.oleary.present_surfaces debe ser ${OLEARY_SURFACES.length} por cada pieza registrada.`);
		}
		if (stained !== stainedSurfaces) throw new Error('plaque.oleary.stained_surfaces no coincide con las superficies teñidas.');
		if (percentage !== null && (typeof percentage !== 'number' || !Number.isFinite(percentage))) throw new Error('plaque.oleary.percentage debe ser un número o null.');
		if (category !== null && !OLEARY_CATEGORIES.includes(category)) throw new Error('plaque.oleary.category debe ser good, fair, poor o null.');
		section.stained_surfaces = stained as number;
		section.present_surfaces = present as number;
		section.percentage = percentage as number | null;
		section.category = category as OlearyCategory | null;
	}
	return section;
}

function validatePlaque(value: unknown, mode: ContentMode): HygienePlaque {
	if (!record(value)) throw new Error('El contenido de plaque debe ser un objeto.');
	const output: HygienePlaque = {};
	for (const [key, section] of Object.entries(value)) {
		if (key === 'loe_silness') output.loe_silness = section === null ? null : loeSilnessSection(section, mode);
		else if (key === 'oleary') output.oleary = section === null ? null : olearySection(section, mode);
		else throw new Error(`Campo clínico desconocido: plaque.${key}`);
	}
	return output;
}

function validateContent(value: unknown, mode: ContentMode): HygieneContent {
	if (!record(value)) throw new Error('El contenido clínico debe ser un objeto.');
	const output: HygieneContent = {};
	for (const [key, section] of Object.entries(value)) {
		if (!SECTIONS.includes(key)) throw new Error(`Sección clínica desconocida: ${key}`);
		if (key === 'medical_history') output.medical_history = validateMedicalHistory(section);
		else if (key === 'odontogram') output.odontogram = validateOdontogram(section);
		else if (key === 'indices') output.indices = validateIndices(section, mode);
		else output.plaque = validatePlaque(section, mode);
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
	// Plaque results are computed by the server; only the teeth go back, and null or absent sections keep their shape.
	if (stored.plaque) {
		const { loe_silness: loe, oleary } = stored.plaque;
		if (loe) stored.plaque.loe_silness = { teeth: loe.teeth };
		if (oleary) stored.plaque.oleary = { teeth: oleary.teeth };
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

export interface HygieneDraftAdminFilters { patient_id?: string; subject_id?: string; academic_group_id?: string }

/** Administrator consultation: one page of visible drafts, newest id first, optionally filtered by academic origin. */
export async function listAllHygieneDrafts(cookies: AstroCookies, page: { limit: number; offset: number } & HygieneDraftAdminFilters): Promise<HygieneDraft[]> {
	validatePage(page);
	const query = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
	for (const key of ['patient_id', 'subject_id', 'academic_group_id'] as const) {
		const value = page[key];
		if (value === undefined) continue;
		if (!uuid(value)) throw new Error('Invalid academic filter');
		query.set(key, value);
	}
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

const DRAFT_ID_ERROR = 'El identificador de borrador no es válido.';
const CONSENT_SHAPE = 'La respuesta del consentimiento no es válida.';
const PROCEDURES_SHAPE = 'La respuesta de procedimientos no es válida.';
const SIGNER_NAME_ERROR = 'Ingresá el nombre del firmante (hasta 200 caracteres).';
const DOCUMENT_ERROR = 'El documento del firmante debe tener entre 4 y 8 dígitos.';
const PROCEDURE_DATE_ERROR = 'La fecha del procedimiento debe ser una fecha válida (AAAA-MM-DD).';
const PROCEDURE_TEXT_ERROR = 'La descripción es obligatoria y admite hasta 1000 caracteres.';
const PROCEDURE_TEXT_MAX = 1000;
const SIGNER_NAME_MAX = 200;
const PARENT_DOCUMENT = /^\d{4,8}$/;
const PROCEDURE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONSENT_KEYS = ['id', 'draft_id', 'signer', 'signer_name', 'signer_document', 'declared_by', 'declared_at'];
const PROCEDURE_KEYS = [
	'id', 'draft_id', 'procedure_date', 'description', 'author_id', 'student_name', 'version',
	'approved_by', 'teacher_name', 'approved_at', 'created_at', 'updated_at', 'status',
];

/** Paper consent: a declaration that a signed paper exists. No document is uploaded and nothing is signed electronically. */
export type HygieneSigner = 'patient' | 'parent';
export interface HygieneConsentDeclaration {
	id: string;
	draft_id: string;
	signer: HygieneSigner;
	signer_name: string;
	signer_document: string;
	declared_by: string;
	declared_at: string;
}
export interface HygieneConsentHistory { current_declaration_id: string | null; declarations: HygieneConsentDeclaration[] }
/** A patient signer sends no name or document: the server copies them from the patient record. */
export type HygieneSignerInput = { signer: 'patient' } | { signer: 'parent'; signer_name: string; signer_document: string };

/** Procedure log entry. `status` is `pending` exactly while `approved_at` is null. */
export type HygieneProcedureStatus = 'pending' | 'approved';
export interface HygieneProcedure {
	id: string;
	draft_id: string;
	procedure_date: string;
	description: string;
	author_id: string;
	student_name: string | null;
	version: string;
	approved_by: string | null;
	teacher_name: string | null;
	approved_at: string | null;
	created_at: string;
	updated_at: string;
	status: HygieneProcedureStatus;
}
export interface HygieneProcedureInput { procedure_date: string; description: string }

/** A date that exists in the calendar, written as YYYY-MM-DD. */
function calendarDate(value: unknown): value is string {
	if (typeof value !== 'string' || !PROCEDURE_DATE.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Text the backend stores exactly as sent: not blank, within its limit, without NUL or lone surrogates. */
function storedText(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.trim() !== '' && [...value].length <= max
		&& !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}

function isConsentDeclaration(value: unknown): value is HygieneConsentDeclaration {
	return record(value) && exactKeys(value, CONSENT_KEYS)
		&& validId(value.id) && validId(value.draft_id)
		&& (value.signer === 'patient' || value.signer === 'parent')
		&& typeof value.signer_name === 'string' && typeof value.signer_document === 'string'
		&& (value.signer !== 'parent' || PARENT_DOCUMENT.test(value.signer_document))
		&& uuid(value.declared_by) && iso(value.declared_at);
}

function consentHistory(value: unknown, draftId: string): HygieneConsentHistory {
	if (!record(value) || !exactKeys(value, ['current_declaration_id', 'declarations']) || !Array.isArray(value.declarations)) {
		throw new Error(CONSENT_SHAPE);
	}
	const declarations: unknown[] = value.declarations;
	if (!declarations.every((item) => isConsentDeclaration(item) && item.draft_id === draftId)) throw new Error(CONSENT_SHAPE);
	// The current id is the latest declaration, or null when there is none.
	const latest = declarations.length > 0 ? (declarations[declarations.length - 1] as HygieneConsentDeclaration).id : null;
	if (value.current_declaration_id !== latest) throw new Error(CONSENT_SHAPE);
	return { current_declaration_id: latest, declarations: declarations as HygieneConsentDeclaration[] };
}

function consentBody(signer: unknown): { paper_signed: true; signer: 'patient' } | { paper_signed: true; signer: 'parent'; signer_name: string; signer_document: string } {
	if (!record(signer)) throw new Error('El firmante no es válido.');
	if (signer.signer === 'patient') return { paper_signed: true, signer: 'patient' };
	if (signer.signer !== 'parent') throw new Error('El firmante no es válido.');
	if (!storedText(signer.signer_name, SIGNER_NAME_MAX)) throw new Error(SIGNER_NAME_ERROR);
	if (typeof signer.signer_document !== 'string' || !PARENT_DOCUMENT.test(signer.signer_document)) throw new Error(DOCUMENT_ERROR);
	return { paper_signed: true, signer: 'parent', signer_name: signer.signer_name, signer_document: signer.signer_document };
}

function procedureInput(value: unknown): HygieneProcedureInput {
	if (!record(value) || !calendarDate(value.procedure_date)) throw new Error(PROCEDURE_DATE_ERROR);
	if (!storedText(value.description, PROCEDURE_TEXT_MAX)) throw new Error(PROCEDURE_TEXT_ERROR);
	return { procedure_date: value.procedure_date, description: value.description };
}

function isHygieneProcedure(value: unknown): value is HygieneProcedure {
	if (!record(value) || !exactKeys(value, PROCEDURE_KEYS)) return false;
	const common = validId(value.id) && validId(value.draft_id) && calendarDate(value.procedure_date)
		&& typeof value.description === 'string' && uuid(value.author_id)
		&& (value.student_name === null || typeof value.student_name === 'string')
		&& validId(value.version) && iso(value.created_at) && iso(value.updated_at);
	if (!common) return false;
	if (value.status === 'pending') return value.approved_by === null && value.teacher_name === null && value.approved_at === null;
	if (value.status === 'approved') {
		return uuid(value.approved_by) && typeof value.teacher_name === 'string' && iso(value.approved_at);
	}
	return false;
}

/** A written entry must belong to the draft, be a complete entry and pass the write's own check; otherwise the write is unconfirmed. */
function entryAnswer(value: unknown, draftId: string, confirmed: (entry: HygieneProcedure) => boolean): HygieneProcedure {
	if (!isHygieneProcedure(value) || value.draft_id !== draftId || !confirmed(value)) throw new Error(CONFIRMATION_ERROR);
	return value;
}

function entryTarget(draftId: string, procedureId: string, expectedVersion?: string): void {
	if (!validId(draftId)) throw new Error(DRAFT_ID_ERROR);
	if (!validId(procedureId)) throw new Error('El identificador del procedimiento no es válido.');
	if (expectedVersion !== undefined && !validId(expectedVersion)) throw new Error('La versión del procedimiento no es válida.');
}

/**
 * DELETE answers 204 with no body, and apiFetch reads JSON on every success, so this request is separate. It keeps the
 * session and error handling of apiFetch and accepts only an empty 204.
 */
async function deleteEmpty(path: string, cookies: AstroCookies): Promise<void> {
	const token = getSession(cookies);
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	let response: Response;
	try {
		response = await fetch(`${import.meta.env.PUBLIC_API_URL as string}${path}`, { method: 'DELETE', headers });
	} catch {
		throw new Error('Service unavailable');
	}
	if (!response.ok) {
		if (response.status === 401) clearSession(cookies);
		const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
		const message = typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`;
		const code = response.status === 401 ? 'UNAUTHORIZED' : typeof body?.error?.code === 'string' ? body.error.code : undefined;
		throw new ApiError(response.status, message, code);
	}
	if (response.status !== 204) throw new Error(CONFIRMATION_ERROR);
}

/** Current consent of a draft: the history, oldest first. Readable by the same users as the draft. */
export async function getHygieneConsent(draftId: string, cookies: AstroCookies): Promise<HygieneConsentHistory> {
	if (!validId(draftId)) throw new Error(DRAFT_ID_ERROR);
	return consentHistory(await apiFetch<unknown>(`/hygiene-preventive-drafts/${draftId}/consent`, { cookies }), draftId);
}

/** One POST per declaration, never retried. The response must be the declaration that was sent. */
export async function declareHygieneConsent(draftId: string, signer: HygieneSignerInput, cookies: AstroCookies): Promise<HygieneConsentDeclaration> {
	if (!validId(draftId)) throw new Error(DRAFT_ID_ERROR);
	const body = consentBody(signer);
	const value = await apiFetch<unknown>(`/hygiene-preventive-drafts/${draftId}/consent`, { method: 'POST', body, cookies });
	if (!isConsentDeclaration(value) || value.draft_id !== draftId || value.signer !== body.signer) throw new Error(CONFIRMATION_ERROR);
	if (body.signer === 'parent' && (value.signer_name !== body.signer_name || value.signer_document !== body.signer_document)) {
		throw new Error(CONFIRMATION_ERROR);
	}
	return value;
}

/** Entries of a draft's procedure log, in creation order. */
export async function listHygieneProcedures(draftId: string, cookies: AstroCookies): Promise<HygieneProcedure[]> {
	if (!validId(draftId)) throw new Error(DRAFT_ID_ERROR);
	const response = await apiFetch<unknown>(`/hygiene-preventive-drafts/${draftId}/procedures`, { cookies });
	if (!record(response) || !exactKeys(response, ['items']) || !Array.isArray(response.items)) throw new Error(PROCEDURES_SHAPE);
	const items: unknown[] = response.items;
	if (!items.every((item) => isHygieneProcedure(item) && item.draft_id === draftId)) throw new Error(PROCEDURES_SHAPE);
	return items as HygieneProcedure[];
}

export async function createHygieneProcedure(draftId: string, input: HygieneProcedureInput, cookies: AstroCookies): Promise<HygieneProcedure> {
	if (!validId(draftId)) throw new Error(DRAFT_ID_ERROR);
	const sent = procedureInput(input);
	const entry = await apiFetch<unknown>(`/hygiene-preventive-drafts/${draftId}/procedures`, { method: 'POST', body: sent, cookies });
	return entryAnswer(entry, draftId, (created) => created.procedure_date === sent.procedure_date && created.description === sent.description);
}

/** Replaces both fields of a pending entry. The answer must be the same entry with a greater version. */
export async function updateHygieneProcedure(
	draftId: string,
	procedureId: string,
	expectedVersion: string,
	input: HygieneProcedureInput,
	cookies: AstroCookies,
): Promise<HygieneProcedure> {
	entryTarget(draftId, procedureId, expectedVersion);
	const sent = procedureInput(input);
	const entry = await apiFetch<unknown>(`/hygiene-preventive-drafts/${draftId}/procedures/${procedureId}`, {
		method: 'PATCH', body: { expected_version: expectedVersion, ...sent }, cookies,
	});
	return entryAnswer(entry, draftId, (updated) => updated.id === procedureId
		&& BigInt(updated.version) > BigInt(expectedVersion)
		&& updated.procedure_date === sent.procedure_date && updated.description === sent.description);
}

/** Deletes a pending entry; the backend answers 204 with no body. */
export async function deleteHygieneProcedure(draftId: string, procedureId: string, expectedVersion: string, cookies: AstroCookies): Promise<void> {
	entryTarget(draftId, procedureId, expectedVersion);
	const query = new URLSearchParams({ expected_version: expectedVersion });
	await deleteEmpty(`/hygiene-preventive-drafts/${draftId}/procedures/${procedureId}?${query}`, cookies);
}

/** Teacher approval: final once answered. The body carries only `expected_version`. */
export async function approveHygieneProcedure(draftId: string, procedureId: string, expectedVersion: string, cookies: AstroCookies): Promise<HygieneProcedure> {
	entryTarget(draftId, procedureId, expectedVersion);
	const entry = await apiFetch<unknown>(`/hygiene-preventive-drafts/${draftId}/procedures/${procedureId}/approval`, {
		method: 'POST', body: { expected_version: expectedVersion }, cookies,
	});
	return entryAnswer(entry, draftId, (approved) => approved.id === procedureId
		&& approved.status === 'approved' && BigInt(approved.version) > BigInt(expectedVersion));
}
