import type { ToothFace } from './api';

/** Chart rows as drawn (chosen design `design/hygiene-odontogram/02-chart-inspector.html`): patient's right on the viewer's left. */
export interface ChartRow { label: string; upper: boolean; left: string[]; right: string[] }

const sequence = (from: number, to: number): string[] => {
	const step = from < to ? 1 : -1;
	return Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => String(from + index * step));
};

export const CHART_ROWS: readonly ChartRow[] = [
	{ label: 'Permanentes superiores', upper: true, left: sequence(18, 11), right: sequence(21, 28) },
	{ label: 'Temporales superiores', upper: true, left: sequence(55, 51), right: sequence(61, 65) },
	{ label: 'Temporales inferiores', upper: false, left: sequence(85, 81), right: sequence(71, 75) },
	{ label: 'Permanentes inferiores', upper: false, left: sequence(48, 41), right: sequence(31, 38) },
];

/** Every tooth in reading order of the chart, for keyboard and previous/next navigation. */
export const CHART_ORDER: readonly string[] = CHART_ROWS.flatMap((row) => [...row.left, ...row.right]);

export type FacePosition = 'top' | 'bottom' | 'left' | 'right' | 'center';
export const FACE_POSITIONS: readonly FacePosition[] = ['top', 'bottom', 'left', 'right', 'center'];

/** Polygon points of each face in a 46×46 tooth box; `center` is the 18×18 square at (14,14). */
export const FACE_POLYGONS: Record<Exclude<FacePosition, 'center'>, string> = {
	top: '2,2 44,2 32,14 14,14',
	bottom: '14,32 32,32 44,44 2,44',
	left: '2,2 14,14 14,32 2,44',
	right: '44,2 44,44 32,32 32,14',
};

export function isUpperTooth(code: string): boolean {
	return [1, 2, 5, 6].includes(Math.floor(Number(code) / 10));
}

/**
 * Which anatomical face is drawn at a position. Vestibular faces point away from the occlusal plane;
 * mesial faces point to the midline, so they are on the right for quadrants 1, 4, 5 and 8.
 */
export function faceAt(position: FacePosition, code: string): ToothFace {
	if (position === 'center') return 'occlusal';
	const upper = isUpperTooth(code);
	if (position === 'top') return upper ? 'vestibular' : 'lingual';
	if (position === 'bottom') return upper ? 'lingual' : 'vestibular';
	const mesialOnRight = [1, 4, 5, 8].includes(Math.floor(Number(code) / 10));
	if (position === 'right') return mesialOnRight ? 'mesial' : 'distal';
	return mesialOnRight ? 'distal' : 'mesial';
}
