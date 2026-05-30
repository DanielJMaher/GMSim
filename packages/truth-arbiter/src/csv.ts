/** Minimal CSV helpers shared by the dataset mergers (combine, outcomes). */

/** Split one CSV line, respecting double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Parse a CSV cell as a number; '', 'NA', non-numeric → null. */
export function csvNum(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '' || t === 'NA') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
