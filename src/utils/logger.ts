/**
 * Sentinel Security Platform - Enterprise Structured Logger
 * 
 * Supports standard severity levels, masks confidential tokens/keys automatically,
 * and standardizes JSON output for production observability stacks like Google Cloud Logging.
 */

// Keys that must never be exposed or printed in plain text
const SENSITIVE_KEYS = [
  "secret",
  "apikey",
  "authorization",
  "x-api-key",
  "gemini_api_key",
  "password",
  "token",
  "bearer"
];

/**
 * Sanitizes and masks sensitive properties in nested parameters recursively.
 */
export function sanitize(data: any): any {
  if (!data) return data;
  if (typeof data !== "object") {
    // If it's a string resembling a standard secret key or bearer token, mask it
    if (typeof data === "string") {
      const lower = data.toLowerCase();
      if (lower.startsWith("sn_live_") && data.length > 15) {
        return "sn_live_************************" + data.slice(-4);
      }
      if (lower.startsWith("bearer ") && data.length > 15) {
        return "Bearer ************************" + data.slice(-4);
      }
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitize(item));
  }

  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    if (SENSITIVE_KEYS.some(sk => keyLower.includes(sk))) {
      if (typeof val === "string" && val.length > 8) {
        cleaned[key] = val.substring(0, 8) + "****************" + val.slice(-4);
      } else {
        cleaned[key] = "********";
      }
    } else {
      cleaned[key] = sanitize(val);
    }
  }
  return cleaned;
}

export class StructuredLogger {
  private category: string;

  constructor(category = "App") {
    this.category = category;
  }

  private write(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string, meta: any = {}) {
    const timestamp = new Date().toISOString();
    const sanitizedMeta = sanitize(meta);

    const logEntry = {
      timestamp,
      level,
      category: this.category,
      message,
      ...sanitizedMeta
    };

    const serialized = JSON.stringify(logEntry);
    
    if (level === "ERROR") {
      console.error(serialized);
    } else {
      console.log(serialized);
    }
  }

  public info(message: string, meta?: any) {
    this.write("INFO", message, meta);
  }

  public warn(message: string, meta?: any) {
    this.write("WARN", message, meta);
  }

  public error(message: string, meta?: any) {
    this.write("ERROR", message, meta);
  }

  public debug(message: string, meta?: any) {
    this.write("DEBUG", message, meta);
  }

  /**
   * Performance Helper to measure execute latency and alert on threshold exceeding
   */
  public profile<T>(
    name: string,
    promiseFn: () => Promise<T>,
    slowThresholdMs = 2000,
    meta: any = {}
  ): Promise<T> {
    const startTime = Date.now();
    return promiseFn().then(
      (result) => {
        const duration = Date.now() - startTime;
        if (duration >= slowThresholdMs) {
          this.warn(`[SLOW PERFORMANCE] Operation '${name}' exceeded threshold: ${duration}ms (Threshold: ${slowThresholdMs}ms)`, {
            ...meta,
            latencyMs: duration,
            slowThresholdMs
          });
        } else {
          this.info(`Operation '${name}' completed in ${duration}ms`, {
            ...meta,
            latencyMs: duration
          });
        }
        return result;
      },
      (error) => {
        const duration = Date.now() - startTime;
        this.error(`Operation '${name}' failed after ${duration}ms: ${error.message}`, {
          ...meta,
          error: error.message,
          latencyMs: duration
        });
        throw error;
      }
    );
  }
}

export const logger = new StructuredLogger("System");
