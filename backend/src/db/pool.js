import pkg from 'pg';
const { Pool } = pkg;
import { AsyncLocalStorage } from 'node:async_hooks';
import dotenv from 'dotenv';
dotenv.config();
import { databaseUrl } from '../config/urls.js';

const connectionString = (typeof databaseUrl === 'function' ? databaseUrl() : null) || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

if (!connectionString) {
  console.warn('DATABASE_URL/DATABASE_PUBLIC_URL is not set. Running in local fallback mode without PostgreSQL.');
}

const isProduction = process.env.NODE_ENV === 'production';
const isLocalhost = Boolean(connectionString) && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'));

// ─── Tunables ────────────────────────────────────────────────────────────────
// The database is often reached through a public proxy (Railway) where opening a
// new TLS connection costs 1–3 seconds. Keeping a few connections open is the
// single biggest latency win, so `min` is deliberately > 0 and the idle timeout
// is much longer than the pg default (10s).
const POOL_MIN = Math.max(0, parseInt(process.env.DATABASE_POOL_MIN || '2', 10));
const POOL_MAX = Math.max(POOL_MIN, parseInt(process.env.DATABASE_POOL_MAX || '20', 10));
const CONNECTION_TIMEOUT_MS = parseInt(process.env.DATABASE_CONNECTION_TIMEOUT || process.env.DB_CONNECTION_TIMEOUT || '10000', 10);
// node-postgres has no real `min` support, so connections are kept warm by the
// keep-alive below. A long idle timeout stops the pool from closing them
// between requests; the keep-alive interval must be shorter than this.
const IDLE_TIMEOUT_MS = parseInt(process.env.DATABASE_IDLE_TIMEOUT || process.env.DB_IDLE_TIMEOUT || '300000', 10);
const KEEPALIVE_MS = parseInt(process.env.DATABASE_KEEPALIVE_MS || '30000', 10);
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || '250', 10);

// TLS policy for remote database connections.
// - Localhost: no TLS.
// - Remote: TLS ON with certificate validation ENABLED by default. A private CA may be
//   pinned via DATABASE_SSL_CA (PEM contents or a path). Verification may only be
//   disabled explicitly and deliberately with DATABASE_SSL_REJECT_UNAUTHORIZED=false.
const buildSslConfig = () => {
  if (isLocalhost) return false;
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
  const ca = process.env.DATABASE_SSL_CA;
  return { rejectUnauthorized, ...(ca ? { ca } : {}) };
};

/**
 * Per-request DB timing context. index.js runs each request inside this store so
 * a slow request log can say how much of the time was spent in Postgres.
 */
export const dbQueryContext = new AsyncLocalStorage();

const queryStats = { queries: 0, slowQueries: 0, totalQueryMs: 0 };
export const getDbQueryStats = () => ({ ...queryStats });

export const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: buildSslConfig(),
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
      min: POOL_MIN,
      max: POOL_MAX,
    })
  : null;

if (pool) {
  pool.on('error', (err, client) => {
    console.error('PostgreSQL idle client error (handled):', err.message);
  });

  pool.on('connect', (client) => {
    client.on('error', (err) => {
      console.error('PostgreSQL client connection error (handled):', err.message);
    });
  });

  // Instrument every pool.query so we can attribute latency to the database.
  // (Queries run on clients obtained via pool.connect() are not instrumented,
  // which keeps keep-alive probes out of the slow-query log.)
  const originalQuery = pool.query.bind(pool);
  pool.query = async (...args) => {
    const startedAt = process.hrtime.bigint();
    try {
      return await originalQuery(...args);
    } finally {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      queryStats.queries += 1;
      queryStats.totalQueryMs += ms;

      const ctx = dbQueryContext.getStore();
      if (ctx) {
        ctx.count += 1;
        ctx.totalMs += ms;
      }

      if (ms >= SLOW_QUERY_MS) {
        queryStats.slowQueries += 1;
        const first = args[0];
        const text = typeof first === 'string'
          ? first
          : (first && typeof first === 'object' && typeof first.text === 'string' ? first.text : 'query');
        console.log(`[SLOW QUERY] ${ms.toFixed(0)}ms :: ${text.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
      }
    }
  };
} else {
  console.warn('DATABASE_URL is not set in backend/.env. Database features will run in mock mode.');
}

let isConnected = false;
export const getDbStatus = () => isConnected;

/**
 * Open `count` connections and release them back to the pool so the first real
 * request does not pay the cold-connect cost.
 */
export const warmPool = async (count = POOL_MIN) => {
  if (!pool) return 0;
  const clients = [];
  try {
    const target = Math.max(1, Math.min(count, POOL_MAX));
    for (let i = 0; i < target; i++) {
      clients.push(await pool.connect());
    }
    return clients.length;
  } catch (err) {
    console.warn('Pool warm-up notice:', err.message);
    return clients.length;
  } finally {
    clients.forEach((client) => {
      try { client.release(); } catch { /* already released */ }
    });
  }
};

let keepAliveTimer = null;
/**
 * Ping an idle connection periodically so the upstream proxy does not silently
 * drop it. Uses a raw client so probes are not logged as slow queries.
 */
export const startPoolKeepAlive = (intervalMs = Math.min(KEEPALIVE_MS, Math.max(5000, Math.floor(IDLE_TIMEOUT_MS / 3)))) => {
  if (!pool || keepAliveTimer || intervalMs <= 0) return;
  keepAliveTimer = setInterval(async () => {
    // Keep at least POOL_MIN connections warm. The previous version skipped
    // when the pool was empty, so after an idle period every request paid a
    // cold connect (often 1–3s through the proxy).
    const target = Math.max(1, Math.min(POOL_MIN || 1, POOL_MAX));
    const clients = [];
    try {
      for (let i = 0; i < target; i++) {
        clients.push(await pool.connect());
      }
      await Promise.all(clients.map(client => client.query('SELECT 1')));
    } catch (err) {
      console.warn('[DB keepalive] notice:', err.message);
    } finally {
      clients.forEach((client) => {
        try { client.release(); } catch { /* noop */ }
      });
    }
  }, intervalMs);
  keepAliveTimer.unref?.();
};

export const stopPoolKeepAlive = () => {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
};

export const testConnection = async (retries = 3, timeoutMs = 8000) => {
  if (!pool) {
    isConnected = false;
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)),
      ]);
      const res = await client.query('SELECT NOW() as time, current_database() as db');
      client.release();
      console.log(`PostgreSQL connected -> database: "${res.rows[0].db}" at ${res.rows[0].time}`);
      isConnected = true;
      return true;
    } catch (err) {
      console.error(`PostgreSQL connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  isConnected = false;
  return false;
};

export const closePool = async () => {
  try {
    stopPoolKeepAlive();
    if (pool) {
      await pool.end();
      console.log('PostgreSQL connection pool closed gracefully.');
    }
  } catch (err) {
    console.error('Error closing PostgreSQL pool:', err.message);
  }
};
