/**
 * JPEG-Resilient Steganography Library
 *
 * Embeds data in DCT-domain luminance coefficients using Quantization Index
 * Modulation (QIM). Data survives JPEG compression because it modifies the
 * same frequency-domain coefficients that JPEG preserves.
 *
 * Algorithm:
 *  1. Image is divided into 8×8 pixel blocks (same as JPEG)
 *  2. Each block's luminance (Y) channel is transformed via 2-D DCT-II
 *  3. A selected mid-frequency DCT coefficient is modified to encode one bit
 *     using QIM — the coefficient is quantized to even/odd multiples of a step
 *  4. Inverse DCT maps modified coefficients back to pixel values
 *  5. On decode, the same DCT + QIM extraction recovers the bits
 *
 * Message format stored in the bit stream:
 *   [magic: 16 bits, 0x5354 "ST"] [length: 16 bits, LE] [data: length×8 bits]
 *
 * Capacity: floor(W/8) × floor(H/8) blocks, 1 bit per block.
 *           Usable payload = (total_blocks − 32) / 8  bytes.
 */

const BLOCK = 8;

// Mid-frequency DCT position — low JPEG quantization step, good robustness.
// Standard JPEG luminance quantization matrix value at (2,1) is 13 (quality 50).
const DEFAULT_EMBED_U = 2;
const DEFAULT_EMBED_V = 1;

// Magic marker to validate that a decode found real stego data.
const MAGIC = 0x5354; // "ST" in little-endian ASCII

// Header: 16-bit magic + 16-bit length = 32 bits
const HEADER_BITS = 32;

/* ------------------------------------------------------------------ */
/*  Precomputed tables                                                 */
/* ------------------------------------------------------------------ */

const COS = Array.from({ length: BLOCK }, () => new Float64Array(BLOCK));
for (let k = 0; k < BLOCK; k++) {
  for (let n = 0; n < BLOCK; n++) {
    COS[k][n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * BLOCK));
  }
}

const C = new Float64Array(BLOCK);
C[0] = 1 / Math.SQRT2;
for (let i = 1; i < BLOCK; i++) C[i] = 1;

/* ------------------------------------------------------------------ */
/*  DCT / IDCT (8×8, type-II, orthonormal)                            */
/* ------------------------------------------------------------------ */

function dct8(block) {
  const out = Array.from({ length: BLOCK }, () => new Float64Array(BLOCK));
  for (let u = 0; u < BLOCK; u++) {
    for (let v = 0; v < BLOCK; v++) {
      let sum = 0;
      for (let r = 0; r < BLOCK; r++) {
        for (let c = 0; c < BLOCK; c++) {
          sum += block[r][c] * COS[u][r] * COS[v][c];
        }
      }
      out[u][v] = 0.25 * C[u] * C[v] * sum;
    }
  }
  return out;
}

function idct8(coeffs) {
  const out = Array.from({ length: BLOCK }, () => new Float64Array(BLOCK));
  for (let r = 0; r < BLOCK; r++) {
    for (let c = 0; c < BLOCK; c++) {
      let sum = 0;
      for (let u = 0; u < BLOCK; u++) {
        for (let v = 0; v < BLOCK; v++) {
          sum += C[u] * C[v] * coeffs[u][v] * COS[u][r] * COS[v][c];
        }
      }
      out[r][c] = 0.25 * sum;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** RGB → luminance (BT.601) */
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** QIM embed – set coefficient so that round(coeff/step) has desired parity */
function qimEmbed(coeff, bit, step) {
  let q = Math.round(coeff / step);
  const parity = ((q % 2) + 2) % 2; // works for negatives
  if (parity === bit) return q * step;

  const dUp = Math.abs(coeff - (q + 1) * step);
  const dDn = Math.abs(coeff - (q - 1) * step);
  return dUp <= dDn ? (q + 1) * step : (q - 1) * step;
}

/** QIM extract – parity of round(coeff/step) */
function qimExtract(coeff, step) {
  const q = Math.round(coeff / step);
  return ((q % 2) + 2) % 2;
}

/**
 * Extract an 8×8 luminance block (level-shifted by −128) from pixel data.
 * bx, by — block column / row indices.
 */
function extractYBlock(data, width, bx, by) {
  const blk = Array.from({ length: BLOCK }, () => new Float64Array(BLOCK));
  for (let r = 0; r < BLOCK; r++) {
    for (let c = 0; c < BLOCK; c++) {
      const idx = ((by * BLOCK + r) * width + bx * BLOCK + c) * 4;
      blk[r][c] = luma(data[idx], data[idx + 1], data[idx + 2]) - 128;
    }
  }
  return blk;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Encode a UTF-8 message into image pixel data using DCT-domain QIM.
 *
 * @param {ImageData} imageData  Source image (will not be mutated)
 * @param {string}    message    Message to embed
 * @param {Object}    [options]
 * @param {number}    [options.step=50]   QIM quantisation step (larger → more
 *                                        robust but more visible)
 * @returns {ImageData} New ImageData with the message embedded
 */
export function jpegEncode(imageData, message, options = {}) {
  const {
    step = 50,
    embedU = DEFAULT_EMBED_U,
    embedV = DEFAULT_EMBED_V,
  } = options;

  const { width, height } = imageData;
  const bx_count = Math.floor(width / BLOCK);
  const by_count = Math.floor(height / BLOCK);
  const totalBlocks = bx_count * by_count;

  /* ---------- build bit stream ---------- */

  const msgBytes = new TextEncoder().encode(message);
  if (msgBytes.length > 0xFFFF) {
    throw new Error(`Message too long: ${msgBytes.length} bytes (max 65 535)`);
  }

  const bits = [];

  // 16-bit magic (little-endian)
  for (let i = 0; i < 8; i++) bits.push((MAGIC & 0xFF) >> i & 1);
  for (let i = 0; i < 8; i++) bits.push(((MAGIC >> 8) & 0xFF) >> i & 1);

  // 16-bit length (little-endian)
  for (let i = 0; i < 8; i++) bits.push((msgBytes.length & 0xFF) >> i & 1);
  for (let i = 0; i < 8; i++) bits.push(((msgBytes.length >> 8) & 0xFF) >> i & 1);

  // payload
  for (const byte of msgBytes) {
    for (let i = 0; i < 8; i++) bits.push((byte >> i) & 1);
  }

  if (bits.length > totalBlocks) {
    throw new Error(
      `Message too long for this image. Need ${bits.length} blocks but only ` +
      `${totalBlocks} available (${bx_count}×${by_count}).`
    );
  }

  /* ---------- embed ---------- */

  const data = new Uint8ClampedArray(imageData.data);
  let bi = 0; // bit index

  for (let by = 0; by < by_count && bi < bits.length; by++) {
    for (let bx = 0; bx < bx_count && bi < bits.length; bx++) {
      const yBlk = extractYBlock(data, width, bx, by);
      const dctBlk = dct8(yBlk);

      dctBlk[embedU][embedV] = qimEmbed(dctBlk[embedU][embedV], bits[bi++], step);

      const newY = idct8(dctBlk);

      // Apply luminance delta back to RGB
      for (let r = 0; r < BLOCK; r++) {
        for (let c = 0; c < BLOCK; c++) {
          const delta = newY[r][c] - yBlk[r][c];
          const idx = ((by * BLOCK + r) * width + bx * BLOCK + c) * 4;
          data[idx]     = Math.round(Math.min(255, Math.max(0, data[idx]     + delta)));
          data[idx + 1] = Math.round(Math.min(255, Math.max(0, data[idx + 1] + delta)));
          data[idx + 2] = Math.round(Math.min(255, Math.max(0, data[idx + 2] + delta)));
        }
      }
    }
  }

  return new ImageData(data, width, height);
}

/**
 * Decode a message previously embedded with {@link jpegEncode}.
 *
 * @param {ImageData} imageData  Image to decode (may have been JPEG-compressed)
 * @param {Object}    [options]
 * @param {number}    [options.step=50]   Must match the step used during encoding
 * @returns {{ message: string, valid: boolean }}
 */
export function jpegDecode(imageData, options = {}) {
  const {
    step = 50,
    embedU = DEFAULT_EMBED_U,
    embedV = DEFAULT_EMBED_V,
  } = options;

  const { width, height } = imageData;
  const data = imageData.data;
  const bx_count = Math.floor(width / BLOCK);
  const by_count = Math.floor(height / BLOCK);

  /* ---------- extract bits from all blocks ---------- */

  const bits = [];
  for (let by = 0; by < by_count; by++) {
    for (let bx = 0; bx < bx_count; bx++) {
      const yBlk = extractYBlock(data, width, bx, by);
      const dctBlk = dct8(yBlk);
      bits.push(qimExtract(dctBlk[embedU][embedV], step));
    }
  }

  if (bits.length < HEADER_BITS) {
    return { message: '', valid: false };
  }

  /* ---------- parse header ---------- */

  function readU16(off) {
    let lo = 0, hi = 0;
    for (let i = 0; i < 8; i++) lo |= bits[off + i] << i;
    for (let i = 0; i < 8; i++) hi |= bits[off + 8 + i] << i;
    return (hi << 8) | lo;
  }

  const magic  = readU16(0);
  const length = readU16(16);

  if (magic !== MAGIC) {
    return { message: '', valid: false };
  }
  if (length * 8 + HEADER_BITS > bits.length) {
    return { message: '', valid: false };
  }

  /* ---------- read payload ---------- */

  const msgBytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b |= bits[HEADER_BITS + i * 8 + j] << j;
    }
    msgBytes[i] = b;
  }

  const message = new TextDecoder().decode(msgBytes);
  return { message, valid: true };
}

