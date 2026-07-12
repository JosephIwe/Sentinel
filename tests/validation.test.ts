import { describe, it, expect } from "vitest";
import { validateInvestigationInput } from "../utils/validation";

describe("Input Validation Subsystem - Unit Tests", () => {
  it("should reject invalid body types", () => {
    expect(validateInvestigationInput(null).valid).toBe(false);
    expect(validateInvestigationInput(undefined).valid).toBe(false);
    expect(validateInvestigationInput("non-object").valid).toBe(false);
  });

  it("should reject missing required properties", () => {
    expect(validateInvestigationInput({}).valid).toBe(false);
    expect(validateInvestigationInput({ type: "email" }).valid).toBe(false);
    expect(validateInvestigationInput({ value: "test@domain.com" }).valid).toBe(false);
  });

  it("should validate and allow standard compliant formats", () => {
    expect(validateInvestigationInput({ type: "email", value: "analyst@sentinel.org" }).valid).toBe(true);
    expect(validateInvestigationInput({ type: "domain", value: "microsoft.com" }).valid).toBe(true);
    expect(validateInvestigationInput({ type: "username", value: "malware_hunter" }).valid).toBe(true);
    expect(validateInvestigationInput({ type: "company", value: "Stripe Inc" }).valid).toBe(true);
  });

  it("should enforce RFC email rules", () => {
    expect(validateInvestigationInput({ type: "email", value: "invalid-email" }).valid).toBe(false);
    expect(validateInvestigationInput({ type: "email", value: "name@domain" }).valid).toBe(false);
  });

  it("should strip protocols from domains before validation to maintain high usability", () => {
    expect(validateInvestigationInput({ type: "domain", value: "https://secure.domain.org/path" }).valid).toBe(true);
  });

  it("should catch unsafe company names with special script tags or injection symbols", () => {
    expect(validateInvestigationInput({ type: "company", value: "Good Corp <script>" }).valid).toBe(false);
    expect(validateInvestigationInput({ type: "company", value: "Acme {injection}" }).valid).toBe(false);
  });

  it("should reject unsupported inquiry types", () => {
    expect(validateInvestigationInput({ type: "unknown-type", value: "val" }).valid).toBe(false);
  });
});
