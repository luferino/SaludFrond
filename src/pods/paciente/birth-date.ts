export const birthDateError = 'Ingresa una fecha válida en formato dd/mm/yyyy que no sea posterior a hoy.';

// Keep the existing UTC date boundary for both rendering and validation.
export function parseBirthDate(value: string, maximum = new Date().toISOString().split('T')[0]): string | null {
	const match = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(value);
	if (!match || match[0] !== value) return null;
	const [, day, month, year] = match;
	const y = Number(year);
	const m = Number(month);
	const d = Number(day);
	if (y < 1 || m < 1 || m > 12 || d < 1) return null;
	const leapYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
	const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	const iso = `${year}-${month}-${day}`;
	return d <= daysInMonth[m - 1] && iso <= maximum ? iso : null;
}
