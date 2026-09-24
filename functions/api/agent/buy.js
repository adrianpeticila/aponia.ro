/**
 * POST /api/agent/buy: M2M purchase entrypoint for Aponia.ro
 *
 * Rails:
 *  - stripe_hosted: HTTP 200 with hosted Stripe checkout URL
 *  - x402 / programmatic rails: HTTP 402 Payment Required with settlement specs and x402 headers
 *
 * Guardrails:
 *  - 400 for malformed body, missing identity, bad rail
 *  - 404 for unknown product
 *  - 429 for more than 3 attempts per agent+IP per 10 minutes
 *  - Idempotent replays via Idempotency-Key header
 *  - 503 fail-closed when KV AGENT_STORE is not bound
 *  - Zero em-dashes across all code and text
 */
import {
  HOST,
  ALL_RAILS,
  MAX_BODY_BYTES,
  json,
  clientIp,
  store,
  productById,
  stripeUrl,
  dailyCapCents,
  registerAttempt,
  getIdem,
  putIdem,
  putOrder,
  getOrder,
  sha256Hex,
  newOrderToken,
} from "../../../lib/commerce.js";

const CORS_EXTRA = { "Access-Control-Allow-Origin": "*" };

function deliveryUrl(token) {
  return `${HOST}/api/agent/deliveries/${token}`;
}

function buildBuyResponse(order, product, env) {
  if (order.rail === "stripe_hosted") {
    return {
      status: 200,
      headers: CORS_EXTRA,
      payload: {
        checkout_type: "stripe_hosted",
        product_id: order.product_id,
        order_token: order.token,
        rail: "stripe_hosted",
        status: "awaiting_payment",
        price_cents: order.price_cents,
        currency: "RON",
        checkout_url: stripeUrl(product, env),
        delivery_url: deliveryUrl(order.token),
      },
    };
  }

  // Programmatic rail: x402, zeroclick, 1f916_base
  const payTo = (env && env.X402_PAYTO_ADDRESS) || null;
  const capRon = dailyCapCents(env) / 100;
  const x402Headers = {
    ...CORS_EXTRA,
    "X-402-Payment-Required": "true",
    "X-402-Order-Token": order.token,
    "X-402-Price-Cents": String(order.price_cents),
    "X-402-Currency": "RON",
    "X-402-Rail": order.rail,
    "X-402-Delivery-Url": deliveryUrl(order.token),
  };
  if (payTo) {
    x402Headers["X-402-Pay-To"] = payTo;
  }

  return {
    status: 402,
    headers: x402Headers,
    payload: {
      error: "payment_required",
      product_id: order.product_id,
      order_token: order.token,
      status: "awaiting_payment",
      price_cents: order.price_cents,
      ron_cents: order.price_cents,
      currency: "RON",
      rail: order.rail,
      settlement: {
        cap_ron_daily: capRon,
        currency: "RON",
        webhook: `${HOST}/api/agent/payments/webhook`,
        signature_header: "X-Signature",
        algorithm: "hmac-sha256",
      },
      payment: {
        protocol: order.rail,
        asset: "USDC",
        pay_to: payTo,
        note: payTo
          ? "Settle payment to pay_to, then POST the settlement webhook above."
          : "No x402 settlement address configured on this deployment; set X402_PAYTO_ADDRESS in environment.",
      },
      delivery_url: deliveryUrl(order.token),
    },
  };
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!store(env)) {
    return json(
      { error: "storage_unavailable", detail: "AGENT_STORE KV binding missing" },
      503,
      CORS_EXTRA
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json(
      { error: "malformed_body", detail: "payload exceeds 64KB" },
      400,
      CORS_EXTRA
    );
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(
      { error: "malformed_body", detail: "invalid JSON" },
      400,
      CORS_EXTRA
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      { error: "malformed_body", detail: "JSON object expected" },
      400,
      CORS_EXTRA
    );
  }

  const productId =
    typeof body.product_id === "string" ? body.product_id.trim() : "";
  if (!productId) {
    return json(
      { error: "invalid_request", detail: "product_id is required" },
      400,
      CORS_EXTRA
    );
  }

  const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const identity = agentId || email;
  if (!identity) {
    return json(
      { error: "identity_required", detail: "agent_id or email is required" },
      400,
      CORS_EXTRA
    );
  }

  const ip = clientIp(request);

  // Idempotent replay checks before rate limit window
  const idemRaw = request.headers.get("Idempotency-Key");
  let idemHash = null;
  if (idemRaw && idemRaw.length <= 200) {
    idemHash = await sha256Hex(`${ip}|${identity}|${idemRaw}`);
    const rec = await getIdem(env, idemHash);
    if (rec) {
      const order = await getOrder(env, rec.token);
      if (order) {
        const product = productById(order.product_id);
        const built = buildBuyResponse(order, product, env);
        return json(built.payload, built.status, {
          ...built.headers,
          "Idempotency-Replayed": "true",
        });
      }
    }
  }

  const allowed = await registerAttempt(env, ip, identity);
  if (!allowed) {
    return json(
      {
        error: "rate_limited",
        detail: "max 3 buy attempts per agent+IP per 10 minutes",
        retry_after_seconds: 600,
      },
      429,
      { ...CORS_EXTRA, "Retry-After": "600" }
    );
  }

  const product = productById(productId);
  if (!product) {
    return json({ error: "unknown_product", product_id: productId }, 404, CORS_EXTRA);
  }

  const rail = body.rail === undefined ? product.checkout_type : body.rail;
  if (typeof rail !== "string" || !ALL_RAILS.includes(rail)) {
    return json(
      { error: "unknown_rail", rail, allowed: ALL_RAILS },
      400,
      CORS_EXTRA
    );
  }
  if (!product.rails.includes(rail)) {
    return json(
      {
        error: "rail_not_available",
        product_id: product.id,
        rail,
        available: product.rails,
      },
      400,
      CORS_EXTRA
    );
  }

  const nowIso = new Date().toISOString();
  const order = {
    token: newOrderToken(),
    product_id: product.id,
    price_cents: product.price_cents,
    currency: "RON",
    rail,
    agent_id: agentId || null,
    email: email || null,
    ip,
    status: "awaiting_payment",
    created_at: nowIso,
    paid_at: null,
    held_reason: null,
    settled_by: null,
    reference: null,
  };
  await putOrder(env, order);

  if (idemHash) {
    await putIdem(env, idemHash, order.token);
  }

  const built = buildBuyResponse(order, product, env);
  return json(built.payload, built.status, built.headers);
}
