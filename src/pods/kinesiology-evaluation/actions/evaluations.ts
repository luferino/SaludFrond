import type { AstroCookies } from 'astro';
import { listAssignedPatients, parseAssignmentPagination } from '../../patient-assignment/api';
import { createEvaluation, getEvaluation, updateEvaluation, validateEvaluationContent, type EvaluationContent } from '../api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9]\d{0,18}$/;
const MAX_ID = 9223372036854775807n;
const FIELDS = new Set([
	'admission_date', 'admission_status', 'occupation', 'referring_physician',
	'antecedent-hta', 'antecedent-dbt', 'antecedent-diu', 'antecedent-sedentary_lifestyle',
	'antecedent-pacemaker', 'antecedent-other', 'antecedents_keys', 'illness_history', 'medical_diagnosis',
	'kinesiology_diagnosis', 'objectives', 'proposed_treatment', 'id', 'assignment_id', 'limit', 'offset',
]);
const ANTECEDENTS = ['hta', 'dbt', 'diu', 'sedentary_lifestyle', 'pacemaker'];

function validUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function validId(value: unknown): value is string { return typeof value === 'string' && ID.test(value) && BigInt(value) <= MAX_ID; }
function nullableText(value: unknown): string | null {
	// Astro normalizes blank optional native controls to undefined.
	if (value === undefined) return null;
	if (typeof value !== 'string') throw new Error('Revisá los campos del formulario.');
	return value === '' ? null : value;
}
function antecedent(value: unknown): boolean | null {
	if (value === 'unknown') return null;
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new Error('Revisá las opciones de antecedentes.');
}

/** Convert native, named form controls to the supported replacement content. */
export function rawEvaluationContentFromForm(input: Record<string, unknown>): EvaluationContent {
	for (const key of Object.keys(input)) {
		if (!FIELDS.has(key) && !/^study-(?:type|description|date)-\d+$/.test(key)) {
			throw new Error(`Campo de formulario no permitido: ${key}`);
		}
	}
	const date = nullableText(input.admission_date);
	const originalAntecedents = new Set(typeof input.antecedents_keys === 'string' ? input.antecedents_keys.split(',').filter(Boolean) : []);
	const rawAntecedents: Record<string, boolean | string | null> = {};
	for (const key of ANTECEDENTS) {
		const value = input[`antecedent-${key}`];
		if (!Object.hasOwn(input, `antecedent-${key}`)) continue;
		if (value === '' || value === undefined) {
			if (originalAntecedents.has(key)) rawAntecedents[key] = null;
			continue;
		}
		rawAntecedents[key] = antecedent(value);
	}
	if (Object.hasOwn(input, 'antecedent-other') && (originalAntecedents.has('other')
		|| (typeof input['antecedent-other'] === 'string' && input['antecedent-other'] !== ''))) {
		rawAntecedents.other = nullableText(input['antecedent-other']);
	}
	const studies: Array<{ type: string; description: string; date: string | null }> = [];
	const indices = new Set(Object.keys(input).flatMap((key) => {
		const match = /^study-(?:type|description|date)-(\d+)$/.exec(key);
		return match ? [match[1]] : [];
	}));
	for (const index of [...indices].sort((a, b) => Number(a) - Number(b))) {
		const type = input[`study-type-${index}`];
		const description = input[`study-description-${index}`];
		const studyDate = input[`study-date-${index}`];
		studies.push({
			type: typeof type === 'string' ? type : '',
			description: typeof description === 'string' ? description : '',
			date: typeof studyDate === 'string' && studyDate !== '' ? studyDate : null,
		});
	}
	const candidate: Record<string, unknown> = {
		admission_date: date,
		admission_status: nullableText(input.admission_status),
		occupation: nullableText(input.occupation),
		referring_physician: nullableText(input.referring_physician),
		illness_history: nullableText(input.illness_history),
		medical_diagnosis: nullableText(input.medical_diagnosis),
		kinesiology_diagnosis: nullableText(input.kinesiology_diagnosis),
		objectives: nullableText(input.objectives),
		proposed_treatment: nullableText(input.proposed_treatment),
		studies,
	};
	if (Object.keys(rawAntecedents).length) candidate.antecedents = rawAntecedents;
	return candidate as EvaluationContent;
}

export function evaluationContentFromForm(input: Record<string, unknown>): EvaluationContent {
	return validateEvaluationContent(rawEvaluationContentFromForm(input));
}

function safeError(error: unknown): string {
	if (error && typeof error === 'object' && 'status' in error) {
		const status = (error as { status: number }).status;
		if (status === 400) return 'Revisá los datos clínicos ingresados.';
		if (status === 401) return 'Tu sesión venció. Iniciá sesión nuevamente.';
		if (status === 403) return 'No tenés permiso para modificar esta ficha.';
		if (status === 404) return 'La ficha no está disponible en este contexto.';
		if (status === 409) return 'Esta ficha ya no está en borrador.';
	}
	return error instanceof Error && /Campo de formulario|Completá|Revisá/.test(error.message)
		? error.message
		: 'No se pudo guardar la ficha. Intentá nuevamente más tarde.';
}

async function selectedAssignment(input: Record<string, unknown>, cookies: AstroCookies) {
	if (!validId(input.assignment_id)) throw new Error('La asignación seleccionada no es válida.');
	const params = new URLSearchParams({ limit: String(input.limit ?? ''), offset: String(input.offset ?? '') });
	const pagination = parseAssignmentPagination(params);
	const page = await listAssignedPatients(pagination, cookies);
	const assignment = page.items.find((item) => item.id === input.assignment_id && item.ended_at === null);
	if (!assignment) throw new Error('La asignación ya no está disponible.');
	return assignment;
}

export async function handleCreateKinesiologyEvaluation(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	if (!validUuid(input.patient_id) || !validUuid(input.subject_id) || !validUuid(input.academic_group_id)) {
		return { success: false as const, error: 'Revisá el contexto de paciente, asignatura y grupo.' };
	}
	try {
		const assignment = await selectedAssignment(input, context.cookies);
		if (assignment.patient_id !== input.patient_id || assignment.subject_id !== input.subject_id
			|| assignment.academic_group_id !== input.academic_group_id) {
			return { success: false as const, error: 'La asignación ya no coincide con este paciente y su contexto.' };
		}
		let content = input.content;
		if (typeof content === 'string') {
			try { content = JSON.parse(content); } catch { throw new Error('El contenido del borrador no es válido.'); }
		}
		const evaluation = await createEvaluation({
			patient_id: assignment.patient_id,
			subject_id: assignment.subject_id,
			academic_group_id: assignment.academic_group_id,
			content,
		}, context.cookies);
		return { success: true as const, evaluation };
	} catch (error) { return { success: false as const, error: safeError(error) }; }
}

export async function handleUpdateKinesiologyEvaluation(input: Record<string, unknown>, context: { cookies: AstroCookies }) {
	if (!validId(input.id)) return { success: false as const, error: 'El identificador de ficha no es válido.' };
	let content: EvaluationContent | undefined;
	try {
		content = rawEvaluationContentFromForm(input);
		const assignment = await selectedAssignment(input, context.cookies);
		const record = await getEvaluation(input.id, context.cookies);
		if (record.id !== input.id || record.patient_id !== assignment.patient_id
			|| record.origin_subject_id !== assignment.subject_id || record.origin_group_id !== assignment.academic_group_id) {
			return { success: false as const, error: 'La ficha no pertenece a esta asignación. Conservamos los valores enviados.', content };
		}
		if (record.status !== 'draft') return { success: false as const, error: 'Esta ficha ya no está en borrador. Conservamos los valores enviados.', content };
		content = validateEvaluationContent(content);
		const evaluation = await updateEvaluation(input.id, content, context.cookies, {
			patient_id: assignment.patient_id,
			subject_id: assignment.subject_id,
			academic_group_id: assignment.academic_group_id,
		});
		return { success: true as const, evaluation };
	} catch (error) {
		const message = safeError(error);
		return { success: false as const, error: content ? `${message} Conservamos los valores enviados.` : message, content };
	}
}
