import type { AstroCookies } from 'astro';
import { ApiError } from '../../../shared/apiClient';
import { enableHygieneSubject } from '../api';

export type EnableHygieneSubjectResult = { success: true; subject_id: string } | { success: false; uncertain: boolean; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNCERTAIN = 'No se pudo confirmar la habilitación. Recargá la lista antes de volver a intentarlo.';

/**
 * Enables one Odontology subject for this form. Exactly one POST and no retry. Only an outcome the server
 * did not confirm (network, 5xx, or a success body that does not match) is uncertain; every typed answer has its own copy.
 */
export async function handleEnableHygieneSubject(input: { subject_id: string; irreversible_confirmed: 'on' }, context: { cookies: AstroCookies }): Promise<EnableHygieneSubjectResult> {
	if (!UUID.test(input.subject_id)) return { success: false, uncertain: false, error: 'La asignatura no es válida.' };
	try {
		const link = await enableHygieneSubject(input.subject_id, context.cookies);
		return { success: true, subject_id: link.subject_id };
	} catch (error) {
		if (error instanceof ApiError) {
			if (error.status === 401) return { success: false, uncertain: false, error: 'Tu sesión venció. Volvé a iniciar sesión.' };
			if (error.status === 403) return { success: false, uncertain: false, error: 'No tenés permiso para habilitar asignaturas de Higiene y Preventiva II.' };
			if (error.status === 404) return { success: false, uncertain: false, error: 'La asignatura no existe o no es de Odontología.' };
			if (error.status === 409) return { success: false, uncertain: false, error: 'La asignatura ya estaba habilitada.' };
			if (error.status === 400) return { success: false, uncertain: false, error: 'No se pudo habilitar la asignatura. Revisá la selección.' };
		}
		return { success: false, uncertain: true, error: UNCERTAIN };
	}
}
