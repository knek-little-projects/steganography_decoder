// Returns a numeric score: higher = more likely "valid text", lower = more likely noise.
// Input: string | Uint8Array | ArrayBuffer
// Uses fast heuristics + (optionally) CompressionStream for compressibility.

const OK_CTRL = new Set([9, 10, 13]); // \t \n \r

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") return new TextEncoder().encode(input);
  throw new TypeError("Input must be string, Uint8Array, or ArrayBuffer");
}

function shannonEntropyBytes(bytes) {
  const n = bytes.length;
  if (!n) return 0;

  const counts = new Uint32Array(256);
  for (let i = 0; i < n; i++) counts[bytes[i]]++;

  let ent = 0;
  for (let i = 0; i < 256; i++) {
    const c = counts[i];
    if (!c) continue;
    const p = c / n;
    ent -= p * Math.log2(p);
  }
  return ent; // 0..8 bits/byte
}

function uniqueBigramRatio(bytes) {
  const n = bytes.length;
  if (n < 2) return 1;

  const total = n - 1;
  const seen = new Set();
  for (let i = 0; i < total; i++) {
    const key = (bytes[i] << 8) | bytes[i + 1];
    seen.add(key);
  }
  return seen.size / total;
}

async function compressRatio(bytes, format = "gzip") {
  if (typeof CompressionStream === "undefined") return null;

  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const reader = cs.readable.getReader();
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  return total / bytes.length;
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * textScore(input) -> { score, metrics }
 *
 * score in [0, 1]: higher = more text-like.
 * metrics: raw features you can log to tune thresholds.
 */
export async function textScore(input, opts = {}) {
  const {
    useCompression = true,
    compressionFormat = "gzip", // "gzip" or "deflate"
    // Calibration knobs (tune on your data)
    minLen = 32,
  } = opts;

  const bytes = toBytes(input);
  const n = bytes.length;

  // Very short: not enough signal, give a conservative score
  if (n < minLen) {
    return {
      score: n === 0 ? 0 : 0.3,
      metrics: { size: n, reason: "too_short" },
    };
  }

  let badCtrl = 0;
  let printable = 0;
  let spaces = 0;
  let newlines = 0;

  for (let i = 0; i < n; i++) {
    const x = bytes[i];
    if (x === 32 || x === 9) spaces++;
    if (x === 10) newlines++;

    if (x < 32 && !OK_CTRL.has(x)) badCtrl++;
    else printable++;
  }

  const badCtrlRatio = badCtrl / n;
  const printableRatio = printable / n;
  const spaceRatio = spaces / n;
  const newlineRatio = newlines / n;

  const entropy = shannonEntropyBytes(bytes);      // 0..8
  const uniqBi = uniqueBigramRatio(bytes);         // 0..1

  let compR = null;
  if (useCompression) {
    try {
      compR = await compressRatio(bytes, compressionFormat); // ~0.2..1.2
    } catch {
      compR = null;
    }
  }

  // ---- Turn raw metrics into 0..1 sub-scores (higher = better) ----

  // Control bytes: 0% is best, >2% is very suspicious
  const ctrlScore = clamp01(1 - badCtrlRatio / 0.02);

  // Entropy: typical natural text often ~4-6 bits/byte; near 8 is noise.
  // Map: <=5.2 => ~1, >=7.6 => ~0
  const entScore = clamp01((7.6 - entropy) / (7.6 - 5.2));

  // Unique bigrams: noise tends to be very high (close to 1) for long data.
  // Map: <=0.55 => ~1, >=0.92 => ~0
  const biScore = clamp01((0.92 - uniqBi) / (0.92 - 0.55));

  // Whitespace: many real texts have some; but allow minified text.
  // Map: >=3% whitespace => ~1, <=0.5% => ~0.2
  const ws = spaceRatio + newlineRatio;
  const wsScore = clamp01((ws - 0.005) / (0.03 - 0.005));
  const wsScoreSoft = 0.2 + 0.8 * wsScore; // never fully kills

  // Compression: lower ratio => more structured => more text-like.
  // Map: <=0.55 => ~1, >=0.95 => ~0
  const compScore =
    compR == null ? 0.5 : clamp01((0.95 - compR) / (0.95 - 0.55));

  // ---- Combine (weights tuned to favor robust features) ----
  // Strongest: ctrlScore, compScore, entScore
  // Support: biScore, wsScoreSoft
  const raw =
    2.2 * ctrlScore +
    1.8 * compScore +
    1.6 * entScore +
    0.9 * biScore +
    0.6 * wsScoreSoft;

  // Convert to [0,1]
  // Center around ~3.5, scale ~1.2 (tweak if needed)
  const score = sigmoid((raw - 3.5) / 1.2);

  return {
    score,
    metrics: {
      size: n,
      badCtrlRatio,
      printableRatio,
      spaceRatio,
      newlineRatio,
      entropy,
      uniqBigramRatio: uniqBi,
      compressRatio: compR,
      components: { ctrlScore, compScore, entScore, biScore, wsScoreSoft },
      raw,
    },
  };
}
