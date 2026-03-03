import AsyncStorage from '@react-native-async-storage/async-storage';

const SHOP_ID_KEY = 'shop_id';

export async function setShopId(id: string | null): Promise<void> {
  if (id === null) {
    await AsyncStorage.removeItem(SHOP_ID_KEY);
  } else {
    await AsyncStorage.setItem(SHOP_ID_KEY, id);
  }
}

export async function getShopId(): Promise<string | null> {
  return AsyncStorage.getItem(SHOP_ID_KEY);
}
