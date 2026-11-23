#!/usr/bin/env node
/**
 * Copies the local uploads volume to Tencent COS with identical keys.
 *
 * Idempotent: a file already present in the bucket with the same byte size is
 * skipped, so re-running after a partial failure only uploads what is missing.
 *
 * Run inside the backend container (the COS SDK is installed there):
 *   docker cp deploy/migrate-uploads-to-cos.cjs small-house-prod-backend-1:/app/migrate-uploads.cjs
 *   docker exec -e COS_SECRET_ID=... -e COS_SECRET_KEY=... \
 *     -e COS_BUCKET=... -e COS_REGION=... \
 *     small-house-prod-backend-1 node /app/migrate-uploads.cjs [--dry-run]
 */
const { createReadStream } = require('node:fs');
const { readdir, stat } = require('node:fs/promises');
const { join, relative, sep, extname } = require('node:path');
const COS = require('cos-nodejs-sdk-v5');

const DIR = process.env.UPLOAD_DIR || '/app/uploads';
const Bucket = process.env.COS_BUCKET;
const Region = process.env.COS_REGION;
const CONCURRENCY = Math.max(1, Number(process.env.MIGRATE_CONCURRENCY || 4));
const DRY_RUN = process.argv.includes('--dry-run');

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

if (!Bucket || !Region || !process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY) {
  console.error('Missing COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION');
  process.exit(2);
}

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
});

const call = (fn, args) =>
  new Promise((resolve, reject) => fn.call(cos, args, (err, data) => (err ? reject(err) : resolve(data))));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function remoteSize(key) {
  try {
    const data = await call(cos.headObject, { Bucket, Region, Key: key });
    return Number(data.headers['content-length']);
  } catch (error) {
    if (error && error.statusCode === 404) return null;
    throw error;
  }
}

async function uploadOne(file) {
  const key = relative(DIR, file).split(sep).join('/');
  const size = (await stat(file)).size;
  const contentType = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  if (DRY_RUN) return { key, size, outcome: 'would-upload' };
  const existing = await remoteSize(key);
  if (existing === size) return { key, size, outcome: 'skipped' };
  await call(cos.putObject, {
    Bucket,
    Region,
    Key: key,
    Body: createReadStream(file),
    ContentLength: size,
    ContentType: contentType,
  });
  return { key, size, outcome: 'uploaded' };
}

(async () => {
  const files = await walk(DIR);
  console.log(`[migrate] ${files.length} local files under ${DIR}${DRY_RUN ? ' (dry run)' : ''}`);
  const stats = { uploaded: 0, skipped: 0, failed: 0, bytes: 0, 'would-upload': 0 };
  const failures = [];
  let index = 0;

  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      try {
        const result = await uploadOne(file);
        stats[result.outcome]++;
        if (result.outcome === 'uploaded') stats.bytes += result.size;
        if (stats.uploaded % 100 === 0 && result.outcome === 'uploaded') {
          console.log(`[migrate] uploaded ${stats.uploaded}, skipped ${stats.skipped}`);
        }
      } catch (error) {
        stats.failed++;
        failures.push(`${relative(DIR, file)}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `[migrate] done: uploaded ${stats.uploaded} (${(stats.bytes / 1048576).toFixed(1)} MB), ` +
      `skipped ${stats.skipped}, failed ${stats.failed}` +
      (DRY_RUN ? `, would upload ${stats['would-upload']}` : ''),
  );
  if (failures.length) {
    console.error('[migrate] failures:');
    for (const line of failures.slice(0, 20)) console.error('  ' + line);
    process.exit(1);
  }
})().catch((error) => {
  console.error('[migrate] fatal:', error.message);
  process.exit(1);
});
