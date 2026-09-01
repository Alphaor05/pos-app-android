import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  DeviceEventEmitter,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { getPendingMessages, type CashierMessageRecord } from '@/lib/offlineDb';
import { listShops } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { MessageComposer } from '@/components/messages/MessageComposer';
import { SentMessageCard } from '@/components/messages/SentMessageCard';
import type { SentMessage } from '@/components/messages/types';

const C = Colors.dark;
const PAGE_SIZE = 50;

function draftToSentMessage(record: CashierMessageRecord): SentMessage {
  return {
    client_msg_id: record.id,
    message_text: String(record.data?.message_text ?? ''),
    category: String(record.data?.category ?? 'Other'),
    employee_name: record.data?.employee_name ?? null,
    created_at: record.created_at,
    status: (record.sync_attempts ?? 0) > 0 ? 'Retrying' : 'Queued',
  };
}

function rowToSentMessage(row: Record<string, unknown>): SentMessage {
  const status = row.status;
  return {
    client_msg_id: String(row.client_msg_id),
    message_text: String(row.message_text),
    category: String(row.category ?? 'Other'),
    employee_name: (row.employee_name as string | null) ?? null,
    created_at: String(row.created_at),
    status:
      status === 'Acknowledged' || status === 'Resolved' ? status : 'New',
  };
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { employee, shopId } = useAuth();

  const [shopNames, setShopNames] = useState<Record<string, string>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [localDrafts, setLocalDrafts] = useState<SentMessage[]>([]);
  const [serverMessages, setServerMessages] = useState<SentMessage[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shops = await listShops();
        if (!cancelled) {
          const map: Record<string, string> = {};
          for (const s of shops) map[s.id] = s.name;
          setShopNames(map);
        }
      } catch {
        // Shop names are cosmetic; the id-based UI still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLocalDrafts = useCallback(async (): Promise<SentMessage[]> => {
    try {
      const pending = await getPendingMessages();
      setPendingCount(pending.length);
      return pending.map(draftToSentMessage);
    } catch {
      return [];
    }
  }, []);

  /** One page of delivered messages, newest first. Empty (not error) when
   *  offline, on web, or before a shop is assigned — drafts still show. */
  const fetchServerPage = useCallback(
    async (offset: number): Promise<{ rows: SentMessage[]; hasMore: boolean }> => {
      if (!supabase || !shopId) return { rows: [], hasMore: false };
      try {
        const { data, error } = await supabase
          .from('cashier_messages')
          .select('client_msg_id, message_text, category, employee_name, created_at, status')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) return { rows: [], hasMore: false };
        const rows = ((data ?? []) as Record<string, unknown>[]).map(rowToSentMessage);
        return { rows, hasMore: rows.length === PAGE_SIZE };
      } catch {
        return { rows: [], hasMore: false };
      }
    },
    [shopId]
  );

  const refreshHistory = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) setIsRefreshing(true);
      try {
        const [drafts, page] = await Promise.all([loadLocalDrafts(), fetchServerPage(0)]);
        setLocalDrafts(drafts);
        setServerMessages(page.rows);
        setHasMore(page.hasMore);
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [loadLocalDrafts, fetchServerPage]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchServerPage(serverMessages.length);
      if (page.rows.length > 0) {
        setServerMessages((prev) => [...prev, ...page.rows]);
      }
      setHasMore(page.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, serverMessages.length, fetchServerPage]);

  useEffect(() => {
    refreshHistory();

    const subscriptions = [
      DeviceEventEmitter.addListener('message_sync_success', () =>
        refreshHistory({ silent: true })
      ),
      DeviceEventEmitter.addListener('message_sync_failure', () =>
        refreshHistory({ silent: true })
      ),
    ];
    return () => subscriptions.forEach((sub) => sub.remove());
  }, [refreshHistory]);

  /** Delivered rows win over local drafts with the same client_msg_id. */
  const messages = useMemo(() => {
    if (localDrafts.length === 0) return serverMessages;
    const delivered = new Set(serverMessages.map((m) => m.client_msg_id));
    const outstanding = localDrafts.filter((m) => !delivered.has(m.client_msg_id));
    return [...outstanding, ...serverMessages].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }, [localDrafts, serverMessages]);

  const senderNamePrefill = [employee?.first_name, employee?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  const shopLabel = shopId ? shopNames[shopId] || `${shopId.slice(0, 8)}…` : null;

  const handleAfterSend = useCallback(() => {
    refreshHistory({ silent: true });
  }, [refreshHistory]);

  const renderMessage = useCallback(
    ({ item }: { item: SentMessage }) => <SentMessageCard message={item} />,
    []
  );

  const listHeader = (
    <View>
      <View style={[styles.shopBanner, !shopLabel && styles.shopBannerWarn]}>
        <Ionicons
          name={shopLabel ? 'storefront-outline' : 'warning-outline'}
          size={16}
          color={shopLabel ? C.success : C.warning}
        />
        <Text style={[styles.shopBannerText, !shopLabel && styles.shopBannerTextWarn]}>
          {shopLabel
            ? `Sending as shop: ${shopLabel}`
            : 'No shop assigned — set one in Settings. Messages will stay queued until then.'}
        </Text>
      </View>

      <View style={styles.composerCard}>
        <MessageComposer
          shopId={shopId}
          employeeId={employee?.employee_id ?? null}
          defaultSenderName={senderNamePrefill}
          onAfterSend={handleAfterSend}
        />
      </View>

      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>History</Text>
        {messages.length > 0 && (
          <Text style={styles.historyCount}>
            {messages.length}
            {hasMore ? '+' : ''}
          </Text>
        )}
        <Pressable
          onPress={() => refreshHistory()}
          hitSlop={8}
          disabled={isRefreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh history"
          style={styles.refreshBtn}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={C.textMuted} />
          ) : (
            <Ionicons name="refresh" size={16} color={C.textMuted} />
          )}
        </Pressable>
      </View>
    </View>
  );

  const listFooter = (
    <View style={styles.footer}>
      {isLoadingMore && <ActivityIndicator color={C.textMuted} />}
      {!isLoadingMore && !hasMore && messages.length > 0 && (
        <Text style={styles.footerText}>You're all caught up</Text>
      )}
      <Text style={styles.footerNote}>
        Messages work offline. Anything queued is kept safely on this device until it can be sent.
      </Text>
    </View>
  );

  const emptyState = isRefreshing ? null : (
    <View style={styles.emptyState}>
      <Ionicons name="chatbubbles-outline" size={36} color={C.textMuted} />
      <Text style={styles.emptyTitle}>No messages yet</Text>
      <Text style={styles.emptySubtitle}>
        Use the form above to report stock issues or send requests to management.
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Messages</Text>
        {pendingCount > 0 && (
          <View style={styles.headerActions}>
            <View style={styles.pendingChip}>
              <Text style={styles.pendingChipText}>{pendingCount} queued</Text>
            </View>
          </View>
        )}
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.client_msg_id}
        renderItem={renderMessage}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState}
        ListFooterComponent={listFooter}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        refreshControl={
          Platform.OS !== 'web' ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => refreshHistory()}
              tintColor={C.textMuted}
            />
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
  },
  headerActions: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  pendingChip: {
    backgroundColor: C.warningDim,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pendingChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: C.warning,
  },
  listContent: {
    padding: 16,
  },
  shopBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: C.successDim,
    borderWidth: 1,
    borderColor: C.success + '40',
  },
  shopBannerWarn: {
    backgroundColor: C.warningDim,
    borderColor: C.warning + '40',
  },
  shopBannerText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.success,
  },
  shopBannerTextWarn: {
    color: C.warning,
  },
  composerCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 16,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    marginBottom: 12,
  },
  historyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: C.textSecondary,
  },
  historyCount: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: C.textMuted,
    backgroundColor: C.card,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  refreshBtn: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 24,
    gap: 6,
  },
  footerText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textSecondary,
  },
  footerNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.textMuted,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
  },
  emptySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: C.textMuted,
    textAlign: 'center',
    maxWidth: 280,
  },
});
