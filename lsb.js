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
  const { bitsPerChannel, useR, useG, useB, pixelOrder, encoding, fillWithZeros = false } = config;
  
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
  const messageBitsCount = bits.length; // Save original message bits count
  const bitsPerPixel = channels * bitsPerChannel;
  const totalCapacity = imageData.width * imageData.height * bitsPerPixel;
  
  if (messageBitsCount > totalCapacity) {
    throw new Error(`Message is too long for this image. Need ${messageBitsCount} bits, but image has capacity of ${totalCapacity} bits.`);
  }
  
  // If fillWithZeros is enabled, fill remaining capacity with zeros
  if (fillWithZeros) {
    const remainingBits = totalCapacity - messageBitsCount;
    for (let i = 0; i < remainingBits; i++) {
      bits.push(0);
    }
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
        
        // If fillWithZeros is false, stop when message bits are exhausted
        if (!fillWithZeros && bitIndex >= messageBitsCount) break;
      }
      if (!fillWithZeros && bitIndex >= messageBitsCount) break;
    }
  } else if (pixelOrder === 'column') {
    for (let x = 0; x < imageData.width; x++) {
      for (let y = 0; y < imageData.height; y++) {
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
        
        // If fillWithZeros is false, stop when message bits are exhausted
        if (!fillWithZeros && bitIndex >= messageBitsCount) break;
      }
      if (!fillWithZeros && bitIndex >= messageBitsCount) break;
    }
  } else {
    throw new Error(`Unsupported pixelOrder: ${pixelOrder}`);
  }

  return new ImageData(data, imageData.width, imageData.height);
}

/**
 * Decodes a message from image pixel data using LSB steganography.
 * Returns raw bytes without any text formatting.
 * 
 * @param {ImageData} imageData - The image data to decode from
 * @param {Object} options - Decoding options
 * @param {number} options.bitsPerChannel - Number of LSB bits to extract per channel (1-8)
 * @param {boolean} options.useR - Whether to use the red channel
 * @param {boolean} options.useG - Whether to use the green channel
 * @param {boolean} options.useB - Whether to use the blue channel
 * @param {string} options.order - Pixel traversal order: 'row' or 'column'
 * @returns {Object} Decoded result with bytes (Uint8Array), byteCount, hasTail, and tailBits
 */
export function decodeLSB(imageData, options) {
  const { bitsPerChannel, useR, useG, useB, order } = options;

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
  
  // Store tail bits if there's a tail
  let tailBits = 0;
  if (hasTail) {
    tailBits = currentByte;
  }

  return {
    bytes: new Uint8Array(bytes),
    byteCount: bytes.length,
    hasTail,
    tailBits, // Bits in the incomplete last byte (0-7 bits)
  };
}

/**
 * Formats bytes as hexadecimal string for display.
 * 
 * @param {Uint8Array|Array} bytes - Bytes to format
 * @returns {string} Hexadecimal string representation
 */
export function formatBytesAsHex(bytes) {
  if (!bytes || bytes.length === 0) return '';
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = Array.from(bytes.slice(i, i + 16));
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
 * Converts bytes to ASCII string for display, replacing non-printable characters.
 * Non-printable bytes are replaced with '.' and a tail indicator is added as '_' if hasTail is true.
 * Zero bytes (0x00) are displayed as empty string.
 * 
 * @param {Uint8Array|Array} bytes - Bytes to convert
 * @param {boolean} hasTail - Whether there are incomplete bits at the end
 * @param {number} tailBits - Bits in the incomplete last byte (0-7), if hasTail is true
 * @returns {string} Formatted ASCII string with replacements
 */
export function formatBytesAsAscii(bytes, hasTail = false, tailBits = 0) {
  if (!bytes || bytes.length === 0) {
    // If hasTail and tailBits is 0, don't show '_'
    return (hasTail && tailBits !== 0) ? '_' : '';
  }
  let result = '';
  for (const b of bytes) {
    if (b === 0x00) {
      // Zero bytes are displayed as empty string
      result += '';
    } else if (isPrintableAscii(b)) {
      result += String.fromCharCode(b);
    } else if (b === 0x0a || b === 0x0d || b === 0x09) {
      result += String.fromCharCode(b);
    } else {
      result += '.';
    }
  }
  
  // Check if tail is all zeros - if so, don't show '_'
  if (hasTail && tailBits !== 0) {
    result += '_';
  }
  return result;
}

/**
 * Converts bytes to UTF-8 string for display, replacing non-printable characters.
 * Invalid UTF-8 sequences are replaced with '_' and control characters with '.'.
 * Zero bytes (0x00) are displayed as empty string.
 * A tail indicator is added as '_' if hasTail is true and tail is not all zeros.
 * 
 * @param {Uint8Array|Array} bytes - Bytes to convert
 * @param {boolean} hasTail - Whether there are incomplete bits at the end
 * @param {number} tailBits - Bits in the incomplete last byte (0-7), if hasTail is true
 * @returns {string} Formatted UTF-8 string with replacements
 */
export function formatBytesAsUtf8(bytes, hasTail = false, tailBits = 0) {
  if (!bytes || bytes.length === 0) {
    // If hasTail and tailBits is 0, don't show '_'
    return (hasTail && tailBits !== 0) ? '_' : '';
  }
  
  // Process bytes, replacing zero bytes with empty strings
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let result = '';
  let i = 0;
  
  while (i < bytes.length) {
    if (bytes[i] === 0x00) {
      // Zero bytes are displayed as empty string
      result += '';
      i++;
    } else {
      // Try to decode UTF-8 sequence starting from this byte
      // Find the end of potential UTF-8 sequence (or next zero byte)
      let seqEnd = i + 1;
      while (seqEnd < bytes.length && bytes[seqEnd] !== 0x00) {
        // Check if this could be a continuation byte
        if ((bytes[seqEnd] & 0xC0) === 0x80) {
          seqEnd++;
        } else {
          // Start of new sequence
          break;
        }
      }
      
      // Decode the sequence
      const sequence = bytes.slice(i, seqEnd);
      const decoded = decoder.decode(new Uint8Array(sequence));
      
      for (const ch of decoded) {
        if (ch === '\ufffd') {
          result += '_';
        } else if (isControlCharacter(ch)) {
          result += '.';
        } else {
          result += ch;
        }
      }
      
      i = seqEnd;
    }
  }
  
  // Check if tail is all zeros - if so, don't show '_'
  if (hasTail && tailBits !== 0) {
    result += '_';
  }
  return result;
}

/**
 * Calculates Shannon entropy of a string.
 * Entropy measures the average information content per symbol.
 * Higher entropy indicates more randomness/diversity in the data.
 * 
 * @param {string} str - The string to calculate entropy for
 * @returns {number} Entropy value in bits (0 to log2(alphabet_size))
 */
export function calculateEntropy(str) {
  if (!str || str.length === 0) {
    return 0;
  }
  
  // Count frequency of each character
  const freq = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  
  // Calculate entropy: H(X) = -Σ p(x) * log2(p(x))
  let entropy = 0;
  const len = str.length;
  
  for (const char in freq) {
    const probability = freq[char] / len;
    if (probability > 0) {
      entropy -= probability * Math.log2(probability);
    }
  }
  
  return entropy;
}

