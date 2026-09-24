/**
 * APONIA.ro: Machine-to-Machine (M2M) Agentic Commerce Library
 *
 * Implements catalog, order management, rate limiting, and settlement
 * verification with Cloudflare Pages Functions / Workers KV binding AGENT_STORE.
 *
 * Rules:
 *  - Strict 7-key catalog schema: id, name, price_cents, currency, description,
 *    sample_output_url, checkout_type.
 *  - Currency: RON.
 *  - Zero em-dashes across all code, comments, and strings.
 */

export const HOST = "https://aponia.ro";
export const RATE_LIMIT = 3;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_DAILY_CAP_RON_CENTS = 10000;

export const PROGRAMMATIC_RAILS = ["x402", "zeroclick", "1f916_base"];
export const ALL_RAILS = [...PROGRAMMATIC_RAILS, "stripe_hosted", "free"];

const DEFAULT_STRIPE_URLS = {
  "therapist-onboarding-kit": "https://buy.stripe.com/aponia-therapist-onboarding-kit",
  "practice-protocol-templates": "https://buy.stripe.com/aponia-practice-protocol-templates",
  "session-notes-prompt-pack": "https://buy.stripe.com/aponia-session-notes-prompt-pack",
};

export const PRODUCTS = [
  {
    id: "therapist-onboarding-kit",
    name: "Independent Therapist Onboarding Kit",
    price_cents: 14900,
    currency: "RON",
    description: "Complete independent therapist onboarding framework: client intake contracts, GDPR consent documentation, boundary policies, and practice setup checklists.",
    sample_output_url: `${HOST}/samples/therapist-onboarding-kit-sample.md`,
    checkout_type: "stripe_hosted",
    rails: ["stripe_hosted", ...PROGRAMMATIC_RAILS],
  },
  {
    id: "practice-protocol-templates",
    name: "Private Practice Protocol & Clinical Templates",
    price_cents: 9900,
    currency: "RON",
    description: "Clinical protocols and documentation toolkit: standard operational procedures, inter-session crisis response framework, attendance and cancellation policies, and practice management templates.",
    sample_output_url: `${HOST}/samples/practice-protocol-templates-sample.md`,
    checkout_type: "stripe_hosted",
    rails: ["stripe_hosted", ...PROGRAMMATIC_RAILS],
  },
  {
    id: "session-notes-prompt-pack",
    name: "Automated Session Note Prompt Pack",
    price_cents: 4900,
    currency: "RON",
    description: "Deterministic prompt engineering suite for automated clinical documentation: structured SOAP and DAP session note generators with strict patient privacy guardrails.",
    sample_output_url: `${HOST}/samples/session-notes-prompt-pack-sample.md`,
    checkout_type: "x402",
    rails: [...PROGRAMMATIC_RAILS, "stripe_hosted"],
  },
];

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

/** The exact 7-key catalog contract: id, name, price_cents, currency, description, sample_output_url, checkout_type */
export function catalogItem(p) {
  return {
    id: p.id,
    name: p.name,
    price_cents: p.price_cents,
    currency: p.currency,
    description: p.description,
    sample_output_url: p.sample_output_url,
    checkout_type: p.checkout_type,
  };
}

export function stripeUrl(product, env = {}) {
  const envKey = `STRIPE_URL_${product.id.replace(/-/g, "_").toUpperCase()}`;
  return (env && env[envKey]) || DEFAULT_STRIPE_URLS[product.id] || null;
}

export function isProgrammatic(rail) {
  return PROGRAMMATIC_RAILS.includes(rail);
}

export function dailyCapCents(env) {
  if (env && env.DAILY_CAP_RON_CENTS) {
    const parsed = Number(env.DAILY_CAP_RON_CENTS);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DAILY_CAP_RON_CENTS;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

export function markdown(body, status = 200, extraHeaders = {}) {
  return new Response(body.endsWith("\n") ? body : body + "\n", {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

// ---------------------------------------------------------------------------
// State (KV binding AGENT_STORE): fail-closed when absent.
// ---------------------------------------------------------------------------
export function store(env) {
  return env && env.AGENT_STORE ? env.AGENT_STORE : null;
}

function stateKey(env, k) {
  const pfx = env && env.AGENT_STATE_NS ? `${env.AGENT_STATE_NS}:` : "";
  return pfx + k;
}

export function newOrderToken() {
  return `ord_${crypto.randomUUID()}`;
}

export async function getOrder(env, token) {
  const s = store(env);
  if (!s || !token || typeof token !== "string") return null;
  return s.get(stateKey(env, `ord:${token}`), "json");
}

export async function putOrder(env, order) {
  const s = store(env);
  if (!s) throw new Error("AGENT_STORE not bound");
  await s.put(stateKey(env, `ord:${order.token}`), JSON.stringify(order), {
    expirationTtl: 90 * 24 * 3600,
  });
}

export async function getIdem(env, hash) {
  const s = store(env);
  if (!s) return null;
  return s.get(stateKey(env, `idem:${hash}`), "json");
}

export async function putIdem(env, hash, token) {
  const s = store(env);
  if (!s) throw new Error("AGENT_STORE not bound");
  await s.put(stateKey(env, `idem:${hash}`), JSON.stringify({ token }), {
    expirationTtl: 24 * 3600,
  });
}

export async function registerAttempt(env, ip, identity) {
  const s = store(env);
  if (!s) throw new Error("AGENT_STORE not bound");
  const k = stateKey(env, `rl:${ip}|${identity}`);
  const now = Date.now();
  let attempts = (await s.get(k, "json")) || [];
  attempts = attempts.filter((t) => now - t < RATE_WINDOW_MS);
  if (attempts.length >= RATE_LIMIT) return false;
  attempts.push(now);
  await s.put(k, JSON.stringify(attempts), { expirationTtl: 600 });
  return true;
}

export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export async function ledgerCents(env) {
  const s = store(env);
  if (!s) throw new Error("AGENT_STORE not bound");
  const rec = await s.get(stateKey(env, `ledger:${utcDay()}`), "json");
  return rec ? rec.ron_cents : 0;
}

export async function ledgerAdd(env, cents) {
  const total = (await ledgerCents(env)) + cents;
  const s = store(env);
  await s.put(
    stateKey(env, `ledger:${utcDay()}`),
    JSON.stringify({ ron_cents: total }),
    { expirationTtl: 2 * 24 * 3600 }
  );
  return total;
}

// ---------------------------------------------------------------------------
// Crypto helpers (WebCrypto: edge-native, zero Node imports)
// ---------------------------------------------------------------------------
function toHex(buf) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(buf);
}

export async function hmacSha256Hex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return toHex(sig);
}

export function normalizeSignature(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  let v = headerValue.trim();
  if (v.toLowerCase().startsWith("sha256=")) v = v.slice(7);
  v = v.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? v : null;
}

export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
