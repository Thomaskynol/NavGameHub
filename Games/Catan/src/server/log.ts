// Log mínimo em stdout (JSON por linha). Nunca logar recovery codes/tokens.
function line(level: 'info' | 'error', msg: string, fields?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, msg, ...fields };
  const text = JSON.stringify(entry);
  if (level === 'error') console.error(text);
  else console.log(text);
}

export function logInfo(msg: string, fields?: Record<string, unknown>): void {
  line('info', msg, fields);
}

export function logError(msg: string, fields?: Record<string, unknown>): void {
  line('error', msg, fields);
}
