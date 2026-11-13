# job-readiness — Tech Stack

> **Status:** 🟢 Live (assumed) | **Last Updated:** 2026-11-12

---

## Backend (Node.js/Express)

| Component | Technology | Version | Notes |
|-----------|------------|---------|-------|
| **Runtime** | Node.js | 20.x | `engines.node >= 20` |
| **Framework** | Express | 4.22.3 | |
| **Database** | PostgreSQL | 15+ | Railway managed |
| **ORM** | Prisma | 7.10.0 | `@prisma/client`, `prisma` CLI |
| **DB Adapter** | `@prisma/adapter-pg` | 7.10.0 | |
| **Cache/Queue** | Redis + BullMQ | 6.2.1 / 6.3.6 | `redis`, `bullmq`, `rate-limit-redis` |
| **Auth** | JWT + bcrypt | 9.0.3 / 5.1.1 | `jsonwebtoken`, `bcrypt`, `bcryptjs` |
| **Email** | Nodemailer | — | |
| **Validation** | Zod | — | Schema validation |
| **Rate Limiting** | express-rate-limit | 8.7.0 | Redis-backed |
| **Security** | Helmet | 7.2.0 | CSP, HSTS, etc. |
| **CORS** | cors | 2.8.6 | Explicit allowlist |
| **Compression** | compression | 1.8.2 | |
| **Cookies** | cookie-parser | 1.4.7 | HttpOnly, Secure, SameSite |
| **WebSockets** | ws | 8.22.1 | |
| **Logging** | console + custom | — | Structured |

---

## Frontend (React/Vite)

| Component | Technology | Version |
|-----------|------------|---------|
| **Runtime** | Node.js | 20.x |
| **Framework** | React | 18.3.1 |
| **Build Tool** | Vite | 5.4.21 |
| **Router** | React Router DOM | 7.18.4 |
| **Styling** | Tailwind CSS | 3.4.19 |
| **Linting** | oxlint | 0.9.10 |
| **Charts** | Chart.js + react-chartjs-2 | 4.5.1 / 5.3.1 |
| **Editor** | Monaco Editor | 0.57.0 |
| **PDF** | pdfjs-dist, jspdf, html2canvas | 3.11 / 4.2 / 1.4 |
| **Proctoring** | MediaPipe Tasks Vision | 1.0.1 |
| **AI Avatar** | HeyGen Streaming Avatar | 2.0.17 |
| **TTS/STT** | ElevenLabs, Sarvam (server-side) | — |
| **Confetti** | canvas-confetti | 1.9.4 |
| **Icons** | Lucide React | 0.453.0 |

---

## AI / External Services

| Service | Purpose | Integration |
|---------|---------|-------------|
| **HeyGen** | Streaming AI Avatar (video/voice) | Backend mints tokens via `HEYGEN_API_KEY` |
| **ElevenLabs** | TTS (lifelike voice) | Backend proxy `/api/tts/speak` |
| **Sarvam** | TTS (Bulbul) + STT (Saaras) | Backend proxy; Hindi-English codemix |
| **Judge0** | Code execution (CE) | `JUDGE0_URL`, `JUDGE0_API_KEY`, `JUDGE0_API_HOST` |
| **Piston** | Alternative code execution | `PISTON_URL` |
| **MediaPipe** | Face/attention proctoring | Runs in browser (frontend) |

---

## Infrastructure

| Component | Provider | Details |
|-----------|----------|---------|
| **Hosting (BE + FE)** | Railway | `incuxai.work@gmail.com` |
| **Database** | Railway PostgreSQL | Persistent volume |
| **Cache/Queue** | Railway Redis | BullMQ + rate limiting |
| **Domain** | Railway custom domains | Per service |
| **SSL** | Railway / Let's Encrypt | Auto |
| **Deploy Trigger** | Git push to `main` | Auto-deploy per service |
| **Health Check** | `/api/health` | 300s timeout (BE) |
| **Email** | SMTP (configurable) | `SMTP_*` env vars |

---

## Key Config Files

| File | Purpose |
|------|---------|
| `backend/package.json` | Backend deps, scripts, Railway config ref |
| `backend/railway.json` | Backend Railway service config |
| `frontend/package.json` | Frontend deps, scripts |
| `frontend/railway.json` | Frontend Railway service config |
| `backend/.env.example` | Backend env template (extensive) |
| `frontend/.env.example` | Frontend env template |
| `backend/prisma/schema.prisma` | Database schema |
| `backend/src/db/schema.js` | Idempotent DB init (source of truth) |
| `package.json` (root) | Orchestrator scripts (`dev`, `build`, `db:*`) |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Internal PostgreSQL (Railway) |
| `DATABASE_PUBLIC_URL` | No | Public proxy URL (dev fallback) |
| `DATABASE_POOL_MAX` | Yes | Connection pool max |
| `DATABASE_POOL_MIN` | Yes | Connection pool min (keep warm) |
| `REDIS_URL` | Yes | Internal Redis (Railway) |
| `REDIS_PUBLIC_URL` | No | Public proxy URL (dev fallback) |
| `JWT_SECRET` | Yes | Auth signing (32+ bytes, `openssl rand -base64 48`) |
| `CORS_ORIGIN` | Yes | Frontend origin (for split deploy) |
| `REFRESH_COOKIE_SAMESITE` | Yes | `none` for split deploy, `strict`/`lax` for same-origin |
| `PORT` | Auto | Railway injects |
| `NODE_ENV` | Yes | `production` |
| `JUDGE0_URL/KEY/HOST` | For code exec | Judge0 CE / RapidAPI |
| `PISTON_URL` | Optional | Self-hosted Piston |
| `HEYGEN_API_KEY/AVATAR_ID/VOICE_ID` | For interviews | HeyGen streaming avatar |
| `ELEVENLABS_API_KEY/VOICE_ID` | For TTS | ElevenLabs |
| `SARVAM_API_KEY/VOICE_ID/*` | For TTS/STT | Sarvam (Bulbul/Saaras) |
| `EMERGENCY_ADMIN_PASSWORDS` | No | Break-glass admin (disabled unless set) |
| `SEED_ADMIN_*` / `TEST_ADMIN_*` | Dev only | Test scripts |

### Frontend (`frontend/.env`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend API base URL (build-time) |
| `VITE_HEYGEN_AVATAR_ID` | Display override (optional) |
| `VITE_HEYGEN_VOICE_ID` | Display override (optional) |

---

## Useful Scripts

### Root (`package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `install:all` | `npm ci` in both | Install all deps |
| `dev` | `concurrently "npm run dev:backend" "npm run dev:frontend"` | Full dev |
| `dev:backend` | `cd backend && npm run dev` | Backend only |
| `dev:frontend` | `cd frontend && npm run dev` | Frontend only |
| `db:generate` | `cd backend && npm run db:generate` | Prisma generate |
| `db:migrate` | `cd backend && npm run db:migrate` | Safe migrate |
| `db:baseline` | `cd backend && npm run db:baseline` | Baseline existing |
| `db:studio` | `cd backend && npm run db:studio` | Prisma Studio |
| `seed` | `cd backend && npm run seed` | Demo data |
| `seed:questions` | `cd backend && npm run seed:questions` | Question bank |
| `questions:validate` | `cd backend && npm run questions:validate` | Validate JSON |
| `build` | `cd frontend && npm run build` | Production build |
| `start` | `cd backend && npm run start` | Single deployable |

### Backend

| Script | Command |
|--------|---------|
| `start` | `node src/index.js` |
| `dev` | `node --watch-path=src src/index.js` |
| `db:generate` | `prisma generate` |
| `db:baseline` | `node scripts/prisma-baseline.js` |
| `db:migrate` | `npm run db:baseline && prisma migrate deploy` |
| `test:heygen` | `node scripts/test_heygen_integration.js` |
| `gen:interview-audio` | `node scripts/generate_interview_audio.mjs` |

### Frontend

| Script | Command |
|--------|---------|
| `dev` | `vite --port 5173` |
| `build` | `vite build` |
| `start` | `node server.mjs` |
| `lint` | `oxlint` |

---

## Version Constraints

### Backend (key deps)

```json
{
  "@prisma/adapter-pg": "7.10.0",
  "@prisma/client": "7.10.0",
  "bcrypt": "5.1.1",
  "bcryptjs": "2.4.3",
  "bullmq": "6.3.6",
  "compression": "1.8.2",
  "cookie-parser": "1.4.7",
  "cors": "2.8.6",
  "dotenv": "16.6.1",
  "express": "4.22.3",
  "express-rate-limit": "8.7.0",
  "helmet": "7.2.0",
  "jsonwebtoken": "9.0.3",
  "pg": "8.23.0",
  "prisma": "7.10.0",
  "rate-limit-redis": "6.0.1",
  "redis": "6.2.1",
  "ws": "^8.22.1"
}
```

### Frontend (key deps)

```json
{
  "@heygen/streaming-avatar": "2.0.17",
  "@mediapipe/tasks-vision": "1.0.1",
  "@monaco-editor/react": "4.7.0",
  "@vitejs/plugin-react": "4.7.0",
  "autoprefixer": "10.5.4",
  "chart.js": "4.5.1",
  "framer-motion": "^14.6.0",
  "gsap": "^3.15.0",
  "lucide-react": "^1.61.0",
  "pdfjs-dist": "3.11.174",
  "postcss": "8.5.26",
  "react": "18.3.1",
  "react-chartjs-2": "5.3.1",
  "react-dom": "18.3.1",
  "react-router-dom": "7.18.4",
  "tailwindcss": "3.4.19",
  "vite": "5.4.21",
  "xlsx": "0.18.5"
}
```

---

*Last verified: 2026-11-12 against actual package.json files.*