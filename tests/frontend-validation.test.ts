import { describe, it, expect } from "vitest";
import { validateInvestigationInput } from "../src/utils/validation";

describe("validateInvestigationInput (frontend)", () => {
  it("rejects a missing or blank type", () => {
    expect(validateInvestigationInput("", "example.com")).toEqual({
      valid: false,
      message: "Please select a valid investigation type.",
    });
    expect(validateInvestigationInput("   ", "example.com").valid).toBe(false);
  });

  it("rejects a missing or blank value", () => {
    const result = validateInvestigationInput("domain", "   ");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("Please enter a search term.");
  });

  it("rejects values longer than 255 characters", () => {
    const longValue = "a".repeat(256);
    const result = validateInvestigationInput("company", longValue);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("too long");
  });

  it("rejects unsupported investigation types", () => {
    const result = validateInvestigationInput("phone", "555-1234");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Unsupported investigation type");
  });

  it("normalizes type casing and surrounding whitespace before checking support", () => {
    expect(validateInvestigationInput("  DOMAIN  ", "example.com").valid).toBe(true);
  });

  describe("email", () => {
    it("accepts well-formed addresses", () => {
      expect(validateInvestigationInput("email", "analyst@company.com").valid).toBe(true);
    });

    it("rejects addresses missing a TLD or @ symbol", () => {
      expect(validateInvestigationInput("email", "name@domain").valid).toBe(false);
      expect(validateInvestigationInput("email", "not-an-email").valid).toBe(false);
    });
  });

  describe("domain", () => {
    it("accepts plain and subdomain formats", () => {
      expect(validateInvestigationInput("domain", "google.com").valid).toBe(true);
      expect(validateInvestigationInput("domain", "sub.domain.org").valid).toBe(true);
    });

    it("strips a protocol and path before validating", () => {
      expect(validateInvestigationInput("domain", "https://secure.domain.org/some/path").valid).toBe(true);
    });

    it("rejects malformed domains", () => {
      expect(validateInvestigationInput("domain", "not a domain").valid).toBe(false);
      expect(validateInvestigationInput("domain", "..bad..").valid).toBe(false);
    });
  });

  describe("username", () => {
    it("accepts letters, numbers, dots, dashes, and underscores", () => {
      expect(validateInvestigationInput("username", "malware_hunter-01.x").valid).toBe(true);
    });

    it("rejects disallowed characters", () => {
      expect(validateInvestigationInput("username", "bad user!").valid).toBe(false);
    });

    it("rejects usernames over 100 characters", () => {
      expect(validateInvestigationInput("username", "a".repeat(101)).valid).toBe(false);
    });
  });

  describe("company", () => {
    it("accepts names at least 2 characters long", () => {
      expect(validateInvestigationInput("company", "Stripe Inc").valid).toBe(true);
    });

    it("rejects names shorter than 2 characters", () => {
      const result = validateInvestigationInput("company", "A");
      expect(result.valid).toBe(false);
      expect(result.message).toContain("at least 2 characters");
    });

    it("rejects names containing unsafe special characters", () => {
      expect(validateInvestigationInput("company", "Good Corp <script>").valid).toBe(false);
      expect(validateInvestigationInput("company", "Acme {injection}").valid).toBe(false);
      expect(validateInvestigationInput("company", "Acme}Corp").valid).toBe(false);
    });
  });
});
