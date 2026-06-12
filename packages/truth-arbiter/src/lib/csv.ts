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

/** Iterate CSV rows as header-keyed field accessors without materializing all lines. */
export function* csvRows(csv: string): Generator<{ get: (col: string) => string | undefined }> {
  const nl = csv.indexOf('\n');
  const header = splitCsvLine(csv.slice(0, nl).trim());
  const idx = new Map(header.map((h, i) => [h, i] as const));
  let from = nl + 1;
  while (from < csv.length) {
    let to = csv.indexOf('\n', from);
    if (to === -1) to = csv.length;
    const line = csv.slice(from, to).replace(/\r$/, '');
    from = to + 1;
    if (!line) continue;
    const f = splitCsvLine(line);
    yield { get: (col: string) => f[idx.get(col) ?? -1] };
  }
}
