import { encodeLSB as encodeLSBCore } from './lsb.js';
import { jpegEncode as jpegEncodeCore } from './stegojpeg.js';

let currentImageDataForEncode = null;
let currentEncodeMethod = 'jpeg-dct'; // Track current method for download
let currentJpegQuality = 0.95; // Track JPEG quality for download

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

// JPEG DCT controls
const jpegDctOptionsEl = document.getElementById('jpegDctOptions');
const dctRobustnessInput = document.getElementById('dctRobustness');
const dctRobustnessValue = document.getElementById('dctRobustnessValue');
const dctJpegQualityInput = document.getElementById('dctJpegQuality');
const dctJpegQualityValue = document.getElementById('dctJpegQualityValue');
const dctFillWithZerosInput = document.getElementById('dctFillWithZeros');

// LSB wrapper
const lsbOptionsWrapper = document.getElementById('lsbOptionsWrapper');

// LSB controls
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
    const quality = currentJpegQuality;
    encodedCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'encoded-image.jpg';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', quality);
  } else {
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
 * Show/hide method-specific options based on encoding method selection.
 * Both option sets live inside the shared collapsible #encoderOptions panel.
 */
function updateMethodUI() {
  const method = getSelectedEncodeMethod();
  const isLSB = method === 'lossless-lsb';

  // Toggle JPEG DCT options inside the shared panel
  if (jpegDctOptionsEl) {
    jpegDctOptionsEl.style.display = isLSB ? 'none' : '';
  }

  // Toggle LSB options inside the shared panel
  if (lsbOptionsWrapper) {
    lsbOptionsWrapper.style.display = isLSB ? '' : 'none';
  }

  updateCapacity();
}

/* ---- Slider live-value updates ---- */

if (dctRobustnessInput && dctRobustnessValue) {
  dctRobustnessInput.addEventListener('input', () => {
    dctRobustnessValue.textContent = dctRobustnessInput.value;
  });
}

if (dctJpegQualityInput && dctJpegQualityValue) {
  dctJpegQualityInput.addEventListener('input', () => {
    dctJpegQualityValue.textContent = dctJpegQualityInput.value;
  });
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
      const step = dctRobustnessInput ? parseInt(dctRobustnessInput.value, 10) : 50;
      const fillZeros = dctFillWithZerosInput ? dctFillWithZerosInput.checked : false;
      currentJpegQuality = dctJpegQualityInput
        ? parseInt(dctJpegQualityInput.value, 10) / 100
        : 0.95;

      encodedImageData = jpegEncodeCore(currentImageDataForEncode, message, {
        step,
        fillWithZeros: fillZeros,
      });
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
