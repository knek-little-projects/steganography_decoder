/**
 * LSB (Least Significant Bit) Steganography Library
 * 
 * Functions for encoding and decoding messages in image pixels using LSB steganography.
 */

/**
 * Encodes a message into image pixel data using LSB steganography.
 * 
 * @param {ImageData} imageData - The image data to encode into
 * @param {string} message - The message to encode
 * @param {Object} config - Encoding configuration
 * @param {number} config.bitsPerChannel - Number of LSB bits to use per channel (1-8)
 * @param {boolean} config.useR - Whether to use the red channel
 * @param {boolean} config.useG - Whether to use the green channel
 * @param {boolean} config.useB - Whether to use the blue channel
 * @param {string} config.pixelOrder - Pixel traversal order: 'row' or 'column'
 * @param {string} config.encoding - Text encoding: 'utf8' or 'ascii'
 * @returns {ImageData} New ImageData with encoded message
 * @throws {Error} If message is too long or encoding is invalid
 */
export function encodeLSB(imageData, message, config) {
  const { bitsPerChannel, useR, useG, useB, pixelOrder, encoding } = config;
  
  // Validate bitsPerChannel
  if (bitsPerChannel < 1 || bitsPerChannel > 8) {
    throw new Error('bitsPerChannel must be between 1 and 8');
  }
  
  // Validate at least one channel is selected
  if (!useR && !useG && !useB) {
    throw new Error('At least one channel (R, G, or B) must be selected');
  }
  
  // Convert message to bytes based on encoding
  let messageBytes;
  if (encoding === 'ascii') {
    // For ASCII, use only bytes 0-127
    messageBytes = new Uint8Array(message.length);
    for (let i = 0; i < message.length; i++) {
      const code = message.charCodeAt(i);
      if (code > 127) {
        throw new Error(`ASCII encoding only supports characters 0-127. Character '${message[i]}' (code ${code}) is not supported.`);
      }
      messageBytes[i] = code;
    }
  } else if (encoding === 'utf8') {
    // For UTF-8, use TextEncoder
    const encoder = new TextEncoder();
    messageBytes = encoder.encode(message);
  } else {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
  
  // Create bit stream (LSB first, matching decoder)
  const bits = [];
  for (const byte of messageBytes) {
    for (let i = 0; i < 8; i++) {
      bits.push((byte >> i) & 1);
    }
  }
  
  // Calculate capacity
  const channels = [useR, useG, useB].filter(Boolean).length;
  const totalBitsNeeded = bits.length;
  const bitsPerPixel = channels * bitsPerChannel;
  const pixelsNeeded = Math.ceil(totalBitsNeeded / bitsPerPixel);
  
  if (pixelsNeeded > imageData.width * imageData.height) {
    throw new Error(`Message is too long for this image. Need ${pixelsNeeded} pixels, but image has ${imageData.width * imageData.height} pixels.`);
  }

  const data = new Uint8ClampedArray(imageData.data);
  
  let bitIndex = 0;
  const mask = (1 << bitsPerChannel) - 1;
  const clearMask = ~mask;

  // Function to write bitsPerChannel bits into a channel
  function writeChannelBits(channelValue) {
    // Clear the lower bitsPerChannel bits
    let newValue = channelValue & clearMask;
    // Write bitsPerChannel bits starting from LSB
    // Important: write ALL bitsPerChannel bits, even if fewer bits remain in stream
    for (let i = 0; i < bitsPerChannel; i++) {
      if (bitIndex < bits.length) {
        newValue |= (bits[bitIndex] << i);
        bitIndex++;
      }
      // If bits are exhausted, remaining bits stay as zeros (already cleared by clearMask)
    }
    return newValue;
  }

  if (pixelOrder === 'row') {
    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        if (bitIndex >= bits.length) break;
        const idx = (y * imageData.width + x) * 4;
        
        if (useR) {
          data[idx] = writeChannelBits(data[idx]);
        }
        if (useG) {
          data[idx + 1] = writeChannelBits(data[idx + 1]);
        }
        if (useB) {
          data[idx + 2] = writeChannelBits(data[idx + 2]);
        }
      }
      if (bitIndex >= bits.length) break;
    }
  } else if (pixelOrder === 'column') {
    for (let x = 0; x < imageData.width; x++) {
      for (let y = 0; y < imageData.height; y++) {
        if (bitIndex >= bits.length) break;
        const idx = (y * imageData.width + x) * 4;
        
        if (useR) {
          data[idx] = writeChannelBits(data[idx]);
        }
        if (useG) {
          data[idx + 1] = writeChannelBits(data[idx + 1]);
        }
        if (useB) {
          data[idx + 2] = writeChannelBits(data[idx + 2]);
        }
      }
      if (bitIndex >= bits.length) break;
    }
  } else {
    throw new Error(`Unsupported pixelOrder: ${pixelOrder}`);
  }

  return new ImageData(data, imageData.width, imageData.height);
}

/**
 * Decodes a message from image pixel data using LSB steganography.
 * 
 * @param {ImageData} imageData - The image data to decode from
 * @param {Object} options - Decoding options
 * @param {number} options.bitsPerChannel - Number of LSB bits to extract per channel (1-8)
 * @param {boolean} options.useR - Whether to use the red channel
 * @param {boolean} options.useG - Whether to use the green channel
 * @param {boolean} options.useB - Whether to use the blue channel
 * @param {string} options.order - Pixel traversal order: 'row' or 'column'
 * @param {string} options.encoding - Text encoding: 'utf8' or 'ascii'
 * @returns {Object} Decoded result with text, hex, byteCount, and hasTail
 */
export function decodeLSB(imageData, options) {
  const { bitsPerChannel, useR, useG, useB, order, encoding } = options;

  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  const mask = (1 << bitsPerChannel) - 1;
  const bytes = [];
  let currentByte = 0;
  let bitPos = 0;

  function pushBit(bit) {
    currentByte |= (bit & 1) << bitPos;
    bitPos += 1;
    if (bitPos === 8) {
      bytes.push(currentByte);
      currentByte = 0;
      bitPos = 0;
    }
  }

  function extractChannelBits(value) {
    const channelBits = value & mask;
    for (let i = 0; i < bitsPerChannel; i += 1) {
      const bit = (channelBits >> i) & 1;
      pushBit(bit);
    }
  }

  if (order === 'column') {
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const idx = (y * width + x) * 4;
        if (useR) extractChannelBits(data[idx]);
        if (useG) extractChannelBits(data[idx + 1]);
        if (useB) extractChannelBits(data[idx + 2]);
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        if (useR) extractChannelBits(data[idx]);
        if (useG) extractChannelBits(data[idx + 1]);
        if (useB) extractChannelBits(data[idx + 2]);
      }
    }
  }

  const hasTail = bitPos !== 0;
  const text =
    encoding === 'ascii'
      ? bytesToAscii(bytes, hasTail)
      : bytesToUtf8String(bytes, hasTail);
  const hex = formatBytesAsHex(bytes);

  return {
    text,
    hex,
    byteCount: bytes.length,
    hasTail,
  };
}

/**
 * Helper function to format bytes as hexadecimal string.
 */
function formatBytesAsHex(bytes) {
  if (!bytes.length) return '';
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const line = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Helper function to check if a byte is printable ASCII.
 */
function isPrintableAscii(byte) {
  return byte >= 0x20 && byte <= 0x7e;
}

/**
 * Helper function to convert bytes to ASCII string.
 */
function bytesToAscii(bytes, hasTail) {
  let result = '';
  for (const b of bytes) {
    if (isPrintableAscii(b)) {
      result += String.fromCharCode(b);
    } else if (b === 0x0a || b === 0x0d || b === 0x09) {
      result += String.fromCharCode(b);
    } else {
      result += '.';
    }
  }
  if (hasTail) {
    result += '_';
  }
  return result;
}

/**
 * Helper function to check if a character is a control character.
 */
function isControlCharacter(ch) {
  if (!ch || ch.length === 0) return false;
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  if (code === 0x0a || code === 0x0d || code === 0x09) {
    return false;
  }
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
}

/**
 * Helper function to convert bytes to UTF-8 string.
 */
function bytesToUtf8String(bytes, hasTail) {
  if (!bytes.length) {
    return hasTail ? '_' : '';
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const decoded = decoder.decode(new Uint8Array(bytes));
  let result = '';
  for (const ch of decoded) {
    if (ch === '\ufffd') {
      result += '_';
    } else if (isControlCharacter(ch)) {
      result += '.';
    } else {
      result += ch;
    }
  }
  if (hasTail) {
    result += '_';
  }
  return result;
}

