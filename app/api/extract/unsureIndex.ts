// A long tax statement is read in parts and the parts' lines are joined
// in order. Each part numbers its own lines from 0, so an unsure path
// such as "lines[2].tax_due" from the third part has to be shifted by
// the number of lines in the parts before it. Without the shift the
// review screen would highlight the wrong line, and the line the model
// was actually unsure about would look settled.
export function mergeUnsureFields(
  parts: Array<{ lines?: unknown; unsure_fields?: unknown }>
): string[] {
  let lineOffset = 0;
  const unsure: string[] = [];
  for (const part of parts) {
    const offset = lineOffset;
    const fields = Array.isArray(part.unsure_fields) ? part.unsure_fields.map(String) : [];
    for (const field of fields) {
      unsure.push(field.replace(/\blines\[(\d+)\]/g, (_m, n) => `lines[${Number(n) + offset}]`));
    }
    lineOffset += Array.isArray(part.lines) ? part.lines.length : 0;
  }
  return [...new Set(unsure)];
}
