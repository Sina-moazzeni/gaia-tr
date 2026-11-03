import React, { useState, useEffect, useRef } from 'react';
import { UILanguage, TRANSLATIONS } from '../lib/i18n';
import { 
  StoredApiKey, 
  getProviderKeys, 
  saveProviderKeys,
  getActiveAiProvider,
  setActiveAiProvider,
  getProviderConfig,
  saveProviderConfig
} from '../lib/apiKeyManager';
import { AIProvider, CustomProviderConfig } from '../types';
import { 
  ALL_PROVIDERS_LIST, 
  AI_PROVIDERS_CONFIG, 
  isOpenAiCompatibleProvider,
  ProviderModelOption
} from '../lib/providersConfig';
import { 
  Key, 
  X, 
  Check, 
  Trash2, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  ExternalLink, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Plus,
  Layers,
  Star,
  RefreshCw,
  Server,
  Sparkles,
  Bot,
  Zap,
  Brain,
  Flame,
  Globe,
  Cpu,
  Terminal,
  Edit3,
  CheckCircle
} from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  uiLang: UILanguage;
  userApiKey?: string;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
  activeProvider?: AIProvider;
  onProviderChange?: (provider: AIProvider) => void;
  customConfig?: CustomProviderConfig;
  onSaveCustomConfig?: (config: CustomProviderConfig) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  uiLang,
  userApiKey = '',
  onSaveKey,
  onClearKey,
  activeProvider: externalProvider,
  onProviderChange,
  customConfig: externalCustomConfig,
  onSaveCustomConfig,
}) => {
  // Global Active AI Provider & Tab
  const [selectedProviderTab, setSelectedProviderTab] = useState<AIProvider>('gemini');
  const [activeSystemProvider, setActiveSystemProvider] = useState<AIProvider>('gemini');

  // Keys list for the currently viewed provider tab
  const [currentTabKeys, setCurrentTabKeys] = useState<StoredApiKey[]>([]);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Testing states
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [keyTestLatencies, setKeyTestLatencies] = useState<Record<string, number>>({});

  // Provider configuration fields (Base URL & Selected Model)
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [isCustomModelInputVisible, setIsCustomModelInputVisible] = useState(false);

  const [lastSelectedModelName, setLastSelectedModelName] = useState<string>('');
  const testAbortControllerRef = useRef<AbortController | null>(null);
  const t = TRANSLATIONS[uiLang];

  // Helper to load keys and config for a specific provider
  const loadProviderData = (provider: AIProvider) => {
    const keys = getProviderKeys(provider);
    setCurrentTabKeys(keys);

    const cfg = getProviderConfig(provider);
    setProviderBaseUrl(cfg.baseUrl || '');
    setProviderModel(cfg.model || AI_PROVIDERS_CONFIG[provider]?.defaultModel || '');
  };

  // Sync on modal open: prioritize last viewed tab or active engine
  useEffect(() => {
    if (isOpen) {
      const currentActive = externalProvider || getActiveAiProvider();
      setActiveSystemProvider(currentActive);

      let initialTab = currentActive;
      try {
        const savedTab = localStorage.getItem('subgame_last_viewed_tab') as AIProvider;
        if (savedTab && ALL_PROVIDERS_LIST.some((p) => p.id === savedTab)) {
          initialTab = savedTab;
        }
      } catch {}

      setSelectedProviderTab(initialTab);
      loadProviderData(initialTab);
    } else {
      if (testAbortControllerRef.current) {
        testAbortControllerRef.current.abort();
        testAbortControllerRef.current = null;
      }
    }
  }, [isOpen, externalProvider]);

  // Auto-save any pending text in newKeyInput so user typing never disappears
  const savePendingKeyInputIfPresent = (targetProvider: AIProvider = selectedProviderTab): boolean => {
    const cleanKey = newKeyInput.trim();
    if (!cleanKey) return false;

    const freshKeys = getProviderKeys(targetProvider);
    // Don't add duplicate key if already present in pool
    const existing = freshKeys.find((k) => k.key.trim() === cleanKey);
    if (existing) {
      setNewKeyInput('');
      setNewKeyLabel('');
      return false;
    }

    const newId = `key_${targetProvider}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const labelToSet = newKeyLabel.trim() || `${AI_PROVIDERS_CONFIG[targetProvider]?.name || targetProvider} Key #${freshKeys.length + 1}`;
    const isFirst = freshKeys.length === 0;

    const newEntry: StoredApiKey = {
      id: newId,
      label: labelToSet,
      key: cleanKey,
      status: 'untested',
      isPrimary: isFirst,
    };

    const updated = [...freshKeys, newEntry];
    saveProviderKeys(targetProvider, updated);

    if (selectedProviderTab === targetProvider) {
      setCurrentTabKeys(updated);
    }

    if (targetProvider === 'gemini') {
      if (isFirst) onSaveKey(cleanKey);
    } else {
      const cfg = getProviderConfig(targetProvider);
      if (onSaveCustomConfig) onSaveCustomConfig(cfg);
    }

    setNewKeyInput('');
    setNewKeyLabel('');
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2500);

    // Trigger test for this specific provider safely
    testSingleKey(newEntry, targetProvider);
    return true;
  };

  // Handle Tab Switch between AI Providers
  const handleSelectTab = (provider: AIProvider) => {
    // Save any typed key before leaving current tab
    savePendingKeyInputIfPresent(selectedProviderTab);

    try {
      localStorage.setItem('subgame_last_viewed_tab', provider);
    } catch {}

    setSelectedProviderTab(provider);
    loadProviderData(provider);
  };

  // Activate Provider for System Translations
  const handleActivateProvider = (provider: AIProvider) => {
    setActiveSystemProvider(provider);
    setActiveAiProvider(provider);
    if (onProviderChange) {
      onProviderChange(provider);
    }
    const cfg = getProviderConfig(provider);
    if (onSaveCustomConfig) {
      onSaveCustomConfig(cfg);
    }
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2500);
  };

  // Select and Save Model for Current Provider
  const handleSelectModel = (modelId: string) => {
    const cleanModel = modelId.trim();
    if (!cleanModel) return;

    setProviderModel(cleanModel);
    saveProviderConfig(selectedProviderTab, {
      model: cleanModel,
    });

    if (onSaveCustomConfig) {
      const cfg = getProviderConfig(selectedProviderTab);
      onSaveCustomConfig(cfg);
    }
  };

  // Save Provider Base URL changes
  const handleSaveBaseUrl = (newBaseUrl: string) => {
    setProviderBaseUrl(newBaseUrl);
    saveProviderConfig(selectedProviderTab, {
      baseUrl: newBaseUrl.trim(),
    });

    if (onSaveCustomConfig) {
      const cfg = getProviderConfig(selectedProviderTab);
      onSaveCustomConfig(cfg);
    }
  };

  // Toggle Mask/Unmask Key
  const handleToggleShow = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Add New Key to Current Provider's Pool (Bugfix: Reads and updates fresh storage immediately)
  const handleAddKey = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = newKeyInput.trim();
    if (!cleanKey) return;

    const targetTab = selectedProviderTab;
    const freshKeys = getProviderKeys(targetTab);
    const newId = `key_${targetTab}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const labelToSet = newKeyLabel.trim() || `${AI_PROVIDERS_CONFIG[targetTab]?.name || targetTab} Key #${freshKeys.length + 1}`;
    const isFirst = freshKeys.length === 0;

    const newEntry: StoredApiKey = {
      id: newId,
      label: labelToSet,
      key: cleanKey,
      status: 'untested',
      isPrimary: isFirst,
    };

    const updated = [...freshKeys, newEntry];
    saveProviderKeys(targetTab, updated);
    if (selectedProviderTab === targetTab) {
      setCurrentTabKeys(updated);
    }

    if (isFirst && targetTab === 'gemini') {
      onSaveKey(cleanKey);
    } else if (targetTab !== 'gemini') {
      const cfg = getProviderConfig(targetTab);
      if (onSaveCustomConfig) onSaveCustomConfig(cfg);
    }

    setNewKeyInput('');
    setNewKeyLabel('');

    // Trigger test using fresh item reference and explicit targetTab
    testSingleKey(newEntry, targetTab);
  };

  // Set Key as Primary in Pool
  const handleSetPrimary = (id: string) => {
    const freshKeys = getProviderKeys(selectedProviderTab);
    const updated = freshKeys.map((k) => ({
      ...k,
      isPrimary: k.id === id,
    }));
    saveProviderKeys(selectedProviderTab, updated);
    setCurrentTabKeys(updated);

    const primaryKey = updated.find((k) => k.id === id);
    if (primaryKey && selectedProviderTab === 'gemini') {
      onSaveKey(primaryKey.key);
    }
  };

  // Delete Key from Pool
  const handleDeleteKey = (id: string) => {
    const freshKeys = getProviderKeys(selectedProviderTab);
    const filtered = freshKeys.filter((k) => k.id !== id);
    let updated = filtered;
    if (filtered.length > 0 && !filtered.some((k) => k.isPrimary)) {
      updated = filtered.map((k, idx) => ({ ...k, isPrimary: idx === 0 }));
    }
    saveProviderKeys(selectedProviderTab, updated);
    setCurrentTabKeys(updated);

    if (updated.length === 0) {
      if (selectedProviderTab === 'gemini') {
        onClearKey();
      }
    } else {
      const primary = updated.find((k) => k.isPrimary) || updated[0];
      if (primary && selectedProviderTab === 'gemini') {
        onSaveKey(primary.key);
      }
    }
  };

  // Test Single Key (Scoped strictly to targetProvider, immune to tab switching)
  const testSingleKey = async (item: StoredApiKey, targetProvider: AIProvider = selectedProviderTab) => {
    setTestingKeyId(item.id);
    const startTime = Date.now();
    let isSuccess = false;
    let errorMessage: string | undefined = undefined;

    try {
      if (targetProvider === 'gemini') {
        const res = await fetch('/api/test-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: item.key }),
        });
        const data = await res.json().catch(() => null);
        isSuccess = Boolean(res.ok && data?.success);
        if (isSuccess) {
          if (data?.statusText === 'busy' || data?.statusText === 'quota') {
            errorMessage = data?.warning || 'کلید تایید شد (ترافیک موقت سرورهای گوگل بالا است).';
          } else {
            errorMessage = undefined;
          }
        } else {
          errorMessage = data?.error || 'کلید نامعتبر است یا ارتباط با سرور برقرار نشد.';
        }
      } else {
        const targetDef = AI_PROVIDERS_CONFIG[targetProvider] || AI_PROVIDERS_CONFIG.custom;
        const targetCfg = getProviderConfig(targetProvider);
        const testBaseUrl = (selectedProviderTab === targetProvider && providerBaseUrl.trim())
          ? providerBaseUrl.trim()
          : (targetCfg.baseUrl || targetDef.defaultBaseUrl || '');
        const testModel = (selectedProviderTab === targetProvider && providerModel.trim())
          ? providerModel.trim()
          : (targetCfg.model || targetDef.defaultModel || '');

        const res = await fetch('/api/custom-provider/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: testBaseUrl,
            apiKey: item.key.trim(),
            model: testModel,
          }),
        });
        const data = await res.json().catch(() => null);
        isSuccess = Boolean(res.ok && data?.success);
        errorMessage = isSuccess ? undefined : (data?.error || 'ارتباط با سرویس‌دهنده برقرار نشد.');
      }
    } catch (err: any) {
      isSuccess = false;
      errorMessage = err?.message || 'خطای شبکه در تست کلید.';
    } finally {
      const latency = Date.now() - startTime;
      setKeyTestLatencies((prev) => ({ ...prev, [item.id]: latency }));
      setTestingKeyId(null);

      // Save status safely to targetProvider without overwriting other tabs or newly added keys
      const fresh = getProviderKeys(targetProvider);
      const isBusy = isSuccess && Boolean(errorMessage);
      const computedStatus: 'valid' | 'invalid' | 'busy' = isSuccess
        ? (isBusy ? 'busy' : 'valid')
        : 'invalid';

      const updated = fresh.map((k) => {
        if (k.id === item.id) {
          return {
            ...k,
            status: computedStatus,
            lastError: errorMessage,
          };
        }
        return k;
      });
      saveProviderKeys(targetProvider, updated);
      if (selectedProviderTab === targetProvider) {
        setCurrentTabKeys(updated);
      }
    }
  };

  // Test All Keys in Pool
  const testAllKeys = async () => {
    const targetTab = selectedProviderTab;
    const keysToTest = getProviderKeys(targetTab);
    if (keysToTest.length === 0 || isTestingAll) return;
    setIsTestingAll(true);
    for (const keyItem of keysToTest) {
      await testSingleKey(keyItem, targetTab);
    }
    setIsTestingAll(false);
  };

  const handleModalClose = () => {
    savePendingKeyInputIfPresent(selectedProviderTab);
    onClose();
  };

  if (!isOpen) return null;

  const currentDef = AI_PROVIDERS_CONFIG[selectedProviderTab] || AI_PROVIDERS_CONFIG.gemini;
  const isCurrentActive = activeSystemProvider === selectedProviderTab;
  const availableModels = currentDef.popularModels || [];

  const renderProviderIcon = (iconName: string, className = 'w-4 h-4') => {
    switch (iconName) {
      case 'Sparkles': return <Sparkles className={className} />;
      case 'Bot': return <Bot className={className} />;
      case 'Brain': return <Brain className={className} />;
      case 'Zap': return <Zap className={className} />;
      case 'Flame': return <Flame className={className} />;
      case 'Globe': return <Globe className={className} />;
      case 'Cpu': return <Cpu className={className} />;
      case 'Terminal': return <Terminal className={className} />;
      default: return <Server className={className} />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl relative flex flex-col gap-5 transition-colors max-h-[92vh] overflow-y-auto">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {uiLang === 'en' ? 'AI Providers, Models & Multi-API Keys' : 'تنظیمات سرویس‌دهنده‌ها، نوع مدل و کلیدهای هوش مصنوعی'}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-bold">
                  Auto-Failover
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {uiLang === 'en' 
                  ? 'Select any AI provider, pick its specific model, and enter multiple API keys for uninterrupted failover.'
                  : 'سرویس‌دهنده و نوع مدل دلخواه را انتخاب کنید و کلیدهای متعدد خود را وارد نمایید تا در صورت اتمام توکن، چرخش خودکار انجام شود.'}
              </p>
            </div>
          </div>

          <button
            onClick={handleModalClose}
            className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-xl bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. AI Providers Tab Selector */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-500" />
              <span>{uiLang === 'en' ? 'Select AI Provider' : 'انتخاب سرویس‌دهنده:'}</span>
            </label>
            <span className="text-[11px] font-medium text-slate-500">
              {uiLang === 'en' ? 'Active Engine: ' : 'موتور فعال ترجمه: '}
              <strong className="text-indigo-600 dark:text-indigo-400">
                {AI_PROVIDERS_CONFIG[activeSystemProvider]?.name || activeSystemProvider}
              </strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {ALL_PROVIDERS_LIST.map((provider) => {
              const isSelectedTab = selectedProviderTab === provider.id;
              const isEngineActive = activeSystemProvider === provider.id;
              const providerKeyCount = getProviderKeys(provider.id).length;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSelectTab(provider.id)}
                  className={`relative p-2.5 rounded-2xl border text-start flex flex-col justify-between gap-2 transition-all ${
                    isSelectedTab
                      ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 dark:border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100/80 dark:hover:bg-slate-900/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1.5">
                      <span className={`p-1.5 rounded-xl ${isSelectedTab ? 'bg-indigo-500 text-white' : 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                        {renderProviderIcon(provider.iconName, 'w-3.5 h-3.5')}
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate max-w-[85px]">
                        {provider.name.split(' ')[0]}
                      </span>
                    </div>

                    {isEngineActive && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" title="Active Engine" />
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] w-full pt-1 border-t border-slate-200/60 dark:border-slate-800">
                    <span className={`px-1.5 py-0.2 rounded font-mono ${provider.badgeColor}`}>
                      {provider.badge.split(' ')[0]}
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400">
                      {providerKeyCount} {uiLang === 'en' ? 'keys' : 'کلید'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Selected Provider Banner & Activation */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shrink-0">
              {renderProviderIcon(currentDef.iconName, 'w-5 h-5')}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {uiLang === 'en' ? currentDef.nameEn : currentDef.nameFa}
                </h4>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${currentDef.badgeColor}`}>
                  {currentDef.badge}
                </span>
                {isCurrentActive ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    {uiLang === 'en' ? 'Active Engine' : 'موتور فعال فعلی'}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                {uiLang === 'en' ? currentDef.descriptionEn : currentDef.descriptionFa}
              </p>
            </div>
          </div>

          {!isCurrentActive ? (
            <button
              type="button"
              onClick={() => handleActivateProvider(selectedProviderTab)}
              className="self-start sm:self-center px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow transition-all shrink-0 active:scale-95 flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>{uiLang === 'en' ? `Activate ${currentDef.name}` : `فعال‌سازی ${currentDef.name}`}</span>
            </button>
          ) : (
            <div className="self-start sm:self-center px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shrink-0 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>{uiLang === 'en' ? 'Active for Translation' : 'در حال استفاده برای ترجمه'}</span>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 3. MODEL SELECTION SECTION (نوع مدل هوش مصنوعی)                */}
        {/* ------------------------------------------------------------- */}
        <div className="flex flex-col gap-3 p-4 rounded-2xl bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-900/50">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                {uiLang === 'en' ? `Select Model for ${currentDef.name}` : `انتخاب نوع مدل برای ${currentDef.name}:`}
              </label>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                {uiLang === 'en' ? 'Current Model: ' : 'مدل فعال: '}
                <strong className="font-mono text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                  {providerModel || currentDef.defaultModel || 'Not selected'}
                </strong>
              </span>

              <button
                type="button"
                onClick={() => setIsCustomModelInputVisible(!isCustomModelInputVisible)}
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
              >
                <Edit3 className="w-3 h-3" />
                <span>{isCustomModelInputVisible ? (uiLang === 'en' ? 'Hide Input' : 'بستن کادر') : (uiLang === 'en' ? 'Custom Model' : 'مدل دستی')}</span>
              </button>
            </div>
          </div>

          {/* Preset Model Cards for this Provider */}
          {availableModels.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              {availableModels.map((m) => {
                const isSelected = providerModel === m.id;

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectModel(m.id)}
                    className={`p-3 rounded-2xl border text-start flex flex-col justify-between gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white dark:bg-slate-800 border-indigo-500 dark:border-indigo-500 ring-2 ring-indigo-500/30 shadow-md'
                        : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>
                        {m.name}
                      </span>
                      {isSelected ? (
                        <CheckCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-700 shrink-0" />
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
                      {m.descFa}
                    </p>

                    <div className="flex items-center justify-between text-[10px] w-full pt-1.5 border-t border-slate-100 dark:border-slate-800">
                      {m.badge && (
                        <span className={`px-1.5 py-0.2 rounded font-medium ${m.badgeColor || 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                          {m.badge}
                        </span>
                      )}
                      {m.speed && (
                        <span className="font-mono text-slate-400">
                          {m.speed}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Custom Model Input (if toggled or Custom provider) */}
          {(isCustomModelInputVisible || availableModels.length === 0) && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                {uiLang === 'en' ? 'Model Name / ID:' : 'نام یا شناسه مدل:'}
              </span>
              <input
                type="text"
                value={providerModel}
                onChange={(e) => handleSelectModel(e.target.value)}
                placeholder="e.g. gpt-4o, deepseek-chat, llama3..."
                className="flex-1 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>
          )}

          {/* Base URL (if OpenAI-compatible) */}
          {isOpenAiCompatibleProvider(selectedProviderTab) && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-indigo-100 dark:border-indigo-950">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                {uiLang === 'en' ? 'Base API URL:' : 'آدرس اندپوینت (Base URL):'}
              </span>
              <input
                type="text"
                value={providerBaseUrl}
                onChange={(e) => handleSaveBaseUrl(e.target.value)}
                placeholder={currentDef.defaultBaseUrl || 'https://api.openai.com/v1'}
                className="flex-1 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                dir="ltr"
              />
              {currentDef.defaultBaseUrl && providerBaseUrl !== currentDef.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() => handleSaveBaseUrl(currentDef.defaultBaseUrl)}
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                >
                  {uiLang === 'en' ? 'Default' : 'پیش‌فرض'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 4. MULTI-KEY POOL MANAGER FOR SELECTED PROVIDER               */}
        {/* ------------------------------------------------------------- */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-500" />
              <label className="text-xs font-bold text-slate-900 dark:text-white">
                {uiLang === 'en'
                  ? `${currentDef.name} API Keys Pool (${currentTabKeys.length})`
                  : `مخزن کلیدهای API برای ${currentDef.name} (${currentTabKeys.length} کلید):`}
              </label>
              {currentTabKeys.length > 0 && (
                <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-bold">
                  {currentTabKeys.filter((k) => k.status === 'valid' || k.status === 'busy').length} فعال / معتبر
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {currentDef.keyLink && (
                <a
                  href={currentDef.keyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <span>{uiLang === 'en' ? 'Get API Key' : 'دریافت کلید API'}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {currentTabKeys.length > 1 && (
                <button
                  type="button"
                  onClick={testAllKeys}
                  disabled={isTestingAll}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isTestingAll ? 'animate-spin' : ''}`} />
                  <span>{uiLang === 'en' ? 'Test All' : 'تست همه'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Add New Key Form */}
          <form onSubmit={handleAddKey} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder={uiLang === 'en' ? 'Key Label (e.g. Primary, Backup)' : 'برچسب کلید (مثلاً: کلید اصلی، حساب دوم)'}
              className="sm:w-1/3 text-xs bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <div className="flex-1 relative">
              <input
                type="text"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder={currentDef.keyPlaceholder || 'sk-...'}
                className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>
            <button
              type="submit"
              disabled={!newKeyInput.trim()}
              className="px-4 py-2.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none text-white transition-all shadow-xs flex items-center justify-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{uiLang === 'en' ? 'Save Key' : 'ثبت کلید'}</span>
            </button>
          </form>

          {/* Keys List */}
          {currentTabKeys.length > 0 ? (
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
              {currentTabKeys.map((item) => {
                const isMasked = !showKeys[item.id];
                const displayKey = isMasked
                  ? item.key.length > 12
                    ? `${item.key.slice(0, 6)}••••••••${item.key.slice(-4)}`
                    : '••••••••••••'
                  : item.key;
                const isTesting = testingKeyId === item.id;
                const latency = keyTestLatencies[item.id];

                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      item.isPrimary
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-800'
                        : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => handleSetPrimary(item.id)}
                        className={`p-1.5 rounded-xl border transition-all ${
                          item.isPrimary
                            ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-amber-500 border-slate-200 dark:border-slate-700'
                        }`}
                        title={item.isPrimary ? 'کلید اصلی فعال' : 'تنظیم به عنوان کلید اصلی'}
                      >
                        <Star className="w-3.5 h-3.5 fill-current" />
                      </button>

                      <div className="flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {item.label}
                          </span>
                          {item.isPrimary && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono">
                              PRIMARY
                            </span>
                          )}
                          {item.status === 'valid' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                              <Check className="w-2.5 h-2.5" />
                              VALID {latency ? `(${latency}ms)` : ''}
                            </span>
                          )}
                          {item.status === 'busy' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1 font-mono" title={item.lastError}>
                              <Activity className="w-2.5 h-2.5" />
                              ACTIVE / BUSY {latency ? `(${latency}ms)` : ''}
                            </span>
                          )}
                          {item.status === 'invalid' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center gap-1 font-mono">
                              <AlertCircle className="w-2.5 h-2.5" />
                              INVALID
                            </span>
                          )}
                        </div>

                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5" dir="ltr">
                          {displayKey}
                        </span>

                        {item.lastError && (
                          <span className={`text-[10px] mt-0.5 truncate ${item.status === 'busy' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {item.lastError}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleShow(item.id)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title={isMasked ? 'نمایش کلید' : 'مخفی‌سازی'}
                      >
                        {isMasked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => testSingleKey(item, selectedProviderTab)}
                        disabled={isTesting}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1"
                      >
                        {isTesting ? (
                          <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
                        ) : (
                          <Activity className="w-3 h-3 text-indigo-500" />
                        )}
                        <span>{uiLang === 'en' ? 'Test' : 'تست'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteKey(item.id)}
                        className="p-1.5 text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="حذف کلید"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-center flex flex-col items-center justify-center gap-1.5 text-slate-500">
              <Key className="w-6 h-6 text-slate-400" />
              <p className="text-xs">
                {uiLang === 'en'
                  ? `No API keys saved for ${currentDef.name} yet.`
                  : `هنوز کلیدی برای ${currentDef.name} ثبت نشده است.`}
              </p>
              <span className="text-[11px] text-slate-400">
                {uiLang === 'en'
                  ? 'Add your key above to enable translation with this engine.'
                  : 'کلید خود را در کادر بالا وارد کرده و دکمه «ثبت کلید» را بزنید.'}
              </span>
            </div>
          )}

          {/* Failover notice */}
          <div className="bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-900/50 rounded-2xl p-3 flex items-start gap-2.5 text-xs text-indigo-900 dark:text-indigo-200">
            <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>{uiLang === 'en' ? 'Smart Quota Rotation Active:' : 'گردش هوشمند سهمیه فعال است:'}</strong>{' '}
              {uiLang === 'en'
                ? 'If an API key runs out of quota or hits 429 rate limit during translation, the system automatically rotates to the next key without failing!'
                : 'اگر حین ترجمه سهمیه یک کلید تمام شود یا خطای ۴۲۹ رخ دهد، سیستم فوراً به کلید بعدی سوئیچ می‌کند و کار ترجمه بدون توقف ادامه می‌یابد!'}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            {showSaveSuccess && (
              <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 animate-fade-in">
                <Check className="w-3.5 h-3.5" />
                {uiLang === 'en' ? 'Engine & Model Activated!' : 'سرویس‌دهنده و مدل با موفقیت فعال شدند!'}
              </span>
            )}
          </div>

          <button
            onClick={handleModalClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 transition-all shadow-sm active:scale-95"
          >
            {uiLang === 'en' ? 'Done & Close' : 'تایید و بستن'}
          </button>
        </div>

      </div>
    </div>
  );
};
