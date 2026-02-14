/**
 * Automatic Parameter Detection for LSB Steganography
 * 
 * Provides functions to automatically detect encoding parameters
 * from steganographic images.
 */

import { decodeLSB, formatBytesAsAscii, formatBytesAsUtf8 } from './lsb.js';
import { textScore } from './autoDetectHeuristics.js';

// Cache for loaded dictionaries
const dictionaryCache = new Map();
const TOP_WORDS_DICTIONARY_PATH = './dictionaries/top_words.json';
const DICTIONARY_CACHE_KEY = 'top_words';
let dictionaryLoadPromise = null;

/**
 * Loads all available dictionaries.
 * 
 * @returns {Promise<Map<string, Set<string>>>} Map of language to word set
 */
async function loadAllDictionaries() {
  if (dictionaryCache.has(DICTIONARY_CACHE_KEY)) {
    return dictionaryCache.get(DICTIONARY_CACHE_KEY);
  }

  if (dictionaryLoadPromise) {
    return dictionaryLoadPromise;
  }

  dictionaryLoadPromise = (async () => {
    try {
      const response = await fetch(TOP_WORDS_DICTIONARY_PATH);
      if (!response.ok) {
        console.warn(`Failed to load dictionary file ${TOP_WORDS_DICTIONARY_PATH}`);
        return new Map();
      }

      const data = await response.json();
      const dictionaries = new Map();

      for (const [languageCode, words] of Object.entries(data || {})) {
        if (!Array.isArray(words)) continue;

        const wordSet = new Set(
          words
            .map(word => String(word).trim().toLowerCase())
            .filter(word => word.length > 0)
        );

        if (wordSet.size > 0) {
          dictionaries.set(languageCode, wordSet);
        }
      }

      dictionaryCache.set(DICTIONARY_CACHE_KEY, dictionaries);
      return dictionaries;
    } catch (error) {
      console.warn(`Error loading dictionary file ${TOP_WORDS_DICTIONARY_PATH}:`, error);
      return new Map();
    }
  })();

  return dictionaryLoadPromise;
}

/**
 * Checks text against dictionaries and returns scores for each language.
 * 
 * @param {string} text - Text to check
 * @param {Map<string, Set<string>>} dictionaries - Map of language to word set
 * @returns {Object} Object with language scores and detected language
 */
function checkTextAgainstDictionaries(text, dictionaries) {
  if (!text || text.length === 0 || dictionaries.size === 0) {
    return { scores: {}, detectedLanguage: null, maxScore: 0 };
  }

  // Extract words from text (case-insensitive, split by non-word characters)
  const words = (text.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) || [])
    .filter(word => word.length > 0);

  if (words.length === 0) {
    return { scores: {}, detectedLanguage: null, maxScore: 0 };
  }

  const scores = {};
  let maxScore = 0;
  let detectedLanguage = null;

  // Check each dictionary
  for (const [language, dictionary] of dictionaries.entries()) {
    let matches = 0;
    let totalWords = 0;
    let matchedChars = 0

    for (const word of words) {
      // Check exact match
      if (dictionary.has(word)) {
        matches++;
        matchedChars += word.length
      }
      totalWords++;
    }

    // Calculate score: ratio of matches to total words
    // const score = totalWords > 0 ? matches / totalWords : 0;
    let score = 0
    if (text.length > 0) {
      score = matchedChars / text.length
    }
    scores[language] = {
      matches,
      totalWords,
      score,
    };

    if (score > maxScore) {
      maxScore = score;
      detectedLanguage = language;
    }
  }

  return { scores, detectedLanguage, maxScore };
}

/**
 * Calculates a quality score for text based on textScore heuristics and additional checks.
 * Higher score = better text quality.
 * 
 * @param {string} text - Text to evaluate
 * @param {Object} textScoreResult - Result from textScore function { score, metrics }
 * @returns {number} Quality score (0-100)
 */
function calculateTextQualityScore(text, textScoreResult) {
  if (!text || text.length === 0 || !textScoreResult) {
    return 0;
  }
  
  // Start with textScore (0-1), convert to 0-70 range
  let score = (textScoreResult.score || 0) * 70;
  
  // Add bonus based on textScore components if available
  if (textScoreResult.metrics?.components) {
    const comp = textScoreResult.metrics.components;
    // These are already normalized 0-1, add small bonuses
    score += comp.ctrlScore * 10;
    score += comp.compScore * 5;
    score += comp.entScore * 5;
  }
  
  // Analyze text content directly for additional quality checks
  const sample = text.substring(0, Math.min(200, text.length));
  
  // Count letters vs special characters
  const letterCount = (sample.match(/[a-zA-Zа-яА-Я]/g) || []).length;
  const letterRatio = letterCount / sample.length;
  
  // Prefer text with reasonable letter ratio (30-80% letters)
  if (letterRatio >= 0.3 && letterRatio <= 0.8) {
    score += 10;
  } else if (letterRatio < 0.1) {
    // Too few letters = mostly symbols/noise
    score -= 10;
  }
  
  // Prefer text with spaces (real text has spaces)
  if (sample.includes(' ') || sample.includes('\n') || sample.includes('\t')) {
    score += 5;
  }
  
  // Penalize excessive special characters
  const specialCharCount = (sample.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/g) || []).length;
  const specialCharRatio = specialCharCount / sample.length;
  if (specialCharRatio > 0.3) {
    // Too many special characters = likely noise
    score -= 10;
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculates the maximum length of printable ASCII characters from the start of bytes.
 * Stops at the first non-printable byte.
 * 
 * @param {Uint8Array} bytes - Bytes to analyze
 * @returns {number} Maximum length of printable characters from start
 */
function calculateMaxPrintableLength(bytes) {
  if (!bytes || bytes.length === 0) {
    return 0;
  }
  
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    // Printable ASCII: 0x20-0x7E, plus newline (0x0A), carriage return (0x0D), tab (0x09)
    const isPrintable = (byte >= 0x20 && byte <= 0x7E) || 
                        byte === 0x0A || 
                        byte === 0x0D || 
                        byte === 0x09;
    
    if (!isPrintable) {
      return i; // Return length up to (but not including) this byte
    }
  }
  
  // All bytes are printable
  return bytes.length;
}

/**
 * Automatically detects decoding parameters using max printable length heuristic.
 * Tries all possible parameter combinations and finds the one with the longest
 * sequence of printable characters from the start.
 * Only analyzes first 1000 bytes for performance.
 * 
 * @param {ImageData} imageData - The image data to analyze
 * @param {Object} options - Detection options
 * @param {number[]} options.bitsPerChannel - Array of bits per channel to try (default: [1,2,3,4])
 * @param {boolean} options.quickMode - If true, only tries most common combinations (default: false)
 * @param {Function} options.onProgress - Callback for progress updates (current, total, percentage)
 * @returns {Object} Detection result with params, result, maxPrintableLength, and all candidates
 */
export async function autoDetectParametersByMaxLength(imageData, options = {}) {
  const {
    bitsPerChannel = [1, 2, 3, 4],
    quickMode = false,
    onProgress = null,
    onBestCandidate = null,
    onCandidate = null, // Callback for each candidate found
    onCurrentParams = null, // Callback for current parameters being tested
    abortSignal = null,
  } = options;

  // Load dictionaries for language detection
  const dictionaries = await loadAllDictionaries();
  const useDictionaries = dictionaries.size > 0;

  const possibleBits = quickMode ? [1, 2] : bitsPerChannel;
  
  // Channel combinations (most common first)
  const channelCombinations = quickMode
    ? [
        { useR: true, useG: true, useB: true },
        { useR: true, useG: false, useB: false },
        { useR: true, useG: true, useB: false },
      ]
    : [
        { useR: true, useG: true, useB: true },
        { useR: true, useG: false, useB: false },
        { useR: false, useG: true, useB: false },
        { useR: false, useG: false, useB: true },
        { useR: true, useG: true, useB: false },
        { useR: true, useG: false, useB: true },
        { useR: false, useG: true, useB: true },
      ];
  
  const orders = ['row', 'column'];
  const encodings = ['utf8', 'ascii'];
  
  // Calculate total combinations
  const totalCombinations = possibleBits.length * channelCombinations.length * orders.length * encodings.length;
  let currentCombination = 0;
  
  const candidates = [];
  let bestMaxLength = -1;
  let bestDictionaryScore = -1;
  let bestParams = null;
  let bestResult = null;
  let bestDetectedLanguage = null;
  let bestTextScore = -1;
  let bestTextQuality = -1;
  
  const MAX_BYTES_TO_ANALYZE = 1000;
  
  for (const bits of possibleBits) {
    // Check if aborted at start of outer loop
    if (abortSignal && abortSignal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    
    for (const channels of channelCombinations) {
      // Check if aborted at start of channel loop
      if (abortSignal && abortSignal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      
      for (const order of orders) {
        // Check if aborted at start of order loop
        if (abortSignal && abortSignal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        
        for (const encoding of encodings) {
          // Check if aborted at start of encoding loop
          if (abortSignal && abortSignal.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          
          currentCombination++;
          
          // Report current parameters being tested
          if (onCurrentParams) {
            const channelsStr = `${channels.useR ? 'R' : ''}${channels.useG ? 'G' : ''}${channels.useB ? 'B' : ''}`;
            onCurrentParams({
              bitsPerChannel: bits,
              channels: channelsStr,
              order: order,
              encoding: encoding,
              current: currentCombination,
              total: totalCombinations,
            });
          }
          
          // Report progress
          if (onProgress) {
            const percentage = Math.round((currentCombination / totalCombinations) * 100);
            onProgress(currentCombination, totalCombinations, percentage);
            // Allow UI to update
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          
          // Check again after async operation
          if (abortSignal && abortSignal.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          
          try {
            const decoded = decodeLSB(imageData, {
              bitsPerChannel: bits,
              ...channels,
              order,
            });
            
            // Check after decodeLSB (which might be slow)
            if (abortSignal && abortSignal.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }
            
            // Only analyze first 1000 bytes for performance
            const bytesToAnalyze = decoded.bytes.slice(0, MAX_BYTES_TO_ANALYZE);
            
            // Calculate max printable length from raw bytes (first 1000 only)
            const maxPrintableLength = calculateMaxPrintableLength(bytesToAnalyze);
            
            // Use text detection heuristics to improve candidate selection
            // Don't filter completely - use metrics for sorting instead
            const textScoreResult = await textScore(bytesToAnalyze, {
              useCompression: true,
              compressionFormat: 'gzip',
            });
            
            // Check after text detection
            if (abortSignal && abortSignal.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }
            
            // Check after calculation
            if (abortSignal && abortSignal.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }
            
            // Check after formatting
            if (abortSignal && abortSignal.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }
            
            // Use first 1000 bytes for dictionary check (more accurate)
            const DICTIONARY_CHECK_BYTES = 1000;
            const dictionaryCheckBytes = decoded.bytes.slice(0, DICTIONARY_CHECK_BYTES);
            const dictionaryCheckText = encoding === 'ascii'
              ? formatBytesAsAscii(dictionaryCheckBytes, decoded.hasTail && decoded.bytes.length <= DICTIONARY_CHECK_BYTES, decoded.tailBits || 0)
              : formatBytesAsUtf8(dictionaryCheckBytes, decoded.hasTail && decoded.bytes.length <= DICTIONARY_CHECK_BYTES, decoded.tailBits || 0);
            
            // Check against dictionaries using first 1000 bytes
            let dictionaryScore = 0;
            let detectedLanguage = null;
            if (useDictionaries) {
              const dictResult = checkTextAgainstDictionaries(dictionaryCheckText, dictionaries);
              dictionaryScore = dictResult.maxScore;
              detectedLanguage = dictResult.detectedLanguage;
            }
            
            // Store only first 100 bytes for preview to save memory
            const PREVIEW_BYTES = 100;
            const previewBytes = decoded.bytes.slice(0, PREVIEW_BYTES);
            
            // Format preview text for sorting (only first 100 bytes)
            const previewText = encoding === 'ascii'
              ? formatBytesAsAscii(previewBytes, false, 0)
              : formatBytesAsUtf8(previewBytes, false, 0);
            
            const previewResult = {
              ...decoded,
              bytes: previewBytes,
              byteCount: Math.min(decoded.byteCount, PREVIEW_BYTES),
              text: previewText, // Preview text for sorting
            };
            
            const candidate = {
              params: { bitsPerChannel: bits, ...channels, order, encoding },
              result: previewResult, // Only first 100 bytes
              maxPrintableLength,
              dictionaryScore,
              detectedLanguage,
              textScoreResult,
            };
            
            candidates.push(candidate);
            
            // Notify about new candidate (for real-time display)
            if (onCandidate) {
              // Sort candidates before passing to callback
              const sortedCandidates = [...candidates].sort((a, b) => {
                if (useDictionaries && a.dictionaryScore > 0 && b.dictionaryScore > 0) {
                  if (Math.abs(a.dictionaryScore - b.dictionaryScore) > 0.01) {
                    return b.dictionaryScore - a.dictionaryScore;
                  }
                }
                const aTextScore = a.textScoreResult?.score ?? 0;
                const bTextScore = b.textScoreResult?.score ?? 0;
                const aIsText = aTextScore > 0.5;
                const bIsText = bTextScore > 0.5;
                if (aIsText && !bIsText) return -1;
                if (!aIsText && bIsText) return 1;
                if (Math.abs(aTextScore - bTextScore) > 0.05) {
                  return bTextScore - aTextScore;
                }
                const aQuality = calculateTextQualityScore(a.result.text, a.textScoreResult);
                const bQuality = calculateTextQualityScore(b.result.text, b.textScoreResult);
                if (Math.abs(aQuality - bQuality) > 1) {
                  return bQuality - aQuality;
                }
                return b.maxPrintableLength - a.maxPrintableLength;
              });
              onCandidate(sortedCandidates);
            }
            
            // Update best candidate: prioritize dictionary matches, then text detection quality, then max length
            let isBetter = false;
            const currentTextScore = textScoreResult.score || 0;
            const currentIsText = currentTextScore > 0.5; // Threshold: score > 0.5 = likely text
            
            // Calculate text quality score using multiple metrics
            const currentTextQuality = calculateTextQualityScore(formattedText, textScoreResult);
            
            if (useDictionaries && dictionaryScore > 0) {
              // If we have dictionary matches, prefer candidates with higher dictionary scores
              if (dictionaryScore > bestDictionaryScore || 
                  (dictionaryScore === bestDictionaryScore && currentTextQuality > bestTextQuality)) {
                isBetter = true;
              }
            } else {
              // Fallback: prefer candidates that pass text detection, then by text quality
              const bestIsText = bestTextScore > 0.5;
              if (currentIsText && !bestIsText) {
                isBetter = true;
              } else if (currentIsText === bestIsText) {
                // Both are text or both are not - prefer better text quality, then max length
                if (currentTextQuality > bestTextQuality || 
                    (Math.abs(currentTextQuality - bestTextQuality) < 0.1 && maxPrintableLength > bestMaxLength)) {
                  isBetter = true;
                }
              }
            }
            
            if (isBetter) {
              bestMaxLength = maxPrintableLength;
              bestDictionaryScore = dictionaryScore;
              bestParams = { bitsPerChannel: bits, ...channels, order, encoding };
              bestResult = result;
              bestDetectedLanguage = detectedLanguage;
              bestTextScore = currentTextScore;
              bestTextQuality = currentTextQuality;
              
              // Notify about new best candidate
              if (onBestCandidate) {
                onBestCandidate({
                  params: bestParams,
                  result: bestResult,
                  maxPrintableLength: bestMaxLength,
                  dictionaryScore: bestDictionaryScore,
                  detectedLanguage: bestDetectedLanguage,
                });
              }
            }
          } catch (e) {
            // Re-throw abort errors
            if (e.name === 'AbortError') {
              throw e;
            }
            // Skip other errors silently
          }
        }
      }
    }
  }
  
  // Sort candidates: prioritize dictionary scores, then text detection, then text quality, then max printable length
  candidates.sort((a, b) => {
    // If both have dictionary scores, sort by dictionary score first
    if (useDictionaries && a.dictionaryScore > 0 && b.dictionaryScore > 0) {
      if (Math.abs(a.dictionaryScore - b.dictionaryScore) > 0.01) {
        return b.dictionaryScore - a.dictionaryScore;
      }
    }
    
    // Then prioritize candidates that pass text detection (textScore > 0.5)
    const aTextScore = a.textScoreResult?.score ?? 0;
    const bTextScore = b.textScoreResult?.score ?? 0;
    const aIsText = aTextScore > 0.5;
    const bIsText = bTextScore > 0.5;
    if (aIsText && !bIsText) return -1;
    if (!aIsText && bIsText) return 1;
    
    // If both are text or both are not, sort by textScore
    if (Math.abs(aTextScore - bTextScore) > 0.05) {
      return bTextScore - aTextScore;
    }
    
    // Then by text quality score
    const aQuality = calculateTextQualityScore(a.result.text, a.textScoreResult);
    const bQuality = calculateTextQualityScore(b.result.text, b.textScoreResult);
    if (Math.abs(aQuality - bQuality) > 1) {
      return bQuality - aQuality;
    }
    
    // Finally by max printable length
    return b.maxPrintableLength - a.maxPrintableLength;
  });
  
  return {
    params: bestParams,
    result: bestResult,
    maxPrintableLength: bestMaxLength,
    dictionaryScore: bestDictionaryScore,
    detectedLanguage: bestDetectedLanguage,
    candidates: candidates, // Return all candidates
  };
}

/**
 * Automatically detects decoding parameters using brute force approach.
 * Tries all possible parameter combinations and scores results to find the best match.
 * 
 * @param {ImageData} imageData - The image data to analyze
 * @param {Object} options - Detection options
 * @param {number[]} options.bitsPerChannel - Array of bits per channel to try (default: [1,2,3,4])
 * @param {boolean} options.quickMode - If true, only tries most common combinations (default: false)
 * @returns {Object} Detection result with params, result, score, and all candidates
 */
export function autoDetectParameters(imageData, options = {}) {
  const {
    bitsPerChannel = [1, 2, 3, 4],
    quickMode = false,
  } = options;

  const possibleBits = quickMode ? [1, 2] : bitsPerChannel;
  
  // Channel combinations (most common first)
  const channelCombinations = quickMode
    ? [
        { useR: true, useG: true, useB: true },
        { useR: true, useG: false, useB: false },
        { useR: true, useG: true, useB: false },
      ]
    : [
        { useR: true, useG: true, useB: true },
        { useR: true, useG: false, useB: false },
        { useR: false, useG: true, useB: false },
        { useR: false, useG: false, useB: true },
        { useR: true, useG: true, useB: false },
        { useR: true, useG: false, useB: true },
        { useR: false, useG: true, useB: true },
      ];
  
  const orders = ['row', 'column'];
  const encodings = ['utf8', 'ascii'];
  
  const candidates = [];
  let bestScore = -1;
  let bestParams = null;
  let bestResult = null;
  
  for (const bits of possibleBits) {
    for (const channels of channelCombinations) {
      for (const order of orders) {
        for (const encoding of encodings) {
          try {
            const decoded = decodeLSB(imageData, {
              bitsPerChannel: bits,
              ...channels,
              order,
            });
            
            // Format bytes to text for scoring
            const formattedText = encoding === 'ascii'
              ? formatBytesAsAscii(decoded.bytes, decoded.hasTail, decoded.tailBits || 0)
              : formatBytesAsUtf8(decoded.bytes, decoded.hasTail, decoded.tailBits || 0);
            
            const score = scoreDecodedText(formattedText, decoded.byteCount, {
              bitsPerChannel: bits,
              ...channels,
              order,
              encoding,
            });
            
            const result = {
              ...decoded,
              text: formattedText,
            };
            
            candidates.push({
              params: { bitsPerChannel: bits, ...channels, order, encoding },
              result,
              score,
            });
            
            // Update best candidate if score is better, or if score is similar but text is shorter
            // (shorter valid text is more likely to be correct)
            if (score > bestScore || 
                (score > bestScore * 0.95 && result.text.length < (bestResult?.text.length || Infinity))) {
              bestScore = score;
              bestParams = { bitsPerChannel: bits, ...channels, order, encoding };
              bestResult = result;
            }
          } catch (e) {
            // Skip errors silently
          }
        }
      }
    }
  }
  
  // Sort candidates by score
  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 2) {
      // If scores differ significantly (more than 2 points), sort by score
      return b.score - a.score;
    }
    
    // For similar scores, use multiple tie-breakers
    
    // 1. Prefer shorter valid text (correct decoding is usually more concise)
    const aCleanLength = a.result.text.replace(/[._]+$/, '').length;
    const bCleanLength = b.result.text.replace(/[._]+$/, '').length;
    if (Math.abs(aCleanLength - bCleanLength) > 20) {
      return aCleanLength - bCleanLength;
    }
    
    // 2. Prefer text with better beginning quality
    const aFirst50 = a.result.text.substring(0, Math.min(50, a.result.text.length));
    const bFirst50 = b.result.text.substring(0, Math.min(50, b.result.text.length));
    let aFirst50Quality = 0;
    let bFirst50Quality = 0;
    for (let i = 0; i < aFirst50.length; i++) {
      const code = aFirst50.charCodeAt(i);
      if (code >= 32 && code <= 126 && code !== 0xFFFD) aFirst50Quality++;
    }
    for (let i = 0; i < bFirst50.length; i++) {
      const code = bFirst50.charCodeAt(i);
      if (code >= 32 && code <= 126 && code !== 0xFFFD) bFirst50Quality++;
    }
    const aFirst50Ratio = aFirst50Quality / Math.max(aFirst50.length, 1);
    const bFirst50Ratio = bFirst50Quality / Math.max(bFirst50.length, 1);
    if (Math.abs(aFirst50Ratio - bFirst50Ratio) > 0.1) {
      return bFirst50Ratio - aFirst50Ratio;
    }
    
    // 3. Prefer fewer channels (simpler is better, all else equal)
    const aChannels = (a.params.useR ? 1 : 0) + (a.params.useG ? 1 : 0) + (a.params.useB ? 1 : 0);
    const bChannels = (b.params.useR ? 1 : 0) + (b.params.useG ? 1 : 0) + (b.params.useB ? 1 : 0);
    if (aChannels !== bChannels) {
      return aChannels - bChannels;
    }
    
    // 4. Prefer ASCII if text is pure ASCII
    const aIsAscii = a.params.encoding === 'ascii' || isPureAscii(a.result.text);
    const bIsAscii = b.params.encoding === 'ascii' || isPureAscii(b.result.text);
    if (aIsAscii && !bIsAscii) return -1;
    if (!aIsAscii && bIsAscii) return 1;
    
    return 0;
  });
  
  // Re-select best candidate from sorted list
  if (candidates.length > 0) {
    bestParams = candidates[0].params;
    bestResult = candidates[0].result;
    bestScore = candidates[0].score;
  }
  
  return {
    params: bestParams,
    result: bestResult,
    score: bestScore,
    candidates: candidates, // Return all candidates
  };
}

/**
 * Checks if text contains only ASCII characters.
 */
function isPureAscii(text) {
  if (!text || text.length === 0) return false;
  const sample = text.substring(0, Math.min(200, text.length));
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code > 127 && code !== 0xFFFD) return false; // Non-ASCII and not replacement char
  }
  return true;
}

/**
 * Scores decoded text to determine if it looks like valid content.
 * 
 * @param {string} text - The decoded text to score
 * @param {number} byteCount - Number of bytes decoded
 * @param {Object} params - Decoding parameters (for context)
 * @returns {number} Score from 0 to 100 (higher is better)
 */
function scoreDecodedText(text, byteCount, params = {}) {
  if (!text || text.length === 0 || byteCount === 0) return -1;
  
  // Focus on first 500 characters where the actual message should be
  const sampleLength = Math.min(text.length, 500);
  const sample = text.substring(0, sampleLength);
  
  // 1. Count replacement characters (strong indicator of wrong encoding)
  const replacementCharCount = (sample.match(/\ufffd/g) || []).length;
  const replacementRatio = replacementCharCount / sampleLength;
  
  // Heavy penalty for replacement characters
  if (replacementRatio > 0.1) return -10; // Too many replacement chars = wrong encoding
  
  // 2. Percentage of printable ASCII characters
  let printableCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) printableCount++;
  }
  const printableRatio = printableCount / sampleLength;
  
  // 3. Check beginning of text (should be readable, not garbage)
  const beginningLength = Math.min(100, sample.length);
  const beginning = sample.substring(0, beginningLength);
  let beginningPrintable = 0;
  let beginningReplacement = 0;
  for (let i = 0; i < beginning.length; i++) {
    const code = beginning.charCodeAt(i);
    if (code >= 32 && code <= 126) beginningPrintable++;
    if (code === 0xFFFD) beginningReplacement++;
  }
  const beginningPrintableRatio = beginningPrintable / beginningLength;
  const beginningReplacementRatio = beginningReplacement / beginningLength;
  
  // If beginning has too many replacement chars or too few printable, penalize heavily
  if (beginningReplacementRatio > 0.05) return -5;
  if (beginningPrintableRatio < 0.5) return -3;
  
  // 4. Percentage of valid UTF-8 characters (not replacement characters)
  const utf8ValidCount = (sample.match(/[^\ufffd]/g) || []).length;
  const utf8ValidRatio = utf8ValidCount / sampleLength;
  
  // 5. Presence of spaces and punctuation (signs of real text)
  const hasSpaces = sample.includes(' ') || sample.includes('\n') || sample.includes('\t');
  const hasPunctuation = /[.,!?;:()\-"'\[\]]/.test(sample);
  
  // 6. Length without tail of dots/underscores (padding)
  // But also check if there's too much padding in the middle
  const cleanLength = sample.replace(/[._]+$/, '').length;
  const tailRatio = (sampleLength - cleanLength) / sampleLength;
  
  // Check for long sequences of dots/underscores in the middle (bad sign)
  const longPaddingPattern = /[._]{20,}/;
  const hasLongPadding = longPaddingPattern.test(sample.substring(0, cleanLength));
  if (hasLongPadding) return -2;
  
  // 7. Entropy (real text has certain entropy, but not too high)
  const entropy = calculateEntropy(sample);
  
  // 8. Ratio of control characters (should be low for text)
  const controlCharCount = (sample.match(/[\x00-\x1F\x7F-\x9F]/g) || []).length;
  const controlCharRatio = controlCharCount / sampleLength;
  
  // 9. Word-like patterns (sequences of letters)
  const wordPatternCount = (sample.match(/[a-zA-Z]{3,}/g) || []).length;
  const wordPatternRatio = wordPatternCount / Math.max(sampleLength / 10, 1);
  
  // 10. Ratio of letters vs other characters (text should have reasonable letter ratio)
  const letterCount = (sample.match(/[a-zA-Z]/g) || []).length;
  const letterRatio = letterCount / sampleLength;
  
  // 11. Check for reasonable text length (too long might indicate wrong parameters)
  // For correct decoding, text should have reasonable length relative to image size
  // This is a soft check - don't penalize too much
  const reasonableLength = sampleLength < 2000; // Reasonable limit
  
  // 12. Check first 50 chars for high quality (real messages start clean)
  const first50 = sample.substring(0, Math.min(50, sample.length));
  let first50Printable = 0;
  let first50Replacement = 0;
  let first50Ascii = 0;
  for (let i = 0; i < first50.length; i++) {
    const code = first50.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      first50Printable++;
      first50Ascii++;
    }
    if (code === 0xFFFD) first50Replacement++;
  }
  const first50Quality = first50Printable / first50.length;
  const first50HasReplacement = first50Replacement > 0;
  const first50AsciiRatio = first50Ascii / first50.length;
  
  // Heavy penalty if first 50 chars have replacement characters
  if (first50HasReplacement) return -15;
  
  // 13. Bonus for ASCII encoding if text is pure ASCII
  let asciiBonus = 0;
  if (params.encoding === 'ascii' && first50AsciiRatio > 0.95) {
    asciiBonus = 5; // Small bonus for correct ASCII encoding
  }
  
  // 14. Check for repetitive patterns (indicates wrong parameters)
  // Only penalize if there are very long repetitive patterns (20+ chars)
  const repetitivePattern = /(.)\1{20,}/; // Same character repeated 20+ times
  const hasRepetitivePattern = repetitivePattern.test(sample);
  if (hasRepetitivePattern) {
    // Heavy penalty but don't return negative immediately
    score -= 30;
  }
  
  // Combined scoring with weights
  let score = 0;
  
  // Base scores (most important)
  score += first50Quality * 35; // First 50 chars quality is critical
  score += beginningPrintableRatio * 20; // Beginning quality is very important
  score += printableRatio * 15;
  score += utf8ValidRatio * 10;
  
  // Structure indicators
  score += (hasSpaces ? 6 : 0);
  score += (hasPunctuation ? 5 : 0);
  score += Math.min(letterRatio * 2, 4); // Reward reasonable letter ratio
  
  // Quality indicators
  score += (1 - tailRatio) * 3;
  score += Math.min(entropy / 6, 3); // Normalize entropy
  score += Math.min(wordPatternRatio, 1) * 3;
  score += (reasonableLength ? 2 : 0);
  score += asciiBonus; // Bonus for correct ASCII encoding
  
  // Penalties
  score -= Math.min(controlCharRatio * 10, 4); // Penalize control chars
  score -= Math.min(replacementRatio * 30, 15); // Heavy penalty for replacement chars
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculates Shannon entropy of a string.
 * 
 * @param {string} str - String to analyze
 * @returns {number} Entropy value (0 to log2(alphabet_size))
 */
function calculateEntropy(str) {
  if (!str || str.length === 0) return 0;
  
  const freq = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  
  let entropy = 0;
  const len = str.length;
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

/**
 * Analyzes LSB patterns in image data using statistical methods.
 * Can help identify if steganography was used and which channels might contain data.
 * 
 * @param {ImageData} imageData - The image data to analyze
 * @param {Object} options - Analysis options
 * @param {number} options.bitsToAnalyze - Number of LSB bits to analyze (1-8, default: 1)
 * @returns {Object} Analysis results with statistics for each channel
 */
export function analyzeLSBPatterns(imageData, options = {}) {
  const { bitsToAnalyze = 1 } = options;
  
  if (bitsToAnalyze < 1 || bitsToAnalyze > 8) {
    throw new Error('bitsToAnalyze must be between 1 and 8');
  }
  
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const totalPixels = width * height;
  
  // Statistics for each channel
  const stats = {
    r: {
      lsbDistribution: new Array(1 << bitsToAnalyze).fill(0),
      valueDistribution: new Array(256).fill(0),
      chiSquare: 0,
      randomness: 0,
    },
    g: {
      lsbDistribution: new Array(1 << bitsToAnalyze).fill(0),
      valueDistribution: new Array(256).fill(0),
      chiSquare: 0,
      randomness: 0,
    },
    b: {
      lsbDistribution: new Array(1 << bitsToAnalyze).fill(0),
      valueDistribution: new Array(256).fill(0),
      chiSquare: 0,
      randomness: 0,
    },
  };
  
  const mask = (1 << bitsToAnalyze) - 1;
  
  // Collect statistics
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // LSB distribution
    stats.r.lsbDistribution[r & mask]++;
    stats.g.lsbDistribution[g & mask]++;
    stats.b.lsbDistribution[b & mask]++;
    
    // Value distribution
    stats.r.valueDistribution[r]++;
    stats.g.valueDistribution[g]++;
    stats.b.valueDistribution[b]++;
  }
  
  // Calculate chi-square test for uniformity
  const expectedFrequency = totalPixels / (1 << bitsToAnalyze);
  
  for (const channel of ['r', 'g', 'b']) {
    const stat = stats[channel];
    
    // Chi-square test
    let chiSquare = 0;
    for (let i = 0; i < stat.lsbDistribution.length; i++) {
      const observed = stat.lsbDistribution[i];
      const expected = expectedFrequency;
      const diff = observed - expected;
      chiSquare += (diff * diff) / expected;
    }
    stat.chiSquare = chiSquare;
    
    // Randomness measure (lower is more random, higher suggests data)
    // For random data, chi-square should be close to degrees of freedom
    const degreesOfFreedom = (1 << bitsToAnalyze) - 1;
    stat.randomness = Math.abs(chiSquare - degreesOfFreedom) / degreesOfFreedom;
  }
  
  // Determine which channels might contain steganographic data
  // Lower randomness suggests more uniform distribution (random data)
  // Higher randomness suggests non-uniform distribution (possibly embedded data)
  const channelScores = {
    r: stats.r.randomness,
    g: stats.g.randomness,
    b: stats.b.randomness,
  };
  
  // Sort channels by randomness (higher = more likely to contain data)
  const sortedChannels = Object.entries(channelScores)
    .sort((a, b) => b[1] - a[1])
    .map(([channel]) => channel);
  
  return {
    stats,
    channelScores,
    suggestedChannels: sortedChannels,
    analysis: {
      bitsAnalyzed: bitsToAnalyze,
      totalPixels,
      expectedFrequency,
    },
  };
}

