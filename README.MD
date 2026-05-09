# Cart-It

**Save products from any store, keep them organized, and shop smarter with friends.**

Cart-It is a full-stack product: a **React** web app, a **Node.js** + **Express** API backed by **PostgreSQL**, and a **Manifest V3 browser extension** (side panel) that captures product details from the page you are on. The server can use [**ScrapingBee**](https://www.scrapingbee.com) to fetch and parse product HTML when a site blocks simple requests or when you need more reliable **price and image** data (especially on large retailers).

### Stack at a glance

| Piece | Technology |
|-------|----------------|
| **Database** | **PostgreSQL** (schema + migrations via `server/schema.sql`; connect with `DATABASE_URL`) |
| **Backend** | **Node.js** + **Express** (REST API, written in **TypeScript**) |
| **Frontend** | **React** (Create React App) + **Tailwind CSS** + React Router |
| **Auth** | JWT sessions, bcrypt password hashing |
| **Hosting (typical)** | **[Render](https://render.com)** for the API using [`render.yaml`](./render.yaml); static **React** build on **Cloudflare Pages**, Netlify, or similar; **PostgreSQL** on Render, Neon, Supabase, or any managed Postgres |
| **Extension** | Chrome / Edge **Manifest V3** (side panel) |
| **Extras** | **ScrapingBee** (optional product-page fetch), **Resend** (optional email for reset + alerts) |

---

## What you can do

| Area | What Cart-It offers |
|------|----------------------|
| **Save from anywhere** | Use the extension on a product page; it captures **image**, **URL**, **title/description**, and **price** (best effort on the page, with server-side enrichment when configured). |
| **Lists & “categories”** | Create **wishlists** (shared or private), pick a list from the extension when you save, or move items later from the **cart** / **dashboard** into a specific list. |
| **Together** | **Shared lists** and **in-app chat** on lists so you can plan purchases with friends. |
| **Price & stock** | **Price-drop** and **out-of-stock** awareness via **in-app notifications** (and optional **email** if you configure [Resend](https://resend.com)). A background **price check** can run on the server on an interval. |
| **Notes** | **Private notes** and **list/item comments** from the **extension** or the **web app** (cart, wishlist, item views). |
| **Account** | **Sign up / log in**, **forgot password** with **email link** to reset (via Resend + `FRONTEND_URL`), **log out**. |
| **Offers** | From your cart, open each store’s **official offers** page (hand-picked URLs for common retailers). The API also exposes a small **curated retailer hub** list. Cart-It does **not** aggregate third-party promo codes or guarantee discounts. |
| **Housekeeping** | **Rename** wishlists, **remove** items, **move** items between lists, **mark purchased**, and more from the dashboard and list views. |

> **Note:** A **“recently deleted” / restore** flow is a natural next feature; today, removing an item is typically **permanent** after confirm. See [Roadmap](#roadmap).

---

## Repository layout

```
Cart_It/
├── cart-it-frontend/     # React (CRA) + Tailwind — landing, dashboard, cart, wishlists, offers hub, auth
├── server/               # Express + TypeScript + PostgreSQL — REST API, ScrapingBee helpers, jobs
├── extension/            # Chrome/Edge MV3 — side panel, background, content scripts
└── README.md
```

---

## Tech stack (detail)

| Layer | Technologies |
|-------|----------------|
| **Database** | **PostgreSQL** — `server/schema.sql`, [`pg`](https://node-postgres.com/) driver |
| **API** | **Node.js**, **Express 5**, **TypeScript**, REST + JWT |
| **Frontend** | **React 19**, **React Router**, **Tailwind CSS**, Create React App build pipeline |
| **Extension** | **Manifest V3** (Chrome / Edge), side panel, content scripts |
| **Hosting** | **Render** (web service + optional cron for price checks; see `render.yaml`), static frontend on **Cloudflare Pages** / Netlify / S3 + CDN |
| **Integrations** | **ScrapingBee** (optional HTML fetch / enrichment), **Resend** (optional transactional email) |

---

## Prerequisites

- **Node.js** (LTS recommended)
- **PostgreSQL** (local or hosted: Neon, Render Postgres, etc.)
- **npm**
- A **ScrapingBee API key** if you want server-side fetch fallback / richer product data on difficult sites
- A **Resend** API key + verified sender if you want password reset and notification emails

---

## Quick start (local)

### 1. Database

Create a database and user (adjust names/passwords). Example SQL lives in `server/scripts/create_database_cart_it.sql`. Put your connection string in `server/.env` as `DATABASE_URL`.

### 2. API (`server/`)

```bash
cd server
npm install
copy .env.example .env    # Windows — use `cp` on macOS/Linux
# Edit .env: DATABASE_URL, JWT_SECRET, PORT (default 5001), optional SCRAPINGBEE_API_KEY, RESEND_*, FRONTEND_URL
npm run dev
```

The server loads `schema.sql` on startup and applies seed data from `server/scripts/seed_demo_data.sql` for local demos.

### 3. Web app (`cart-it-frontend/`)

```bash
cd cart-it-frontend
npm install
# Optional: .env with REACT_APP_API_URL (defaults to http://127.0.0.1:5001 in development — see src/components/api.js)
npm start
```

### 4. Browser extension (`extension/`)

1. Open Chrome or Edge → **Extensions** → enable **Developer mode**.
2. **Load unpacked** → select the `extension` folder (the one that contains `manifest.json`).
3. Pin the Cart-It action and open the **side panel** on a product page. Log in from the app; the extension talks to the same API base URL you configure for the web app.

For production, point the client and extension at your deployed API (see `extension/config.js` and `REACT_APP_API_URL` for the React build).

---

## Environment variables (server)

The source of truth is **`server/.env.example`**. Commonly required:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Sign and verify session tokens |
| `PORT` | API port (e.g. `5001` to match the frontend dev default) |
| `FRONTEND_URL` | Public site URL (password reset and email links) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Send **forgot-password** and optional alert mail |
| `SCRAPINGBEE_API_KEY` | Server-side page fetch for better product metadata on protected pages |
| `PRICE_CHECK_INTERVAL_MINUTES` | How often the server runs **price / stock** checks (when enabled) |

Optional flags and email tuning are documented inline in `.env.example`.

---

## How ScrapingBee fits in

- The **extension** first reads what it can from the open tab (title, image, price, URL).
- The **server** can call **ScrapingBee** to retrieve the same product page HTML in an environment that behaves more like a real browser, then parse **price** and **image** (and related fields) when plain `fetch` is blocked or returns unusable HTML.
- Set `SCRAPINGBEE_API_KEY` in `server/.env`. Disable or tune behavior with variables listed in `server/.env.example` (e.g. `SCRAPINGBEE_ENABLED`, Amazon enrichment flags).

This keeps Cart-It accurate on many retailers without requiring each store’s private API.

---

## Forgot password

1. User submits email on **Forgot password** (`/forgot-password`).
2. API **`POST /api/auth/forgot-password`** creates a token and emails a link to **`/reset-password?token=...`** using **Resend**.
3. User sets a new password via **`POST /api/auth/reset-password`**.

Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FRONTEND_URL`, and `JWT_SECRET` / expiry settings for this to work in production.

---

## Official offers

The **Offers** page is a simple **link hub** to retailer-published pages (not a third-party promo-code product):

- **Stores in your cart** — For each product domain, Cart-It opens that retailer’s **official offers** URL when we have a mapping; otherwise it falls back to the store’s site.
- **Curated retailer list** — A public read-only endpoint returns hand-maintained rows (store name, optional offers URL, labels). Users open **Open official offers** in a new tab.

The repo may still contain unused tables or routes from earlier coursework iterations; what this README describes is **official-offer links only**.

---

## Deployment notes (PostgreSQL + Node / Express + React)

Typical production split:

1. **PostgreSQL** — Managed instance (**Render PostgreSQL**, Neon, Supabase, etc.). Set `DATABASE_URL` on the API service.
2. **Node.js + Express API** — Deploy the `server/` app on **[Render](https://render.com)** using the included **[`render.yaml`](./render.yaml)** blueprint (or equivalent: set `PORT`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, optional `SCRAPINGBEE_API_KEY`, `RESEND_*`).
3. **React static site** — Run `npm run build` in `cart-it-frontend`, upload the `build/` folder to **Cloudflare Pages**, Netlify, or Render Static Site. Build with **`REACT_APP_API_URL`** pointing at your live Express API URL.

**Render tips:** Free web services can sleep; for reliable **price / stock** checks, use **`PRICE_CHECK_CRON_SECRET`** and **`/api/internal/run-price-check`** with Render cron or another scheduler (see `server/.env.example`).

---

## Roadmap / ideas

- **Recently deleted** bucket with restore (soft-delete for cart items).
- Deeper **retailer-specific** offer links (more domains, regional storefronts).
- Optional **affiliate-safe** integrations if you later want syndicated offers with clear sourcing.

---

## License

Add a `LICENSE` file for your chosen terms (e.g. MIT). Until then, all rights reserved unless you state otherwise.

---

**Cart-It** — *Save everywhere. Shop together.*
