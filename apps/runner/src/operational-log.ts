export type OperationalLevel = 'info' | 'warn' | 'error'
export type OperationalField = string | number | boolean | null

export interface OperationalEvent {
  timestamp: string
  service: 'runner'
  level: OperationalLevel
  event: string
  fields?: Record<string, OperationalField>
}

export function createOperationalLogger(
  write: (line: string) => void = (line) => console.log(line),
  now: () => Date = () => new Date(),
) {
  return (level: OperationalLevel, event: string, fields?: Record<string, OperationalField>): void => {
    const value: OperationalEvent = {
      timestamp: now().toISOString(), service: 'runner', level, event,
      ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
    }
    write(JSON.stringify(value))
  }
}
