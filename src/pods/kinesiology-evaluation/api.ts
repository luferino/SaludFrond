import type { AstroCookies } from 'astro';
import { apiFetch } from '../../shared/apiClient';

export interface Antecedents {
	hta?: boolean | null;
	dbt?: boolean | null;
	diu?: boolean | null;
	sedentary_lifestyle?: boolean | null;
	pacemaker?: boolean | null;
	other?: string | null;
}

export interface Study {
	type: string;
	description: string;
	date?: string | null;
}

export interface EvaluationContent {
	admission_date?: string | null;
	admission_status?: string | null;
	illness_history?: string | null;
	medical_diagnosis?: string | null;
	kinesiology_diagnosis?: string | null;
	objectives?: string | null;
	proposed_treatment?: string | null;
	occupation?: string | null;
	referring_physician?: string | null;
	antecedents?: Antecedents;
	studies?: Study[];
}

export interface Patient {
	id: string;
	documento: string;
	nombres: string;
	apellidos: string;
	fecha_nacimiento: string;
	email: string;
	celular: string;
	sexo: string;
	direccion: string;
}

export interface Evaluation {
	id: string;
	clinical_record_id: string;
	patient_id: string;
	author_id: string;
	origin_student_habilitation_id: string;
	origin_subject_id: string;
	origin_group_id: string;
	status: 'draft' | 'submitted' | 'validated';
	content: EvaluationContent;
	patient: Patient | null;
	age: number | null;
	created_at: string;
	updated_at: string;
}

export const EVALUATION_STATUS_LABELS: Record<Evaluation['status'], string> = {
	draft: 'Borrador', submitted: 'Enviada', validated: 'Validada',
};

export interface ConsentSnapshot {
	id: string;
	paper_signature_date: string;
	verified_by: string;
	verified_at: string;
}

/** Immutable snapshot of one submitted version, as returned by the submissions endpoints. */
export interface Submission {
	id: string;
	evaluation_id: string;
	ordinal: number | string;
	submitted_by: string;
	submitted_at: string;
	status: 'pending_validation' | 'validated';
	clinical_content: EvaluationContent;
	studies: Array<{ type: string; description: string; date: string | null }>;
	patient: Patient | null;
	age_at_admission: number | null;
	consent: ConsentSnapshot;
}

/** Version history envelope; items are ordered by ordinal and may be empty. */
export interface SubmissionList {
	evaluation_id: string;
	amendment_of_evaluation_id?: string;
	items: Submission[];
}

export interface CorrectionEvent {
	submission_id: string;
	reason: string;
	reviewed_by: string;
	requested_at: string;
}

/** Correction requests are events associated with immutable submitted versions. */
export interface CorrectionList {
	evaluation_id: string;
	items: CorrectionEvent[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_ID = /^(0|[1-9]\d{0,18})$/;
const MAX_ID = 9223372036854775807n;
const CONTENT_KEYS = [
	'admission_date', 'admission_status', 'illness_history', 'medical_diagnosis',
	'kinesiology_diagnosis', 'objectives', 'proposed_treatment', 'occupation',
	'referring_physician', 'antecedents', 'studies',
];
const ANTECEDENT_KEYS = ['hta', 'dbt', 'diu', 'sedentary_lifestyle', 'pacemaker', 'other'];
const CONSENT_KEYS = ['id', 'paper_signature_date', 'verified_by', 'verified_at'];
const TEXT_FIELDS = [
	'admission_status', 'illness_history', 'medical_diagnosis', 'kinesiology_diagnosis',
	'objectives', 'proposed_treatment', 'occupation', 'referring_physician',
];

export function validateEvaluationContent(value: unknown): EvaluationContent {
	if (!record(value)) throw new Error('El contenido clínico debe ser un objeto.');
	for (const key of Object.keys(value)) {
		if (!CONTENT_KEYS.includes(key)) throw new Error(`Campo clínico desconocido: ${key}`);
	}

	const output: Record<string, unknown> = {};
	if ('admission_date' in value) {
		if (value.admission_date !== null && !calendarDate(value.admission_date)) {
			throw new Error('La fecha de admisión no es válida.');
		}
		output.admission_date = value.admission_date;
	}
	for (const key of TEXT_FIELDS) {
		if (key in value) {
			const field = value[key];
			if (field !== null && typeof field !== 'string') throw new Error(`El campo ${key} debe ser texto o vacío.`);
			output[key] = field;
		}
	}
	if ('antecedents' in value) {
		if (!record(value.antecedents) || Object.keys(value.antecedents).some((key) => !ANTECEDENT_KEYS.includes(key))) {
			throw new Error('Los antecedentes no son válidos.');
		}
		const antecedents: Record<string, boolean | string | null> = {};
		for (const [key, field] of Object.entries(value.antecedents)) {
			if (key === 'other') {
				if (field !== null && typeof field !== 'string') throw new Error('El valor de otros antecedentes no es válido.');
			} else if (field !== null && typeof field !== 'boolean') {
				throw new Error('El valor de un antecedente no es válido.');
			}
			antecedents[key] = field as boolean | string | null;
		}
		output.antecedents = antecedents;
	}
	if ('studies' in value) output.studies = normalizeStudyRows(value.studies);
	return output as EvaluationContent;
}

/** Remove only an untouched empty row; incomplete rows fail without discarding their values. */
export function normalizeStudyRows(value: unknown): Study[] {
	if (!Array.isArray(value)) throw new Error('Los estudios no son válidos.');
	const rows: Study[] = [];
	for (const item of value) {
		if (!record(item) || Object.keys(item).some((key) => !['type', 'description', 'date'].includes(key))) {
			throw new Error('Los estudios no son válidos.');
		}
		const type = item.type;
		const description = item.description;
		const date = item.date;
		if (typeof type !== 'string' || typeof description !== 'string'
			|| (date !== undefined && date !== null && !calendarDate(date))) {
			throw new Error('Completá tipo, descripción y una fecha válida para cada estudio.');
		}
		if (!type.trim() && !description.trim() && (date === undefined || date === null || date === '')) continue;
		if (!type.trim() || !description.trim()) {
			throw new Error('Completá tipo y descripción para cada estudio. Conservamos lo ingresado.');
		}
		rows.push({ type, description, ...(date === undefined ? {} : { date }) });
	}
	return rows;
}

export function antecedentControlValue(value: boolean | null | undefined, isPresent: boolean): string {
	if (!isPresent) return '';
	if (value === null || value === undefined) return 'unknown';
	return String(value);
}

export function antecedentOptionState(value: boolean | null | undefined, isPresent: boolean) {
	return {
		unrecorded: !isPresent,
		unknown: isPresent && value === null,
		yes: value === true,
		no: value === false,
	};
}

export function actionHrefWithContext(actionHref: string, context: Record<string, string>, base = 'http://localhost'): string {
	const url = new URL(actionHref, base);
	for (const [key, value] of Object.entries(context)) url.searchParams.set(key, value);
	return `${url.pathname}${url.search}`;
}

export function isEvaluation(value: unknown): value is Evaluation {
	if (!record(value) || typeof value.id !== 'string' || !validId(value.id)
		|| typeof value.clinical_record_id !== 'string' || !validId(value.clinical_record_id)) return false;
	for (const key of ['patient_id', 'author_id', 'origin_student_habilitation_id', 'origin_subject_id', 'origin_group_id']) {
		if (typeof value[key] !== 'string' || !UUID.test(value[key])) return false;
	}
	if (!['draft', 'submitted', 'validated'].includes(String(value.status)) || !record(value.content)) return false;
	try { validateEvaluationContent(value.content); } catch { return false; }
	if (!(value.patient === null || validPatient(value.patient) && value.patient.id === value.patient_id)) return false;
	if (!(value.age === null || typeof value.age === 'number' && Number.isFinite(value.age))) return false;
	return iso(value.created_at) && iso(value.updated_at);
}

export function isSubmission(value: unknown, evaluationId: string): value is Submission {
	if (!record(value) || typeof value.id !== 'string' || !validId(value.id) || value.evaluation_id !== evaluationId) return false;
	// PostgreSQL bigint ordinals arrive as decimal strings; retain safe numeric responses too.
	if (!(typeof value.ordinal === 'number' && Number.isSafeInteger(value.ordinal) && value.ordinal >= 1
		|| typeof value.ordinal === 'string' && validId(value.ordinal))) return false;
	if (typeof value.submitted_by !== 'string' || !UUID.test(value.submitted_by) || !iso(value.submitted_at)) return false;
	if (!['pending_validation', 'validated'].includes(String(value.status)) || !record(value.clinical_content)) return false;
	try { validateEvaluationContent(value.clinical_content); } catch { return false; }
	if (!Array.isArray(value.studies) || !value.studies.every((study) => record(study)
		&& Object.keys(study).length === 3 && typeof study.type === 'string' && typeof study.description === 'string'
		&& 'date' in study && (study.date === null || calendarDate(study.date)))) return false;
	if (!(value.patient === null || validPatient(value.patient))) return false;
	if (!(value.age_at_admission === null || typeof value.age_at_admission === 'number' && Number.isFinite(value.age_at_admission))) return false;
	const consent = value.consent;
	return record(consent) && Object.keys(consent).every((key) => CONSENT_KEYS.includes(key))
		&& typeof consent.id === 'string' && validId(consent.id)
		&& calendarDate(consent.paper_signature_date)
		&& typeof consent.verified_by === 'string' && UUID.test(consent.verified_by) && iso(consent.verified_at);
}

function validPatient(value: unknown): value is Patient {
	return record(value) && UUID.test(String(value.id))
		&& ['documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'email', 'celular', 'sexo', 'direccion']
			.every((key) => typeof value[key] === 'string');
}
function validId(value: string): boolean { return DECIMAL_ID.test(value) && value !== '0' && BigInt(value) <= MAX_ID; }
function calendarDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function iso(value: unknown): value is string {
	return typeof value === 'string'
		&& /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
		&& Number.isFinite(Date.parse(value));
}
function record(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function contextId(value: string, field: string) {
	if (!UUID.test(value)) throw new Error(`El identificador ${field} no es válido.`);
}
function validateResponse(value: unknown, expected?: { id?: string; patient_id?: string; subject_id?: string; academic_group_id?: string }): Evaluation {
	if (!isEvaluation(value)) throw new Error('El servicio devolvió datos incompletos o desconocidos.');
	if ((expected?.id && value.id !== expected.id)
		|| (expected?.patient_id && value.patient_id !== expected.patient_id)
		|| (expected?.subject_id && value.origin_subject_id !== expected.subject_id)
		|| (expected?.academic_group_id && value.origin_group_id !== expected.academic_group_id)) {
		throw new Error('La respuesta de evaluación no coincide con el contexto solicitado.');
	}
	return value;
}

type EvaluationContext = { patient_id: string; subject_id: string; academic_group_id: string };

/** One read of the list route. The caller chooses the query and validates every row it keeps. */
async function fetchEvaluationItems(query: URLSearchParams, cookies: AstroCookies): Promise<unknown[]> {
	const response = await apiFetch<unknown>(`/kinesiology-evaluations?${query}`, { cookies });
	if (!record(response) || !Array.isArray(response.items)) throw new Error('La respuesta de evaluaciones no es válida.');
	return response.items;
}

async function listContextEvaluations(context: EvaluationContext, cookies: AstroCookies): Promise<Evaluation[]> {
	contextId(context.patient_id, 'paciente');
	contextId(context.subject_id, 'asignatura');
	contextId(context.academic_group_id, 'grupo');
	return (await fetchEvaluationItems(new URLSearchParams(context), cookies)).map((item) => validateResponse(item, context));
}

export async function listEvaluations(context: EvaluationContext, cookies: AstroCookies): Promise<Evaluation[]> {
	return (await listContextEvaluations(context, cookies)).filter((item) => item.status === 'draft');
}

/**
 * Submitted and validated records for the assignment view. Filtered by patient only, so a cross-context
 * reader receives the authorized snapshot with its origin ids. Drafts are excluded here, whatever their origin:
 * the patient-only list can legitimately return the author's own drafts from another assignment. Malformed rows
 * and rows of another patient still throw.
 */
export async function listSubmittedEvaluations(context: EvaluationContext, cookies: AstroCookies): Promise<Evaluation[]> {
	contextId(context.patient_id, 'paciente');
	contextId(context.subject_id, 'asignatura');
	contextId(context.academic_group_id, 'grupo');
	return (await fetchEvaluationItems(new URLSearchParams({ patient_id: context.patient_id }), cookies))
		.map((item) => validateResponse(item, { patient_id: context.patient_id }))
		.filter((item) => item.status !== 'draft');
}

/** Submit the stored draft exactly once. Sends no content: the backend snapshots what is saved. */
export async function submitEvaluation(id: string, cookies: AstroCookies): Promise<Submission> {
	if (!validId(id)) throw new Error('El identificador de ficha no es válido.');
	const response = await apiFetch<unknown>(`/kinesiology-evaluations/${id}/submissions`, { method: 'POST', body: {}, cookies });
	if (!isSubmission(response, id) || response.status !== 'pending_validation') {
		throw new Error('El servicio devolvió datos incompletos o desconocidos.');
	}
	return response;
}

/** Read-only version history for one record. The list is the only source of snapshot detail. */
export async function listSubmissions(evaluationId: string, cookies: AstroCookies): Promise<SubmissionList> {
	if (!validId(evaluationId)) throw new Error('El identificador de ficha no es válido.');
	const response = await apiFetch<unknown>(`/kinesiology-evaluations/${evaluationId}/submissions`, { cookies });
	if (!record(response) || response.evaluation_id !== evaluationId || !Array.isArray(response.items)
		|| (response.amendment_of_evaluation_id !== undefined
			&& (typeof response.amendment_of_evaluation_id !== 'string' || !validId(response.amendment_of_evaluation_id)))) {
		throw new Error('La respuesta de historial no es válida.');
	}
	const items = response.items.map((item) => {
		if (!isSubmission(item, evaluationId)) throw new Error('El historial de versiones no es válido.');
		return item;
	});
	if (items.some((item, index) => index > 0 && BigInt(item.ordinal) <= BigInt(items[index - 1].ordinal))) {
		throw new Error('El historial de versiones no está ordenado.');
	}
	const list: SubmissionList = { evaluation_id: evaluationId, items };
	if (response.amendment_of_evaluation_id !== undefined) list.amendment_of_evaluation_id = response.amendment_of_evaluation_id;
	return list;
}

/** Read correction events without changing the immutable submission snapshots. */
export async function listCorrections(evaluationId: string, cookies: AstroCookies): Promise<CorrectionList> {
	if (!validId(evaluationId)) throw new Error('El identificador de ficha no es válido.');
	const response = await apiFetch<unknown>(`/kinesiology-evaluations/${evaluationId}/corrections`, { cookies });
	if (!record(response) || response.evaluation_id !== evaluationId || !Array.isArray(response.items)) {
		throw new Error('La respuesta de correcciones no es válida.');
	}
	const items = response.items.map((item): CorrectionEvent => {
		if (!record(item) || typeof item.submission_id !== 'string' || !validId(item.submission_id)
			|| typeof item.reason !== 'string' || !item.reason.trim()
			|| typeof item.reviewed_by !== 'string' || !UUID.test(item.reviewed_by)
			|| !iso(item.requested_at)) throw new Error('El historial de correcciones no es válido.');
		return { submission_id: item.submission_id, reason: item.reason, reviewed_by: item.reviewed_by, requested_at: item.requested_at };
	});
	return { evaluation_id: evaluationId, items };
}

export async function getEvaluation(id: string, cookies: AstroCookies): Promise<Evaluation> {
	if (!validId(id)) throw new Error('El identificador de ficha no es válido.');
	return validateResponse(await apiFetch<unknown>(`/kinesiology-evaluations/${id}`, { cookies }), { id });
}

export async function createEvaluation(input: { patient_id: string; subject_id: string; academic_group_id: string; content: unknown }, cookies: AstroCookies): Promise<Evaluation> {
	contextId(input.patient_id, 'paciente');
	contextId(input.subject_id, 'asignatura');
	contextId(input.academic_group_id, 'grupo');
	const body = {
		patient_id: input.patient_id,
		subject_id: input.subject_id,
		academic_group_id: input.academic_group_id,
		content: validateEvaluationContent(input.content),
	};
	return validateResponse(await apiFetch<unknown>('/kinesiology-evaluations', { method: 'POST', body, cookies }), body);
}

export async function updateEvaluation(
	id: string,
	content: unknown,
	cookies: AstroCookies,
	context: { patient_id: string; subject_id: string; academic_group_id: string },
): Promise<Evaluation> {
	if (!validId(id)) throw new Error('El identificador de ficha no es válido.');
	contextId(context.patient_id, 'paciente');
	contextId(context.subject_id, 'asignatura');
	contextId(context.academic_group_id, 'grupo');
	return validateResponse(await apiFetch<unknown>(`/kinesiology-evaluations/${id}`, {
		method: 'PATCH', body: { content: validateEvaluationContent(content) }, cookies,
	}), { id, ...context });
}
