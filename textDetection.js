// Heuristics: "text vs noise" for Chrome extensions.
// Works on bytes (Uint8Array). Includes: control-bytes ratio, whitespace ratio,
// byte entropy, unique bigram ratio, and (optionally) compress ratio via CompressionStream.

const OK_CTRL = new Set([9, 10, 13]); // \t \n \r

function shannonEntropyBytes(bytes) {
  const n = bytes.length;
  if (!n) return 0;

  // 256-bin histogram
  const counts = new Uint32Array(256);
  for (let i = 0; i < n; i++) counts[bytes[i]]++;

  let ent = 0;
  for (let i = 0; i < 256; i++) {
    const c = counts[i];
    if (!c) continue;
    const p = c / n;
    ent -= p * Math.log2(p);
  }
  return ent; // bits/byte, max 8
}

function uniqueBigramRatio(bytes) {
  const n = bytes.length;
  if (n < 2) return 1;

  const total = n - 1;
  // pack two bytes into 16-bit key
  const seen = new Set();
  for (let i = 0; i < total; i++) {
    const key = (bytes[i] << 8) | bytes[i + 1];
    seen.add(key);
  }
  return seen.size / total;
}

async function compressRatio(bytes, format = "gzip") {
  // Requires modern Chromium: CompressionStream('gzip' | 'deflate')
  if (typeof CompressionStream === "undefined") return null;

  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  // Read all compressed chunks and sum their sizes
  const reader = cs.readable.getReader();
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  return total / bytes.length;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") return new TextEncoder().encode(input);
  throw new TypeError("Input must be string, Uint8Array, or ArrayBuffer");
}

export async function isProbablyText(input, opts = {}) {
  const {
    minSize = 1,
    noWhitespaceMinLen = 200,
    maxBadCtrlRatio = 0.02,
    hiEntropy = 7.3,
    hiEntropy2 = 7.0,
    hiUniqBigramRatio = 0.9,
    hiUniqMinLen = 500,
    maxCompressRatioWhenHiEntropy = 0.95,
    useCompression = true,      // set false if you don't want async compression
    compressionFormat = "gzip", // "gzip" or "deflate"
  } = opts;

  const bytes = toBytes(input);
  const n = bytes.length;

  const metrics = {
    size: n,
    printableRatio: 0,
    badCtrlRatio: 0,
    spaceRatio: 0,
    newlineRatio: 0,
    nonAsciiRatio: 0,
    entropy: 0,
    uniqBigramRatio: 1,
    compressRatio: null,
    isText: false,
    reason: "",
  };

  if (n < minSize) {
    metrics.reason = "too_small_or_empty";
    return metrics;
  }

  let badCtrl = 0;
  let printable = 0;
  let spaces = 0;
  let newlines = 0;
  let nonAscii = 0;

  for (let i = 0; i < n; i++) {
    const x = bytes[i];

    if (x >= 128) nonAscii++;

    if (x === 32 || x === 9) spaces++; // space or tab
    if (x === 10) newlines++;          // \n

    if (x < 32 && !OK_CTRL.has(x)) badCtrl++;
    else printable++;
  }

  metrics.badCtrlRatio = badCtrl / n;
  metrics.printableRatio = printable / n;
  metrics.spaceRatio = spaces / n;
  metrics.newlineRatio = newlines / n;
  metrics.nonAsciiRatio = nonAscii / n;

  // hard cut: too many control bytes => almost certainly noise/binary
  if (metrics.badCtrlRatio > maxBadCtrlRatio) {
    metrics.isText = false;
    metrics.reason = "too_many_control_bytes";
    return metrics;
  }

  metrics.entropy = shannonEntropyBytes(bytes);
  metrics.uniqBigramRatio = uniqueBigramRatio(bytes);

  if (useCompression) {
    try {
      metrics.compressRatio = await compressRatio(bytes, compressionFormat);
    } catch {
      metrics.compressRatio = null;
    }
  }

  // high entropy + uncompressible => likely noise
  if (
    metrics.entropy > hiEntropy &&
    metrics.compressRatio != null &&
    metrics.compressRatio > maxCompressRatioWhenHiEntropy
  ) {
    metrics.isText = false;
    metrics.reason = "high_entropy_and_uncompressible";
    return metrics;
  }

  // long text with no whitespace is suspicious (base64/hex/minified noise)
  if (
    n > noWhitespaceMinLen &&
    metrics.spaceRatio < 0.01 &&
    metrics.newlineRatio < 0.002
  ) {
    // if it still compresses well, allow (e.g. minified JSON may compress)
    if (metrics.compressRatio != null && metrics.compressRatio < 0.85) {
      metrics.isText = true;
      metrics.reason = "no_whitespace_but_compressible";
      return metrics;
    }
    metrics.isText = false;
    metrics.reason = "no_whitespace";
    return metrics;
  }

  // too many unique bigrams + high entropy => noise
  if (n > hiUniqMinLen && metrics.uniqBigramRatio > hiUniqBigramRatio && metrics.entropy > hiEntropy2) {
    metrics.isText = false;
    metrics.reason = "too_many_unique_bigrams";
    return metrics;
  }

  metrics.isText = true;
  metrics.reason = "passed_heuristics";
  return metrics;
}

