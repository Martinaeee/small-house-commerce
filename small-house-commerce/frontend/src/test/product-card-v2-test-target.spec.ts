import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertProductCardV2TestTarget } from "./product-card-v2-test-target";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/small_house_product_card_v2_20261011_test?schema=public";
const owner = "product-card-v2-20261011";
const roots: string[] = [];
let root: string;

beforeEach(() => {
  root = mkdtempSync("/private/tmp/luwag-product-card-v2-");
  roots.push(root);
  writeFileSync(join(root, ".product-card-v2-owner"), owner, { flag: "wx" });
});

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("assertProductCardV2TestTarget", () => {
  it("accepts only the dedicated local database and a real owned root without changing the marker", () => {
    expect(assertProductCardV2TestTarget(databaseUrl, root)).toEqual({ databaseUrl, root });
    expect(readFileSync(join(root, ".product-card-v2-owner"), "utf8")).toBe(owner);
    expect(lstatSync(root).isDirectory()).toBe(true);
    expect(assertProductCardV2TestTarget(databaseUrl.replace("localhost", "127.0.0.1"), root).root).toBe(root);
  });

  it.each(["small_house_homepage_rehearsal", "small_house_product_card_20261010_test", "small_house", "small_house_product_card_v2_20261011_test_extra"])("rejects the non-owned database %s", database => {
    expect(() => assertProductCardV2TestTarget(databaseUrl.replace("small_house_product_card_v2_20261011_test", database), root)).toThrow();
  });

  it.each([undefined, ""])("rejects a missing database URL %s", value => {
    expect(() => assertProductCardV2TestTarget(value, root)).toThrow();
  });

  it.each([undefined, ""])("rejects a missing root %s", value => {
    expect(() => assertProductCardV2TestTarget(databaseUrl, value)).toThrow();
  });

  it.each([
    "postgres://postgres:postgres@localhost:5432/small_house_product_card_v2_20261011_test?schema=public",
    "postgresql://postgres:postgres@db.example.test:5432/small_house_product_card_v2_20261011_test?schema=public",
    "postgresql://postgres:postgres@localhost:5433/small_house_product_card_v2_20261011_test?schema=public",
    databaseUrl.replace("schema=public", "schema=private"),
    databaseUrl + "&schema=public",
    databaseUrl + "&sslmode=disable",
    databaseUrl + "#ignored-fragment",
    "not-a-url",
  ])("rejects an unsafe database URL %s", value => {
    expect(() => assertProductCardV2TestTarget(value, root)).toThrow();
  });

  it("rejects path escape, protected uploads, wrong prefix and trailing whitespace", () => {
    for (const path of [root + "/../" + basename(root), root + "/backend/uploads", "/private/tmp/luwag-product-card-old", root + "\n"])
      expect(() => assertProductCardV2TestTarget(databaseUrl, path)).toThrow();
  });

  it("rejects an absent directory", () => {
    expect(() => assertProductCardV2TestTarget(databaseUrl, root + "-absent")).toThrow();
  });

  it("rejects a directory symlink", () => {
    const link = root + "-link";
    symlinkSync(root, link, "dir");
    roots.push(link);
    expect(() => assertProductCardV2TestTarget(databaseUrl, link)).toThrow();
  });

  it("rejects a missing marker rather than claiming an existing root", () => {
    unlinkSync(join(root, ".product-card-v2-owner"));
    expect(() => assertProductCardV2TestTarget(databaseUrl, root)).toThrow();
  });

  it("rejects a foreign owner without overwriting it", () => {
    writeFileSync(join(root, ".product-card-v2-owner"), "another-session");
    expect(() => assertProductCardV2TestTarget(databaseUrl, root)).toThrow();
    expect(readFileSync(join(root, ".product-card-v2-owner"), "utf8")).toBe("another-session");
  });

  it("rejects a marker symlink", () => {
    const marker = join(root, ".product-card-v2-owner");
    const source = join(root, "source-owner");
    writeFileSync(source, owner);
    unlinkSync(marker);
    symlinkSync(source, marker);
    expect(() => assertProductCardV2TestTarget(databaseUrl, root)).toThrow();
  });
});
