/**
 * Frontend Reusable Validation Utilities for Sentinel API Investigation
 */

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{1,100}$/;

/**
 * Validates target query format on the frontend before launching requests.
 * 
 * @param type - Supported types: "domain", "email", "company", "username"
 * @param value - The query search term
 */
export function validateInvestigationInput(type: string, value: string): ValidationResult {
  const trimmedValue = (value || "").trim();
  const normalizedType = (type || "").trim().toLowerCase();

  if (!normalizedType) {
    return { valid: false, message: "Please select a valid investigation type." };
  }

  if (!trimmedValue) {
    return { valid: false, message: "Please enter a search term." };
  }

  if (trimmedValue.length > 255) {
    return { valid: false, message: "Search term is too long (maximum 255 characters)." };
  }

  const supportedTypes = ["domain", "email", "company", "username"];
  if (!supportedTypes.includes(normalizedType)) {
    return { valid: false, message: `Unsupported investigation type. Supported options: ${supportedTypes.join(", ")}` };
  }

  switch (normalizedType) {
    case "email":
      if (!EMAIL_REGEX.test(trimmedValue)) {
        return { valid: false, message: "Please enter a valid email address (e.g., analyst@company.com)." };
      }
      break;
    case "domain":
      // Strip protocol helper if user accidentally inputs standard URL scheme
      const cleanDomain = trimmedValue.replace(/(^\w+:|^)\/\//, "").split("/")[0];
      if (!DOMAIN_REGEX.test(cleanDomain)) {
        return { valid: false, message: "Please enter a valid domain format (e.g., google.com, sub.domain.org)." };
      }
      break;
    case "username":
      if (!USERNAME_REGEX.test(trimmedValue)) {
        return { valid: false, message: "Please enter a valid username (letters, numbers, dots, dashes, underscores up to 100 characters)." };
      }
      break;
    case "company":
      if (trimmedValue.length < 2) {
        return { valid: false, message: "Please enter a company name at least 2 characters long." };
      }
      if (/[<>{}]/.test(trimmedValue)) {
        return { valid: false, message: "Company name contains potentially unsafe special characters." };
      }
      break;
  }

  return { valid: true };
}
