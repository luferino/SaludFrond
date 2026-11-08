import type { OralSurgerySectionName } from './api';

/** Spanish UI copy for each Oral Surgery I section and field; keys follow the backend contract. */
export const ORAL_SURGERY_SECTION_LABELS: Record<OralSurgerySectionName, string> = {
	medical_history: 'Historia médica',
	complementary_tests: 'Exámenes complementarios',
	extraoral_exam: 'Examen extraoral',
	intraoral_exam: 'Examen intraoral',
	preoperative: 'Evaluación preoperatoria',
	treatment_plan: 'Plan de tratamiento',
};

export const ORAL_SURGERY_FIELD_LABELS: Record<OralSurgerySectionName, Record<string, string>> = {
	medical_history: {
		consultation_reason: 'Motivo de consulta',
		hospitalized: '¿Estuvo internado/a?',
		hospitalization_reason: 'Motivo de la internación',
		taking_medication: '¿Toma medicación?',
		medication: 'Medicación',
		medication_duration: 'Desde cuándo la toma',
		has_disease: '¿Padece alguna enfermedad?',
		disease_description: 'Descripción de la enfermedad',
		cardiopathy: 'Cardiopatía',
		myocardial_infarction: 'Infarto de miocardio',
		angina: 'Angina de pecho',
		pacemaker: 'Marcapasos',
		hypertension: 'Hipertensión',
		asthma: 'Asma',
		sinusitis: 'Sinusitis',
		dialysis: 'Diálisis',
		medication_allergy: 'Alergia a medicamentos',
		anesthetic_allergy: 'Alergia a anestésicos',
		food_allergy: 'Alergia a alimentos',
		previous_dental_anesthesia: '¿Recibió anestesia dental antes?',
		other_anesthesia_procedures: 'Otros procedimientos con anestesia',
		anemia: 'Anemia',
		hemorrhage: 'Hemorragias',
		hematomas: 'Hematomas',
		epilepsy: 'Epilepsia',
		convulsions: 'Convulsiones',
		nervous_disease: 'Enfermedad nerviosa',
		nervous_disease_type: 'Tipo de enfermedad nerviosa',
		tuberculosis: 'Tuberculosis',
		syphilis: 'Sífilis',
		hepatitis: 'Hepatitis',
		other_infectious_diseases: 'Otras enfermedades infecciosas',
		pregnant: '¿Está embarazada?',
		pregnancy_duration: 'Tiempo de embarazo',
		prenatal_care: '¿Tiene control prenatal?',
		other_diseases: 'Otras enfermedades',
	},
	complementary_tests: {
		laboratory: 'Laboratorio',
		blood_group: 'Grupo sanguíneo',
		periapical_radiographs: 'Radiografías periapicales',
		panoramic_radiographs: 'Radiografías panorámicas',
		tomography: 'Tomografía',
	},
	extraoral_exam: {
		facial_symmetry: 'Simetría facial',
		skin: 'Piel',
		nose: 'Nariz',
		eyes: 'Ojos',
		ears: 'Oídos',
		salivary_glands: 'Glándulas salivales',
		lymph_nodes: 'Ganglios linfáticos',
		maxillary_sinus: 'Seno maxilar',
	},
	intraoral_exam: {
		lips: 'Labios',
		periodontium: 'Periodonto',
		tongue: 'Lengua',
		oral_mucosa: 'Mucosa bucal',
		mouth_opening: 'Apertura bucal',
		prosthesis: 'Prótesis',
		other: 'Otros',
	},
	preoperative: {
		tooth: 'Pieza dentaria',
		vital: 'Pieza vital',
		cc_rr: 'CC/RR',
		multiple_teeth: 'Piezas múltiples',
		crown_condition: 'Estado de la corona',
		root_condition: 'Estado de la raíz',
		gingival_mucosa: 'Mucosa gingival',
		tooth_diagnosis: 'Diagnóstico de la pieza',
		systolic_pressure: 'Presión sistólica',
		diastolic_pressure: 'Presión diastólica',
		pulse_per_minute: 'Pulso por minuto',
		temperature: 'Temperatura',
	},
	treatment_plan: {
		procedure: 'Procedimiento',
		anomalies_or_pathology: 'Anomalías o patología',
	},
};

/** Readable value of one stored answer; absent and null both mean "not answered". */
export function oralSurgeryAnswerLabel(value: boolean | string | null | undefined): string {
	if (value === true) return 'Sí';
	if (value === false) return 'No';
	if (value === null || value === undefined) return 'Sin responder';
	return value === '' ? '(vacío)' : value;
}

/** Date and time of a history entry, formatted like the rest of the clinical pages (server locale 'es'). */
export function oralSurgeryTimestampLabel(value: string): string {
	return new Date(value).toLocaleString('es');
}
