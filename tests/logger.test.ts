import { describe, it, expect } from "vitest";
import { sanitize } from "../src/utils/logger";

describe("Structured Logger - Security Sanitization", () => {
  it("should mask sensitive keys recursively", () => {
    const rawData = {
      username: "alex_analyst",
      secret: "sn_live_00000000000000000000000000000000",
      headers: {
        authorization: "Bearer sn_live_11111111111111111111111111111111",
        "X-API-Key": "sn_live_22222222222222222222222222222222"
      },
      metadata: {
        safeField: "not-sensitive"
      }
    };

    const sanitized = sanitize(rawData);

    expect(sanitized.username).toBe("alex_analyst");
    expect(sanitized.secret).toContain("sn_live_");
    expect(sanitized.secret).toContain("****");
    expect(sanitized.headers.authorization).toContain("Bearer ");
    expect(sanitized.headers.authorization).toContain("****");
    expect(sanitized.headers["X-API-Key"]).toContain("****");
    expect(sanitized.metadata.safeField).toBe("not-sensitive");
  });

  it("should handle null and primitives safely", () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(42)).toBe(42);
    expect(sanitize("safe-string")).toBe("safe-string");
  });
});
