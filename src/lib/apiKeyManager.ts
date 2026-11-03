import { AIProvider, CustomProviderConfig } from '../types';
import { AI_PROVIDERS_CONFIG } from './providersConfig';

export interface StoredApiKey {
  id: string;
  label: string;
  key: string;
  status: 'valid' | 'invalid' | 'untested' | 'busy';
  lastError?: string;
  isPrimary?: boolean;
}

const LOCAL_STORAGE_AI_PROVIDER = 'subgame_ai_provider';
const LEGACY_GEMINI_KEYS_LIST = 'gemini_api_keys_v2';
const LEGACY_GEMINI_SINGLE_KEY = 'gemini_api_key';
const LEGACY_GEMINI_USER_KEY = 'gemini_user_api_key';
const LEGACY_CUSTOM_CONFIG = 'subgame_custom_provider_config';

const VALID_PROVIDERS: AIProvider[] = [
  'gemini',
  'openai',
  'deepseek',
  'groq',
  'claude',
  'openrouter',
  'mistral',
  'ollama',
  'custom',
];

/**
 * Gets the currently active AI Provider.
 */
export function getActiveAiProvider(): AIProvider {
  try {
    const val = localStorage.getItem(LOCAL_STORAGE_AI_PROVIDER) as AIProvider;
    if (val && VALID_PROVIDERS.includes(val)) {
      return val;
    }
  } catch (err) {
    console.error('Failed to parse AI provider from localStorage:', err);
  }
  return 'gemini';
}

/**
 * Sets the active AI Provider.
 */
export function setActiveAiProvider(provider: AIProvider): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_AI_PROVIDER, provider);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('subgame_provider_updated', { detail: { provider } }));
    }
  } catch (err) {
    console.error('Failed to save AI provider to localStorage:', err);
  }
}

/**
 * Gets the list of stored API keys for a specific AI Provider.
 */
export function getProviderKeys(provider: AIProvider): StoredApiKey[] {
  try {
    const storageKey = `subgame_keys_${provider}`;
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }

    // Fallback for Gemini legacy storage
    if (provider === 'gemini') {
      const legacyRaw = localStorage.getItem(LEGACY_GEMINI_KEYS_LIST);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(legacyParsed));
          } catch {}
          return legacyParsed;
        }
      }
      const singleKey = localStorage.getItem(LEGACY_GEMINI_SINGLE_KEY) || localStorage.getItem(LEGACY_GEMINI_USER_KEY);
      if (singleKey && singleKey.trim()) {
        const initialList: StoredApiKey[] = [
          {
            id: 'gemini_key_1',
            label: 'Primary Key',
            key: singleKey.trim(),
            status: 'untested',
            isPrimary: true,
          },
        ];
        try {
          localStorage.setItem(storageKey, JSON.stringify(initialList));
        } catch {}
        return initialList;
      }
    }

    // Fallback for legacy custom config
    if (provider === 'custom') {
      const legacyCfg = localStorage.getItem(LEGACY_CUSTOM_CONFIG);
      if (legacyCfg) {
        try {
          const parsedCfg = JSON.parse(legacyCfg);
          if (parsedCfg?.apiKey && typeof parsedCfg.apiKey === 'string' && parsedCfg.apiKey.trim()) {
            const initialList: StoredApiKey[] = [
              {
                id: 'custom_key_1',
                label: 'Primary Key',
                key: parsedCfg.apiKey.trim(),
                status: 'untested',
                isPrimary: true,
              },
            ];
            try {
              localStorage.setItem(storageKey, JSON.stringify(initialList));
            } catch {}
            return initialList;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error(`Failed to parse stored API keys for provider "${provider}":`, err);
  }

  return [];
}

/**
 * Saves the list of stored API keys for a specific AI Provider.
 */
export function saveProviderKeys(provider: AIProvider, keys: StoredApiKey[]): void {
  try {
    const storageKey = `subgame_keys_${provider}`;
    localStorage.setItem(storageKey, JSON.stringify(keys));

    // Keep primary in sync
    const primary = keys.find((k) => k.isPrimary) || keys[0];

    if (provider === 'gemini') {
      localStorage.setItem(LEGACY_GEMINI_KEYS_LIST, JSON.stringify(keys));
      if (primary && primary.key) {
        localStorage.setItem(LEGACY_GEMINI_SINGLE_KEY, primary.key);
        localStorage.setItem(LEGACY_GEMINI_USER_KEY, primary.key);
      } else {
        localStorage.removeItem(LEGACY_GEMINI_SINGLE_KEY);
        localStorage.removeItem(LEGACY_GEMINI_USER_KEY);
      }
    } else {
      // Sync into provider config
      const existingCfg = getProviderConfig(provider);
      saveProviderConfig(provider, {
        ...existingCfg,
        apiKey: primary?.key || '',
        apiKeys: keys.map((k) => k.key.trim()).filter(Boolean),
      });
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('subgame_provider_updated', { detail: { provider } }));
    }
  } catch (err) {
    console.error(`Failed to save API keys for provider "${provider}":`, err);
  }
}

/**
 * Gets the active primary key for a specific AI Provider.
 */
export function getActiveProviderKey(provider: AIProvider): StoredApiKey | undefined {
  const keys = getProviderKeys(provider);
  if (keys.length === 0) return undefined;
  return keys.find((k) => k.isPrimary) || keys[0];
}

/**
 * Rotates to the next available API key for a specific AI Provider.
 */
export function rotateProviderKey(provider: AIProvider): {
  rotated: boolean;
  activeKey?: StoredApiKey;
  newIndex: number;
} {
  const keys = getProviderKeys(provider);
  if (keys.length <= 1) {
    return { rotated: false, activeKey: keys[0], newIndex: 0 };
  }

  const currentIndex = Math.max(0, keys.findIndex((k) => k.isPrimary));
  const nextIndex = (currentIndex + 1) % keys.length;

  const updated = keys.map((k, idx) => ({
    ...k,
    isPrimary: idx === nextIndex,
  }));

  saveProviderKeys(provider, updated);
  return { rotated: true, activeKey: updated[nextIndex], newIndex: nextIndex };
}

/**
 * Marks a specific key as quota exhausted for a provider.
 */
export function markProviderKeyQuotaExhausted(provider: AIProvider, keyId: string): void {
  const keys = getProviderKeys(provider);
  const updated = keys.map((k) =>
    k.id === keyId
      ? {
          ...k,
          status: 'invalid' as const,
          lastError: 'سقف سهمیه کلید به پایان رسیده است (Quota / Rate Limit 429)',
        }
      : k
  );
  saveProviderKeys(provider, updated);
}

/**
 * Gets an array of string keys for a specific provider.
 */
export function getProviderApiKeysArray(provider: AIProvider): string[] {
  const keys = getProviderKeys(provider);
  if (keys.length === 0) return [];
  // Ensure the primary active key is ALWAYS placed first at index 0 for immediate rotation
  const primary = keys.find((k) => k.isPrimary);
  const others = keys.filter((k) => !k.isPrimary);
  const sorted = primary ? [primary, ...others] : keys;
  return sorted.map((k) => k.key.trim()).filter(Boolean);
}

/**
 * Gets provider configuration (Base URL, default model, primary key, etc.).
 */
export function getProviderConfig(provider: AIProvider): CustomProviderConfig {
  const def = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.custom;
  try {
    const storageKey = `subgame_config_${provider}`;
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          provider,
          name: typeof parsed.name === 'string' && parsed.name ? parsed.name : def.name,
          baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : def.defaultBaseUrl,
          apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
          model: typeof parsed.model === 'string' && parsed.model ? parsed.model : def.defaultModel,
          apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
        };
      }
    }

    // Fallback for custom legacy config
    if (provider === 'custom') {
      const legacyRaw = localStorage.getItem(LEGACY_CUSTOM_CONFIG);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && typeof parsed === 'object') {
          return {
            provider: 'custom',
            name: parsed.name || 'Custom Provider',
            baseUrl: parsed.baseUrl || '',
            apiKey: parsed.apiKey || '',
            model: parsed.model || '',
            apiKeys: parsed.apiKey ? [parsed.apiKey] : [],
          };
        }
      }
    }
  } catch (err) {
    console.error(`Failed to parse config for provider "${provider}":`, err);
  }

  // Return clean defaults
  const activeKey = getActiveProviderKey(provider);
  const allKeys = getProviderApiKeysArray(provider);
  return {
    provider,
    name: def.name,
    baseUrl: def.defaultBaseUrl,
    apiKey: activeKey?.key || '',
    model: def.defaultModel,
    apiKeys: allKeys,
  };
}

/**
 * Saves provider configuration.
 */
export function saveProviderConfig(provider: AIProvider, config: Partial<CustomProviderConfig>): void {
  try {
    const current = getProviderConfig(provider);
    const updated: CustomProviderConfig = {
      ...current,
      ...config,
      provider,
    };
    const storageKey = `subgame_config_${provider}`;
    localStorage.setItem(storageKey, JSON.stringify(updated));

    if (provider === 'custom') {
      localStorage.setItem(LEGACY_CUSTOM_CONFIG, JSON.stringify(updated));
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('subgame_provider_config_updated', { detail: { provider, config: updated } }));
    }
  } catch (err) {
    console.error(`Failed to save config for provider "${provider}":`, err);
  }
}

// --------------------------------------------------------------------------
// Backward-Compatibility Aliases
// --------------------------------------------------------------------------

export function getStoredApiKeys(): StoredApiKey[] {
  const activeProvider = getActiveAiProvider();
  return getProviderKeys(activeProvider);
}

export function saveStoredApiKeys(keys: StoredApiKey[]): void {
  const activeProvider = getActiveAiProvider();
  saveProviderKeys(activeProvider, keys);
}

export function getStoredCustomProvider(): CustomProviderConfig {
  const activeProvider = getActiveAiProvider();
  return getProviderConfig(activeProvider === 'gemini' ? 'custom' : activeProvider);
}

export function saveStoredCustomProvider(config: CustomProviderConfig): void {
  const activeProvider = getActiveAiProvider();
  saveProviderConfig(activeProvider === 'gemini' ? 'custom' : activeProvider, config);
}

export function getActiveApiKeysArray(): string[] {
  const activeProvider = getActiveAiProvider();
  return getProviderApiKeysArray(activeProvider);
}

export function getApiKeyArrayForHeader(): string[] {
  return getActiveApiKeysArray();
}

export function rotateToNextApiKey(): { rotated: boolean; activeKey?: StoredApiKey; newIndex: number } {
  const activeProvider = getActiveAiProvider();
  return rotateProviderKey(activeProvider);
}

export function markKeyQuotaExhausted(keyId: string): void {
  const activeProvider = getActiveAiProvider();
  markProviderKeyQuotaExhausted(activeProvider, keyId);
}
