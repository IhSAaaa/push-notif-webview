import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import NotificationService, { type NotificationData } from '@/services/NotificationService';

const DEFAULT_WEB_APP_URL = 'http://192.168.43.81:5173';

type BridgeRequestType =
  | 'REQUEST_PUSH_TOKEN'
  | 'SEND_PUSH_VIA_BACKEND'
  | 'SEND_LOCAL_NOTIFICATION';

type BridgeRequest = {
  type: BridgeRequestType;
  requestId?: string;
  payload?: unknown;
};

type BridgeResponse = {
  type: string;
  requestId?: string;
  payload?: unknown;
  error?: string;
};

interface SerializedNotification {
  id: string;
  title: string | null;
  body: string | null;
  data: Record<string, unknown>;
  date: string;
}

interface SerializedNotificationResponse {
  actionIdentifier: string;
  notification: SerializedNotification;
}

const resolveWebAppUrl = () => {
  const expoConfig = Constants.expoConfig as
    | (typeof Constants['expoConfig'] & {
        extra?: { webAppUrl?: string };
      })
    | undefined;

  return (
    expoConfig?.extra?.webAppUrl ??
    process.env.EXPO_PUBLIC_WEB_APP_URL ??
    DEFAULT_WEB_APP_URL
  );
};

const serializeNotification = (
  notification: Notifications.Notification
): SerializedNotification => ({
  id: notification.request.identifier,
  title: notification.request.content.title ?? null,
  body: notification.request.content.body ?? null,
  data: notification.request.content.data ?? {},
  date: new Date(notification.date).toISOString(),
});

const serializeNotificationResponse = (
  response: Notifications.NotificationResponse
): SerializedNotificationResponse => ({
  actionIdentifier: response.actionIdentifier,
  notification: serializeNotification(response.notification),
});

const toNotificationData = (payload: unknown): NotificationData => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'title' in payload &&
    'body' in payload
  ) {
    const { title, body, data } = payload as {
      title: unknown;
      body: unknown;
      data?: unknown;
    };

    return {
      title: typeof title === 'string' ? title : String(title ?? ''),
      body: typeof body === 'string' ? body : String(body ?? ''),
      data: typeof data === 'object' && data !== null ? data : undefined,
    };
  }

  throw new Error('Invalid notification payload received from web app');
};

const WebViewBridge = () => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWebReady, setIsWebReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const webAppUrl = useMemo(resolveWebAppUrl, []);

  const postToWeb = useCallback(
    (message: BridgeResponse) => {
      const serialized = JSON.stringify(message);
      webViewRef.current?.postMessage(serialized);
    },
    []
  );

  const withRequestGuard = useCallback(
    async (
      handler: () => Promise<void>,
      requestId?: string,
      errorContext?: string
    ) => {
      try {
        await handler();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected native error';
        console.error('Bridge request failed:', error);
        postToWeb({
          type: 'ERROR',
          requestId,
          error: message,
          payload: { context: errorContext },
        });
      }
    },
    [postToWeb]
  );

  const handleBridgeRequest = useCallback(
    (event: WebViewMessageEvent) => {
      const { data } = event.nativeEvent;

      withRequestGuard(async () => {
        let parsed: BridgeRequest;

        try {
          parsed = JSON.parse(data) as BridgeRequest;
        } catch (error) {
          throw new Error('Unable to parse bridge payload from web view');
        }

        const { type, payload, requestId } = parsed;

        switch (type) {
          case 'REQUEST_PUSH_TOKEN': {
            const currentToken = NotificationService.getExpoPushToken();
            const token =
              currentToken ?? (await NotificationService.registerForPushNotifications());

            postToWeb({
              type: 'PUSH_TOKEN',
              requestId,
              payload: { token },
            });
            return;
          }

          case 'SEND_PUSH_VIA_BACKEND': {
            const notificationData = toNotificationData(payload);
            await NotificationService.sendPushNotificationViaBackend(notificationData);
            postToWeb({
              type: 'SUCCESS',
              requestId,
              payload: { action: type },
            });
            return;
          }

          case 'SEND_LOCAL_NOTIFICATION': {
            const notificationData = toNotificationData(payload);
            await NotificationService.sendLocalNotification(notificationData);
            postToWeb({
              type: 'SUCCESS',
              requestId,
              payload: { action: type },
            });
            return;
          }

          default: {
            throw new Error(`Unknown bridge request type: ${String(type)}`);
          }
        }
      }, parsedRequestId(event.nativeEvent.data), 'handleBridgeRequest');
    },
    [postToWeb, withRequestGuard]
  );

  useEffect(() => {
    const notificationSubscription = NotificationService.addNotificationReceivedListener(
      (notification) => {
        postToWeb({
          type: 'NOTIFICATION_RECEIVED',
          payload: serializeNotification(notification),
        });
      }
    );

    const responseSubscription = NotificationService.addNotificationResponseReceivedListener(
      (response) => {
        postToWeb({
          type: 'NOTIFICATION_RESPONSE',
          payload: serializeNotificationResponse(response),
        });
      }
    );

    return () => {
      NotificationService.removeNotificationSubscription(notificationSubscription);
      NotificationService.removeNotificationSubscription(responseSubscription);
    };
  }, [postToWeb]);

  useEffect(() => {
    if (!isWebReady) {
      return;
    }

    const existingToken = NotificationService.getExpoPushToken();
    if (existingToken) {
      postToWeb({
        type: 'PUSH_TOKEN',
        payload: { token: existingToken },
      });
    }
  }, [isWebReady, postToWeb]);

  const handleLoadEnd = () => {
    setIsLoading(false);
    setIsWebReady(true);
    setLoadError(null);
  };

  const handleLoadError = (error: unknown) => {
    setIsLoading(false);
    const message =
      typeof error === 'object' &&
      error !== null &&
      'nativeEvent' in error &&
      typeof (error as any).nativeEvent?.description === 'string'
        ? (error as any).nativeEvent.description
        : 'Failed to load embedded web app';
    setLoadError(message);
  };

  const reloadWebView = () => {
    setIsLoading(true);
    setLoadError(null);
    webViewRef.current?.reload();
  };

  return (
    <ThemedView style={styles.container}>
      {loadError ? (
        <View style={styles.fallbackContainer}>
          <ThemedText type="title" style={styles.fallbackTitle}>
            Unable to load web experience
          </ThemedText>
          <ThemedText style={styles.fallbackBody}>
            {loadError}
          </ThemedText>
          <ThemedText style={styles.fallbackBody}>
            Ensure the React web app is running at {webAppUrl}.
          </ThemedText>
          <ThemedText style={styles.fallbackBody}>
            Start it with `npm install` and `npm run dev` inside the `push-notif-web/` project.
          </ThemedText>
          <ThemedText style={styles.retry} onPress={reloadWebView}>
            Tap to retry
          </ThemedText>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: webAppUrl }}
          originWhitelist={["*"]}
          onLoadEnd={handleLoadEnd}
          onError={handleLoadError}
          onMessage={handleBridgeRequest}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
        />
      )}

      {isLoading && !loadError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" />
          <ThemedText style={styles.loadingText}>Loading web experience…</ThemedText>
        </View>
      )}
    </ThemedView>
  );
};

export default WebViewBridge;

const parsedRequestId = (raw: string): string | undefined => {
  try {
    const parsed = JSON.parse(raw) as { requestId?: string };
    return typeof parsed.requestId === 'string' ? parsed.requestId : undefined;
  } catch (error) {
    return undefined;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
  },
  fallbackContainer: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  fallbackTitle: {
    textAlign: 'center',
  },
  fallbackBody: {
    textAlign: 'center',
  },
  retry: {
    marginTop: 16,
    color: '#0a7ea4',
  },
});
