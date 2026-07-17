import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DistributedRateLimiter } from "../utils/rate-limiter";

let idCounter = 0;
function uniqueId(): string {
  idCounter += 1;
  return `test-identifier-${idCounter}`;
}

describe("DistributedRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit and decrements remaining", async () => {
    const id = uniqueId();

    const first = await DistributedRateLimiter.check(id, 3, 60000);
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(3);
    expect(first.remaining).toBe(2);

    const second = await DistributedRateLimiter.check(id, 3, 60000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it("denies requests once the limit is reached within the window", async () => {
    const id = uniqueId();

    await DistributedRateLimiter.check(id, 2, 60000);
    await DistributedRateLimiter.check(id, 2, 60000);
    const third = await DistributedRateLimiter.check(id, 2, 60000);

    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("does not count a denied request against the log", async () => {
    const id = uniqueId();

    await DistributedRateLimiter.check(id, 1, 60000);
    const denied = await DistributedRateLimiter.check(id, 1, 60000);
    expect(denied.allowed).toBe(false);

    // Log should still only contain the single successful entry, so raising
    // the limit on the very next call immediately allows a new request.
    const afterLimitRaise = await DistributedRateLimiter.check(id, 2, 60000);
    expect(afterLimitRaise.allowed).toBe(true);
  });

  it("isolates rate limit state between different identifiers", async () => {
    const idA = uniqueId();
    const idB = uniqueId();

    await DistributedRateLimiter.check(idA, 1, 60000);
    const aSecond = await DistributedRateLimiter.check(idA, 1, 60000);
    const bFirst = await DistributedRateLimiter.check(idB, 1, 60000);

    expect(aSecond.allowed).toBe(false);
    expect(bFirst.allowed).toBe(true);
  });

  it("prunes stale entries and re-allows requests once the window slides past them", async () => {
    const id = uniqueId();

    await DistributedRateLimiter.check(id, 1, 60000);
    const blocked = await DistributedRateLimiter.check(id, 1, 60000);
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(60001);

    const afterWindow = await DistributedRateLimiter.check(id, 1, 60000);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(0);
  });

  it("computes resetSeconds based on when the oldest log entry exits the window", async () => {
    const id = uniqueId();

    await DistributedRateLimiter.check(id, 1, 10000);
    vi.advanceTimersByTime(4000);
    const denied = await DistributedRateLimiter.check(id, 1, 10000);

    expect(denied.allowed).toBe(false);
    // Oldest entry logged at t=0, window 10s, 4s elapsed -> 6s remain.
    expect(denied.resetSeconds).toBe(6);
  });

  it("denies every request and reports the full window when the limit is zero", async () => {
    const id = uniqueId();
    const result = await DistributedRateLimiter.check(id, 0, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetSeconds).toBe(60);
  });

  it("applies the default 60 second window when windowMs is omitted", async () => {
    const id = uniqueId();

    await DistributedRateLimiter.check(id, 1);
    const denied = await DistributedRateLimiter.check(id, 1);
    expect(denied.allowed).toBe(false);

    vi.advanceTimersByTime(59000);
    const stillDenied = await DistributedRateLimiter.check(id, 1);
    expect(stillDenied.allowed).toBe(false);

    vi.advanceTimersByTime(2000);
    const allowedAfterDefault = await DistributedRateLimiter.check(id, 1);
    expect(allowedAfterDefault.allowed).toBe(true);
  });
});
