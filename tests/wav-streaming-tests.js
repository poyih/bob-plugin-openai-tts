'use strict';

module.exports = function register(h) {
  const { test, assert, loadPlugin, invokeTts, invokeValidate, assertError, response, rawData,
    makeWavFile, VALID_WAV_BYTES } = h;
  const UNKNOWN_LENGTH = 0xffffffff;
  const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

  function chunks(bytes) {
    const result = [];
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = bytes.readUInt32LE(offset + 4);
      result.push({ id: bytes.subarray(offset, offset + 4).toString('ascii'), offset, length });
      offset += 8 + length + (length & 1);
    }
    return result;
  }

  function withUnknownLengths(bytes, riff = true, data = true) {
    const copy = Buffer.from(bytes);
    const dataChunk = chunks(copy).find(chunk => chunk.id === 'data');
    if (riff) copy.writeUInt32LE(UNKNOWN_LENGTH, 4);
    if (data) copy.writeUInt32LE(UNKNOWN_LENGTH, dataChunk.offset + 4);
    return copy;
  }

  function addMetadata(bytes, size, afterData = false) {
    const chunk = Buffer.alloc(8 + size + (size & 1));
    chunk.write('JUNK');
    chunk.writeUInt32LE(size, 4);
    for (let index = 0; index < size; index++) chunk[8 + index] = (index * 37 + 11) & 255;
    const at = afterData ? bytes.length : chunks(bytes).find(item => item.id === 'data').offset;
    const joined = Buffer.concat([bytes.subarray(0, at), chunk, bytes.subarray(at)]);
    joined.writeUInt32LE(joined.length - 8, 4);
    return joined;
  }

  function pluginFor(bytes, format, streaming, extra) {
    return loadPlugin({ responseFormat: format }, () => {
      const result = response(200, 'audio/wav', bytes, undefined, { expectedContentLength: -1 });
      if (streaming) result.streamChunks = [rawData(bytes.subarray(0, 5)), rawData(bytes.subarray(5, 41)), rawData(bytes.subarray(41))];
      return Object.assign(result, extra || {});
    }, { streaming });
  }

  test('normalizes unknown WAV RIFF and data lengths after ordinary or streaming requests', () => {
    const original = Buffer.from(VALID_WAV_BYTES);
    for (const [riff, data] of [[true, true], [true, false], [false, true]]) {
      for (const streaming of [false, true]) {
        for (const format of ['wav', 'pcm']) {
          const plugin = pluginFor(withUnknownLengths(original, riff, data), format, streaming);
          const result = invokeTts(plugin, 'hello').result;
          assert.ok(result, `expected WAV for ${format}, streaming=${streaming}`);
          assert.deepEqual(Buffer.from(result.value, 'base64'), original);
          assert.equal(result.raw.format, 'wav');
          assert.equal(invokeValidate(plugin).result, true);
        }
      }
    }
  });

  test('preserves complete WAV bytes and metadata while repairing only placeholder lengths', () => {
    for (const size of [1, 2, 3, 4, 255]) {
      let original = Buffer.from(makeWavFile([0, 0, 1, 0, 2, 0, 3, 0]));
      original = addMetadata(original, size);
      const input = withUnknownLengths(original);
      for (const streaming of [false, true]) {
        assert.deepEqual(Buffer.from(invokeTts(pluginFor(input, 'wav', streaming), 'hello').result.value, 'base64'), original);
        assert.deepEqual(Buffer.from(invokeTts(pluginFor(original, 'wav', streaming), 'hello').result.value, 'base64'), original);
      }
      const withTrailingMetadata = addMetadata(original, 3, true);
      const riffOnly = withUnknownLengths(withTrailingMetadata, true, false);
      assert.deepEqual(Buffer.from(invokeTts(pluginFor(riffOnly, 'wav', false), 'hello').result.value, 'base64'), withTrailingMetadata);
    }
  });

  test('recognizes binary WAV responses to PCM requests without wrapping malformed WAV as raw samples', () => {
    const original = Buffer.from(makeWavFile([0, 0, 1, 0, 2, 0, 3, 0]));
    const input = withUnknownLengths(original);
    for (const mime of ['application/octet-stream', '']) {
      for (const streaming of [false, true]) {
        const extra = { response: { statusCode: 200, MIMEType: mime, expectedContentLength: -1 } };
        const plugin = pluginFor(input, 'pcm', streaming, extra);
        assert.deepEqual(Buffer.from(invokeTts(plugin, 'hello').result.value, 'base64'), original);
        const truncated = pluginFor(input.subarray(0, -1), 'pcm', streaming, extra);
        assertError(invokeTts(truncated, 'hello'), 'api');
      }
    }
  });

  test('requires actual lengths for ordinary WAV files and every metadata chunk', () => {
    const original = Buffer.from(makeWavFile([0, 0, 1, 0, 2, 0, 3, 0]));
    const wrongRiff = Buffer.from(original);
    wrongRiff.writeUInt32LE(original.length - 10, 4);
    const wrongData = Buffer.from(original);
    wrongData.writeUInt32LE(original.length, 40);
    const wrongMetadata = addMetadata(original, 4);
    wrongMetadata.writeUInt32LE(UNKNOWN_LENGTH, 40);
    wrongMetadata.writeUInt32LE(UNKNOWN_LENGTH, 4);
    const wrongFormat = Buffer.from(original);
    wrongFormat.writeUInt32LE(UNKNOWN_LENGTH, 16);
    wrongFormat.writeUInt32LE(UNKNOWN_LENGTH, 4);
    for (const bytes of [wrongRiff, wrongData, wrongMetadata, wrongFormat, original.subarray(0, -1)]) {
      for (const streaming of [false, true]) {
        for (const format of ['wav', 'pcm']) assertError(invokeTts(pluginFor(bytes, format, streaming), 'hello'), 'api');
      }
    }
  });

  test('rejects empty or partial PCM frames in both ordinary and unknown-length WAV', () => {
    const ordinary = Buffer.from(makeWavFile([0, 0, 1, 0, 2, 0, 3, 0]));
    const partialStereo = Buffer.from(ordinary.subarray(0, -2));
    partialStereo.writeUInt16LE(2, 22);
    partialStereo.writeUInt32LE(96000, 28);
    partialStereo.writeUInt16LE(4, 32);
    partialStereo.writeUInt32LE(partialStereo.length - 8, 4);
    partialStereo.writeUInt32LE(partialStereo.length - 44, 40);
    const empty = Buffer.from(makeWavFile([]));
    const partialMono = Buffer.from(ordinary.subarray(0, -1));
    partialMono.writeUInt32LE(UNKNOWN_LENGTH, 4);
    partialMono.writeUInt32LE(UNKNOWN_LENGTH, 40);
    for (const bytes of [empty, withUnknownLengths(empty), partialStereo, withUnknownLengths(partialStereo), partialMono]) {
      for (const streaming of [false, true]) assertError(invokeTts(pluginFor(bytes, 'wav', streaming), 'hello'), 'api');
    }
  });

  test('validates WAV format parameters before accepting or normalizing PCM audio', () => {
    const original = Buffer.from(makeWavFile([0, 0, 1, 0, 2, 0, 3, 0]));
    const invalid = [];
    for (const [offset, value, width] of [[20, 0, 2], [22, 0, 2], [24, 0, 4], [28, 1, 4], [32, 1, 2], [34, 0, 2]]) {
      const bytes = Buffer.from(original);
      if (width === 2) bytes.writeUInt16LE(value, offset);
      else bytes.writeUInt32LE(value, offset);
      invalid.push(bytes, withUnknownLengths(bytes));
    }
    for (const bytes of invalid) assertError(invokeTts(pluginFor(bytes, 'wav', false), 'hello'), 'api');
  });

  test('keeps the WAV size cap before reading or encoding an oversized response', () => {
    const input = withUnknownLengths(Buffer.from(makeWavFile([0, 0, 1, 0])));
    let encoded = 0;
    let read = 0;
    const plugin = loadPlugin({ responseFormat: 'wav' }, () => ({
      response: { statusCode: 200, MIMEType: 'audio/wav', expectedContentLength: -1 },
      rawData: rawData(input, {
        length: MAX_AUDIO_BYTES + 1,
        readUInt8() { read++; throw new Error('must not read oversized WAV'); },
        toBase64() { encoded++; throw new Error('must not encode oversized WAV'); }
      })
    }), { streaming: false });
    assert.match(assertError(invokeTts(plugin, 'hello'), 'api').message, /64 MB/);
    assert.equal(encoded, 0);
    assert.equal(read, 0);
    for (const streaming of [false, true]) {
      const declaredLarge = pluginFor(input, 'wav', streaming, {
        response: { statusCode: 200, MIMEType: 'audio/wav', expectedContentLength: MAX_AUDIO_BYTES + 1 }
      });
      assert.match(assertError(invokeTts(declaredLarge, 'hello'), 'api').message, /64 MB/);
    }
  });

  test('reports WAV binary API failures and changed Base64 lengths without returning audio', () => {
    const input = withUnknownLengths(Buffer.from(makeWavFile([0, 0, 1, 0])));
    const cases = [
      { readUInt8() { throw new Error('unreadable'); } },
      { toBase64() { throw new Error('unencodable'); } },
      { toBase64() { return input.subarray(0, -1).toString('base64'); } },
      { toBase64() { return 'invalid base64'; } }
    ];
    for (const overrides of cases) {
      const plugin = loadPlugin({ responseFormat: 'wav' }, () => ({
        response: { statusCode: 200, MIMEType: 'audio/wav' },
        rawData: rawData(input, overrides)
      }), { streaming: false });
      assertError(invokeTts(plugin, 'hello'), 'api');
    }
  });

  test('repairs a large WAV without expanding the audio into a JavaScript byte array', () => {
    const original = Buffer.from(makeWavFile(new Uint8Array(1024 * 1024)));
    const input = withUnknownLengths(original);
    const plugin = loadPlugin({ responseFormat: 'wav' }, () => response(200, 'audio/wav', input), { streaming: false });
    const NativeUint8Array = plugin.context.Uint8Array || Uint8Array;
    plugin.context.Uint8Array = function(length) {
      assert.ok(length <= 8, `unexpected full audio allocation: ${length}`);
      return new NativeUint8Array(length);
    };
    assert.deepEqual(Buffer.from(invokeTts(plugin, 'hello').result.value, 'base64'), original);
  });
};
