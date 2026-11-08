process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '128';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../../frontend/dist');

import { testConnection, closePool, warmPool, startPoolKeepAlive, dbQueryContext, getDbQueryStats, getDbStatus } from './db/pool.js';
import prisma from './db/prisma.js';
import { initSchema } from './db/schema.js';
import { warmQuestionsCache } from './controllers/questions.controller.js';
import { warmAssessmentsCache } from './controllers/assessments.controller.js';

import { apiLimiter, loginLimiter, registerLimiter, submissionLimiter } from './middleware/rateLimiter.js';


import authRoutes from './routes/auth.routes.js';
import candidatesRoutes from './routes/candidates.routes.js';
import assessmentsRoutes from './routes/assessments.routes.js';
import questionsRoutes from './routes/questions.routes.js';
import submissionsRoutes from './routes/submissions.routes.js';
import adminRoutes from './routes/admin.routes.js';
import codeRoutes from './routes/code.routes.js';
import interviewRoutes from './routes/interview.routes.js';
import attemptsRoutes from './routes/attempts.routes.js';
import ttsRoutes from './routes/tts.routes.js';
import sttRoutes from './routes/stt.routes.js';
import { initSttStreamServer } from './routes/stt-stream.routes.js';

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = '0.0.0.0';

// ─── Security: Proxy trust for accurate client IPs ──────────────────────────
// The production deploy sits behind a TLS-terminating reverse proxy (Railway edge),
// so request socket addresses are the proxy's. Trusting a BOUNDED number of hops lets
// the rate limiters see the real client IP without honoring a client-supplied
// X-Forwarded-For. Never use the boolean `true` (that trusts any hop and is spoofable).
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv !== undefined) {
  app.set('trust proxy', trustProxyEnv === 'false' ? false : (parseInt(trustProxyEnv, 10) || 1));
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── Security: Defensive HTTP Headers (Helmet) ──────────────────────────────
// Single global middleware setting CSP, HSTS, X-Frame-Options (DENY),
// X-Content-Type-Options, and Referrer-Policy on every response.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      // Vite/React bootstrap + MediaPipe runtime loaded from CDNs.
      scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com', 'https://ce.judge0.com', 'blob:', 'data:'],
      mediaSrc: ["'self'", 'blob:', 'data:'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
  },
  frameguard: { action: 'deny' },          // X-Frame-Options: DENY
  noSniff: true,                            // X-Content-Type-Options: nosniff
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,         // keep CDN media/model loads working
}));

// ─── Security: Hardened CORS Policy ─────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (curl, mobile apps, health checks)
    if (!origin || allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:'))) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Required for reading HttpOnly refresh token cookies

// ─── Performance: gzip/brotli response compression ───────────────────────────
// Large JSON payloads (the question bank is ~390 KB uncompressed) shrink by
// roughly 85–90%, which matters a lot on slow/mobile links. Server-sent event
// streams must never be compressed/buffered, so they are explicitly excluded.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = res.getHeader('Content-Type');
    if (typeof type === 'string' && type.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

app.use(['/api', '/api/*'], apiLimiter);
app.use(['/api/auth/login', '/auth/login'], loginLimiter);
app.use(['/api/auth/admin/login', '/auth/admin/login'], loginLimiter);
app.use(['/api/auth/register', '/auth/register'], registerLimiter);
app.use(['/api/submissions', '/submissions'], submissionLimiter);

// ─── Performance: Request Duration Logger & Timeout Protection ───────────────
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '25000', 10);
const SLOW_REQ_MS = parseInt(process.env.SLOW_REQ_MS || '500', 10);

app.use((req, res, next) => {
  const start = Date.now();
  // Per-request DB accounting; pool.js adds each query's duration to this store.
  const dbCtx = { count: 0, totalMs: 0 };

  // Set response timeout header / handler
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ success: false, error: 'Gateway timeout. Request took too long to process.' });
    }
  }, REQUEST_TIMEOUT_MS);

  res.on('finish', () => {
    clearTimeout(timer);
    const duration = Date.now() - start;
    if (duration > SLOW_REQ_MS) {
      const dbMs = Math.round(dbCtx.totalMs);
      const dbPart = dbCtx.count > 0 ? ` (db ${dbMs}ms across ${dbCtx.count} queries)` : ' (no db queries)';
      console.warn(`[SLOW REQ] ${req.method} ${req.originalUrl} - ${res.statusCode} in ${duration}ms${dbPart}`);
    }
  });

  dbQueryContext.run(dbCtx, next);
});

// ─── Health Check ─────────────────────────────────────────────────────────────
// Health checks are polled frequently (load balancer, uptime monitors). A real
// DB round-trip on every hit is wasteful and made /health slow; check at most
// once per HEALTH_CACHE_MS and answer immediately from the cached result.
const HEALTH_CACHE_MS = parseInt(process.env.HEALTH_CACHE_MS || '10000', 10);
let healthCheckedAt = 0;
let healthDbOk = null;

const refreshDbHealth = () => {
  const now = Date.now();
  if (now - healthCheckedAt < HEALTH_CACHE_MS) return;
  healthCheckedAt = now;
  testConnection(1, 3000)
    .then((ok) => { healthDbOk = ok; })
    .catch(() => { healthDbOk = false; });
};

const healthHandler = (_req, res) => {
  refreshDbHealth();
  const dbOk = healthDbOk === null ? getDbStatus() : healthDbOk;
  const stats = getDbQueryStats();
  res.json({
    status: 'online',
    service: 'ReadySetJob API',
    version: '1.0.0',
    database: dbOk ? 'connected' : 'offline',
    dbQueries: stats.queries,
    dbSlowQueries: stats.slowQueries,
    timestamp: new Date().toISOString(),
    pid: process.pid,
  });
};
app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

// ─── API Routes (Dual-mounted with and without /api prefix) ───────────────────
app.use(['/api/auth', '/auth'], authRoutes);
app.use(['/api/candidates', '/candidates'], candidatesRoutes);
app.use(['/api/assessments', '/assessments'], assessmentsRoutes);
app.use(['/api/questions', '/questions'], questionsRoutes);
app.use(['/api/submissions', '/submissions'], submissionsRoutes);
app.use(['/api/admin', '/admin'], adminRoutes);
app.use(['/api/code', '/code'], codeRoutes);
app.use(['/api/interview', '/interview'], interviewRoutes);
app.use(['/api/attempts', '/attempts'], attemptsRoutes);
app.use(['/api/tts', '/tts'], ttsRoutes);
app.use(['/api/stt', '/stt'], sttRoutes);

// ─── Static Files & SPA Fallback ─────────────────────────────────────────────
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    // If request accepts HTML (browser navigation), serve React index.html
    if (req.accepts('html')) {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });
} else if (process.env.NODE_ENV !== 'production') {
  // In development, if browser visits localhost:5000/login or / directly, redirect to Vite dev server
  app.get(['/', '/login', '/admin', '/signup', '/dashboard', '/assessments'], (req, res) => {
    res.redirect(`http://localhost:5173${req.url}`);
  });
}

// ─── 404 & Global Error Handler ──────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Startup ─────────────────────────────────────────────────────────────────
const server = app.listen(PORT, HOST, async () => {
  console.log(`\nReadySetJob Backend API -> http://${HOST}:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  const connected = await testConnection();
  if (connected) {
    await initSchema();

    // Open the minimum number of connections up front and keep them warm.
    // Without this, the first request after an idle period pays the full TLS
    // handshake cost of the remote database (often 1–3 seconds).
    const warmed = await warmPool();
    startPoolKeepAlive();

    // Warm Prisma too (it shares the same pg pool).
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`DB pool ready (${warmed} warm connection${warmed === 1 ? '' : 's'}).`);
    } catch (err) {
      console.warn('Prisma warm-up notice:', err.message);
    }

    // Preload the heavy read caches so the first candidate page load is fast
    // even after a cold deploy. These run in parallel and never block requests
    // (the server is already listening at this point).
    Promise.all([warmQuestionsCache(), warmAssessmentsCache()])
      .then(([questionsOk, assessmentsOk]) => {
        console.log(`Cache warm-up: questions=${questionsOk ? 'ready' : 'lazy'}, assessments=${assessmentsOk ? 'ready' : 'lazy'}`);
      })
      .catch((err) => console.warn('Cache warm-up notice:', err.message));

    console.log('\nAPI Routes ready.');
  } else {
    console.warn('\nRunning without database. Check DATABASE_URL in backend/.env\n');
  }

  // Initialize Sarvam Streaming STT WebSocket server
  initSttStreamServer(server);
});

// Keep HTTP connections open longer than the reverse proxy's idle timeout so
// clients do not pay a new TCP/TLS handshake on every burst of API calls.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} received. Initiating graceful shutdown...`);

  server.close(async (err) => {
    if (err) {
      console.error('Error closing HTTP server:', err.message);
    } else {
      console.log('HTTP server closed. No longer accepting new connections.');
    }

    await closePool();
    console.log('Process exiting cleanly.\n');
    process.exit(err ? 1 : 0);
  });

  // Force shutdown after 10 seconds if connections fail to close
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception intercepted:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection intercepted:', reason);
});

export default app;
