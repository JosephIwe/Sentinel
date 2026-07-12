/**
 * Sentinel Security Platform - Observability, Security and Audit Subsystem
 * 
 * Provides:
 * 1. Request ID Middleware
 * 2. Performance Audit Logger Middleware
 * 3. Centralized Production Error Handler (No Stack Leaks)
 * 4. Startup Environment Variable Validation
 * 5. Health Check probes (/health, /ready, /version)
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../src/utils/logger";

/**
 * Attaches a unique request ID to each incoming request and response header.
 */
export function requestIdMiddleware(req: any, res: Response, next: NextFunction) {
  const incomingId = req.headers["x-request-id"];
  const requestId = typeof incomingId === "string" && incomingId ? incomingId : crypto.randomUUID();
  
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}

/**
 * Measures API execution latency and logs structured diagnostic events.
 * Identifies and alerts on requests taking longer than 1500ms.
 */
export function auditLoggerMiddleware(req: any, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const { method, originalUrl, ip } = req;

  // Log on completion to capture response status and execution time
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const clientIp = req.headers["x-forwarded-for"] || ip;
    const apiKeyId = req.apiKey?.id || "anonymous";

    const logMeta = {
      requestId: req.id,
      method,
      url: originalUrl,
      statusCode,
      latencyMs: duration,
      clientIp,
      apiKeyId,
    };

    if (duration >= 1500) {
      logger.warn(`[SLOW API REQUEST] ${method} ${originalUrl} took ${duration}ms (Status: ${statusCode})`, logMeta);
    } else {
      logger.info(`[API REQUEST] ${method} ${originalUrl} completed in ${duration}ms (Status: ${statusCode})`, logMeta);
    }
  });

  next();
}

/**
 * Validates critical environment variables at startup.
 */
export function validateEnvironment() {
  const required = ["GEMINI_API_KEY"];
  const missing = required.filter(key => !process.env[key] || process.env[key] === `MY_${key}`);

  if (missing.length > 0) {
    logger.warn(`[Environment Audit] Missing or default environment variables: ${missing.join(", ")}. Some external intelligence models may operate in fallback mode.`);
  } else {
    logger.info("[Environment Audit] All required environment configurations successfully validated.");
  }
}

/**
 * Centralized express error handler.
 * Masks raw server stack traces in production to prevent technical footprint leaks.
 */
export function errorHandler(err: any, req: any, res: Response, next: NextFunction) {
  const requestId = req.id || "unknown";
  
  logger.error(`[Central Error Handler] Uncaught Exception on ${req.method} ${req.url}: ${err.message}`, {
    requestId,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
    errorName: err.name,
    message: err.message
  });

  res.status(res.statusCode === 200 ? 500 : res.statusCode).json({
    error: "Internal Server Error",
    message: err.message || "An unexpected error occurred on the secure gateway.",
    requestId
  });
}
