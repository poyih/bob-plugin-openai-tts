'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APPCAST_PATH = path.join(REPO_ROOT, 'appcast.json');
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_INFO_BYTES = 256 * 1024;
const EXPECTED_REPOSITORY = 'poyih/bob-plugin-openai-tts';
const USER_AGENT = 'bob-plugin-openai-tts-appcast-verifier';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseReleaseAssetUrl(value) {
  const url = new URL(value);
  invariant(url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port && !url.search && !url.hash, `unsupported release URL: ${value}`);
  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/v([^/]+)\/([^/]+)$/.exec(url.pathname);
  invariant(match, `invalid GitHub release asset URL: ${value}`);
  return {
    owner: decodeURIComponent(match[1]),
    repository: decodeURIComponent(match[2]),
    version: decodeURIComponent(match[3]),
    assetName: decodeURIComponent(match[4])
  };
}

async function readResponseBytes(response, maximumBytes, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maximumBytes) {
    const error = new Error(`response exceeds ${maximumBytes} bytes`);
    error.retryable = false;
    if (response.body) response.body.cancel().catch(() => {});
    throw error;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  if (signal) signal.addEventListener('abort', cancel, { once: true });
  if (signal && signal.aborted) cancel();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        const error = new Error(`response exceeds ${maximumBytes} bytes`);
        error.retryable = false;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (signal) signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function checkedFetch(url, options = {}, policy = {}) {
  const fetchImpl = policy.fetchImpl || fetch;
  const timeoutMs = policy.timeoutMs ?? 30_000;
  const maximumBytes = policy.maximumBytes ?? MAX_METADATA_BYTES;
  const attempts = policy.attempts ?? 3;
  const retryDelayMs = policy.retryDelayMs ?? 500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    let timer;
    let response;
    try {
      const deadline = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error(`${url} timed out after ${timeoutMs}ms`);
          error.retryable = true;
          reject(error);
        }, timeoutMs);
      });
      const work = (async () => {
        response = await fetchImpl(url, { ...options, signal: controller.signal });
        if (controller.signal.aborted) {
          if (response.body) response.body.cancel().catch(() => {});
          throw new Error('Request aborted');
        }
        if (!response.ok) {
          const error = new Error(`${url} returned HTTP ${response.status}`);
          error.retryable = response.status === 429 || response.status >= 500;
          if (response.body) response.body.cancel().catch(() => {});
          throw error;
        }
        const bytes = await readResponseBytes(response, maximumBytes, controller.signal);
        return { response, bytes };
      })();
      return await Promise.race([work, deadline]);
    } catch (error) {
      controller.abort();
      if (error.retryable === false || attempt + 1 === attempts) throw error;
      const retryAfter = response && response.headers.get('retry-after');
      let delay = retryDelayMs * 2 ** attempt;
      if (retryAfter) {
        const requested = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        // Do not retry earlier than the server requested or stall the entire CI job.
        if (Number.isFinite(requested) && requested > 5000) throw error;
        if (Number.isFinite(requested)) delay = Math.max(delay, requested);
      }
      clearTimeout(timer);
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Fetch attempt count must be positive');
}

function readPackagedInfo(bytes, version) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-plugin-appcast-'));
  const archivePath = path.join(tempDirectory, `openai-tts-${version}.bobplugin`);
  try {
    fs.writeFileSync(archivePath, bytes, { flag: 'wx', mode: 0o600 });
    const rawInfo = childProcess.execFileSync('unzip', ['-p', archivePath, 'info.json'], {
      encoding: 'utf8', maxBuffer: MAX_INFO_BYTES, timeout: 10_000, windowsHide: true
    });
    invariant(Buffer.byteLength(rawInfo, 'utf8') <= MAX_INFO_BYTES, `${version}: packaged info.json is unexpectedly large`);
    return JSON.parse(rawInfo);
  } catch (error) {
    throw new Error(`${version}: cannot read packaged info.json: ${error.message}`);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

async function verifyVersion(item, expectedIdentifier) {
  const target = parseReleaseAssetUrl(item.url);
  invariant(`${target.owner}/${target.repository}` === EXPECTED_REPOSITORY, `${item.version}: release URL points outside ${EXPECTED_REPOSITORY}`);
  invariant(target.version === item.version, `${item.version}: URL tag does not match version`);
  invariant(target.assetName === `openai-tts-${item.version}.bobplugin`, `${item.version}: unexpected asset name`);
  const headers = {
    Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': USER_AGENT
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/releases/tags/v${encodeURIComponent(item.version)}`;
  const metadata = await checkedFetch(apiUrl, { headers });
  const release = JSON.parse(metadata.bytes.toString('utf8'));
  invariant(release.draft === false && release.prerelease === false, `${item.version}: appcast must reference a published stable release`);
  invariant(Date.parse(release.published_at) === item.timestamp, `${item.version}: publishedAt does not match appcast timestamp`);
  const asset = Array.isArray(release.assets) ? release.assets.find(candidate => candidate.name === target.assetName) : null;
  invariant(asset, `${item.version}: release asset not found`);
  invariant(asset.state === 'uploaded', `${item.version}: release asset is not fully uploaded`);
  invariant(asset.browser_download_url === item.url, `${item.version}: release asset URL does not match appcast`);
  invariant(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_ASSET_BYTES, `${item.version}: release asset size is invalid`);
  const download = await checkedFetch(item.url, { headers: { 'User-Agent': USER_AGENT } }, { maximumBytes: asset.size });
  const declared = download.response.headers.get('content-length');
  invariant(declared === null || Number(declared) === asset.size, `${item.version}: downloaded size does not match GitHub metadata`);
  const bytes = download.bytes;
  invariant(bytes.length === asset.size, `${item.version}: downloaded size does not match GitHub metadata`);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  invariant(digest === item.sha256, `${item.version}: SHA-256 mismatch (received ${digest})`);
  const packagedInfo = readPackagedInfo(bytes, item.version);
  invariant(packagedInfo.version === item.version, `${item.version}: packaged version does not match appcast`);
  invariant(packagedInfo.identifier === expectedIdentifier, `${item.version}: packaged identifier does not match appcast`);
  invariant(packagedInfo.minBobVersion === item.minBobVersion, `${item.version}: packaged minBobVersion does not match appcast`);
  process.stdout.write(`✓ ${item.version} (${bytes.length} bytes)\n`);
}

async function main() {
  invariant(typeof fetch === 'function', 'Node.js 18 or newer is required');
  const appcast = JSON.parse(fs.readFileSync(APPCAST_PATH, 'utf8'));
  invariant(appcast.identifier === 'bob-plugin-openai-tts', 'unexpected appcast identifier');
  invariant(Array.isArray(appcast.versions) && appcast.versions.length > 0, 'appcast has no versions');
  for (const item of appcast.versions) await verifyVersion(item, appcast.identifier);
  process.stdout.write(`\nVerified ${appcast.versions.length} published release assets\n`);
}

if (require.main === module) {
  main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
module.exports = { checkedFetch, parseReleaseAssetUrl, readResponseBytes };
