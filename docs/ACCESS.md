# job-readiness — Access & Contacts

> **Status:** 🟢 Live (assumed) | **Last Updated:** 2026-11-12

---

## Where the Code Lives

| Location | Path / URL |
|----------|------------|
| **Local (this laptop)** | `D:\code\job-readiness\` |
| **GitHub** | https://github.com/incuxaiwork/job-readiness (public) |
| **Production (Backend)** | Railway: `incuxai.work@gmail.com` → service `job-readiness-backend` |
| **Production (Frontend)** | Railway: `incuxai.work@gmail.com` → service `job-readiness-frontend` |

---

## How to Access

### 1. Local Development

```bash
# Clone
git clone https://github.com/incuxaiwork/job-readiness.git D:\code\job-readiness

# Setup
cd D:\code\job-readiness
npm run install:all
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
# Fill: DATABASE_URL, JWT_SECRET (backend); VITE_API_URL (frontend)
npm run db:generate
npm run db:migrate
npm run seed  # optional

# Run
npm run dev  # backend :5000 + frontend :5173
```

### 2. Production (Railway — Two Services)

```bash
# Backend service
railway login
railway link incuxaiwork/job-readiness --service backend
railway logs

# Frontend service
railway link incuxaiwork/job-readiness --service frontend
railway logs

# Or via dashboard
# https://railway.app → project → services
```

### 3. GitHub

```bash
git clone https://github.com/incuxaiwork/job-readiness.git
# Public repo - no auth needed for clone
git add -A
git commit -m "your message"
git push origin main  # Triggers Railway auto-deploy
```

---

## Whom to Contact

| Area | Person | Email | Notes |
|------|--------|-------|-------|
| **Owner** | ❓ Unknown | — | Ask **Ashish** (avani890a@gmail.com) |
| **Railway/Deployment** | Ashish | incuxai.work@gmail.com | Railway account owner |
| **GitHub** | — | — | Public repo: `incuxaiwork/job-readiness` |

> ⚠️ **Owner not documented in repo.** Contact Ashish to confirm.

---

## Credential Locations (Pointers Only)

| Credential | Where It Lives |
|------------|----------------|
| **Railway DB URL** | Railway → Backend service variables; local `backend/.env` |
| **Railway Redis URL** | Railway → Backend service variables; local `backend/.env` |
| **JWT_SECRET** | Railway → Backend service variables; local `backend/.env` |
| **Judge0 API** | Backend env; RapidAPI/Judge0 dashboard |
| **HeyGen API** | Backend env; app.heygen.com |
| **ElevenLabs API** | Backend env; ElevenLabs dashboard |
| **Sarvam API** | Backend env; dashboard.sarvam.ai |
| **Frontend API URL** | Vercel/Railway → Frontend env (`VITE_API_URL`); local `frontend/.env` |
| **Railway Dashboard** | railway.app (GitHub login) |
| **GitHub** | Public repo; `gh auth login` for push |

---

## Quick Commands

| Task | Command |
|------|---------|
| Full dev stack | `npm run dev` |
| Backend only | `npm run dev:backend` |
| Frontend only | `npm run dev:frontend` |
| Safe DB migrate | `npm run db:migrate` |
| Prisma Studio | `npm run db:studio` |
| Seed demo data | `npm run seed` |
| Validate questions | `npm run questions:validate` |
| Build prod | `npm run build` |
| Single deploy | `npm run start` |
| View BE logs | Railway dashboard → backend service |
| View FE logs | Railway dashboard → frontend service |

---

## Related Documentation

| Doc | Path |
|-----|------|
| Architecture | `docs/ARCHITECTURE.md` |
| Tech Stack | `docs/TECH_STACK.md` |
| AGENTS.md | `docs/AGENTS.md` |
| README | `README.md` |
| Security Audit | `security/AUDIT_SUMMARY.md` |
| Security Plans | `security/plans/` |
| Security Reports | `security/reports/` |

---

*Last verified: 2026-11-12*