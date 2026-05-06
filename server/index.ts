// IMPORTS
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";

import { pool } from "./db";
import { storage } from "./storage";
import { CURATED_COUPONS } from "./curated-coupons";
import { GoogleGenerativeAI } from "@google/generative-ai";


// Cart-It:Express API + PostgreSQL
// Express: web server framework that listens for HTTP requests, responses, NextFunction
// Each app.get / app.post is a route React app calls
// authenticateToken: middleware runs BEFORE the route handler; checks JWT
// JWT: JSON Web Token — proves "this request is from user X" without sending password again.
 // pool (from db.ts): connection pool to PostgreSQL — runs SQL queries.
 // storage: helper class for user/group rows (some routes use pool directly).
 // On startup we run schema.sql once so all 6 tables exist (see initializeDatabase).
 
dotenv.config();

// Make sure JWT secret exists before server starts
if (!process.env.JWT_SECRET) 
{
  throw new Error("JWT_SECRET is missing from .env");
}

// TYPE DEFINITIONS
// Help TypeScript understand what data is inside req.body and req.user

// Body for register route
interface RegisterBody 
{
  username: string;
  email: string;
  password: string;
}

// Body for login route
interface LoginBody 
{
  email: string;
  password: string;
}

interface ForgotPasswordBody {
  email: string;
}

interface ResetPasswordBody {
  token: string;
  new_password: string;
}

// Body for create group route
interface CreateGroupBody 
{
  group_name: string;
  color?: string;
  visibility?: string;
}

interface UpdateGroupBody 
{
  group_name?: string;
  color?: string | null;
  visibility?: "Private" | "Shared";
}

interface GroupCommentBody 
{
  body?: string;
}

interface CreateUserCouponBody {
  store_name: string;
  store_domain?: string | null;
  code: string;
  discount_label?: string | null;
  fine_print?: string | null;
  expires_at?: string | null;
}

interface UpdateUserCouponBody {
  store_name?: string;
  store_domain?: string | null;
  code?: string;
  discount_label?: string | null;
  fine_print?: string | null;
  expires_at?: string | null;
}

interface CouponFeedbackBody {
  store_name?: string;
  code?: string;
  source?: "curated" | "saved" | "ai";
  outcome?: "copied" | "used" | "failed";
}

interface CreateCartItemBody 
{
  group_id?: number | null;
  item_name: string;
  product_url: string;
  image_url?: string | null;
  store?: string | null;
  /** Primary field used by the React app + extension today. */
  current_price?: number;
  /**
   * Legacy / alternate name some clients send.
   * WHY: Early extension drafts used `price`; we still accept it so saves never silently become $0.
   */
  price?: number;
  is_in_stock?: boolean;
  notes?: string | null;
}

interface UpdateCartItemBody 
{
  group_id?: number | null;
  item_name?: string;
  product_url?: string;
  image_url?: string | null;
  store?: string | null;
  current_price?: number;
  /** Saved only for the authenticated user (item_private_notes). */
  notes?: string | null;
  is_purchased?: boolean;
  /**
   * Friendly alias for `is_purchased` (assignment-friendly naming).
   * WHAT: Same column in Postgres — we map it in the PATCH handler.
   */
  purchased?: boolean;
  purchase_price?: number | null;
  is_in_stock?: boolean;
  /**
   * Friendly inverse of `is_in_stock`.
   * WHAT: `out_of_stock: true` means we set `is_in_stock = false` in the database.
   */
  out_of_stock?: boolean;
  /** When true, server re-fetches `product_url` and updates `current_price` (fixes bad scrapes like Amazon “$35 shipping”). */
  refresh_list_price?: boolean;
}

interface InviteGroupMemberBody 
{
  email?: string;
  /** Optional: invite by Cart-It user id instead of email (useful for demos / internal tools). */
  user_id?: number;
  role?: "Editor" | "Owner";
}

// Custom request type for routes that use JWT
type AuthRequest<
  Body = any,
  Params = any
> = Request<Params, any, Body> & {
  user?: {
    userId: number;
    email: string;
  };
};

// EXPRESS APP SETUP
const app = express();
const PORT = Number(process.env.PORT) || 5000;

//Background job: re-fetches product pages to update price/stock
// PRICE_CHECK_ENABLED=false  OR  PRICE_CHECK_INTERVAL_MINUTES=0
const PRICE_CHECK_DISABLED =
  String(process.env.PRICE_CHECK_ENABLED || "")
    .toLowerCase()
    .trim() === "false" ||
  String(process.env.PRICE_CHECK_INTERVAL_MINUTES || "").trim() === "0";
const PRICE_CHECK_INTERVAL_MINUTES = PRICE_CHECK_DISABLED
  ? 0
  : Number(process.env.PRICE_CHECK_INTERVAL_MINUTES || 180);
/** Same value must be sent as header `X-Cart-It-Cron-Secret` when calling POST /api/internal/run-price-check (Render Cron, etc.). */
const PRICE_CHECK_CRON_SECRET = String(process.env.PRICE_CHECK_CRON_SECRET || "").trim();
const RESET_PASSWORD_EXP_MINUTES = Math.max(
  5,
  Number(process.env.RESET_PASSWORD_EXP_MINUTES || 30)
);

// Allows frontend to talk to backend
app.use(cors());

// Allow backend to read JSON from req.body
app.use(express.json());

// Postgres column names are is_purchased and is_in_stock (see schema.sql).
// Lab writeups often call the same ideas purchased and out_of_stock.
// WHAT we do: every cart item JSON going back to the browser includes BOTH naming styles.
// WHY: so Postman / extension / frontend teammates can read the payload without guessing internals.
function shapeCartItemResponse(row: Record<string, unknown>) {
  return {
    ...row,
    purchased: row.is_purchased === true,
    out_of_stock: row.is_in_stock === false,
  };
}

console.log("index.ts loaded");
console.log("login route loaded");

// JWT AUTH MIDDLEWARE
// Checks if user sent a valid token
// If valid, attaches decoded user info to req.user

function authenticateToken
(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];

  // Token normally comes in as: Bearer TOKEN_HERE
  const token = authHeader?.split(" ")[1];

  // If no token was sent, block access
  if (!token) 
  {
    return res.status(401).json({
      message: "Access denied. No token provided.",
    });
  }

  try 
  {
    // Verify token using secret from .env
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as 
    {
      userId: number;
      email: string;
    };

    // Save decoded user info on request
    req.user = decoded;

    // Move to actual route
    next();
  } catch (error) {
    return res.status(403).json({
      message: "Invalid or expired token",
    });
  }
}

function parsePositivePrice(raw: unknown): number | null {
  const normalized =
    typeof raw === "string"
      ? (() => {
          let token = raw.replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
          const hasComma = token.includes(",");
          const hasDot = token.includes(".");
          if (hasComma && hasDot) {
            const lastComma = token.lastIndexOf(",");
            const lastDot = token.lastIndexOf(".");
            if (lastComma > lastDot) {
              // 1.799,99 -> 1799.99
              token = token.replace(/\./g, "").replace(",", ".");
            } else {
              // 1,799.99 -> 1799.99
              token = token.replace(/,/g, "");
            }
          } else if (hasComma) {
            // 17,99 -> 17.99 ; 1,799 -> 1799
            token = /,\d{1,2}$/.test(token) ? token.replace(",", ".") : token.replace(/,/g, "");
          }
          return token;
        })()
      : raw;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Number(num.toFixed(2));
}

function getFrontendBaseUrl(): string {
  const raw = String(process.env.FRONTEND_URL || "https://cart-it.com").trim();
  return raw.replace(/\/+$/, "");
}

async function insertUserNotification(params: {
  userId: number;
  message: string;
  itemId?: number | null;
  groupId?: number | null;
}): Promise<void> {
  const { userId, message, itemId = null, groupId = null } = params;
  try {
    await pool.query(
      `
      INSERT INTO notifications (user_id, item_id, group_id, message, is_read)
      VALUES ($1, $2, $3, $4, false)
      `,
      [userId, itemId, groupId, message]
    );
  } catch (error) {
    console.error("insertUserNotification failed:", error);
  }
}

async function notifyGroupPeers(params: {
  groupId: number;
  senderUserId: number;
  message: string;
  itemId?: number | null;
}): Promise<void> {
  const { groupId, senderUserId, message, itemId = null } = params;
  try {
    const peers = await pool.query(
      `
      SELECT DISTINCT uid FROM (
        SELECT owner_id AS uid FROM groups WHERE group_id = $1
        UNION
        SELECT user_id AS uid FROM group_members WHERE group_id = $1
      ) peers
      WHERE uid IS NOT NULL AND uid <> $2
      `,
      [groupId, senderUserId]
    );

    for (const row of peers.rows) {
      const uid = Number(row.uid);
      if (!Number.isFinite(uid)) continue;
      await insertUserNotification({
        userId: uid,
        message,
        groupId,
        itemId,
      });
    }
  } catch (error) {
    console.error("notifyGroupPeers failed:", error);
  }
}

async function userCanAccessGroup(userId: number, groupId: number): Promise<boolean> {
  const r = await pool.query(
    `
    SELECT 1
    FROM groups g
    WHERE g.group_id = $1
      AND (
        g.owner_id = $2
        OR EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = g.group_id AND gm.user_id = $2
        )
      )
    LIMIT 1
    `,
    [groupId, userId]
  );
  return r.rows.length > 0;
}

async function userCanEditCartItemRow(
  editorUserId: number,
  row: { user_id: number; group_id: number | null }
): Promise<boolean> {
  if (row.user_id === editorUserId) return true;
  if (row.group_id == null) return false;
  return userCanAccessGroup(editorUserId, Number(row.group_id));
}

async function upsertPrivateNoteForItem(
  itemId: number,
  userId: number,
  notes: string | null
): Promise<void> {
  const trimmed = notes == null ? "" : String(notes).trim();
  if (!trimmed) {
    await pool.query(
      `DELETE FROM item_private_notes WHERE item_id = $1 AND user_id = $2`,
      [itemId, userId]
    );
    return;
  }
  await pool.query(
    `
    INSERT INTO item_private_notes (item_id, user_id, body, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (item_id, user_id) DO UPDATE
    SET body = EXCLUDED.body, updated_at = CURRENT_TIMESTAMP
    `,
    [itemId, userId, trimmed]
  );
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendGroupInviteEmail({
  toEmail,
  toName,
  ownerName,
  groupName,
  inviteUrl,
}: {
  toEmail: string;
  toName?: string;
  ownerName: string;
  groupName: string;
  inviteUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();

  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      reason: "Invite email provider is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL).",
    };
  }

  const safeToName = toName || toEmail;
  const safeOwner = ownerName || "A Cart-It user";
  const safeGroup = groupName || "your wishlist";
  const subject = `${safeOwner} invited you to collaborate on "${safeGroup}"`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827">
      <h2 style="margin-bottom:8px">You were invited to a Cart-It wishlist</h2>
      <p style="margin-top:0">Hi ${safeToName},</p>
      <p><strong>${safeOwner}</strong> invited you to collaborate on <strong>${safeGroup}</strong>.</p>
      <p>
        Open Cart-It to view and manage the shared wishlist:
        <br />
        <a href="${inviteUrl}" target="_blank" rel="noreferrer">${inviteUrl}</a>
      </p>
      <p style="color:#6b7280;font-size:13px">If this was not expected, you can ignore this email.</p>
    </div>
  `;

  return sendResendEmail({
    apiKey,
    fromEmail,
    toEmail,
    subject,
    html,
    genericErrorMessage: "Failed to contact invite email provider.",
  });
}

async function sendResendEmail({
  apiKey,
  fromEmail,
  toEmail,
  subject,
  html,
  text,
  genericErrorMessage,
}: {
  apiKey: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  html: string;
  text?: string;
  genericErrorMessage: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const payload: Record<string, unknown> = {
      from: fromEmail,
      to: [toEmail],
      subject,
      html,
    };
    if (text && text.trim()) {
      payload.text = text;
    }
    console.log(`Sending email via Resend to ${toEmail}. Subject: "${subject}"`);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error(`Resend API error (${response.status}):`, details);
      let displayReason = `Email API failed (${response.status})${details ? `: ${details}` : ""}`;
      
      // Specifically handle the common Resend Sandbox/Testing restriction
      if (response.status === 403 && details.includes("testing emails") && details.includes("verify a domain")) {
        displayReason = "Resend is in testing mode. You can only send emails to your own registered address until you verify a custom domain at resend.com.";
      }

      return {
        sent: false,
        reason: displayReason,
      };
    }

    return { sent: true };
  } catch (error: any) {
    return {
      sent: false,
      reason: error?.message || genericErrorMessage,
    };
  }
}

async function sendPriceDropEmail({
  toEmail,
  toName,
  itemName,
  previousPrice,
  latestPrice,
  dashboardUrl,
}: {
  toEmail: string;
  toName?: string;
  itemName: string;
  previousPrice: number;
  latestPrice: number;
  dashboardUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      reason: "Price-drop email provider is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL).",
    };
  }

  const safeName = toName || toEmail;
  const safeItem = itemName || "an item";
  const subject = `Price dropped: ${safeItem}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827">
      <h2 style="margin-bottom:8px">Price drop alert</h2>
      <p style="margin-top:0">Hi ${safeName},</p>
      <p>
        Good news — <strong>${safeItem}</strong> dropped in price:
        <br />
        <strong>$${previousPrice.toFixed(2)}</strong> → <strong>$${latestPrice.toFixed(2)}</strong>
      </p>
      <p>
        Open your dashboard to review the item:
        <br />
        <a href="${dashboardUrl}" target="_blank" rel="noreferrer">${dashboardUrl}</a>
      </p>
    </div>
  `;

  return sendResendEmail({
    apiKey,
    fromEmail,
    toEmail,
    subject,
    html,
    genericErrorMessage: "Failed to contact price-drop email provider.",
  });
}

async function sendOutOfStockEmail({
  toEmail,
  toName,
  itemName,
  dashboardUrl,
}: {
  toEmail: string;
  toName?: string;
  itemName: string;
  dashboardUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      reason: "Out-of-stock email provider is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL).",
    };
  }

  const safeName = toName || toEmail;
  const safeItem = itemName || "an item";
  const subject = `Out of stock: ${safeItem}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827">
      <h2 style="margin-bottom:8px">Stock alert</h2>
      <p style="margin-top:0">Hi ${safeName},</p>
      <p><strong>${safeItem}</strong> is currently marked out of stock.</p>
      <p>
        Open your dashboard to review alternatives or keep tracking:
        <br />
        <a href="${dashboardUrl}" target="_blank" rel="noreferrer">${dashboardUrl}</a>
      </p>
    </div>
  `;

  return sendResendEmail({
    apiKey,
    fromEmail,
    toEmail,
    subject,
    html,
    genericErrorMessage: "Failed to contact out-of-stock email provider.",
  });
}

async function sendPasswordResetEmail({
  toEmail,
  toName,
  resetUrl,
}: {
  toEmail: string;
  toName?: string;
  resetUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      reason: "Password reset email provider is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL).",
    };
  }
  const safeNameHtml = escapeHtml(toName || toEmail);
  const safeNameText = toName || toEmail;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#111827;max-width:520px">
      <h2 style="margin:0 0 8px;font-size:20px">Reset your Cart-It password</h2>
      <p style="margin:0 0 12px">Hi ${safeNameHtml},</p>
      <p style="margin:0 0 16px">Tap the button below to choose a new password. It expires in <strong>${RESET_PASSWORD_EXP_MINUTES} minutes</strong>.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px">
        <tr>
          <td style="border-radius:10px;background:#ea580c">
            <a href="${resetUrl}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:14px 22px;font-weight:700;font-size:15px;color:#ffffff;text-decoration:none">
              Reset my password
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280">If the button does not open, use this link (tap or copy the whole line):</p>
      <p style="margin:0 0 20px;font-size:13px;word-break:break-all;line-height:1.4">
        <a href="${resetUrl}" style="color:#c2410c;font-weight:600" target="_blank" rel="noopener noreferrer">${resetUrl}</a>
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280">If you did not ask to reset your password, you can ignore this email.</p>
    </div>
  `;
  const text = [
    `Hi ${safeNameText},`,
    ``,
    `Reset your Cart-It password by opening this link in your browser. Copy the entire URL on the next line if it is not clickable:`,
    ``,
    resetUrl,
    ``,
    `This link expires in ${RESET_PASSWORD_EXP_MINUTES} minutes.`,
    ``,
    `If you did not request this, ignore this email.`,
  ].join("\n");
  return sendResendEmail({
    apiKey,
    fromEmail,
    toEmail,
    subject: "Reset your Cart-It password",
    html,
    text,
    genericErrorMessage: "Failed to contact password-reset email provider.",
  });
}

function extractPriceFromJsonLdObject(node: any): number | null {
  if (!node || typeof node !== "object") return null;
  const offers = node.offers || node.aggregateOffer || null;
  if (offers) {
    const direct = parsePositivePrice((offers as any).price);
    if (direct != null) return direct;
    const low = parsePositivePrice((offers as any).lowPrice);
    if (low != null) return low;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const nested = extractPriceFromJsonLdObject(child);
      if (nested != null) return nested;
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const nested = extractPriceFromJsonLdObject(value);
      if (nested != null) return nested;
    }
  }
  return null;
}

function extractPriceFromHtml(html: string): number | null {
  const metaPatterns = [
    /property=["']product:price:amount["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
    /name=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
    /itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
    /property=["']og:price:amount["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i,
  ];
  for (const re of metaPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const metaPrice = parsePositivePrice(m[1]);
      if (metaPrice != null) return metaPrice;
    }
  }

  // Generic JSON patterns often found in script tags or data attributes
  const jsonPricePatterns = [
    /"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i,
    /"lowPrice"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i,
    /"amount"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i,
  ];
  for (const re of jsonPricePatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const p = parsePositivePrice(m[1]);
      if (p != null && p > 0) return p;
    }
  }

  // Amazon: prefer prices inside core price display blocks (avoids "$35 free shipping" thresholds).
  const coreIdx = html.search(/corePriceDisplay_(desktop|mobile)_feature_div|corePrice_feature_div/i);
  if (coreIdx >= 0) {
    const slice = html.slice(coreIdx, Math.min(html.length, coreIdx + 6000));
    const m = slice.match(/class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})\s*</i);
    if (m?.[1]) {
      const parsed = parsePositivePrice(m[1]);
      if (parsed != null) return parsed;
    }
  }

  const jsonLdBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdBlocks) {
    const content = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    if (!content) continue;
    try {
      const parsed = JSON.parse(content);
      const fromLd = extractPriceFromJsonLdObject(parsed);
      if (fromLd != null) return fromLd;
    } catch {
      // Ignore malformed JSON-LD block
    }
  }

  // Keep this fallback strict: require decimal format to avoid cents-like integers
  // from script blobs such as "price":1799 (which often means $17.99).
  const genericPriceMatch = html.match(/"price"\s*:\s*"?([0-9][0-9,]*\.[0-9]{1,2})"?/i);
  if (genericPriceMatch?.[1]) {
    const fallbackPrice = parsePositivePrice(genericPriceMatch[1]);
    if (fallbackPrice != null) return fallbackPrice;
  }
  return null;
}

/**
 * Normalize schema.org availability URLs or short names to a lowercase token
 * (e.g. https://schema.org/InStock -> "instock").
 */
function normalizeSchemaAvailabilityValue(raw: string): string | null {
  const s = String(raw).trim();
  const m = s.match(/(?:https?:\/\/schema\.org\/)?([A-Za-z]+)\s*$/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

function collectAvailabilityTokensFromJsonLdValue(node: unknown, acc: Set<string>): void {
  if (node == null) return;
  if (typeof node === "string") {
    const t = normalizeSchemaAvailabilityValue(node);
    if (t) acc.add(t);
    return;
  }
  if (Array.isArray(node)) {
    for (const el of node) collectAvailabilityTokensFromJsonLdValue(el, acc);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.availability === "string") {
    const t = normalizeSchemaAvailabilityValue(obj.availability);
    if (t) acc.add(t);
  }
  for (const v of Object.values(obj)) {
    if (v && (typeof v === "object" || typeof v === "string")) {
      collectAvailabilityTokensFromJsonLdValue(v, acc);
    }
  }
}

/**
 * Reads every JSON-LD block so multi-variant PDPs (some sizes OOS, some in stock)
 * only resolve to "out of stock" when no offer is still purchasable.
 */
function extractStockFromJsonLd(html: string): boolean | null {
  const jsonLdBlocks =
    html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const tokens = new Set<string>();
  for (const block of jsonLdBlocks) {
    const content = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    if (!content) continue;
    try {
      const parsed = JSON.parse(content);
      collectAvailabilityTokensFromJsonLdValue(parsed, tokens);
    } catch {
      // Ignore malformed JSON-LD
    }
  }
  if (tokens.size === 0) return null;

  const positive = new Set([
    "instock",
    "limitedavailability",
    "preorder",
    "backorder",
    "instoreonly",
  ]);
  const negative = new Set(["outofstock", "discontinued"]);

  let hasPositive = false;
  let hasNegative = false;
  for (const t of tokens) {
    if (positive.has(t)) hasPositive = true;
    if (negative.has(t)) hasNegative = true;
  }
  if (hasPositive) return true;
  if (hasNegative) return false;
  return null;
}

function extractStockFromHtml(html: string): boolean | null {
  const fromLd = extractStockFromJsonLd(html);
  if (fromLd !== null) return fromLd;

  const outOfStockPatterns = [
    /\bout of stock\b/i,
    /\bsold out\b/i,
    /\bcurrently unavailable\b/i,
    /\btemporarily unavailable\b/i,
    /\bnotify me when available\b/i,
  ];
  const inStockPatterns = [
    /\bin stock\b/i,
    /\bavailable now\b/i,
    /\badd to cart\b/i,
    /\badd to bag\b/i,
    /\bbuy now\b/i,
  ];

  let hasNegative = false;
  for (const re of outOfStockPatterns) {
    if (re.test(html)) {
      hasNegative = true;
      break;
    }
  }
  let hasPositive = false;
  for (const re of inStockPatterns) {
    if (re.test(html)) {
      hasPositive = true;
      break;
    }
  }

  // Many apparel sites show "out of stock" for one size and "Add to bag" for others — treat as unknown.
  if (hasPositive && hasNegative) return null;
  if (hasPositive) return true;
  if (hasNegative) return false;
  return null;
}

/** Hostnames where a plain server-side fetch often returns bot walls or HTML without og:image (images then fail in the app). */
function isAmazonProductUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === "amazon.com" || h.endsWith(".amazon.com");
  } catch {
    return false;
  }
}

function normalizeProductImageUrl(raw: string, pageUrl: string): string | null {
  const s = String(raw || "").trim();
  if (!s || s.startsWith("data:")) return null;
  try {
    return new URL(s, pageUrl).href;
  } catch {
    return null;
  }
}

/** Skip Amazon placeholder / UI chrome URLs we never want as the product card image. */
function isLikelyAmazonPlaceholderImageUrl(u: string): boolean {
  const s = u.toLowerCase();
  return (
    s.includes("grey-pixel") ||
    s.includes("gray-pixel") ||
    s.includes("transparent-pixel") ||
    s.includes("/play-icon") ||
    s.includes("spin360") ||
    s.includes("360_icon")
  );
}

function pickBestAmazonImageFromDynamicKeys(keys: string[]): string | null {
  const urls = keys.filter((k) => /^https?:\/\//i.test(k));
  if (urls.length === 0) return null;
  const amazon = urls.filter((u) => /m\.media-amazon\.com\/images\/I\//i.test(u));
  const pool = amazon.length ? amazon : urls;
  const scored = pool.map((u) => {
    const sl = u.match(/_SL(\d+)_/i);
    const score = sl ? Number(sl[1]) : u.length;
    return { u, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.u ?? null;
}

function parseDataDynamicImageAttr(raw: string): string | null {
  try {
    const jsonish = raw.replace(/&quot;/g, '"').replace(/&#34;/g, '"');
    const obj = JSON.parse(jsonish) as Record<string, unknown>;
    return pickBestAmazonImageFromDynamicKeys(Object.keys(obj));
  } catch {
    return null;
  }
}

function extractAmazonHiResFromScripts(html: string, pageUrl: string): string | null {
  const patterns = [
    /"hiRes"\s*:\s*"(https:\\\/\\\/m\.media-amazon\.com[^"\\]+)"/gi,
    /"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com[^"]+)"/gi,
    /'hiRes'\s*:\s*'(https:\/\/m\.media-amazon\.com[^']+)'/gi,
    /"large"\s*:\s*"(https:\/\/m\.media-amazon\.com[^"]+)"/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const raw = String(m[1] || "").replace(/\\\//g, "/");
      const u = normalizeProductImageUrl(raw, pageUrl);
      if (u && !isLikelyAmazonPlaceholderImageUrl(u) && /images\/I\//i.test(u)) return u;
    }
  }
  return null;
}

/**
 * Best-effort main product image from public PDP HTML (same signals as browsers use for previews).
 * Used when the extension omits image_url or Amazon serves empty og:image to scripted fetches.
 *
 * Amazon "Used / refurbished" and some PDP variants omit `landingImage` src in the initial HTML,
 * use only `data-old-hires`, put URLs inside script JSON (`hiRes`), or include multiple
 * `data-a-dynamic-image` blobs — ScrapingBee uses render_js=false so we must parse those static cues.
 */
function extractProductImageFromHtml(html: string, pageUrl: string): string | null {
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogMatch?.[1]) {
    const u = normalizeProductImageUrl(ogMatch[1], pageUrl);
    if (u && !isLikelyAmazonPlaceholderImageUrl(u)) return u;
  }
  const twMatch = html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i);
  if (twMatch?.[1]) {
    const u = normalizeProductImageUrl(twMatch[1], pageUrl);
    if (u && !isLikelyAmazonPlaceholderImageUrl(u)) return u;
  }

  const landingImgTag = html.match(/<img\b[^>]*\bid=["']landingImage["'][^>]*>/i);
  if (landingImgTag?.[0]) {
    const tag = landingImgTag[0];
    const pick = (name: string) => {
      const mm = tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, "i"));
      return mm?.[1];
    };
    const order = ["data-old-hires", "data-src", "src", "data-a-dynamic-image"];
    for (const attr of order) {
      const val = pick(attr);
      if (!val) continue;
      if (attr === "data-a-dynamic-image") {
        const fromDyn = parseDataDynamicImageAttr(val);
        if (fromDyn) return fromDyn;
      } else {
        const u = normalizeProductImageUrl(val, pageUrl);
        if (u && !isLikelyAmazonPlaceholderImageUrl(u)) return u;
      }
    }
  }

  const legacyLanding = html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i);
  if (legacyLanding?.[1]) {
    const u = normalizeProductImageUrl(legacyLanding[1], pageUrl);
    if (u && !isLikelyAmazonPlaceholderImageUrl(u)) return u;
  }

  for (const m of html.matchAll(/data-a-dynamic-image=["']([^"']+)["']/gi)) {
    const fromDyn = parseDataDynamicImageAttr(m[1]);
    if (fromDyn) return fromDyn;
  }

  const fromScript = extractAmazonHiResFromScripts(html, pageUrl);
  if (fromScript) return fromScript;

  return null;
}

function scrapingBeeConfigured(): boolean {
  if (String(process.env.SCRAPINGBEE_ENABLED || "").toLowerCase().trim() === "false") {
    return false;
  }
  return Boolean(String(process.env.SCRAPINGBEE_API_KEY || "").trim());
}

async function fetchHtmlViaScrapingBee(url: string): Promise<string | null> {
  if (!scrapingBeeConfigured()) return null;
  const apiKey = String(process.env.SCRAPINGBEE_API_KEY || "").trim();
  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    render_js: "false",
  });
  if (String(process.env.SCRAPINGBEE_PREMIUM_PROXY || "").trim() === "1") {
    params.set("premium_proxy", "true");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`https://app.scrapingbee.com/api/v1?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 200 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * HTML for a product URL: direct fetch first, then ScrapingBee when configured (required for many Amazon PDPs).
 * ScrapingBee: set SCRAPINGBEE_API_KEY in `.env` (see `.env.example`).
 */
async function fetchHtmlForProductUrl(url: string): Promise<string | null> {
  const useBee = scrapingBeeConfigured();
  if (useBee && isAmazonProductUrl(url)) {
    const viaBee = await fetchHtmlViaScrapingBee(url);
    if (viaBee) return viaBee;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (res.ok) {
      let html = await res.text();
      if (useBee && extractPriceFromHtml(html) == null) {
        const viaBee = await fetchHtmlViaScrapingBee(url);
        if (viaBee) html = viaBee;
      } else if (
        useBee &&
        isAmazonProductUrl(url) &&
        !extractProductImageFromHtml(html, url)
      ) {
        const viaBee = await fetchHtmlViaScrapingBee(url);
        if (viaBee) html = viaBee;
      }
      return html;
    }
  } catch {
    /* fall through */
  } finally {
    clearTimeout(timeout);
  }

  if (useBee) {
    return fetchHtmlViaScrapingBee(url);
  }
  return null;
}

async function fetchProductSnapshotFromUrl(
  url: string
): Promise<{ price: number | null; inStock: boolean | null }> {
  const html = await fetchHtmlForProductUrl(url);
  if (!html) return { price: null, inStock: null };
  return {
    price: extractPriceFromHtml(html),
    inStock: extractStockFromHtml(html),
  };
}

async function runPriceCheckCycle(): Promise<void> {
  try {
    const items = await pool.query(
      `
      SELECT ci.item_id, ci.user_id, ci.group_id, ci.item_name, ci.product_url, ci.current_price, ci.is_in_stock, u.email, u.username
      FROM cart_items ci
      JOIN users u ON u.user_id = ci.user_id
      WHERE ci.is_purchased = false AND ci.product_url IS NOT NULL
      ORDER BY ci.item_id ASC
      `
    );

    for (const row of items.rows) {
      const itemId = Number(row.item_id);
      const userId = Number(row.user_id);
      const itemName = String(row.item_name || "Item");
      const productUrl = String(row.product_url || "").trim();
      const previousPrice = Number(row.current_price || 0);
      const previousInStock =
        typeof row.is_in_stock === "boolean" ? row.is_in_stock : true;
      const userEmail = String(row.email || "").trim();
      const username = String(row.username || "").trim();
      const rowGroupId =
        row.group_id != null && Number.isFinite(Number(row.group_id))
          ? Number(row.group_id)
          : null;

      if (!productUrl) continue;
      const snapshot = await fetchProductSnapshotFromUrl(productUrl);
      const latestPrice = snapshot.price;
      const latestInStock = snapshot.inStock;

      if (latestInStock !== null && latestInStock !== previousInStock) {
        await pool.query(
          `UPDATE cart_items SET is_in_stock = $1 WHERE item_id = $2`,
          [latestInStock, itemId]
        );
      }

      if (latestInStock === false && previousInStock === true) {
        await insertUserNotification({
          userId,
          itemId,
          groupId: rowGroupId,
          message: `${itemName} is currently out of stock.`,
        });
        if (userEmail) {
          await sendOutOfStockEmail({
            toEmail: userEmail,
            toName: username || userEmail,
            itemName,
            dashboardUrl: `${getFrontendBaseUrl()}/dashboard`,
          }).catch(() => {});
        }
      }

      if (latestPrice == null) continue;

      const changed = Math.abs(latestPrice - previousPrice) >= 0.01;
      if (!changed) continue;

      await pool.query(
        `UPDATE cart_items SET current_price = $1 WHERE item_id = $2`,
        [latestPrice, itemId]
      );
      await pool.query(
        `INSERT INTO price_history (item_id, price) VALUES ($1, $2)`,
        [itemId, latestPrice]
      );

      if (latestPrice < previousPrice) {
        await insertUserNotification({
          userId,
          itemId,
          groupId: rowGroupId,
          message: `Price dropped for ${itemName}: $${previousPrice.toFixed(2)} -> $${latestPrice.toFixed(2)}`,
        });
        if (userEmail) {
          await sendPriceDropEmail({
            toEmail: userEmail,
            toName: username || userEmail,
            itemName,
            previousPrice,
            latestPrice,
            dashboardUrl: `${getFrontendBaseUrl()}/dashboard`,
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("Price check cycle failed:", error);
  }
}

// DATABASE TEST
// Confirms backend can talk to PostgreSQL
pool
  .query("SELECT NOW()")
  .then((result) => console.log("Database TIME:", result.rows))
  .catch((err) => console.error("Database ERROR:", err));

// Runs once when the server starts: creates tables if missing (CREATE TABLE IF NOT EXISTS).
// Your professor can see the same definitions in server/schema.sql.
async function initializeDatabase(): Promise<void> {
  try {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schemaSql = await fs.readFile(schemaPath, "utf-8");
    await pool.query(schemaSql);
    await pool.query(
      `ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS is_in_stock BOOLEAN DEFAULT true NOT NULL`
    );
    await pool.query(
      `ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS group_comments TEXT`
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS item_private_notes (
        item_id INTEGER NOT NULL REFERENCES cart_items(item_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        body TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (item_id, user_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS item_group_comments (
        comment_id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES cart_items(item_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_item_group_comments_item ON item_group_comments(item_id)`
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_comments (
        comment_id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_group_comments_group ON group_comments(group_id)`
    );
    await pool.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_id INTEGER
        REFERENCES groups(group_id) ON DELETE CASCADE
    `);
    await pool.query(`ALTER TABLE notifications ALTER COLUMN item_id DROP NOT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_usage_events (
        event_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        store_name VARCHAR(200) NOT NULL,
        code VARCHAR(120) NOT NULL,
        outcome VARCHAR(20) NOT NULL,
        source VARCHAR(20),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT chk_coupon_usage_events_outcome
          CHECK (outcome IN ('copied', 'used', 'failed'))
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_coupon_usage_events_created_at ON coupon_usage_events(created_at DESC)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_coupon_usage_events_store_code ON coupon_usage_events(store_name, code)`
    );

    const seedPath = path.join(__dirname, "scripts", "seed_demo_data.sql");
    const seedSql = await fs.readFile(seedPath, "utf-8");
    await pool.query(seedSql);
    console.log(
      "PostgreSQL demo seed applied (users, groups, group_members, cart_items, price_history, notifications — idempotent)."
    );

    await pool.query(`
      INSERT INTO item_private_notes (item_id, user_id, body, updated_at)
      SELECT ci.item_id, ci.user_id, ci.notes, ci.created_at
      FROM cart_items ci
      WHERE ci.notes IS NOT NULL AND LENGTH(TRIM(ci.notes)) > 0
      ON CONFLICT (item_id, user_id) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO item_group_comments (item_id, user_id, body)
      SELECT ci.item_id, ci.user_id, TRIM(ci.group_comments)
      FROM cart_items ci
      WHERE ci.group_comments IS NOT NULL AND LENGTH(TRIM(ci.group_comments)) > 0
        AND NOT EXISTS (SELECT 1 FROM item_group_comments c WHERE c.item_id = ci.item_id)
    `);
    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Database schema initialization failed:", error);
    throw error;
  }
}

// BASIC TEST ROUTES

// Root route to prove server exists
app.get("/", (_req: Request, res: Response) => {
  console.log("GET / hit");
  res.status(200).send("Cart-It server is running");
});

/** Public curated promo examples for the Coupons page (no auth). */
app.get("/api/public/curated-coupons", (_req: Request, res: Response) => {
  res.status(200).json(CURATED_COUPONS);
});

/** Public: most-used coupon codes today across tracked outcomes. */
app.get("/api/public/coupons/top-today", async (_req: Request, res: Response) => {
  try {
    const agg = await pool.query(
      `
      SELECT
        LOWER(TRIM(store_name)) AS store_key,
        UPPER(TRIM(code)) AS code_key,
        MAX(store_name) AS store_name,
        MAX(code) AS code,
        COUNT(*) FILTER (WHERE outcome = 'used' AND created_at >= NOW() - INTERVAL '1 day')::int AS used_today,
        COUNT(*) FILTER (WHERE outcome = 'copied' AND created_at >= NOW() - INTERVAL '1 day')::int AS copied_today,
        COUNT(*) FILTER (WHERE outcome = 'failed' AND created_at >= NOW() - INTERVAL '1 day')::int AS failed_today,
        COUNT(*) FILTER (WHERE outcome = 'used' AND created_at >= NOW() - INTERVAL '7 day')::int AS used_7d,
        COUNT(*) FILTER (WHERE outcome = 'copied' AND created_at >= NOW() - INTERVAL '7 day')::int AS copied_7d,
        COUNT(*) FILTER (WHERE outcome = 'failed' AND created_at >= NOW() - INTERVAL '7 day')::int AS failed_7d
      FROM coupon_usage_events
      GROUP BY 1, 2
      `
    );
    const out = agg.rows
      .map((r) => {
        const scorePack = computeCouponAiScore({
          usedToday: Number(r.used_today || 0),
          copiedToday: Number(r.copied_today || 0),
          failedToday: Number(r.failed_today || 0),
          used7d: Number(r.used_7d || 0),
          copied7d: Number(r.copied_7d || 0),
          failed7d: Number(r.failed_7d || 0),
        });
        return {
          store_name: String(r.store_name || "").trim(),
          code: String(r.code || "").trim(),
          used_today: Number(r.used_today || 0),
          copied_today: Number(r.copied_today || 0),
          failed_today: Number(r.failed_today || 0),
          score: scorePack.score,
          success_rate_7d: Number(scorePack.successRate.toFixed(3)),
        };
      })
      .filter((r) => r.store_name && r.code)
      .sort((a, b) => b.score - a.score || b.used_today - a.used_today || a.store_name.localeCompare(b.store_name))
      .slice(0, 25);
    return res.status(200).json(out);
  } catch (error) {
    console.error("Top coupons today failed:", error);
    return res.status(500).json({ message: "Failed to load top coupons today" });
  }
  }
  );

  /** POST /api/ai/summarize — Use Gemini to summarize product details. */
  app.post("/api/ai/summarize", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ message: "AI features are currently disabled (missing GOOGLE_AI_API_KEY)." });
  }

  const { item_name, product_description, store } = req.body;
  if (!item_name && !product_description) {
    return res.status(400).json({ message: "Product details are required for summarization." });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `Summarize this product from ${store || "a retailer"} in 2-3 concise sentences. Focus on key features and value.
  Product Name: ${item_name}
  Description: ${product_description}`;

  const result = await model.generateContent(prompt);
  const summary = result.response.text();

  return res.status(200).json({ summary });
  } catch (error) {
  console.error("AI Summarization failed:", error);
  return res.status(500).json({ message: "Failed to generate AI summary." });
  }
  });

  /** Auth: AI-ish coupon suggestions blended from curated + saved + live usage stats. */
  app.get("/api/coupons/ai-suggestions", authenticateToken, async (req: AuthRequest, res: Response) => {

  try {
    const userId = req.user!.userId;
    const rawStore = String(req.query.store || "").trim();
    const storeQ = normalizeStoreName(rawStore);
    if (!storeQ) {
      return res.status(400).json({ message: "store query is required" });
    }

    const usageRows = await pool.query(
      `
      SELECT
        LOWER(TRIM(store_name)) AS store_key,
        UPPER(TRIM(code)) AS code_key,
        MAX(store_name) AS store_name,
        MAX(code) AS code,
        COUNT(*) FILTER (WHERE outcome = 'used' AND created_at >= NOW() - INTERVAL '1 day')::int AS used_today,
        COUNT(*) FILTER (WHERE outcome = 'copied' AND created_at >= NOW() - INTERVAL '1 day')::int AS copied_today,
        COUNT(*) FILTER (WHERE outcome = 'failed' AND created_at >= NOW() - INTERVAL '1 day')::int AS failed_today,
        COUNT(*) FILTER (WHERE outcome = 'used' AND created_at >= NOW() - INTERVAL '7 day')::int AS used_7d,
        COUNT(*) FILTER (WHERE outcome = 'copied' AND created_at >= NOW() - INTERVAL '7 day')::int AS copied_7d,
        COUNT(*) FILTER (WHERE outcome = 'failed' AND created_at >= NOW() - INTERVAL '7 day')::int AS failed_7d
      FROM coupon_usage_events
      WHERE LOWER(TRIM(store_name)) LIKE $1
      GROUP BY 1, 2
      `,
      [`%${storeQ}%`]
    );

    const savedRows = await pool.query(
      `
      SELECT store_name, store_domain, code, discount_label, fine_print, expires_at
      FROM user_store_coupons
      WHERE user_id = $1
        AND (
          LOWER(store_name) LIKE $2
          OR LOWER(COALESCE(store_domain, '')) LIKE $2
        )
      ORDER BY updated_at DESC
      LIMIT 30
      `,
      [userId, `%${storeQ}%`]
    );

    /** Popular codes for this retailer across all users (counts only — no PII). */
    const communitySavedRows = await pool.query(
      `
      SELECT
        MAX(TRIM(store_name)) AS store_name,
        MAX(store_domain) AS store_domain,
        MAX(code) AS code,
        MAX(discount_label) AS discount_label,
        MAX(fine_print) AS fine_print,
        MAX(expires_at) AS expires_at,
        COUNT(*)::int AS save_count
      FROM user_store_coupons
      WHERE code IS NOT NULL
        AND TRIM(code) <> ''
        AND (
          LOWER(TRIM(store_name)) LIKE $1
          OR LOWER(TRIM(COALESCE(store_domain, ''))) LIKE $1
        )
      GROUP BY LOWER(TRIM(store_name)), UPPER(TRIM(REGEXP_REPLACE(code, '\\s+', '', 'g')))
      ORDER BY save_count DESC, MAX(store_name) ASC
      LIMIT 40
      `,
      [`%${storeQ}%`]
    );

    const usageMap = new Map<string, any>();
    for (const row of usageRows.rows) {
      const key = `${normalizeStoreName(row.store_name)}::${normalizeCouponCode(row.code)}`;
      usageMap.set(key, row);
    }

    const merged = new Map<string, any>();
    const pushCandidate = (row: any, source: "curated" | "saved" | "usage" | "community") => {
      const storeName = String(row.store_name || "").trim();
      const code = normalizeCouponCode(row.code);
      if (!storeName || !code) return;
      const key = `${normalizeStoreName(storeName)}::${code}`;
      const usage = usageMap.get(key);
      const usedToday = Number(usage?.used_today || 0);
      const copiedToday = Number(usage?.copied_today || 0);
      const failedToday = Number(usage?.failed_today || 0);
      const used7d = Number(usage?.used_7d || 0);
      const copied7d = Number(usage?.copied_7d || 0);
      const failed7d = Number(usage?.failed_7d || 0);
      const ai = computeCouponAiScore({
        usedToday,
        copiedToday,
        failedToday,
        used7d,
        copied7d,
        failed7d,
      });
      const saveCount = Number(row.save_count || 0);
      const communityBoost =
        source === "community" ? Math.min(12, 2 + saveCount) : 0;
      const sourceBoost =
        source === "saved" ? 20 : source === "curated" ? 4 : source === "community" ? communityBoost : 0;
      const existing = merged.get(key);
      const finePrintRaw = row.fine_print ? String(row.fine_print).trim() : "";
      const communityNote =
        source === "community" && saveCount > 0
          ? `Saved by ${saveCount} shopper${saveCount === 1 ? "" : "s"} on Cart-It — still verify at checkout.`
          : "";
      const fine_print =
        finePrintRaw || (communityNote ? communityNote : null);
      const candidate = {
        store_name: storeName,
        store_domain: normalizeStoreDomain(row.store_domain ?? null),
        code,
        discount_label: row.discount_label ? String(row.discount_label) : null,
        fine_print,
        expires_at: row.expires_at ?? null,
        source,
        save_count: source === "community" ? saveCount : undefined,
        used_today: usedToday,
        copied_today: copiedToday,
        failed_today: failedToday,
        score: ai.score + sourceBoost,
        success_rate_7d: Number(ai.successRate.toFixed(3)),
      };
      if (!existing || candidate.score > existing.score) {
        merged.set(key, candidate);
      }
    };

    for (const c of CURATED_COUPONS) {
      const hay = `${c.store_name} ${c.store_domain || ""}`.toLowerCase();
      if (hay.includes(storeQ)) pushCandidate(c, "curated");
    }
    for (const row of communitySavedRows.rows) pushCandidate(row, "community");
    for (const row of savedRows.rows) pushCandidate(row, "saved");
    for (const row of usageRows.rows) pushCandidate(row, "usage");

    const suggestions = [...merged.values()]
      .sort((a, b) => b.score - a.score || b.used_today - a.used_today || a.store_name.localeCompare(b.store_name))
      .slice(0, 12);

    return res.status(200).json({
      store_query: rawStore,
      suggestions,
      explanation:
        "Ranked from your saved codes, anonymized saves by other shoppers for this store, and recent copy/work/didn’t-work signals.",
    });
  } catch (error) {
    console.error("AI coupon suggestions failed:", error);
    return res.status(500).json({ message: "Failed to load AI coupon suggestions" });
  }
});

/** Auth: feedback loop for ranking quality (copied / used / failed). */
app.post("/api/coupons/feedback", authenticateToken, async (req: AuthRequest<CouponFeedbackBody>, res: Response) => {
  try {
    const userId = req.user!.userId;
    const store_name = String(req.body?.store_name || "").trim();
    const code = normalizeCouponCode(req.body?.code);
    const outcome = String(req.body?.outcome || "").trim().toLowerCase();
    const source = String(req.body?.source || "").trim().toLowerCase();
    if (!store_name || !code) {
      return res.status(400).json({ message: "store_name and code are required" });
    }
    if (!["copied", "used", "failed"].includes(outcome)) {
      return res.status(400).json({ message: "outcome must be copied, used, or failed" });
    }
    const safeSource = ["curated", "saved", "ai"].includes(source) ? source : null;
    await pool.query(
      `
      INSERT INTO coupon_usage_events (user_id, store_name, code, outcome, source)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, store_name.slice(0, 200), code.slice(0, 120), outcome, safeSource]
    );
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Coupon feedback failed:", error);
    return res.status(500).json({ message: "Failed to record coupon feedback" });
  }
});

// Test route to prove PostgreSQL works
app.get("/test-db", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Database test route failed:", error);
    res.status(500).json({ message: "Database test failed" });
  }
});

/**
 * POST /api/internal/run-price-check — run one price/stock pass (same logic as the in-process timer).
 * Secured with PRICE_CHECK_CRON_SECRET (header `X-Cart-It-Cron-Secret`). Use from Render Cron or Uptime
 * when the web service sleeps and setInterval is not enough.
 */
app.post("/api/internal/run-price-check", async (req: Request, res: Response) => {
  if (!PRICE_CHECK_CRON_SECRET) {
    return res.status(503).json({
      message:
        "Cron hook not configured. Set PRICE_CHECK_CRON_SECRET on the server and call again with matching header X-Cart-It-Cron-Secret.",
    });
  }
  const sent = String(req.headers["x-cart-it-cron-secret"] || "").trim();
  if (sent !== PRICE_CHECK_CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    await runPriceCheckCycle();
    return res.status(200).json({ ok: true, ranAt: new Date().toISOString() });
  } catch (error) {
    console.error("Cron price check failed:", error);
    return res.status(500).json({ message: "Price check run failed" });
  }
});

// Preview available database tables + columns
app.get("/api/db/preview", async (_req: Request, res: Response) => {
  try {
    const tableResult = await pool.query(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name ASC
      `
    );

    const columnResult = await pool.query(
      `
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name ASC, ordinal_position ASC
      `
    );

    res.status(200).json({
      tables: tableResult.rows.map((row) => row.table_name),
      columns: columnResult.rows,
    });
  } catch (error) {
    console.error("Database preview route failed:", error);
    res.status(500).json({ message: "Failed to preview database schema" });
  }
});


// REGISTER ROUTE
// Creates a new user with hashed password
app.post(
  "/api/register",
  async (req: Request<{}, {}, RegisterBody>, res: Response) => {
    try {
      const { username, email, password } = req.body;

      // Make sure required fields were sent
      if (!username || !email || !password) 
      {
        return res.status(400).json({
          message: "Username, email, and password are required",
        });
      }

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(email);

      if (existingUser) 
      {
        return res.status(409).json({
          message: "Email is already registered",
        });
      }

      // Hash password before saving
      const password_hash = await bcrypt.hash(password, 10);

      // Save new user in database
      const newUser = await storage.createUser({
        username,
        email,
        password_hash,
      });

      // Send safe user info back to frontend
      return res.status(201).json({
        message: "User registered successfully",
        user: {
          userId: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          createdAt: newUser.created_at,
        },
      });
    } catch (error) {
      console.error("Register route failed:", error);
      return res.status(500).json({
        message: "Registration failed",
      });
    }
  }
);

// LOGIN ROUTE
// Checks email & pw / returns JWT token
app.post(
  "/api/login",
  async (req: Request<{}, {}, LoginBody>, res: Response) => {
    try {
      const { email, password } = req.body;

      // Make sure both fields are present
      if (!email || !password) {
        return res.status(400).json({
          message: "Email and password are required",
        });
      }

      // Find user by email
      const existingUser = await storage.getUserByEmail(email);

      // If no user found, login fails
      if (!existingUser) {
        return res.status(401).json({
          message: "Invalid email or password",
        });
      }

      // Compare plain password to hashed password
      const isPasswordCorrect = await bcrypt.compare(
        password,
        existingUser.password_hash
      );

      if (!isPasswordCorrect) {
        return res.status(401).json({
          message: "Invalid email or password",
        });
      }

      // Create JWT token
      const token = jwt.sign(
        {
          userId: existingUser.user_id,
          email: existingUser.email,
        },
        process.env.JWT_SECRET as string,
        // Longer expiry for class demos (change to "1h" in production if you prefer).
        { expiresIn: "7d" }
      );

      // Send token & safe user info to frontend
      return res.status(200).json({
        message: "Login successful",
        token,
        user: {
          userId: existingUser.user_id,
          username: existingUser.username,
          email: existingUser.email,
          createdAt: existingUser.created_at,
        },
      });
    } catch (error) {
      console.error("Login route failed:", error);
      return res.status(500).json({
        message: "Login failed",
      });
    }
  }
);

// Public route: always returns generic success message (prevents account enumeration).
app.post(
  "/api/auth/forgot-password",
  async (req: Request<{}, {}, ForgotPasswordBody>, res: Response) => {
    const genericMessage =
      "If an account with that email exists, a password reset link has been sent.";
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(200).json({ message: genericMessage });
      }
      const existingUser = await storage.getUserByEmail(email);
      if (!existingUser) {
        return res.status(200).json({ message: genericMessage });
      }
      const token = jwt.sign(
        {
          purpose: "password_reset",
          userId: existingUser.user_id,
          email: existingUser.email,
        },
        process.env.JWT_SECRET as string,
        { expiresIn: `${RESET_PASSWORD_EXP_MINUTES}m` }
      );
      const resetUrl = `${getFrontendBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      console.log(`Attempting to send password reset email to: ${existingUser.email}`);
      const emailResult = await sendPasswordResetEmail({
        toEmail: existingUser.email,
        toName: existingUser.username || existingUser.email,
        resetUrl,
      });
      console.log(`Password reset email result for ${existingUser.email}:`, emailResult);
      if (!emailResult.sent) {
        console.warn("Password reset email not sent:", emailResult.reason);
        // If we know it failed specifically due to sandbox restrictions, we can inform the user.
        if (emailResult.reason?.includes("testing mode") || emailResult.reason?.includes("verify a domain")) {
          return res.status(200).json({ 
            message: "The reset email could not be sent due to sandbox restrictions. Resend only allows emails to the account owner in testing mode." 
          });
        }
      }
      return res.status(200).json({ message: genericMessage });
    } catch (error) {
      console.error("Forgot password route failed:", error);
      return res.status(200).json({ message: genericMessage });
    }
  }
);

app.post(
  "/api/auth/reset-password",
  async (req: Request<{}, {}, ResetPasswordBody>, res: Response) => {
    try {
      const token = String(req.body?.token || "").trim();
      const newPassword = String(req.body?.new_password || "");
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required." });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
        purpose?: string;
        userId?: number;
        email?: string;
      };
      if (
        decoded?.purpose !== "password_reset" ||
        !decoded?.userId ||
        !decoded?.email
      ) {
        return res.status(400).json({ message: "Invalid or expired reset token." });
      }
      const existingUser = await storage.getUser(Number(decoded.userId));
      if (!existingUser || String(existingUser.email).toLowerCase() !== String(decoded.email).toLowerCase()) {
        return res.status(400).json({ message: "Invalid or expired reset token." });
      }
      const password_hash = await bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE users SET password_hash = $1 WHERE user_id = $2`, [
        password_hash,
        existingUser.user_id,
      ]);
      return res.status(200).json({ message: "Password reset successful. You can now log in." });
    } catch (error) {
      return res.status(400).json({ message: "Invalid or expired reset token." });
    }
  }
);

// Returns currently authenticated user profile details
app.get("/api/me", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const currentUser = await storage.getUser(req.user!.userId);

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      user: {
        userId: currentUser.user_id,
        username: currentUser.username,
        email: currentUser.email,
        createdAt: currentUser.created_at,
      },
    });
  } catch (error) {
    console.error("Fetch current user failed:", error);
    return res.status(500).json({ message: "Failed to fetch current user" });
  }
});

/**
 * Safe feature flags for the signed-in client (no secrets).
 * Used by the web app to explain optional email alerts vs in-app notifications only.
 */
app.get("/api/me/features", authenticateToken, async (_req: AuthRequest, res: Response) => {
  const resendKey = String(process.env.RESEND_API_KEY || "").trim();
  const resendFrom = String(process.env.RESEND_FROM_EMAIL || "").trim();
  return res.status(200).json({
    resend_email_configured: Boolean(resendKey && resendFrom),
  });
});

/** Signed URL token for read-only /share/:token (cart). No DB migration — JWT embeds owner user id. */
app.get("/api/me/public-cart-token", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const token = jwt.sign(
      { purpose: "public_cart", userId: req.user!.userId },
      process.env.JWT_SECRET as string,
      { expiresIn: "90d" }
    );
    return res.status(200).json({ token });
  } catch (error) {
    console.error("public-cart-token failed:", error);
    return res.status(500).json({ message: "Could not create share link" });
  }
});

/** Signed URL token for read-only wishlist share (/share-wishlist/:token/:groupId). */
app.get(
  "/api/groups/:id/public-share-token",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const group_id = Number(req.params.id);
      const userId = req.user!.userId;
      if (isNaN(group_id)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }
      const allowed = await userCanAccessGroup(userId, group_id);
      if (!allowed) {
        return res.status(404).json({ message: "Wishlist not found" });
      }
      const token = jwt.sign(
        { purpose: "public_group", groupId: group_id },
        process.env.JWT_SECRET as string,
        { expiresIn: "90d" }
      );
      return res.status(200).json({ token });
    } catch (error) {
      console.error("public-share-token failed:", error);
      return res.status(500).json({ message: "Could not create share link" });
    }
  }
);

function shapePublicCartRow(
  row: Record<string, unknown>,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    item_id: row.item_id,
    product_name: row.item_name,
    store_name: row.store ?? "—",
    price: row.current_price,
    product_url: row.product_url,
    image_url: row.image_url,
    username: row.username ?? null,
    ...extras,
  };
}

/** Read-only: unpurchased items for the cart owner (matches “still shopping” snapshot). */
app.get("/api/public/cart/:token", async (req: Request, res: Response) => {
  try {
    const raw = String(req.params.token || "").trim();
    const decoded = jwt.verify(raw, process.env.JWT_SECRET as string) as {
      purpose?: string;
      userId?: number;
    };
    if (decoded.purpose !== "public_cart" || !decoded.userId) {
      return res.status(400).json({ message: "Invalid share link" });
    }
    const result = await pool.query(
      `
      SELECT ci.*, u.username
      FROM cart_items ci
      JOIN users u ON u.user_id = ci.user_id
      WHERE ci.user_id = $1 AND ci.is_purchased = false
      ORDER BY ci.item_id DESC
      `,
      [decoded.userId]
    );
    return res
      .status(200)
      .json(result.rows.map((r) => shapePublicCartRow(r as Record<string, unknown>)));
  } catch {
    return res.status(400).json({ message: "Invalid or expired share link" });
  }
});

/** Read-only: unpurchased items in a wishlist when token matches group id. */
app.get(
  "/api/public/wishlist/:token/:groupId",
  async (req: Request, res: Response) => {
    try {
      const raw = String(req.params.token || "").trim();
      const groupId = Number(req.params.groupId);
      const decoded = jwt.verify(raw, process.env.JWT_SECRET as string) as {
        purpose?: string;
        groupId?: number;
      };
      if (
        decoded.purpose !== "public_group" ||
        !decoded.groupId ||
        Number(decoded.groupId) !== groupId ||
        isNaN(groupId)
      ) {
        return res.status(400).json({ message: "Invalid share link" });
      }
      const g = await pool.query(
        `SELECT group_id, group_name, owner_id FROM groups WHERE group_id = $1`,
        [groupId]
      );
      if (g.rows.length === 0) {
        return res.status(404).json({ message: "List not found" });
      }
      const owner = await storage.getUser(Number(g.rows[0].owner_id));
      const groupName = String(g.rows[0].group_name || "Wishlist");
      const items = await pool.query(
        `
        SELECT ci.*, u.username
        FROM cart_items ci
        JOIN users u ON u.user_id = ci.user_id
        WHERE ci.group_id = $1 AND ci.is_purchased = false
        ORDER BY ci.item_id DESC
        `,
        [groupId]
      );
      const ownerName = owner?.username ?? items.rows[0]?.username ?? "Someone";
      return res.status(200).json(
        items.rows.map((r) =>
          shapePublicCartRow(r as Record<string, unknown>, {
            wishlist_name: groupName,
            username: ownerName,
          })
        )
      );
    } catch {
      return res.status(400).json({ message: "Invalid or expired share link" });
    }
  }
);

// GROUP ROUTES
// FRONTEND LINK:
// - Dashboard page calls /api/groups to render wishlist cards.
// - Wishlist page calls /api/groups/:id for one list and /api/groups/:id/invite for collaboration.
// - Create modal on dashboard calls POST /api/groups.

/**
 * GET /api/groups — wishlists the logged-in user should see in the sidebar + dashboard.
 *
 * WHY two SELECTs glued with UNION ALL:
 *   1) First branch: lists YOU created (you are always the Owner row in `groups`).
 *   2) Second branch: lists someone ELSE owns but invited you to — those memberships live in
 *      `group_members`. Without the JOIN, User B would never see User A's shared list after invite.
 *
 * WHAT we return: one combined list, newest first, each row tagged with `access_role` so the UI
 * can show owner-only controls (rename/delete) vs collaborator controls.
 */
app.get("/api/groups", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await pool.query(
      `
      SELECT * FROM (
        SELECT g.*, 'Owner'::text AS access_role
        FROM groups g
        WHERE g.owner_id = $1
        UNION ALL
        SELECT g.*, gm.role::text AS access_role
        FROM groups g
        INNER JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = $1
        WHERE g.owner_id <> $1
      ) AS combined
      ORDER BY combined.created_at DESC
      `,
      [userId]
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Get groups failed:", error);

    return res.status(500).json({
      message: "Failed to fetch groups",
    });
  }
});

// GET one group if you own it or are a collaborator
app.get("/api/groups/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const group_id = Number(req.params.id);
    const userId = req.user!.userId;
    if (isNaN(group_id)) {
      return res.status(400).json({ message: "Invalid group ID" });
    }
    const result = await pool.query(
      `
      SELECT
        g.*,
        CASE
          WHEN g.owner_id = $2 THEN 'Owner'
          ELSE COALESCE(
            (
              SELECT gm.role::text
              FROM group_members gm
              WHERE gm.group_id = g.group_id AND gm.user_id = $2
              LIMIT 1
            ),
            'Editor'
          )
        END AS access_role
      FROM groups g
      WHERE g.group_id = $1
        AND (
          g.owner_id = $2
          OR EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = g.group_id AND gm.user_id = $2
          )
        )
      `,
      [group_id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Get group failed:", error);
    return res.status(500).json({ message: "Failed to fetch category" });
  }
});

app.get(
  "/api/groups/:id/comments",
  authenticateToken,
  async (req: AuthRequest<any, { id: string }>, res: Response) => {
    try {
      const group_id = Number(req.params.id);
      const userId = req.user!.userId;
      if (isNaN(group_id)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }
      const allowed = await userCanAccessGroup(userId, group_id);
      if (!allowed) {
        return res.status(404).json({ message: "Group not found" });
      }

      const rows = await pool.query(
        `
        SELECT
          gc.comment_id,
          gc.group_id,
          gc.user_id,
          gc.body,
          gc.created_at,
          u.username,
          u.email
        FROM group_comments gc
        JOIN users u ON u.user_id = gc.user_id
        WHERE gc.group_id = $1
        ORDER BY gc.created_at ASC, gc.comment_id ASC
        `,
        [group_id]
      );
      return res.status(200).json(rows.rows);
    } catch (error) {
      console.error("Fetch group-level comments failed:", error);
      return res.status(500).json({ message: "Failed to fetch group comments" });
    }
  }
);

app.post(
  "/api/groups/:id/comments",
  authenticateToken,
  async (req: AuthRequest<GroupCommentBody, { id: string }>, res: Response) => {
    try {
      const group_id = Number(req.params.id);
      const userId = req.user!.userId;
      const text = String(req.body?.body ?? "").trim();
      if (isNaN(group_id)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }
      if (!text) {
        return res.status(400).json({ message: "Comment text is required" });
      }
      const allowed = await userCanAccessGroup(userId, group_id);
      if (!allowed) {
        return res.status(404).json({ message: "Group not found" });
      }

      const ins = await pool.query(
        `
        INSERT INTO group_comments (group_id, user_id, body)
        VALUES ($1, $2, $3)
        RETURNING comment_id, group_id, user_id, body, created_at
        `,
        [group_id, userId, text]
      );
      const who = await storage.getUser(userId);

      // Notify other members of the wishlist
      const groupRow = await pool.query(`SELECT group_name FROM groups WHERE group_id = $1`, [group_id]);
      const groupLabel = groupRow.rows[0]?.group_name || "a wishlist";
      const senderLabel = who?.username || who?.email || "Someone";
      
      await notifyGroupPeers({
        groupId: group_id,
        senderUserId: userId,
        message: `${senderLabel} posted in "${groupLabel}" chat: "${text.length > 30 ? text.slice(0, 27) + '...' : text}"`,
      });

      return res.status(201).json({
        ...ins.rows[0],
        username: who?.username ?? null,
        email: who?.email ?? null,
      });
    } catch (error) {
      console.error("Post group-level comment failed:", error);
      return res.status(500).json({ message: "Failed to post group comment" });
    }
  }
);

// CREATE a new group for a user thats logged in 
app.post(
  "/api/groups",
  authenticateToken,
  async (req: AuthRequest<CreateGroupBody>, res: Response) => {
    try {
      const { group_name, color, visibility } = req.body;

      const owner_id = req.user!.userId;

      // Group name is required
      if (!group_name) {
        return res.status(400).json({
          message: "Group name is required",
        });
      }

      // Save group in database
      const newGroup = await storage.createGroup({
        owner_id,
        group_name,
        color,
        visibility,
      });

      return res.status(201).json({
        message: "Group created successfully",
        group: newGroup,
      });
    } catch (error) {
      console.error("Create group failed:", error);

      return res.status(500).json({
        message: "Failed to create group",
      });
    }
  }
);

// UPDATE group/category by id (name, color, visibility)
app.patch(
  "/api/groups/:id",
  authenticateToken,
  async (req: AuthRequest<UpdateGroupBody>, res: Response) => {
    try {
      const group_id = Number(req.params.id);
      const user_id = req.user!.userId;
      const { group_name, color, visibility } = req.body;

      if (isNaN(group_id)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }

      const accessResult = await pool.query(
        `
        SELECT
          g.owner_id,
          CASE
            WHEN g.owner_id = $2 THEN 'Owner'
            ELSE (
              SELECT gm.role
              FROM group_members gm
              WHERE gm.group_id = g.group_id AND gm.user_id = $2
              LIMIT 1
            )
          END AS access_role
        FROM groups g
        WHERE g.group_id = $1
        `,
        [group_id, user_id]
      );
      if (accessResult.rows.length === 0 || !accessResult.rows[0].access_role) {
        return res.status(404).json({ message: "Group not found for this user" });
      }
      const isOwner = Number(accessResult.rows[0].owner_id) === Number(user_id);

      const fieldsToUpdate: string[] = [];
      const values: Array<string | number | null> = [];
      let valueIndex = 1;

      if (group_name !== undefined) {
        fieldsToUpdate.push(`group_name = $${valueIndex++}`);
        values.push(group_name);
      }

      if (color !== undefined) {
        if (!isOwner) {
          return res.status(403).json({ message: "Only the owner can change color." });
        }
        fieldsToUpdate.push(`color = $${valueIndex++}`);
        values.push(color);
      }

      if (visibility !== undefined) {
        if (!isOwner) {
          return res.status(403).json({ message: "Only the owner can change visibility." });
        }
        fieldsToUpdate.push(`visibility = $${valueIndex++}`);
        values.push(visibility);
      }

      if (fieldsToUpdate.length === 0) {
        return res.status(400).json({
          message: "No valid fields were provided for update",
        });
      }

      values.push(group_id);
      values.push(user_id);

      const result = await pool.query(
        `
        UPDATE groups
        SET ${fieldsToUpdate.join(", ")}
        WHERE group_id = $${valueIndex++} AND (
          owner_id = $${valueIndex}
          OR EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = groups.group_id AND gm.user_id = $${valueIndex}
          )
        )
        RETURNING *
        `,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Group not found for this user",
        });
      }

      return res.status(200).json({
        message: "Group updated successfully",
        group: result.rows[0],
      });
    } catch (error) {
      console.error("Update group failed:", error);
      return res.status(500).json({
        message: "Failed to update group",
      });
    }
  }
);

// DELETE a group by id
app.delete(
  "/api/groups/:id",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const group_id = Number(req.params.id);

      // Check if id is a valid number
      if (isNaN(group_id)) {
        return res.status(400).json({
          message: "Invalid group ID",
        });
      }

      // Delete from database
      const owner_id = req.user!.userId;
      const deleted = await storage.deleteGroup(group_id, owner_id);

      if (!deleted) {
        return res.status(404).json({
          message: "Group not found or you do not own it",
        });
      }

      return res.status(200).json({
        message: "Group deleted successfully",
      });
    } catch (error) {
      console.error("Delete group failed:", error);

      return res.status(500).json({
        message: "Failed to delete group",
      });
    }
  }
);

// SIMPLE DATA ROUTES FOR TESTING / FRONTEND
// These help prove DB is connected and let
// frontend pull real data
// FRONTEND LINK:
// - Extension and pages call /api/cart-items for item lists.
// - Notifications: GET /api/notifications, PATCH /api/notifications/:id, POST /api/notifications/mark-all-read.
// - Coupons: GET/POST /api/coupons, GET /api/coupons/shop-stores, PATCH/DELETE /api/coupons/:id.
app.get("/api/users", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const owner_id = req.user!.userId;
    const result = await pool.query(
      "SELECT user_id, username, email, created_at FROM users WHERE user_id = $1",
      [owner_id]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Fetch users failed:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

app.get("/api/cart-items", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const rawQ = req.query.group_id;
    const groupIdStr =
      typeof rawQ === "string" ? rawQ : Array.isArray(rawQ) ? rawQ[0] : undefined;

    if (groupIdStr !== undefined && groupIdStr !== "") {
      const gid = Number(groupIdStr);
      if (isNaN(gid)) {
        return res.status(400).json({ message: "Invalid group_id query" });
      }
      const ok = await userCanAccessGroup(userId, gid);
      if (!ok) {
        return res.status(404).json({ message: "Category not found" });
      }
      const result = await pool.query(
        `
        SELECT
          ci.item_id,
          ci.user_id,
          ci.group_id,
          ci.item_name,
          ci.product_url,
          ci.image_url,
          ci.store,
          ci.current_price,
          ci.is_in_stock,
          ci.is_purchased,
          ci.purchase_price,
          ci.purchase_date,
          ci.created_at,
          COALESCE(ipn.body, ci.notes) AS notes
        FROM cart_items ci
        LEFT JOIN item_private_notes ipn ON ipn.item_id = ci.item_id AND ipn.user_id = $1
        WHERE ci.group_id = $2
        ORDER BY ci.item_id DESC
        `,
        [userId, gid]
      );
      return res.status(200).json(result.rows.map(shapeCartItemResponse));
    }

    const result = await pool.query(
      `
      WITH visible AS (
        SELECT ci.*
        FROM cart_items ci
        WHERE ci.user_id = $1
           OR (
             ci.group_id IS NOT NULL
             AND (
               EXISTS (
                 SELECT 1 FROM groups g
                 WHERE g.group_id = ci.group_id AND g.owner_id = $1
               )
               OR EXISTS (
                 SELECT 1 FROM group_members gm
                 WHERE gm.group_id = ci.group_id AND gm.user_id = $1
               )
             )
           )
      )
      SELECT
        v.item_id,
        v.user_id,
        v.group_id,
        v.item_name,
        v.product_url,
        v.image_url,
        v.store,
        v.current_price,
        v.is_in_stock,
        v.is_purchased,
        v.purchase_price,
        v.purchase_date,
        v.created_at,
        COALESCE(ipn.body, v.notes) AS notes
      FROM visible v
      LEFT JOIN item_private_notes ipn ON ipn.item_id = v.item_id AND ipn.user_id = $1
      ORDER BY v.item_id DESC
      `,
      [userId]
    );
    res.status(200).json(result.rows.map(shapeCartItemResponse));
  } catch (error) {
    console.error("Fetch cart items failed:", error);
    res.status(500).json({ message: "Failed to fetch cart items" });
  }
});

// Dashboard route (JOINS multiple tables together)
app.get("/api/dashboard", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const owner_id = req.user!.userId;
    const result = await pool.query(`
      SELECT 
        ci.item_id,
        ci.item_name,
        ci.image_url,
        ci.store,
        ci.current_price,
        ci.is_purchased,
        COALESCE(ipn.body, ci.notes) AS notes,
        u.username,
        COALESCE(g.group_name, 'No Group') AS group_name,
        g.color AS group_color
      FROM cart_items ci
      JOIN users u ON ci.user_id = u.user_id
      LEFT JOIN groups g ON ci.group_id = g.group_id
      LEFT JOIN item_private_notes ipn ON ipn.item_id = ci.item_id AND ipn.user_id = $1
      WHERE ci.user_id = $1
      ORDER BY ci.item_id ASC;
    `, [owner_id]);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Dashboard fetch failed:", error);
    res.status(500).json({
      message: "Failed to fetch dashboard data"
    });
  }
});

app.get("/api/notifications", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const owner_id = req.user!.userId;
    const result = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY notification_id DESC",
      [owner_id]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Fetch notifications failed:", error);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

app.post("/api/notifications/mark-all-read", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    await pool.query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [
      userId,
    ]);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Mark all notifications read failed:", error);
    res.status(500).json({ message: "Failed to update notifications" });
  }
});

app.patch(
  "/api/notifications/:id",
  authenticateToken,
  async (req: AuthRequest<{ is_read?: boolean }, { id: string }>, res: Response) => {
    try {
      const userId = req.user!.userId;
      const notificationId = Number(req.params.id);
      if (!Number.isFinite(notificationId) || notificationId < 1) {
        return res.status(400).json({ message: "Invalid notification id" });
      }
      const isRead = req.body?.is_read;
      if (typeof isRead !== "boolean") {
        return res.status(400).json({ message: "is_read (boolean) is required" });
      }
      const result = await pool.query(
        `
        UPDATE notifications
        SET is_read = $1
        WHERE notification_id = $2 AND user_id = $3
        RETURNING *
        `,
        [isRead, notificationId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error("Patch notification failed:", error);
      res.status(500).json({ message: "Failed to update notification" });
    }
  }
);

app.get("/api/price-history", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const owner_id = req.user!.userId;
    const result = await pool.query(
      `
      SELECT ph.*
      FROM price_history ph
      JOIN cart_items ci ON ci.item_id = ph.item_id
      WHERE ci.user_id = $1
      ORDER BY ph.history_id ASC
      `,
      [owner_id]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Fetch price history failed:", error);
    res.status(500).json({ message: "Failed to fetch price history" });
  }
});

/** Price chart data for one item (modal). Rows shaped as `{ date, price }` for Recharts. */
app.get(
  "/api/cart-items/:id/price-history",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const item_id = Number(req.params.id);
      const userId = req.user!.userId;
      if (!Number.isFinite(item_id)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }
      const row = await pool.query(
        `SELECT user_id, group_id FROM cart_items WHERE item_id = $1`,
        [item_id]
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }
      const can = await userCanEditCartItemRow(userId, {
        user_id: row.rows[0].user_id,
        group_id: row.rows[0].group_id,
      });
      if (!can) {
        return res.status(403).json({ message: "Access denied" });
      }
      const hist = await pool.query(
        `
        SELECT price, recorded_at
        FROM price_history
        WHERE item_id = $1
        ORDER BY recorded_at ASC, history_id ASC
        `,
        [item_id]
      );
      const chart = hist.rows.map((h) => ({
        date: new Date(String(h.recorded_at)).toLocaleDateString(),
        price: Number(h.price),
      }));
      return res.status(200).json(chart);
    } catch (error) {
      console.error("Fetch item price history failed:", error);
      return res.status(500).json({ message: "Failed to fetch price history" });
    }
  }
);

function normalizeStoreDomain(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "");
  s = s.split("/")[0] || "";
  s = s.toLowerCase();
  return s.length > 0 ? s.slice(0, 255) : null;
}

function normalizeStoreName(input: string | null | undefined): string {
  return String(input || "").trim().toLowerCase();
}

function normalizeCouponCode(input: string | null | undefined): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function computeCouponAiScore(args: {
  usedToday: number;
  copiedToday: number;
  failedToday: number;
  used7d: number;
  copied7d: number;
  failed7d: number;
}) {
  const { usedToday, copiedToday, failedToday, used7d, copied7d, failed7d } = args;
  const denom = Math.max(1, used7d + failed7d);
  const successRate = used7d / denom;
  const momentum = usedToday * 4 + copiedToday * 1.5 - failedToday * 2;
  const reliability = successRate * 35;
  const volume = Math.min(25, used7d * 2 + copied7d * 0.5);
  const penalty = Math.min(20, failed7d * 1.2);
  const score = Math.max(0, Math.round(momentum + reliability + volume - penalty));
  return { score, successRate };
}

/**
 * GET /api/coupons/shop-stores — distinct store names from saved items (helps pick stores you shop).
 */
app.get(
  "/api/coupons/shop-stores",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const r = await pool.query(
        `
        SELECT DISTINCT NULLIF(TRIM(store), '') AS store
        FROM cart_items
        WHERE user_id = $1 AND store IS NOT NULL
        ORDER BY 1 ASC
        `,
        [userId]
      );
      const names = r.rows
        .map((row) => String(row.store || "").trim())
        .filter((s) => s.length > 0);
      return res.status(200).json(names);
    } catch (error) {
      console.error("Shop stores list failed:", error);
      return res.status(500).json({ message: "Failed to load stores" });
    }
  }
);

/**
 * GET /api/coupons — list this user's saved coupon codes, optional ?store= & ?q= search.
 */
app.get("/api/coupons", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const storeFilter = String(req.query.store || "").trim();
    const q = String(req.query.q || "").trim();
    const params: unknown[] = [userId];
    let p = 2;
    let sql = `
      SELECT
        coupon_id,
        store_name,
        store_domain,
        code,
        discount_label,
        fine_print,
        expires_at,
        created_at,
        updated_at
      FROM user_store_coupons
      WHERE user_id = $1
    `;
    if (storeFilter) {
      sql += ` AND (
        LOWER(store_name) LIKE $${p}
        OR LOWER(COALESCE(store_domain, '')) LIKE $${p}
      )`;
      params.push(`%${storeFilter.toLowerCase()}%`);
      p++;
    }
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      sql += ` AND (
        LOWER(code) LIKE $${p}
        OR LOWER(store_name) LIKE $${p}
        OR LOWER(COALESCE(discount_label, '')) LIKE $${p}
        OR LOWER(COALESCE(fine_print, '')) LIKE $${p}
      )`;
      params.push(like);
      p++;
    }
    sql += ` ORDER BY store_name ASC NULLS LAST, created_at DESC`;
    const result = await pool.query(sql, params);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("List coupons failed:", error);
    return res.status(500).json({ message: "Failed to load coupons" });
  }
});

app.post(
  "/api/coupons",
  authenticateToken,
  async (req: AuthRequest<CreateUserCouponBody>, res: Response) => {
    try {
      const userId = req.user!.userId;
      const store_name = String(req.body?.store_name || "").trim();
      const code = String(req.body?.code || "").trim();
      if (!store_name || !code) {
        return res.status(400).json({ message: "store_name and code are required" });
      }
      const discount_label = req.body?.discount_label
        ? String(req.body.discount_label).trim().slice(0, 300)
        : null;
      const fine_print = req.body?.fine_print ? String(req.body.fine_print).trim() : null;
      const store_domain = normalizeStoreDomain(req.body?.store_domain ?? null);
      let expires_at: Date | null = null;
      if (req.body?.expires_at != null && String(req.body.expires_at).trim() !== "") {
        const d = new Date(String(req.body.expires_at));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid expires_at date" });
        }
        expires_at = d;
      }
      const ins = await pool.query(
        `
        INSERT INTO user_store_coupons (
          user_id, store_name, store_domain, code, discount_label, fine_print, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
          userId,
          store_name.slice(0, 200),
          store_domain,
          code.slice(0, 120),
          discount_label,
          fine_print,
          expires_at,
        ]
      );
      return res.status(201).json(ins.rows[0]);
    } catch (error) {
      console.error("Create coupon failed:", error);
      return res.status(500).json({ message: "Failed to save coupon" });
    }
  }
);

app.patch(
  "/api/coupons/:id",
  authenticateToken,
  async (req: AuthRequest<UpdateUserCouponBody, { id: string }>, res: Response) => {
    try {
      const userId = req.user!.userId;
      const coupon_id = Number(req.params.id);
      if (!Number.isFinite(coupon_id)) {
        return res.status(400).json({ message: "Invalid coupon id" });
      }
      const own = await pool.query(
        `SELECT coupon_id FROM user_store_coupons WHERE coupon_id = $1 AND user_id = $2`,
        [coupon_id, userId]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({ message: "Coupon not found" });
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let vi = 1;
      const b = req.body || {};
      if (b.store_name !== undefined) {
        const v = String(b.store_name || "").trim();
        if (!v) return res.status(400).json({ message: "store_name cannot be empty" });
        fields.push(`store_name = $${vi++}`);
        values.push(v.slice(0, 200));
      }
      if (b.store_domain !== undefined) {
        fields.push(`store_domain = $${vi++}`);
        values.push(normalizeStoreDomain(b.store_domain));
      }
      if (b.code !== undefined) {
        const v = String(b.code || "").trim();
        if (!v) return res.status(400).json({ message: "code cannot be empty" });
        fields.push(`code = $${vi++}`);
        values.push(v.slice(0, 120));
      }
      if (b.discount_label !== undefined) {
        const v = b.discount_label == null ? null : String(b.discount_label).trim().slice(0, 300);
        fields.push(`discount_label = $${vi++}`);
        values.push(v);
      }
      if (b.fine_print !== undefined) {
        const v = b.fine_print == null ? null : String(b.fine_print).trim();
        fields.push(`fine_print = $${vi++}`);
        values.push(v);
      }
      if (b.expires_at !== undefined) {
        if (b.expires_at === null || String(b.expires_at).trim() === "") {
          fields.push(`expires_at = $${vi++}`);
          values.push(null);
        } else {
          const d = new Date(String(b.expires_at));
          if (Number.isNaN(d.getTime())) {
            return res.status(400).json({ message: "Invalid expires_at date" });
          }
          fields.push(`expires_at = $${vi++}`);
          values.push(d);
        }
      }
      if (fields.length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(coupon_id, userId);
      const wc1 = vi;
      const wc2 = vi + 1;
      const result = await pool.query(
        `
        UPDATE user_store_coupons
        SET ${fields.join(", ")}
        WHERE coupon_id = $${wc1} AND user_id = $${wc2}
        RETURNING *
        `,
        values
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Coupon not found" });
      }
      return res.status(200).json(result.rows[0]);
    } catch (error) {
      console.error("Update coupon failed:", error);
      return res.status(500).json({ message: "Failed to update coupon" });
    }
  }
);

app.delete(
  "/api/coupons/:id",
  authenticateToken,
  async (req: AuthRequest<unknown, { id: string }>, res: Response) => {
    try {
      const userId = req.user!.userId;
      const coupon_id = Number(req.params.id);
      if (!Number.isFinite(coupon_id)) {
        return res.status(400).json({ message: "Invalid coupon id" });
      }
      const del = await pool.query(
        `DELETE FROM user_store_coupons WHERE coupon_id = $1 AND user_id = $2 RETURNING coupon_id`,
        [coupon_id, userId]
      );
      if (del.rows.length === 0) {
        return res.status(404).json({ message: "Coupon not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Delete coupon failed:", error);
      return res.status(500).json({ message: "Failed to delete coupon" });
    }
  }
);

app.get("/api/group-members", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const owner_id = req.user!.userId;
    const result = await pool.query(
      `
      SELECT DISTINCT ON (visible_members.group_id, visible_members.user_id) *
      FROM (
        SELECT
          g.group_id,
          g.owner_id AS user_id,
          'Owner'::text AS role,
          g.created_at AS joined_at,
          u.username,
          u.email
        FROM groups g
        JOIN users u ON u.user_id = g.owner_id
        WHERE g.owner_id = $1
           OR EXISTS (
             SELECT 1 FROM group_members gm
             WHERE gm.group_id = g.group_id AND gm.user_id = $1
           )
        UNION ALL
        SELECT
          gm.group_id,
          gm.user_id,
          gm.role,
          gm.joined_at,
          u.username,
          u.email
        FROM group_members gm
        JOIN groups g ON g.group_id = gm.group_id
        JOIN users u ON u.user_id = gm.user_id
        WHERE g.owner_id = $1 OR gm.user_id = $1
      ) visible_members
      ORDER BY
        visible_members.group_id ASC,
        visible_members.user_id ASC,
        CASE WHEN visible_members.role = 'Owner' THEN 0 ELSE 1 END ASC
      `,
      [owner_id]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Fetch group members failed:", error);
    res.status(500).json({ message: "Failed to fetch group members" });
  }
});

/**
 * POST /api/groups/:id/invite — add a collaborator to a shared wishlist.
 *
 * WHAT you can send (pick ONE lookup style — both end up as the same `group_members` row):
 *   • `{ "email": "friend@school.edu" }` — most human-friendly for demos.
 *   • `{ "user_id": 12 }` — handy when you already know their Cart-It id from `/api/users` etc.
 *
 * WHY we still require an existing Cart-It account:
 *   Invites attach a real `user_id` foreign key — we cannot invite random emails that are not users yet.
 */
app.post(
  "/api/groups/:id/invite",
  authenticateToken,
  async (req: AuthRequest<InviteGroupMemberBody, { id: string }>, res: Response) => {
    try {
      const group_id = Number(req.params.id);
      const owner_id = req.user!.userId;
      const email = String(req.body?.email || "").trim().toLowerCase();
      const rawUserId = req.body?.user_id;
      const role = req.body?.role === "Owner" ? "Owner" : "Editor";

      if (isNaN(group_id)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }
      if (!email && (rawUserId === undefined || rawUserId === null)) {
        return res.status(400).json({ message: "Invite email or user_id is required" });
      }
      const numericInviteeId = Number(rawUserId);
      if (!email && (!Number.isFinite(numericInviteeId) || numericInviteeId < 1)) {
        return res.status(400).json({ message: "Invalid user_id for invite" });
      }

      const ownedGroup = await pool.query(
        `
        SELECT g.group_id, g.group_name, g.visibility, u.username AS owner_username, u.email AS owner_email
        FROM groups g
        JOIN users u ON u.user_id = g.owner_id
        WHERE g.group_id = $1 AND g.owner_id = $2
        `,
        [group_id, owner_id]
      );
      if (ownedGroup.rows.length === 0) {
        return res.status(404).json({ message: "Group not found or you do not own it" });
      }

      let invitedUser =
        email.length > 0
          ? await storage.getUserByEmail(email)
          : await storage.getUser(numericInviteeId);
      if (!invitedUser) {
        return res.status(404).json({
          message: email.length > 0
            ? "No Cart-It user found for that email yet."
            : "No Cart-It user found for that user_id.",
        });
      }
      if (invitedUser.user_id === owner_id) {
        return res.status(400).json({ message: "You already own this wishlist." });
      }

      // Add or update collaborator role for this shared list.
      await pool.query(
        `
        INSERT INTO group_members (group_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `,
        [group_id, invitedUser.user_id, role]
      );

      // Safety: if owner invites someone to a private list, automatically make it shared.
      if (ownedGroup.rows[0].visibility !== "Shared") {
        await pool.query(`UPDATE groups SET visibility = 'Shared' WHERE group_id = $1`, [group_id]);
      }

      const inviteUrl = `${getFrontendBaseUrl()}/dashboard`;
      const emailResult = await sendGroupInviteEmail({
        toEmail: invitedUser.email,
        toName: invitedUser.username || invitedUser.email,
        ownerName: ownedGroup.rows[0].owner_username || ownedGroup.rows[0].owner_email || "A Cart-It user",
        groupName: ownedGroup.rows[0].group_name || "Shared wishlist",
        inviteUrl,
      });

      const firstGroupItem = await pool.query(
        `SELECT item_id FROM cart_items WHERE group_id = $1 ORDER BY item_id ASC LIMIT 1`,
        [group_id]
      );
      const anchorItemId =
        firstGroupItem.rows.length > 0 ? Number(firstGroupItem.rows[0].item_id) : null;
      const invitedLabel = invitedUser.username || invitedUser.email || "A user";
      const groupLabel = ownedGroup.rows[0].group_name || "Shared wishlist";
      const ownerDisplay =
        ownedGroup.rows[0].owner_username || ownedGroup.rows[0].owner_email || "Someone";

      await insertUserNotification({
        userId: invitedUser.user_id,
        itemId: anchorItemId,
        groupId: group_id,
        message: `${ownerDisplay} invited you to collaborate on "${groupLabel}".`,
      });

      const peerNotify = await pool.query(
        `
        SELECT DISTINCT uid FROM (
          SELECT owner_id AS uid FROM groups WHERE group_id = $1
          UNION
          SELECT user_id AS uid FROM group_members WHERE group_id = $1
        ) peers
        WHERE uid IS NOT NULL AND uid <> $2
        `,
        [group_id, invitedUser.user_id]
      );
      const joinMsg = `${invitedLabel} joined "${groupLabel}" as Editor.`;
      for (const row of peerNotify.rows) {
        const uid = Number(row.uid);
        if (!Number.isFinite(uid)) continue;
        await insertUserNotification({
          userId: uid,
          itemId: anchorItemId,
          groupId: group_id,
          message: joinMsg,
        });
      }

      return res.status(200).json({
        message: emailResult.sent
          ? "Invite sent successfully"
          : `Member added, but email was not sent: ${emailResult.reason}`,
        email_sent: emailResult.sent,
        email_error: emailResult.sent ? null : emailResult.reason,
        invited: {
          user_id: invitedUser.user_id,
          email: invitedUser.email,
          username: invitedUser.username,
        },
      });
    } catch (error) {
      console.error("Invite group member failed:", error);
      return res.status(500).json({ message: "Failed to invite member" });
    }
  }
);

/**
 * POST /api/cart-items — save a product row (extension + website both hit this).
 *
 * WHY user_id never comes from JSON:
 *   Trust the signed-in user from the JWT only — prevents someone forging saves under another account.
 *
 * WHY we accept BOTH `current_price` and `price`:
 *   Different clients evolved at different times; accepting both avoids silent $0 inserts when the
 *   field name does not match exactly.
 */
app.post(
  "/api/cart-items",
  authenticateToken,
  async (req: AuthRequest<CreateCartItemBody>, res: Response) => {
  try 
  {
    const user_id = req.user!.userId;
    const {
      group_id,
      item_name,
      product_url,
      image_url,
      store,
      current_price,
      price,
      is_in_stock,
      notes,
    } = req.body;

    const itemName = typeof item_name === "string" ? item_name.trim().slice(0, 250) : "";
    const productUrl = typeof product_url === "string" && product_url.trim() !== ""
    ? product_url.trim()
    : (req.headers.referer || "");
    const storeTruncated = typeof store === "string" ? store.trim().slice(0, 95) : null;

    if (String(process.env.DEBUG_CART_POST || "").trim() === "1") {
      console.log("POST /api/cart-items body:", req.body, "product_url:", productUrl);
    }

    // Accept `current_price` and legacy `price`; coerce strings ("199,00", "$130") like the price checker.
    const fromCurrent = parsePositivePrice(current_price);
    const fromLegacy = parsePositivePrice(price);
    let priceNum =
      fromCurrent != null && fromCurrent > 0
        ? fromCurrent
        : fromLegacy != null && fromLegacy > 0
          ? fromLegacy
          : NaN;

    if (!itemName) {
      console.warn("POST /api/cart-items: Missing itemName for user", user_id);
      return res.status(400).json({
        message: "Missing required field: item_name",
      });
    }
    
    console.log(`Saving item for user ${user_id}. Name: "${itemName}", URL: ${productUrl}, Price: ${current_price ?? price}`);
    // Reuse one HTML fetch for both price backfill and image extraction when needed.
    let cachedProductHtml: string | null | undefined;
    const loadProductHtml = async (): Promise<string | null> => {
      if (cachedProductHtml !== undefined) return cachedProductHtml;
      cachedProductHtml = await fetchHtmlForProductUrl(productUrl);
      return cachedProductHtml;
    };

    // If the extension sent 0 or omitted price, try one server-side fetch (same HTML parser as the background job).
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      const html = await loadProductHtml();
      if (html) {
        const fromPage = extractPriceFromHtml(html);
        if (fromPage != null && fromPage > 0) {
          priceNum = fromPage;
        }
      }
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({
        message:
          "Could not determine a valid price. Enter a positive price in the extension, or use a product URL the server can open.",
      });
    }

    /**
     * Amazon PDPs often mislead pure DOM scrapes (e.g. “free shipping over $35”).
     * When ScrapingBee is configured we fetch the same HTML path as the price-check job and prefer
     * server-side price + image for Amazon saves (extension + website).
     */
    let resolvedImage: string | null =
      typeof image_url === "string" && image_url.trim() !== "" ? image_url.trim() : null;
    const enrichAmazonFlag = String(process.env.SCRAPINGBEE_ENRICH_AMAZON ?? "1")
      .trim()
      .toLowerCase();
    const enrichAmazon =
      scrapingBeeConfigured() &&
      isAmazonProductUrl(productUrl) &&
      enrichAmazonFlag !== "false" &&
      enrichAmazonFlag !== "0";
    if (enrichAmazon) {
      const html = await loadProductHtml();
      if (html) {
        const serverPrice = extractPriceFromHtml(html);
        if (serverPrice != null && serverPrice > 0) {
          priceNum = serverPrice;
        }
        const serverImg = extractProductImageFromHtml(html, productUrl);
        if (serverImg) {
          resolvedImage = serverImg;
        }
      }
    } else if (!resolvedImage && productUrl) {
      const html = await loadProductHtml();
      if (html) {
        const extracted = extractProductImageFromHtml(html, productUrl);
        if (extracted) resolvedImage = extracted;
      }
    }

    if (is_in_stock !== undefined && typeof is_in_stock !== "boolean") {
      return res.status(400).json({
        message: "is_in_stock must be a boolean when provided",
      });
    }

    let resolvedGroupId: number | null = null;
    if (group_id != null) {
      const gid = Number(group_id);
      if (Number.isNaN(gid)) {
        return res.status(400).json({ message: "Invalid category id" });
      }
      const access = await pool.query(
        `
        SELECT 1 FROM groups g
        WHERE g.group_id = $1
          AND (
            g.owner_id = $2
            OR EXISTS (
              SELECT 1 FROM group_members gm
              WHERE gm.group_id = g.group_id AND gm.user_id = $2
            )
          )
        `,
        [gid, user_id]
      );
      if (access.rows.length === 0) {
        return res.status(400).json({
          message: "That category does not exist or you cannot save to it.",
        });
      }
      resolvedGroupId = gid;
    }

    // Persist item row first (cart_items is the source of truth shown in UI cards).
    const itemResult = await pool.query(
      `
      INSERT INTO cart_items 
      (user_id, group_id, item_name, product_url, image_url, store, current_price, is_in_stock, notes, is_purchased)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, false)
      RETURNING item_id
      `,
      [
        user_id,
        resolvedGroupId,
        itemName,
        productUrl,
        resolvedImage,
        storeTruncated,
        priceNum,
        is_in_stock === false ? false : true,
      ]
    );

    // STEP 4: Get the new item's ID
    // PostgreSQL returns the new item_id so we can use it next
    const newItemId = itemResult.rows[0].item_id;

    if (notes !== undefined && notes !== null && String(notes).trim() !== "") {
      await upsertPrivateNoteForItem(newItemId, user_id, String(notes));
    }

    // STEP 5: Insert into price_history
    // This starts tracking the item's price over time
    await pool.query(
      `
      INSERT INTO price_history (item_id, price)
      VALUES ($1, $2)
      `,
      [newItemId, priceNum]
    );

    // STEP 6: Send success response back to frontend
    // This tells React/extension that everything worked
    res.status(201).json({
      message: "Item saved successfully",
      item_id: newItemId
    });

  } catch (error: unknown) {
    console.error("Error saving item:", error);
    const err = error as { code?: string };
    if (err.code === "23503") {
      return res.status(400).json({
        message:
          "Database rejected the save (bad category link). Pick a category you created, or leave category empty.",
      });
    }
    res.status(500).json({
      message: "Failed to save item",
    });
  }
  }
);

app.patch(
  "/api/cart-items/:id",
  authenticateToken,
  async (req: AuthRequest<UpdateCartItemBody, { id: string }>, res: Response) => {
    try {
      const item_id = Number(req.params.id);
      const owner_id = req.user!.userId;
      if (isNaN(item_id)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const fieldsToUpdate: string[] = [];
      const values: Array<string | number | boolean | null> = [];
      let valueIndex = 1;

      const {
        group_id,
        item_name,
        product_url,
        image_url,
        store,
        current_price,
        notes,
        is_purchased,
        purchased,
        purchase_price,
        is_in_stock,
        out_of_stock,
        refresh_list_price,
      } = req.body;
      let normalizedPurchasePrice = purchase_price;

      /**
       * STUDENT NOTE — two names, one database column
       * `is_purchased` is what Postgres stores. Some teammates POST `{ purchased: true }` instead.
       * We merge so either spelling updates the same boolean column.
       */
      const mergedIsPurchased =
        is_purchased !== undefined ? is_purchased : purchased;

      /**
       * STUDENT NOTE — stock flags
       * DB column: `is_in_stock` (true = available).
       * Some APIs prefer `out_of_stock` (true = NOT available) — we translate here.
       * If BOTH are sent, `is_in_stock` wins because it is the direct column name.
       */
      let mergedInStock: boolean | undefined = undefined;
      if (is_in_stock !== undefined) {
        if (typeof is_in_stock !== "boolean") {
          return res.status(400).json({ message: "is_in_stock must be a boolean when provided" });
        }
        mergedInStock = is_in_stock;
      } else if (out_of_stock !== undefined) {
        if (typeof out_of_stock !== "boolean") {
          return res.status(400).json({ message: "out_of_stock must be a boolean when provided" });
        }
        mergedInStock = !out_of_stock;
      }

      const ownerCheck = await pool.query(
        `
        SELECT user_id, group_id, current_price, item_name, is_in_stock, product_url
        FROM cart_items
        WHERE item_id = $1
        `,
        [item_id]
      );

      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }

      const itemGroupIdForNotify =
        ownerCheck.rows[0].group_id != null &&
        Number.isFinite(Number(ownerCheck.rows[0].group_id))
          ? Number(ownerCheck.rows[0].group_id)
          : null;

      const canEdit = await userCanEditCartItemRow(owner_id, {
        user_id: ownerCheck.rows[0].user_id,
        group_id: ownerCheck.rows[0].group_id,
      });
      if (!canEdit) {
        return res.status(403).json({ message: "You cannot update this item" });
      }

      let refreshedListPrice: number | null = null;
      if (refresh_list_price === true) {
        const url = String(ownerCheck.rows[0].product_url || "").trim();
        if (!url) {
          return res.status(400).json({
            message: "This item has no product URL; add a link before refreshing price.",
          });
        }
        const snapshot = await fetchProductSnapshotFromUrl(url);
        if (snapshot.price == null || !(snapshot.price > 0)) {
          return res.status(422).json({
            message:
              "Could not read a current price from the product page. Try again later or set price manually.",
          });
        }
        refreshedListPrice = snapshot.price;
      }

      if (group_id !== undefined) {
        fieldsToUpdate.push(`group_id = $${valueIndex++}`);
        values.push(group_id);
      }
      if (item_name !== undefined) {
        fieldsToUpdate.push(`item_name = $${valueIndex++}`);
        values.push(item_name);
      }
      if (product_url !== undefined) {
        fieldsToUpdate.push(`product_url = $${valueIndex++}`);
        values.push(product_url);
      }
      if (image_url !== undefined) {
        fieldsToUpdate.push(`image_url = $${valueIndex++}`);
        values.push(image_url);
      }
      if (store !== undefined) {
        fieldsToUpdate.push(`store = $${valueIndex++}`);
        values.push(store);
      }
      if (refreshedListPrice != null) {
        fieldsToUpdate.push(`current_price = $${valueIndex++}`);
        values.push(refreshedListPrice);
      } else if (current_price !== undefined) {
        if (Number(current_price) < 0) {
          return res.status(400).json({
            message: "current_price must be a non-negative number",
          });
        }
        fieldsToUpdate.push(`current_price = $${valueIndex++}`);
        values.push(current_price);
      }
      if (mergedIsPurchased !== undefined) {
        if (typeof mergedIsPurchased !== "boolean") {
          return res.status(400).json({
            message: "is_purchased / purchased must be a boolean when provided",
          });
        }
        fieldsToUpdate.push(`is_purchased = $${valueIndex++}`);
        values.push(mergedIsPurchased);
        if (mergedIsPurchased === true) {
          fieldsToUpdate.push(`purchase_date = COALESCE(purchase_date, CURRENT_TIMESTAMP)`);
        } else {
          fieldsToUpdate.push(`purchase_date = NULL`);
        }
      }
      if (mergedInStock !== undefined) {
        fieldsToUpdate.push(`is_in_stock = $${valueIndex++}`);
        values.push(mergedInStock);
      }
      if (normalizedPurchasePrice !== undefined) {
        if (normalizedPurchasePrice !== null && Number(normalizedPurchasePrice) < 0) {
          return res.status(400).json({
            message: "purchase_price must be null or a non-negative number",
          });
        }
        fieldsToUpdate.push(`purchase_price = $${valueIndex++}`);
        values.push(normalizedPurchasePrice);
      }

      let savedPrivateNotes = false;
      if (notes !== undefined) {
        await upsertPrivateNoteForItem(item_id, owner_id, notes);
        savedPrivateNotes = true;
      }

      if (fieldsToUpdate.length === 0 && !savedPrivateNotes) {
        return res.status(400).json({
          message: "No valid fields were provided for update",
        });
      }

      const previousPrice = Number(ownerCheck.rows[0].current_price ?? 0);
      const previousItemName = String(ownerCheck.rows[0].item_name || "Item");

      // If an item is marked purchased but no purchase price is provided, fall back to current price.
      if (mergedIsPurchased === true && (normalizedPurchasePrice === undefined || normalizedPurchasePrice === null)) {
        normalizedPurchasePrice = previousPrice;
        if (!fieldsToUpdate.some((f) => f.startsWith("purchase_price = "))) {
          fieldsToUpdate.push(`purchase_price = $${valueIndex++}`);
          values.push(normalizedPurchasePrice);
        }
      }

      let updatedRow: Record<string, unknown>;
      if (fieldsToUpdate.length > 0) {
        values.push(item_id);
        const result = await pool.query(
          `
          UPDATE cart_items
          SET ${fieldsToUpdate.join(", ")}
          WHERE item_id = $${valueIndex}
          RETURNING *
          `,
          values
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "Item not found" });
        }
        updatedRow = result.rows[0];

        if (
          refreshedListPrice != null &&
          Number.isFinite(refreshedListPrice) &&
          refreshedListPrice !== previousPrice
        ) {
          await pool.query(`INSERT INTO price_history (item_id, price) VALUES ($1, $2)`, [
            item_id,
            refreshedListPrice,
          ]);
        }

        const nextPrice =
          refreshedListPrice != null
            ? refreshedListPrice
            : current_price !== undefined && Number.isFinite(Number(current_price))
              ? Number(current_price)
              : previousPrice;
        if (
          (refreshedListPrice != null || current_price !== undefined) &&
          nextPrice < previousPrice
        ) {
          const itemOwnerId = ownerCheck.rows[0].user_id;
          await insertUserNotification({
            userId: itemOwnerId,
            itemId: item_id,
            groupId: itemGroupIdForNotify,
            message: `Price dropped for ${previousItemName}: $${previousPrice.toFixed(2)} -> $${nextPrice.toFixed(2)}`,
          });
          const notifyUser = await storage.getUser(itemOwnerId);
          const ownerEmail = String(notifyUser?.email || "").trim();
          if (ownerEmail) {
            await sendPriceDropEmail({
              toEmail: ownerEmail,
              toName: notifyUser?.username || ownerEmail,
              itemName: previousItemName,
              previousPrice,
              latestPrice: nextPrice,
              dashboardUrl: `${getFrontendBaseUrl()}/dashboard`,
            }).catch(() => {});
          }
        }

        const previousInStockRow =
          typeof ownerCheck.rows[0].is_in_stock === "boolean"
            ? ownerCheck.rows[0].is_in_stock
            : true;
        if (
          mergedInStock !== undefined &&
          mergedInStock === false &&
          previousInStockRow === true
        ) {
          const itemOwnerId = Number(ownerCheck.rows[0].user_id);
          await insertUserNotification({
            userId: itemOwnerId,
            itemId: item_id,
            groupId: itemGroupIdForNotify,
            message: `${previousItemName} is currently out of stock.`,
          });
          const notifyUser = await storage.getUser(itemOwnerId);
          const ownerEmail = String(notifyUser?.email || "").trim();
          if (ownerEmail) {
            await sendOutOfStockEmail({
              toEmail: ownerEmail,
              toName: notifyUser?.username || ownerEmail,
              itemName: previousItemName,
              dashboardUrl: `${getFrontendBaseUrl()}/dashboard`,
            }).catch(() => {});
          }
        }
      } else {
        const full = await pool.query(`SELECT * FROM cart_items WHERE item_id = $1`, [item_id]);
        updatedRow = full.rows[0];
      }

      const noteRow = await pool.query(
        `SELECT body AS notes FROM item_private_notes WHERE item_id = $1 AND user_id = $2`,
        [item_id, owner_id]
      );
      const mergedItem = shapeCartItemResponse({
        ...updatedRow,
        notes: noteRow.rows[0]?.notes ?? null,
      });

      return res.status(200).json({
        message: "Item updated successfully",
        item: mergedItem,
      });
    } catch (error) {
      console.error("Update item failed:", error);
      return res.status(500).json({ message: "Failed to update item" });
    }
  }
);

app.get("/api/cart-items/:id", authenticateToken, async (req: AuthRequest<any, { id: string }>, res: Response) => {
  try {
    const item_id = Number(req.params.id);
    const userId = req.user!.userId;
    if (isNaN(item_id)) {
      return res.status(400).json({ message: "Invalid item ID" });
    }

    const result = await pool.query(
      `
      SELECT ci.*, COALESCE(ipn.body, ci.notes) AS notes
      FROM cart_items ci
      LEFT JOIN item_private_notes ipn ON ipn.item_id = ci.item_id AND ipn.user_id = $1
      WHERE ci.item_id = $2
      `,
      [userId, item_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    const row = result.rows[0];
    const canView = await userCanEditCartItemRow(userId, {
      user_id: row.user_id,
      group_id: row.group_id,
    });

    if (!canView) {
      return res.status(403).json({ message: "You do not have access to this item" });
    }

    return res.status(200).json(shapeCartItemResponse(row));
  } catch (error) {
    console.error("Fetch single cart item failed:", error);
    return res.status(500).json({ message: "Failed to fetch item" });
  }
});

app.delete("/api/cart-items/:id", authenticateToken, async (req: AuthRequest<any, { id: string }>, res: Response) => {
  try {
    const item_id = Number(req.params.id);
    const owner_id = req.user!.userId;

    if (isNaN(item_id)) {
      return res.status(400).json({
        message: "Invalid item ID",
      });
    }

    const ownerCheck = await pool.query(
      `
      SELECT user_id, group_id
      FROM cart_items
      WHERE item_id = $1
      `,
      [item_id]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    const canDelete = await userCanEditCartItemRow(owner_id, {
      user_id: ownerCheck.rows[0].user_id,
      group_id: ownerCheck.rows[0].group_id,
    });
    if (!canDelete) {
      return res.status(403).json({
        message: "You cannot delete this item",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM cart_items
      WHERE item_id = $1
      RETURNING item_id
      `,
      [item_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    return res.status(200).json({
      message: "Item deleted successfully",
      item_id: result.rows[0].item_id,
    });
  } catch (error) {
    console.error("Delete item failed:", error);
    return res.status(500).json({
      message: "Failed to delete item",
    });
  }
});

app.get(
  "/api/cart-items/:id/group-comments",
  authenticateToken,
  async (req: AuthRequest<any, { id: string }>, res: Response) => {
    try {
      const item_id = Number(req.params.id);
      const userId = req.user!.userId;
      if (isNaN(item_id)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const row = await pool.query(
        `SELECT user_id, group_id FROM cart_items WHERE item_id = $1`,
        [item_id]
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }
      const canView = await userCanEditCartItemRow(userId, {
        user_id: row.rows[0].user_id,
        group_id: row.rows[0].group_id,
      });
      if (!canView) {
        return res.status(403).json({ message: "You cannot view comments for this item" });
      }

      const thread = await pool.query(
        `
        SELECT
          c.comment_id,
          c.item_id,
          c.user_id,
          c.body,
          c.created_at,
          u.username,
          u.email
        FROM item_group_comments c
        JOIN users u ON u.user_id = c.user_id
        WHERE c.item_id = $1
        ORDER BY c.created_at ASC, c.comment_id ASC
        `,
        [item_id]
      );
      return res.status(200).json(thread.rows);
    } catch (error) {
      console.error("Fetch group comments failed:", error);
      return res.status(500).json({ message: "Failed to fetch group comments" });
    }
  }
);

app.post(
  "/api/cart-items/:id/group-comments",
  authenticateToken,
  async (req: AuthRequest<{ body?: string }, { id: string }>, res: Response) => {
    try {
      const item_id = Number(req.params.id);
      const userId = req.user!.userId;
      const text = String(req.body?.body ?? "").trim();
      if (isNaN(item_id)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }
      if (!text) {
        return res.status(400).json({ message: "Comment text is required" });
      }

      const row = await pool.query(
        `SELECT user_id, group_id FROM cart_items WHERE item_id = $1`,
        [item_id]
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }
      const canPost = await userCanEditCartItemRow(userId, {
        user_id: row.rows[0].user_id,
        group_id: row.rows[0].group_id,
      });
      if (!canPost) {
        return res.status(403).json({ message: "You cannot comment on this item" });
      }

      const ins = await pool.query(
        `
        INSERT INTO item_group_comments (item_id, user_id, body)
        VALUES ($1, $2, $3)
        RETURNING comment_id, item_id, user_id, body, created_at
        `,
        [item_id, userId, text]
      );
      const who = await storage.getUser(userId);

      // Notify other members of the wishlist
      const itemRow = await pool.query(
        `SELECT item_name, group_id FROM cart_items WHERE item_id = $1`,
        [item_id]
      );
      const itemName = itemRow.rows[0]?.item_name || "an item";
      const groupId = itemRow.rows[0]?.group_id;
      const senderLabel = who?.username || who?.email || "Someone";

      if (groupId) {
        await notifyGroupPeers({
          groupId: Number(groupId),
          senderUserId: userId,
          itemId: item_id,
          message: `${senderLabel} commented on "${itemName}": "${text.length > 30 ? text.slice(0, 27) + '...' : text}"`,
        });
      }

      return res.status(201).json({
        ...ins.rows[0],
        username: who?.username ?? null,
        email: who?.email ?? null,
      });
    } catch (error) {
      console.error("Post group comment failed:", error);
      return res.status(500).json({ message: "Failed to post comment" });
    }
  }
);

app.get("/api/cart-items/:id/notes", authenticateToken, async (req: AuthRequest<any, { id: string }>, res: Response) => {
  try {
    const item_id = Number(req.params.id);
    const owner_id = req.user!.userId;
    if (isNaN(item_id)) {
      return res.status(400).json({ message: "Invalid item ID" });
    }

    const result = await pool.query(
      `
      SELECT ci.item_id, ci.user_id, ci.group_id, COALESCE(ipn.body, ci.notes) AS notes
      FROM cart_items ci
      LEFT JOIN item_private_notes ipn ON ipn.item_id = ci.item_id AND ipn.user_id = $2
      WHERE ci.item_id = $1
      `,
      [item_id, owner_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    const canView = await userCanEditCartItemRow(owner_id, {
      user_id: result.rows[0].user_id,
      group_id: result.rows[0].group_id,
    });
    if (!canView) {
      return res.status(403).json({ message: "You cannot view notes for this item" });
    }

    return res.status(200).json({
      item_id: result.rows[0].item_id,
      notes: result.rows[0].notes,
    });
  } catch (error) {
    console.error("Fetch item notes failed:", error);
    return res.status(500).json({ message: "Failed to fetch item notes" });
  }
});

app.patch( // Defines route that listens for PATCH requests at /api/cart-items/:id/notes
  "/api/cart-items/:id/notes", // PATCH = HTTP method for only changing the notes field, ID =  URL parameter. If the request comes in as /api/cart-items/42/notes, then req.params.id = "42" 
  authenticateToken, // middleware that runs before your handler. It verifies the JWT token, and if it's invalid, the request never reaches your code. If it's valid, it attaches req.user so you know who's making the request
  async (req: AuthRequest<{ notes: string | null }, { id: string }>, res: Response) => { // Tells typescript the body has a notes field, URL params have ID field
    try {
      const item_id = Number(req.params.id); // Converts the URL :id from a string into a number
      const owner_id = req.user!.userId; // Grabs the authenticated user's ID from req.user which was placed by authenticate token
      const { notes } = req.body; // Pulls the notes field out of the JSON request body using destructuring

      if (isNaN(item_id)) { // If someone sent /api/cart-items/abc/notes, Number("abc") is NaN. Reject with a 400 (Bad Request) before touching the database
        return res.status(400).json({ message: "Invalid item ID" });
      }
      if (notes !== null && typeof notes !== "string") { // notes must be either null (clearing the note) or a string (setting/updating it). Anything else (number, object, array) gets rejected
        return res.status(400).json({ message: "notes must be a string or null" });
      }

      const ownerCheck = await pool.query( //Looks up the item in the database to find out who owns it and which group it belongs to
        `
        SELECT user_id, group_id
        FROM cart_items
        WHERE item_id = $1
        `,
        [item_id]
      );

      if (ownerCheck.rows.length === 0) { // If no row cam back then item doesnt exist 
        return res.status(404).json({ message: "Item not found" });
      }

      const canEditNotes = await userCanEditCartItemRow(owner_id, {
        user_id: ownerCheck.rows[0].user_id,
        group_id: ownerCheck.rows[0].group_id,
      });
      if (!canEditNotes) {
        return res.status(403).json({ message: "You cannot update notes for this item" });
      }
      // Helper function
      await upsertPrivateNoteForItem(item_id, owner_id, notes); // Updates or creates a new note if it already exists 
      // Reads the note back from the database right after saving it
      const readBack = await pool.query(
        `SELECT body AS notes FROM item_private_notes WHERE item_id = $1 AND user_id = $2`, // Grabs body column but renames to notes
        [item_id, owner_id] // Filters note to user it belongs to, $1 & &2 are placeholders for item_id and owner_id from the array
      );
      // Sends JSON response to frontend as a confirmation message 
      return res.status(200).json({
        message: "Item notes updated successfully",
        item: {
          item_id,
          notes: readBack.rows[0]?.notes ?? null, // If a row doesn't exist just give undefined or null
        }, // Basically asks to give the saved note text or null if nothing was found 
      });
    } catch (error) {
      console.error("Update item notes failed:", error);
      return res.status(500).json({ message: "Failed to update item notes" }); // (400 = bad request , 500 = server error)
    } // private-notes update route, WHERE user_id = $2 clause guarantees a user can only retrieve their own private note
  }
);

// Entry point for cart-it backend. (EX: npm start)
// 1) Prepares the database so all your tables are guaranteed to exist
// 2) Starts (Express) HTTP server so extension can make API calls (/api/login, /api/register, /api/cart...)
// 3) Starts a background price/stock checker that runs on a timer to update prices
async function startServer() 
{
  try {
    await initializeDatabase(); // Await helps the server not accept requests before tables exist
    // If this were to change first few API requests would say table doesn't exist b/c the server starts before the tables exist 
    app.listen(PORT, "0.0.0.0", () => { // Accepts connections from anywhere 
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });

    console.log(`Frontend URL: ${getFrontendBaseUrl()}`);
    if (scrapingBeeConfigured()) {
      console.log("ScrapingBee: HTML fallback enabled (product saves + price-check job).");
    }

    if (PRICE_CHECK_DISABLED) {
      console.log(
        "Price checker: disabled (remove PRICE_CHECK_ENABLED=false and PRICE_CHECK_INTERVAL_MINUTES=0 to enable)."
      );
    } else {
    const intervalMs = Math.max(5, PRICE_CHECK_INTERVAL_MINUTES) * 60 * 1000; //Enforces a minimum of 5 minutes. Javascript timers use milliseconds
    console.log(`Price checker enabled: every ${Math.max(5, PRICE_CHECK_INTERVAL_MINUTES)} minute(s)`);
    const resendKey = String(process.env.RESEND_API_KEY || "").trim();
    const resendFrom = String(process.env.RESEND_FROM_EMAIL || "").trim();
    if (!resendKey || !resendFrom) {
      console.warn(
        "Email alerts: password resets, price-drops, and out-of-stock emails need RESEND_API_KEY + RESEND_FROM_EMAIL (in-app notifications still work)."
      );
    }
    if (!PRICE_CHECK_CRON_SECRET) {
      console.warn(
        "Cron hook: optional POST /api/internal/run-price-check is disabled until PRICE_CHECK_CRON_SECRET is set (for Render Cron / external scheduler)."
      );
    }
    setTimeout(() => {
      runPriceCheckCycle().catch(() => {});
    }, 15000);
    setInterval(() => {
      runPriceCheckCycle().catch(() => {});
    }, intervalMs);
    }

  } catch (error) {    // Put for safety purposes so if one failed price occurs it does not crash the whole server
    console.error("Server startup failed:", error);
  }
}

startServer(); // Calls the function

