// What the Console pane shows after a request script ran.

export const NO_ENV_WARNING = 'No active environment — env changes were not saved';

// result: { logs, changes, error? } from the script runner.
export function consoleEntries(result, { secretKeys, envSaved }) {
  const entries = result.logs.map(({ level, text }) => ({ level, text }));
  if (result.error !== undefined) entries.push({ level: 'error', text: result.error });
  if (!result.changes.length) return entries;
  if (!envSaved) return [...entries, { level: 'warn', text: NO_ENV_WARNING }];
  for (const c of result.changes) {
    entries.push({ level: 'info', text: c.op === 'unset' ? `env unset ${c.key}` : `env set ${c.key} = ${secretKeys.has(c.key) ? '••••' : c.value}` });
  }
  return entries;
}
