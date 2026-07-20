process.env.NODE_ENV = "test";

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { app } from "../server";

// server.ts no longer ships hardcoded seed API keys (see utils/session.ts
// and the RELEASE_CHECKLIST.md fix for "hardcoded live API keys"); tests
// create their own keys on demand instead. Creating a key requires no
// credentials (falls back to the anonymous Guest identity), same as before.
async function createActiveKeySecret(): Promise<string> {
  const res = await request(app).post("/api/v1/keys").send({ name: "Test Active Key" });
  return res.body.key.secret;
}

async function createRevokedKeySecret(): Promise<string> {
  const created = await request(app).post("/api/v1/keys").send({ name: "Test Revoked Key" });
  const keyId = created.body.key.id;
  await request(app).put(`/api/v1/keys/${keyId}/revoke`);
  return created.body.key.secret;
}

describe("server.ts HTTP API", () => {
  describe("liveness/readiness endpoints", () => {
    it("GET /health reports healthy status", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
    });

    it("GET /version reports service metadata", async () => {
      const res = await request(app).get("/version");
      expect(res.status).toBe(200);
      expect(res.body.name).toContain("Sentinel");
    });

    describe("GET /ready credential classification", () => {
      const originalGemini = process.env.GEMINI_API_KEY;
      const originalGithub = process.env.GITHUB_TOKEN;

      afterEach(() => {
        if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalGemini;
        if (originalGithub === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = originalGithub;
      });

      it("reports \"missing\" for unset credentials", async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GITHUB_TOKEN;
        const res = await request(app).get("/ready");
        expect(res.status).toBe(200);
        expect(res.body.services.geminiApi).toBe("missing");
        expect(res.body.services.githubToken).toBe("missing");
      });

      it("reports \"placeholder\" for known example/template values", async () => {
        process.env.GEMINI_API_KEY = "your_key";
        process.env.GITHUB_TOKEN = "changeme";
        const res = await request(app).get("/ready");
        expect(res.body.services.geminiApi).toBe("placeholder");
        expect(res.body.services.githubToken).toBe("placeholder");
      });

      it("reports \"configured\" for a real-looking value", async () => {
        process.env.GEMINI_API_KEY = "AIzaSyReal-Looking-Key-1234567890";
        process.env.GITHUB_TOKEN = "ghp_RealLookingToken1234567890";
        const res = await request(app).get("/ready");
        expect(res.body.services.geminiApi).toBe("configured");
        expect(res.body.services.githubToken).toBe("configured");
      });

      it("never makes an outbound call (responds immediately regardless of credential state)", async () => {
        process.env.GEMINI_API_KEY = "AIzaSyReal-Looking-Key-1234567890";
        const start = Date.now();
        const res = await request(app).get("/ready");
        expect(res.status).toBe(200);
        expect(Date.now() - start).toBeLessThan(500);
      });
    });
  });

  describe("session auth", () => {
    it("GET /api/v1/auth/me returns the current session user without credentials", async () => {
      const res = await request(app).get("/api/v1/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
    });

    it("POST /api/v1/auth/login requires an email", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({});
      expect(res.status).toBe(400);
    });

    it("POST /api/v1/auth/login then /auth/logout round-trips the session user", async () => {
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "analyst@sentinel.dev", name: "Analyst" });
      expect(login.status).toBe(200);
      expect(login.body.user.email).toBe("analyst@sentinel.dev");

      const logout = await request(app).post("/api/v1/auth/logout");
      expect(logout.status).toBe(200);
      expect(logout.body.user.plan).toBe("Free");
      expect(logout.body.user.email).toBe("guest@sentinelapi.dev");
    });
  });

  describe("per-client session isolation", () => {
    it("lets two clients log in simultaneously with different identities", async () => {
      const clientA = request.agent(app);
      const clientB = request.agent(app);

      const loginA = await clientA.post("/api/v1/auth/login").send({ email: "alice@example.com", name: "Alice" });
      const loginB = await clientB.post("/api/v1/auth/login").send({ email: "bob@example.com", name: "Bob" });
      expect(loginA.status).toBe(200);
      expect(loginB.status).toBe(200);

      const meA = await clientA.get("/api/v1/auth/me");
      const meB = await clientB.get("/api/v1/auth/me");

      expect(meA.body.user.email).toBe("alice@example.com");
      expect(meB.body.user.email).toBe("bob@example.com");
    });

    it("logging out one client's session does not affect another client's session", async () => {
      const clientA = request.agent(app);
      const clientB = request.agent(app);

      await clientA.post("/api/v1/auth/login").send({ email: "carol@example.com", name: "Carol" });
      await clientB.post("/api/v1/auth/login").send({ email: "dave@example.com", name: "Dave" });

      const logoutA = await clientA.post("/api/v1/auth/logout");
      expect(logoutA.status).toBe(200);

      const meA = await clientA.get("/api/v1/auth/me");
      const meB = await clientB.get("/api/v1/auth/me");

      expect(meA.body.user.id).toBe("usr_guest");
      expect(meB.body.user.email).toBe("dave@example.com");
    });

    it("a request with no session cookie never observes another client's logged-in identity", async () => {
      const clientA = request.agent(app);
      await clientA.post("/api/v1/auth/login").send({ email: "erin@example.com", name: "Erin" });

      const anonymous = await request(app).get("/api/v1/auth/me");
      expect(anonymous.body.user.id).toBe("usr_guest");
    });
  });

  describe("authenticateRequest middleware", () => {
    it("rejects an unrecognized API key", async () => {
      const res = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", "sn_live_totally_made_up_secret");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it("rejects a revoked API key", async () => {
      const revokedSecret = await createRevokedKeySecret();
      const res = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", revokedSecret);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/revoked/i);
    });

    it("accepts a valid active API key via X-API-Key", async () => {
      const activeSecret = await createActiveKeySecret();
      const res = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", activeSecret);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.keys)).toBe(true);
    });

    it("accepts a valid active API key via a Bearer authorization header", async () => {
      const activeSecret = await createActiveKeySecret();
      const res = await request(app)
        .get("/api/v1/keys")
        .set("Authorization", `Bearer ${activeSecret}`);
      expect(res.status).toBe(200);
    });

    it("falls back to the anonymous Guest identity when no credentials are supplied", async () => {
      const res = await request(app).get("/api/v1/keys");
      expect(res.status).toBe(200);
    });

    it("never returns raw API key secrets in list responses", async () => {
      const activeSecret = await createActiveKeySecret();
      const res = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", activeSecret);
      expect(res.status).toBe(200);
      for (const key of res.body.keys) {
        expect(key.secret).not.toBe(activeSecret);
        expect(key.secret).toContain("•");
      }
    });
  });

  describe("API key management", () => {
    it("requires a name to create a key", async () => {
      const res = await request(app).post("/api/v1/keys").send({});
      expect(res.status).toBe(400);
    });

    it("creates a key and returns the unmasked secret exactly once", async () => {
      const res = await request(app)
        .post("/api/v1/keys")
        .send({ name: "Integration Test Key" });
      expect(res.status).toBe(200);
      expect(res.body.key.name).toBe("Integration Test Key");
      expect(res.body.key.secret).toMatch(/^sn_live_/);
      expect(res.body.key.status).toBe("active");
    });

    it("revokes a key, after which it can no longer authenticate", async () => {
      const created = await request(app)
        .post("/api/v1/keys")
        .send({ name: "Key To Revoke" });
      const keyId = created.body.key.id;
      const secret = created.body.key.secret;

      const revoke = await request(app).put(`/api/v1/keys/${keyId}/revoke`);
      expect(revoke.status).toBe(200);
      expect(revoke.body.key.status).toBe("revoked");

      const authAttempt = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", secret);
      expect(authAttempt.status).toBe(401);
      expect(authAttempt.body.error).toMatch(/revoked/i);
    });

    it("returns 404 when revoking a nonexistent key", async () => {
      const res = await request(app).put("/api/v1/keys/key_does_not_exist/revoke");
      expect(res.status).toBe(404);
    });

    it("rotates a key's secret, invalidating the old one", async () => {
      const created = await request(app)
        .post("/api/v1/keys")
        .send({ name: "Key To Rotate" });
      const keyId = created.body.key.id;
      const oldSecret = created.body.key.secret;

      const rotated = await request(app).post(`/api/v1/keys/${keyId}/rotate`);
      expect(rotated.status).toBe(200);
      expect(rotated.body.key.secret).not.toBe(oldSecret);

      const oldSecretAttempt = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", oldSecret);
      expect(oldSecretAttempt.status).toBe(401);

      const newSecretAttempt = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", rotated.body.key.secret);
      expect(newSecretAttempt.status).toBe(200);
    });

    it("returns 404 when rotating a nonexistent key", async () => {
      const res = await request(app).post("/api/v1/keys/key_does_not_exist/rotate");
      expect(res.status).toBe(404);
    });
  });

  describe("rate limiting", () => {
    it("attaches X-RateLimit-* headers to authenticated responses", async () => {
      const activeSecret = await createActiveKeySecret();
      const res = await request(app)
        .get("/api/v1/keys")
        .set("X-API-Key", activeSecret);
      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    });

    it("returns 429 once a key's per-minute quota is exhausted", async () => {
      const created = await request(app)
        .post("/api/v1/keys")
        .send({ name: "Rate Limited Key", rateLimit: 1 });
      const secret = created.body.key.secret;

      const first = await request(app).get("/api/v1/keys").set("X-API-Key", secret);
      expect(first.status).toBe(200);
      expect(first.headers["x-ratelimit-remaining"]).toBe("0");

      const second = await request(app).get("/api/v1/keys").set("X-API-Key", secret);
      expect(second.status).toBe(429);
      expect(second.body.error).toBe("Too Many Requests");
      expect(second.body.retryAfterSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe("history and reports", () => {
    it("lists paginated investigation history", async () => {
      const res = await request(app).get("/api/v1/history?page=1&limit=2");
      expect(res.status).toBe(200);
      expect(res.body.history.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(2);
    });

    it("fetches a seeded historical report by id", async () => {
      const res = await request(app).get("/api/v1/reports/inv_example_711");
      expect(res.status).toBe(200);
      expect(res.body.summary).toContain("example.com");
    });

    it("returns 404 for an unknown report id", async () => {
      const res = await request(app).get("/api/v1/reports/does_not_exist");
      expect(res.status).toBe(404);
    });
  });

  describe("investigations input validation", () => {
    it("rejects an /investigations job request with an invalid type", async () => {
      const res = await request(app)
        .post("/api/v1/investigations")
        .send({ type: "not-a-real-type", value: "example.com" });
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown job id", async () => {
      const res = await request(app).get("/api/v1/investigations/job_does_not_exist");
      expect(res.status).toBe(404);
    });
  });
});
