import Colors from '@/constants/colors';

const C = Colors.dark;

export type SentStatus = 'New' | 'Acknowledged' | 'Resolved' | 'Queued' | 'Retrying';

/** A message row as displayed in the history list — either a local queue
 *  draft or an already-delivered server record, normalised to one shape. */
export interface SentMessage {
  client_msg_id: string;
  message_text: string;
  category: string;
  employee_name: string | null;
  created_at: string;
  status: SentStatus;
}

export const SENT_STATUS_STYLE: Record<SentStatus, { bg: string; fg: string }> = {
  Queued: { bg: C.card, fg: C.textSecondary },
  Retrying: { bg: C.warningDim, fg: C.warning },
  New: { bg: C.accentDim, fg: C.accentLight },
  Acknowledged: { bg: C.warningDim, fg: C.warning },
  Resolved: { bg: C.successDim, fg: C.success },
};

export function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!isFinite(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
