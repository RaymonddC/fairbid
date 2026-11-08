// One JSON line per log entry. Cloud Run reads `severity` and `message` from it, so
// errors show up as errors in Logging and every field can be filtered on.
// Never log secrets, session tokens, or a sealed bid's price.

type Severity = "INFO" | "WARNING" | "ERROR";

function describe(error: unknown) {
  if (error instanceof Error) {
    const extra = error as Error & { status?: number; issue?: string; debugId?: string; code?: string };
    return {
      name: error.name,
      error: error.message,
      status: extra.status,
      issue: extra.issue,
      debugId: extra.debugId,
      code: extra.code,
      stack: error.stack?.split("\n").slice(0, 6).join("\n"),
    };
  }
  return { error: String(error) };
}

function write(severity: Severity, message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ severity, message, ...fields, time: new Date().toISOString() });
  if (severity === "ERROR") console.error(line);
  else console.log(line);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write("INFO", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("WARNING", message, fields),
  error: (message: string, error: unknown, fields?: Record<string, unknown>) =>
    write("ERROR", message, { ...fields, ...describe(error) }),
};
