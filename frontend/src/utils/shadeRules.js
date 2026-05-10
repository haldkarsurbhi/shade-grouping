export const SHADE_THRESHOLDS = [
  { shade: 'A', maxExclusive: 1.25 },
  { shade: 'B', maxExclusive: 2.5 },
  { shade: 'C', maxExclusive: 3.75 },
  { shade: 'D', maxExclusive: 5.0 },
  { shade: 'E', maxExclusive: Number.POSITIVE_INFINITY },
];

const KNOWN_SHADES = new Set(['A', 'B', 'C', 'D', 'E']);

export function shadeFromDeltaE(deltaE) {
  const value = Number(deltaE);
  if (!Number.isFinite(value)) return 'A';
  if (value < 1.25) return 'A';
  if (value < 2.5) return 'B';
  if (value < 3.75) return 'C';
  if (value < 5.0) return 'D';
  return 'E';
}

export function normalizeShade(shade, deltaE) {
  const s = String(shade ?? '').trim().toUpperCase();
  if (s === 'GROUP A') return 'A';
  if (s === 'GROUP B') return 'B';
  if (s === 'GROUP C') return 'C';
  if (s === 'GROUP D') return 'D';
  if (s === 'GROUP E') return 'E';
  if (s === 'REJECT') return 'E';
  if (KNOWN_SHADES.has(s)) return s;
  return shadeFromDeltaE(deltaE);
}

export function decisionFromShade(shade) {
  const s = normalizeShade(shade);
  if (s === 'E') return 'REJECT';
  if (s === 'D') return 'HOLD';
  return 'ACCEPT';
}

export function normalizeInspectionRecord(row) {
  const normalizedShade = normalizeShade(row?.shade ?? row?.shadeGroup, row?.deltaE);
  return {
    ...row,
    shade: normalizedShade,
    shadeGroup: normalizedShade,
    decision: decisionFromShade(normalizedShade),
  };
}
