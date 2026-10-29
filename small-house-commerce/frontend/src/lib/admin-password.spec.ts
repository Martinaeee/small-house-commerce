import { describe, expect, it } from "vitest";
import { generateAdminPassword } from "./admin-password";

describe("generateAdminPassword", () => {
  it("returns the requested length", () => {
    expect(generateAdminPassword(12)).toHaveLength(12);
    expect(generateAdminPassword(16)).toHaveLength(16);
  });

  it("leaves out the characters that are read wrong", () => {
    const password = generateAdminPassword(64);
    expect(password).not.toMatch(/[lIO01]/);
  });

  it("returns a different password every time", () => {
    const passwords = new Set(
      Array.from({ length: 20 }, () => generateAdminPassword(16)),
    );
    expect(passwords.size).toBe(20);
  });
});
