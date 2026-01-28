// create_provisioning_session.ts
// Handles empty request bodies gracefully and accepts device_name from body/header/query.
// Assumes "Verify JWT with legacy secret" is OFF and verifies JWT via JWKS.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

console.log("[Module Load] SUPABASE_URL:", SUPABASE_URL ? "SET" : "MISSING");
console.log("[Module Load] SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[Module Load] Missing supabase envs - DB ops will fail if not provided.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const jwksUrl = `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(jwksUrl));

async function sha256hex(str: string) {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req: Request) => {
  console.log("[Handler] invocation start:", new Date().toISOString());
  console.log("[Handler] method:", req.method);

  // CORS preflight
  if (req.method === "OPTIONS") {
    console.log("[Handler] OPTIONS preflight");
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-device-name",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // helpful debug: show a few headers (not too verbose in production)
  console.log("[Handler] headers (partial):", {
    "content-length": req.headers.get("content-length"),
    "user-agent": req.headers.get("user-agent"),
    "authorization": Boolean(req.headers.get("authorization")),
  });

  // parse JSON safely: if content-length is 0 or JSON is empty, treat as {}
  let body: any = {};
  const contentLength = req.headers.get("content-length");
  if (!contentLength || contentLength === "0") {
    console.log("[Handler] empty body detected (content-length=0) -> using {}");
    body = {};
  } else {
    try {
      body = await req.json();
    } catch (err) {
      const msg = String(err);
      // If the error is "Unexpected end of JSON input", treat as empty instead of failing.
      if (msg.includes("Unexpected end of JSON input")) {
        console.warn("[Handler] unexpected end of JSON input -> treating body as {}");
        body = {};
      } else {
        console.error("[Handler] failed to parse JSON body:", err);
        return new Response("Invalid JSON", { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }
  }

  // Authorization header & JWT verification (JWKS)
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    console.log("[Handler] missing authorization header");
    return new Response("Unauthorized", { status: 401, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  let payload: any;
  try {
    const verified = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1`,
      audience: "authenticated",
    });
    payload = (verified as any).payload;
    console.log("[Handler] jwt verified, sub:", payload.sub);
  } catch (err) {
    console.error("[Handler] jwt verify failed:", err);
    return new Response("Invalid token", { status: 401, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const user_id = payload.sub as string | undefined;
  if (!user_id) {
    console.error("[Handler] token has no sub claim");
    return new Response("Invalid token payload", { status: 401, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Allow device_name from body, header, or query param so clients without JSON can still provide it.
  const url = new URL(req.url);
  const device_name =
    (body && body.device_name) ??
    req.headers.get("x-device-name") ??
    url.searchParams.get("device_name") ??
    null;

  // generate pairing token and hash it
  const tokenPlain = crypto.randomUUID();
  const tokenHash = await sha256hex(tokenPlain);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  try {
    console.log("[Handler] inserting provisioning_sessions for user:", user_id, "device_name:", device_name);
    const { data, error } = await supabase
      .from("provisioning_sessions")
      .insert([
        {
          user_id,
          token_hash: tokenHash,
          device_name,
          expires_at: expiresAt,
        },
      ])
      .select();

    if (error) {
      console.error("[Handler] supabase insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    console.log("[Handler] insert success:", data && data.length ? JSON.stringify(data[0]) : "no-row-returned");

    const resp = {
      token: tokenPlain,
      expires_at: expiresAt,
      session: data?.[0] ?? null,
    };

    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("[Handler] unexpected error:", err);
    return new Response(JSON.stringify({ error: "internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } finally {
    console.log("[Handler] finished:", new Date().toISOString());
  }
});
