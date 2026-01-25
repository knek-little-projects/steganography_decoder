/**
 * Tests for LSB Steganography Library
 * Using Mocha + Chai
 */

import { encodeLSB, decodeLSB } from './lsb.js';
import { expect } from 'chai';

// Simple ImageData polyfill for Node.js
if (typeof ImageData === 'undefined') {
  global.ImageData = class ImageData {
    constructor(data, width, height) {
      if (arguments.length === 2) {
        // Called as ImageData(width, height)
        this.width = data;
        this.height = width;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        // Called as ImageData(data, width, height)
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
  };
}

/**
 * Helper function to create a test image
 */
function createTestImage(width, height, fillValue = 128) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fillValue;     // R
    data[i + 1] = fillValue;  // G
    data[i + 2] = fillValue;  // B
    data[i + 3] = 255;        // A
  }
  return new ImageData(data, width, height);
}

describe('LSB Steganography Library', () => {
  describe('Basic encode/decode', () => {
    it('should encode and decode with 1 bit, RGB, row order, UTF-8', () => {
      const message = 'Hello, World!';
      const image = createTestImage(10, 10, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'row',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });

    it('should encode and decode with 2 bits, RGB, row order, UTF-8', () => {
      const message = 'Hello, World!';
      const image = createTestImage(10, 10, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 2,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'row',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 2,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });

    it('should encode and decode with column order', () => {
      const message = 'Test message';
      const image = createTestImage(10, 10, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'column',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'column',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });
  });

  describe('Channel combinations', () => {
    it('should work with R channel only', () => {
      const message = 'Single channel';
      const image = createTestImage(20, 20, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: false,
        useB: false,
        pixelOrder: 'row',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: false,
        useB: false,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });

    it('should work with RG channels only', () => {
      const message = 'RG test';
      const image = createTestImage(15, 15, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: false,
        pixelOrder: 'row',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: false,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });
  });

  describe('Encoding types', () => {
    it('should work with ASCII encoding', () => {
      const message = 'Hello World';
      const image = createTestImage(10, 10, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'row',
        encoding: 'ascii',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'ascii',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });

    it('should work with UTF-8 and special characters', () => {
      const message = 'Hello 世界! Привет! 🌍';
      const image = createTestImage(20, 20, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'row',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
    });
  });

  describe('Bit counts', () => {
    for (let bits = 3; bits <= 8; bits++) {
      it(`should work with ${bits} bits per channel`, () => {
        const message = 'Test message';
        const image = createTestImage(20, 20, 128);
        
        const encoded = encodeLSB(image, message, {
          bitsPerChannel: bits,
          useR: true,
          useG: true,
          useB: true,
          pixelOrder: 'row',
          encoding: 'utf8',
        });
        
        const decoded = decodeLSB(encoded, {
          bitsPerChannel: bits,
          useR: true,
          useG: true,
          useB: true,
          order: 'row',
          encoding: 'utf8',
        });
        
        // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      let extractedMessage = decoded.text;
      // Remove trailing dots and underscores
      extractedMessage = extractedMessage.replace(/[._]+$/, '');
      // If message is shorter, take only the message length
      if (extractedMessage.length > message.length) {
        extractedMessage = extractedMessage.substring(0, message.length);
      }
      expect(extractedMessage).to.equal(message);
      });
    }
  });

  describe('Long messages', () => {
    it('should handle long messages', () => {
      const message = 'This is a longer message that should test the capacity limits of the image. ' +
                      'It contains multiple sentences and various characters.';
      const image = createTestImage(50, 50, 128);
      
      const encoded = encodeLSB(image, message, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'row',
        encoding: 'utf8',
      });
      
      const decoded = decodeLSB(encoded, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Decoder reads all bits, so we need to extract just the message part
      // The message should be at the start, followed by padding (dots/underscores)
      // Just check that message is at the start of decoded text
      expect(decoded.text.substring(0, message.length)).to.equal(message);
    });
  });

  describe('Error handling', () => {
    it('should throw error when message is too long', () => {
      const message = 'A'.repeat(10000);
      const image = createTestImage(10, 10, 128);
      
      expect(() => {
        encodeLSB(image, message, {
          bitsPerChannel: 1,
          useR: true,
          useG: true,
          useB: true,
          pixelOrder: 'row',
          encoding: 'utf8',
        });
      }).to.throw('too long');
    });

    it('should throw error when no channels are selected', () => {
      const message = 'Test';
      const image = createTestImage(10, 10, 128);
      
      expect(() => {
        encodeLSB(image, message, {
          bitsPerChannel: 1,
          useR: false,
          useG: false,
          useB: false,
          pixelOrder: 'row',
          encoding: 'utf8',
        });
      }).to.throw('channel');
    });

    it('should throw error for invalid bitsPerChannel', () => {
      const message = 'Test';
      const image = createTestImage(10, 10, 128);
      
      expect(() => {
        encodeLSB(image, message, {
          bitsPerChannel: 0,
          useR: true,
          useG: true,
          useB: true,
          pixelOrder: 'row',
          encoding: 'utf8',
        });
      }).to.throw('bitsPerChannel');
    });

    it('should throw error for invalid encoding in ASCII mode', () => {
      const message = 'Привет'; // Non-ASCII characters
      const image = createTestImage(10, 10, 128);
      
      expect(() => {
        encodeLSB(image, message, {
          bitsPerChannel: 1,
          useR: true,
          useG: true,
          useB: true,
          pixelOrder: 'row',
          encoding: 'ascii',
        });
      }).to.throw('ASCII encoding only supports');
    });
  });

  describe('Round-trip consistency', () => {
    it('should produce same result when encoding same message twice', () => {
      const message = 'Consistency test';
      const image1 = createTestImage(10, 10, 128);
      const image2 = createTestImage(10, 10, 128);
      
      const config = {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        pixelOrder: 'row',
        encoding: 'utf8',
      };
      
      const encoded1 = encodeLSB(image1, message, config);
      const encoded2 = encodeLSB(image2, message, config);
      
      // Decode both
      const decoded1 = decodeLSB(encoded1, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'utf8',
      });
      
      const decoded2 = decodeLSB(encoded2, {
        bitsPerChannel: 1,
        useR: true,
        useG: true,
        useB: true,
        order: 'row',
        encoding: 'utf8',
      });
      
      // Extract messages (decoder reads all bits)
      let extracted1 = decoded1.text.replace(/[._]+$/, '');
      if (extracted1.length > message.length) {
        extracted1 = extracted1.substring(0, message.length);
      }
      let extracted2 = decoded2.text.replace(/[._]+$/, '');
      if (extracted2.length > message.length) {
        extracted2 = extracted2.substring(0, message.length);
      }
      
      expect(extracted1).to.equal(message);
      expect(extracted2).to.equal(message);
      expect(extracted1).to.equal(extracted2);
    });
  });
});
