#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"

command -v "${NODE_BIN}" >/dev/null 2>&1 || {
  echo "error: Node.js is required" >&2
  exit 1
}
command -v zip >/dev/null 2>&1 || {
  echo "error: zip is required" >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "error: unzip is required" >&2
  exit 1
}

VERSION="$("${NODE_BIN}" -e 'const i=require(process.argv[1]); process.stdout.write(String(i.version || ""))' "${REPO_ROOT}/info.json")"
PACKAGE_VERSION="$("${NODE_BIN}" -e 'const p=require(process.argv[1]); process.stdout.write(String(p.version || ""))' "${REPO_ROOT}/package.json")"

if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "error: info.json contains an invalid version: ${VERSION}" >&2
  exit 1
fi
if [[ "${PACKAGE_VERSION}" != "${VERSION}" ]]; then
  echo "error: package.json version ${PACKAGE_VERSION} does not match info.json version ${VERSION}" >&2
  exit 1
fi

OUTPUT_DIR="${REPO_ROOT}/dist"
OUTPUT_FILE="${OUTPUT_DIR}/openai-tts-${VERSION}.bobplugin"
BUILD_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bob-plugin-openai-tts.XXXXXX")"

cleanup() {
  if [[ -n "${BUILD_TMP_DIR:-}" && -d "${BUILD_TMP_DIR}" ]]; then
    rm -rf -- "${BUILD_TMP_DIR}"
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_FILE}"
cp "${REPO_ROOT}/info.json" "${BUILD_TMP_DIR}/info.json"
cp "${REPO_ROOT}/main.js" "${BUILD_TMP_DIR}/main.js"
cp "${REPO_ROOT}/LICENSE" "${BUILD_TMP_DIR}/LICENSE"
chmod 0644 "${BUILD_TMP_DIR}/info.json" "${BUILD_TMP_DIR}/main.js" "${BUILD_TMP_DIR}/LICENSE"
export LC_ALL=C
export TZ=UTC
touch -t 200001010000.00 "${BUILD_TMP_DIR}/info.json" "${BUILD_TMP_DIR}/main.js" "${BUILD_TMP_DIR}/LICENSE"

(
  cd "${BUILD_TMP_DIR}"
  zip -q -X "${OUTPUT_FILE}" LICENSE info.json main.js
)

ARCHIVE_FILES="$(unzip -Z1 "${OUTPUT_FILE}" | LC_ALL=C sort)"
EXPECTED_FILES=$'LICENSE\ninfo.json\nmain.js'
if [[ "${ARCHIVE_FILES}" != "${EXPECTED_FILES}" ]]; then
  echo "error: package must contain only LICENSE, info.json, and main.js" >&2
  unzip -Z1 "${OUTPUT_FILE}" >&2
  exit 1
fi

ARCHIVE_VERSION="$(unzip -p "${OUTPUT_FILE}" info.json | "${NODE_BIN}" -e 'let s=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => s += c); process.stdin.on("end", () => process.stdout.write(String(JSON.parse(s).version || "")));')"
if [[ "${ARCHIVE_VERSION}" != "${VERSION}" ]]; then
  echo "error: packaged version ${ARCHIVE_VERSION} does not match source version ${VERSION}" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  CHECKSUM="$(shasum -a 256 "${OUTPUT_FILE}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM="$(sha256sum "${OUTPUT_FILE}" | awk '{print $1}')"
else
  echo "error: shasum or sha256sum is required" >&2
  exit 1
fi

echo "Built ${OUTPUT_FILE}"
echo "SHA-256 ${CHECKSUM}"
