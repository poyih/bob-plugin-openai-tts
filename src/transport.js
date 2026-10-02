// transport: bundled with main.js for the Bob JavaScriptCore runtime.

function performAudioRequest(requestOptions, format, completion) {
    if (canUseStreamingAudioRequest()) {
        performStreamingAudioRequest(requestOptions, format, completion);
        return;
    }

    var finished = false;
    function finish(result) {
        if (finished) return;
        finished = true;
        completion(result);
    }
    requestOptions.handler = function(resp) {
        finish(safelyProcessAudioResponse(resp, format));
    };
    try {
        $http.request(requestOptions);
    } catch (e) {
        finish({ error: toServiceError(e) });
    }
}

function canUseStreamingAudioRequest() {
    return typeof $http !== 'undefined' && $http && typeof $http.streamRequest === 'function' &&
        typeof $signal !== 'undefined' && $signal && typeof $signal.new === 'function' &&
        typeof $data !== 'undefined' && $data && typeof $data.fromData === 'function';
}

function performStreamingAudioRequest(requestOptions, format, completion) {
    var cancelSignal;
    try {
        cancelSignal = $signal.new();
    } catch (e) {
        completion({ error: toServiceError(e) });
        return;
    }
    if (!cancelSignal || typeof cancelSignal.send !== 'function') {
        completion({ error: { type: 'network', message: '当前 Bob 版本无法安全地接收流式音频。' } });
        return;
    }

    var bufferedData = null;
    var bufferedLength = 0;
    var finished = false;

    function finish(result, shouldCancel) {
        if (finished) return;
        finished = true;
        if (shouldCancel) {
            try {
                cancelSignal.send();
            } catch (ignored) {}
        }
        completion(result);
    }

    requestOptions.cancelSignal = cancelSignal;
    requestOptions.streamHandler = function(stream) {
        if (finished || !stream) return;

        var chunk = stream.rawData;
        if (!chunk) return;
        var chunkLength = getRawDataLength(chunk);
        if (chunkLength < 0) {
            finish({ error: { type: 'api', message: '无法确认流式音频数据大小，已停止接收。' } }, true);
            return;
        }
        if (bufferedLength + chunkLength > MAX_AUDIO_BYTES) {
            finish({ error: audioTooLargeError(bufferedLength + chunkLength) }, true);
            return;
        }
        if (chunkLength === 0) return;

        try {
            if (!bufferedData) {
                bufferedData = $data.fromData(chunk);
            } else if (typeof bufferedData.appendData === 'function') {
                var appendedData = bufferedData.appendData(chunk);
                if (appendedData && typeof appendedData.toBase64 === 'function') {
                    bufferedData = appendedData;
                }
            } else {
                throw new Error('appendData is unavailable');
            }
            if (!bufferedData) throw new Error('fromData returned no data');
            bufferedLength += chunkLength;
            var actualLength = getRawDataLength(bufferedData);
            if (actualLength !== bufferedLength) {
                finish({ error: { type: 'api', message: '流式音频数据长度不一致，已停止接收。' } }, true);
                return;
            }
        } catch (e) {
            finish({ error: { type: 'api', message: '流式音频数据拼接失败。' } }, true);
        }
    };
    requestOptions.handler = function(resp) {
        if (finished) return;
        var combinedResponse = {
            response: resp && resp.response,
            error: resp && resp.error,
            data: resp && resp.data != null ? resp.data : bufferedData,
            rawData: resp && resp.rawData ? resp.rawData : bufferedData
        };
        finish(safelyProcessAudioResponse(combinedResponse, format), false);
    };

    try {
        $http.streamRequest(requestOptions);
    } catch (e) {
        finish({ error: toServiceError(e) }, true);
    }
}

function safelyProcessAudioResponse(resp, format) {
    try {
        return processAudioResponse(resp, format);
    } catch (error) {
        return { error: { type: 'api', message: '音频响应处理失败，请检查服务返回的音频格式。' } };
    }
}
