import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function scenario(body: string) {
  const result = spawnSync(process.execPath, ["-e", `
    const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache').default;
    const { nodeFs } = require('next/dist/server/lib/node-fs-methods');
    const epoch = 1792160000000;
    let wall = epoch - 1000;
    Date.now = () => wall;
    Object.defineProperty(globalThis, 'performance', { value: {
      timeOrigin: epoch - 5000, now: () => wall - epoch,
    }});
    const cache = new FileSystemCache({ fs: nodeFs, serverDistDir: '/unused', flushToDisk: false,
      maxMemoryCacheSize: 1024 * 1024, revalidatedTags: [], _requestHeaders: {} });
    const key = 'component-specification';
    const put = width => cache.set(key, { kind: 'FETCH', tags: ['storefront'], revalidate: 120,
      data: { headers: {}, status: 200, url: 'http://localhost/products/table',
        body: Buffer.from(JSON.stringify({ width })).toString('base64') } },
      { fetchCache: true, tags: ['storefront'] });
    const read = async () => {
      const entry = await cache.get(key, { kind: 'FETCH', tags: ['storefront'] });
      return entry ? JSON.parse(Buffer.from(entry.value.data.body, 'base64').toString('utf8')).width : null;
    };
    (async () => {
      await put(120);
      wall = epoch;
      ${body}
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe("Next filesystem cache wall-clock invalidation", () => {
  it("expires the first read immediately even when the process clock trails wall time", () => {
    expect(scenario(`
      await cache.revalidateTag(['storefront'], { expire: 0 });
      console.log(JSON.stringify(await read()));
    `)).toBeNull();
  });

  it("keeps delayed expiration until its wall-clock deadline, then expires without a stale read", () => {
    expect(scenario(`
      await cache.revalidateTag(['storefront'], { expire: 30 });
      wall = epoch + 29999;
      const before = await read();
      wall = epoch + 30000;
      console.log(JSON.stringify({ before, atDeadline: await read() }));
    `)).toEqual({ before: 120, atDeadline: null });
  });

  it("keeps a fresh entry written after the invalidation", () => {
    expect(scenario(`
      await cache.revalidateTag(['storefront'], { expire: 0 });
      wall++;
      await put(161);
      console.log(JSON.stringify(await read()));
    `)).toBe(161);
  });

  it("does not invalidate an unrelated tag", () => {
    expect(scenario(`
      await cache.revalidateTag(['another-tag'], { expire: 0 });
      console.log(JSON.stringify(await read()));
    `)).toBe(120);
  });

  it("expires a tagged ISR route using the same wall-clock timestamps", () => {
    expect(scenario(`
      await cache.set('route', { kind: 'APP_ROUTE', body: Buffer.from('old'), status: 200,
        headers: { 'x-next-cache-tags': 'storefront' } }, { fetchCache: false, isFallback: false });
      wall++;
      await cache.revalidateTag(['storefront'], { expire: 0 });
      console.log(JSON.stringify(await cache.get('route', { kind: 'APP_ROUTE', isFallback: false })));
    `)).toBeNull();
  });

  it("does not expire a future profile early when the process clock leads wall time", () => {
    expect(scenario(`
      performance.timeOrigin += 10000;
      await cache.revalidateTag(['storefront'], { expire: 30 });
      wall = epoch + 29999;
      console.log(JSON.stringify(await read()));
    `)).toBe(120);
  });

  it("preserves the monotonic clock for non-filesystem callers", () => {
    expect(scenario(`
      const { tagsManifest, areTagsExpired } = require('next/dist/server/lib/incremental-cache/tags-manifest.external');
      tagsManifest.set('monotonic-cache', { expired: epoch - 4000 });
      console.log(JSON.stringify(areTagsExpired(['monotonic-cache'], epoch - 6000)));
    `)).toBe(false);
  });
});
