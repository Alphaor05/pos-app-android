import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';
import { SENT_STATUS_STYLE, formatRelativeTime, type SentMessage } from './types';

const C = Colors.dark;

interface SentMessageCardProps {
  message: SentMessage;
}

export const SentMessageCard = React.memo(function SentMessageCard({
  message,
}: SentMessageCardProps) {
  const tone = SENT_STATUS_STYLE[message.status];
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.category}>{message.category}</Text>
        <Text style={styles.time}>{formatRelativeTime(message.created_at)}</Text>
      </View>
      <Text style={styles.body}>{message.message_text}</Text>
      <View style={styles.bottomRow}>
        {!!message.employee_name && (
          <Text numberOfLines={1} style={styles.sender}>
            {message.employee_name}
          </Text>
        )}
        <View style={[styles.pill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.pillText, { color: tone.fg }]}>{message.status}</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 14,
    marginBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  category: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: C.accentLight,
    flexShrink: 1,
  },
  time: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.textMuted,
    marginLeft: 8,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: C.text,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  sender: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textSecondary,
    flexShrink: 1,
    marginRight: 8,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
});
