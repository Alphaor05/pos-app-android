import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cashier_message_notifications';
const MAX_NOTIFICATIONS = 50;

export type MessageNotificationStatus = 'Acknowledged' | 'Resolved';

export interface MessageNotification {
  /** Dedupe key: `${client_msg_id}:${status}` */
  id: string;
  messageId: string;
  category: string;
  preview: string;
  status: MessageNotificationStatus;
  employeeName: string | null;
  createdAt: string;
  read: boolean;
}

type Listener = (items: MessageNotification[]) => void;

let cache: MessageNotification[] | null = null;
const listeners = new Set<Listener>();

function notify() {
  const snapshot = cache ?? [];
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // A broken listener must not break the others.
    }
  }
}

async function ensureLoaded(): Promise<MessageNotification[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as MessageNotification[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache ?? []));
  } catch {
    // Storage full/unavailable: notifications stay in memory for this session.
  }
}

/**
 * Records an admin status change as a notification. Deduplicated per
 * message+status, newest first, capped at MAX_NOTIFICATIONS.
 * Returns true when a new notification was added.
 */
export async function recordMessageStatusChange(input: {
  messageId: string;
  category: string;
  preview: string;
  status: MessageNotificationStatus;
  employeeName: string | null;
}): Promise<boolean> {
  const items = await ensureLoaded();
  const id = `${input.messageId}:${input.status}`;
  if (items.some((n) => n.id === id)) return false;

  cache = [
    {
      id,
      messageId: input.messageId,
      category: input.category,
      preview: input.preview,
      status: input.status,
      employeeName: input.employeeName,
      createdAt: new Date().toISOString(),
      read: false,
    },
    ...items,
  ].slice(0, MAX_NOTIFICATIONS);

  notify();
  await persist();
  return true;
}

export async function getMessageNotifications(): Promise<MessageNotification[]> {
  return ensureLoaded();
}

export function subscribeMessageNotifications(listener: Listener): () => void {
  listeners.add(listener);
  // Deliver the current list asynchronously so callers can sync-subscribe
  // inside effects without racing the storage read.
  ensureLoaded().then((items) => {
    try {
      listener(items);
    } catch {
      // Ignore listener failures on initial delivery.
    }
  });
  return () => {
    listeners.delete(listener);
  };
}

export async function markMessageNotificationRead(id: string): Promise<void> {
  const items = await ensureLoaded();
  let changed = false;
  cache = items.map((n) => {
    if (n.id === id && !n.read) {
      changed = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (changed) {
    notify();
    await persist();
  }
}

export async function markAllMessageNotificationsRead(): Promise<void> {
  const items = await ensureLoaded();
  if (items.some((n) => !n.read)) {
    cache = items.map((n) => (n.read ? n : { ...n, read: true }));
    notify();
    await persist();
  }
}
