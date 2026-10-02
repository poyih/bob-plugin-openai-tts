// endpoints: bundled with main.js for the Bob JavaScriptCore runtime.

function parseApiEndpoint(value) {
    var rawValue = value == null ? '' : String(value);
    if (!rawValue.trim()) {
        rawValue = 'https://api.openai.com';
    }

    if (/[\u0000-\u001f\u007f]/.test(rawValue)) {
        return { error: 'API 地址不能包含控制字符。' };
    }

    var base = rawValue.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
        base = 'https://' + base;
    }

    var match = /^(https?):\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(base);
    if (!match) {
        return { error: 'API 地址格式无效，仅支持 HTTP 或 HTTPS 地址。' };
    }
    if (match[5]) {
        return { error: 'API 地址不能包含片段（#fragment）。' };
    }

    var scheme = match[1].toLowerCase();
    var authority = match[2];
    var path = match[3] || '';
    var query = match[4] || '';

    if (authority.indexOf('@') !== -1) {
        return { error: 'API 地址不能包含用户名或密码。' };
    }
    if (/\s|\\/.test(authority) || /\s|\\/.test(path) || /\s/.test(query)) {
        return { error: 'API 地址不能包含空格或反斜杠。' };
    }
    if (path && path.charAt(0) !== '/') {
        return { error: 'API 地址路径格式无效。' };
    }

    var hostResult = parseAuthority(authority);
    if (hostResult.error) {
        return { error: hostResult.error };
    }

    var hostname = hostResult.hostname;
    var openRouter = hostname === 'openrouter.ai' || endsWith(hostname, '.openrouter.ai');
    var normalizedPath = normalizeApiPath(path, openRouter);
    var normalizedAuthority = hostResult.isIpv6 ? '[' + hostname + ']' : hostname;
    if (hostResult.port) {
        normalizedAuthority += ':' + hostResult.port;
    }

    return {
        url: scheme + '://' + normalizedAuthority + normalizedPath + query,
        scheme: scheme,
        hostname: hostname,
        port: hostResult.port,
        isLoopback: isLoopbackHostname(hostname),
        isOpenRouter: openRouter
    };
}

function parseAuthority(authority) {
    var hostname = '';
    var port = '';
    var isIpv6 = false;
    var match;

    if (authority.charAt(0) === '[') {
        match = /^\[([0-9a-f:.]+)\](?::([0-9]+))?$/i.exec(authority);
        if (!match) {
            return { error: 'API 地址中的 IPv6 主机或端口无效。' };
        }
        hostname = match[1].toLowerCase();
        port = match[2] || '';
        isIpv6 = true;
    } else {
        match = /^([^:]+)(?::([0-9]+))?$/.exec(authority);
        if (!match) {
            return { error: 'API 地址中的主机或端口无效。' };
        }
        hostname = match[1].toLowerCase();
        port = match[2] || '';
        if (!/^[a-z0-9.-]+$/i.test(hostname)) {
            return { error: 'API 地址中的主机名无效。' };
        }
    }

    hostname = hostname.replace(/\.+$/, '');
    if (!hostname || hostname.indexOf('..') !== -1 || hostname.charAt(0) === '.' || hostname.charAt(0) === '-') {
        return { error: 'API 地址中的主机名无效。' };
    }
    if (port) {
        var portNumber = parseInt(port, 10);
        if (portNumber < 1 || portNumber > 65535) {
            return { error: 'API 地址中的端口必须在 1 到 65535 之间。' };
        }
        port = String(portNumber);
    }

    return { hostname: hostname, port: port, isIpv6: isIpv6 };
}

function normalizeApiPath(path, openRouter) {
    var normalized = path || '';
    normalized = normalized.replace(/\/+$/, '');

    if (openRouter) {
        // OpenRouter 只有这一条 TTS 路径。把常见基地址、旧 /tts 地址和仿 OpenAI 的错误路径统一纠正。
        if (!normalized ||
            /^\/(?:api(?:\/v1)?|v1)$/i.test(normalized) ||
            /^\/(?:(?:api\/v1|v1)\/)?(?:audio(?:\/speech)?|tts)$/i.test(normalized)) {
            return '/api/v1/audio/speech';
        }
        return normalized + '/api/v1/audio/speech';
    }

    if (/\/audio\/speech$/i.test(normalized)) {
        return normalized;
    }
    if (/\/audio$/i.test(normalized)) {
        return normalized + '/speech';
    }

    // 对非 OpenRouter 的第三方服务保留显式 /tts 端点，避免破坏其自定义 API。
    if (/\/tts$/i.test(normalized)) {
        return normalized;
    }
    if (/\/v1$/i.test(normalized)) {
        return normalized + '/audio/speech';
    }
    if (!normalized) {
        return '/v1/audio/speech';
    }
    return normalized + '/v1/audio/speech';
}

function endsWith(value, suffix) {
    return value.slice(-suffix.length) === suffix;
}

function isLoopbackHostname(hostname) {
    if (hostname === 'localhost') {
        return true;
    }
    var ipv4Match = /^(127)\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.exec(hostname);
    if (ipv4Match) {
        for (var i = 1; i < ipv4Match.length; i++) {
            if (parseInt(ipv4Match[i], 10) > 255) return false;
        }
        return true;
    }
    return hostname === '::1' || hostname === '0:0:0:0:0:0:0:1';
}

function resolveConfiguredEndpoint() {
    var rawApiUrl = typeof $option === 'undefined' ? '' : $option.apiUrl;
    return parseApiEndpoint(rawApiUrl);
}

function isUsingOpenRouter() {
    var endpoint = resolveConfiguredEndpoint();
    return !endpoint.error && endpoint.isOpenRouter;
}

function getApiUrl() {
    var endpoint = resolveConfiguredEndpoint();
    return endpoint.error ? '' : endpoint.url;
}

function clampFormat(format) {
    var capabilities = getModelCapabilities(getModel());
    if (capabilities.formats && capabilities.formats.indexOf(format) === -1) return 'mp3';
    if (isUsingOpenRouter() && format !== 'mp3' && format !== 'pcm') return 'mp3';
    return format;
}
