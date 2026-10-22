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

/**
 * Normalizes an OPTIONAL contact number that a shopper typed into a restock
 * alert. Philippine mobiles keep the canonical E.164 form used everywhere
 * else; any other plausible international number keeps its digits so the
 * shop can still call it. Anything that does not look like a number is
 * dropped (null) instead of failing the whole subscription.
 */
export function normalizeContactPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const philippine = normalizePhilippinePhone(trimmed);
  if (philippine) return philippine;

  const digits = trimmed.replace(/\D/g, '');
  // 7 to 15 digits covers landlines and E.164 numbers of every country.
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}
