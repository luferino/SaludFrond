import type { AstroCookies } from 'astro';
import { apiFetch, ApiError } from '../../shared/apiClient';
import { realClinicalDate } from '../kinesiology-evaluation/list-filters';

/** Yes/No and free-text fields of each Oral Surgery I section, in form order (backend contract). */
export const ORAL_SURGERY_SECTIONS = {
	medical_history: {
		booleans: [
			'hospitalized', 'taking_medication', 'has_disease', 'cardiopathy', 'myocardial_infarction', 'angina',
			'pacemaker', 'hypertension', 'asthma', 'sinusitis', 'dialysis', 'medication_allergy', 'anesthetic_allergy',
			'food_allergy', 'previous_dental_anesthesia', 'anemia', 'hemorrhage', 'hematomas', 'epilepsy', 'convulsions',
			'nervous_disease', 'tuberculosis', 'syphilis', 'hepatitis', 'pregnant', 'prenatal_care',
		],
		texts: [
			'consultation_reason', 'hospitalization_reason', 'medication', 'medication_duration', 'disease_description',
			'other_anesthesia_procedures', 'nervous_disease_type', 'other_infectious_diseases', 'pregnancy_duration', 'other_diseases',
		],
	},
	complementary_tests: {
		booleans: ['laboratory', 'periapical_radiographs', 'panoramic_radiographs', 'tomography'],
		texts: ['blood_group'],
	},
	extraoral_exam: {
		booleans: ['facial_symmetry'],
		texts: ['skin', 'nose', 'eyes', 'ears', 'salivary_glands', 'lymph_nodes', 'maxillary_sinus'],
	},
	intraoral_exam: {
		booleans: [],
		texts: ['lips', 'periodontium', 'tongue', 'oral_mucosa', 'mouth_opening', 'prosthesis', 'other'],
	},
	preoperative: {
		booleans: ['vital'],
		texts: [
			'tooth', 'cc_rr', 'multiple_teeth', 'crown_condition', 'root_condition', 'gingival_mucosa', 'tooth_diagnosis',
			'systolic_pressure', 'diastolic_pressure', 'pulse_per_minute', 'temperature',
		],
	},
	treatment_plan: {
		booleans: [],
		texts: ['procedure', 'anomalies_or_pathology'],
	},
} as const satisfies Record<string, { booleans: readonly string[]; texts: readonly string[] }>;

export type OralSurgerySectionName = keyof typeof ORAL_SURGERY_SECTIONS;
export type OralSurgerySection = Record<string, boolean | string | null>;
/** Absent keys mean "not answered" just like null; both are kept exactly as stored. */
export type OralSurgeryContent = { admission_date?: string | null } & Partial<Record<OralSurgerySectionName, OralSurgerySection>>;

export interface OralSurgeryContext { patient_id: string; subject_id: string; academic_group_id: string }

export interface OralSurgeryDraft {
	id: string;
	clinical_record_id: string;
	patient_id: string;
	author_id: string;
	origin_student_habilitation_id: string;
	origin_subject_id: string;
	origin_group_id: string;
	content: OralSurgeryContent;
	status: 'draft';
	version: string;
	created_at: string;
	updated_at: string;
}

export interface ConsentDeclaration {
	id: string;
	draft_id: string;
	draft_version: string;
	plan_revision: string;
	treatment_plan: OralSurgerySection | null;
	declared_by: string;
	declared_at: string;
}

export interface ConsentHistory {
	draft_version: string;
	plan_revision: string;
	current_declaration_id: string | null;
	declarations: ConsentDeclaration[];
}

export interface Authorization {
	id: string;
	draft_id: string;
	draft_version: string;
	consent_declaration_id: string;
	reviewed_content: OralSurgeryContent;
	authorized_by: string;
	teacher_habilitation_id: string;
	authorized_at: string;
}

export interface AuthorizationHistory {
	draft_version: string;
	current_authorization_id: string | null;
	authorizations: Authorization[];
}

/** Operative report content in form order (backend contract): `fields: null` is a top-level text, otherwise a section of texts. */
export const OPERATIVE_REPORT_LAYOUT = [
	{ key: 'narrative', fields: null },
	{ key: 'asepsis', fields: ['extraoral', 'intraoral'] },
	{ key: 'anesthesia', fields: ['technique', 'drug', 'dose'] },
	{ key: 'extraction', fields: ['teeth', 'technique', 'suture'] },
	{ key: 'prescription', fields: ['medications', 'commercial_name', 'route', 'dose', 'frequency', 'duration'] },
	{ key: 'postoperative_instructions', fields: null },
	{ key: 'operative_incident', fields: null },
] as const satisfies readonly { key: string; fields: readonly string[] | null }[];

export type OperativeReportSection = Record<string, string | null>;
/** Absent keys stay absent; the server neither fills nor scores them. */
export type OperativeReportContent = Record<string, string | null | OperativeReportSection>;

export interface OperativeReport {
	draft_id: string;
	draft_version: string;
	authorization_id: string;
	content: OperativeReportContent;
	version: string;
	status: 'draft' | 'closed';
	created_by: string;
	created_at: string;
	updated_at: string;
	closed_by: string | null;
	closed_at: string | null;
	teacher_habilitation_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ID = 9223372036854775807n;
const MAX_TEXT = 4000;
const SECTION_NAMES = Object.keys(ORAL_SURGERY_SECTIONS) as OralSurgerySectionName[];
const DRAFT_KEYS = [
	'id', 'clinical_record_id', 'patient_id', 'author_id', 'origin_student_habilitation_id', 'origin_subject_id',
	'origin_group_id', 'content', 'status', 'version', 'created_at', 'updated_at',
];
const DECLARATION_KEYS = ['id', 'draft_id', 'draft_version', 'plan_revision', 'treatment_plan', 'declared_by', 'declared_at'];
const AUTHORIZATION_KEYS = [
	'id', 'draft_id', 'draft_version', 'consent_declaration_id', 'reviewed_content', 'authorized_by', 'teacher_habilitation_id', 'authorized_at',
];
const REPORT_KEYS = [
	'draft_id', 'draft_version', 'authorization_id', 'content', 'version', 'status', 'created_by', 'created_at', 'updated_at',
	'closed_by', 'closed_at', 'teacher_habilitation_id',
];
const CONFIRMATION_ERROR = 'El resultado no se pudo confirmar. Consultá el estado antes de volver a intentarlo.';

/** Positive BIGINT decimal string: the only accepted form for draft ids, versions and history ids. */
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
function calendarDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validText(key: string, answer: unknown) {
	if (answer !== null && typeof answer !== 'string') throw new Error(`El campo ${key} debe ser texto o vacío.`);
	if (typeof answer === 'string' && answer.includes('\u0000')) throw new Error(`El campo ${key} contiene caracteres no permitidos.`);
	if (typeof answer === 'string' && [...answer].length > MAX_TEXT) throw new Error(`El campo ${key} supera los ${MAX_TEXT} caracteres.`);
}

function validateSection(name: OralSurgerySectionName, value: unknown): OralSurgerySection {
	if (!record(value)) throw new Error(`La sección ${name} no es válida.`);
	const { booleans, texts } = ORAL_SURGERY_SECTIONS[name] as { booleans: readonly string[]; texts: readonly string[] };
	const output: OralSurgerySection = {};
	for (const [key, answer] of Object.entries(value)) {
		if (booleans.includes(key)) {
			if (answer !== null && typeof answer !== 'boolean') throw new Error(`La respuesta ${key} debe ser Sí, No o sin responder.`);
		} else if (texts.includes(key)) {
			validText(key, answer);
		} else {
			throw new Error(`Campo clínico desconocido: ${name}.${key}`);
		}
		output[key] = answer as boolean | string | null;
	}
	return output;
}

/** Validate replacement content against the contract; keeps absent and null answers exactly as given. */
export function validateOralSurgeryContent(value: unknown): OralSurgeryContent {
	if (!record(value)) throw new Error('El contenido clínico debe ser un objeto.');
	const output: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(value)) {
		if (key === 'admission_date') {
			if (field !== null && !calendarDate(field)) throw new Error('La fecha de ingreso no es válida.');
			output.admission_date = field;
		} else if ((SECTION_NAMES as string[]).includes(key)) {
			output[key] = validateSection(key as OralSurgerySectionName, field);
		} else {
			throw new Error(`Sección clínica desconocida: ${key}`);
		}
	}
	return output as OralSurgeryContent;
}

function validContent(value: unknown): boolean {
	try { validateOralSurgeryContent(value); return true; } catch { return false; }
}

/** Validate operative report content: every leaf is text or null, sections may be empty or partial. */
export function validateOperativeReportContent(value: unknown): OperativeReportContent {
	if (!record(value)) throw new Error('El contenido del parte quirúrgico debe ser un objeto.');
	const output: OperativeReportContent = {};
	for (const [key, field] of Object.entries(value)) {
		const entry = OPERATIVE_REPORT_LAYOUT.find((item) => item.key === key);
		if (!entry) throw new Error(`Campo del parte quirúrgico desconocido: ${key}`);
		if (entry.fields === null) {
			validText(key, field);
			output[key] = field as string | null;
			continue;
		}
		if (!record(field)) throw new Error(`La sección ${key} del parte quirúrgico no es válida.`);
		const section: OperativeReportSection = {};
		for (const [name, answer] of Object.entries(field)) {
			if (!(entry.fields as readonly string[]).includes(name)) throw new Error(`Campo del parte quirúrgico desconocido: ${key}.${name}`);
			validText(`${key}.${name}`, answer);
			section[name] = answer as string | null;
		}
		output[key] = section;
	}
	return output;
}

function validReportContent(value: unknown): boolean {
	try { validateOperativeReportContent(value); return true; } catch { return false; }
}

/** Exactly the 12 contract keys; the three closure fields are all null while open and all set once closed. */
export function isOperativeReport(value: unknown, draftId: string): value is OperativeReport {
	if (!record(value) || !exactKeys(value, REPORT_KEYS)) return false;
	const open = value.status === 'draft' && value.closed_by === null && value.closed_at === null && value.teacher_habilitation_id === null;
	const closed = value.status === 'closed' && uuid(value.closed_by) && iso(value.closed_at) && uuid(value.teacher_habilitation_id);
	return value.draft_id === draftId && validId(value.draft_version) && validId(value.authorization_id) && validId(value.version)
		&& validReportContent(value.content) && uuid(value.created_by) && iso(value.created_at) && iso(value.updated_at)
		&& (open || closed);
}

export function isOralSurgeryDraft(value: unknown): value is OralSurgeryDraft {
	return record(value) && exactKeys(value, DRAFT_KEYS)
		&& validId(value.id) && validId(value.clinical_record_id) && validId(value.version)
		&& ['patient_id', 'author_id', 'origin_student_habilitation_id', 'origin_subject_id', 'origin_group_id'].every((key) => uuid(value[key]))
		&& value.status === 'draft' && validContent(value.content)
		&& iso(value.created_at) && iso(value.updated_at);
}

function validateContext(context: OralSurgeryContext) {
	if (!uuid(context.patient_id) || !uuid(context.subject_id) || !uuid(context.academic_group_id)) {
		throw new Error('El contexto de paciente, asignatura y grupo no es válido.');
	}
}

function draftResponse(value: unknown, expected: { id?: string; context?: OralSurgeryContext }): OralSurgeryDraft {
	if (!isOralSurgeryDraft(value)) throw new Error('El servicio devolvió datos incompletos o desconocidos.');
	if ((expected.id && value.id !== expected.id)
		|| (expected.context && (value.patient_id !== expected.context.patient_id
			|| value.origin_subject_id !== expected.context.subject_id
			|| value.origin_group_id !== expected.context.academic_group_id))) {
		throw new Error('El borrador recibido no coincide con el contexto solicitado.');
	}
	return value;
}

/** One page of drafts in one origin context, newest id first. The response carries no paging metadata. */
export async function listOralSurgeryDrafts(
	context: OralSurgeryContext,
	cookies: AstroCookies,
	page: { limit: number; offset: number },
	filters?: { date_from?: string; date_to?: string },
): Promise<OralSurgeryDraft[]> {
	validateContext(context);
	if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100
		|| !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 2147483647) {
		throw new Error('La paginación no es válida.');
	}
	const query = new URLSearchParams({ ...context, limit: String(page.limit), offset: String(page.offset) });
	if (filters?.date_from !== undefined) {
		if (!realClinicalDate(filters.date_from)) throw new Error('El rango de fechas no es válido.');
		query.set('date_from', filters.date_from);
	}
	if (filters?.date_to !== undefined) {
		if (!realClinicalDate(filters.date_to)) throw new Error('El rango de fechas no es válido.');
		query.set('date_to', filters.date_to);
	}
	if (filters?.date_from && filters.date_to && filters.date_from > filters.date_to) throw new Error('El rango de fechas no es válido.');
	const response = await apiFetch<unknown>(`/oral-surgery-drafts?${query}`, { cookies });
	if (!record(response) || !exactKeys(response, ['items']) || !Array.isArray(response.items)) {
		throw new Error('La respuesta de borradores no es válida.');
	}
	return response.items.map((item) => draftResponse(item, { context }));
}

/** Administrator consultation: one page of every visible draft, newest id first, with no origin context. */
export async function listAllOralSurgeryDrafts(
	cookies: AstroCookies,
	page: { limit: number; offset: number },
	filters?: { date_from?: string; date_to?: string },
): Promise<OralSurgeryDraft[]> {
	if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100
		|| !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 2147483647) {
		throw new Error('La paginación no es válida.');
	}
	const query = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
	for (const key of ['date_from', 'date_to'] as const) {
		const value = filters?.[key];
		if (value === undefined) continue;
		if (!realClinicalDate(value)) throw new Error('El rango de fechas no es válido.');
		query.set(key, value);
	}
	if (filters?.date_from && filters.date_to && filters.date_from > filters.date_to) throw new Error('El rango de fechas no es válido.');
	const response = await apiFetch<unknown>(`/oral-surgery-drafts?${query}`, { cookies });
	if (!record(response) || !exactKeys(response, ['items']) || !Array.isArray(response.items)) {
		throw new Error('La respuesta de borradores no es válida.');
	}
	return response.items.map((item) => draftResponse(item, {}));
}

export async function getOralSurgeryDraft(id: string, cookies: AstroCookies): Promise<OralSurgeryDraft> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	return draftResponse(await apiFetch<unknown>(`/oral-surgery-drafts/${id}`, { cookies }), { id });
}

/** Every call creates a new clinical encounter; callers resume existing drafts by id instead of retrying. */
export async function createOralSurgeryDraft(input: OralSurgeryContext & { content: unknown }, cookies: AstroCookies): Promise<OralSurgeryDraft> {
	const context = { patient_id: input.patient_id, subject_id: input.subject_id, academic_group_id: input.academic_group_id };
	validateContext(context);
	const body = { ...context, content: validateOralSurgeryContent(input.content) };
	return draftResponse(await apiFetch<unknown>('/oral-surgery-drafts', { method: 'POST', body, cookies }), { context });
}

/** Replace the whole content; a stale expected_version is rejected by the backend with 409 and nothing is stored. */
export async function updateOralSurgeryDraft(
	id: string,
	expectedVersion: string,
	content: unknown,
	context: OralSurgeryContext,
	cookies: AstroCookies,
): Promise<OralSurgeryDraft> {
	if (!validId(id) || !validId(expectedVersion)) throw new Error('El borrador o su versión no es válido.');
	validateContext(context);
	const body = { expected_version: expectedVersion, content: validateOralSurgeryContent(content) };
	const draft = draftResponse(await apiFetch<unknown>(`/oral-surgery-drafts/${id}`, { method: 'PATCH', body, cookies }), { id, context });
	if (BigInt(draft.version) <= BigInt(expectedVersion)) throw new Error(CONFIRMATION_ERROR);
	return draft;
}

function isDeclaration(value: unknown, draftId: string): value is ConsentDeclaration {
	return record(value) && exactKeys(value, DECLARATION_KEYS)
		&& validId(value.id) && value.draft_id === draftId && validId(value.draft_version) && validId(value.plan_revision)
		&& (value.treatment_plan === null || validContent({ treatment_plan: value.treatment_plan }))
		&& uuid(value.declared_by) && iso(value.declared_at);
}

export async function getConsentHistory(id: string, cookies: AstroCookies): Promise<ConsentHistory> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/consent`, { cookies });
	if (!record(value) || !exactKeys(value, ['draft_version', 'plan_revision', 'current_declaration_id', 'declarations'])
		|| !validId(value.draft_version) || !validId(value.plan_revision) || !Array.isArray(value.declarations)
		|| !value.declarations.every((item) => isDeclaration(item, id))
		|| !(value.current_declaration_id === null
			|| validId(value.current_declaration_id) && value.declarations.some((item) => item.id === value.current_declaration_id))) {
		throw new Error('La respuesta de consentimiento no es válida.');
	}
	return value as unknown as ConsentHistory;
}

/** Attest that signed paper consent exists for this version. Not an electronic signature; no document is sent. */
export async function declarePaperConsent(id: string, expectedVersion: string, cookies: AstroCookies): Promise<ConsentDeclaration> {
	if (!validId(id) || !validId(expectedVersion)) throw new Error('El borrador o su versión no es válido.');
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/consent`, {
		method: 'POST', body: { expected_version: expectedVersion, paper_signed: true }, cookies,
	});
	if (!isDeclaration(value, id) || value.draft_version !== expectedVersion) throw new Error(CONFIRMATION_ERROR);
	return value;
}

function isAuthorization(value: unknown, draftId: string): value is Authorization {
	return record(value) && exactKeys(value, AUTHORIZATION_KEYS)
		&& validId(value.id) && value.draft_id === draftId && validId(value.draft_version) && validId(value.consent_declaration_id)
		&& validContent(value.reviewed_content) && uuid(value.authorized_by) && uuid(value.teacher_habilitation_id) && iso(value.authorized_at);
}

export async function getAuthorizationHistory(id: string, cookies: AstroCookies): Promise<AuthorizationHistory> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/authorizations`, { cookies });
	if (!record(value) || !exactKeys(value, ['draft_version', 'current_authorization_id', 'authorizations'])
		|| !validId(value.draft_version) || !Array.isArray(value.authorizations)
		|| !value.authorizations.every((item) => isAuthorization(item, id))
		|| !(value.current_authorization_id === null
			|| validId(value.current_authorization_id) && value.authorizations.some((item) => item.id === value.current_authorization_id))) {
		throw new Error('La respuesta de autorizaciones no es válida.');
	}
	return value as unknown as AuthorizationHistory;
}

/** Teacher authorization of the exact version reviewed, bound to one current consent declaration. */
export async function authorizeOralSurgeryDraft(
	id: string,
	expectedVersion: string,
	consentDeclarationId: string,
	cookies: AstroCookies,
): Promise<Authorization> {
	if (!validId(id) || !validId(expectedVersion) || !validId(consentDeclarationId)) {
		throw new Error('El borrador, su versión o la declaración no es válida.');
	}
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/authorizations`, {
		method: 'POST',
		body: { expected_version: expectedVersion, consent_declaration_id: consentDeclarationId, paper_consent_verified: true },
		cookies,
	});
	if (!isAuthorization(value, id) || value.draft_version !== expectedVersion || value.consent_declaration_id !== consentDeclarationId) {
		throw new Error(CONFIRMATION_ERROR);
	}
	return value;
}

/** The encounter's operative report, or null when none was saved yet. Callers load the draft first, so 404 means "no report". */
export async function getOperativeReport(id: string, cookies: AstroCookies): Promise<OperativeReport | null> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	let value: unknown;
	try {
		value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/operative-report`, { cookies });
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	}
	if (!isOperativeReport(value, id)) throw new Error('La respuesta del parte quirúrgico no es válida.');
	return value;
}

/** First save of the report, bound to the clinical version the student loaded. Never retried: a second create is a 409. */
export async function createOperativeReport(
	id: string,
	expectedDraftVersion: string,
	content: unknown,
	cookies: AstroCookies,
): Promise<OperativeReport> {
	if (!validId(id) || !validId(expectedDraftVersion)) throw new Error('El borrador o su versión no es válido.');
	const body = { expected_draft_version: expectedDraftVersion, content: validateOperativeReportContent(content) };
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/operative-report`, { method: 'POST', body, cookies });
	if (!isOperativeReport(value, id) || value.status !== 'draft' || value.draft_version !== expectedDraftVersion) throw new Error(CONFIRMATION_ERROR);
	return value;
}

/** Replace the whole report content; both versions must still be current or the backend answers 409 and stores nothing. */
export async function updateOperativeReport(
	id: string,
	expectedVersion: string,
	expectedDraftVersion: string,
	content: unknown,
	cookies: AstroCookies,
): Promise<OperativeReport> {
	if (!validId(id) || !validId(expectedVersion) || !validId(expectedDraftVersion)) throw new Error('El parte o sus versiones no son válidos.');
	const body = { expected_version: expectedVersion, expected_draft_version: expectedDraftVersion, content: validateOperativeReportContent(content) };
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/operative-report`, { method: 'PATCH', body, cookies });
	if (!isOperativeReport(value, id) || value.status !== 'draft' || value.draft_version !== expectedDraftVersion
		|| BigInt(value.version) <= BigInt(expectedVersion)) {
		throw new Error(CONFIRMATION_ERROR);
	}
	return value;
}

/** Teacher closure of the exact report and clinical versions reviewed. Irreversible through the API. */
export async function closeOperativeReport(
	id: string,
	expectedVersion: string,
	expectedDraftVersion: string,
	cookies: AstroCookies,
): Promise<OperativeReport> {
	if (!validId(id) || !validId(expectedVersion) || !validId(expectedDraftVersion)) throw new Error('El parte o sus versiones no son válidos.');
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/operative-report/close`, {
		method: 'POST', body: { expected_version: expectedVersion, expected_draft_version: expectedDraftVersion }, cookies,
	});
	if (!isOperativeReport(value, id) || value.status !== 'closed' || value.draft_version !== expectedDraftVersion
		|| BigInt(value.version) <= BigInt(expectedVersion)) {
		throw new Error(CONFIRMATION_ERROR);
	}
	return value;
}

/** Practical rubric in S2 order: 12 integer items whose maxima total 20. The server computes the total and outcome. */
export const PRACTICAL_RUBRIC = [
	{ key: 'hand_washing', max: 1 },
	{ key: 'barrier_elements', max: 1 },
	{ key: 'waste_disposal', max: 1 },
	{ key: 'clinical_table_setup', max: 2 },
	{ key: 'asepsis', max: 1 },
	{ key: 'anamnesis_questionnaire', max: 3 },
	{ key: 'anesthetic_technique', max: 2 },
	{ key: 'sindesmotomy_elevators', max: 2 },
	{ key: 'surgical_procedure', max: 3 },
	{ key: 'curettage_suture', max: 2 },
	{ key: 'record_and_equipment', max: 1 },
	{ key: 'relationship', max: 1 },
] as const;

export type PracticalKey = (typeof PRACTICAL_RUBRIC)[number]['key'];
export type PracticalItems = Record<PracticalKey, number>;
export type PracticalOutcome = 'approved' | 'annulled';

/** Totals at or above this value are approved; below it the practical is annulled. */
export const PRACTICAL_PASSING_TOTAL = 15;
export const PRACTICAL_MAX_TOTAL = PRACTICAL_RUBRIC.reduce((sum, item) => sum + item.max, 0);

export function practicalTotal(items: PracticalItems): number {
	return PRACTICAL_RUBRIC.reduce((sum, { key }) => sum + items[key], 0);
}

export function practicalOutcome(total: number): PracticalOutcome {
	return total >= PRACTICAL_PASSING_TOTAL ? 'approved' : 'annulled';
}

/** One grade of the encounter. `reason` is null only on revision 1; later revisions carry the audited reason for the change. */
export interface PracticalRevision {
	revision: string;
	items: PracticalItems;
	total: number;
	outcome: PracticalOutcome;
	reason: string | null;
	graded_by: string;
	teacher_habilitation_id: string;
	graded_at: string;
}

/** What the student sees: the current grade only, with no history or reasons. */
export type PracticalCurrent = Pick<PracticalRevision, 'items' | 'total' | 'outcome' | 'graded_at'>;
export interface PracticalStudentView { current: PracticalCurrent }
export interface PracticalInstructorView { current: PracticalRevision; history: PracticalRevision[] }

const PRACTICAL_KEYS: string[] = PRACTICAL_RUBRIC.map(({ key }) => key);
const PRACTICAL_REVISION_KEYS = ['revision', 'items', 'total', 'outcome', 'reason', 'graded_by', 'teacher_habilitation_id', 'graded_at'];
const PRACTICAL_CURRENT_KEYS = ['items', 'total', 'outcome', 'graded_at'];
const MAX_PRACTICAL_REASON = 4000;
const PRACTICAL_ITEMS_ERROR = 'Los puntajes de la evaluación práctica no son válidos.';
const PRACTICAL_REASON_ERROR = 'El motivo debe tener entre 1 y 4000 caracteres, sin caracteres nulos.';
const PRACTICAL_VIEW_ERROR = 'La respuesta de la evaluación práctica no es válida.';

function validScore(score: unknown, max: number): boolean {
	return typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= max;
}

/** Exactly the 12 rubric keys, each an integer from 0 to its maximum. */
function validItems(value: unknown): value is PracticalItems {
	return record(value) && exactKeys(value, PRACTICAL_KEYS)
		&& PRACTICAL_RUBRIC.every(({ key, max }) => validScore(value[key], max));
}

/** Items must be valid, the total must be their sum, and the outcome must follow the threshold. */
function consistentScore(items: unknown, total: unknown, outcome: unknown): boolean {
	if (!validItems(items) || typeof total !== 'number') return false;
	return total === practicalTotal(items) && outcome === practicalOutcome(total);
}

/** Items in rubric order, ready to send; anything else is refused before a request. */
function practicalItems(value: unknown): PracticalItems {
	if (!validItems(value)) throw new Error(PRACTICAL_ITEMS_ERROR);
	const items = {} as PracticalItems;
	for (const { key } of PRACTICAL_RUBRIC) items[key] = value[key];
	return items;
}

function sameItems(a: PracticalItems, b: PracticalItems): boolean {
	return PRACTICAL_RUBRIC.every(({ key }) => a[key] === b[key]);
}

/** Reason as sent: trimmed, non-empty, at most 4000 code points, and no NUL. */
export function practicalReason(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\u0000')) throw new Error(PRACTICAL_REASON_ERROR);
	const text = value.trim();
	if (text === '' || [...text].length > MAX_PRACTICAL_REASON) throw new Error(PRACTICAL_REASON_ERROR);
	return text;
}

function validReason(value: unknown): boolean {
	try { practicalReason(value); return true; } catch { return false; }
}

function isPracticalRevision(value: unknown): value is PracticalRevision {
	if (!record(value) || !exactKeys(value, PRACTICAL_REVISION_KEYS)) return false;
	return validId(value.revision) && consistentScore(value.items, value.total, value.outcome)
		&& (value.revision === '1' ? value.reason === null : validReason(value.reason))
		&& uuid(value.graded_by) && uuid(value.teacher_habilitation_id) && iso(value.graded_at);
}

function sameRevision(a: PracticalRevision, b: PracticalRevision): boolean {
	return a.revision === b.revision && a.total === b.total && a.outcome === b.outcome && a.reason === b.reason
		&& a.graded_by === b.graded_by && a.teacher_habilitation_id === b.teacher_habilitation_id && a.graded_at === b.graded_at
		&& sameItems(a.items, b.items);
}

function isPracticalStudentView(value: unknown): value is PracticalStudentView {
	if (!record(value) || !exactKeys(value, ['current'])) return false;
	const current = value.current;
	if (!record(current) || !exactKeys(current, PRACTICAL_CURRENT_KEYS)) return false;
	return consistentScore(current.items, current.total, current.outcome) && iso(current.graded_at);
}

/** Revisions ascend consecutively from '1' and the current revision is exactly the last history entry. */
function isPracticalInstructorView(value: unknown): value is PracticalInstructorView {
	if (!record(value) || !exactKeys(value, ['current', 'history']) || !Array.isArray(value.history)) return false;
	const history: unknown[] = value.history;
	if (history.length === 0 || !history.every(isPracticalRevision)) return false;
	const revisions = history as PracticalRevision[];
	const current = value.current;
	return revisions.every((item, index) => item.revision === String(index + 1))
		&& isPracticalRevision(current) && sameRevision(current, revisions[revisions.length - 1]);
}

/** The caller's view of the encounter's practical grade; null means no grade exists yet. Other 404s are rethrown. */
export async function getPracticalEvaluation(
	id: string,
	cookies: AstroCookies,
): Promise<PracticalStudentView | PracticalInstructorView | null> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	let value: unknown;
	try {
		value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/practical-evaluation`, { cookies });
	} catch (error) {
		if (error instanceof ApiError && error.status === 404 && error.message === 'oral surgery practical evaluation was not found') return null;
		throw error;
	}
	if (!isPracticalStudentView(value) && !isPracticalInstructorView(value)) throw new Error(PRACTICAL_VIEW_ERROR);
	return value;
}

/** The first grade of the encounter: one POST of all 12 items. The response must be revision 1 with the same items. */
export async function gradePracticalEvaluation(id: string, items: unknown, cookies: AstroCookies): Promise<PracticalRevision> {
	if (!validId(id)) throw new Error('El identificador de borrador no es válido.');
	const checked = practicalItems(items);
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/practical-evaluation`, { method: 'POST', body: { items: checked }, cookies });
	if (!isPracticalRevision(value) || value.revision !== '1' || !sameItems(value.items, checked)) throw new Error(CONFIRMATION_ERROR);
	return value;
}

/** Correction against the revision the teacher saw. The response must be the next revision with the same reason and items. */
export async function correctPracticalEvaluation(
	id: string,
	expectedRevision: string,
	reason: unknown,
	items: unknown,
	cookies: AstroCookies,
): Promise<PracticalRevision> {
	if (!validId(id) || !validId(expectedRevision)) throw new Error('El borrador o la revisión no son válidos.');
	const text = practicalReason(reason);
	const checked = practicalItems(items);
	const next = (BigInt(expectedRevision) + 1n).toString();
	const value = await apiFetch<unknown>(`/oral-surgery-drafts/${id}/practical-evaluation/corrections`, {
		method: 'POST', body: { expected_revision: expectedRevision, reason: text, items: checked }, cookies,
	});
	if (!isPracticalRevision(value) || value.revision !== next || value.reason !== text || !sameItems(value.items, checked)) {
		throw new Error(CONFIRMATION_ERROR);
	}
	return value;
}
