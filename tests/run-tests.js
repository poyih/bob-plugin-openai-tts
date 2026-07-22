'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAIN_PATH = path.join(REPO_ROOT, 'main.js');
const INFO_PATH = path.join(REPO_ROOT, 'info.json');
const APPCAST_PATH = path.join(REPO_ROOT, 'appcast.json');
const LICENSE_PATH = path.join(REPO_ROOT, 'LICENSE');
const CI_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const MAIN_SOURCE = fs.readFileSync(MAIN_PATH, 'utf8');
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

function makeMpegFrame() {
  const bytes = new Array(417).fill(0);
  bytes.splice(0, 4, 0xff, 0xfb, 0x90, 0x64);
  return bytes;
}

function makeWavFile(pcm) {
  const bytes = Buffer.alloc(44 + pcm.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + pcm.length, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(pcm.length, 40);
  Buffer.from(pcm).copy(bytes, 44);
  return Array.from(bytes);
}

function makeOggSegmentPage(payload, lacing, headerType, sequence) {
  assert.equal(lacing.reduce((sum, value) => sum + value, 0), payload.length);
  const header = new Array(27 + lacing.length).fill(0);
  header.splice(0, 4, ...utf8('OggS'));
  header[5] = headerType;
  header[14] = 1;
  header[18] = sequence;
  header[26] = lacing.length;
  for (let index = 0; index < lacing.length; index += 1) header[27 + index] = lacing[index];
  return header.concat(payload);
}

function makeOggPage(payload, headerType, sequence) {
  assert.ok(payload.length > 0 && payload.length < 255);
  return makeOggSegmentPage(payload, [payload.length], headerType, sequence);
}

function flacCrc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? (crc << 1 ^ 0x07) & 0xff : crc << 1 & 0xff;
  }
  return crc;
}

function flacCrc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? (crc << 1 ^ 0x8005) & 0xffff : crc << 1 & 0xffff;
  }
  return crc;
}

function makeFlacFile() {
  const streamInfo = new Array(34).fill(0);
  streamInfo[1] = 0x10;
  streamInfo[3] = 0x10;
  streamInfo[10] = 0x0a;
  streamInfo[11] = 0xc4;
  streamInfo[12] = 0x40;
  streamInfo[13] = 0xf0;
  streamInfo[17] = 0x10;
  const frameHeader = [0xff, 0xf8, 0x60, 0x00, 0x00, 0x0f];
  frameHeader.push(flacCrc8(frameHeader));
  const frame = frameHeader.concat([0x00, 0x00, 0x00]);
  const frameCrc = flacCrc16(frame);
  frame.push(frameCrc >>> 8, frameCrc & 0xff);
  return [...utf8('fLaC'), 0x80, 0x00, 0x00, 0x22, ...streamInfo, ...frame];
}

const MPEG_FRAME_BYTES = Object.freeze(makeMpegFrame());
const VALID_MP3_BYTES = Object.freeze([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ...MPEG_FRAME_BYTES
]);
const VALID_AAC_BYTES = Object.freeze([0xff, 0xf1, 0x50, 0x80, 0x01, 0x3f, 0xfc, 0x00, 0x00]);
const VALID_MP4_BYTES = Object.freeze([
  0x00, 0x00, 0x00, 0x10, ...utf8('ftypM4A '), 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x09, ...utf8('mdat'), 0x00
]);
const VALID_FLAC_BYTES = Object.freeze(makeFlacFile());
const OPUS_HEAD = Object.freeze([...utf8('OpusHead'), 0x01, 0x01, 0x00, 0x00, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00]);
const OPUS_TAGS = Object.freeze([...utf8('OpusTags'), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const VALID_OPUS_BYTES = Object.freeze(
  makeOggPage(OPUS_HEAD, 0x02, 0)
    .concat(makeOggPage(OPUS_TAGS, 0x00, 1))
    .concat(makeOggPage([0xf8, 0xff, 0xfe], 0x00, 2))
);
const VALID_WAV_BYTES = Object.freeze(makeWavFile([0x00, 0x00]));

const DEFAULT_OPTIONS = Object.freeze({
  apiKey: 'sk-test-only',
  apiUrl: 'https://api.openai.com',
  model: 'tts-1',
  customModel: '',
  voice: 'alloy',
  voiceMini: 'marin',
  customVoice: '',
  speed: '1.0',
  responseFormat: 'mp3',
  instructions: '',
  allowInsecureHttp: 'false'
});

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function utf8(value) {
  return Array.from(Buffer.from(value, 'utf8'));
}

function rawData(bytes, overrides) {
  let copy = Uint8Array.from(bytes);
  const data = {
    __isBobData: true,
    length: copy.length,
    readUInt8(index) {
      if (index < 0 || index >= copy.length) throw new RangeError('readUInt8 out of bounds');
      return copy[index];
    },
    toByteArray() {
      return Array.from(copy);
    },
    appendData(other) {
      const suffix = other && typeof other.toByteArray === 'function'
        ? Uint8Array.from(other.toByteArray())
        : Uint8Array.from([]);
      const joined = new Uint8Array(copy.length + suffix.length);
      joined.set(copy, 0);
      joined.set(suffix, copy.length);
      copy = joined;
      this.length = copy.length;
    },
    toBase64() {
      return Buffer.from(copy).toString('base64');
    }
  };
  return Object.assign(data, overrides || {});
}

function response(statusCode, mimeType, bytes, data, responseOverrides) {
  const payload = bytes == null ? [] : bytes;
  return {
    response: Object.assign({
      statusCode,
      MIMEType: mimeType,
      expectedContentLength: payload.length
    }, responseOverrides || {}),
    data,
    rawData: rawData(payload)
  };
}

function mp3Response() {
  return response(200, 'audio/mpeg', VALID_MP3_BYTES);
}

function streamText(raw) {
  if (!raw || typeof raw.toByteArray !== 'function') return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw.toByteArray()));
  } catch (error) {
    return '';
  }
}

function loadPlugin(optionOverrides, responder, environmentOverrides) {
  const requests = [];
  const signals = [];
  const options = Object.assign({}, DEFAULT_OPTIONS, optionOverrides || {});
  const environment = Object.assign({ streaming: true }, environmentOverrides || {});
  const resolveResponse = request => typeof responder === 'function'
    ? responder(request, requests.length - 1)
    : mp3Response();
  const context = {
    $option: options,
    $data: {
      fromByteArray(bytes) {
        return rawData(bytes);
      },
      fromBase64(value) {
        return rawData(Buffer.from(String(value), 'base64'));
      },
      fromData(value) {
        return rawData(value && typeof value.toByteArray === 'function' ? value.toByteArray() : []);
      },
      isData(value) {
        return !!(value && value.__isBobData === true);
      }
    },
    $signal: {
      new() {
        const signal = {
          sent: false,
          send() {
            this.sent = true;
          }
        };
        signals.push(signal);
        return signal;
      }
    },
    $http: {
      request(request) {
        requests.push(request);
        const result = resolveResponse(request);
        if (result !== undefined) {
          request.handler(result);
        }
      }
    }
  };
  if (environment.streaming) {
    context.$http.streamRequest = request => {
      requests.push(request);
      const result = resolveResponse(request);
      if (result === undefined) return;
      const chunks = Array.isArray(result.streamChunks)
        ? result.streamChunks
        : (result.rawData ? [{ rawData: result.rawData, text: streamText(result.rawData) }] : []);
      for (const chunk of chunks) {
        const raw = chunk && chunk.rawData ? chunk.rawData : chunk;
        request.streamHandler({
          rawData: raw,
          text: chunk && typeof chunk.text === 'string' ? chunk.text : streamText(raw)
        });
      }
      request.handler({ response: result.response, error: result.error });
    };
  }

  vm.createContext(context);
  vm.runInContext(MAIN_SOURCE, context, { filename: MAIN_PATH });
  return { context, options, requests, signals };
}

function invokeTts(plugin, text) {
  let output;
  let completionCount = 0;
  plugin.context.tts({ text }, value => {
    completionCount += 1;
    output = value;
  });
  assert.notEqual(output, undefined, 'tts completion was not called');
  assert.equal(completionCount, 1, 'tts completion must be called exactly once');
  return output;
}

function invokeValidate(plugin) {
  let output;
  let completionCount = 0;
  plugin.context.pluginValidate(value => {
    completionCount += 1;
    output = value;
  });
  assert.notEqual(output, undefined, 'pluginValidate completion was not called');
  assert.equal(completionCount, 1, 'pluginValidate completion must be called exactly once');
  return output;
}

function assertError(output, type) {
  assert.ok(output && output.error, 'expected an error result');
  if (type) assert.equal(output.error.type, type);
  assert.equal(typeof output.error.message, 'string');
  assert.ok(output.error.message.length > 0);
  return output.error;
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  assert.ok(match, `invalid semantic version: ${value}`);
  return match.slice(1, 4).map(Number);
}

function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

test('normalizes OpenAI-compatible and OpenRouter endpoint URLs without losing queries', () => {
  const cases = [
    ['api.openai.com', 'https://api.openai.com/v1/audio/speech'],
    ['https://api.openai.com', 'https://api.openai.com/v1/audio/speech'],
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/audio/speech'],
    ['https://api.openai.com/v1/audio', 'https://api.openai.com/v1/audio/speech'],
    ['https://api.openai.com/v1/audio/speech', 'https://api.openai.com/v1/audio/speech'],
    ['https://proxy.test?api-version=2025-01-01', 'https://proxy.test/v1/audio/speech?api-version=2025-01-01'],
    ['https://proxy.test/v1/audio/speech?api-version=2025-01-01', 'https://proxy.test/v1/audio/speech?api-version=2025-01-01'],
    ['https://openrouter.ai', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai/api', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai/v1', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai/v1/audio/speech', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai/audio', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai:443/api/v1', 'https://openrouter.ai:443/api/v1/audio/speech'],
    ['https://openrouter.ai/api/v1/tts', 'https://openrouter.ai/api/v1/audio/speech'],
    ['https://openrouter.ai/api/v1?trace=1', 'https://openrouter.ai/api/v1/audio/speech?trace=1']
  ];

  for (const [input, expected] of cases) {
    const plugin = loadPlugin({ apiUrl: input });
    assert.equal(plugin.context.getApiUrl(), expected, input);
  }
});

test('blocks credential-bearing insecure or ambiguous endpoints by default', () => {
  let plugin = loadPlugin({ apiUrl: 'http://example.test' });
  assert.match(assertError({ error: plugin.context.validateOptions() }, 'param').message, /HTTPS|http/i);

  plugin = loadPlugin({ apiUrl: 'http://localhost:8080' });
  assert.equal(plugin.context.validateOptions(), null, 'loopback HTTP should remain usable for development');

  for (const apiUrl of ['http://127.0.0.1:8080', 'http://127.255.255.254', 'http://[::1]:8080']) {
    plugin = loadPlugin({ apiUrl });
    assert.equal(plugin.context.validateOptions(), null, `${apiUrl} should be recognized as loopback`);
  }

  for (const apiUrl of ['http://127', 'http://127.0.0.999', 'http://127.0.0.1.example.test', 'http://api.localhost']) {
    plugin = loadPlugin({ apiUrl });
    assert.match(assertError({ error: plugin.context.validateOptions() }, 'param').message, /HTTPS|http/i, apiUrl);
  }

  plugin = loadPlugin({ apiUrl: 'http://example.test', allowInsecureHttp: 'true' });
  assert.equal(plugin.context.validateOptions(), null, 'explicit insecure opt-in should be honored');

  plugin = loadPlugin({ apiUrl: 'https://user:password@example.test' });
  assert.match(assertError({ error: plugin.context.validateOptions() }, 'param').message, /地址|URL|userinfo|用户信息/i);

  plugin = loadPlugin({ apiUrl: 'https://example.test/#fragment' });
  assert.match(assertError({ error: plugin.context.validateOptions() }, 'param').message, /片段|fragment|#|URL/i);
});

test('uses the current OpenRouter path and provider-specific request contract', () => {
  const plugin = loadPlugin({
    apiUrl: 'https://openrouter.ai/api/v1',
    customModel: 'openai/gpt-4o-mini-tts-2025-12-15',
    customVoice: 'provider/custom-voice',
    responseFormat: 'flac',
    instructions: 'Speak calmly.'
  });
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(plugin.requests.length, 1);
  const request = plugin.requests[0];
  assert.equal(request.url, 'https://openrouter.ai/api/v1/audio/speech');
  assert.equal(request.body.response_format, 'mp3');
  assert.equal(request.body.voice, 'provider/custom-voice');
  assert.equal(request.body.instructions, undefined);
  assert.equal(request.body.provider.options.openai.instructions, 'Speak calmly.');
});

test('uses direct OpenAI instructions and custom voice object syntax', () => {
  const plugin = loadPlugin({
    model: 'gpt-4o-mini-tts',
    customVoice: 'voice_custom123',
    instructions: 'Speak brightly.',
    speed: '1.5'
  });
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  const body = plugin.requests[0].body;
  assert.equal(JSON.stringify(body.voice), JSON.stringify({ id: 'voice_custom123' }));
  assert.equal(body.instructions, 'Speak brightly.');
  assert.equal(body.provider, undefined);
  assert.equal(body.speed, undefined);
});

test('reports a missing API key with Bob secretKey classification', () => {
  const plugin = loadPlugin({ apiKey: '' });
  const output = invokeTts(plugin, 'hello');
  assertError(output, 'secretKey');
  assert.equal(plugin.requests.length, 0);
});

test('validation requires a successful status and a non-empty audio response', () => {
  let plugin = loadPlugin({}, () => response(204, 'audio/mpeg', []));
  assertError(invokeValidate(plugin), 'api');

  plugin = loadPlugin({}, () => response(
    200,
    'application/json',
    utf8('{"error":{"message":"not audio"}}'),
    { error: { message: 'not audio' } }
  ));
  assertError(invokeValidate(plugin), 'api');
});

test('rejects redirects and classifies HTTP status failures as network errors', () => {
  let plugin = loadPlugin({}, () => response(302, 'text/html', utf8('redirect'), 'redirect'));
  assertError(invokeTts(plugin, 'hello'), 'network');

  plugin = loadPlugin({}, () => response(503, 'application/json', utf8('{"message":"down"}'), { message: 'down' }));
  assertError(invokeTts(plugin, 'hello'), 'network');

  plugin = loadPlugin({}, () => response(206, 'audio/mpeg', VALID_MP3_BYTES));
  assertError(invokeTts(plugin, 'hello'), 'network');
});

test('rejects JSON or HTML bodies returned with a 2xx status', () => {
  let plugin = loadPlugin({}, () => response(
    200,
    'application/json; charset=utf-8',
    utf8('{"error":{"message":"bad request"}}'),
    { error: { message: 'bad request' } }
  ));
  assertError(invokeTts(plugin, 'hello'), 'api');

  plugin = loadPlugin({}, () => response(200, 'text/html', utf8('<html>not audio</html>'), '<html>not audio</html>'));
  assertError(invokeTts(plugin, 'hello'), 'api');
});

test('rejects MIME, magic and requested-format mismatches', () => {
  let plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/mpeg', VALID_MP3_BYTES));
  assertError(invokeTts(plugin, 'hello'), 'api');

  plugin = loadPlugin({}, () => response(200, 'audio/mpeg', utf8('quota exceeded'), 'quota exceeded'));
  assertError(invokeTts(plugin, 'hello'), 'api');

  plugin = loadPlugin({}, () => response(200, '', utf8('quota exceeded'), 'quota exceeded'));
  assertError(invokeTts(plugin, 'hello'), 'api');

  plugin = loadPlugin({}, () => response(200, 'audio/mpeg', [0x01, 0x02, 0x03, 0x04]));
  assertError(invokeTts(plugin, 'hello'), 'api');

  plugin = loadPlugin({}, () => response(200, 'audio/mpeg', utf8('ID3 is not enough')));
  assertError(invokeTts(plugin, 'hello'), 'api');

  const truncatedCases = [
    ['mp3', 'audio/mpeg', [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
    ['mp3', 'audio/mpeg', [0xff, 0xfb, 0x90, 0x64]],
    ['aac', 'audio/aac', [0xff, 0xf1, 0x50, 0x80, 0x00, 0xff, 0xfc]],
    ['aac', 'audio/aac', [0xff, 0xf0, 0x50, 0x80, 0x01, 0x3f, 0xfc, 0x00, 0x00]],
    ['aac', 'audio/aac', VALID_AAC_BYTES.slice(0, 7)],
    ['opus', 'audio/ogg', VALID_OPUS_BYTES.slice(0, 47)],
    ['flac', 'audio/flac', VALID_FLAC_BYTES.slice(0, 52)],
    ['wav', 'audio/wav', VALID_WAV_BYTES.slice(0, 44)]
  ];
  for (const [format, mimeType, bytes] of truncatedCases) {
    plugin = loadPlugin({ responseFormat: format }, () => response(200, mimeType, bytes));
    assertError(invokeTts(plugin, 'hello'), 'api');
  }
});

test('accepts a non-empty audio body and returns Base64', () => {
  const bytes = VALID_MP3_BYTES;
  const plugin = loadPlugin({}, () => response(200, 'audio/mpeg', bytes));
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(output.result.type, 'base64');
  assert.equal(output.result.value, Buffer.from(bytes).toString('base64'));
});

test('accepts the advertised AAC, OPUS, FLAC and WAV signatures', () => {
  const cases = [
    ['aac', 'audio/aac', VALID_AAC_BYTES],
    ['aac', 'audio/mp4', VALID_MP4_BYTES],
    ['opus', 'audio/ogg', VALID_OPUS_BYTES],
    ['flac', 'audio/flac', VALID_FLAC_BYTES],
    ['wav', 'audio/wav', VALID_WAV_BYTES]
  ];
  for (const [format, mimeType, bytes] of cases) {
    const plugin = loadPlugin({ responseFormat: format }, () => response(200, mimeType, bytes));
    const output = invokeTts(plugin, 'hello');
    assert.ok(output.result, `${format} should be accepted`);
    assert.equal(output.result.value, Buffer.from(bytes).toString('base64'));
  }
});

test('accepts an Ogg OpusTags packet continued across pages', () => {
  const tags = Array.from(OPUS_TAGS).concat(new Array(244).fill(0));
  const bytes = makeOggPage(OPUS_HEAD, 0x02, 0)
    .concat(makeOggSegmentPage(tags.slice(0, 255), [255], 0x00, 1))
    .concat(makeOggSegmentPage(tags.slice(255), [5], 0x01, 2))
    .concat(makeOggPage([0xf8, 0xff, 0xfe], 0x00, 3));
  const plugin = loadPlugin({ responseFormat: 'opus' }, () => response(200, 'audio/ogg', bytes));
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(output.result.value, Buffer.from(bytes).toString('base64'));
});

test('accepts Bob data objects in resp.data for a valid MP3 response', () => {
  const bytes = VALID_MP3_BYTES;
  const plugin = loadPlugin({}, () => {
    const bobData = rawData(bytes);
    return {
      response: {
        statusCode: 200,
        MIMEType: 'audio/mpeg',
        expectedContentLength: bytes.length
      },
      data: bobData,
      rawData: bobData
    };
  }, { streaming: false });
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(output.result.value, Buffer.from(bytes).toString('base64'));
});

test('rejects a plain-text error body even when the response has no MIME type', () => {
  const plugin = loadPlugin({}, () => response(200, '', utf8('Unauthorized'), 'Unauthorized'));
  const error = assertError(invokeTts(plugin, 'hello'), 'api');
  assert.match(error.message, /Unauthorized|音频|响应|audio/i);
});

test('rejects responses above the configured audio size cap before Base64 expansion', () => {
  let plugin = loadPlugin({}, () => response(
    200,
    'audio/mpeg',
    [0x49, 0x44, 0x33],
    undefined,
    { expectedContentLength: MAX_AUDIO_BYTES + 1 }
  ));
  assert.match(assertError(invokeTts(plugin, 'hello'), 'api').message, /过大|大小|large|64/i);

  plugin = loadPlugin({}, () => {
    const result = response(200, 'audio/mpeg', [0x49, 0x44, 0x33]);
    result.response.expectedContentLength = -1;
    result.rawData.length = MAX_AUDIO_BYTES + 1;
    return result;
  });
  assert.match(assertError(invokeTts(plugin, 'hello'), 'api').message, /过大|大小|large|64/i);

  plugin = loadPlugin({}, () => {
    const result = response(200, 'audio/mpeg', VALID_MP3_BYTES);
    result.rawData.length = undefined;
    result.rawData.byteLength = undefined;
    return result;
  }, { streaming: false });
  assert.match(assertError(invokeTts(plugin, 'hello'), 'api').message, /大小|size|确认/i);
});

test('reassembles Bob streamRequest chunks whose appendData mutates in place', () => {
  const plugin = loadPlugin({}, () => ({
    response: {
      statusCode: 200,
      MIMEType: 'audio/mpeg',
      expectedContentLength: VALID_MP3_BYTES.length
    },
    streamChunks: [
      { rawData: rawData(VALID_MP3_BYTES.slice(0, 4)) },
      { rawData: rawData(VALID_MP3_BYTES.slice(4)) }
    ]
  }));
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(output.result.value, Buffer.from(VALID_MP3_BYTES).toString('base64'));
  assert.equal(plugin.requests.length, 1);
  assert.equal(typeof plugin.requests[0].streamHandler, 'function');
});

test('cancels a streaming response before buffering a chunk above 64 MB', () => {
  const oversizedChunk = rawData(VALID_MP3_BYTES, { length: MAX_AUDIO_BYTES + 1 });
  const plugin = loadPlugin({}, () => ({
    response: {
      statusCode: 200,
      MIMEType: 'audio/mpeg',
      expectedContentLength: -1
    },
    streamChunks: [{ rawData: oversizedChunk }]
  }));
  assert.match(assertError(invokeTts(plugin, 'hello'), 'api').message, /过大|大小|large|64/i);
  assert.equal(plugin.signals.length, 1);
  assert.equal(plugin.signals[0].sent, true);
});

test('retains the request fallback when Bob streaming APIs are unavailable', () => {
  const plugin = loadPlugin({}, () => mp3Response(), { streaming: false });
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(output.result.value, Buffer.from(VALID_MP3_BYTES).toString('base64'));
  assert.equal(plugin.signals.length, 0);
});

test('completes the non-streaming fallback only once on duplicate callbacks and a late throw', () => {
  const plugin = loadPlugin({}, undefined, { streaming: false });
  plugin.context.$http.request = request => {
    request.handler(mp3Response());
    request.handler(mp3Response());
    throw new Error('late transport error');
  };
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
});

test('wraps headerless 24 kHz mono 16-bit PCM in a WAV container', () => {
  const pcm = [0x00, 0x00, 0xff, 0x7f, 0x00, 0x80];
  const plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/pcm', pcm));
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  const wav = Buffer.from(output.result.value, 'base64');
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.subarray(12, 16).toString('ascii'), 'fmt ');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.subarray(36, 40).toString('ascii'), 'data');
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(Array.from(wav.subarray(44)), pcm);
});

test('accepts a structurally complete WAV returned for a PCM request without double-wrapping', () => {
  const plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/wav', VALID_WAV_BYTES));
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  assert.equal(output.result.value, Buffer.from(VALID_WAV_BYTES).toString('base64'));

  const truncated = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/wav', VALID_WAV_BYTES.slice(0, 44)));
  assertError(invokeTts(truncated, 'hello'), 'api');
});

test('does not mistake JSON-looking PCM samples for a structured error', () => {
  const pcm = [0x7b, 0x22, 0x00, 0x00];
  const plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(
    200,
    'audio/pcm',
    pcm,
    '{"\u0000\u0000'
  ));
  const output = invokeTts(plugin, 'hello');
  assert.ok(output.result);
  const wav = Buffer.from(output.result.value, 'base64');
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.deepEqual(Array.from(wav.subarray(44)), pcm);
});

test('trusts an explicit PCM MIME when raw samples collide with other format signatures', () => {
  const cases = [
    [0xff, 0xfb, 0x90, 0x00],
    utf8('fLaC'),
    VALID_WAV_BYTES
  ];
  for (const pcm of cases) {
    const plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/pcm', pcm));
    const output = invokeTts(plugin, 'hello');
    assert.ok(output.result);
    const wav = Buffer.from(output.result.value, 'base64');
    assert.equal(wav.length, pcm.length + 44);
    assert.deepEqual(Array.from(wav.subarray(44)), Array.from(pcm));
  }
});

test('rejects a structured API error even when it is mislabeled as PCM', () => {
  const body = '{"error":{"message":"bad"}} ';
  assert.equal(Buffer.byteLength(body) % 2, 0);
  let plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/pcm', utf8(body), { error: { message: 'bad' } }));
  assertError(invokeTts(plugin, 'hello'), 'api');

  plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(
    200,
    'audio/pcm',
    utf8(body),
    { error: { message: 'bad' } }
  ), { streaming: false });
  assertError(invokeTts(plugin, 'hello'), 'api');

  const pluralBody = '{"errors":[{"message":"bad"}]} ';
  plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/pcm', utf8(pluralBody), pluralBody));
  assertError(invokeTts(plugin, 'hello'), 'api');

  let longBody = '{"error":{"message":"' + 'x'.repeat(9000) + '"}}';
  if (Buffer.byteLength(longBody) % 2 !== 0) longBody += ' ';
  plugin = loadPlugin({ responseFormat: 'pcm' }, () => response(200, 'audio/pcm', utf8(longBody), longBody));
  assertError(invokeTts(plugin, 'hello'), 'api');
});

test('counts Unicode code points rather than UTF-16 code units for the text limit', () => {
  let plugin = loadPlugin();
  let output = invokeTts(plugin, '😀'.repeat(4096));
  assert.ok(output.result);
  assert.equal(plugin.requests.length, 1);

  plugin = loadPlugin();
  output = invokeTts(plugin, '😀'.repeat(4097));
  assertError(output, 'param');
  assert.equal(plugin.requests.length, 0);
});

test('keeps Bob host timeout above request timeouts', () => {
  let plugin = loadPlugin();
  assert.equal(typeof plugin.context.pluginTimeoutInterval, 'function');
  const hostTimeout = plugin.context.pluginTimeoutInterval();
  assert.ok(hostTimeout >= 120, `host timeout is only ${hostTimeout}s`);
  invokeTts(plugin, 'hello');
  assert.ok(plugin.requests[0].timeout <= 105);
  assert.ok(plugin.requests[0].timeout < hostTimeout);

  plugin = loadPlugin();
  invokeValidate(plugin);
  assert.ok(plugin.requests[0].timeout <= 30);
  assert.ok(plugin.requests[0].timeout < hostTimeout);
});

test('redacts credentials from upstream HTTP and transport errors', () => {
  const secret = 'sk-live-SECRET-123456789';
  let plugin = loadPlugin({}, () => response(
    401,
    'application/json',
    utf8('{"error":{"message":"Authorization: Bearer ' + secret + '"}}'),
    { error: { message: 'Authorization: Bearer ' + secret } }
  ));
  let error = assertError(invokeTts(plugin, 'hello'), 'network');
  assert.doesNotMatch(error.message, /SECRET|sk-live|Bearer|Authorization/i);
  assert.ok(error.message.length <= 650);

  plugin = loadPlugin({}, () => ({
    error: { localizedDescription: 'failed with Bearer ' + secret + ' at https://user:pass@example.test' }
  }));
  error = assertError(invokeTts(plugin, 'hello'), 'network');
  assert.doesNotMatch(error.message, /SECRET|sk-live|Bearer|Authorization|user:pass/i);

  const longSecret = 'custom-secret-' + 'x'.repeat(9000);
  plugin = loadPlugin({ apiKey: longSecret }, () => ({
    error: { message: 'upstream echoed ' + longSecret }
  }));
  error = assertError(invokeTts(plugin, 'hello'), 'network');
  assert.match(error.message, /REDACTED/);
  assert.doesNotMatch(error.message, /custom-secret|x{12}/);

  plugin = loadPlugin({ apiKey: longSecret }, () => ({
    error: { message: ' '.repeat(8185) + longSecret }
  }));
  error = assertError(invokeTts(plugin, 'hello'), 'network');
  assert.match(error.message, /REDACTED/);
  assert.doesNotMatch(error.message, /custom|x{4}/);
});

test('manifest uses Bob option schema and exposes the new safety controls', () => {
  const info = JSON.parse(fs.readFileSync(INFO_PATH, 'utf8'));
  assert.equal(info.identifier, 'bob-plugin-openai-tts', 'the released identifier is an immutable compatibility key');
  assert.equal(info.category, 'tts');
  assert.equal(info.version, require(path.join(REPO_ROOT, 'package.json')).version);
  assert.ok(compareSemver(info.version, '1.5.0') >= 0);

  const visit = value => {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'description'), false, 'Bob option schema uses desc, not description');
    for (const child of Object.values(value)) visit(child);
  };
  visit(info.options);

  const options = new Map(info.options.map(option => [option.identifier, option]));
  assert.equal(options.size, info.options.length, 'option identifiers must be unique');
  assert.equal(options.get('apiKey').textConfig.type, 'secure');
  assert.equal(options.get('customVoice').type, 'text');
  assert.equal(options.get('allowInsecureHttp').type, 'menu');
  assert.equal(options.get('allowInsecureHttp').defaultValue, 'false');
  assert.match(options.get('apiUrl').desc, /audio\/speech/);

  const legacyVoices = new Set(options.get('voice').menuValues.map(item => item.value));
  for (const voice of ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer']) {
    assert.ok(legacyVoices.has(voice), `missing tts-1 voice: ${voice}`);
  }
});

test('repository carries the declared MIT license', () => {
  const manifest = JSON.parse(fs.readFileSync(INFO_PATH, 'utf8'));
  const packageMetadata = require(path.join(REPO_ROOT, 'package.json'));
  const license = fs.readFileSync(LICENSE_PATH, 'utf8');
  assert.equal(packageMetadata.license, 'MIT');
  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 poyih/);
  assert.equal(manifest.author.includes('poyih'), true);
});

test('CI covers Node 18 and 22 and pins third-party actions by commit', () => {
  const workflow = fs.readFileSync(CI_PATH, 'utf8');
  assert.match(workflow, /node-version:\s*\['18', '22'\]/);
  const actionRefs = Array.from(workflow.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/g));
  assert.ok(actionRefs.length >= 3, 'expected checkout, setup-node and upload-artifact actions');
  for (const match of actionRefs) {
    assert.match(match[2], /^[a-f0-9]{40}$/, `${match[1]} must be pinned to a full commit SHA`);
  }
});

test('appcast is structurally safe, ordered, and compatible with the manifest identifier', () => {
  const info = JSON.parse(fs.readFileSync(INFO_PATH, 'utf8'));
  const appcast = JSON.parse(fs.readFileSync(APPCAST_PATH, 'utf8'));
  assert.equal(appcast.identifier, info.identifier);
  assert.ok(Array.isArray(appcast.versions) && appcast.versions.length > 0);
  assert.equal(new Set(appcast.versions.map(item => item.version)).size, appcast.versions.length, 'duplicate appcast versions');
  assert.equal(new Set(appcast.versions.map(item => item.timestamp)).size, appcast.versions.length, 'duplicate release timestamps');
  assert.ok(compareSemver(info.version, appcast.versions[0].version) >= 0, 'feed cannot be newer than local manifest');
  assert.equal(appcast.versions[appcast.versions.length - 1].version, '0.3.3', 'current identifier feed must not include legacy-ID artifacts');

  for (let index = 0; index < appcast.versions.length; index += 1) {
    const item = appcast.versions[index];
    parseSemver(item.version);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.match(item.url, /^https:\/\//);
    assert.ok(item.url.includes(`/v${item.version}/openai-tts-${item.version}.bobplugin`));
    assert.ok(Number.isInteger(item.timestamp) && item.timestamp > 1_500_000_000_000);
    if (index > 0) {
      assert.ok(compareSemver(appcast.versions[index - 1].version, item.version) > 0, 'appcast versions must be strictly descending');
      assert.ok(appcast.versions[index - 1].timestamp > item.timestamp, 'release timestamps must descend with versions');
    }
  }
});

(async () => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.fn();
      process.stdout.write(`✓ ${item.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`✗ ${item.name}\n${error.stack || error}\n`);
    }
  }

  process.stdout.write(`\n${tests.length - failures}/${tests.length} tests passed\n`);
  if (failures > 0) process.exitCode = 1;
})();
