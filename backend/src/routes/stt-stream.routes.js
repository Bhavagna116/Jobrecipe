import { WebSocketServer, WebSocket } from 'ws';
import { isSarvamConfigured, createSttStream } from '../services/sarvamService.js';

/**
 * Initialize the WebSocket server that proxies browser audio to Sarvam's
 * streaming speech-to-text endpoint.
 *
 * Browser -> us: raw 16-bit little-endian mono PCM binary frames (16 kHz),
 *                 or a JSON text frame {"type":"flush"} to force finalization.
 * Us -> browser: {"type":"ready"|"transcript"|"error", ...}
 */
export const initSttStreamServer = (server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url?.startsWith('/api/stt/stream')) {
      return;
    }

    // WebSocket clients cannot easily set headers, so the JWT rides in the query.
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const jwt = await import('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
      req.user = jwt.default.verify(token, JWT_SECRET);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    console.log('[STT Stream] New client connected');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const languageCode = url.searchParams.get('language_code')
      || url.searchParams.get('language-code')
      || 'en-IN';
    const model = url.searchParams.get('model') || process.env.SARVAM_STT_MODEL || 'saaras:v4';
    const mode = url.searchParams.get('mode') || process.env.SARVAM_STT_MODE || 'transcribe';
    const sampleRate = url.searchParams.get('sample_rate')
      ? parseInt(url.searchParams.get('sample_rate'), 10)
      : 16000;

    const sendJson = (payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    if (!isSarvamConfigured()) {
      sendJson({ type: 'error', message: 'Sarvam STT is not configured on the server.' });
      ws.close(1011, 'Sarvam not configured');
      return;
    }

    let sarvamStream;
    try {
      sarvamStream = createSttStream(
        { languageCode, model, mode, sampleRate, inputAudioCodec: 'pcm_s16le' },
        {
          onopen: () => {
            sendJson({ type: 'ready', message: 'Sarvam streaming STT connected' });
          },
          onmessage: (msg) => {
            const type = msg?.type;
            const payload = msg?.data || {};

            if (type === 'data') {
              const transcript = typeof payload.transcript === 'string' ? payload.transcript.trim() : '';
              if (transcript) {
                sendJson({
                  type: 'transcript',
                  transcript,
                  languageCode: payload.language_code || null,
                });
              }
              return;
            }

            if (type === 'events') {
              sendJson({ type: 'event', signal: payload.signal_type || null });
              return;
            }

            if (type === 'error') {
              sendJson({
                type: 'error',
                message: payload.error || payload.message || 'Sarvam stream error',
                code: payload.code || null,
              });
            }
          },
          onerror: (err) => {
            console.error('[STT Stream] Sarvam error:', err?.message || err);
            sendJson({ type: 'error', message: err?.message || 'Sarvam stream error' });
          },
          onclose: ({ code, reason }) => {
            console.log('[STT Stream] Sarvam closed:', code, reason);
            sendJson({ type: 'closed', code, reason });
          },
        }
      );
    } catch (err) {
      console.error('[STT Stream] Failed to create Sarvam stream:', err?.message || err);
      sendJson({ type: 'error', message: 'Failed to connect to Sarvam.' });
      ws.close(1011, 'Sarvam connection failed');
      return;
    }

    ws.on('message', (data, isBinary) => {
      if (!sarvamStream) return;

      if (isBinary) {
        // Keep the browser -> server hop cheap: raw PCM, encoded once in the service.
        sarvamStream.send(Buffer.isBuffer(data) ? data : Buffer.from(data));
        return;
      }

      // Control frames (flush) arrive as text.
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.type === 'flush') sarvamStream.flush();
      } catch {
        // Ignore malformed control frames.
      }
    });

    ws.on('close', () => {
      console.log('[STT Stream] Client disconnected');
      try { sarvamStream?.close(); } catch { }
    });

    ws.on('error', (err) => {
      console.error('[STT Stream] WebSocket error:', err?.message || err);
      try { sarvamStream?.close(); } catch { }
    });
  });

  console.log('[STT Stream] WebSocket server initialized on /api/stt/stream');
  return wss;
};

export default { initSttStreamServer };
