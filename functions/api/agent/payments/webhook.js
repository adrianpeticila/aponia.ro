/**
 * POST /api/agent/payments/webhook: Settlement webhook for Aponia.ro
 *
 * Authenticated fail-closed with HMAC-SHA256 over raw body:
 *   X-Signature: sha256=<hex>
 *   hex = HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, raw_request_body_bytes)
 *
 * Semantics:
 *  - Programmatic rails (x402, zeroclick, 1f916_base): price_cents joins the
 *    UTC-day ledger; crossing the daily cap marks the order held_for_review
 *    (ledger untouched) instead of paid.
 *  - Stripe hosted orders settle paid without cap accounting (unlimited).
 *  - Replays of paid or held orders are idempotent.
 *  - Zero em-dashes across all code and text.
 */
import {
  MAX_BODY_BYTES,
  json,
  store,
  getOrder,
  putOrder,
  dailyCapCents,
  ledgerCents,
  ledgerAdd,
  isProgrammatic,
  hmacSha256Hex,
  normalizeSignature,
  timingSafeEqualHex,
} from "../../../../lib/commerce.js";

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Signature",
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const secret = env && env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    return json(
      { error: "secret_not_configured", detail: "PAYMENT_WEBHOOK_SECRET unset" },
      503
    );
  }
  if (!store(env)) {
    return json(
      { error: "storage_unavailable", detail: "AGENT_STORE KV binding missing" },
      503
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "malformed_body", detail: "payload exceeds 64KB" }, 400);
  }

  // Signature check first before parsing
  const provided = normalizeSignature(request.headers.get("X-Signature"));
  if (!provided) {
    return json(
      {
        error: "invalid_signature",
        detail: "X-Signature: sha256=<hex> required",
      },
      401
    );
  }
  const expected = await hmacSha256Hex(secret, raw);
  if (!timingSafeEqualHex(provided, expected)) {
    return json({ error: "invalid_signature" }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "malformed_body", detail: "invalid JSON" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "malformed_body", detail: "JSON object expected" }, 400);
  }

  const orderToken =
    typeof payload.order_token === "string" ? payload.order_token.trim() : "";
  if (!orderToken) {
    return json({ error: "order_token_required" }, 400);
  }
  if (payload.status !== "succeeded") {
    return json(
      { error: "invalid_status", detail: 'only status "succeeded" is supported' },
      400
    );
  }

  const order = await getOrder(env, orderToken);
  if (!order) {
    return json({ error: "unknown_order", order_token: orderToken }, 404);
  }

  // Idempotent replay
  if (order.status === "paid") {
    return json({
      ok: true,
      order_token: order.token,
      status: "paid",
      replayed: true,
    });
  }
  if (order.status === "held_for_review") {
    return json({
      ok: true,
      order_token: order.token,
      status: "held_for_review",
      replayed: true,
      reason: order.held_reason || "daily_programmatic_cap_exceeded",
    });
  }

  const nowIso = new Date().toISOString();
  const provider =
    typeof payload.provider === "string" && payload.provider
      ? payload.provider
      : order.rail;
  const reference =
    typeof payload.reference === "string" && payload.reference
      ? payload.reference
      : null;

  if (isProgrammatic(order.rail)) {
    const capCents = dailyCapCents(env);
    const current = await ledgerCents(env);
    const prospective = current + order.price_cents;

    if (prospective > capCents) {
      order.status = "held_for_review";
      order.held_reason = "daily_programmatic_cap_exceeded";
      order.held_at = nowIso;
      order.settled_by = provider;
      order.reference = reference;
      await putOrder(env, order);
      return json({
        ok: true,
        order_token: order.token,
        status: "held_for_review",
        reason: "daily_programmatic_cap_exceeded",
        cap_ron_daily: capCents / 100,
        ledger_ron_cents: current,
        attempted_ron_cents: prospective,
      });
    }

    const total = await ledgerAdd(env, order.price_cents);
    order.status = "paid";
    order.paid_at = nowIso;
    order.settled_by = provider;
    order.reference = reference;
    await putOrder(env, order);
    return json({
      ok: true,
      order_token: order.token,
      status: "paid",
      ledger_ron_cents: total,
      cap_ron_daily: capCents / 100,
    });
  }

  // stripe_hosted or non-programmatic rail: unlimited
  order.status = "paid";
  order.paid_at = nowIso;
  order.settled_by = provider;
  order.reference = reference;
  await putOrder(env, order);
  return json({ ok: true, order_token: order.token, status: "paid" });
}
