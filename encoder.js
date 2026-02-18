import { encodeLSB as encodeLSBCore } from './lsb.js';
import { jpegEncode as jpegEncodeCore } from './stegojpeg.js';

let currentImageDataForEncode = null;
let currentEncodeMethod = 'jpeg-dct'; // Track current method for download

const messageInput = document.getElementById('messageInput');
const charCount = document.getElementById('charCount');
const encodeButton = document.getElementById('encodeButton');
const encodeStatusLabel = document.getElementById('encodeStatusLabel');
const encodedCanvas = document.getElementById('encodedCanvas');
const encodeDownloadButton = document.getElementById('encodeDownloadButton');
const capacityInfo = document.getElementById('capacityInfo');
const capacityText = document.getElementById('capacityText');
const encodedPreviewSection = document.getElementById('encodedPreviewSection');
const toggleEncoderOptionsBtn = document.getElementById('toggleEncoderOptions');
const encoderOptions = document.getElementById('encoderOptions');
const encodeMethodSelect = document.getElementById('encodeMethod');

const encodeBitsPerChannelInput = document.getElementById('encodeBitsPerChannel');
const encodeChannelRInput = document.getElementById('encodeChannelR');
const encodeChannelGInput = document.getElementById('encodeChannelG');
const encodeChannelBInput = document.getElementById('encodeChannelB');
const encodeEncodingRadios = document.querySelectorAll('input[name="encodeEncoding"]');
const encodePixelOrderRadios = document.querySelectorAll('input[name="encodePixelOrder"]');
const fillWithZerosInput = document.getElementById('fillWithZeros');

function getSelectedEncodeEncoding() {
  const checked = Array.from(encodeEncodingRadios).find((r) => r.checked);
  return checked ? checked.value : 'utf8';
}

function getSelectedEncodePixelOrder() {
  const checked = Array.from(encodePixelOrderRadios).find((r) => r.checked);
  return checked ? checked.value : 'row';
}

function getSelectedEncodeMethod() {
  return encodeMethodSelect ? encodeMethodSelect.value : 'lossless-lsb';
}

function setEncodeStatus(message, isError = false) {
  encodeStatusLabel.textContent = message || '';
  encodeStatusLabel.classList.toggle('error', Boolean(isError));
}

function downloadEncodedImage() {
  if (!encodedCanvas || !encodedCanvas.width || !encodedCanvas.height) {
    return;
  }

  if (currentEncodeMethod === 'jpeg-dct') {
    // Save as JPEG with high quality (to preserve DCT-embedded data)
    encodedCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'encoded-image.jpg';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.95);
  } else {
    // Save as PNG (lossless)
    encodedCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'encoded-image.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}

export function setImageForEncode(imageData) {
  currentImageDataForEncode = imageData;
  updateCapacity();
  // Hide download button when new image is loaded
  if (encodeDownloadButton) {
    encodeDownloadButton.style.display = 'none';
  }
}

function updateCapacity() {
  if (!currentImageDataForEncode) {
    capacityInfo.style.display = 'none';
    return;
  }

  const method = getSelectedEncodeMethod();

  if (method === 'jpeg-dct') {
    // JPEG DCT: 1 bit per 8×8 block, minus 32-bit header
    const blocksX = Math.floor(currentImageDataForEncode.width / 8);
    const blocksY = Math.floor(currentImageDataForEncode.height / 8);
    const totalBlocks = blocksX * blocksY;
    const payloadBits = Math.max(0, totalBlocks - 32); // 32 bits for header
    const totalBytes = Math.floor(payloadBits / 8);

    capacityText.textContent = `~${totalBytes.toLocaleString()} bytes (${totalBlocks.toLocaleString()} blocks of 8×8, JPEG DCT)`;
    capacityInfo.style.display = 'block';
    return;
  }

  // Lossless LSB capacity
  const bitsPerChannel = parseInt(encodeBitsPerChannelInput.value, 10) || 1;
  const channels = [
    encodeChannelRInput.checked,
    encodeChannelGInput.checked,
    encodeChannelBInput.checked,
  ].filter(Boolean).length;

  if (channels === 0) {
    capacityInfo.style.display = 'none';
    return;
  }

  const totalBits = currentImageDataForEncode.width * currentImageDataForEncode.height * channels * bitsPerChannel;
  const totalBytes = Math.floor(totalBits / 8);
  
  const encoding = getSelectedEncodeEncoding();
  const avgBytesPerChar = encoding === 'utf8' ? 2 : 1;
  const estimatedChars = Math.floor(totalBytes / avgBytesPerChar);

  capacityText.textContent = `~${estimatedChars.toLocaleString()} characters (${totalBytes.toLocaleString()} bytes, ${totalBits.toLocaleString()} bits)`;
  capacityInfo.style.display = 'block';
}

/**
 * Show/hide LSB-specific options based on encoding method.
 * JPEG DCT doesn't use bits-per-channel, channels, pixel order, etc.
 */
function updateMethodUI() {
  const method = getSelectedEncodeMethod();
  const isLSB = method === 'lossless-lsb';

  // Show/hide the toggle button for LSB options
  if (toggleEncoderOptionsBtn) {
    toggleEncoderOptionsBtn.style.display = isLSB ? '' : 'none';
  }
  // Hide LSB options panel when switching to JPEG DCT
  if (!isLSB && encoderOptions) {
    encoderOptions.style.display = 'none';
  }

  updateCapacity();
}

if (messageInput) {
  messageInput.addEventListener('input', () => {
    const count = messageInput.value.length;
    if (charCount) charCount.textContent = count.toLocaleString();
    updateCapacity();
  });
}

if (encodeMethodSelect) {
  encodeMethodSelect.addEventListener('change', updateMethodUI);
}

if (encodeButton) {
  encodeButton.addEventListener('click', async () => {
  if (!currentImageDataForEncode) {
    setEncodeStatus('Please load an image first', true);
    return;
  }

  const message = messageInput.value.trim();
  if (!message) {
    setEncodeStatus('Please enter a message to encode', true);
    return;
  }

  const method = getSelectedEncodeMethod();
  currentEncodeMethod = method;

  try {
    setEncodeStatus('Encoding...');
    encodeButton.disabled = true;

    let encodedImageData;

    if (method === 'jpeg-dct') {
      encodedImageData = jpegEncodeCore(currentImageDataForEncode, message);
    } else {
      const config = {
        bitsPerChannel: parseInt(encodeBitsPerChannelInput.value, 10) || 1,
        useR: encodeChannelRInput.checked,
        useG: encodeChannelGInput.checked,
        useB: encodeChannelBInput.checked,
        pixelOrder: getSelectedEncodePixelOrder(),
        encoding: getSelectedEncodeEncoding(),
        fillWithZeros: fillWithZerosInput ? fillWithZerosInput.checked : false,
      };

      if (!config.useR && !config.useG && !config.useB) {
        throw new Error('At least one channel must be selected');
      }

      encodedImageData = encodeLSBCore(currentImageDataForEncode, message, config);
    }

    encodedCanvas.width = encodedImageData.width;
    encodedCanvas.height = encodedImageData.height;
    const ctx = encodedCanvas.getContext('2d');
    ctx.putImageData(encodedImageData, 0, 0);

    // Show encoded preview section
    if (encodedPreviewSection) {
      encodedPreviewSection.style.display = 'flex';
    }
    if (encodeDownloadButton) {
      encodeDownloadButton.style.display = 'inline-flex';
    }

    const fmt = method === 'jpeg-dct' ? 'JPEG DCT' : 'Lossless LSB';
    setEncodeStatus(`Encoded successfully! (${fmt})`);
    downloadEncodedImage();
  } catch (error) {
    setEncodeStatus(error.message, true);
  } finally {
    if (encodeButton) encodeButton.disabled = false;
  }
  });
}

if (encodeDownloadButton) {
  encodeDownloadButton.addEventListener('click', () => {
    downloadEncodedImage();
  });
}

[encodeBitsPerChannelInput, encodeChannelRInput, encodeChannelGInput, encodeChannelBInput].forEach(el => {
  if (el) el.addEventListener('change', updateCapacity);
});

encodeEncodingRadios.forEach(radio => {
  if (radio) radio.addEventListener('change', updateCapacity);
});

// Toggle encoder options visibility
if (toggleEncoderOptionsBtn && encoderOptions) {
  toggleEncoderOptionsBtn.addEventListener('click', () => {
    const isVisible = encoderOptions.style.display !== 'none';
    encoderOptions.style.display = isVisible ? 'none' : 'block';
    toggleEncoderOptionsBtn.innerHTML = `<span class="toggle-icon">${isVisible ? '▼' : '▲'}</span> ${isVisible ? 'Show' : 'Hide'} encoder options`;
  });
}

// Init method UI on load
updateMethodUI();
