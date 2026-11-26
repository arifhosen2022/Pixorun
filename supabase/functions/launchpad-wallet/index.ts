import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyMessage } from "npm:viem@2.21.54";

const ALLOWED_ORIGINS = new Set(["https://pixorun.xyz", "https://www.pixorun.xyz"]);
const CHAIN_ID = 46630;
const EXPLORER_API = "https://explorer.testnet.chain.robinhood.com/api/v2";
const encoder = new TextEncoder();

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function normalizeAddress(value: unknown): string {
  const address = String(value ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Enter a valid EVM wallet address.");
  return address;
}
async function createAccessToken(address: string, secret: string) {
  const expires = Math.floor(Date.now() / 1000) + 15 * 60;
  const signature = await hmac(address + ":" + expires, secret);
  return expires + "." + signature;
}
async function validAccessToken(address: string, token: string, secret: string) {
  const [rawExpires, signature] = token.split(".");
  const expires = Number(rawExpires);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 16 * 60) return false;
  return (await hmac(address + ":" + expires, secret)) === signature;
}
function rpcClient(supabaseUrl: string, serviceKey: string) {
  return async (name: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error("Wallet verification database request failed.");
    return data;
  };
}
function normalizeExplorerItem(item: Record<string, unknown>) {
  const from = item.from && typeof item.from === "object" ? item.from as Record<string, unknown> : {};
  const to = item.to && typeof item.to === "object" ? item.to as Record<string, unknown> : {};
  return {
    hash: String(item.hash ?? "").toLowerCase(),
    block_number: item.block,
    timestamp: item.timestamp,
    from_address: typeof from.hash === "string" ? from.hash.toLowerCase() : null,
    to_address: typeof to.hash === "string" ? to.hash.toLowerCase() : null,
    is_contract_interaction: to.is_contract === true,
    status: item.status,
    method: item.method,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return json(req, { error: "Origin not allowed." }, 403);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Wallet verification service is not configured.");
    const rpc = rpcClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const address = normalizeAddress(body.address);
    const action = String(body.action ?? "");

    if (action === "challenge") {
      const suppliedChain = String(body.chain_id ?? "");
      if (suppliedChain !== String(CHAIN_ID) && suppliedChain.toLowerCase() !== "0xb626") {
        return json(req, { error: "Switch to Robinhood Chain Testnet first." }, 400);
      }
      const id = crypto.randomUUID();
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);
      const message = [
        "PIXORUN Launchpad Wallet Verification", "",
        "Domain: pixorun.xyz", "URI: https://pixorun.xyz/launchpad/",
        "Wallet: " + address, "Chain ID: " + CHAIN_ID, "Nonce: " + nonce,
        "Issued At: " + issuedAt.toISOString(), "Expiration Time: " + expiresAt.toISOString(), "",
        "Sign this message to prove wallet ownership. This request will not send a transaction or spend funds.",
      ].join("\n");
      await rpc("launchpad_create_wallet_challenge", {
        p_id: id, p_wallet: address, p_message: message, p_nonce_hash: await sha256(nonce), p_expires_at: expiresAt.toISOString(),
      });
      return json(req, { challenge_id: id, message, expires_at: expiresAt.toISOString() });
    }

    if (action === "verify") {
      const challengeId = String(body.challenge_id ?? "");
      const message = String(body.message ?? "");
      const nonce = String(body.nonce ?? "");
      const signature = String(body.signature ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(challengeId) || nonce.length !== 64 || !/^[a-f0-9]{64}$/i.test(nonce)) {
        return json(req, { error: "Invalid or expired verification challenge. Please try again." }, 400);
      }
      if (message.length > 1200 || !message.includes("Domain: pixorun.xyz") ||
          !message.includes("Wallet: " + address) || !message.includes("Chain ID: " + CHAIN_ID) ||
          !message.includes("Nonce: " + nonce) || !message.includes("URI: https://pixorun.xyz/launchpad/")) {
        return json(req, { error: "The signed message does not match this wallet or network." }, 400);
      }
      if (!/^0x[0-9a-fA-F]+$/.test(signature)) return json(req, { error: "Invalid wallet signature." }, 400);
      const valid = await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
      if (!valid) return json(req, { error: "Signature verification failed." }, 401);
      const consumed = await rpc("launchpad_consume_wallet_challenge", {
        p_id: challengeId, p_wallet: address, p_message: message, p_nonce_hash: await sha256(nonce),
      });
      if (consumed !== true) return json(req, { error: "This challenge has expired or has already been used. Request a new one." }, 409);
      const result = await rpc("launchpad_mark_wallet_verified", { p_wallet: address });
      const accessToken = await createAccessToken(address, serviceKey);
      return json(req, { ...result, access_token: accessToken, access_expires_in: 900 });
    }

    if (action === "index") {
      const accessToken = String(body.access_token ?? "");
      if (!(await validAccessToken(address, accessToken, serviceKey))) {
        return json(req, { error: "Wallet verification expired. Please reconnect and verify again." }, 401);
      }
      const state = await rpc("launchpad_get_index_cursor", { p_wallet: address });
      if (!state) return json(req, { error: "Verified wallet profile not found." }, 404);
      if (state.history_complete) return json(req, { ...state, history_complete: true, message: "Wallet transaction history is fully indexed." });
      const lock = await rpc("launchpad_begin_index", { p_wallet: address });
      if (lock !== true) return json(req, { error: "Please wait 15 seconds before requesting the next indexing batch." }, 429);

      let cursor = state.cursor ?? null;
      let pagesRead = 0;
      let stored = 0;
      let nextCursor = cursor;
      try {
        while (pagesRead < 3) {
          const url = new URL(`${EXPLORER_API}/addresses/${address}/transactions`);
          if (nextCursor && typeof nextCursor === "object") {
            for (const [key, value] of Object.entries(nextCursor as Record<string, unknown>)) {
              if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
            }
          }
          const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
          if (!response.ok) throw new Error("Robinhood Testnet Explorer returned HTTP " + response.status);
          const data = await response.json();
          if (!data || !Array.isArray(data.items)) throw new Error("Explorer returned an unexpected transaction-history response.");
          const items = data.items.map((item: Record<string, unknown>) => normalizeExplorerItem(item));
          nextCursor = data.next_page_params ?? null;
          const complete = !nextCursor;
          const result = await rpc("launchpad_store_index_batch", {
            p_wallet: address, p_items: items, p_next_cursor: nextCursor, p_complete: complete,
          });
          stored += Number(result?.stored ?? 0);
          pagesRead++;
          if (complete || items.length === 0) { nextCursor = null; break; }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Explorer indexing failed.";
        await rpc("launchpad_mark_index_error", { p_wallet: address, p_error: reason.slice(0, 240) });
        return json(req, { error: "On-chain history could not be fetched right now. " + reason, retryable: true }, 503);
      }
      const updated = await rpc("launchpad_get_index_cursor", { p_wallet: address });
      return json(req, {
        ...updated, pages_read: pagesRead, new_transactions: stored,
        history_complete: Boolean(updated?.history_complete),
        message: updated?.history_complete ? "History indexing complete." : "Partial history saved. Continue indexing to fetch older transactions.",
        score_status: updated?.history_complete ? "pending" : "indexing",
      });
    }

    return json(req, { error: "Unknown action." }, 400);
  } catch (error) {
    console.error("launchpad-wallet:", error);
    return json(req, { error: error instanceof Error ? error.message : "Wallet verification failed." }, 400);
  }
});
