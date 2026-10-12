/**
 * Structured JSON logging for Workers Logs / `wrangler tail`.
 *
 * Every log line is a single JSON object with a level, message, timestamp and
 * the bound context (requestId, shop, syncId…). Values under keys that look
 * like credentials are replaced with "[REDACTED]" and token-shaped strings are
 * masked, so a careless `logger.info('x', { headers })` cannot leak secrets.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /(token|secret|password|authorization|cookie|hmac|signature|api[-_]?key|credential|session[-_]?token|id_token|code)$/i;

const TOKEN_PATTERNS: RegExp[] = [
  /shp(at|ca|pa|ss|ua)_[A-Za-z0-9]{8,}/g, // Shopify access tokens
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic tokens
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, // JWTs
];

export function redactString(value: string): string {
  let out = value;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Truncated]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(level: string | undefined, context: Record<string, unknown> = {}): Logger {
  const min = LEVELS[(level as LogLevel) ?? 'info'] ?? LEVELS.info;

  const write = (lvl: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({
      level: lvl,
      message: redactString(message),
      time: new Date().toISOString(),
      ...(redact(context) as Record<string, unknown>),
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    });
    if (lvl === 'error') console.error(line);
    else if (lvl === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (fields) => createLogger(level, { ...context, ...fields }),
  };
}
