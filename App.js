import React, { useRef, useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import * as Notifications from 'expo-notifications';
import { Linking, ActivityIndicator, View, Text, Alert, AppState } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import supabase from './src/lib/supabase';

import { AuthProvider, useAuth } from "./src/context/AuthContext";

import LoadingScreen from "./src/screens/LoadingScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ForgotPasswordScreen from "./src/screens/ForgotPasswordScreen";
import CreateNewPasswordScreen from "./src/screens/CreateNewPasswordScreen";
import HomeScreen from "./src/screens/HomeScreen";
import RecordingScreen from "./src/screens/RecordingScreen";
import IncidentSummaryScreen from "./src/screens/IncidentSummaryScreen";
import MyIncidentScreen from "./src/screens/MyIncidentScreen";
import IncidentDetailsScreen from "./src/screens/IncidentDetailsScreen";
import DeviceWelcomeScreen from "./src/screens/DeviceWelcomeScreen";
import DevicePairingFlowScreen from "./src/screens/DevicePairingFlowScreen";
import RequestBackupScreen from "./src/screens/RequestBackupScreen";
import EmergencyBackupScreen from "./src/screens/EmergencyBackupScreen";

const Stack = createNativeStackNavigator();

// Deep linking configuration - kept for future use but not currently used for password reset
const linking = {
  prefixes: ['evvos://'],
  config: {
    screens: {
      // Add other deep link screens here if needed
    },
  },
};

function AppNavigator({ navigationRef }) {
  const { recoveryMode, isAuthenticated, loading } = useAuth();

  // Navigate to password reset screen when recovery mode is detected
  useEffect(() => {
    if (recoveryMode) {
      console.log('Recovery mode detected, navigating to CreateNewPassword');
      navigationRef.current?.navigate('CreateNewPassword');
    }
  }, [recoveryMode, navigationRef]);

  // Screen names that should prevent back navigation
  const screensWithBackDisabled = [
    'Loading',
    'Login',
    'Home',
    'Recording',
    'IncidentSummary',
  ];

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        // Add listener to prevent back navigation on specific screens
        if (navigationRef.current) {
          navigationRef.current.addListener('beforeRemove', (e) => {
            const currentRoute = navigationRef.current?.getCurrentRoute();
            
            if (screensWithBackDisabled.includes(currentRoute?.name)) {
              console.log(`[Navigation] Back prevented on screen: ${currentRoute?.name}`);
              e.preventDefault();
            }
          });
        }
      }}
    >
      <StatusBar style="light" />
      <Stack.Navigator initialRouteName="Loading" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Loading" component={LoadingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        <Stack.Screen name="CreateNewPassword" component={CreateNewPasswordScreen} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Recording" component={RecordingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="IncidentSummary" component={IncidentSummaryScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="MyIncident" component={MyIncidentScreen} />
        <Stack.Screen name="IncidentDetails" component={IncidentDetailsScreen} />
        <Stack.Screen name="DeviceWelcome" component={DeviceWelcomeScreen} />
        <Stack.Screen name="DevicePairingFlow" component={DevicePairingFlowScreen} />
        <Stack.Screen name="RequestBackup" component={RequestBackupScreen} options={{ headerShown: false }} />
        <Stack.Screen name="EmergencyBackup" component={EmergencyBackupScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const navigationRef = useRef();

  // Setup Firebase and notification listeners globally - runs once at app startup
  useEffect(() => {
    console.log('[App] Setting up global Firebase and notification listeners...');

    // Define notification category with actions
    Notifications.setNotificationCategoryAsync('emergency_backup', [
      {
        identifier: 'accept',
        buttonTitle: 'ACCEPT',
        options: { isDestructive: false },
      },
      {
        identifier: 'decline',
        buttonTitle: 'DECLINE',
        options: { isDestructive: true },
      },
    ]);

    // Handle Firebase message when app is in background or foreground
    let unsubscribeForeground = null;
    try {
      unsubscribeForeground = messaging().onMessage(async (remoteMessage) => {
        console.log('[App] Firebase message received (app is active):', remoteMessage.data);
        const data = remoteMessage.data;
        
        if (data?.type === 'emergency_backup' && data?.request_id) {
          // Extract title and body from data
          const title = data.title || remoteMessage.notification?.title || '🚨 Emergency Backup Alert';
          const body = data.body || remoteMessage.notification?.body || 'Emergency backup triggered';
          
          console.log('[App] Showing notification with action buttons:', { title, body });
          
          // Show notification with sound and vibration AND action buttons
          await Notifications.presentNotificationAsync({
            title: title,
            body: body,
            data: data,
            categoryIdentifier: 'emergency_backup',
            sound: 'default',
            ios: {
              sound: true,
            },
            android: {
              sound: 'default',
              channelId: 'emergency_alerts',
              priority: 'max',
              vibrate: [0, 500, 250, 500],
            },
          });
          console.log('[App] Emergency notification displayed to user with action buttons');
        }
      });
    } catch (firebaseError) {
      console.warn('[App] Firebase messaging setup failed:', firebaseError.message);
    }

    // Handle notification when app is foreground
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('[App] Notification received (foreground):', notification.request.content.data);
      const data = notification.request.content.data;
      if (data?.type === 'emergency_backup' && data?.request_id) {
        // Present local notification with actions
        Notifications.presentNotificationAsync({
          title: notification.request.content.title,
          body: notification.request.content.body,
          data: data,
          categoryIdentifier: 'emergency_backup',
        });
      }
    });

    // Handle notification response (when user taps on notification or actions)
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(async response => {
      const { actionIdentifier, notification } = response;
      const data = notification.request.content.data;
      console.log('[App] Notification action received:', actionIdentifier);
      console.log('[App] Notification data:', data);
      
      if (data?.type === 'emergency_backup' && data?.request_id) {
        if (actionIdentifier === 'accept') {
          console.log('[App] ✅ ACCEPT action - Officer:', data?.enforcer, 'Request ID:', data?.request_id);
          // Update responders count
          try {
            console.log('[App] Fetching current responders count...');
            const { data: current, error: fetchError } = await supabase
              .from('emergency_backups')
              .select('responders')
              .eq('request_id', data.request_id)
              .single();
            
            if (fetchError) {
              console.error('[App] Error fetching responders:', fetchError);
              throw fetchError;
            }
            
            if (current) {
              const newResponderCount = current.responders + 1;
              console.log('[App] Current responders:', current.responders, '-> incrementing to', newResponderCount);
              
              const { error: updateError } = await supabase
                .from('emergency_backups')
                .update({ responders: newResponderCount })
                .eq('request_id', data.request_id);
              
              if (updateError) {
                console.error('[App] Error updating responders:', updateError);
                throw updateError;
              }
              
              console.log('[App] ✅ Responders count updated successfully');
            } else {
              console.warn('[App] No backup found for request_id:', data.request_id);
            }
          } catch (err) {
            console.error('[App] Failed to update responders:', err.message);
          }
          
          // Navigate to EmergencyBackupScreen
          console.log('[App] 🚀 Navigating to EmergencyBackup screen with request_id:', data.request_id);
          navigationRef.current?.navigate('EmergencyBackup', { request_id: data.request_id });
        } else if (actionIdentifier === 'decline') {
          console.log('[App] ❌ DECLINE action - Officer:', data?.enforcer);
          // Do nothing
        } else {
          console.log('[App] Default notification tap - Officer:', data?.enforcer);
          // Default tap, navigate
          navigationRef.current?.navigate('EmergencyBackup', { request_id: data.request_id });
        }
      }
    });

    // Cleanup subscriptions
    return () => {
      console.log('[App] Cleaning up notification listeners');
      subscription.remove();
      responseSubscription.remove();
      if (unsubscribeForeground) unsubscribeForeground();
    };
  }, []);

  useEffect(() => {
    const prepareApp = async () => {
      try {
        // Get initial URL (from deep link) - kept for future use
        const initialURL = await Linking.getInitialURL();
        if (initialURL != null) {
          console.log('Initial URL:', initialURL);
          // Handle any future deep linking logic here
        }
      } catch (e) {
        console.error('Failed to get initial URL:', e);
      } finally {
        setIsReady(true);
      }
    };

    prepareApp();
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1A33' }}>
        <ActivityIndicator size="large" color="#2E78E6" />
        <Text style={{ marginTop: 16, color: '#fff', fontSize: 14 }}>
          Loading...
        </Text>
      </View>
    );
  }

  return (
    <AuthProvider>
      <AppNavigator navigationRef={navigationRef} />
    </AuthProvider>
  );
}
