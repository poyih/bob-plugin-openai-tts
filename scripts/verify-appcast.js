'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APPCAST_PATH = path.join(REPO_ROOT, 'appcast.json');
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_INFO_BYTES = 256 * 1024;
const EXPECTED_REPOSITORY = 'poyih/bob-plugin-openai-tts';
const USER_AGENT = 'bob-plugin-openai-tts-appcast-verifier';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseReleaseAssetUrl(value) {
  const url = new URL(value);
  invariant(url.protocol === 'https:' && url.hostname === 'github.com', `unsupported release URL: ${value}`);
  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/v([^/]+)\/([^/]+)$/.exec(url.pathname);
  invariant(match, `invalid GitHub release asset URL: ${value}`);
  return {
    owner: decodeURIComponent(match[1]),
    repository: decodeURIComponent(match[2]),
    version: decodeURIComponent(match[3]),
    assetName: decodeURIComponent(match[4])
  };
}

async function checkedFetch(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`${url} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response;
}

function readPackagedInfo(bytes, version) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-plugin-appcast-'));
  const archivePath = path.join(tempDirectory, `openai-tts-${version}.bobplugin`);
  try {
    fs.writeFileSync(archivePath, bytes, { flag: 'wx', mode: 0o600 });
    const rawInfo = childProcess.execFileSync('unzip', ['-p', archivePath, 'info.json'], {
      encoding: 'utf8',
      maxBuffer: MAX_INFO_BYTES,
      timeout: 10_000,
      windowsHide: true
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
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/releases/tags/v${encodeURIComponent(item.version)}`;
  const releaseResponse = await checkedFetch(apiUrl, { headers });
  const release = await releaseResponse.json();
  invariant(release.draft === false && release.prerelease === false, `${item.version}: appcast must reference a published stable release`);
  invariant(Date.parse(release.published_at) === item.timestamp, `${item.version}: publishedAt does not match appcast timestamp`);

  const asset = Array.isArray(release.assets)
    ? release.assets.find(candidate => candidate.name === target.assetName)
    : null;
  invariant(asset, `${item.version}: release asset not found`);
  invariant(asset.state === 'uploaded', `${item.version}: release asset is not fully uploaded`);
  invariant(asset.browser_download_url === item.url, `${item.version}: release asset URL does not match appcast`);
  invariant(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_ASSET_BYTES, `${item.version}: release asset size is invalid`);

  const assetResponse = await checkedFetch(item.url, { headers: { 'User-Agent': USER_AGENT } });
  const contentLength = assetResponse.headers.get('content-length');
  const declaredLength = contentLength === null ? Number.NaN : Number(contentLength);
  invariant(!Number.isFinite(declaredLength) || declaredLength === asset.size, `${item.version}: downloaded size does not match GitHub metadata`);
  const bytes = Buffer.from(await assetResponse.arrayBuffer());
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
  for (const item of appcast.versions) {
    await verifyVersion(item, appcast.identifier);
  }
  process.stdout.write(`\nVerified ${appcast.versions.length} published release assets\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
