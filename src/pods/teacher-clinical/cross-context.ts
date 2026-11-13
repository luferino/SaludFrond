import type { AstroCookies } from 'astro';
import { getEvaluation, listSubmittedEvaluations, listSubmissions } from '../kinesiology-evaluation/api';
import type { ClinicalListFilters } from '../kinesiology-evaluation/list-filters';
import { parseClinicalContext, type ClinicalContext } from './api';
import { listSubjects } from '../subject/api';
import { listGroups } from '../group/api';

/** Catalog denial or incomplete coverage leaves the authoritative origin ID visible. */
export async function loadOriginNames(rows: Array<{ origin_subject_id: string; origin_group_id: string }>, cookies: AstroCookies) {
 async function names(ids: string[], list: typeof listSubjects | typeof listGroups) {
  const remaining = new Set(ids);
  const found: Record<string, string> = {};
  for (let offset = 0; remaining.size && offset <= 10000; offset += 100) {
   const result = await list({ limit: 100, offset }, cookies);
   if (result.state !== 'success') break;
   for (const row of result.page.items) if (remaining.delete(row.id)) found[row.id] = row.name;
   if (result.page.items.length < 100) break;
  }
  return found;
 }
 const [subjects, groups] = await Promise.all([
  names(rows.map((row) => row.origin_subject_id), listSubjects),
  names(rows.map((row) => row.origin_group_id), listGroups),
 ]);
 return { subjects, groups };
}

export function otherContext(row: { origin_subject_id: string; origin_group_id: string }, context: ClinicalContext) {
 return row.origin_subject_id !== context.subject_id || row.origin_group_id !== context.academic_group_id;
}

/** Backend authorizes visibility; the UI excludes own-context rows and never offers drafts here. */
export async function listTeacherCrossContextEvaluations(context: ClinicalContext, cookies: AstroCookies, filters?: ClinicalListFilters) {
 return (await listSubmittedEvaluations(context, cookies, filters)).filter((row) => otherContext(row, context));
}

/** Never render live detail content, even when this teacher also has origin access elsewhere. */
export async function getTeacherCrossContextSnapshot(id: string, context: ClinicalContext, cookies: AstroCookies) {
 parseClinicalContext(new URLSearchParams({ ...context }));
 const evaluation = await getEvaluation(id, cookies);
 if (evaluation.patient_id !== context.patient_id || !otherContext(evaluation, context) || evaluation.status === 'draft') {
  throw new Error('La ficha no está disponible.');
 }
 const submission = (await listSubmissions(id, cookies)).items.at(-1);
 const projectedId = (evaluation as unknown as Record<string, unknown>).submission_id;
 if (!submission || (submission.patient && submission.patient.id !== context.patient_id)
  || projectedId !== undefined && submission.id !== projectedId) throw new Error('La versión no está disponible.');
 return { origin_subject_id: evaluation.origin_subject_id, origin_group_id: evaluation.origin_group_id, submission };
}
