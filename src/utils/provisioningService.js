import supabase from "../lib/supabase";

const PI_PROVISION_ENDPOINT = "http://192.168.4.1/provision";
const POLLING_INTERVAL = 2000; // 2 seconds
const POLLING_TIMEOUT = 120000; // 2 minutes

/**
 * Check if user has saved device credentials
 * @param {string} userId - The user's auth ID
 * @returns {Promise<boolean>} - true if credentials exist, false otherwise
 */
export async function checkExistingCredentials(userId) {
  try {
    const { data, error } = await supabase
      .from("device_credentials")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      console.error("Error checking credentials:", error);
      return false;
    }

    return data && data.length > 0;
  } catch (err) {
    console.error("checkExistingCredentials error:", err);
    return false;
  }
}

/**
 * Create a provisioning session token via Edge Function
 * @param {string} accessToken - User's Supabase access token
 * @returns {Promise<{token: string, expires_at: string}>} - Provisioning token and expiry
 */
export async function createProvisioningToken(accessToken) {
  try {
    console.log("🔵 Invoking create_provisioning_session edge function...");
    console.log("Access token starts with:", accessToken.substring(0, 20) + "...");
    
    const { data, error } = await supabase.functions.invoke(
      "create_provisioning_session",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    console.log("📝 Edge Function Response:", { data, error });

    if (error) {
      console.error("❌ Edge Function error object:", error);
      console.error("  - status:", error.status);
      console.error("  - statusText:", error.statusText);
      console.error("  - message:", error.message);
      console.error("  - full error:", JSON.stringify(error, null, 2));
      
      throw new Error(
        error.message || 
        (error.status ? `HTTP ${error.status}: ${error.statusText}` : "Failed to create provisioning token")
      );
    }

    if (!data) {
      console.error("❌ No data in response");
      throw new Error("Empty response from edge function");
    }

    if (!data?.token) {
      console.error("❌ No token in response:", data);
      throw new Error("No token returned from edge function");
    }

    console.log("✅ Token created successfully, token starts with:", data.token.substring(0, 8) + "...");
    return {
      token: data.token,
      expires_at: data.expires_at,
    };
  } catch (err) {
    console.error("❌ createProvisioningToken error:", err);
    console.error("  Error message:", err.message);
    console.error("  Error stack:", err.stack);
    throw err;
  }
}

/**
 * Send credentials to Pi provisioning server
 * @param {string} token - Provisioning token
 * @param {string} ssid - Hotspot SSID
 * @param {string} password - Hotspot password
 * @param {string} deviceName - Optional device name
 * @returns {Promise<{ok: boolean}>}
 */
export async function sendCredentialsToPi(
  token,
  ssid,
  password,
  deviceName = "EVVOS_0001"
) {
  try {
    const response = await fetch(PI_PROVISION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        ssid,
        password,
        device_name: deviceName,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `HTTP ${response.status}: Failed to send credentials`
      );
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error("sendCredentialsToPi error:", err);
    throw err;
  }
}

/**
 * Poll Supabase for provisioning completion
 * @param {string} token - Provisioning token
 * @param {number} timeout - Max time to poll in ms (default 2 minutes)
 * @returns {Promise<boolean>} - true if provisioning completed, false if timeout
 */
export async function pollProvisioningStatus(token, timeout = POLLING_TIMEOUT) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const pollInterval = setInterval(async () => {
      try {
        // Hash the token (same as Pi does)
        const tokenHash = await sha256hex(token);

        const { data, error } = await supabase
          .from("provisioning_sessions")
          .select("used, used_at")
          .eq("token_hash", tokenHash)
          .limit(1);

        if (error) {
          console.warn("Poll error:", error);
          // Continue polling on error
          return;
        }

        if (data && data.length > 0 && data[0].used) {
          console.log("✅ Provisioning completed!");
          clearInterval(pollInterval);
          resolve(true);
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          console.warn("Provisioning polling timeout");
          clearInterval(pollInterval);
          resolve(false);
          return;
        }
      } catch (err) {
        console.error("Poll catch error:", err);
        // Continue polling on error
      }
    }, POLLING_INTERVAL);
  });
}

/**
 * SHA256 hash helper (matches Pi implementation)
 */
async function sha256hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Complete provisioning flow
 * @param {string} accessToken - User's access token
 * @param {string} ssid - Hotspot SSID
 * @param {string} password - Hotspot password
 * @param {Function} onProgress - Callback for progress updates
 */
export async function startProvisioning(
  accessToken,
  ssid,
  password,
  onProgress = () => {}
) {
  try {
    // Step 1: Create token
    onProgress({ step: 1, message: "Creating provisioning token..." });
    const { token, expires_at } = await createProvisioningToken(accessToken);
    console.log("✅ Token created:", token.substring(0, 8) + "...");

    // Step 2: Send to Pi
    onProgress({ step: 2, message: "Sending credentials to EVVOS..." });
    await sendCredentialsToPi(token, ssid, password);
    console.log("✅ Credentials sent to Pi");

    // Step 3: Poll for completion
    onProgress({
      step: 3,
      message: "Waiting for device to connect...",
      ssid,
    });
    const completed = await pollProvisioningStatus(token);

    if (completed) {
      onProgress({ step: 4, message: "Provisioning complete!", success: true });
      return { success: true };
    } else {
      onProgress({
        step: 4,
        message: "Provisioning timeout",
        success: false,
        error: "Device did not connect within timeout period",
      });
      return { success: false, error: "Provisioning timeout" };
    }
  } catch (err) {
    console.error("startProvisioning error:", err);
    onProgress({
      step: -1,
      message: "Provisioning failed",
      success: false,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}
