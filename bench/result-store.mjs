export function mergeCheckpointRows(existing, incoming) {
  const key = (row) => `${row.model}\0${row.task}\0${row.input}\0${row.output}`;
  const updates = new Map(incoming.map((row) => [key(row), row]));
  return [...existing.filter((row) => !updates.has(key(row))), ...incoming];
}

export function newestCompleteRun(entries) {
  return entries
    .filter((entry) => entry.complete === true)
    .sort((a, b) => b.filename.localeCompare(a.filename))[0] ?? null;
}
