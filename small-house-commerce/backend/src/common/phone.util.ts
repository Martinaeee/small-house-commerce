/**
 * Normalizes a Philippine phone number to E.164 (+63 + 10 digits), per
 * DATABASE.md §12: "09171234567", "+639171234567" and "639171234567" must
 * resolve to the same canonical identity.
 *
 * Returns null when the input does not look like a valid PH mobile number.
 */
export function normalizePhilippinePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  // 09171234567 -> +639171234567 (local format with leading 0)
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+63${digits.slice(1)}`;
  }

  // 639171234567 / +639171234567 -> +639171234567 (country code already present)
  if (digits.length === 12 && digits.startsWith('63')) {
    return `+${digits}`;
  }

  return null;
}
