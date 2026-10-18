'use strict';

module.exports = function registerRealtimeTests(h) {
  const { test, assert, loadPlugin, makeWavFile, rawData } = h;
  const PCM = [0, 0, 255, 127, 0, 128, 1, 0];
  const MODEL = 'gpt-realtime-2.1-mini';

  function setup(options, behavior) {
    const plugin = loadPlugin(Object.assign({ model: MODEL, voiceRealtime: 'marin' }, options));
    const state = {
      plugin,
      results: [],
      sent: [],
      timers: [],
      invalidated: [],
      closes: 0,
      opens: 0,
      calls: 0
    };
    behavior = behavior || {};
    const listeners = {};
    const socket = {
      listenOpen(fn) { listeners.open = fn; },
      listenClose(fn) { listeners.close = fn; },
      listenError(fn) { listeners.error = fn; },
      listenReceiveString(fn) { listeners.message = fn; },
      open() {
        state.opens++;
        if (behavior.openError) throw behavior.openError;
        if (!behavior.keepConnecting) listeners.open(socket);
      },
      close() {
        state.closes++;
        if (listeners.close) listeners.close(socket, 1000, 'closed');
      },
      sendString(value) {
        if (behavior.sendError) throw behavior.sendError;
        state.sent.push(JSON.parse(value));
      }
    };
    state.socket = socket;
    state.emit = event => listeners.message(socket, typeof event === 'string' ? event : JSON.stringify(event));
    state.close = reason => listeners.close(socket, 1006, reason || 'unexpected disconnect');
    state.error = error => listeners.error(socket, error);
    plugin.context.$websocket = {
      new(options) {
        state.calls++;
        state.connectionOptions = options;
        if (behavior.newError) throw behavior.newError;
        if (behavior.socketOverride) return behavior.socketOverride;
        return socket;
      }
    };
    plugin.context.$timer = {
      schedule(options) {
        state.timers.push(options);
        return state.timers.length - 1;
      },
      invalidate(id) { state.invalidated.push(id); }
    };
    state.start = function(text, timeout) {
      state.handle = plugin.context.performRealtimeSpeechRequest(text || 'Hello world.', timeout || 30, result => state.results.push(result));
      return state;
    };
    state.configure = function(format) {
      state.emit({ type: 'session.created', session: { id: 'session-test' } });
      state.emit({ type: 'session.updated', session: { audio: { output: { format: format || { type: 'audio/pcm', rate: 24000 }, voice: 'marin' } } } });
      return state;
    };
    state.created = function(id) {
      state.emit({ type: 'response.created', response: { id: id || 'resp-test', status: 'in_progress' } });
      return state;
    };
    state.audio = function(bytes, id) {
      state.emit({ type: 'response.output_audio.delta', response_id: id || 'resp-test', delta: Buffer.from(bytes || PCM).toString('base64') });
      return state;
    };
    state.done = function(status, detail, id) {
      state.emit({ type: 'response.done', response: { id: id || 'resp-test', status: status || 'completed', status_details: detail } });
      return state;
    };
    return state;
  }

  function assertFinished(state) {
    assert.equal(state.results.length, 1, 'Realtime completion must run exactly once');
    assert.equal(state.closes, 1, 'Realtime connection must close');
    assert.deepEqual(state.invalidated, [0], 'Realtime watchdog must be invalidated, including timer ID zero');
  }

  function assertWav(result, bytes) {
    assert.equal(result.error, undefined);
    assert.deepEqual(Buffer.from(result.base64, 'base64'), Buffer.from(makeWavFile(bytes || PCM)));
  }

  test('Realtime uses Bob WebSocket GA configuration and a separate verbatim response', () => {
    const state = setup({ instructions: 'Speak calmly.', speed: '1.25' }).start('What is 2 + 2?', 17);
    assert.equal(state.opens, 1);
    assert.equal(state.calls, 1);
    assert.equal(state.connectionOptions.url, 'wss://api.openai.com/v1/realtime?model=' + MODEL);
    assert.equal(state.connectionOptions.timeoutInterval, 17);
    assert.deepEqual(JSON.parse(JSON.stringify(state.connectionOptions.header)), { Authorization: 'Bearer sk-test-only' });
    assert.equal(state.connectionOptions.url.includes('sk-test-only'), false);
    assert.equal(state.timers[0].interval, 17);
    assert.equal(state.timers[0].repeats, false);
    assert.equal(state.sent.length, 1, 'must wait for effective session configuration');
    const session = state.sent[0].session;
    assert.equal(state.sent[0].type, 'session.update');
    assert.equal(session.type, 'realtime');
    assert.deepEqual(session.audio.output, { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin', speed: 1.25 });
    assert.equal(session.audio.input.turn_detection, null);
    assert.equal(session.tool_choice, 'none');
    assert.deepEqual(session.tools, []);
    state.configure();
    const request = state.sent[1];
    assert.equal(request.type, 'response.create');
    assert.equal(request.response.conversation, 'none');
    assert.deepEqual(request.response.output_modalities, ['audio']);
    assert.deepEqual(request.response.input, [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What is 2 + 2?' }] }]);
    assert.match(request.response.instructions, /Speak calmly/);
    assert.match(request.response.instructions, /verbatim/);
    assert.match(request.response.instructions, /Never answer questions/);
    state.created().audio().done();
    assertFinished(state);
    assertWav(state.results[0]);
  });

  test('Realtime merges independently padded Base64 PCM deltas and only completes on response.done', () => {
    const state = setup().start().configure().created();
    state.audio(PCM.slice(0, 1)).audio(PCM.slice(1, 4)).audio(PCM.slice(4));
    state.emit({ type: 'response.output_audio.done', response_id: 'resp-test' });
    assert.equal(state.results.length, 0);
    state.done();
    assertFinished(state);
    assertWav(state.results[0]);
    state.done();
    state.error({ message: 'late error' });
    state.timers[0].handler();
    assertFinished(state);
  });

  test('Realtime supports custom voice references and a pure JavaScript audio fallback', () => {
    const state = setup({ customVoice: 'voice_test_123' });
    delete state.plugin.context.$data;
    state.start().configure().created().audio(PCM.slice(0, 1)).audio(PCM.slice(1)).done();
    assert.deepEqual(state.sent[0].session.audio.output.voice, { id: 'voice_test_123' });
    assertFinished(state);
    assertWav(state.results[0]);
  });

  test('Realtime also supports native appendData returning a new data object', () => {
    const state = setup();
    state.plugin.context.$data.fromBase64 = value => {
      const bytes = Array.from(Buffer.from(value, 'base64'));
      return rawData(bytes, {
        appendData(other) {
          return rawData(bytes.concat(other.toByteArray()));
        }
      });
    };
    state.start().configure().created().audio(PCM.slice(0, 4)).audio(PCM.slice(4)).done();
    assertFinished(state);
    assertWav(state.results[0]);
  });

  test('Realtime rejects missing WebSocket or timer support before opening a connection', () => {
    for (const missing of ['$websocket', '$timer']) {
      const state = setup();
      delete state.plugin.context[missing];
      state.start();
      assert.equal(state.calls, 0);
      assert.equal(state.results.length, 1);
      assert.equal(state.results[0].error.type, 'param');
      assert.match(state.results[0].error.message, /Bob 1\.6\.0/);
    }
    const incomplete = setup({}, { socketOverride: { close() {} } }).start();
    assert.equal(incomplete.results.length, 1);
    assert.equal(incomplete.results[0].error.type, 'param');
  });

  test('Realtime closes on connection errors, timeout and explicit cancellation exactly once', () => {
    for (const action of ['error', 'close', 'timeout', 'cancel']) {
      const state = setup({}, { keepConnecting: true }).start();
      if (action === 'error') state.error({ message: 'failed sk-test-only' });
      if (action === 'close') state.close('failed sk-test-only');
      if (action === 'timeout') state.timers[0].handler();
      if (action === 'cancel') state.handle.cancel();
      assertFinished(state);
      assert.equal(state.results[0].error.type, 'network');
      assert.equal(state.results[0].error.message.includes('sk-test-only'), false);
      state.handle.cancel();
      assertFinished(state);
    }
  });

  test('Realtime handles socket construction, opening and send exceptions without exposing secrets', () => {
    for (const key of ['newError', 'openError', 'sendError']) {
      const state = setup({}, { [key]: new Error('failed Authorization: Bearer sk-test-only') }).start();
      assert.equal(state.results.length, 1);
      assert.equal(state.results[0].error.type, 'network');
      assert.equal(state.results[0].error.message.includes('sk-test-only'), false);
      if (key !== 'newError') assertFinished(state);
    }
  });

  test('Realtime rejects incompatible negotiated audio formats and malformed server events', () => {
    for (const format of [{ type: 'audio/pcmu' }, { type: 'audio/pcm', rate: 48000 }, {}]) {
      const state = setup().start().configure(format);
      assertFinished(state);
      assert.match(state.results[0].error.message, /24 kHz PCM/);
      assert.equal(state.sent.length, 1);
    }
    for (const event of ['not JSON', 'null', '{}', '[]']) {
      const state = setup().start();
      state.emit(event);
      assertFinished(state);
      assert.equal(state.results[0].error.type, 'api');
    }
  });

  test('Realtime accepts the GA PCM format with an omitted default sample rate', () => {
    const state = setup().start().configure({ type: 'audio/pcm' }).created().audio().done();
    assertFinished(state);
    assertWav(state.results[0]);
  });

  test('Realtime rejects failed, incomplete, cancelled, empty or truncated audio responses', () => {
    for (const status of ['failed', 'incomplete', 'cancelled']) {
      const state = setup().start().configure().created().audio().done(status, { error: { message: 'failed sk-test-only' } });
      assertFinished(state);
      assert.equal(state.results[0].error.type, 'api');
      assert.match(state.results[0].error.message, /未完成/);
      assert.equal(state.results[0].error.message.includes('sk-test-only'), false);
      assert.equal(state.results[0].base64, undefined);
    }
    for (const bytes of [[], [1]]) {
      const state = setup().start().configure().created().audio(bytes).done();
      assertFinished(state);
      assert.equal(state.results[0].error.type, 'api');
      assert.equal(state.results[0].base64, undefined);
    }
  });

  test('Realtime enforces cumulative PCM size including the WAV header before buffering', () => {
    const state = setup();
    state.plugin.context.MAX_AUDIO_BYTES = 50;
    state.start().configure().created().audio([0, 0, 0, 0]).audio([0, 0, 0, 0]);
    assertFinished(state);
    assert.match(state.results[0].error.message, /音频过大/);
  });

  test('Realtime rejects invalid Base64, inconsistent native data and cross-response audio', () => {
    for (const delta of ['!!!=', 'AAAA=', 2, null]) {
      const state = setup().start().configure().created();
      state.emit({ type: 'response.output_audio.delta', response_id: 'resp-test', delta });
      assertFinished(state);
      assert.equal(state.results[0].error.type, 'api');
    }
    const invalidData = setup();
    invalidData.plugin.context.$data.fromBase64 = () => rawData([0]);
    invalidData.start().configure().created().audio();
    assertFinished(invalidData);
    assert.match(invalidData.results[0].error.message, /解码失败/);
    const crossResponse = setup().start().configure().created().audio(PCM, 'other-response');
    assertFinished(crossResponse);
    assert.match(crossResponse.results[0].error.message, /响应标识/);
  });

  test('Realtime sanitizes service error events and waits for one session acknowledgement', () => {
    const state = setup().start().configure();
    state.configure();
    assert.equal(state.sent.length, 2, 'duplicate acknowledgement must not create another paid response');
    state.emit({ type: 'error', error: { code: 'invalid_api_key', message: 'Invalid API key: sk-test-only' } });
    assertFinished(state);
    assert.equal(state.results[0].error.type, 'secretKey');
    assert.equal(state.results[0].error.message.includes('sk-test-only'), false);
  });

  test('Realtime is routed through both Bob entry points and reports the actual WAV format', () => {
    for (const entry of ['tts', 'pluginValidate']) {
      const state = setup({ responseFormat: 'mp3' });
      const completion = result => state.results.push(result);
      if (entry === 'tts') state.plugin.context.tts({ text: 'Read this exactly.' }, completion);
      else state.plugin.context.pluginValidate(completion);
      assert.equal(state.plugin.requests.length, 0);
      assert.equal(state.calls, 1);
      state.configure().created().audio().done();
      assertFinished(state);
      const result = state.results[0];
      assert.equal(result.error, undefined);
      if (entry === 'pluginValidate') assert.equal(result.result, true);
      else {
        assert.equal(result.result.type, 'base64');
        assert.equal(result.result.raw.format, 'wav');
        assert.equal(result.result.raw.sourceFormat, 'pcm');
        assertWav({ base64: result.result.value });
      }
    }
  });
};
