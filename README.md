# RankForge ⚡ — Professional MCP Server SaaS

> **The SEO Agency Inside Your AI Agent**  
> Model Context Protocol (MCP) Server for Cursor, Claude Code, Windsurf, Cline, Continue.dev, Zed, and OpenAI Codex.

RankForge gives AI coding agents real-time, server-side access to the proprietary **Beyond SEO & AEO Engine**. Crawl websites, analyze keyword intent clusters, teardown competitors, and inspect Core Web Vitals directly from your coding prompt. The intelligence runs server-side on Cloudflare Workers and is never exposed in prompt context.

---

## 🏗 Architecture Overview

```
rankforge/
├── pages/                        ← Cloudflare Pages (Frontend & Functions)
│   ├── index.html                ← Clean SaaS Landing Page (Linear/Vercel flat theme)
│   ├── dashboard.html            ← Multi-Panel Dashboard (Overview, Keys, Usage, Plans, Docs, Settings)
│   ├── login.html                ← Firebase Auth (Google, GitHub, Email/Password)
│   ├── pricing.html              ← 4-Tier Pricing (Free, Pro $29, Agency $79, Enterprise $199)
│   ├── docs.html                 ← Complete 5-step IDE Setup Guide & tool schemas
│   ├── .dev.vars                 ← Local development environment variables template
│   ├── assets/
│   │   ├── css/main.css          ← Linear/Vercel flat dark theme (#070b14, #0d1117, #161b22, #2563eb)
│   │   └── js/
│   │       ├── auth.js           ← Firebase Modular Auth (Google, GitHub, Email)
│   │       ├── dashboard.js      ← Dashboard Sidebar Controller & Apify show/hide key manager
│   │       └── billing.js        ← Dodo Payments client checkout session trigger
│   └── functions/api/
│       ├── user.js               ← GET /api/user (Profile & plan quotas)
│       ├── keys.js               ← POST /api/keys (AES-256 encrypted Apify key storage)
│       ├── checkout.js           ← POST /api/checkout (Dodo Payments session creation)
│       └── webhook/
│           └── dodo.js           ← POST /api/webhook/dodo (HMAC-verified subscription lifecycle)
├── workers/mcp-server/           ← Cloudflare Worker (MCP Server)
│   ├── src/
│   │   ├── index.ts              ← MCP JSON-RPC 2.0 Handler & Scheduled cron export
│   │   ├── auth.ts               ← Edge Firebase JWT verification
│   │   ├── plan-guard.ts         ← Complete 7-step plan limit enforcement
│   │   ├── cron.ts               ← Scheduled monthly reset ("0 0 1 * *")
│   │   ├── tools/
│   │   │   ├── seo-audit.ts          ← 100-Point SEO health score
│   │   │   ├── keyword-research.ts   ← Intent clustering & URL mapping
│   │   │   ├── competitor-analysis.ts← Competitor gap teardown
│   │   │   ├── backlink-audit.ts     ← Authority & PR link roadmap
│   │   │   ├── local-seo.ts          ← Google Business Profile audit
│   │   │   ├── aeo-geo.ts            ← AI-search citation readiness
│   │   │   ├── technical-audit.ts    ← Core Web Vitals & PageSpeed API
│   │   │   └── report-generator.ts   ← 30/60/90-Day client markdown reports
│   │   └── skill/
│   │       └── engine.ts         ← Proprietary Beyond SEO server-side brain (hidden)
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml             ← D1 database binding, env vars, & cron trigger
│   └── test-mcp.mjs              ← Automated test suite (15 assertions)
├── firebase/
│   ├── firestore.rules           ← UID-based rules with strict plan tampering protection
│   └── firestore.indexes.json    ← Compound query indexes
├── package.json                  ← Monorepo script orchestration
└── README.md                     ← Production deployment documentation
```

---

## 🛠 Complete Setup & Deployment Guide

### 1. Firebase Setup

1. **Create Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/) and create a project (e.g. `rankforge-app`).
2. **Enable Authentication**:
   - Navigate to **Build &rarr; Authentication &rarr; Sign-in method**.
   - Enable **Google** provider.
   - Enable **GitHub** provider (register GitHub OAuth App in GitHub Developer Settings with callback URL `https://rankforge-app.firebaseapp.com/__/auth/handler`).
   - Enable **Email/Password** provider.
3. **Create Firestore Database**:
   - Navigate to **Build &rarr; Firestore Database** and click **Create Database**.
   - Choose production mode and your preferred location.
4. **Deploy Security Rules**:
   - From your terminal, install Firebase CLI (`npm install -g firebase-tools`).
   - Run `firebase login` and `firebase use rankforge-app`.
   - Deploy the rules in `firebase/firestore.rules`:
     ```bash
     firebase deploy --only firestore:rules,firestore:indexes
     ```
5. **Obtain Web API Key**:
   - In Project Settings &rarr; General, find your **Web API Key** and **Project ID**.

---

### 2. Dodo Payments Setup

1. **Register Dodo Account**:
   - Sign up at [Dodo Payments](https://dodopayments.com).
2. **Create Subscription Products**:
   - Create 3 recurring monthly subscription products:
     - **Pro Plan**: $29/mo (Copy Product/Price ID &rarr; `DODO_PRICE_PRO`)
     - **Agency Plan**: $79/mo (Copy Product/Price ID &rarr; `DODO_PRICE_AGENCY`)
     - **Enterprise Plan**: $199/mo (Copy Product/Price ID &rarr; `DODO_PRICE_ENTERPRISE`)
3. **Configure Webhook**:
   - In Dodo Payments Dashboard &rarr; Webhooks:
     - Endpoint URL: `https://rankforge.app/api/webhook/dodo`
     - Events: `subscription.created`, `subscription.updated`, `subscription.cancelled`, `payment.failed`
     - Copy the **Webhook Secret** &rarr; `DODO_WEBHOOK_SECRET`
4. **Obtain API Key**:
   - In Developer Settings, generate an API Key &rarr; `DODO_API_KEY`.

---

### 3. Environment Variables Reference

#### Cloudflare Pages (`pages/.dev.vars` for local, Cloudflare Dashboard for production)
```ini
FIREBASE_PROJECT_ID=rankforge-app
FIREBASE_WEB_API_KEY=AIzaSy...
ENCRYPTION_KEY=32_character_hex_or_string_key
DODO_API_KEY=dodo_live_...
DODO_WEBHOOK_SECRET=whsec_...
DODO_PRICE_PRO=price_pro_monthly
DODO_PRICE_AGENCY=price_agency_monthly
DODO_PRICE_ENTERPRISE=price_enterprise_monthly
```

#### Cloudflare Worker (`workers/mcp-server`)
Set in `wrangler.toml` or via Cloudflare secrets:
```bash
cd workers/mcp-server
wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put FIREBASE_WEB_API_KEY
wrangler secret put ENCRYPTION_KEY
```

---

### 4. Deploying to Cloudflare

#### Prerequisites
- Node.js 18+
- Cloudflare Wrangler CLI (`npm install -g wrangler`)

#### Step-by-Step Deployment
```bash
# 1. Install worker dependencies and test
cd workers/mcp-server
npm install
npm test
npm run typecheck

# 2. Deploy Cloudflare Worker (MCP Server)
wrangler d1 create rankforge-usage # Optional fast edge counter
wrangler deploy

# 3. Deploy Cloudflare Pages (Frontend & Functions)
cd ../..
npm run deploy:pages
```

Alternatively, run from root:
```bash
npm run deploy:all
```

---

## ⚡ Connecting AI Coding Agents

Once deployed, users get their unique MCP server endpoint from the dashboard:
`https://mcp.rankforge.app/mcp` with `Authorization: Bearer <token>` or `https://mcp.rankforge.app/mcp?token=<token>`.

### 1. Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "rankforge": {
      "url": "https://mcp.rankforge.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN"
      }
    }
  }
}
```

### 2. Claude Code CLI
```bash
claude mcp add rankforge https://mcp.rankforge.app/mcp --header "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Windsurf (`~/.codeium/windsurf/mcp_config.json`)
```json
{
  "mcpServers": {
    "rankforge": {
      "url": "https://mcp.rankforge.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN"
      }
    }
  }
}
```

### 4. Cline (`settings.json`)
```json
{
  "mcpServers": {
    "rankforge": {
      "url": "https://mcp.rankforge.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN"
      },
      "disabled": false,
      "autoApprove": ["seo_audit", "keyword_research", "competitor_analysis", "generate_report"]
    }
  }
}
```

---

## 🛡 Security & Plan Limit Enforcement

1. **Authentication:**
   - Every MCP tool call verifies the user's token via Firebase REST API & Web Crypto.
   - Unauthenticated requests are rejected with code `-32001`.
2. **Plan Guard (`plan-guard.ts`):**
   - Active status check: verified not cancelled or expired.
   - Quotas: Free (10), Pro (100), Agency (500), Enterprise (Unlimited).
   - If limits are reached, the call is rejected with code `-32002`: `"Monthly audit limit reached. Upgrade at rankforge.app/pricing"`.
3. **Monthly Reset Cron:**
   - On the 1st of every month at `00:00 UTC` (`0 0 1 * *`), Cloudflare Workers automatically resets `audits_used` to 0 across all user accounts in Firestore.
4. **BYOK Privacy:**
   - Apify keys are encrypted using **AES-256-GCM** before being saved to Firestore.
   - The plain key is decrypted only in volatile edge memory for actor execution and is never logged or leaked.
5. **Skill Protection:**
   - Proprietary Beyond SEO engine algorithms, formulas, and prompt logic execute server-side and are completely hidden from the client agent.

---

## ✅ Production Readiness Checklist

- [x] User can sign up with Google / GitHub / Email
- [x] User sees their dashboard with real-time plan info and usage progress bar
- [x] User can save Apify key (encrypted client-side & stored in Firestore)
- [x] User gets their unique MCP URL with 1-click copy
- [x] MCP URL works in Cursor (`.cursor/mcp.json`) & Claude Code
- [x] Plan limits are enforced on every tool call via `plan-guard.ts`
- [x] Upgrade flow works (Dodo checkout &rarr; HMAC webhook &rarr; Firestore updated)
- [x] Monthly reset works via Cloudflare Worker scheduled cron (`0 0 1 * *`)
- [x] All 8 tools return structured data via user's BYOK Apify key
- [x] Skill internals and secret logic are never exposed in error messages or responses
