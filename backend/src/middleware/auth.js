import jwt from "jsonwebtoken";
import { redisClient, isRedisAvailable } from "../db/redis.js";
import { JWT_SECRET } from "../config/secrets.js";

/**
 * Check if a token has been explicitly revoked (logged out).
 * Uses Redis denylist keyed by jti (JWT ID).
 * Gracefully skips denylist check when Redis is unavailable.
 *
 * A short-lived in-memory cache of "not revoked" results avoids a Redis
 * round-trip on every authenticated request (the Redis proxy can add
 * 100–350ms per call). Revocations still take effect within
 * TOKEN_REVOCATION_CACHE_MS.
 */
const REVOCATION_CACHE_MS = Math.max(0, parseInt(process.env.TOKEN_REVOCATION_CACHE_MS || '15000', 10));
const MAX_REVOCATION_CACHE_ENTRIES = 5000;
const notRevokedCache = new Map(); // jti -> expiresAt (ms)

const isTokenRevoked = async (jti) => {
  if (!jti || !isRedisAvailable()) return false;

  const now = Date.now();
  const cachedUntil = notRevokedCache.get(jti);
  if (cachedUntil && cachedUntil > now) return false;

  try {
    const exists = await redisClient.exists("denylist:" + jti);
    if (exists === 1) {
      notRevokedCache.delete(jti);
      return true;
    }

    if (REVOCATION_CACHE_MS > 0) {
      if (notRevokedCache.size >= MAX_REVOCATION_CACHE_ENTRIES) {
        for (const [key, expiresAt] of notRevokedCache) {
          if (expiresAt <= now) notRevokedCache.delete(key);
        }
        if (notRevokedCache.size >= MAX_REVOCATION_CACHE_ENTRIES) notRevokedCache.clear();
      }
      notRevokedCache.set(jti, now + REVOCATION_CACHE_MS);
    }
    return false;
  } catch { return false; }
};

/**
 * Strict authentication � rejects requests with no or invalid token.
 * Also checks Redis denylist for revoked tokens (logout support).
 */
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if this token has been explicitly revoked (e.g. via logout)
    if (await isTokenRevoked(decoded.jti)) {
      return res.status(401).json({ error: "Token has been revoked. Please log in again." });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
};

/**
 * Optional authentication � attaches user to req if a valid token is present,
 * but does not block the request if missing or invalid.
 */
export const optionalAuthToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!await isTokenRevoked(decoded.jti)) {
        req.user = decoded;
      }
    } catch { /* ignore in optional mode */ }
  }
  next();
};
