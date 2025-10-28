import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export interface NotificationData {
  title: string;
  body: string;
  data?: any;
}

class NotificationService {
  private expoPushToken: string | null = null;

  constructor() {
    this.initializeNotifications();
  }

  private async initializeNotifications() {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    await this.registerForPushNotifications();
  }

  async registerForPushNotifications(): Promise<string | null> {
    if (!Device.isDevice) {
      console.log('Push notifications only work on physical devices');
      return null;
    }

    if (this.isRunningInExpoGo()) {
      console.log(
        'Expo Go detected. Remote push notifications are disabled in Expo Go; use a development build to test push notifications.'
      );
      return null;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Permission to send push notifications denied');
        return null;
      }

      const projectId = this.resolveProjectId();
      if (!projectId) {
        console.warn(
          'No EAS project ID found. Set it in app config (expo.extra.eas.projectId or EXPO_PROJECT_ID) to enable remote push notifications.'
        );
        return null;
      }

      const tokenData = await Notifications.getDevicePushTokenAsync();

      this.expoPushToken = tokenData.data;

      if (this.expoPushToken) {
        console.log('Native Push Token:', this.expoPushToken);
        await this.sendTokenToBackend(this.expoPushToken);
      }

      if (Platform.OS === 'android') {
        await this.setupAndroidChannel();
      }

      console.log('Expo Push Token:', this.expoPushToken);
      return this.expoPushToken;
    } catch (error) {
      console.error('Error getting push notification token:', error);
      return null;
    }
  }

  async sendTokenToBackend(token: string) {
    const backendUrl = this.getBackendBaseUrl();
    if (!backendUrl) {
      console.warn('No backend URL configured; skipping device token registration.');
      return;
    }

    try {
      await fetch(`${backendUrl}/save-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User', fcm_device_token: token }),
      });
      console.log('Device token sent to backend');
    } catch (error) {
      console.error('Failed to send token to backend:', error);
    }
  }

  async requestBackendToSendNotification(title: string, body: string) {
    const backendUrl = this.getBackendBaseUrl();
    if (!backendUrl) {
      console.warn('No backend URL configured; cannot request backend notification.');
      return;
    }

    try {
      await fetch(`${backendUrl}/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          token: this.expoPushToken,
        }),
      });
      console.log('Request sent to backend to send notification');
    } catch (error) {
      console.error('Failed to request backend notification:', error);
    }
  }

  private isRunningInExpoGo(): boolean {
    return Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';
  }

  private resolveProjectId(): string | undefined {
    const easProjectId = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

    return (
      Constants.expoConfig?.extra?.eas?.projectId ||
      easProjectId ||
      process.env.EXPO_PROJECT_ID
    );
  }

  private getBackendBaseUrl(): string | undefined {
    return (
      Constants.expoConfig?.extra?.backendUrl ||
      process.env.EXPO_PUBLIC_BACKEND_URL ||
      'https://5fd5bd8a6a0c.ngrok-free.app'
    );
  }

  private async setupAndroidChannel() {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });
  }

  async sendLocalNotification(notificationData: NotificationData): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data || {},
          sound: Platform.OS === 'ios' ? 'default' : 'default',
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  }

  async sendPushNotification(notificationData: NotificationData): Promise<void> {
    if (!this.expoPushToken) {
      console.log('No push token available');
      return;
    }

    const message = {
      to: this.expoPushToken,
      sound: 'default',
      title: notificationData.title,
      body: notificationData.body,
      data: notificationData.data || {},
    };

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const responseData = await response.json();
      console.log('Push notification sent:', responseData);
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  async sendPushNotificationViaBackend(notificationData: NotificationData): Promise<void> {
    if (!this.expoPushToken) {
      console.log('No push token available to send to backend');
      return;
    }

    const backendUrl = this.getBackendBaseUrl();
    if (!backendUrl) {
      console.warn('No backend URL configured; cannot request backend notification.');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.expoPushToken,
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data || {},
        }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to request backend notification');
      }
      
      console.log('Successfully requested backend to send notification:', responseData);
    } catch (error) {
      console.error('Error requesting backend to send notification:', error);
      throw error; // Re-throw the error to be caught in the UI
    }
  }

  getExpoPushToken(): string | null {
    return this.expoPushToken;
  }

  addNotificationReceivedListener(
    listener: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(listener);
  }

  addNotificationResponseReceivedListener(
    listener: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(listener);
  }

  removeNotificationSubscription(subscription: Notifications.Subscription): void {
    subscription.remove();
  }
}

export default new NotificationService();