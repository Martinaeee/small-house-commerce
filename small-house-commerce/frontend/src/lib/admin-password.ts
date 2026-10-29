/**
 * Password generator for the admin team page.
 *
 * The administrator can type their own password, but a generated one is the
 * safer default: a hand-written password is the one most likely to be reused
 * from somewhere else. crypto.getRandomValues works in insecure contexts
 * (the production admin is served over plain http), so it is the primary
 * source; Math.random is only the last-resort fallback.
 */

// Visually unambiguous: no l/I/o/0/1, so a password read off a screen or
// dictated over the phone survives the trip.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const ADMIN_PASSWORD_MIN_LENGTH = 8;

export function generateAdminPassword(length = 16): string {
  const size = ALPHABET.length;
  // Reject the tail of the byte range so every character stays equally
  // likely; 256 is not a multiple of the alphabet size.
  const limit = 256 - (256 % size);
  const out: string[] = [];
  const bytes = new Uint8Array(Math.max(length * 2, 16));

  while (out.length < length) {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % size]);
      if (out.length === length) break;
    }
  }

  return out.join("");
}
