// One-off existing-video maintenance. Run from the backend application dir.
// Stage never changes live files; apply/restore require the saved manifest.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

function isFaststart(buffer) {
  const boxes = [];
  for (let offset = 0; offset + 8 <= buffer.length;) {
    let size = buffer.readUInt32BE(offset);
    if (size === 1) {
      if (offset + 16 > buffer.length) return false;
      size = Number(buffer.readBigUInt64BE(offset + 8));
    }
    boxes.push(buffer.toString('ascii', offset + 4, offset + 8));
    if (size < 8) break;
    offset += size;
  }
  return boxes.includes('moov') && boxes.includes('mdat') && boxes.indexOf('moov') < boxes.indexOf('mdat');
}

function safeVideoMetadata(before, after) {
  return Number.isFinite(before.duration) && Number.isFinite(after.duration)
    && Math.abs(before.duration - after.duration) <= Math.max(0.25, before.duration * 0.02)
    && before.audio === after.audio && after.codec === 'h264'
    && after.width > 0 && after.width <= 1280 && after.height > 0 && after.height <= 720;
}

async function probe(file) {
  const { stdout } = await exec(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file,
  ], { timeout: 15_000 });
  const data = JSON.parse(stdout);
  const video = data.streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error(`No video stream: ${file}`);
  return { duration: Number(data.format.duration), audio: data.streams.some(s => s.codec_type === 'audio'),
    codec: video.codec_name, width: video.width, height: video.height };
}

async function filesUnder(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const key = path.join(prefix, entry.name);
    if (entry.isDirectory() && entry.name !== 'originals') files.push(...await filesUnder(root, key));
    else if (entry.isFile() && /^[^\0]+\.mp4$/i.test(key)) files.push(key);
  }
  return files.sort();
}

async function main() {
  const [uploadArg, backupArg, mode = '--stage'] = process.argv.slice(2);
  if (!uploadArg || !backupArg || !['--stage', '--apply', '--restore'].includes(mode)) {
    throw new Error('Usage: node video-batch.cjs ABS_UPLOAD_DIR ABS_PRIVATE_BACKUP_DIR --stage|--apply|--restore');
  }
  const upload = path.resolve(uploadArg), backup = path.resolve(backupArg);
  if (backup === upload || backup.startsWith(upload + path.sep)) throw new Error('Backup must be outside the public uploads directory');
  const manifestPath = path.join(backup, 'manifest.json');
  const saveManifest = async manifest => {
    await fs.writeFile(manifestPath + '.tmp', JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await fs.rename(manifestPath + '.tmp', manifestPath);
  };
  if (mode === '--stage') {
    // Never overwrite a previous backup/manifest with an already-compressed file.
    try { await fs.access(manifestPath); throw new Error('Manifest exists; use a new backup directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    const { VideoTranscoderService } = await import(pathToFileURL(path.resolve('dist/modules/uploads/video-transcoder.service.js')).href);
    const transcoder = new VideoTranscoderService({ get: key => key === 'upload.ffmpegPath' ? (process.env.FFMPEG_PATH || 'ffmpeg') : undefined });
    const manifest = { createdAt: new Date().toISOString(), entries: [] };
    const unique = new Map();
    for (const key of await filesUnder(upload)) {
      const source = await fs.readFile(path.join(upload, key));
      const digest = sha(source), original = path.join('originals', key);
      await fs.mkdir(path.dirname(path.join(backup, original)), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(backup, original), source, { flag: 'wx', mode: 0o600 });
      let encoded = unique.get(digest);
      if (!unique.has(digest)) {
        const before = await probe(path.join(upload, key));
        const outcome = await transcoder.transcode(source, 'video/mp4');
        encoded = null;
        if (outcome) {
          const candidate = `candidates/${digest}.mp4`;
          await fs.mkdir(path.join(backup, 'candidates'), { recursive: true, mode: 0o700 });
          await fs.writeFile(path.join(backup, candidate), outcome.buffer, { flag: 'wx', mode: 0o600 });
          const after = await probe(path.join(backup, candidate));
          if (!safeVideoMetadata(before, after) || !isFaststart(outcome.buffer)) throw new Error(`Unsafe candidate: ${key}`);
          // Full decode, not just header validation. Only one check per unique source.
          await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-threads', '1', '-i', path.join(backup, candidate), '-f', 'null', '-'], { timeout: 90_000, maxBuffer: 256 * 1024 });
          encoded = { candidate, shaAfter: sha(outcome.buffer), bytesAfter: outcome.buffer.length, before, after };
        }
        unique.set(digest, encoded);
      }
      const entry = { key, original, shaBefore: digest, bytesBefore: source.length, ...encoded, status: encoded ? 'STAGED' : 'KEEP_ORIGINAL' };
      manifest.entries.push(entry);
      await saveManifest(manifest);
      console.log(`${entry.status} ${key} ${entry.bytesBefore} -> ${entry.bytesAfter ?? entry.bytesBefore}`);
    }
    console.log(`STAGE_COMPLETE files=${manifest.entries.length} unique=${unique.size} manifest=${manifestPath}`);
    return;
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const entry of manifest.entries) {
    if (!entry.candidate) continue;
    for (const key of [entry.key, entry.original, entry.candidate]) {
      if (path.isAbsolute(key) || key.split(/[\\/]/).includes('..')) throw new Error('Unsafe manifest path');
    }
    const source = path.join(upload, entry.key);
    const current = sha(await fs.readFile(source));
    const desired = mode === '--apply' ? entry.shaAfter : entry.shaBefore;
    if (current === desired) { console.log(`ALREADY_DONE ${entry.key}`); continue; }
    if (current !== (mode === '--apply' ? entry.shaBefore : entry.shaAfter)) throw new Error(`Source changed: ${entry.key}`);
    const payload = await fs.readFile(path.join(backup, mode === '--apply' ? entry.candidate : entry.original));
    if (sha(payload) !== desired) throw new Error(`Backup/candidate hash mismatch: ${entry.key}`);
    // Atomic replacement on the same volume; no half-written live resources.
    const temporary = source + '.video-tmp';
    await fs.writeFile(temporary, payload, { flag: 'wx', mode: 0o644 });
    await fs.rename(temporary, source);
    if (sha(await fs.readFile(source)) !== desired) throw new Error(`Post-write mismatch: ${entry.key}`);
    entry.status = mode === '--apply' ? 'APPLIED' : 'RESTORED';
    await saveManifest(manifest);
    console.log(`${entry.status} ${entry.key}`);
  }
  console.log(`BATCH_COMPLETE mode=${mode} files=${manifest.entries.length}`);
}

module.exports = { isFaststart, safeVideoMetadata };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
