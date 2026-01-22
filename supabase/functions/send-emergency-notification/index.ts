import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - firebase-admin types
import admin from "npm:firebase-admin@11.11.0";

interface EmergencyBackupPayload {
  enforcer: string;
  location: string;
  time: string;
  request_id: string;
  responders?: number;
  triggered_by_user_id?: string;
}

serve(async (req) => {
  console.log("[EMERGENCY] Function called");
  console.log("[EMERGENCY] Method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const payload: EmergencyBackupPayload = await req.json();
    const { enforcer, location, time, request_id, responders = 0, triggered_by_user_id } = payload;

    console.log("[EMERGENCY] Received payload:", {
      enforcer,
      location,
      request_id,
      time,
      triggered_by_user_id,
    });

    // Initialize Supabase environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("[EMERGENCY] Supabase URL present:", !!supabaseUrl);
    console.log("[EMERGENCY] Supabase Key present:", !!supabaseKey);

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase environment variables");
    }

    // Fetch users with push tokens from Supabase
    console.log("[EMERGENCY] Fetching users with push tokens...");
    console.log("[EMERGENCY] Excluding user:", triggered_by_user_id || "none");
    
    // Build query to exclude the triggering user
    let queryUrl = `${supabaseUrl}/rest/v1/users?select=id,push_token,display_name&push_token=not.is.null`;
    if (triggered_by_user_id) {
      queryUrl += `&id=neq.${triggered_by_user_id}`;
    }
    
    const supabaseResponse = await fetch(
      queryUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          apikey: supabaseKey,
        },
      }
    );

    console.log("[EMERGENCY] Supabase response status:", supabaseResponse.status);

    if (!supabaseResponse.ok) {
      throw new Error(
        `Failed to fetch users: ${supabaseResponse.statusText}`
      );
    }

    const users = await supabaseResponse.json();

    console.log("[EMERGENCY] Found users count:", users.length);
    console.log("[EMERGENCY] Users fetched:", users.length > 0 ? `✅ ${users.length} users` : "❌ No users");

    if (!users || users.length === 0) {
      console.warn(
        "[EMERGENCY] No active users with FCM tokens found"
      );
      return new Response(
        JSON.stringify({ success: true, message: "No users to notify", sent: 0, total: 0 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if Firebase secret is available
    const firebaseSecretStr = Deno.env.get("FIREBASE_ADMIN_SDK");
    
    if (!firebaseSecretStr) {
      console.error("[EMERGENCY] ❌ FIREBASE_ADMIN_SDK secret is missing or not set");
      throw new Error("FIREBASE_ADMIN_SDK secret is not configured in Supabase");
    }
    
    console.log("[EMERGENCY] Firebase secret present ✅");

    // Parse Firebase credentials
    let FIREBASE_ADMIN_SDK;
    try {
      FIREBASE_ADMIN_SDK = JSON.parse(firebaseSecretStr);
      console.log("[EMERGENCY] Firebase config parsed ✅");
      console.log("[EMERGENCY] Firebase project_id:", FIREBASE_ADMIN_SDK.project_id || "N/A");
    } catch (parseError) {
      console.error("[EMERGENCY] ❌ Failed to parse Firebase credentials:", parseError.message);
      throw new Error(`Failed to parse Firebase credentials: ${parseError.message}`);
    }

    if (!FIREBASE_ADMIN_SDK.project_id) {
      throw new Error("FIREBASE_ADMIN_SDK secret not configured properly");
    }

    // Initialize Firebase Admin SDK
    console.log("[EMERGENCY] Initializing Firebase Admin SDK...");
    try {
      console.log("[EMERGENCY] admin object type:", typeof admin);
      console.log("[EMERGENCY] admin.apps property exists:", !!admin.apps);
      
      const existingApps = admin.apps || [];
      console.log("[EMERGENCY] Existing apps count:", existingApps.length);
      
      if (existingApps.length === 0) {
        console.log("[EMERGENCY] Creating Firebase app with credential...");
        console.log("[EMERGENCY] credential method exists:", typeof admin.credential);
        
        const credential = admin.credential.cert(FIREBASE_ADMIN_SDK);
        console.log("[EMERGENCY] Credential created ✅");
        
        admin.initializeApp({
          credential: credential,
        });
        console.log("[EMERGENCY] Firebase initialized ✅");
      } else {
        console.log("[EMERGENCY] Firebase already initialized");
      }
    } catch (firebaseInitError) {
      console.error("[EMERGENCY] ❌ Firebase initialization failed:", firebaseInitError.message);
      console.error("[EMERGENCY] Full error:", JSON.stringify(firebaseInitError, null, 2));
      throw firebaseInitError;
    }

    console.log("[EMERGENCY] Getting messaging instance...");
    const messaging = admin.messaging();
    console.log("[EMERGENCY] Messaging instance created ✅");

    // Prepare notification payload - send as data only so app can handle display with action buttons
    const notificationPayload = {
      data: {
        request_id: request_id,
        enforcer: enforcer,
        location: location,
        time: time,
        responders: responders.toString(),
        type: "emergency_backup",
        timestamp: new Date().toISOString(),
        title: "🚨 Emergency Backup Alert",
        body: `Officer ${enforcer} has triggered an emergency backup at ${location}`,
      },
      notification: {
        title: "🚨 Emergency Backup Alert",
        body: `Officer ${enforcer} has triggered an emergency backup at ${location}`,
      },
      android: {
        priority: "high",
      },
    };

    console.log("[EMERGENCY] Notification payload prepared ✅");
    console.log("[EMERGENCY] Sending notifications to", users.length, "users...");

    // Send notification to all users with push tokens
    const sendPromises = users
      .filter((user) => user.push_token)
      .map(async (user) => {
        try {
          console.log(`[EMERGENCY] Sending to ${user.display_name} (${user.id})...`);
          const response = await messaging.send({
            token: user.push_token,
            ...notificationPayload,
          });
          console.log(
            `[EMERGENCY] ✅ Sent to ${user.display_name}:`,
            response
          );
          return { user_id: user.id, success: true };
        } catch (error) {
          console.error(
            `[EMERGENCY] ❌ Error sending to ${user.display_name}:`,
            error.message
          );
          return { user_id: user.id, success: false, error: error.message };
        }
      });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter((r) => r.success).length;

    console.log(
      `[EMERGENCY] ✅ Completed: ${successCount}/${users.length} notifications sent`
    );

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        total: users.length,
        request_id: request_id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[EMERGENCY] ❌ Error:", error.message);
    console.error("[EMERGENCY] Error stack:", error.stack);
    console.error("[EMERGENCY] Full error:", JSON.stringify(error, null, 2));
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to send notifications",
        stack: error.stack
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
