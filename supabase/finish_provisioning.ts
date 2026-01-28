// finish_provisioning.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AES_KEY_B64 = Deno.env.get("PROV_AES_KEY_BASE64") || ""; // base64 32 bytes

console.log("🔵 [Module Load] SUPABASE_URL:", SUPABASE_URL ? "SET" : "MISSING");
console.log("🔵 [Module Load] SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING");
console.log("🔵 [Module Load] PROV_AES_KEY_BASE64:", AES_KEY_B64 ? "SET" : "MISSING");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// helpers: sha256 hex (same as create)
async function sha256hex(text: string) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex;
}

// helper: import AES key for Web Crypto
async function importAesKey(base64Key: string) {
  const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// helper: encrypt object -> returns Uint8Array of (iv || ciphertext)
async function encryptJson(obj: any) {
  if (!AES_KEY_B64) throw new Error("missing AES key");
  const key = await importAesKey(AES_KEY_B64);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  // combine iv + ciphertext into one Uint8Array
  const cipherArr = new Uint8Array(cipher);
  const out = new Uint8Array(iv.length + cipherArr.length);
  out.set(iv, 0);
  out.set(cipherArr, iv.length);
  return out;
}

const handler = async (req: Request): Promise<Response> => {
  try {
    // Validate required environment variables
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("❌ Missing environment variables");
      console.error("  SUPABASE_URL:", SUPABASE_URL ? "SET" : "MISSING");
      console.error("  SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING");
      return new Response(
        JSON.stringify({ error: "Edge Function not properly configured" }),
        { status: 500 }
      );
    }
    
    if (!AES_KEY_B64) {
      console.error("❌ PROV_AES_KEY_BASE64 is missing");
      return new Response(
        JSON.stringify({ error: "Encryption key not configured" }),
        { status: 500 }
      );
    }
    
    console.log("🔵 [finish_provisioning] Request received");
    
    const body = await req.json();
    const { token, ssid, password, device_name } = body ?? {};
    
    if (!token || !ssid || !password) {
      console.error("❌ Missing required fields:", { token: !!token, ssid: !!ssid, password: !!password });
      return new Response(JSON.stringify({ error: "missing fields (token, ssid, password required)" }), { status: 400 });
    }

    console.log(`✅ Request body valid: device_name=${device_name || "EVVOS_0001"}`);

    // hash token
    console.log("🔐 Hashing provisioning token...");
    const tokenHash = await sha256hex(token);
    console.log(`✅ Token hash computed: ${tokenHash.substring(0, 16)}...`);

    // find a matching, unused, unexpired session
    console.log("📍 Querying provisioning_sessions for matching token...");
    const nowIso = new Date().toISOString();
    const { data: sessions, error: selErr } = await supabase
      .from("provisioning_sessions")
      .select("*")
      .eq("token_hash", tokenHash)
      .eq("used", false)
      .lte("expires_at", new Date(Date.now() + 1000 * 60 * 60).toISOString())
      .limit(1);

    if (selErr) {
      console.error("❌ Database select error:", selErr);
      return new Response(JSON.stringify({ error: "db error", detail: selErr.message }), { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      console.warn("⚠️  No matching token found, checking for invalid/expired...");
      // no matching token (invalid or already used)
      // As an additional step, try exact query ignoring the .lte above
      const { data: sessAlt } = await supabase
        .from("provisioning_sessions")
        .select("*, expires_at")
        .eq("token_hash", tokenHash)
        .limit(1);
      
      if (!sessAlt || sessAlt.length === 0) {
        console.error("❌ Token not found in database");
        return new Response(JSON.stringify({ error: "invalid token" }), { status: 400 });
      }
      
      const s = sessAlt[0];
      if (s.used) {
        console.error("❌ Token already used");
        return new Response(JSON.stringify({ error: "token already used" }), { status: 400 });
      }
      if (new Date(s.expires_at) < new Date()) {
        console.error(`❌ Token expired at ${s.expires_at}`);
        return new Response(JSON.stringify({ error: "token expired" }), { status: 400 });
      }
    }

    const session = sessions![0];
    console.log(`✅ Session found: user_id=${session.user_id}, expires_at=${session.expires_at}`);
    
    // double-check expiry and used flag
    if (session.used) {
      console.error("❌ Session marked as used");
      return new Response(JSON.stringify({ error: "token already used" }), { status: 400 });
    }
    if (new Date(session.expires_at) < new Date()) {
      console.error("❌ Session expired");
      return new Response(JSON.stringify({ error: "token expired" }), { status: 400 });
    }

    const user_id = session.user_id;
    if (!user_id) {
      console.error("❌ Session missing user_id");
      return new Response(JSON.stringify({ error: "session missing user" }), { status: 500 });
    }

    console.log(`🔐 Encrypting WiFi credentials for user ${user_id}...`);
    // encrypt wifi credentials
    const payload = { ssid, password };
    const enc = await encryptJson(payload); // Uint8Array
    console.log(`✅ Credentials encrypted (${enc.byteLength} bytes)`);

    // write encrypted credentials to device_credentials
    console.log("💾 Inserting encrypted credentials into device_credentials...");
    const { error: credErr } = await supabase.from("device_credentials").insert({
      user_id,
      device_name: device_name ?? null,
      encrypted_payload: enc,
    });

    if (credErr) {
      console.error("❌ Insert credentials error:", credErr);
      return new Response(
        JSON.stringify({ error: "db write error", detail: credErr.message }), 
        { status: 500 }
      );
    }

    console.log("✅ Credentials saved");

    // mark provisioning session used
    console.log(`🔄 Marking provisioning session as used...`);
    const { error: updErr } = await supabase
      .from("provisioning_sessions")
      .update({ used: true, used_at: new Date().toISOString(), device_name: device_name ?? null })
      .eq("id", session.id);

    if (updErr) {
      console.error("❌ Update session error:", updErr);
      return new Response(
        JSON.stringify({ error: "db update error", detail: updErr.message }), 
        { status: 500 }
      );
    }

    console.log("✅ Session marked as used");
    console.log("🎉 Provisioning complete!");

    return new Response(JSON.stringify({ ok: true, message: "Device provisioned successfully" }), { 
      status: 200, 
      headers: { "content-type": "application/json" } 
    });
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return new Response(
      JSON.stringify({ 
        error: "internal error",
        detail: String(err)
      }), 
      { status: 500 }
    );
  }
};

export default handler;
