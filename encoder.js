import { encodeLSB as encodeLSBCore } from './lsb.js';

let currentImageDataForEncode = null;

const messageInput = document.getElementById('messageInput');
const charCount = document.getElementById('charCount');
const encodeButton = document.getElementById('encodeButton');
const encodeStatusLabel = document.getElementById('encodeStatusLabel');
const encodedCanvas = document.getElementById('encodedCanvas');
const downloadButton = document.getElementById('downloadButton');
const capacityInfo = document.getElementById('capacityInfo');
const capacityText = document.getElementById('capacityText');
const encodedPreviewSection = document.getElementById('encodedPreviewSection');
const toggleEncoderOptionsBtn = document.getElementById('toggleEncoderOptions');
const encoderOptions = document.getElementById('encoderOptions');

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

function setEncodeStatus(message, isError = false) {
  encodeStatusLabel.textContent = message || '';
  encodeStatusLabel.classList.toggle('error', Boolean(isError));
}

export function setImageForEncode(imageData) {
  currentImageDataForEncode = imageData;
  updateCapacity();
}

function updateCapacity() {
  if (!currentImageDataForEncode) {
    capacityInfo.style.display = 'none';
    return;
  }

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

// encodeLSB is now imported from lsb.js as encodeLSBCore

if (messageInput) {
  messageInput.addEventListener('input', () => {
    const count = messageInput.value.length;
    if (charCount) charCount.textContent = count.toLocaleString();
    updateCapacity();
  });
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

  try {
    setEncodeStatus('Encoding...');
    encodeButton.disabled = true;

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

    const encodedImageData = encodeLSBCore(currentImageDataForEncode, message, config);

    encodedCanvas.width = encodedImageData.width;
    encodedCanvas.height = encodedImageData.height;
    const ctx = encodedCanvas.getContext('2d');
    ctx.putImageData(encodedImageData, 0, 0);

    // Show encoded preview section
    if (encodedPreviewSection) {
      encodedPreviewSection.style.display = 'flex';
    }
    downloadButton.style.display = 'inline-flex';
    setEncodeStatus('Encoded successfully!');
  } catch (error) {
    setEncodeStatus(error.message, true);
  } finally {
    if (encodeButton) encodeButton.disabled = false;
  }
  });
}

if (downloadButton) {
  downloadButton.addEventListener('click', () => {
  encodedCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'encoded-image.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
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

