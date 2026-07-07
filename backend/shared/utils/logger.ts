/**
 * Structured logging utility for workflow and engine observability.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  workflowId?: string;
  engine?: string;
  plugin?: string;
  operation?: string;
  durationMs?: number;
  status?: string;
}

export class Logger {
  constructor(private readonly scope: string) {}

  private format(level: LogLevel, message: string, context?: LogContext): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...context,
    });
  }

  debug(message: string, context?: LogContext): void {
    console.debug(this.format('debug', message, context));
  }

  info(message: string, context?: LogContext): void {
    console.info(this.format('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.format('warn', message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.format('error', message, context));
  }
}

export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
