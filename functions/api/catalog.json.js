/**
 * GET /api/catalog.json: Aponia M2M product catalog.
 * Strict contract: exactly 7 keys per product, currency RON, zero em-dashes.
 */
import { PRODUCTS, catalogItem, json } from "../../lib/commerce.js";

export function onRequestGet() {
  return json(PRODUCTS.map(catalogItem));
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
