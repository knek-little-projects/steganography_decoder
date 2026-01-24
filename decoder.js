const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const imagePreview = document.getElementById('imagePreview');
const metadataList = document.getElementById('metadataList');

const bitsPerChannelInput = document.getElementById('bitsPerChannel');
const channelRInput = document.getElementById('channelR');
const channelGInput = document.getElementById('channelG');
const channelBInput = document.getElementById('channelB');
const decodeButton = document.getElementById('decodeButton');
const statusLabel = document.getElementById('statusLabel');

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

function isPrintableAscii(byte) {
  return byte >= 0x20 && byte <= 0x7e;
}

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

function isControlCharacter(ch) {
  if (!ch || ch.length === 0) return false;
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  if (code === 0x0a || code === 0x0d || code === 0x09) {
    return false;
  }
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
}

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

function decodeImageData(imageData, options) {
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
    const result = decodeImageData(currentImageData, {
      bitsPerChannel,
      useR,
      useG,
      useB,
      order,
      encoding,
    });
    const t1 = performance.now();

    textOutput.value = result.text;
    hexOutput.textContent = result.hex;

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

function init() {
  restoreSettings();
  ensureAtLeastOneChannel();

  fileInput.addEventListener('change', handleFileInputChange);

  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);

  decodeButton.addEventListener('click', handleDecodeClick);
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


