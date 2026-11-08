/**
 * Sarvam AI service — Bulbul text-to-speech and Saaras speech-to-text.
 *
 * The SARVAM_API_KEY lives ONLY in the server environment and is never exposed
 * to the browser: the frontend talks to our own /api/tts and /api/stt proxies.
 *
 * Env (backend/.env):
 *   SARVAM_API_KEY        (required to enable)
 *   SARVAM_VOICE_ID       (TTS speaker; default: shubh)
 *   SARVAM_LANGUAGE_CODE  (BCP-47; default: en-IN)
 *   SARVAM_TTS_MODEL      (default: bulbul:v3)
 *   SARVAM_STT_MODEL      (optional; omit to use Sarvam's default Saaras model)
 *   SARVAM_STT_MODE       (optional; transcribe | translate | verbatim | translit | codemix)
 */
import WebSocket from 'ws';

const TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech/stream';
const STT_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
// Legacy Saaras streaming endpoint. It expects JSON audio frames
// ({"audio":{"data": "<base64>", ...}}) and the Api-Subscription-Key header.
const STT_STREAM_ENDPOINT = 'wss://api.sarvam.ai/speech-to-text/ws';

const DEFAULT_VOICE_ID = 'shubh';
const DEFAULT_LANGUAGE_CODE = 'en-IN';
const DEFAULT_TTS_MODEL = 'bulbul:v3';
const DEFAULT_STT_MODEL = 'saaras:v4';

const apiKey = () => process.env.SARVAM_API_KEY;
const voiceId = () => process.env.SARVAM_VOICE_ID || DEFAULT_VOICE_ID;
const ttsModel = () => process.env.SARVAM_TTS_MODEL || DEFAULT_TTS_MODEL;
const defaultLanguageCode = () => process.env.SARVAM_LANGUAGE_CODE || DEFAULT_LANGUAGE_CODE;

/**
 * Resolve the Sarvam speaker id for an interviewer voice gender.
 * Male candidates get a female voice and vice-versa, so the mapping is done by
 * the requested interviewer voice (not the candidate's own gender).
 */
export const voiceForGender = (voiceGender) => {
  const g = String(voiceGender || '').toLowerCase();
  if (g === 'female') return process.env.SARVAM_VOICE_FEMALE || 'ritu';
  if (g === 'male') return process.env.SARVAM_VOICE_MALE || 'shubh';
  return voiceId();
};

const EXT_BY_MIME = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

export const isSarvamConfigured = () => Boolean(apiKey());

const notConfigured = () => {
  const err = new Error('Sarvam is not configured.');
  err.code = 'NOT_CONFIGURED';
  return err;
};

/**
 * Build Sarvam streaming STT WebSocket URL with query parameters.
 * The API key is NOT put in the URL — it is sent as the
 * `Api-Subscription-Key` header when the socket is opened.
 */
export const buildSttStreamUrl = (params = {}) => {
  const url = new URL(STT_STREAM_ENDPOINT);
  const lang = params.languageCode || defaultLanguageCode();
  // The legacy AsyncAPI documents `language-code`; the guides use
  // `language_code`. Send both so either parser accepts the connection.
  url.searchParams.set('language-code', lang);
  url.searchParams.set('language_code', lang);
  url.searchParams.set('model', params.model || process.env.SARVAM_STT_MODEL || DEFAULT_STT_MODEL);
  url.searchParams.set('mode', params.mode || process.env.SARVAM_STT_MODE || 'transcribe');
  url.searchParams.set('sample_rate', String(params.sampleRate || 16000));
  url.searchParams.set('input_audio_codec', params.inputAudioCodec || 'pcm_s16le');
  url.searchParams.set('high_vad_sensitivity', 'true');
  url.searchParams.set('flush_signal', 'true');
  if (params.vadSignals) url.searchParams.set('vad_signals', 'true');
  return url.toString();
};

/**
 * Create a Sarvam streaming STT connection.
 * Returns a small wrapper with send/flush/close methods.
 */
export const createSttStream = (params = {}, handlers = {}) => {
  if (!apiKey()) throw notConfigured();

  const wsUrl = buildSttStreamUrl(params);
  const sampleRate = params.sampleRate || 16000;
  const ws = new WebSocket(wsUrl, {
    headers: { 'Api-Subscription-Key': apiKey() },
  });

  ws.on('open', () => {
    console.log('[Sarvam STT Stream] Connected');
    handlers.onopen?.();
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handlers.onmessage?.(data);
    } catch (err) {
      console.warn('[Sarvam STT Stream] Failed to parse message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('[Sarvam STT Stream] Error:', err.message || err);
    handlers.onerror?.(err);
  });

  ws.on('close', (code, reason) => {
    console.log('[Sarvam STT Stream] Closed:', code, reason?.toString?.() || '');
    handlers.onclose?.({ code, reason: reason?.toString?.() || '' });
  });

  return {
    // Raw 16-bit little-endian mono PCM in, JSON+base64 frames out.
    send: (audioChunk) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      const buf = Buffer.isBuffer(audioChunk) ? audioChunk : Buffer.from(audioChunk);
      if (!buf.length) return false;
      ws.send(JSON.stringify({
        audio: {
          data: buf.toString('base64'),
          sample_rate: sampleRate,
          encoding: 'audio/wav',
        },
      }));
      return true;
    },
    flush: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'flush' }));
        return true;
      }
      return false;
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Client closed');
      }
    },
    get readyState() {
      return ws.readyState;
    },
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
};

/**
 * Synthesize speech via Sarvam Bulbul.
 * Returns { audio: Buffer, contentType: 'audio/mpeg' }.
 */
export const synthesizeSpeech = async (text, { languageCode, speaker } = {}) => {
  if (!apiKey()) throw notConfigured();

  const lang = languageCode || defaultLanguageCode();
  const chosenSpeaker = speaker || voiceId();
  const payload = (languageField) => JSON.stringify({
    text,
    [languageField]: lang,
    speaker: chosenSpeaker,
    model: ttsModel(),
    output_audio_codec: 'mp3',
  });

  const request = (languageField) => fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey(),
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: payload(languageField),
  });

  // Sarvam's docs use both `language_code` and `target_language_code`.
  let response = await request('language_code');
  if (response.status === 400 || response.status === 422) {
    response = await request('target_language_code');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Sarvam TTS failed (${response.status}): ${detail.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  const arrayBuffer = await response.arrayBuffer();
  return { audio: Buffer.from(arrayBuffer), contentType: 'audio/mpeg' };
};

/**
 * Transcribe a short audio clip via Sarvam Saaras.
 * `audio` is a Buffer; pass the original MIME type so Sarvam decodes it.
 * Returns { transcript, languageCode }.
 */
export const transcribeAudio = async (audio, { languageCode, mimeType = 'audio/webm', filename, mode } = {}) => {
  if (!apiKey()) throw notConfigured();

  const lang = languageCode || defaultLanguageCode();
  const type = String(mimeType).split(';')[0].trim() || 'audio/webm';
  const name = filename || `audio.${EXT_BY_MIME[type] || 'webm'}`;
  const sttMode = mode || process.env.SARVAM_STT_MODE;

  const form = new FormData();
  form.append('file', new Blob([audio], { type }), name);
  form.append('language_code', lang);
  if (process.env.SARVAM_STT_MODEL) form.append('model', process.env.SARVAM_STT_MODEL);
  // Optional Saaras mode: transcribe | translate | verbatim | translit | codemix
  if (sttMode) form.append('mode', sttMode);

  const response = await fetch(STT_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey(),
      'Accept': 'application/json',
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Sarvam STT failed (${response.status}): ${detail.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json().catch(() => ({}));
  return {
    transcript: typeof data.transcript === 'string' ? data.transcript.trim() : '',
    languageCode: data.language_code || lang,
  };
};
