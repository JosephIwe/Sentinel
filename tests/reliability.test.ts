import { describe, it, expect, vi } from "vitest";
import { withRetry, withTimeout, CircuitBreaker } from "../src/utils/reliability";

describe("Reliability Subsystem - Unit Tests", () => {
  describe("withRetry", () => {
    it("should succeed immediately if the task succeeds on first attempt", async () => {
      const task = vi.fn().mockResolvedValue("success");
      const result = await withRetry(task, { maxRetries: 3, delayMs: 1 });
      expect(result).toBe("success");
      expect(task).toHaveBeenCalledTimes(1);
    });

    it("should retry and eventually succeed if transient failures occur", async () => {
      let attempts = 0;
      const task = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Transient error");
        }
        return "recovered";
      });

      const result = await withRetry(task, { maxRetries: 3, delayMs: 1, backoffFactor: 1 });
      expect(result).toBe("recovered");
      expect(task).toHaveBeenCalledTimes(3);
    });

    it("should throw the final error if max retries are exceeded", async () => {
      const task = vi.fn().mockRejectedValue(new Error("Persistent error"));
      await expect(withRetry(task, { maxRetries: 3, delayMs: 1, backoffFactor: 1 }))
        .rejects.toThrow("Persistent error");
      expect(task).toHaveBeenCalledTimes(3);
    });
  });

  describe("withTimeout", () => {
    it("should complete successfully if the task resolves within timeout limits", async () => {
      const taskPromise = new Promise((resolve) => setTimeout(() => resolve("fast"), 5));
      const result = await withTimeout(taskPromise, 50, "FastTask");
      expect(result).toBe("fast");
    });

    it("should fail fast if the task exceeds the designated timeout limit", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve("slow"), 100));
      await expect(withTimeout(slowPromise, 10, "SlowTask"))
        .rejects.toThrow("Timeout of 10ms exceeded for SlowTask");
    });
  });

  describe("CircuitBreaker", () => {
    it("should permit execution when CLOSED and transition to OPEN after exceeding threshold", async () => {
      const breaker = new CircuitBreaker("TestBreaker", 2, 50); // Threshold 2 failures
      const failingTask = async () => {
        throw new Error("Service down");
      };

      // Execution 1: Failed
      await expect(breaker.execute(failingTask)).rejects.toThrow("Service down");
      expect(breaker.getState()).toBe("CLOSED");

      // Execution 2: Failed -> Trips the breaker
      await expect(breaker.execute(failingTask)).rejects.toThrow("Service down");
      expect(breaker.getState()).toBe("OPEN");

      // Subsequent executions fail-fast immediately
      const anyTask = vi.fn().mockResolvedValue("ignored");
      await expect(breaker.execute(anyTask)).rejects.toThrow("currently OPEN");
      expect(anyTask).not.toHaveBeenCalled();
    });

    it("should transition to HALF_OPEN after cooldown period and recover to CLOSED if successful", async () => {
      const breaker = new CircuitBreaker("TestBreaker-Cooldown", 1, 5); // Threshold 1 failure, 5ms cool-down
      const failingTask = async () => { throw new Error("error"); };
      
      // Trip breaker
      await expect(breaker.execute(failingTask)).rejects.toThrow("error");
      expect(breaker.getState()).toBe("OPEN");

      // Wait for cool-down
      await new Promise((resolve) => setTimeout(resolve, 10));

      const workingTask = vi.fn().mockResolvedValue("healthy-again");
      const result = await breaker.execute(workingTask);
      
      expect(result).toBe("healthy-again");
      expect(breaker.getState()).toBe("CLOSED");
    });
  });
});
