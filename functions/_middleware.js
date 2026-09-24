/**
 * APONIA.ro: Content negotiation middleware (Cloudflare Pages Functions).
 *
 * Requests that prefer markdown (Accept: text/markdown or bot user agents)
 * receive the .md mirror if available.
 * Dynamic /api/ routes pass through untouched to their dedicated functions.
 * Zero em-dashes across all code and text.
 */

const BOT_UA = /GPTBot|ClaudeBot|PerplexityBot|AgentReach/i;

function wantsMarkdown(request) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/markdown")) return true;
  return BOT_UA.test(request.headers.get("user-agent") || "");
}

function mirrorPath(pathname) {
  if (pathname === "/" || pathname === "") return "/index.md";
  if (pathname.endsWith("/")) return pathname + "index.md";
  return pathname + ".md";
}

export async function onRequest(context) {
  const { request, env, next } = context;

  if (request.method !== "GET" && request.method !== "HEAD") return next();

  const url = new URL(request.url);
  // Dynamic API routes handle their own responses
  if (url.pathname.startsWith("/api/")) return next();
  if (!wantsMarkdown(request)) return next();

  if (!env || !env.ASSETS) return next();

  const mdRequest = new Request(new URL(mirrorPath(url.pathname), url.origin), {
    method: "GET",
    headers: { accept: "text/markdown" },
  });
  const mirror = await env.ASSETS.fetch(mdRequest);
  if (mirror.status !== 200) return next();

  const mirrorType = mirror.headers.get("Content-Type") || "";
  if (!mirrorType.includes("text/markdown")) return next();

  const headers = new Headers(mirror.headers);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  headers.set("Vary", "Accept, User-Agent");
  return new Response(request.method === "HEAD" ? null : mirror.body, {
    status: 200,
    headers,
  });
}
