import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { parseClinicalContext, teacherGrant, type ClinicalContext } from '../../teacher-clinical/api';
import {
	correctPracticalEvaluation,
	getOperativeReport,
	getOralSurgeryDraft,
	getPracticalEvaluation,
	gradePracticalEvaluation,
	PRACTICAL_RUBRIC,
	practicalReason,
	validId,
	type PracticalItems,
} from '../api';
import { isTyped, type FormValues } from './drafts';

/** Spanish copy for the practical evaluation. Uncertain outcomes never claim that nothing was stored. */
export const PRACTICAL_COPY = {
	formInput: 'Revisá los campos de la evaluación práctica.',
	identifiers: 'El borrador o la revisión no son válidos.',
	context: 'El contexto clínico no es válido.',
	scores: 'Revisá los puntajes: cada ítem debe ser un número entero desde 0 hasta su máximo.',
	reason: 'Escribí un motivo de hasta 4000 caracteres, sin caracteres nulos.',
	forbidden: 'No tenés permiso para calificar este práctico.',
	role: 'Solo un docente instructor puede calificar el práctico.',
	session: 'Tu sesión venció. Iniciá sesión nuevamente.',
	unavailable: 'El borrador no está disponible en este contexto de origen.',
	reportOpen: 'El parte quirúrgico debe estar cerrado antes de calificar el práctico.',
	reportMissing: 'No hay un parte quirúrgico cerrado en este encuentro.',
	alreadyExists: 'Ya existe una evaluación práctica para este encuentro. Recargá la página para ver la calificación vigente.',
	changed: 'La evaluación práctica cambió. Recargá la página para ver la revisión vigente antes de corregir.',
	missing: 'No hay una evaluación práctica para corregir en este encuentro.',
	badRequest: 'Revisá los datos de la evaluación práctica.',
	generic: 'No se pudo completar la acción. Intentá nuevamente más tarde.',
	readFailure: 'No se pudo verificar la evaluación práctica. No se guardó nada.',
	uncertain: 'No se pudo confirmar el guardado de la evaluación práctica. Recargá la página antes de volver a intentarlo; no repetimos el envío automáticamente.',
} as const;

const GRADE_PERMISSION = 'oral-surgery-drafts:grade';
/** Form control names of the 12 score selects, in rubric order. */
export const PRACTICAL_EVALUATION_FORM_FIELDS: string[] = PRACTICAL_RUBRIC.map(({ key }) => key);
const GRADE_FIELDS = ['id', 'patient_id', 'subject_id', 'academic_group_id', ...PRACTICAL_EVALUATION_FORM_FIELDS];
const CORRECT_FIELDS = [...GRADE_FIELDS, 'expected_revision', 'reason'];

export type PracticalSuccess = { success: true; id: string } & ClinicalContext;
/** `values` are the submitted controls, so a page can re-render them; `conflict` marks a stale view that needs a reload. */
export interface PracticalFailure { success: false; uncertain: boolean; conflict: boolean; error: string; values: FormValues }

function submittedValues(input: Record<string, unknown>, names: string[]): FormValues {
	const values: FormValues = {};
	for (const name of names) {
		const raw = input[name];
		values[name] = typeof raw === 'string' ? raw : '';
	}
	return values;
}

function onlyFields(input: Record<string, unknown>, allowed: string[]): boolean {
	return Object.keys(input).every((key) => allowed.includes(key));
}

function selectedContext(input: Record<string, unknown>): ClinicalContext | null {
	const text = (key: string) => (typeof input[key] === 'string' ? input[key] as string : '');
	try {
		return parseClinicalContext(new URLSearchParams({ patient_id: text('patient_id'), subject_id: text('subject_id'), academic_group_id: text('academic_group_id') }));
	} catch {
		return null;
	}
}

/** Canonical decimal integers only, each within its item's maximum; anything else is refused before any request. */
function scoreItems(input: Record<string, unknown>): PracticalItems | null {
	const items = {} as PracticalItems;
	for (const { key, max } of PRACTICAL_RUBRIC) {
		const raw = input[key];
		if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw) || Number(raw) > max) return null;
		items[key] = Number(raw);
	}
	return items;
}

function reasonOrNull(value: unknown): string | null {
	try {
		return practicalReason(value);
	} catch {
		return null;
	}
}

function sameOrigin(draft: { patient_id: string; origin_subject_id: string; origin_group_id: string }, selected: ClinicalContext): boolean {
	return draft.patient_id === selected.patient_id
		&& draft.origin_subject_id === selected.subject_id
		&& draft.origin_group_id === selected.academic_group_id;
}

/** Reads happen before any write: a rejected session or a missing draft are typed, anything else means nothing was stored. */
function readRejection(error: unknown): string {
	if (error instanceof ApiError && error.status === 401) return PRACTICAL_COPY.session;
	if (error instanceof ApiError && error.status === 404 && error.message === 'oral surgery draft was not found') return PRACTICAL_COPY.unavailable;
	return PRACTICAL_COPY.readFailure;
}

/** Typed backend rejections of the write, each with its own copy; null means the outcome is unknown. */
function writeRejection(error: unknown): { error: string; conflict: boolean } | null {
	if (!(error instanceof ApiError) || !isTyped(error)) return null;
	const { message } = error;
	if (error.status === 400) {
		if (message.startsWith('reason must be')) return { error: PRACTICAL_COPY.reason, conflict: false };
		if (/^(missing|unknown) practical item: /.test(message) || /^\S+ must be an integer from 0 to \d+$/.test(message)) {
			return { error: PRACTICAL_COPY.scores, conflict: false };
		}
		return { error: PRACTICAL_COPY.badRequest, conflict: false };
	}
	if (error.status === 401) return { error: PRACTICAL_COPY.session, conflict: false };
	if (error.status === 403) {
		return { error: message === 'teacher instructor role required' ? PRACTICAL_COPY.role : PRACTICAL_COPY.forbidden, conflict: false };
	}
	if (error.status === 404) {
		return { error: message === 'oral surgery draft was not found' ? PRACTICAL_COPY.unavailable : PRACTICAL_COPY.generic, conflict: false };
	}
	if (error.status === 409) {
		if (message === 'operative report must be closed before practical evaluation') return { error: PRACTICAL_COPY.reportOpen, conflict: true };
		if (message === 'practical evaluation already exists; reload before grading') return { error: PRACTICAL_COPY.alreadyExists, conflict: true };
		if (message === 'practical evaluation changed; reload before correcting') return { error: PRACTICAL_COPY.changed, conflict: true };
		return { error: PRACTICAL_COPY.generic, conflict: true };
	}
	return { error: PRACTICAL_COPY.generic, conflict: false };
}

/**
 * Teacher's first grade: re-read the draft (context must match), the closed report and the current evaluation, then send
 * exactly one POST with the 12 items. Never retried.
 */
export async function handleGradePracticalEvaluation(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<PracticalSuccess | PracticalFailure> {
	const values = submittedValues(input, PRACTICAL_EVALUATION_FORM_FIELDS);
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean } = {}): PracticalFailure => ({
		success: false, uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error, values,
	});
	if (!teacherGrant(context.cookies, GRADE_PERMISSION)) return failure(PRACTICAL_COPY.forbidden);
	if (!onlyFields(input, GRADE_FIELDS)) return failure(PRACTICAL_COPY.formInput);
	if (!validId(input.id)) return failure(PRACTICAL_COPY.identifiers);
	const selected = selectedContext(input);
	if (!selected) return failure(PRACTICAL_COPY.context);
	const items = scoreItems(input);
	if (!items) return failure(PRACTICAL_COPY.scores);
	const id = input.id;
	let writing = false;
	try {
		const draft = await getOralSurgeryDraft(id, context.cookies);
		if (!sameOrigin(draft, selected)) return failure(PRACTICAL_COPY.unavailable);
		const report = await getOperativeReport(id, context.cookies);
		if (!report) return failure(PRACTICAL_COPY.reportMissing);
		if (report.status !== 'closed') return failure(PRACTICAL_COPY.reportOpen);
		if (await getPracticalEvaluation(id, context.cookies)) return failure(PRACTICAL_COPY.alreadyExists, { conflict: true });
		writing = true;
		await gradePracticalEvaluation(id, items, context.cookies);
		return { success: true, id, ...selected };
	} catch (error) {
		if (!writing) return failure(readRejection(error));
		const rejection = writeRejection(error);
		return rejection ? failure(rejection.error, { conflict: rejection.conflict }) : failure(PRACTICAL_COPY.uncertain, { uncertain: true });
	}
}

/**
 * Teacher correction: same re-reads, and the evaluation's current revision must equal the one the teacher submitted.
 * Exactly one POST with the expected revision, the trimmed reason and the 12 items. Never retried.
 */
export async function handleCorrectPracticalEvaluation(input: Record<string, unknown>, context: { cookies: AstroCookies }): Promise<PracticalSuccess | PracticalFailure> {
	const values = submittedValues(input, [...PRACTICAL_EVALUATION_FORM_FIELDS, 'expected_revision', 'reason']);
	const failure = (error: string, detail: { uncertain?: boolean; conflict?: boolean } = {}): PracticalFailure => ({
		success: false, uncertain: detail.uncertain ?? false, conflict: detail.conflict ?? false, error, values,
	});
	if (!teacherGrant(context.cookies, GRADE_PERMISSION)) return failure(PRACTICAL_COPY.forbidden);
	if (!onlyFields(input, CORRECT_FIELDS)) return failure(PRACTICAL_COPY.formInput);
	if (!validId(input.id) || !validId(input.expected_revision)) return failure(PRACTICAL_COPY.identifiers);
	const selected = selectedContext(input);
	if (!selected) return failure(PRACTICAL_COPY.context);
	const reason = reasonOrNull(input.reason);
	if (reason === null) return failure(PRACTICAL_COPY.reason);
	const items = scoreItems(input);
	if (!items) return failure(PRACTICAL_COPY.scores);
	const id = input.id;
	const expectedRevision = input.expected_revision;
	let writing = false;
	try {
		const draft = await getOralSurgeryDraft(id, context.cookies);
		if (!sameOrigin(draft, selected)) return failure(PRACTICAL_COPY.unavailable);
		const report = await getOperativeReport(id, context.cookies);
		if (!report) return failure(PRACTICAL_COPY.reportMissing);
		if (report.status !== 'closed') return failure(PRACTICAL_COPY.reportOpen);
		const view = await getPracticalEvaluation(id, context.cookies);
		if (!view) return failure(PRACTICAL_COPY.missing);
		if (!('history' in view)) return failure(PRACTICAL_COPY.readFailure);
		if (view.current.revision !== expectedRevision) return failure(PRACTICAL_COPY.changed, { conflict: true });
		writing = true;
		await correctPracticalEvaluation(id, expectedRevision, reason, items, context.cookies);
		return { success: true, id, ...selected };
	} catch (error) {
		if (!writing) return failure(readRejection(error));
		const rejection = writeRejection(error);
		return rejection ? failure(rejection.error, { conflict: rejection.conflict }) : failure(PRACTICAL_COPY.uncertain, { uncertain: true });
	}
}
