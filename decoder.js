import { setImageForEncode } from './encoder.js';

import { decodeLSB, formatBytesAsAscii, formatBytesAsUtf8, formatBytesAsHex } from './lsb.js';
import { autoDetectParametersByMaxLength } from './autoDetect.js';

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const imagePreview = document.getElementById('imagePreview');
const metadataList = document.getElementById('metadataList');

const bitsPerChannelInput = document.getElementById('bitsPerChannel');
const channelRInput = document.getElementById('channelR');
const channelGInput = document.getElementById('channelG');
const channelBInput = document.getElementById('channelB');
const decodeButton = document.getElementById('decodeButton');
const autoDetectButton = document.getElementById('autoDetectButton');
const statusLabel = document.getElementById('statusLabel');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

const textOutput = document.getElementById('textOutput');
const hexOutput = document.getElementById('hexOutput');
const copyTextButton = document.getElementById('copyTextButton');
const copyHexButton = document.getElementById('copyHexButton');

const encodingRadios = document.querySelectorAll('input[name="encoding"]');
const pixelOrderRadios = document.querySelectorAll('input[name="pixelOrder"]');

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let currentFile = null;
let currentImageData = null;

const STORAGE_KEY = 'lsb_decoder_settings_v1';

function getSelectedEncoding() {
  const checked = Array.from(encodingRadios).find((r) => r.checked);
  return checked ? checked.value : 'utf8';
}

function getSelectedPixelOrder() {
  const checked = Array.from(pixelOrderRadios).find((r) => r.checked);
  return checked ? checked.value : 'row';
}

function setStatus(message, isError = false) {
  statusLabel.textContent = message || '';
  statusLabel.classList.toggle('error', Boolean(isError));
}

function updateMetadata(file, imageData) {
  metadataList.innerHTML = '';
  if (!file || !imageData) {
    return;
  }

  const entries = [
    ['File name', file.name],
    ['MIME type', file.type || 'unknown'],
    ['Size', `${(file.size / 1024).toFixed(1)} KB (${file.size} bytes)`],
    ['Dimensions', `${imageData.width} × ${imageData.height}`],
    [
      'Pixels',
      `${(imageData.width * imageData.height).toLocaleString('en-US')}`,
    ],
  ];

  for (const [label, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    metadataList.appendChild(dt);
    metadataList.appendChild(dd);
  }
}

function clearOutputs() {
  textOutput.value = '';
  hexOutput.textContent = '';
}

function ensureAtLeastOneChannel() {
  const anyChecked = channelRInput.checked || channelGInput.checked || channelBInput.checked;
  decodeButton.disabled = !anyChecked;
}

function onBitsPerChannelBlur() {
  let value = parseInt(bitsPerChannelInput.value, 10);
  if (Number.isNaN(value)) {
    value = 1;
  }
  value = Math.min(8, Math.max(1, value));
  bitsPerChannelInput.value = String(value);
}

// decodeImageData is now imported from lsb.js as decodeLSB

function readSettingsFromForm() {
  const bits = parseInt(bitsPerChannelInput.value, 10);
  const bitsPerChannel = Number.isNaN(bits)
    ? 1
    : Math.min(8, Math.max(1, bits));

  return {
    bitsPerChannel,
    useR: channelRInput.checked,
    useG: channelGInput.checked,
    useB: channelBInput.checked,
    order: getSelectedPixelOrder(),
    encoding: getSelectedEncoding(),
  };
}

function applySettingsToForm(settings) {
  if (!settings) return;
  if (typeof settings.bitsPerChannel === 'number') {
    bitsPerChannelInput.value = String(
      Math.min(8, Math.max(1, settings.bitsPerChannel)),
    );
  }
  if (typeof settings.useR === 'boolean') channelRInput.checked = settings.useR;
  if (typeof settings.useG === 'boolean') channelGInput.checked = settings.useG;
  if (typeof settings.useB === 'boolean') channelBInput.checked = settings.useB;

  if (typeof settings.order === 'string') {
    for (const radio of pixelOrderRadios) {
      radio.checked = radio.value === settings.order;
    }
  }
  if (typeof settings.encoding === 'string') {
    for (const radio of encodingRadios) {
      radio.checked = radio.value === settings.encoding;
    }
  }
  ensureAtLeastOneChannel();
}

function persistSettings() {
  const settings = readSettingsFromForm();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }
}

function restoreSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    ensureAtLeastOneChannel();
    return;
  }
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      ensureAtLeastOneChannel();
      return;
    }
    const settings = result[STORAGE_KEY];
    applySettingsToForm(settings);
  });
}

function handleDecodeClick() {
  setStatus('');
  clearOutputs();

  if (!currentImageData) {
    setStatus('Load an image first.', true);
    return;
  }

  const { bitsPerChannel, useR, useG, useB, order, encoding } =
    readSettingsFromForm();

  if (!useR && !useG && !useB) {
    setStatus('Select at least one channel (R, G or B).', true);
    return;
  }

  persistSettings();

  try {
    const t0 = performance.now();
    const result = decodeLSB(currentImageData, {
      bitsPerChannel,
      useR,
      useG,
      useB,
      order,
    });
    const t1 = performance.now();

    // Format bytes for display based on encoding
    const formattedText = encoding === 'ascii'
      ? formatBytesAsAscii(result.bytes, result.hasTail, result.tailBits || 0)
      : formatBytesAsUtf8(result.bytes, result.hasTail, result.tailBits || 0);
    const formattedHex = formatBytesAsHex(result.bytes);

    textOutput.value = formattedText;
    hexOutput.textContent = formattedHex;

    const bitsUsed =
      currentImageData.width *
      currentImageData.height *
      (Number(useR) + Number(useG) + Number(useB)) *
      bitsPerChannel;
    const summary = [
      `${result.byteCount} bytes`,
      `${bitsPerChannel} bit(s)/channel`,
      `order: ${order}`,
      `encoding: ${encoding.toUpperCase()}`,
      `~${(t1 - t0).toFixed(1)} ms`,
    ];
    setStatus(summary.join(' · '), false);
  } catch (e) {
    console.error('Decode error', e);
    setStatus('Decode failed. See console for details.', true);
  }
}

async function handleAutoDetectClick() {
  setStatus('');
  clearOutputs();

  if (!currentImageData) {
    setStatus('Load an image first.', true);
    return;
  }

  setStatus('Detecting parameters...');
  autoDetectButton.disabled = true;
  decodeButton.disabled = true;
  progressContainer.style.display = 'flex';
  progressBar.style.width = '0%';
  progressText.textContent = '0%';

  try {
    const t0 = performance.now();
    const detection = await autoDetectParametersByMaxLength(currentImageData, {
      bitsPerChannel: [1, 2, 3, 4],
      quickMode: false,
      onProgress: (current, total, percentage) => {
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
      },
    });
    const t1 = performance.now();

    // Hide progress bar
    progressContainer.style.display = 'none';

    if (!detection.params || !detection.result) {
      setStatus('Could not detect parameters. Try manual decoding.', true);
      return;
    }

    // Apply detected parameters to form
    const { bitsPerChannel, useR, useG, useB, order, encoding } = detection.params;
    
    bitsPerChannelInput.value = String(bitsPerChannel);
    channelRInput.checked = useR;
    channelGInput.checked = useG;
    channelBInput.checked = useB;
    
    // Set pixel order
    for (const radio of pixelOrderRadios) {
      radio.checked = radio.value === order;
    }
    
    // Set encoding
    for (const radio of encodingRadios) {
      radio.checked = radio.value === encoding;
    }
    
    ensureAtLeastOneChannel();
    persistSettings();

    // Display decoded result
    const formattedHex = formatBytesAsHex(detection.result.bytes);
    // Format with tailBits for proper display
    const formattedText = detection.params.encoding === 'ascii'
      ? formatBytesAsAscii(detection.result.bytes, detection.result.hasTail, detection.result.tailBits || 0)
      : formatBytesAsUtf8(detection.result.bytes, detection.result.hasTail, detection.result.tailBits || 0);
    textOutput.value = formattedText;
    hexOutput.textContent = formattedHex;

    const summary = [
      `Detected: ${bitsPerChannel} bit(s)/channel`,
      `${detection.params.useR ? 'R' : ''}${detection.params.useG ? 'G' : ''}${detection.params.useB ? 'B' : ''}`,
      `order: ${order}`,
      `encoding: ${encoding.toUpperCase()}`,
      `max length: ${detection.maxPrintableLength} bytes`,
      `~${(t1 - t0).toFixed(1)} ms`,
    ];
    setStatus(summary.join(' · '), false);
  } catch (e) {
    console.error('Auto-detect error', e);
    setStatus('Auto-detection failed. See console for details.', true);
    progressContainer.style.display = 'none';
  } finally {
    autoDetectButton.disabled = false;
    decodeButton.disabled = false;
  }
}

function handleFile(file) {
  if (!file) return;
  currentFile = file;
  clearOutputs();
  setStatus('Loading image...');

  const reader = new FileReader();
  reader.onload = (event) => {
    const url = event.target && event.target.result;
    if (!url) {
      setStatus('Unable to read file.', true);
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        imagePreview.src = url;
        imagePreview.style.display = 'block';
        updateMetadata(file, currentImageData);
        // Notify encoder about new image
        if (typeof setImageForEncode === 'function') {
          setImageForEncode(currentImageData);
        }
        setStatus('Image loaded. Ready to decode.');
      } catch (e) {
        console.error('Canvas decode error', e);
        currentImageData = null;
        imagePreview.removeAttribute('src');
        updateMetadata(null, null);
        setStatus('Failed to read pixels from image.', true);
      }
    };
    img.onerror = () => {
      currentImageData = null;
      imagePreview.removeAttribute('src');
      updateMetadata(null, null);
      setStatus('Failed to load image.', true);
    };
    img.src = url;
  };
  reader.onerror = () => {
    setStatus('File read error.', true);
  };
  reader.readAsDataURL(file);
}

function handleFileInputChange(event) {
  const input = event.target;
  if (!input.files || input.files.length === 0) {
    return;
  }
  const file = input.files[0];
  handleFile(file);
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove('drag-over');
  const dt = event.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) {
    return;
  }
  const file = dt.files[0];
  handleFile(file);
}

function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove('drag-over');
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus('Copied to clipboard.');
      return;
    }
  } catch {
    // fall through to fallback
  }
  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    setStatus('Copied to clipboard.');
  } catch (e) {
    console.error('Clipboard error', e);
    setStatus('Failed to copy to clipboard.', true);
  } finally {
    document.body.removeChild(temp);
  }
}

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const decodePanel = document.getElementById('decodePanel');
  const encodePanel = document.getElementById('encodePanel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (tab === 'decode') {
        decodePanel.style.display = 'flex';
        encodePanel.style.display = 'none';
      } else {
        decodePanel.style.display = 'none';
        encodePanel.style.display = 'flex';
      }
    });
  });
}

function init() {
  restoreSettings();
  ensureAtLeastOneChannel();
  initTabs();

  fileInput.addEventListener('change', handleFileInputChange);

  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);

  decodeButton.addEventListener('click', handleDecodeClick);
  autoDetectButton.addEventListener('click', handleAutoDetectClick);
  bitsPerChannelInput.addEventListener('blur', onBitsPerChannelBlur);

  channelRInput.addEventListener('change', () => {
    ensureAtLeastOneChannel();
    persistSettings();
  });
  channelGInput.addEventListener('change', () => {
    ensureAtLeastOneChannel();
    persistSettings();
  });
  channelBInput.addEventListener('change', () => {
    ensureAtLeastOneChannel();
    persistSettings();
  });

  encodingRadios.forEach((radio) => {
    radio.addEventListener('change', persistSettings);
  });
  pixelOrderRadios.forEach((radio) => {
    radio.addEventListener('change', persistSettings);
  });

  copyTextButton.addEventListener('click', () =>
    copyToClipboard(textOutput.value),
  );
  copyHexButton.addEventListener('click', () =>
    copyToClipboard(hexOutput.textContent || ''),
  );
}

document.addEventListener('DOMContentLoaded', init);


