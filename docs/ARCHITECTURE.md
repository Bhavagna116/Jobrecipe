# job-readiness — Architecture & Design

> **Status:** 🟢 Live (assumed) | **Last Updated:** 2026-11-12 | **Audience:** Developers, AI agents, operators

---

## 1. System Overview

**JobRecipe** is a career-readiness platform: aptitude assessments, coding tests, and AI mock interviews with proctoring. Built for large student cohorts (~3,000 concurrent).

- **One project, one frontend, one backend, one database**
- **Frontend:** React + Vite (the only UI) → `http://localhost:5173`
- **Backend:** Node/Express + Prisma (the only API) → `http://localhost:5000`
- **Database:** PostgreSQL (schema = `backend/prisma/schema.prisma`)
- **AI Features:** MediaPipe (face/attention proctoring in browser), HeyGen (avatar), ElevenLabs/Sarvam (TTS/STT), Judge0/Piston (code execution)
- **No separate AI service to deploy** — all AI runs in frontend or backend

---

## 2. Repository Structure

```
D:\code\job-readiness\                        ← Local path
├── backend/                                  ← Node/Express + Prisma API
│   ├── src/
│   │   ├── index.js                          ← Entry point
│   │   ├── config/                           ← Env validation, DB, Redis
│   │   ├── controllers/                      ← Route handlers
│   │   ├── middleware/                       ← Auth, rate limit, validation
│   │   ├── routes/                           ← API routes
│   │   ├── services/                         ← Business logic (AI, email, etc.)
│   │   ├── utils/                            ← Helpers
│   │   └── db/
│   │       ├── schema.js                     ← Idempotent schema init (CREATE TABLE IF NOT EXISTS)
│   │       └── prisma/                       ← Prisma client + schema
│   ├── prisma/
│   │   └── schema.prisma                     ← PostgreSQL schema
│   ├── scripts/                              ← Seed, migrate, validate, test
│   ├── Dockerfile                            ← Railway Docker build
│   ├── railway.json                          ← Railway service config
│   ├── package.json
│   └── .env.example
├── frontend/                                 ← React + Vite
│   ├── src/
│   │   ├── components/                       ← UI components
│   │   ├── pages/                            ← Route pages
│   │   ├── services/                         ← API client (api.js)
│   │   ├── hooks/                            ← Custom hooks
│   │   ├── store/                            ← State (Zustand/Context)
│   │   └── utils/
│   ├── server.mjs                            ← Production static server (SPA fallback)
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── .env.example
├── docs/
│   ├── college-portal-design.md
│   └── security/                             ← 14 security plans + reports
├── security/
│   ├── plans/                                ← 14 security control plans
│   ├── reports/                              ← 14 security audit reports
│   └── AUDIT_SUMMARY.md
├── package.json                              ← Root orchestrator scripts
├── AGENTS.md                                 ← Security rules for AI agents
└── .git
```

---

## 3. Architecture Design

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              JOBRECIPE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────────────────────┐   │
│  │    FRONTEND         │         │           BACKEND                   │   │
│  │  (React + Vite)     │         │     (Node/Express + Prisma)         │   │
│  │  http://localhost:5173│         │     http://localhost:5000         │   │
│  │                     │         │                                     │   │
│  │  - Assessments UI   │◄──────►│  - REST API (/api/*)                │   │
│  │  - AI Interview     │         │  - Prisma ORM                     │   │
│  │  - Proctoring       │         │  - Redis + BullMQ (queue)         │   │
│  │  - MediaPipe        │         │  - JWT Auth (HttpOnly cookies)    │   │
│  │    (face/attention) │         │  - Helmet + CORS + Rate Limit     │   │
│  └─────────────────────┘         └──────────────┬────────────────────┘   │
│                                                  │                        │
│                                                  ▼                        │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        INFRASTRUCTURE                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │  │
│  │  │ PostgreSQL  │  │   Redis     │  │  Judge0/    │  │  HeyGen   │  │  │
│  │  │  (Railway)  │  │  (Railway)  │  │  Piston     │  │  ElevenLabs│  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │  Sarvam   │  │  │
│  │                                                └───────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Deployment Architecture (Railway — Two Services)

| Service | Root Directory | Build | Start | Health Check |
|---------|----------------|-------|-------|--------------|
| **Backend (API)** | `backend/` | `npx prisma generate` | `node src/index.js` | `/api/health` (300s timeout) |
| **Frontend** | `frontend/` | `npm run build` | `node server.mjs` | — |

**Split-Deploy Gotchas (Handled):**
- Refresh-token cookie: `SameSite=none` (with HTTPS) for cross-domain
- CORS: Explicit frontend origin, `credentials: true`
- `VITE_API_URL` points to backend at build time

---

## 4. Database Design (Prisma / PostgreSQL)

### 4.1 Key Models (from `backend/prisma/schema.prisma`)

```prisma
// Core user & auth
model User { ... }
model OtpVerification { ... }

// Assessments & questions
model Assessment { ... }
model Question { ... }
model QuestionOption { ... }

// Submissions & scoring
model Submission { ... }
model SubmissionAnswer { ... }
model CodingSubmission { ... }

// Interviews
model InterviewSession { ... }
model InterviewQuestion { ... }
model InterviewResponse { ... }

// College portals
model College { ... }
model CollegePortal { ... }

// System
model AuditLog { ... }
```

### 4.2 Database Safety (Critical)

> **The schema is created/upgraded idempotently at startup** by `backend/src/db/schema.js` (`initSchema`) using `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. Prisma is only used to generate the query client — its migration folder is a **one-time baseline**, not the source of truth.

**Never run against production:**
- `prisma migrate reset`
- `prisma migrate dev`
- `prisma db push --force-reset`

**Safe commands:**
```bash
npm run db:baseline   # Marks existing baseline migration as applied (no data touched)
npm run db:migrate    # Baseline + prisma migrate deploy (applies ONLY new migrations)
```

---

## 5. Key Features & Data Flow

### 5.1 Assessments
- MCQ + coding questions
- Timed, proctored (MediaPipe face/attention in browser)
- Submissions queued via **Redis + BullMQ** for burst handling (3K+ concurrent)

### 5.2 AI Mock Interviews
- **HeyGen** streaming avatar (video/voice)
- **ElevenLabs / Sarvam** TTS/STT (server-side only)
- Interview flow & scoring in Node backend
- MediaPipe proctoring runs in frontend

### 5.3 Code Execution
- **Judge0** (via RapidAPI) or **Piston** (self-hosted)
- Configurable concurrency limits

---

## 6. API Endpoints (Selected)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Login (sets HttpOnly refresh cookie) |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `GET` | `/api/auth/me` | Current user |
| `GET` | `/api/assessments` | List assessments |
| `POST` | `/api/assessments/:id/start` | Start attempt |
| `POST` | `/api/submissions` | Submit answers |
| `GET` | `/api/submissions/:id` | Get results |
| `POST` | `/api/interview/start` | Start AI interview |
| `POST` | `/api/interview/avatar/token` | Get HeyGen streaming token |
| `POST` | `/api/tts/speak` | TTS proxy (ElevenLabs/Sarvam) |

---

## 7. Security Design

| Control | Implementation |
|---------|----------------|
| **Secrets** | Server-side only; never `VITE_*`; `.env.example` templates only |
| **Auth** | JWT (access + refresh); HttpOnly, Secure, SameSite cookies |
| **Authorization** | Ownership checks (`current_user.id == resource.owner_id`) separate from auth |
| **Admin** | Role verification, 403 for non-admin |
| **SQL Injection** | Parameterized queries / Prisma only |
| **XSS** | No `dangerouslySetInnerHTML` without DOMPurify |
| **File Uploads** | Magic bytes validation, UUID rename, off-origin storage |
| **SSRF** | Block private IPs, allow only http/https, resolve & check IP |
| **Rate Limiting** | Login/register/password reset endpoints |
| **CORS** | Explicit allowlist, no wildcard with credentials |
| **Security Headers** | Helmet: CSP, HSTS, X-Frame-Options, etc. |
| **Payments** | Stripe webhook signature verification, idempotency |

---

## 8. Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Backend Runtime** | Node.js | 20.x |
| **Backend Framework** | Express | 4.x / 5.x |
| **Database** | PostgreSQL | 15+ (Railway) |
| **ORM** | Prisma | 7.x |
| **Queue/Cache** | Redis + BullMQ | 6.x / 6.3 |
| **Auth** | JWT (jsonwebtoken) + bcrypt | 9.x / 5.x |
| **Email** | Nodemailer | — |
| **Validation** | Zod | — |
| **Rate Limit** | express-rate-limit + rate-limit-redis | 8.x / 6.x |
| **Security** | Helmet, CORS, compression | 7.x / 2.x |
| **Frontend Runtime** | Node.js | 20.x |
| **Frontend Framework** | React | 18.3 |
| **Build Tool** | Vite | 5.4 |
| **Styling** | Tailwind CSS | 3.4 |
| **Linting** | oxlint | 0.9 |
| **Proctoring** | MediaPipe Tasks Vision | 1.0 |
| **AI Avatar** | HeyGen Streaming Avatar | 2.0 |
| **TTS/STT** | ElevenLabs, Sarvam | — |
| **Code Execution** | Judge0 (RapidAPI) / Piston | — |
| **Charts** | Chart.js, react-chartjs-2 | 4.5 / 5.3 |
| **Editor** | Monaco Editor | 0.57 |
| **PDF** | pdfjs-dist, jspdf, html2canvas | — |
| **Deploy** | Railway (Docker/Nixpacks) | — |

---

## 9. Deployment

### 9.1 Local Development

```bash
# 1. Create Postgres DB (e.g., jobrecipe)
# 2. Copy env templates
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
# Fill: DATABASE_URL, JWT_SECRET (backend); VITE_API_URL (frontend)

# 3. Install & setup
npm run install:all
npm run db:generate
npm run db:migrate
npm run seed  # optional

# 4. Run
npm run dev  # backend :5000 + frontend :5173
```

### 9.2 Production (Railway — Two Services)

**Backend Service (Root: `backend/`):**
- Dockerfile build
- Start: `node src/index.js`
- Health: `/api/health`
- Env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN`, `REFRESH_COOKIE_SAMESITE=none`

**Frontend Service (Root: `frontend/`):**
- Dockerfile build
- Start: `node server.mjs` (serves `dist/` with SPA fallback)
- Env: `VITE_API_URL=https://<backend-url>/api` (build-time)

### 9.3 Single-Deploy Alternative

```bash
npm run build   # builds frontend/dist
npm run start   # backend serves API + frontend/dist together
```

---

## 10. Where to Find Things (Local)

| What | Local Path |
|------|------------|
| Project root | `D:\code\job-readiness\` |
| Backend entry | `backend/src/index.js` |
| Frontend entry | `frontend/src/main.jsx` |
| Prisma schema | `backend/prisma/schema.prisma` |
| DB init script | `backend/src/db/schema.js` |
| Security docs | `security/` (plans + reports) |
| API client | `frontend/src/services/api.js` |
| Auth middleware | `backend/src/middleware/auth.middleware.js` |
| Rate limiting | `backend/src/middleware/rateLimit.middleware.js` |
| AI services | `backend/src/services/` |
| Railway config (BE) | `backend/railway.json` |
| Railway config (FE) | `frontend/railway.json` |
| Root scripts | `package.json` |

---

## 11. Access & Contacts

| Role | Contact | Notes |
|------|---------|-------|
| **Owner** | ❓ Unknown | Ask Ashish |
| **GitHub** | `incuxaiwork/job-readiness` (public) | |
| **Railway** | `incuxai.work@gmail.com` | Backend + Frontend services |
| **Production URLs** | ❓ Unknown | Verify in Railway dashboard |

---

*Generated from README.md, AGENTS.md, package.json files, and code inspection. Last verified: 2026-11-12.*