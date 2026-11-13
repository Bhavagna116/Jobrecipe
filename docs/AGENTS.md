# job-readiness — AGENTS.md

> **Operating manual for AI coding agents working in this repository.**
> Read this **first**, before touching any code.
>
> This project has a **comprehensive security audit** in `security/` (14 plans + 14 reports + summary).
> The rules below are non-negotiable and derived from that audit.

---

## 1. What This Product Is

**JobRecipe** — Career-readiness platform: aptitude assessments, coding tests, and AI mock interviews with proctoring.

- **Frontend:** React + Vite (only UI) → `http://localhost:5173`
- **Backend:** Node/Express + Prisma (only API) → `http://localhost:5000`
- **Database:** PostgreSQL (schema = `backend/prisma/schema.prisma`)
- **AI Features:** MediaPipe (face/attention in browser), HeyGen (avatar), ElevenLabs/Sarvam (TTS/STT), Judge0/Piston (code execution)
- **No separate AI service** — all AI runs in frontend or backend
- **Scale target:** ~3,000 concurrent students (exam bursts)

---

## 2. Repo Layout

```
job-readiness/
├── backend/
│   ├── src/
│   │   ├── index.js                    ← Entry
│   │   ├── config/                     ← Env, DB, Redis
│   │   ├── controllers/                ← Route handlers
│   │   ├── middleware/                 ← Auth, rate limit, validation
│   │   ├── routes/                     ← API routes
│   │   ├── services/                   ← Business logic (AI, email, etc.)
│   │   ├── utils/
│   │   └── db/
│   │       ├── schema.js               ← Idempotent DB init (CREATE TABLE IF NOT EXISTS)
│   │       └── prisma/                 ← Prisma client + schema
│   ├── prisma/schema.prisma            ← PostgreSQL schema
│   ├── scripts/                        ← Seed, migrate, validate, test
│   ├── Dockerfile, railway.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/, pages/, services/, hooks/, store/, utils/
│   ├── server.mjs                      ← Prod static server (SPA fallback)
│   ├── package.json, vite.config.js, tailwind.config.js
│   └── .env.example
├── docs/college-portal-design.md
├── security/                           ← 14 plans + 14 reports + summary
│   ├── plans/                          ← Security control plans
│   ├── reports/                        ← Audit reports
│   └── AUDIT_SUMMARY.md
├── package.json                        ← Root orchestrator
├── AGENTS.md                           ← This file (root)
└── .git
```

---

## 3. Critical Rules (Non-Negotiable)

### 3.1 Secrets

- **NEVER** put API keys, DB credentials, or tokens in frontend code (anything under `src/`, `app/`, `pages/`, `components/`, `public/`)
- **NEVER** put secret keys in env vars prefixed with `NEXT_PUBLIC_`, `VITE_`, or `REACT_APP_` (these are bundled into the client)
- **NEVER** hardcode credentials in source files. Use environment variables loaded server-side only
- The `.env` file **MUST** be in `.gitignore` before the first commit. Verify this before creating any `.env` file
- Use `.env.example` with placeholder values only, never real credentials

### 3.2 Database

- Enable **Row Level Security on EVERY Supabase table** before deployment. Default policy: deny all. Write explicit policies scoped to `auth.uid()`
- **NEVER** set a Supabase RLS policy to `USING (true)` or `FOR ALL` without a WHERE condition
- Firebase Security Rules **MUST** require `request.auth != null` and scope access to `request.auth.uid`
- **NEVER** use `pickle.loads`, `pickle.load`, or any deserialization on user-supplied data. Use JSON for all network data exchange

### 3.3 Authentication & Authorization

- **EVERY** API route that returns or modifies user data **MUST** have authentication middleware that runs **BEFORE** the handler, not inside it
- Unauthenticated requests to protected endpoints **MUST** return 401
- **EVERY** route that takes a resource ID **MUST** verify the authenticated user owns that resource: `current_user.id == resource.owner_id`. This is a **SEPARATE** check from authentication
- Admin endpoints **MUST** verify admin role and return 403 for non-admin users
- Session cookies **MUST** set `httpOnly: true`, `secure: true`, and `sameSite: 'lax'`

### 3.4 Input & Output

- **NEVER** concatenate user input into SQL queries. **ALWAYS** use parameterized queries or ORM methods
- **NEVER** use `dangerouslySetInnerHTML`, `v-html`, or `innerHTML` with user-supplied content unless it is first sanitized with DOMPurify
- **ALL** user input **MUST** be validated server-side. Client-side validation is for UX only
- File uploads **MUST** validate file type by reading magic bytes, not by checking the filename extension. Rename all uploads to UUIDs server-side. Store on a separate domain (S3, R2, GCS), never on the app origin

### 3.5 URL Fetching (SSRF Prevention)

If the application fetches URLs provided by users (link previews, image proxies, URL validators), it **MUST**:

- Block all private/internal IP ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`
- Allow only `http` and `https` schemes
- Resolve the hostname and check the IP **BEFORE** making the request

### 3.6 Security Headers

Set these headers on **ALL** responses via a single global middleware:

- `Content-Security-Policy: default-src 'self'` (adjust as needed)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

In Express, use the `helmet` package.

### 3.7 CORS

- **NEVER** set CORS origin to `*` (wildcard). Use an explicit allowlist of your actual domains
- **NEVER** combine `origin: '*'` with `credentials: true`

### 3.8 Rate Limiting

- Login, registration, and password reset endpoints **MUST** have rate limiting (block after N failed attempts per IP within a time window)
- Do **NOT** trust `X-Forwarded-For` for rate limiting unless behind a trusted reverse proxy

### 3.9 Payments

- Stripe webhook endpoints **MUST** verify the signature using `stripe.Webhook.construct_event` (or equivalent) on every request. Reject any request with an invalid or missing signature
- Webhook handlers **MUST** track processed event IDs and skip duplicates (idempotency)
- Handle the full event lifecycle: `payment_intent.succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.past_due`

### 3.10 Error Handling

- **NEVER** expose stack traces, SQL errors, file paths, or library names in API responses
- Production error responses **MUST** return only generic messages: `{"error": "Something went wrong"}`
- Full error details go to server-side logs only
- Debug mode / development error pages **MUST** be disabled in production

### 3.11 Password Hashing

- **ALWAYS** use bcrypt, Argon2, or scrypt for password hashing
- **NEVER** use MD5, SHA-1, or plain SHA-256 for passwords

### 3.12 Dependencies

- Before installing any package, verify it exists on the official registry with a reasonable download count and history
- Pin exact versions in `package.json` / `requirements.txt` (no `^` or `~` in production)
- Commit lock files (`package-lock.json`, `poetry.lock`, `yarn.lock`)

---

## 4. Project-Specific Rules

### 4.1 Database Safety (CRITICAL)

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

### 4.2 Split Deploy (Railway — Two Services)

| Service | Root Dir | Cookie Config |
|---------|----------|---------------|
| Backend | `backend/` | `REFRESH_COOKIE_SAMESITE=none` (HTTPS required) |
| Frontend | `frontend/` | `VITE_API_URL` at build time |

- Refresh-token cookie set by backend with `SameSite=<REFRESH_COOKIE_SAMESITE>` — on two domains it **must** be `none` (with HTTPS) or browser won't send it
- CORS must list the frontend URL (`credentials: true` enabled)
- `VITE_API_URL` must point at backend at build time; `frontend/src/services/api.js` sends `credentials: "include"`

### 4.3 AI Provider Keys (Server-Side Only)

| Provider | Keys (Backend Only) | Never In Frontend |
|----------|---------------------|-------------------|
| HeyGen | `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID` | ✅ |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | ✅ |
| Sarvam | `SARVAM_API_KEY`, `SARVAM_VOICE_ID`, etc. | ✅ |
| Judge0 | `JUDGE0_URL`, `JUDGE0_API_KEY`, `JUDGE0_API_HOST` | ✅ |
| Piston | `PISTON_URL` | ✅ |

**Frontend** may only have display overrides: `VITE_HEYGEN_AVATAR_ID`, `VITE_HEYGEN_VOICE_ID`

### 4.4 Proctoring

- MediaPipe (face/attention) runs **in the browser** — no backend dependency
- Proctoring signals sent to backend for audit/logging

---

## 5. Key Files — What NOT to Touch Without Understanding

| File | Why It's Critical |
|------|-------------------|
| `backend/src/db/schema.js` | Idempotent DB init — source of truth for schema |
| `backend/src/middleware/auth.middleware.js` | Auth middleware — runs BEFORE handlers |
| `backend/src/middleware/rateLimit.middleware.js` | Rate limiting config |
| `backend/src/services/` | AI integrations (HeyGen, ElevenLabs, Sarvam, Judge0) |
| `frontend/src/services/api.js` | API client — sends `credentials: "include"` |
| `backend/prisma/schema.prisma` | Prisma schema — for client generation only |
| `backend/scripts/prisma-baseline.js` | Baseline migration marker |

---

## 6. How to Run Locally

```bash
# 1. Clone
git clone https://github.com/incuxaiwork/job-readiness.git D:\code\job-readiness

# 2. Install & setup
cd D:\code\job-readiness
npm run install:all
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
# Fill: DATABASE_URL, JWT_SECRET (backend); VITE_API_URL (frontend)

# 3. Database
npm run db:generate
npm run db:migrate
npm run seed  # optional

# 4. Run
npm run dev  # backend :5000 + frontend :5173
```

---

## 7. How to Test Changes

| Change | Test |
|--------|------|
| Auth flow | Login → refresh → access protected → logout |
| Rate limit | Burst login/register → verify 429 |
| AI interview | Start → HeyGen token → avatar loads → TTS works |
| Code exec | Submit code → Judge0/Piston → result returned |
| Proctoring | MediaPipe loads → face detected → signals sent |
| DB safety | `npm run db:migrate` on existing DB → no data loss |

---

## 8. Deployment

```bash
# Railway (two services, each with own Root Directory)
# Backend: Root=backend/, Start=node src/index.js, Health=/api/health
# Frontend: Root=frontend/, Start=node server.mjs

# Or single deployable:
npm run build
npm run start
```

---

## 9. When in Doubt

1. **Read `security/AUDIT_SUMMARY.md`** — full security posture
2. **Read `security/plans/`** — 14 control plans for each area
3. **Check `backend/src/middleware/`** — auth, rate limit, validation patterns
4. **Verify secrets** — server-side only, never `VITE_*`
5. **Trace the split-deploy cookie flow** — `SameSite=none` + HTTPS

---

## 10. Contacts

| Role | Contact | Notes |
|------|---------|-------|
| Owner | ❓ Unknown | Ask **Ashish** (avani890a@gmail.com) |
| Railway/Deployment | Ashish | incuxai.work@gmail.com |
| GitHub | — | Public repo: `incuxaiwork/job-readiness` |

---

*Maintained by IncuXai team. Update this file when architecture or security rules change.*