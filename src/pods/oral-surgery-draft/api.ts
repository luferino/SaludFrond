import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';
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

function validateSection(name: OralSurgerySectionName, value: unknown): OralSurgerySection {
	if (!record(value)) throw new Error(`La sección ${name} no es válida.`);
	const { booleans, texts } = ORAL_SURGERY_SECTIONS[name] as { booleans: readonly string[]; texts: readonly string[] };
	const output: OralSurgerySection = {};
	for (const [key, answer] of Object.entries(value)) {
		if (booleans.includes(key)) {
			if (answer !== null && typeof answer !== 'boolean') throw new Error(`La respuesta ${key} debe ser Sí, No o sin responder.`);
		} else if (texts.includes(key)) {
			if (answer !== null && typeof answer !== 'string') throw new Error(`El campo ${key} debe ser texto o vacío.`);
			if (typeof answer === 'string' && answer.includes('\u0000')) throw new Error(`El campo ${key} contiene caracteres no permitidos.`);
			if (typeof answer === 'string' && [...answer].length > MAX_TEXT) throw new Error(`El campo ${key} supera los ${MAX_TEXT} caracteres.`);
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
