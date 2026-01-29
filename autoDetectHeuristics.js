// Cut input to the first NON-printable byte (ASCII/UTF-8 bytes level),
// then return a text-likeness score in [0, 1].
// "Printable" here: bytes 0x20..0x7E plus \t \n \r.
// Assumption: data is ASCII or UTF-8, and anything outside this set is a hard boundary.

const OK_CTRL = new Set([9, 10, 13]); // \t \n \r

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") return new TextEncoder().encode(input);
  throw new TypeError("Input must be string, Uint8Array, or ArrayBuffer");
}

function isPrintableByte(b) {
  return (b >= 0x20 && b <= 0x7e) || OK_CTRL.has(b);
}

function cutAtFirstNonPrintable(bytes) {
  let i = 0;
  for (; i < bytes.length; i++) {
    if (!isPrintableByte(bytes[i])) break;
  }
  return i === bytes.length ? bytes : bytes.subarray(0, i);
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
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

/**
 * score in [0,1], higher = more likely valid text.
 *
 * NOTE: because we cut at first non-printable byte, this scorer is mainly for
 * "does the prefix look like text?" and will intentionally ignore anything after
 * the first binary/control byte.
 */
export async function textScore(input, opts = {}) {
  const {
    useCompression = true,
    compressionFormat = "gzip",
    shortLen = 24,
  } = opts;

  let bytes = toBytes(input);
  const origSize = bytes.length;
  bytes = cutAtFirstNonPrintable(bytes);
  const n = bytes.length;

  if (n === 0) {
    return {
      score: 0,
      metrics: { origSize, size: 0, cut: true, reason: "starts_with_non_printable" },
    };
  }

  // Since we already cut at the first non-printable, badCtrlRatio is 0 by construction,
  // but keep metrics anyway.
  const entropy = shannonEntropyBytes(bytes);
  const uniqBi = uniqueBigramRatio(bytes);
  const compR = useCompression
    ? await compressRatio(bytes, compressionFormat).catch(() => null)
    : null;

  // quick character-class metrics on the decoded prefix
  const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const len = s.length || 1;

  let letters = 0, digits = 0, spaces = 0, punct = 0;
  const reLetter = /\p{L}/u;
  const reDigit = /\p{N}/u;
  const reSpace = /\s/u;
  const rePunctSym = /[\p{P}\p{S}]/u;

  for (const ch of s) {
    if (reLetter.test(ch)) letters++;
    else if (reDigit.test(ch)) digits++;
    else if (reSpace.test(ch)) spaces++;
    else if (rePunctSym.test(ch)) punct++;
  }

  const letterRatio = letters / len;
  const spaceRatio = spaces / len;
  const punctRatio = punct / len;

  // Short strings: mostly letters -> high score
  if (len < shortLen) {
    const score =
      clamp01(letterRatio / 0.7) *
      (0.5 + 0.5 * clamp01(spaceRatio / 0.08)) *
      (1 - clamp01(punctRatio / 0.6));
    return {
      score: clamp01(score),
      metrics: { origSize, size: n, cut: n !== origSize, mode: "short", entropy, uniqBigramRatio: uniqBi, compressRatio: compR, letterRatio, spaceRatio, punctRatio },
    };
  }

  // Map to 0..1 (higher = more text-like)
  const entScore = clamp01((7.4 - entropy) / (7.4 - 5.4));          // <=5.4 good, >=7.4 bad
  const biScore  = clamp01((0.92 - uniqBi) / (0.92 - 0.55));        // <=0.55 good, >=0.92 bad
  const compScore = compR == null ? 0.5 : clamp01((0.95 - compR) / (0.95 - 0.55));

  // Content gates: require some letters; penalize punctuation-heavy prefixes
  const letterGate = clamp01((letterRatio - 0.08) / 0.22);
  const punctGate  = 1 - clamp01((punctRatio - 0.40) / 0.25);
  const spaceGate  = 0.5 + 0.5 * clamp01((spaceRatio - 0.005) / 0.04);

  const raw = 1.6 * compScore + 1.4 * entScore + 0.8 * biScore;
  let score = sigmoid((raw - 2.0) / 0.8);

  score *= (0.15 + 0.85 * letterGate);
  score *= (0.30 + 0.70 * punctGate);
  score *= spaceGate;

  return {
    score: clamp01(score),
    metrics: {
      origSize,
      size: n,
      cut: n !== origSize,
      mode: "long",
      entropy,
      uniqBigramRatio: uniqBi,
      compressRatio: compR,
      letterRatio,
      spaceRatio,
      punctRatio,
      components: { compScore, entScore, biScore, letterGate, punctGate, spaceGate },
      raw,
    },
  };
}
