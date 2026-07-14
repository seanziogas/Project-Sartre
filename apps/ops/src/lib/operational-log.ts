export type OpsOperationalField = string | number | boolean | null

export function logOpsEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, OpsOperationalField>,
  write: (line: string) => void = (line) => console.log(line),
): void {
  write(JSON.stringify({ timestamp: new Date().toISOString(), service: 'ops', level, event, fields }))
}

export function safeOperationalMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 300)
}
