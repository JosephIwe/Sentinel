process.env.NODE_ENV = "test";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../server";

const ORIGINAL_ACCESS_CODE = process.env.APP_ACCESS_CODE;

describe("betaGateMiddleware (web UI access gate)", () => {
  afterEach(() => {
    if (ORIGINAL_ACCESS_CODE === undefined) delete process.env.APP_ACCESS_CODE;
    else process.env.APP_ACCESS_CODE = ORIGINAL_ACCESS_CODE;
  });

  describe("disabled (APP_ACCESS_CODE unset)", () => {
    beforeEach(() => {
      delete process.env.APP_ACCESS_CODE;
    });

    it("never intercepts requests - a non-API path falls through untouched", async () => {
      const res = await request(app).get("/some-web-ui-page");
      // No SPA/static middleware is registered under NODE_ENV=test, so an
      // unintercepted request reaches Express's own "no route matched"
      // 404 - proving the gate did not render its access-code form.
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("Access code");
    });
  });

  describe("enabled (APP_ACCESS_CODE set)", () => {
    beforeEach(() => {
      process.env.APP_ACCESS_CODE = "test-beta-code-123";
    });

    it("blocks a web UI request with no cookie, serving the access-code form", async () => {
      const res = await request(app).get("/dashboard");
      expect(res.status).toBe(401);
      expect(res.text).toContain("Access code");
    });

    it("never gates /api/* requests, even without a beta cookie", async () => {
      const res = await request(app).get("/api/v1/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
    });

    it("never gates /health, /ready, or /version", async () => {
      const health = await request(app).get("/health");
      const ready = await request(app).get("/ready");
      const version = await request(app).get("/version");
      expect(health.status).toBe(200);
      expect(ready.status).toBe(200);
      expect(version.status).toBe(200);
    });

    it("rejects an incorrect access code without setting a cookie", async () => {
      const res = await request(app)
        .post("/__beta-access")
        .type("form")
        .send({ code: "wrong-code" });

      expect(res.status).toBe(401);
      expect(res.text).toContain("Incorrect access code");
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("accepts the correct access code, sets a signed HttpOnly cookie, and redirects to /", async () => {
      const res = await request(app)
        .post("/__beta-access")
        .type("form")
        .send({ code: "test-beta-code-123" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");

      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toContain("sentinel_beta_access=");
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("SameSite=Lax");
    });

    it("lets a client with a valid cookie through to web UI paths afterward", async () => {
      const agent = request.agent(app);

      const submit = await agent
        .post("/__beta-access")
        .type("form")
        .send({ code: "test-beta-code-123" });
      expect(submit.status).toBe(302);

      const followUp = await agent.get("/dashboard");
      // No longer gated: falls through to Express's plain 404 (no SPA
      // registered in test mode) rather than the gate's 401 access form.
      expect(followUp.status).toBe(404);
      expect(followUp.text).not.toContain("Access code");
    });

    it("rejects a tampered cookie value", async () => {
      const res = await request(app)
        .get("/dashboard")
        .set("Cookie", "sentinel_beta_access=granted.0000000000000000000000000000000000000000000000000000000000000000");

      expect(res.status).toBe(401);
      expect(res.text).toContain("Access code");
    });

    it("invalidates previously-issued cookies when the access code is rotated", async () => {
      const agent = request.agent(app);
      const submit = await agent
        .post("/__beta-access")
        .type("form")
        .send({ code: "test-beta-code-123" });
      expect(submit.status).toBe(302);

      // Rotate the code - old cookie's signature no longer matches.
      process.env.APP_ACCESS_CODE = "a-brand-new-code-456";

      const afterRotation = await agent.get("/dashboard");
      expect(afterRotation.status).toBe(401);
      expect(afterRotation.text).toContain("Access code");
    });
  });
});
