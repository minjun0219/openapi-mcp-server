import pino from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

let logger: pino.Logger | null = null;

export function initLogger(level: LogLevel = 'info'): pino.Logger {
  logger = pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination(2),
  );
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    logger = initLogger('info');
  }
  return logger;
}
