import type {
	FaceMark, HygieneIndexName, HygieneProcedureStatus, HygieneSigner, LoeSilnessCategory, LoeSilnessSite, OlearyCategory, OlearySurface, ToothFace, ToothState,
} from './api';

/** Spanish UI copy for Hygiene and Preventive Dentistry II; keys follow the backend contract. */
export const HYGIENE_FORM_TITLE = 'Higiene y Preventiva II';

export const HYGIENE_SECTION_LABELS = {
	medical_history: 'Antecedentes médicos',
	odontogram: 'Odontograma',
	indices: 'Índices',
	plaque: 'Índices de placa',
} as const;

/** Plaque indices: the two sections, their site and surface copy, and the category copy of each result. */
export const HYGIENE_PLAQUE_SECTION_LABELS: Record<'loe_silness' | 'oleary', string> = { loe_silness: 'Löe-Silness', oleary: "O'Leary" };
export const LOE_SILNESS_SITE_LABELS: Record<LoeSilnessSite, string> = {
	distal: 'Distal', vestibular: 'Vestibular', mesial: 'Mesial', lingual: 'Lingual / palatino',
};
export const OLEARY_SURFACE_LABELS: Record<OlearySurface, string> = {
	mesial: 'Mesial', distal: 'Distal', vestibular: 'Vestibular', lingual: 'Lingual / palatino',
};
export const LOE_SILNESS_CATEGORY_LABELS: Record<LoeSilnessCategory, string> = { low: 'POCA', moderate: 'MODERADA', abundant: 'ABUNDANTE' };
export const OLEARY_CATEGORY_LABELS: Record<OlearyCategory, string> = { good: 'BUENO', fair: 'REGULAR', poor: 'MALO' };

/** Consent signer and procedure status copy. */
export const HYGIENE_SIGNER_LABELS: Record<HygieneSigner, string> = { patient: 'Paciente', parent: 'Madre, padre o tutor' };
export const HYGIENE_PROCEDURE_STATUS_LABELS: Record<HygieneProcedureStatus, string> = { pending: 'Pendiente', approved: 'Aprobado' };

/** Question copy for each yes/no answer; its `<name>_detail` text uses HYGIENE_DETAIL_LABEL. */
export const HYGIENE_QUESTION_LABELS: Record<string, string> = {
	taking_medication: '¿Toma algún medicamento?',
	allergy_local_anesthetic: '¿Es alérgico/a a la anestesia local?',
	allergy_penicillin: '¿Es alérgico/a a la penicilina?',
	allergy_other_medication: '¿Es alérgico/a a otro medicamento?',
	dental_treatment_problem: '¿Tuvo problemas en tratamientos dentales anteriores?',
	cardiovascular_disease: 'Enfermedad cardiovascular',
	diabetes: 'Diabetes',
	hypertension: 'Hipertensión',
	renal_disease: 'Enfermedad renal',
	tuberculosis: 'Tuberculosis',
	venereal_disease: 'Enfermedad venérea',
	blood_disease: 'Enfermedad de la sangre',
	other_disease: 'Otra enfermedad',
	pregnant: '¿Está embarazada?',
};
export const HYGIENE_DETAIL_LABEL = 'Detalle';
export const HYGIENE_TEXT_LABELS: Record<string, string> = {
	treating_physician: 'Médico tratante',
	observations: 'Observaciones',
};

/** Tri-state answer copy: omitted (not captured) and null (unanswered) read the same to people, but are stored apart. */
export function hygieneAnswerLabel(value: boolean | string | null | undefined): string {
	if (value === true) return 'Sí';
	if (value === false) return 'No';
	return 'Sin responder';
}

export const TOOTH_STATE_LABELS: Record<ToothState, string> = { present: 'Presente', absent: 'Ausente', to_extract: 'A extraer' };
export const UNRECORDED_TOOTH_LABEL = 'Sin registrar';
export const TOOTH_FACE_LABELS: Record<ToothFace, string> = {
	occlusal: 'Oclusal / incisal',
	mesial: 'Mesial',
	distal: 'Distal',
	vestibular: 'Vestibular',
	lingual: 'Lingual / palatina',
};
export const FACE_MARK_LABELS: Record<FaceMark, string> = { caries: 'Caries', filled: 'Obturada' };

export const HYGIENE_INDEX_LABELS: Record<HygieneIndexName, string> = {
	ceo_d: 'ceo-d (dentición temporal)',
	cpo_d: 'CPO-D (dentición permanente)',
	cpo_first_molars: 'CPO de primeros molares',
};
export const HYGIENE_COMPONENT_LABELS: Record<string, string> = { c: 'Cariadas', e: 'Extracción indicada', p: 'Perdidas', o: 'Obturadas' };

export function hygieneTimestampLabel(value: string): string {
	return new Date(value).toLocaleString('es');
}
