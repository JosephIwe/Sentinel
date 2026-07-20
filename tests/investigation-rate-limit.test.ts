process.env.NODE_ENV = "test";

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../server";

describe("per-IP rate limiting on investigation creation", () => {
  it("allows up to 10 investigation-creation requests per minute per IP, then returns 429", async () => {
    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await request(app)
          .post("/api/v1/investigations")
          .send({ type: "domain", value: `rate-limit-target-${i}.io` })
      );
    }

    const allowed = responses.slice(0, 10);
    const blocked = responses[10];

    for (const res of allowed) {
      expect(res.status).not.toBe(429);
    }

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Too Many Requests");
    expect(blocked.body.message).toContain("Investigation creation");
    expect(blocked.body.retryAfterSeconds).toBeGreaterThanOrEqual(0);
  });

  it("applies the same per-IP budget to the synchronous /investigate endpoint", async () => {
    // The previous test already exhausted this IP's 10/min investigation-
    // creation quota (shared identifier across /investigations and
    // /investigate), so this request should also be blocked.
    const res = await request(app)
      .post("/api/v1/investigate")
      .send({ type: "domain", value: "another-target.io" });

    expect(res.status).toBe(429);
    expect(res.body.message).toContain("Investigation creation");
  });
});
