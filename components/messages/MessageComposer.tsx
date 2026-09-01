import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { MESSAGE_CATEGORIES, queueMessage } from '@/lib/offlineDb';
import { syncMessagesQueue } from '@/lib/sync';
import { supabase } from '@/lib/supabase';

const C = Colors.dark;
const MAX_LENGTH = 2000;

type Category = (typeof MESSAGE_CATEGORIES)[number];

interface MessageComposerProps {
  shopId: string | null;
  employeeId: string | null;
  defaultSenderName: string;
  /** Called after the message is queued (and best-effort sent) so the
   *  parent can refresh the history list and counters. */
  onAfterSend: () => void;
}

/**
 * Draft state lives here on purpose: keystrokes re-render only the composer,
 * never the history list behind it.
 */
export const MessageComposer = React.memo(function MessageComposer({
  shopId,
  employeeId,
  defaultSenderName,
  onAfterSend,
}: MessageComposerProps) {
  const [category, setCategory] = useState<Category>('Other');
  const [message, setMessage] = useState('');
  const [senderName, setSenderName] = useState(defaultSenderName);
  const [sending, setSending] = useState(false);
  const [lastStatus, setLastStatus] = useState<'queued' | 'sent' | 'failed' | null>(null);

  useEffect(() => {
    setSenderName(defaultSenderName);
  }, [defaultSenderName]);

  const canSend = message.trim().length > 0 && !sending;

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSending(true);
    try {
      // Contract: employee_id is the session UUID or null — never a
      // placeholder string (cashier_messages.employee_id is a uuid column).
      const clientMsgId = await queueMessage({
        shop_id: shopId ?? null,
        message_text: trimmed,
        category,
        employee_id: employeeId ?? null,
        employee_name: senderName.trim() || null,
        created_at: new Date().toISOString(),
      });

      if (Platform.OS === 'web') {
        await sendDirectFromWeb(clientMsgId, {
          shopId,
          messageText: trimmed,
          category,
          employeeId: employeeId ?? null,
          employeeName: senderName.trim() || null,
        });
      } else {
        syncMessagesQueue();
        setLastStatus('queued');
      }

      setMessage('');
      onAfterSend();
    } catch (e) {
      setLastStatus('failed');
      Alert.alert('Could not queue message', String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>Category</Text>
      <View style={styles.chipRow}>
        {MESSAGE_CATEGORIES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            style={[styles.chip, category === c && styles.chipSelected]}
          >
            <Text style={[styles.chipText, category === c && styles.chipTextSelected]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Message</Text>
      <TextInput
        style={styles.messageInput}
        placeholder="Describe the issue or request…"
        placeholderTextColor={C.textMuted}
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={5}
        maxLength={MAX_LENGTH}
        textAlignVertical="top"
      />
      <Text style={styles.counter}>
        {message.length}/{MAX_LENGTH}
      </Text>

      <Text style={styles.label}>Your name (optional)</Text>
      <TextInput
        style={styles.nameInput}
        placeholder="Shown to the admin so they can follow up"
        placeholderTextColor={C.textMuted}
        value={senderName}
        onChangeText={setSenderName}
        maxLength={200}
      />

      <Pressable
        onPress={handleSubmit}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        style={({ pressed }) => [
          styles.sendBtn,
          !canSend && styles.sendBtnDisabled,
          pressed && canSend && { opacity: 0.85 },
        ]}
      >
        {sending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="paper-plane-outline" size={18} color="#fff" />
            <Text style={styles.sendBtnText}>Send</Text>
          </>
        )}
      </Pressable>

      <SendStatusBox status={lastStatus} />
    </View>
  );
});

interface SendDirectArgs {
  shopId: string | null;
  messageText: string;
  category: string;
  employeeId: string | null;
  employeeName: string | null;
}

async function sendDirectFromWeb(clientMsgId: string, args: SendDirectArgs): Promise<void> {
  if (!supabase) {
    Alert.alert('Offline', 'Messaging requires a connection. Please send from the tablet app.');
    return;
  }
  const { error } = await supabase.from('cashier_messages').insert({
    client_msg_id: clientMsgId,
    shop_id: args.shopId,
    message_text: args.messageText,
    category: args.category,
    employee_id: args.employeeId,
    employee_name: args.employeeName,
    created_at: new Date().toISOString(),
  });
  if (error) {
    Alert.alert('Not sent', 'Could not reach the server. Please try again.');
    return;
  }
}

function SendStatusBox({ status }: { status: 'queued' | 'sent' | 'failed' | null }) {
  if (status === 'queued') {
    return (
      <View style={[styles.statusBox, { backgroundColor: C.accentDim }]}>
        <Ionicons name="cloud-upload-outline" size={16} color={C.accentLight} />
        <Text style={[styles.statusText, { color: C.accentLight }]}>
          Queued — it sends automatically once a connection is available.
        </Text>
      </View>
    );
  }
  if (status === 'sent') {
    return (
      <View style={[styles.statusBox, { backgroundColor: C.successDim }]}>
        <Ionicons name="checkmark-circle-outline" size={16} color={C.success} />
        <Text style={[styles.statusText, { color: C.success }]}>
          Delivered. The admin will see it in their dashboard.
        </Text>
      </View>
    );
  }
  if (status === 'failed') {
    return (
      <View style={[styles.statusBox, { backgroundColor: C.warningDim }]}>
        <Ionicons name="alert-circle-outline" size={16} color={C.warning} />
        <Text style={[styles.statusText, { color: C.warning }]}>
          Not delivered yet. It stays queued and retries automatically.
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: C.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: C.accentDim,
    borderColor: C.accent,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  chipTextSelected: {
    color: C.accentLight,
  },
  messageInput: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    padding: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    paddingTop: 14,
  },
  counter: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  nameInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    color: C.text,
    padding: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#fff',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  statusText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});
