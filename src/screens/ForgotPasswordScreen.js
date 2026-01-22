import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import supabase from "../lib/supabase";

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertModal, setAlertModal] = useState({ visible: false, title: "", message: "", onConfirm: null });

  const handleSendLink = async () => {
    const trimmed = email.trim();

    if (!trimmed) {
      setAlertModal({ visible: true, title: "Missing Email", message: "Please enter your email.", onConfirm: null });
      return;
    }

    setLoading(true);
    try {
      // Check if email exists in users table
      const { data, error } = await supabase
        .from('users')
        .select('email')
        .eq('email', trimmed)
        .eq('role', 'enforcer')
        .eq('status', 'active')
        .single();

      if (error || !data) {
        setAlertModal({ visible: true, title: "Email Not Found", message: "No account found with this email.", onConfirm: null });
        return;
      }

      // Send OTP for password reset
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
      });

      if (otpError) {
        setAlertModal({ visible: true, title: "Error", message: otpError.message, onConfirm: null });
        return;
      }

      setAlertModal({
        visible: true,
        title: "OTP Sent",
        message: "An 8-digit OTP has been sent to your email. OTP expires in 15 minutes.",
        onConfirm: () => navigation.navigate("CreateNewPassword", { email: trimmed, sentTime: new Date().getTime() })
      });
    } catch (err) {
      setAlertModal({ visible: true, title: "Error", message: "An error occurred. Please try again.", onConfirm: null });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={["#0B1A33", "#3D5F91"]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
       
          <View style={styles.header}>
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>E.V.V.O.S.</Text>
            <Text style={styles.subtitle}>
              Enforcer Voice-activated Video Observation System
            </Text>
          </View>

          <View style={styles.card}>
            {/* Card top bar */}
            <View style={styles.cardTop}>
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.85)" />
              </TouchableOpacity>

              <Text style={styles.cardTitle}>Forgot Password</Text>
              <View style={{ width: 36 }} />
            </View>

            <View style={styles.cardBody}>
              <Text style={styles.label}>Email</Text>

              <View style={styles.inputWrap}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter email"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
              </View>

              <Text style={styles.helper}>
                Please enter your email to receive an 8-digit OTP.
              </Text>

              <TouchableOpacity onPress={handleSendLink} style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]} activeOpacity={0.85} disabled={loading}>
                <Text style={styles.primaryText}>{loading ? "Sending..." : "Send Token"}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.footer}>
            Public Safety and Traffic Management Department
          </Text>

          <Modal
            visible={alertModal.visible}
            transparent
            animationType="fade"
            onRequestClose={() => setAlertModal({ ...alertModal, visible: false })}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setAlertModal({ ...alertModal, visible: false })}
            >
              <Pressable
                style={[styles.modalCard, styles.modalBlueBorder]}
                onPress={() => {}}
              >
                <View style={styles.modalHeaderRow}>
                  <View style={styles.modalHeaderLeft}>
                    <Ionicons name="information-circle-outline" size={18} color="#2E78E6" />
                    <Text style={styles.modalTitle}>{alertModal.title}</Text>
                  </View>
                </View>

                <Text style={styles.modalBodyText}>{alertModal.message}</Text>

                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnCancel]}
                    activeOpacity={0.9}
                    onPress={() => {
                      setAlertModal({ ...alertModal, visible: false });
                      if (alertModal.onConfirm) {
                        alertModal.onConfirm();
                      }
                    }}
                  >
                    <Text style={styles.modalBtnText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gradient: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 28,
  },

  header: { alignItems: "center", marginBottom: 18 },
  logo: { width: 105, height: 105, marginBottom: 10 },
  title: {
    color: "white",
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 2,
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 16,
  },

  card: {
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  cardTop: {
    height: 44,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.18)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600" },

  cardBody: { padding: 14 },

  label: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginBottom: 8 },
  inputWrap: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: 10,
    height: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  input: { color: "white", fontSize: 14 },

  helper: {
    marginTop: 10,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    lineHeight: 15,
  },

  primaryBtn: {
    marginTop: 14,
    backgroundColor: "#2E78E6",
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnDisabled: {
    backgroundColor: "rgba(46, 120, 230, 0.5)",
  },
  primaryText: { color: "white", fontSize: 13, fontWeight: "600" },

  footer: {
    marginTop: 16,
    textAlign: "center",
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "rgba(15,25,45,0.96)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  modalBlueBorder: { borderColor: "rgba(46,120,230,0.55)" },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  modalHeaderLeft: { flexDirection: "row", alignItems: "center" },
  modalTitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "700",
  },
  modalBodyText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 14,
  },
  modalBtnRow: { flexDirection: "row", gap: 12 },
  modalBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  modalBtnCancel: {
    backgroundColor: "rgba(46, 120, 230, 0.2)",
    borderColor: "rgba(46, 120, 230, 0.4)",
  },
  modalBtnText: {
    color: "rgba(46, 120, 230, 0.95)",
    fontSize: 12,
    fontWeight: "700",
  },
});
