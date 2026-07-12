/**
 * Sentinel Security Platform - Production Reliability & Resilience Subsystem
 * 
 * Provides:
 * 1. Exponential Backoff Retry engine
 * 2. Strict Promise Timeout guard
 * 3. Stateful Circuit Breaker (Closed, Open, Half-Open) with isolated registries
 */

import { logger } from "./logger";

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  backoffFactor?: number;
  name?: string;
}

/**
 * Wraps a promise-returning function with automated retry logic utilizing exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.delayMs ?? 1000;
  const backoffFactor = options.backoffFactor ?? 2;
  const name = options.name ?? "Operation";

  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt === maxRetries) {
        break;
      }
      logger.warn(`[Retry Subsystem] ${name} attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoffFactor;
    }
  }

  throw lastError;
}

/**
 * Enforces a strict timeout guard on any promise execution.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  name = "Operation"
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout of ${timeoutMs}ms exceeded for ${name}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Stateful Circuit Breaker to prevent cascading failures of external integrations.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastStateChange: number = Date.now();
  
  constructor(
    public readonly name: string,
    private readonly threshold = 3,
    private readonly resetTimeoutMs = 15000 // 15 seconds cool-off
  ) {}

  public getState(): CircuitState {
    this.checkReset();
    return this.state;
  }

  private checkReset() {
    if (this.state === "OPEN" && Date.now() - this.lastStateChange > this.resetTimeoutMs) {
      this.transitionTo("HALF_OPEN");
    }
  }

  private transitionTo(newState: CircuitState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    logger.info(`[Circuit Breaker] Breaker '${this.name}' transitioned from ${oldState} to ${newState}`);
    if (newState === "CLOSED") {
      this.failureCount = 0;
    }
  }

  /**
   * Executes a function protected by the Circuit Breaker.
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkReset();

    if (this.state === "OPEN") {
      logger.warn(`[Circuit Breaker] Breaker '${this.name}' is OPEN. Failing fast to prevent network congestion.`);
      throw new Error(`Circuit breaker '${this.name}' is currently OPEN. Failing fast.`);
    }

    try {
      const result = await fn();
      
      // If we succeed in Half-Open, close the circuit
      if (this.state === "HALF_OPEN") {
        this.transitionTo("CLOSED");
      }
      return result;
    } catch (err) {
      this.handleFailure();
      throw err;
    }
  }

  private handleFailure() {
    this.failureCount++;
    logger.warn(`[Circuit Breaker] Breaker '${this.name}' registered failure ${this.failureCount}/${this.threshold}`);
    
    if (this.state === "CLOSED" && this.failureCount >= this.threshold) {
      this.transitionTo("OPEN");
    } else if (this.state === "HALF_OPEN") {
      this.transitionTo("OPEN");
    }
  }
}

/**
 * Isolated registry of Circuit Breakers for individual connectors.
 */
export class CircuitBreakerRegistry {
  private static breakers = new Map<string, CircuitBreaker>();

  public static getBreaker(name: string, threshold?: number, resetTimeoutMs?: number): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, threshold, resetTimeoutMs);
      this.breakers.set(name, breaker);
    }
    return breaker;
  }
}
