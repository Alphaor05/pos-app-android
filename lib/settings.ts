import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// persisted key for the terminal/pos identifier that this device represents
const POS_ID_KEY = 'pos_id';

/**
 * Persist the currently selected terminal/pos id.  `null` clears the value.
 */
export async function setPosId(id: string | null): Promise<void> {
  if (id === null) {
    await AsyncStorage.removeItem(POS_ID_KEY);
  } else {
    await AsyncStorage.setItem(POS_ID_KEY, id);
  }
}

/**
 * Return the stored pos id (or null if none has been chosen yet).
 */
export async function getPosId(): Promise<string | null> {
  return AsyncStorage.getItem(POS_ID_KEY);
}

// legacy helpers that mirror the old "shop" naming; kept for backward
// compatibility with code that already imported them.
export { setPosId as setShopId, getPosId as getShopId };

/**
 * Fetch a list of shops/terminals from Supabase so the user can pick one.
 * Assumes a `shops` or `pos_terminals` table with at minimum `id`/`name`.
 */
export async function listShops(): Promise<Array<{id: string; name: string}>> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shops')
    .select('id,name')
    .limit(50);
  if (error) {
    console.warn('Failed to load shop list', error);
    return [];
  }
  return (data as any[]) || [];
}
