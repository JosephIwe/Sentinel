import { describe, it, expect, afterEach } from "vitest";
import { errorHandler } from "../utils/observability";

function makeRes() {
  const state: { statusCode: number; body?: any } = { statusCode: 200 };
  return {
    get statusCode() {
      return state.statusCode;
    },
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: any) {
      state.body = body;
      return this;
    },
    _state: state,
  } as any;
}

describe("errorHandler", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("includes the real error message outside production (for local debugging)", () => {
    process.env.NODE_ENV = "development";
    const req = { id: "req_1", method: "GET", url: "/api/v1/whatever" };
    const res = makeRes();
    const err = new Error("Something internal broke: /etc/secrets/db-password.txt not found");

    errorHandler(err, req as any, res, (() => {}) as any);

    expect(res._state.statusCode).toBe(500);
    expect(res._state.body.message).toContain("db-password.txt");
  });

  it("does not leak the real error message to clients in production", () => {
    process.env.NODE_ENV = "production";
    const req = { id: "req_2", method: "GET", url: "/api/v1/whatever" };
    const res = makeRes();
    const err = new Error("Something internal broke: /etc/secrets/db-password.txt not found");

    errorHandler(err, req as any, res, (() => {}) as any);

    expect(res._state.statusCode).toBe(500);
    expect(res._state.body.message).not.toContain("db-password.txt");
    expect(res._state.body.message).toBe("An unexpected error occurred on the secure gateway.");
  });

  it("preserves a non-200 status already set on the response", () => {
    process.env.NODE_ENV = "production";
    const req = { id: "req_3", method: "GET", url: "/api/v1/whatever" };
    const res = makeRes();
    res.status(403);
    const err = new Error("Forbidden internal detail");

    errorHandler(err, req as any, res, (() => {}) as any);

    expect(res._state.statusCode).toBe(403);
  });
});
