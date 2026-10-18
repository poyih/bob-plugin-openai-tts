'use strict';

module.exports = function register(h) {
  const { test, assert, loadPlugin, invokeTts, invokeValidate, assertError, fs, path, REPO_ROOT } = h;

  test('checks the 4096-character Instructions limit independently of mini token budgets', () => {
    for (const model of ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'openai/gpt-4o-mini-tts-2025-12-15']) {
      for (const instructions of ['a'.repeat(4097), 'a'.repeat(5000), 'a'.repeat(4096) + '😀']) {
        const plugin = loadPlugin({ customModel: model, instructions });
        assert.ok(plugin.context.countInputTokens(instructions) < 2000, 'regression must pass the token budget');
        assert.match(assertError(invokeTts(plugin, 'hello'), 'param').message, /Instructions.*4096.*字符/);
        assert.match(assertError(invokeValidate(plugin), 'param').message, /Instructions.*4096.*字符/);
        assert.equal(plugin.requests.length, 0);
      }
      for (const instructions of ['a'.repeat(4096), 'a'.repeat(4095) + '😀']) {
        const plugin = loadPlugin({ customModel: model, instructions });
        assert.ok(invokeTts(plugin, 'hello').result);
        assert.equal(plugin.requests[0].body.instructions, instructions);
      }
    }
  });

  test('retains token checks and ignores Instructions for models that do not send them', () => {
    const mini = loadPlugin({ model: 'gpt-4o-mini-tts', instructions: '😀'.repeat(2000) });
    assert.match(assertError(invokeTts(mini, 'hello'), 'param').message, /2000.*token/);
    assert.equal(mini.requests.length, 0);
    for (const model of ['tts-1', 'tts-1-hd', 'provider/custom-tts']) {
      const plugin = loadPlugin({ customModel: model, instructions: 'a'.repeat(5000) });
      assert.ok(invokeTts(plugin, 'hello').result);
      assert.equal(plugin.requests[0].body.instructions, undefined);
    }
  });

  test('normalizes Realtime WebSocket endpoints and preserves proxy paths and query options', () => {
    const cases = [
      ['https://api.openai.com', 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini'],
      ['api.openai.com/v1', 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini'],
      ['https://api.openai.com/v1/audio/speech', 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini'],
      ['wss://api.openai.com/v1/realtime', 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini'],
      ['https://proxy.test/api/v1/audio/speech?trace=1&model=old&%6Dodel=old2', 'wss://proxy.test/api/v1/realtime?trace=1&model=gpt-realtime-2.1-mini'],
      ['https://proxy.test/relay?trace=a%2Bb', 'wss://proxy.test/relay/v1/realtime?trace=a%2Bb&model=gpt-realtime-2.1-mini'],
      ['ws://localhost:8080/v1/realtime', 'ws://localhost:8080/v1/realtime?model=gpt-realtime-2.1-mini']
    ];
    for (const [apiUrl, expected] of cases) {
      const plugin = loadPlugin({ model: 'gpt-realtime-2.1-mini', apiUrl });
      assert.equal(plugin.context.getRealtimeApiUrl(), expected);
      assert.equal(plugin.context.validateOptions(), null);
    }
    const namespaced = loadPlugin({ customModel: 'openai/gpt-realtime-2.1-mini' });
    assert.match(namespaced.context.getRealtimeApiUrl(), /\?model=gpt-realtime-2\.1-mini$/);
  });

  test('keeps endpoint security rules and blocks incompatible Realtime routing', () => {
    for (const apiUrl of ['ws://proxy.test/v1/realtime', 'wss://user:secret@proxy.test/v1/realtime', 'wss://proxy.test/v1/realtime#fragment']) {
      const plugin = loadPlugin({ model: 'gpt-realtime-2.1-mini', apiUrl });
      assertError(invokeTts(plugin, 'hello'), 'param');
      assert.equal(plugin.requests.length, 0);
    }
    const router = loadPlugin({ model: 'gpt-realtime-2.1-mini', apiUrl: 'https://openrouter.ai' });
    assert.match(assertError(invokeTts(router, 'hello'), 'param').message, /Realtime.*WebSocket/);
    assert.equal(router.requests.length, 0);
    const insecure = loadPlugin({ model: 'gpt-realtime-2.1-mini', apiUrl: 'ws://proxy.test/v1/realtime', allowInsecureHttp: 'true' });
    assert.equal(insecure.context.validateOptions(), null);
  });

  test('validates Realtime voice, speed and Instructions without applying legacy token budgets', () => {
    const plugin = loadPlugin({ model: 'gpt-realtime-2.1-mini' });
    assert.equal(plugin.context.getVoice(), 'marin');
    assert.equal(plugin.context.getConfiguredAudioFormat(), 'pcm');
    assert.equal(plugin.context.isRealtimeTtsModel('provider/gpt-realtime-2.1-mini'), false);
    assert.equal(plugin.context.isRealtimeTtsModel('gpt-realtime-2.1-mini-unverified'), false);
    assert.equal(plugin.context.isRealtimeTtsModel('gpt-realtime-2.1-mini-2026-10-01'), true);
    assert.equal(plugin.context.validateInput('😀'.repeat(4096)), null);
    assert.match(plugin.context.validateInput('a'.repeat(4097)).message, /4096/);
    plugin.options.instructions = 'a'.repeat(4096);
    assert.equal(plugin.context.validateInput('hello'), null);
    plugin.options.instructions += 'a';
    assert.match(plugin.context.validateInput('hello').message, /Instructions.*4096/);
    for (const speed of ['0.1', '1.6', '4', 'Infinity', '1.5garbage']) {
      const invalid = loadPlugin({ model: 'gpt-realtime-2.1-mini', speed });
      assert.match(assertError(invokeTts(invalid, 'hello'), 'param').message, /Speed.*1\.5/);
    }
    const invalidVoice = loadPlugin({ model: 'gpt-realtime-2.1-mini', voiceRealtime: 'fable' });
    assert.match(assertError(invokeTts(invalidVoice, 'hello'), 'param').message, /Realtime.*音色/);
  });

  test('offers Realtime for new installations while retaining the released legacy model IDs', () => {
    const info = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'info.json'), 'utf8'));
    const options = new Map(info.options.map(option => [option.identifier, option]));
    assert.equal(options.get('model').defaultValue, 'gpt-realtime-2.1-mini');
    const ids = options.get('model').menuValues.map(item => item.value);
    for (const model of ['gpt-realtime-2.1-mini', 'tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15']) assert.ok(ids.includes(model));
    assert.equal(options.get('voiceRealtime').defaultValue, 'marin');
    assert.deepEqual(options.get('voiceRealtime').menuValues.map(item => item.value).sort(), Array.from(loadPlugin().context.getRealtimeVoices()).sort(), 'Realtime voice menu must match its validated set');
  });

  test('redacts credentials in WebSocket URLs from service errors', () => {
    const plugin = loadPlugin();
    for (const scheme of ['http', 'https', 'ws', 'wss']) {
      const error = plugin.context.toServiceError({ message: 'connection failed at ' + scheme + '://user:private-password@proxy.test/v1/realtime' });
      assert.doesNotMatch(error.message, /user:private-password/);
      assert.match(error.message, /\[REDACTED\]@proxy\.test/);
    }
  });
};
