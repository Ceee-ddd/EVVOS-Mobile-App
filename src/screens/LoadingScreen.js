import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../context/AuthContext";

export default function LoadingScreen({ navigation }) {
  const { loading, isAuthenticated } = useAuth();
  const [loadingMessage, setLoadingMessage] = useState("Initializing...");

  useEffect(() => {
    // Cycle through loading messages
    const messages = ["Initializing...", "Checking session...", "Loading profile..."];
    let index = 0;
    
    const interval = setInterval(() => {
      index = (index + 1) % messages.length;
      setLoadingMessage(messages[index]);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    console.log('[LoadingScreen] State update - loading:', loading, 'isAuthenticated:', isAuthenticated);
    
    // Once loading is complete, navigate based on authentication status
    if (!loading) {
      console.log('[LoadingScreen] ✅ Loading complete!');
      console.log('[LoadingScreen] Navigating to:', isAuthenticated ? 'Home' : 'Login');
      
      // Add a small delay to ensure all state is settled
      const navigationTimeout = setTimeout(() => {
        if (isAuthenticated) {
          console.log('[LoadingScreen] 🏠 User is authenticated - navigating to Home');
          navigation.replace("Home");
        } else {
          console.log('[LoadingScreen] 🔐 User is not authenticated - navigating to Login');
          navigation.replace("Login");
        }
      }, 100);
      
      return () => clearTimeout(navigationTimeout);
    }
  }, [loading, isAuthenticated, navigation]);

  return (
    <LinearGradient
      colors={["#0B1A33", "#3D5F91"]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.container}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color="#2E78E6" />
          <Text style={styles.title}>E.V.V.O.S.</Text>
          <Text style={styles.subtitle}>
            Enforcer Voice-activated Video Observation System
          </Text>
          <Text style={styles.loadingText}>{loadingMessage}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  content: {
    alignItems: "center",
  },
  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 24,
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 16,
  },
  loadingText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
