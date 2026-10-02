'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
for (const extension of ['mp3', 'aac', 'm4a', 'opus', 'flac', 'wav']) {
  const file = path.join(__dirname, '..', 'tests', 'fixtures', `tone.${extension}`);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { timeout: 15_000, stdio: 'pipe' });
  process.stdout.write(`✓ decodable ${extension}\n`);
}
