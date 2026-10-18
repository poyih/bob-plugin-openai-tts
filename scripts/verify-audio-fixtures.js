'use strict';

const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { bundlePlugin } = require('./bundle');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
for (const extension of ['mp3', 'aac', 'm4a', 'opus', 'flac', 'wav']) {
  const file = path.join(__dirname, '..', 'tests', 'fixtures', `tone.${extension}`);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { timeout: 15_000, stdio: 'pipe' });
  process.stdout.write(`✓ decodable ${extension}\n`);
}

// Generate an actual non-seekable WAV instead of patching a fixture by hand.
// FFmpeg writes unknown RIFF/data lengths and may include metadata chunks.
const fixture = path.join(__dirname, '..', 'tests', 'fixtures', 'tone.wav');
const options = { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, stdio: 'pipe' };
const streamed = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', fixture,
  '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], options);
assert.equal(streamed.readUInt32LE(4), 0xffffffff, 'streaming fixture must have an unknown RIFF length');
let dataOffset = 12;
while (dataOffset + 8 <= streamed.length && streamed.toString('ascii', dataOffset, dataOffset + 4) !== 'data') {
  const length = streamed.readUInt32LE(dataOffset + 4);
  dataOffset += 8 + length + (length & 1);
}
assert.ok(dataOffset + 8 < streamed.length, 'streaming fixture must contain audio');
assert.equal(streamed.readUInt32LE(dataOffset + 4), 0xffffffff, 'streaming fixture must have an unknown data length');

const context = { $option: { model: 'tts-1', apiUrl: 'https://api.openai.com' } };
vm.createContext(context);
new vm.Script(bundlePlugin()).runInContext(context);
const raw = {
  length: streamed.length,
  readUInt8(index) { return streamed[index]; },
  toBase64() { return streamed.toString('base64'); }
};
const expectedPcm = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', fixture,
  '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], options);
for (const format of ['wav', 'pcm']) {
  const result = context.processAudioResponse({
    response: { statusCode: 200, MIMEType: 'audio/wav', expectedContentLength: -1 }, rawData: raw
  }, format);
  assert.ok(result.base64, result.error && result.error.message);
  const normalized = Buffer.from(result.base64, 'base64');
  assert.equal(normalized.readUInt32LE(4), normalized.length - 8);
  const decoded = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', 'pipe:0',
    '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], { ...options, input: normalized });
  assert.deepEqual(decoded, expectedPcm, 'normalizing the WAV must preserve every audio sample');
  process.stdout.write(`✓ streaming WAV normalized via ${format}: decodable, identical PCM\n`);
}
