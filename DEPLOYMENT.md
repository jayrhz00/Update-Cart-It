# Deployment Guide - Cart-It

This guide explains how to deploy the **Cart-It** project to production using **Cloudflare Pages** for the frontend and **Render** (or any Node.js host) for the backend.

## 1. Backend Deployment (Node.js + PostgreSQL)

The backend is an Express API that requires a PostgreSQL database.

### Recommended: Render.com
1.  Create a new **Web Service** on Render.
2.  Connect your GitHub repository.
3.  Set the **Root Directory** to `server`.
4.  Set the **Build Command** to `npm install`.
5.  Set the **Start Command** to `npm start`.
6.  Add a **PostgreSQL Database** on Render.
7.  **Environment Variables:**
    *   `DATABASE_URL`: Your PostgreSQL connection string.
    *   `JWT_SECRET`: A long random string.
    *   `FRONTEND_URL`: The URL where your frontend will be hosted (e.g., `https://cart-it.pages.dev`).
    *   `RESEND_API_KEY`: (Optional) For emails.
    *   `GOOGLE_AI_API_KEY`: (Optional) For AI summarization.
    *   `SCRAPINGBEE_API_KEY`: (Optional) For enhanced scraping.

---

## 2. Frontend Deployment (Cloudflare Pages)

The frontend is a React application optimized for Cloudflare Pages.

### Setup on Cloudflare
1.  Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  Go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3.  Select your repository.
4.  **Build Settings:**
    *   **Framework preset:** `Create React App`
    *   **Build command:** `bash scripts/cloudflare-build.sh`
    *   **Build output directory:** `cart-it-frontend/build`
    *   **Root directory:** `cart-it-frontend`
5.  **Environment Variables:**
    *   `REACT_APP_API_URL`: The URL of your deployed backend (e.g., `https://cart-it-api.onrender.com`).

---

## 3. Browser Extension Configuration

Before distributing your extension, you must point it to your production URLs.

1.  Open `extension/config.js`.
2.  Update `defaultWebAppOrigin` and `defaultApiBase`:
    ```javascript
    const defaultWebAppOrigin = "https://cart-it.pages.dev";
    const defaultApiBase = "https://cart-it-api.onrender.com";
    ```
3.  Rebuild the extension zips:
    ```bash
    npm run frontend:build
    ```
4.  The updated zips will be in `cart-it-frontend/public/` and can be downloaded from your live site.

---

## 4. Database Initialization

The server is designed to automatically apply the schema and demo data on first startup. Ensure your `DATABASE_URL` is correct, and the server will handle the rest.

---

## Summary of URL Mapping
| Component | Hosting | Config Point |
| :--- | :--- | :--- |
| **Frontend** | Cloudflare Pages | `REACT_APP_API_URL` (Env Var) |
| **Backend** | Render | `FRONTEND_URL` (Env Var) |
| **Extension** | User Browser | `extension/config.js` |
