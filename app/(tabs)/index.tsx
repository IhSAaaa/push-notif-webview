import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import NotificationService from '@/services/NotificationService';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function HomeScreen() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notifications.Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState('Custom Title');
  const [notificationBody, setNotificationBody] = useState('This is a custom body!');

  useEffect(() => {
    let notificationListener: Notifications.Subscription;
    let responseListener: Notifications.Subscription;

    const initializeNotifications = async () => {
      try {
        const token = await NotificationService.registerForPushNotifications();
        setExpoPushToken(token);

        notificationListener = NotificationService.addNotificationReceivedListener(
          (notification) => {
            console.log('Notification received:', notification);
            setNotifications(prev => [notification, ...prev]);
          }
        );

        responseListener = NotificationService.addNotificationResponseReceivedListener(
          (response) => {
            console.log('Notification response:', response);
            Alert.alert(
              'Notification Tapped',
              `You tapped: ${response.notification.request.content.title}`
            );
          }
        );
      } catch (error) {
        console.error('Error initializing notifications:', error);
        Alert.alert('Error', 'Failed to initialize notifications');
      }
    };

    initializeNotifications();

    return () => {
      if (notificationListener) {
        NotificationService.removeNotificationSubscription(notificationListener);
      }
      if (responseListener) {
        NotificationService.removeNotificationSubscription(responseListener);
      }
    };
  }, []);

  const sendPushNotification = async () => {
    if (!expoPushToken) {
      Alert.alert('Error', 'No push token available. Make sure you have permissions.');
      return;
    }

    setIsLoading(true);
    try {
      // This now calls our backend to send the notification
      await NotificationService.sendPushNotificationViaBackend({
        title: notificationTitle,
        body: notificationBody,
        data: { 
          type: 'push-backend',
          platform: Platform.OS,
          timestamp: new Date().toISOString(),
        },
      });

    } catch (error) {
      console.error('Error sending push notification via backend:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const getPlatformInfo = () => {
    return Platform.OS === 'ios' ? 'iOS' : 'Android';
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ThemedView style={styles.headerContainer}>
          <ThemedText type="title" style={styles.title}>
            Push Notifications Demo
          </ThemedText>
          <ThemedText style={styles.platform}>
            Platform: {getPlatformInfo()}
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.tokenContainer}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Push Token Status
          </ThemedText>
          <View style={styles.tokenBox}>
            <Text style={styles.tokenText}>
              {expoPushToken ? 'Token Ready ✅' : 'No Token ❌'}
            </Text>
            {expoPushToken && (
              <Text style={styles.tokenValue} numberOfLines={1}>
                {expoPushToken.substring(0, 50)}...
              </Text>
            )}
          </View>
        </ThemedView>

        <ThemedView style={styles.buttonContainer}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Send Notifications
          </ThemedText>

          <TextInput
            style={styles.input}
            placeholder="Notification Title"
            value={notificationTitle}
            onChangeText={setNotificationTitle}
          />
          <TextInput
            style={styles.input}
            placeholder="Notification Body"
            value={notificationBody}
            onChangeText={setNotificationBody}
          />

          <TouchableOpacity
            style={[styles.button, styles.pushButton]}
            onPress={sendPushNotification}
            disabled={isLoading || !expoPushToken}
          >
            <Text style={styles.buttonText}>
              {isLoading ? 'Sending...' : 'Send Push Notification'}
            </Text>
            <Text style={styles.buttonSubtext}>
              Via Expo Push Service
            </Text>
          </TouchableOpacity>
        </ThemedView>

        <ThemedView style={styles.notificationsContainer}>
          <View style={styles.notificationHeader}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Received Notifications ({notifications.length})
            </ThemedText>
            {notifications.length > 0 && (
              <TouchableOpacity onPress={clearNotifications}>
                <Text style={styles.clearButton}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No notifications received yet</Text>
            </View>
          ) : (
            notifications.map((notification, index) => (
              <View key={index} style={styles.notificationItem}>
                <Text style={styles.notificationTitle}>
                  {notification.request.content.title}
                </Text>
                <Text style={styles.notificationBody}>
                  {notification.request.content.body}
                </Text>
                <Text style={styles.notificationTime}>
                  {new Date(notification.date).toLocaleTimeString()}
                </Text>
              </View>
            ))
          )}
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
  },
  headerContainer: {
    marginBottom: 30,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 10,
  },
  platform: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  tokenContainer: {
    marginBottom: 30,
  },
  sectionTitle: {
    marginBottom: 15,
    color: '#333',
  },
  tokenBox: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  tokenText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  tokenValue: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  buttonContainer: {
    marginBottom: 30,
  },
  button: {
    padding: 20,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  localButton: {
    backgroundColor: '#4CAF50',
  },
  pushButton: {
    backgroundColor: '#2196F3',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  buttonSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    textAlign: 'center',
  },
  notificationsContainer: {
    marginBottom: 20,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  clearButton: {
    color: '#FF5722',
    fontWeight: 'bold',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
  },
  notificationItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  notificationBody: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 20,
  },
  notificationTime: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#f0f0f0',
    padding: 15,
    borderRadius: 10,
    borderColor: '#ddd',
    borderWidth: 1,
    marginBottom: 15,
    fontSize: 16,
  },
});
