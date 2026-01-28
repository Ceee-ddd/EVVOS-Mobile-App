import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { setPaired } from "../utils/deviceStore";
import { useAuth } from "../context/AuthContext";
import {
  checkExistingCredentials,
  createProvisioningToken,
  sendCredentialsToPi,
  pollProvisioningStatus,
} from "../utils/provisioningService";

export default function DevicePairingFlowScreen({ navigation }) {
  const { displayName, badge, logout, user, session } = useAuth();
  // Steps: 0=check, 1=intro, 2=create token, 3=connect AP, 4=enter creds, 5=send creds, 6=polling, 7=complete
  const [step, setStep] = useState(0);
  const [ssid, setSsid] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  // Check for existing credentials on mount
  useEffect(() => {
    const checkCredentials = async () => {
      if (!user?.id) return;
      
      try {
        const hasCredentials = await checkExistingCredentials(user.id);
        if (hasCredentials) {
          // Skip pairing flow
          await setPaired(true);
          setStep(7); // go to complete
        } else {
          setStep(1); // start intro
        }
      } catch (err) {
        console.error("Error checking credentials:", err);
        setStep(1); // start intro on error
      }
    };

    checkCredentials();
  }, [user?.id]);

  // Handle polling for provisioning completion
  useEffect(() => {
    if (step !== 6) return; // Only run during polling step

    const startPolling = async () => {
      if (!token) return;

      try {
        const completed = await pollProvisioningStatus(token);

        if (completed) {
          await setPaired(true);
          setStep(7); // Complete
        } else {
          setError("Provisioning timeout. Please try again.");
          setStep(5); // Go back to send step
        }
      } catch (err) {
        console.error("Polling error:", err);
        setError(err.message);
        setStep(5);
      }
    };

    startPolling();
  }, [step, token]);

  const handleCreateToken = async () => {
    if (!session?.access_token) {
      setError("No authentication token available");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token: provToken } = await createProvisioningToken(
        session.access_token
      );
      setToken(provToken);
      setStep(3); // Move to connect step
    } catch (err) {
      setError(err.message || "Failed to create provisioning token");
    } finally {
      setLoading(false);
    }
  };

  const handleSendCredentials = async () => {
    if (!token || !ssid || !pw) {
      setError("SSID and password are required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await sendCredentialsToPi(token, ssid, pw);
      setStep(5); // Move to send confirmation step
    } catch (err) {
      setError(err.message || "Failed to send credentials to device");
    } finally {
      setLoading(false);
    }
  };

  const goDashboard = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: "Home" }],
    });
  };

  const handleGoBack = () => {
    Alert.alert(
      "Go Back",
      "Are you sure you want to go back? This will exit the pairing flow.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Go Back",
          style: "destructive",
          onPress: () => navigation.goBack(),
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            await logout();
            navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          },
        },
      ]
    );
  };

  const renderContent = () => {
    // Step 1: Intro - before connecting to Pi
    if (step === 1) {
      return (
        <>
          <Text style={styles.stepText}>Device Pairing</Text>
          <Text style={styles.bodyText}>
            Do not turn on your phone hotspot yet. First tap 'Create pairing token', then connect your phone to EVVOS_0001.
          </Text>

          <View style={styles.imageBox}>
            <Ionicons name="wifi-outline" size={64} color="rgba(255,255,255,0.85)" />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={handleCreateToken}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <View style={styles.btnIconCircle}>
                  <Ionicons name="key-outline" size={20} color="white" />
                </View>
                <Text style={styles.primaryText}>Create Pairing Token</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      );
    }

    // Step 2: Token created, waiting for connection (auto-advance)
    if (step === 2) {
      return (
        <>
          <Text style={styles.stepText}>Connect to Device</Text>
          <Text style={styles.bodyText}>
            Turn on the E.V.V.O.S device and wait for the EVVOS_0001 network to appear. Then connect your phone to it.
          </Text>

          <View style={styles.imageBox}>
            <Ionicons name="phone-portrait-outline" size={64} color="rgba(255,255,255,0.85)" />
          </View>

          <TouchableOpacity 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={() => setStep(3)}
          >
            <View style={styles.btnIconCircle}>
              <Ionicons name="chevron-forward" size={25} color="white" />
            </View>
            <Text style={styles.primaryText}>Connected to Device</Text>
          </TouchableOpacity>
        </>
      );
    }

    // Step 3: Connected, ready for credentials
    if (step === 3) {
      return (
        <>
          <Text style={styles.stepText}>Enter Hotspot Credentials</Text>
          <Text style={styles.bodyText}>
            Enter your phone Hotspot name (SSID) and password. This is the hotspot you will turn on after sending to EVVOS. Example: 'JohnPhoneHotspot'
          </Text>

          <Text style={styles.label}>Hotspot SSID</Text>
          <View style={styles.inputWrap}>
            <TextInput
              value={ssid}
              onChangeText={setSsid}
              placeholder="Enter SSID"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              editable={!loading}
            />
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Hotspot Password</Text>
          <View style={styles.inputWrap}>
            <TextInput
              value={pw}
              onChangeText={setPw}
              placeholder="Enter password"
              placeholderTextColor="rgba(255,255,255,0.35)"
              secureTextEntry={!showPw}
              style={styles.input}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)} activeOpacity={0.8}>
              <Ionicons
                name={showPw ? "eye-off-outline" : "eye-outline"}
                size={16}
                color="rgba(255,255,255,0.55)"
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.smallNote}>Case and space sensitive</Text>
          
          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={handleSendCredentials}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <View style={styles.btnIconCircle}>
                  <Ionicons name="send-outline" size={20} color="white" />
                </View>
                <Text style={styles.primaryText}>Send to EVVOS</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      );
    }

    // Step 4: Placeholder (auto-advance to step 5)
    if (step === 4) {
      return null;
    }

    // Step 5: Instructions to turn on hotspot
    if (step === 5) {
      return (
        <>
          <Text style={styles.stepText}>Turn On Hotspot</Text>
          <Text style={styles.bodyText}>
            Now turn on your phone's Hotspot (SSID: {ssid}). When you turn it on, your phone will disconnect from EVVOS_0001 — open the app again after one minute to continue. You'll be notified when provisioning is complete.
          </Text>

          <View style={styles.imageBox}>
            <Ionicons name="cellular-outline" size={64} color="rgba(255,255,255,0.85)" />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={() => setStep(6)}
          >
            <View style={styles.btnIconCircle}>
              <Ionicons name="play-outline" size={20} color="white" />
            </View>
            <Text style={styles.primaryText}>Check Status</Text>
          </TouchableOpacity>
        </>
      );
    }

    // Step 6: Polling for completion
    if (step === 6) {
      return (
        <View style={{ alignItems: "center", marginTop: 34 }}>
          <Text style={styles.pairingTitle}>Provisioning…</Text>
          <Text style={styles.bodyText}>Checking device status.</Text>

          <View style={[styles.imageBox, { marginTop: 18 }]}>
            <Ionicons name="globe-outline" size={92} color="rgba(255,255,255,0.85)" />
          </View>

          <ActivityIndicator size="large" color="#15C85A" style={{ marginTop: 18 }} />
        </View>
      );
    }

    // Step 7: Complete
    return (
      <View style={{ alignItems: "center", marginTop: 34 }}>
        <Text style={styles.pairingTitle}>Provisioning Complete!</Text>
        <Text style={styles.bodyText}>Your device is now paired and ready to use.</Text>

        <View style={[styles.imageBox, { marginTop: 18 }]}>
          <Ionicons name="checkmark-circle-outline" size={80} color="#15C85A" />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 22 }]}
          activeOpacity={0.9}
          onPress={goDashboard}
        >
          <View style={styles.btnIconCircle}>
            <Ionicons name="home-outline" size={20} color="white" />
          </View>
          <Text style={styles.primaryText}>Go to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <LinearGradient
      colors={["#0B1A33", "#3D5F91"]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="person-circle" size={26} color="#4DB5FF" />
            <View style={{ marginLeft: 8 }}>
              <Text style={styles.officerName}>Officer {displayName}</Text>
              <Text style={styles.badge}>{badge ? `Badge #${badge}` : ""}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity activeOpacity={0.9} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={18} color="rgba(255,255,255,0.75)" />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={handleGoBack}>
              <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.75)" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          {renderContent()}

          <Text style={styles.footer}>Public Safety and Traffic Management Department</Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  officerName: { color: "rgba(255,255,255,0.90)", fontSize: 12, fontWeight: "700" },
  badge: { color: "rgba(255,255,255,0.55)", fontSize: 10, marginTop: 2 },

  page: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36 },

  stepText: { color: "rgba(255,255,255,0.92)", fontSize: 20, fontWeight: "800", marginBottom: 12 },
  bodyText: { color: "rgba(255,255,255,0.70)", fontSize: 12, lineHeight: 18, marginBottom: 16 },

  imageBox: {
    height: 190,
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  primaryBtn: {
    height: 50,
    width: "100%",
    borderRadius: 12,
    backgroundColor: "#15C85A",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
  },

  primaryText: { color: "white", fontSize: 15, fontWeight: "800" },

  label: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginBottom: 6, fontWeight: "600" },
  inputWrap: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  input: { color: "rgba(255,255,255,0.90)", fontSize: 12, flex: 1, paddingRight: 10 },
  smallNote: { color: "rgba(255,255,255,0.35)", fontSize: 10, marginTop: 6 },

  errorText: { color: "#FF6B6B", fontSize: 12, marginTop: 12, marginBottom: 12 },

  pairingTitle: { color: "rgba(255,255,255,0.92)", fontSize: 20, fontWeight: "600" },

  btnIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },

  footer: { marginTop: 22, alignSelf: "center", color: "rgba(255,255,255,0.25)", fontSize: 10 },
});
