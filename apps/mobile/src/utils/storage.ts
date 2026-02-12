// ============================================================
// Cross-platform secure storage adapter
// Uses expo-secure-store on native, localStorage on web
// ============================================================

import { Platform } from 'react-native';

interface StorageAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let storage: StorageAdapter;

if (Platform.OS === 'web') {
  // Web: use localStorage
  storage = {
    getItemAsync: async (key: string) => {
      try {
        const value = localStorage.getItem(key);
        console.log('[Storage] getItemAsync web:', key, value ? 'found' : 'null');
        return value;
      } catch (error) {
        console.error('[Storage] getItemAsync web error:', error);
        return null;
      }
    },
    setItemAsync: async (key: string, value: string) => {
      try {
        localStorage.setItem(key, value);
        console.log('[Storage] setItemAsync web:', key, 'saved');
      } catch (error) {
        console.error('[Storage] setItemAsync web error:', error);
      }
    },
    deleteItemAsync: async (key: string) => {
      try {
        localStorage.removeItem(key);
        console.log('[Storage] deleteItemAsync web:', key, 'removed');
      } catch (error) {
        console.error('[Storage] deleteItemAsync web error:', error);
      }
    },
  };
} else {
  // Native: use expo-secure-store
  const SecureStore = require('expo-secure-store');
  storage = {
    getItemAsync: (key: string) => SecureStore.getItemAsync(key),
    setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

export default storage;
