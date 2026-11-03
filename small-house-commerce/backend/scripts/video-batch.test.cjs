const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isFaststart, safeVideoMetadata } = require('./video-batch.cjs');
const box = name => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(name, 4, 'ascii'); return b; };
test('detects moov before mdat, not merely an ftyp header', () => {
  assert.equal(isFaststart(Buffer.concat(['ftyp','moov','mdat'].map(box))), true);
  assert.equal(isFaststart(Buffer.concat(['ftyp','mdat','moov'].map(box))), false);
  assert.equal(isFaststart(box('ftyp')), false);
});
test('requires matching duration, audio and compatible bounded video output', () => {
  const before = { duration: 10, audio: true };
  const after = { duration: 10.02, audio: true, codec: 'h264', width: 1280, height: 720 };
  assert.equal(safeVideoMetadata(before, after), true);
  for (const change of [{ duration: 5 }, { audio: false }, { codec: 'hevc' }, { height: 1080 }, { duration: NaN }]) {
    assert.equal(safeVideoMetadata(before, { ...after, ...change }), false);
  }
});
