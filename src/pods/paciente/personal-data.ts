const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'civil_union'] as const;
const MEDICAL_INSURANCES = ['ips', 'police_health', 'military_health', 'none'] as const;

export type PatientPersonalDataResponse =
	| { marital_status?: never; medical_insurance?: never }
	| { marital_status: typeof MARITAL_STATUSES[number] | null; medical_insurance: typeof MEDICAL_INSURANCES[number] | null };

const isNullableChoice = (value: unknown, choices: readonly string[]) =>
	value === null || (typeof value === 'string' && choices.includes(value));

/** Accept the legacy DTO or the complete additive pair, without allowing other response keys. */
export function hasPatientResponseKeys(value: Record<string, unknown>, baseKeys: readonly string[]): boolean {
	const count = Object.keys(value).length;
	if (!baseKeys.every((key) => Object.hasOwn(value, key))) return false;
	return count === baseKeys.length || (
		count === baseKeys.length + 2
		&& Object.hasOwn(value, 'marital_status') && isNullableChoice(value.marital_status, MARITAL_STATUSES)
		&& Object.hasOwn(value, 'medical_insurance') && isNullableChoice(value.medical_insurance, MEDICAL_INSURANCES)
	);
}
