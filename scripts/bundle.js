'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['src/endpoints.js', 'src/models.js', 'src/tokenizer.js', 'src/transport.js', 'src/binary.js', 'src/pcm.js', 'src/audio.js', 'src/errors.js', 'main.js'];

function bundlePlugin() {
  const bytes = fs.readFileSync(path.join(ROOT, 'vendor/o200k_base.tiktoken'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d') throw new Error('Tokenizer vocabulary checksum mismatch');
  const ranks = Object.create(null);
  for (const line of bytes.toString('ascii').trim().split('\n')) {
    const [token, rank] = line.split(' ');
    ranks[token] = Number(rank);
  }
  const vocabulary = 'var O200K_RANKS = null;\nfunction getO200kRanks() { if (O200K_RANKS === null) O200K_RANKS = JSON.parse(' + JSON.stringify(JSON.stringify(ranks)) + '); return O200K_RANKS; }\n';
  const source = vocabulary + SOURCES.map(file => '// Source: ' + file + '\n' + fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  new vm.Script(source, { filename: 'main.js' });
  return source;
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/bundle.js OUTPUT');
  fs.writeFileSync(output, bundlePlugin());
}

module.exports = { bundlePlugin };
