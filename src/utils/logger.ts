export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  child: (context: string) => Logger;
}

function shouldLog(configured: LogLevel, target: LogLevel): boolean {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  return levels.indexOf(target) >= levels.indexOf(configured);
}

function safeMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta-unserializable]";
  }
}

export function createLogger(context = "pipeline", level: LogLevel = "info"): Logger {
  const write = (target: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (!shouldLog(level, target)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${target.toUpperCase()}] [${context}] ${message}${safeMeta(meta)}`;

    if (target === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
      return;
    }

    if (target === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(line);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (nextContext: string) => createLogger(`${context}:${nextContext}`, level),
  };
}
