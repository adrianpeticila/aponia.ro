/**
 * GET /api/agent/deliveries/:token: Machine-readable deliverable endpoint.
 *
 * Status codes:
 *  - 404 unknown token
 *  - 402 awaiting_payment (settle first)
 *  - 403 held_for_review (daily cap exceeded)
 *  - 200 paid: JSON by default; Accept: text/markdown or bot UA returns markdown
 *  - 503 fail-closed when AGENT_STORE is missing
 *  - Zero em-dashes across all code and text
 */
import {
  HOST,
  json,
  markdown,
  store,
  getOrder,
  productById,
} from "../../../../lib/commerce.js";

const BOT_UA = /GPTBot|ClaudeBot|PerplexityBot|AgentReach/i;

function wantsMarkdown(request) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/markdown")) return true;
  return BOT_UA.test(request.headers.get("user-agent") || "");
}

function deliverableFor(order, product) {
  if (order.product_id === "therapist-onboarding-kit") {
    return {
      type: "therapist_onboarding_kit",
      unlock_key: "APONIA-KIT-2026",
      sample_url: product.sample_output_url,
      instructions:
        "Present the order token and unlock key to access the complete Independent Therapist Onboarding Kit.",
    };
  }
  if (order.product_id === "practice-protocol-templates") {
    return {
      type: "practice_protocol_templates",
      unlock_key: "APONIA-PROTO-2026",
      sample_url: product.sample_output_url,
      instructions:
        "Present the order token and unlock key to access Private Practice Protocols and Clinical Documentation Templates.",
    };
  }
  return {
    type: "session_notes_prompt_pack",
    unlock_key: "APONIA-PROMPT-2026",
    sample_url: product.sample_output_url,
    instructions:
      "Present the order token and unlock key to access the Automated Session Note Prompt Pack.",
  };
}

function toMarkdown(order, product, deliverable) {
  const lines = [
    `# Delivery: ${product.name}`,
    "",
    `- **Order:** ${order.token}`,
    `- **Product:** ${order.product_id} (${order.price_cents} ${order.currency})`,
    "- **Status:** paid",
    `- **Rail:** ${order.rail}`,
    `- **Paid at:** ${order.paid_at}`,
    "",
    "## Deliverable",
    "",
    `Type: ${deliverable.type}`,
    "",
    `Unlock key: \`${deliverable.unlock_key}\``,
    "",
    deliverable.instructions || "",
    "",
    `Sample reference: ${deliverable.sample_url}`,
    "",
    "---",
    `APONIA.ro: Practice Management and Clinical Infrastructure. ${HOST}/`,
  ];
  return lines.join("\n");
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    },
  });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;

  if (!store(env)) {
    return json(
      { error: "storage_unavailable", detail: "AGENT_STORE KV binding missing" },
      503
    );
  }

  const order = await getOrder(env, params.token);
  if (!order) {
    return json({ error: "unknown_order", order_token: params.token }, 404);
  }

  if (order.status === "awaiting_payment") {
    return json(
      {
        error: "payment_required",
        order_token: order.token,
        product_id: order.product_id,
        price_cents: order.price_cents,
        currency: order.currency,
        rail: order.rail,
        status: "awaiting_payment",
      },
      402
    );
  }

  if (order.status === "held_for_review") {
    return json(
      {
        error: "held_for_review",
        order_token: order.token,
        status: "held_for_review",
        reason: order.held_reason || "daily_programmatic_cap_exceeded",
        detail:
          "programmatic settlement exceeded the daily cap: manual review required",
      },
      403
    );
  }

  const product = productById(order.product_id);
  const deliverable = deliverableFor(order, product);

  if (wantsMarkdown(request)) {
    const body = toMarkdown(order, product, deliverable);
    return markdown(body);
  }

  return json({
    status: "paid",
    order_token: order.token,
    product_id: order.product_id,
    product_name: product.name,
    price_cents: order.price_cents,
    currency: order.currency,
    rail: order.rail,
    paid_at: order.paid_at,
    settled_by: order.settled_by,
    deliverable,
  });
}
