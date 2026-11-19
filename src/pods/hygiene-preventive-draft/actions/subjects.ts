// Placeholder registered by the parent so the action exists; T5 replaces this with the real handler and its tests.
export async function handleEnableHygieneSubject(_input: { subject_id: string; irreversible_confirmed: 'on' }, _context: unknown): Promise<{ success: false; error: string }> {
	return { success: false, error: 'No disponible todavía.' };
}
