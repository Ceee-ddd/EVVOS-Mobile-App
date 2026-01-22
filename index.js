import { registerRootComponent } from 'expo';
import messaging from '@react-native-firebase/messaging';

import App from './App';

// Handle Firebase messages when app is in background/killed
try {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log('[Background Message] Received:', remoteMessage.data);
    // Just receive the message - notifications will be handled by the system
  });
} catch (error) {
  console.warn('[Background Message] Setup failed:', error.message);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
