/**
 * Reusable input validation utilities for cyber threat intelligence and discovery
 *
 * Implements strict type checking, regex-based standard formats for domains/emails,
 * and clear diagnostic error messages for restful validation.
 */

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

// RFC 5322 compliant standard email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// standard Domain / Hostname regex validation
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

// GitHub / social / systems Alphanumeric + underscores + hyphens + dots username
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{1,100}$/;

/**
 * Validates the raw request body and specific sub-parameters.
 * 
 * @param body - The raw req.body object from the express router
 * @returns ValidationResult indicating whether the input passes standard criteria
 */
export function validateInvestigationInput(body: any): ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, message: "Request body must be a valid JSON object." };
  }

  const { type, value } = body;

  // 1. Verify existence of required properties
  if (type === undefined || type === null) {
    return { valid: false, message: "Missing required parameter: 'type'." };
  }
  if (value === undefined || value === null) {
    return { valid: false, message: "Missing required parameter: 'value'." };
  }

  // 2. Type validation
  if (typeof type !== "string") {
    return { valid: false, message: "Parameter 'type' must be a string." };
  }
  if (typeof value !== "string") {
    return { valid: false, message: "Parameter 'value' must be a string." };
  }

  const normalizedType = type.trim().toLowerCase();
  const trimmedValue = value.trim();

  // 3. Supported types verification
  const supportedTypes = ["email", "domain", "company", "username"];
  if (!supportedTypes.includes(normalizedType)) {
    return {
      valid: false,
      message: `Unsupported target type: '${type}'. Supported types are: ${supportedTypes.join(", ")}.`
    };
  }

  // 4. Value empty check
  if (trimmedValue.length === 0) {
    return { valid: false, message: "Parameter 'value' cannot be an empty string." };
  }

  // 5. Value length guard
  if (trimmedValue.length > 255) {
    return { valid: false, message: "Parameter 'value' exceeds maximum allowed length of 255 characters." };
  }

  // 6. Format check based on target types
  switch (normalizedType) {
    case "email":
      if (!EMAIL_REGEX.test(trimmedValue)) {
        return { valid: false, message: "Parameter 'value' must be a valid email address format (e.g. user@domain.com)." };
      }
      break;

    case "domain":
      // Strip protocol if the user supplied it (e.g., https://example.com) to make the API robust
      const cleanDomain = trimmedValue.replace(/(^\w+:|^)\/\//, "").split("/")[0];
      if (!DOMAIN_REGEX.test(cleanDomain)) {
        return { valid: false, message: "Parameter 'value' must be a valid domain or host registration format (e.g. example.com)." };
      }
      break;

    case "username":
      if (!USERNAME_REGEX.test(trimmedValue)) {
        return { valid: false, message: "Parameter 'value' must be a valid alphanumeric/hyphenated username (1-100 characters)." };
      }
      break;

    case "company":
      if (trimmedValue.length < 2) {
        return { valid: false, message: "Parameter 'value' for company must be at least 2 characters long." };
      }
      // Basic security validation against script injection characters
      if (/[<>{}]/.test(trimmedValue)) {
        return { valid: false, message: "Parameter 'value' contains invalid or unsafe special characters." };
      }
      break;
  }

  return { valid: true };
}
