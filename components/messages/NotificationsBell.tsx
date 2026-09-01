import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  FlatList,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import {
  getMessageNotifications,
  markAllMessageNotificationsRead,
  markMessageNotificationRead,
  recordMessageStatusChange,
  subscribeMessageNotifications,
  type MessageNotification,
} from '@/lib/messageNotifications';

const C = Colors.dark;
const RECENT_WINDOW = 20;

interface NotificationsBellProps {
  shopId: string | null;
  iconSize?: number;
}

function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!isFinite(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Live feed of admin responses to this shop's cashier messages.
 *
 * Primary transport is a Supabase Realtime subscription (UPDATE events).
 * A reconciliation pass on foreground/mount catches anything missed while
 * the socket was down, so notifications are eventual regardless of
 * connectivity. All failures are silent — the bell is never critical path.
 */
export function useCashierMessageNotifications(shopId: string | null) {
  const [notifications, setNotifications] = useState<MessageNotification[]>([]);

  useEffect(() => {
    return subscribeMessageNotifications(setNotifications);
  }, []);

  const handleUpdate = useCallback(async (row: Record<string, unknown>) => {
    const status = row.status;
    if (status !== 'Acknowledged' && status !== 'Resolved') return;
    try {
      await recordMessageStatusChange({
        messageId: String(row.id),
        category: String(row.category ?? 'Other'),
        preview: String(row.message_text ?? ''),
        status,
        employeeName: (row.employee_name as string | null) ?? null,
      });
    } catch {
      // Non-critical; next reconcile will pick it up.
    }
  }, []);

  /** Fetch recent rows and let the store dedupe into notifications. */
  const reconcile = useCallback(async () => {
    if (!supabase || !shopId) return;
    try {
      const { data, error } = await supabase
        .from('cashier_messages')
        .select('id, message_text, category, employee_name, status')
        .eq('shop_id', shopId)
        .in('status', ['Acknowledged', 'Resolved'])
        .order('created_at', { ascending: false })
        .limit(RECENT_WINDOW);
      if (error || !data) return;
      for (const row of data as Record<string, unknown>[]) {
        await handleUpdate(row);
      }
    } catch {
      // Offline: rely on realtime/next reconcile.
    }
  }, [shopId, handleUpdate]);

  useEffect(() => {
    if (!supabase || !shopId) return;
    const client = supabase;

    reconcile();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });

    let channel: ReturnType<typeof client.channel> | null = null;
    try {
      channel = client
        .channel(`cashier_messages_tablet_${shopId.slice(0, 8)}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'cashier_messages',
            filter: `shop_id=eq.${shopId}`,
          },
          (payload) => {
            handleUpdate(payload.new as Record<string, unknown>);
          }
        )
        .subscribe();
    } catch {
      // Realtime unavailable (e.g. websocket blocked): reconciliation covers it.
    }

    return () => {
      appStateSub.remove();
      if (channel) client.removeChannel(channel);
    };
  }, [shopId, reconcile, handleUpdate]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  return { notifications, unreadCount };
}

export function MessageNotificationsBell({ shopId, iconSize = 20 }: NotificationsBellProps) {
  const { notifications, unreadCount } = useCashierMessageNotifications(shopId);
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.7 }]}
        onPress={() => setPanelOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <Ionicons name="notifications-outline" size={iconSize} color={C.textSecondary} />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </Pressable>

      <Modal
        visible={panelOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPanelOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setPanelOpen(false)}>
          <Pressable style={styles.panel} onPress={() => {}}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Notifications</Text>
              {notifications.some((n) => !n.read) && (
                <Pressable onPress={() => markAllMessageNotificationsRead()} hitSlop={6}>
                  <Text style={styles.markAllText}>Mark all read</Text>
                </Pressable>
              )}
            </View>

            {notifications.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="notifications-off-outline" size={32} color={C.textMuted} />
                <Text style={styles.emptyTitle}>Nothing yet</Text>
                <Text style={styles.emptySubtitle}>
                  You'll see a note here when an admin acknowledges or resolves one of your messages.
                </Text>
              </View>
            ) : (
              <FlatList
                data={notifications}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <NotificationRow notification={item} onOpen={() => {
                    markMessageNotificationRead(item.id);
                  }} />
                )}
                style={styles.list}
              />
            )}

            <Pressable style={styles.closeBtn} onPress={() => setPanelOpen(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const NotificationRow = React.memo(function NotificationRow({
  notification,
  onOpen,
}: {
  notification: MessageNotification;
  onOpen: () => void;
}) {
  const resolved = notification.status === 'Resolved';
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: resolved ? C.successDim : C.warningDim },
        ]}
      >
        <Ionicons
          name={resolved ? 'checkmark-done-outline' : 'hand-left-outline'}
          size={18}
          color={resolved ? C.success : C.warning}
        />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            Admin {notification.status.toLowerCase()} your {notification.category.toLowerCase()}
          </Text>
          {!notification.read && <View style={[styles.unreadDot, resolved && { backgroundColor: C.success }]} />}
        </View>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {notification.preview}
        </Text>
        <Text style={styles.rowTime}>{formatRelativeTime(notification.createdAt)}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    color: '#fff',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    borderRadius: 16,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.border,
    paddingTop: 16,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  panelTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.text,
  },
  markAllText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.accentLight,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 3,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    flexShrink: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.warning,
  },
  rowPreview: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: C.textSecondary,
  },
  rowTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.textMuted,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: C.text,
  },
  emptySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: C.textMuted,
    textAlign: 'center',
  },
  closeBtn: {
    marginTop: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: C.card,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: C.textSecondary,
  },
});
