import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
  FolderPlus, 
  FolderOpen,
  Upload, 
  Download, 
  Play, 
  Pause, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Trash2, 
  Edit3, 
  Archive, 
  Loader2, 
  Eye, 
  FileText, 
  Key, 
  ShieldCheck, 
  Sparkles, 
  Server, 
  RefreshCw, 
  ChevronRight,
  ChevronLeft,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Database,
  UploadCloud,
  RotateCcw,
  Check,
  XCircle,
  Activity,
  ShieldAlert,
  Settings,
  Globe,
  Sliders,
  Copy,
  Plus,
  ArrowRight,
  ArrowLeft,
  Search,
  MoveRight,
  ExternalLink,
  Replace,
  StopCircle,
  Zap,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { SubtitleItem, SubtitleFormat, ToneOption } from '../types';
import { parseSubtitleFile, isCueProperlyTranslated } from '../lib/subtitleParser';
import { UILanguage } from '../lib/i18n';
import { TONE_OPTIONS } from '../constants';

export interface ServerFolderItem {
  id: string;
  name: string;
  description?: string;
  tone?: string;
  createdAt: string;
  updatedAt: string;
  projectCount: number;
  completedCount: number;
}

export interface ServerProjectItem {
  id: string;
  folderId: string;
  name: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sub';
  rawHeader?: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone: string;
  customPrompt?: string;
  status: 'idle' | 'queued' | 'translating' | 'paused' | 'waiting_for_keys' | 'has_incomplete' | 'completed' | 'error';
  hasDisruption?: boolean;
  isPriority?: boolean;
  priorityLevel?: number;
  maxKeys?: number;
  totalCues: number;
  translatedCues: number;
  currentBatchIndex: number;
  totalBatches: number;
  errorMessage?: string;
  lastError?: string;
  failedCueIds?: number[];
  workerKeyUsed?: string;
  items: SubtitleItem[];
  tokenUsage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkerStatusData {
  isRunning: boolean;
  activeProjectCount: number;
  maxConcurrentProjects: number;
  maxTotalParallelKeys?: number;
  inFlightKeyThreads?: number;
  priorityProjectCount?: number;
  queuedProjectCount?: number;
  incompleteProjectCount?: number;
  reserveKeysCount?: number;
  activeProjects: Array<{
    id: string;
    name: string;
    folderId: string;
    progressPercent: number;
    translatedCues: number;
    totalCues: number;
    keyMasked: string;
  }>;
  activeProjectId: string | null;
  activeProjectName: string | null;
  folderId: string | null;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  currentKeyIndex: number;
  totalKeys: number;
  activeKeys: number;
  exhaustedKeys: number;
  dailyExhaustedKeys?: number;
  minuteExhaustedKeys?: number;
  stuckReason?: string;
  lastMessage: string;
}

export interface ServerConfigData {
  allowedOrigin: string;
  geminiBaseUrl: string;
  maxConcurrentProjects: number;
  maxTotalParallelKeys?: number;
  maxKeysPerProject?: number;
}

export interface KeyDetailItem {
  index: number;
  rawKey: string;
  maskedKey: string;
  isExhausted: boolean;
  isDailyExhausted?: boolean;
  isMinuteExhausted?: boolean;
  exhaustionType?: 'minute' | 'daily';
  exhaustionReason?: string;
  cooldownRemainingSec: number;
  isDisabled?: boolean;
  disabledReason?: string;
  requestsCount?: number;
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  lastUsedAt?: string;
}

interface FolderProjectManagerProps {
  uiLang: UILanguage;
  onOpenProjectInEditor: (project: {
    id: string;
    name: string;
    folderName?: string;
    items: SubtitleItem[];
    format: SubtitleFormat;
    rawHeader?: string;
  }) => void;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const FolderProjectManager: React.FC<FolderProjectManagerProps> = ({
  uiLang,
  onOpenProjectInEditor,
  onShowToast,
}) => {
  const [folders, setFolders] = useState<ServerFolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [projects, setProjects] = useState<ServerProjectItem[]>([]);
  const [allProjects, setAllProjects] = useState<Array<ServerProjectItem & { folderName?: string }>>([]);
  const [loadingFolders, setLoadingFolders] = useState<boolean>(true);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [loadingAllProjects, setLoadingAllProjects] = useState<boolean>(false);
  
  // Navigation View: 'folders_grid' (overview of all folders), 'inside_folder' (entered a folder), 'all_files' (all files with folder badges)
  const [activeView, setActiveView] = useState<'folders_grid' | 'inside_folder' | 'all_files'>('folders_grid');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Move Project modal state
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [movingProject, setMovingProject] = useState<(ServerProjectItem & { folderName?: string }) | null>(null);
  const [targetMoveFolderId, setTargetMoveFolderId] = useState<string>('');

  // Background Worker status
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusData | null>(null);

  // Modals & Panels
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');
  const [newFolderTone, setNewFolderTone] = useState<ToneOption>('cinematic');

  const [isEditFolderOpen, setIsEditFolderOpen] = useState(false);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderDesc, setEditFolderDesc] = useState('');
  const [editFolderTone, setEditFolderTone] = useState<ToneOption>('cinematic');

  // Folder-level Global Find & Replace Modal
  const [isFolderBatchReplaceOpen, setIsFolderBatchReplaceOpen] = useState(false);
  const [batchFindText, setBatchFindText] = useState('');
  const [batchReplaceText, setBatchReplaceText] = useState('');
  const [batchScope, setBatchScope] = useState<'translated' | 'both'>('translated');
  const [batchMatchCase, setBatchMatchCase] = useState(false);
  const [batchWholeWord, setBatchWholeWord] = useState(false);
  const [batchUseRegex, setBatchUseRegex] = useState(false);
  const [isExecutingReplace, setIsExecutingReplace] = useState(false);
  const [replaceResult, setReplaceResult] = useState<{
    totalOccurrences: number;
    affectedProjectsCount: number;
    affectedProjects: string[];
  } | null>(null);

  // Keys Management Modal
  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [serverKeysText, setServerKeysText] = useState('');
  const [serverKeysCount, setServerKeysCount] = useState(0);
  const [keysDetails, setKeysDetails] = useState<KeyDetailItem[]>([]);
  const [editingKeyIndex, setEditingKeyIndex] = useState<number | null>(null);
  const [editingKeyVal, setEditingKeyVal] = useState('');
  const [selectedKeyIndices, setSelectedKeyIndices] = useState<number[]>([]);
  const [batchKeyModel, setBatchKeyModel] = useState<string>('gemini-3.1-flash-lite');
  const [customKeyModelInput, setCustomKeyModelInput] = useState<string>('');
  const [isBatchDeletingKeys, setIsBatchDeletingKeys] = useState(false);
  const [isChangingPoolModel, setIsChangingPoolModel] = useState(false);

  // Unified Keys Pool State (Single peer pool across Gemini, DeepSeek Brokers, OpenAI, Claude)
  const [unifiedKeysList, setUnifiedKeysList] = useState<any[]>([]);
  const [unifiedKeyFilter, setUnifiedKeyFilter] = useState<'all' | 'gemini' | 'custom' | 'openai' | 'claude'>('all');
  const [selectedUnifiedIds, setSelectedUnifiedIds] = useState<string[]>([]);
  const [isPurgingInvalid, setIsPurgingInvalid] = useState(false);
  const [addKeySectionTab, setAddKeySectionTab] = useState<'batch_main' | 'broker_custom'>('batch_main');
  const [batchProviderType, setBatchProviderType] = useState<'gemini' | 'openai' | 'claude'>('gemini');
  const [batchProviderKeysText, setBatchProviderKeysText] = useState('');
  const [batchProviderModel, setBatchProviderModel] = useState('gemini-3.5-flash-lite');
  const [isManualBatchModel, setIsManualBatchModel] = useState(false);
  const [isAddingBatchKeys, setIsAddingBatchKeys] = useState(false);
  const [brokerName, setBrokerName] = useState('سرور واسط DeepSeek');
  const [brokerBaseUrl, setBrokerBaseUrl] = useState('https://api.deepseek.com/v1');
  const [brokerModel, setBrokerModel] = useState('deepseek-chat');
  const [brokerKeysText, setBrokerKeysText] = useState('');
  const [isAddingBrokerServer, setIsAddingBrokerServer] = useState(false);
  const [batchUnifiedModel, setBatchUnifiedModel] = useState('gemini-3.5-flash-lite');
  const [isManualBatchChangeModel, setIsManualBatchChangeModel] = useState(false);
  const [isTestingAllKeys, setIsTestingAllKeys] = useState(false);

  // Server & Network Configuration Modal
  const [isServerConfigOpen, setIsServerConfigOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfigData>({
    allowedOrigin: '*',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    maxConcurrentProjects: 6,
    maxTotalParallelKeys: 19,
    maxKeysPerProject: 1,
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [customConcurrentInput, setCustomConcurrentInput] = useState<string>('2');
  const [fileFilter, setFileFilter] = useState<'all' | 'incomplete' | 'translating' | 'completed' | 'disrupted'>('all');
  const [activeQueueSubTab, setActiveQueueSubTab] = useState<'translating' | 'emergency' | 'untranslated' | 'completed'>('translating');

  // Fallback AI Providers State (OpenAI, Claude, Custom)
  const [keysModalTab, setKeysModalTab] = useState<'gemini' | 'fallback'>('gemini');
  const [fallbackConfig, setFallbackConfig] = useState<{
    openaiKeys: string[];
    openaiModel: string;
    claudeKeys: string[];
    claudeModel: string;
    customConfig?: { baseUrl: string; apiKey: string; model: string; name?: string };
    providerStrategy: 'gemini_with_fallback' | 'gemini_only' | 'openai' | 'claude' | 'custom';
  }>({
    openaiKeys: [],
    openaiModel: 'gpt-4o-mini',
    claudeKeys: [],
    claudeModel: 'claude-3-5-haiku-20241022',
    customConfig: { baseUrl: '', apiKey: '', model: 'deepseek-chat', name: 'سرویس سفارشی' },
    providerStrategy: 'lowest_ping',
  });
  const [providerPriorityOrder, setProviderPriorityOrder] = useState<string[]>(['custom', 'gemini', 'openai', 'claude']);
  const [providerPings, setProviderPings] = useState<Record<string, { latencyMs: number; isAvailable: boolean; message?: string }>>({});
  const [isMeasuringPings, setIsMeasuringPings] = useState(false);
  const [openaiKeysText, setOpenaiKeysText] = useState('');
  const [claudeKeysText, setClaudeKeysText] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('deepseek-chat');
  const [customProviderName, setCustomProviderName] = useState('سرویس سفارشی');
  const [isSavingFallback, setIsSavingFallback] = useState(false);
  const [fallbackTestResult, setFallbackTestResult] = useState<any>(null);
  const [isTestingFallback, setIsTestingFallback] = useState(false);

  // Multiple Custom Servers & DeepSeek Brokers State
  const [customServersList, setCustomServersList] = useState<any[]>([]);
  const [customKeysList, setCustomKeysList] = useState<any[]>([]);
  const [keyPoolFilter, setKeyPoolFilter] = useState<'all' | 'gemini' | 'custom'>('all');
  
  // New Custom Server form state
  const [isAddingNewServer, setIsAddingNewServer] = useState(false);
  const [newServerName, setNewServerName] = useState('DeepSeek واسط شماره ۱');
  const [newServerBaseUrl, setNewServerBaseUrl] = useState('https://api.deepseek.com/v1');
  const [newServerModel, setNewServerModel] = useState('deepseek-chat');
  const [newServerKeysText, setNewServerKeysText] = useState('');
  const [isSavingCustomServer, setIsSavingCustomServer] = useState(false);
  const [testingCustomServerId, setTestingCustomServerId] = useState<string | null>(null);

  // Server Info & Storage Location State
  const [serverInfo, setServerInfo] = useState<{
    databasePath: string;
    model: string;
    modelId: string;
    vpsReady: boolean;
    port: number;
    description: string;
  } | null>(null);

  // Restore Modal State
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreJsonText, setRestoreJsonText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  // Key Testing State
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    message?: string;
    modelUsed?: string;
    keyTested?: string;
  } | null>(null);
  const [keySaveMode, setKeySaveMode] = useState<'append' | 'replace'>('append');

  // Audit English cues state
  const [isAuditing, setIsAuditing] = useState(false);

  // In-Place Subtitle Viewer & Editor Modal State
  const [viewingProject, setViewingProject] = useState<ServerProjectItem | null>(null);
  const [viewingProjectFolderName, setViewingProjectFolderName] = useState('');
  const [editedCues, setEditedCues] = useState<SubtitleItem[]>([]);
  const [cuesFilter, setCuesFilter] = useState<'all' | 'translated' | 'untranslated'>('all');
  const [cuesSearch, setCuesSearch] = useState('');
  const [isSavingProjectItems, setIsSavingProjectItems] = useState(false);

  const [isLoadingViewingProject, setIsLoadingViewingProject] = useState(false);

  const handleOpenViewingProjectModal = async (proj: ServerProjectItem, folderName?: string) => {
    setViewingProject(proj);
    setViewingProjectFolderName(folderName || selectedFolder?.name || '');
    setCuesFilter('all');
    setCuesSearch('');

    if (proj.items && Array.isArray(proj.items) && proj.items.length > 0) {
      setEditedCues(JSON.parse(JSON.stringify(proj.items)));
    } else {
      setIsLoadingViewingProject(true);
      try {
        const res = await fetch(`/api/projects/${proj.id}`);
        const data = await res.json();
        if (data.success && data.project) {
          setViewingProject(data.project);
          setEditedCues(JSON.parse(JSON.stringify(data.project.items || [])));
        } else {
          setEditedCues([]);
        }
      } catch {
        setEditedCues([]);
      } finally {
        setIsLoadingViewingProject(false);
      }
    }
  };

  const handleSaveViewingProjectChanges = async () => {
    if (!viewingProject) return;
    setIsSavingProjectItems(true);
    try {
      const res = await fetch(`/api/projects/${viewingProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: editedCues }),
      });
      const data = await res.json();
      if (data.success && data.project) {
        setViewingProject(data.project);
        setEditedCues(JSON.parse(JSON.stringify(data.project.items || [])));
        onShowToast('تغییرات زیرنویس با موفقیت در دیتابیس سرور ذخیره شد.', 'success');
        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
        setAllProjects((prev) => prev.map((p) => (p.id === data.project.id ? { ...data.project, folderName: p.folderName } : p)));
        fetchFolders();
      } else {
        onShowToast(data.error || 'خطا در ذخیره تغییرات', 'error');
      }
    } catch {
      onShowToast('خطا در ذخیره در سرور', 'error');
    } finally {
      setIsSavingProjectItems(false);
    }
  };

  const handleAuditAndFixEnglish = async () => {
    setIsAuditing(true);
    try {
      const res = await fetch('/api/projects/audit-and-fix', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message, data.totalFixedCues > 0 ? 'warning' : 'success');
        fetchFolders();
        if (selectedFolderId) fetchProjects(selectedFolderId);
        if (activeView === 'all_files') fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در بررسی فایل‌ها', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    } finally {
      setIsAuditing(false);
    }
  };

  const [isRetryingIncomplete, setIsRetryingIncomplete] = useState(false);
  const [prioritizingProjectId, setPrioritizingProjectId] = useState<string | null>(null);

  const handlePrioritizeProject = async (projectId: string, name: string) => {
    setPrioritizingProjectId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/prioritize`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`فایل "${name}" به لیست اضطراری (اولویت اول) ارتقا یافت.`, 'success');
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
        await fetchFolders();
      } else {
        onShowToast(data.error || 'خطا در ارتقای اولویت', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    } finally {
      setPrioritizingProjectId(null);
    }
  };

  const handleDeprioritizeProject = async (projectId: string, name: string) => {
    setPrioritizingProjectId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/deprioritize`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`فایل "${name}" از اولویت اضطراری خارج شد.`, 'info');
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
        await fetchFolders();
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    } finally {
      setPrioritizingProjectId(null);
    }
  };

  const handleRetryIncomplete = async (folderId?: string) => {
    setIsRetryingIncomplete(true);
    try {
      const url = folderId ? `/api/folders/${folderId}/retry-incomplete` : '/api/projects/retry-incomplete';
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'فایل‌های ناقص به لیست اضطراری منتقل و ترجمه فوری آغاز شد.', data.retriedCount > 0 ? 'success' : 'info');
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchFolders();
        if (activeView === 'all_files') await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در رفع خطای فایل‌ها', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور', 'error');
    } finally {
      setIsRetryingIncomplete(false);
    }
  };

  const [isRestartingFolder, setIsRestartingFolder] = useState(false);

  const handleRestartFolderFromScratch = async (folderIdTarget?: string, folderNameTarget?: string) => {
    const targetId = folderIdTarget || selectedFolderId;
    if (!targetId) return;
    const fObj = folders.find((f) => f.id === targetId);
    const folderName = folderNameTarget || fObj?.name || 'پوشه انتخابی';

    const confirmMsg = `⚠️ هشدار ترجمه مجدد از صفر:\n\nآیا مطمئن هستید که می‌خواهید تمام فایل‌های پوشه «${folderName}» از ابتدا ترجمه شوند؟\n\n- تمامی ترجمه‌های قبلی تمام فایل‌های این پوشه پاک خواهند شد و پیشرفت به ۰٪ برمی‌گردد.\n- متن انگلیسی اصلی و زمان‌بندی دقیق زیرنویس‌ها کاملاً حفظ می‌شود (هیچ نیازی به آپلود مجدد فایل‌ها نیست).\n- موتور ترجمه هوشمند تمیز بلافاصله از سطر اول شروع به ترجمه دقیق خواهد کرد.\n\nادامه می‌دهید؟`;

    if (!window.confirm(confirmMsg)) return;

    setIsRestartingFolder(true);
    onShowToast(`در حال پاکسازی ترجمه‌ها و آماده‌سازی پوشه «${folderName}» برای ترجمه مجدد از ابتدا...`, 'info');

    try {
      const res = await fetch(`/api/folders/${targetId}/restart-from-scratch`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || `تمامی فایل‌های پوشه «${folderName}» پاکسازی و ترجمه مجدد از ابتدا آغاز گردید.`, 'success');
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchFolders();
        if (activeView === 'all_files') await fetchAllProjects();
        await fetchWorkerStatus();
      } else {
        onShowToast(data.error || 'خطا در ریست کردن پوشه', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور برای ترجمه مجدد پوشه', 'error');
    } finally {
      setIsRestartingFolder(false);
    }
  };

  const handleSetDualConcurrency = async (files?: number, keysPerProject?: number) => {
    try {
      const targetFiles = files || serverConfig.maxConcurrentProjects || 4;
      const validFiles = Math.max(1, Math.min(targetFiles, 50));
      const targetKeysPerFile = keysPerProject || serverConfig.maxKeysPerProject || 2;
      const payload: Record<string, any> = {
        maxConcurrentProjects: validFiles,
        maxKeysPerProject: targetKeysPerFile,
      };

      const res = await fetch('/api/server/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.config) {
        setServerConfig(data.config);
        setCustomConcurrentInput(String(data.config.maxConcurrentProjects));
        onShowToast(`ظرفیت همزمانی سرور تنظیم شد: ${data.config.maxConcurrentProjects} فایل همزمان (${data.config.maxKeysPerProject || 2} کلید موازی برای هر فایل).`, 'success');
      }
    } catch {
      onShowToast('خطا در به‌روزرسانی تنظیمات سرور', 'error');
    }
  };

  const handleSetConcurrency = (val: number) => handleSetDualConcurrency(val, serverConfig.maxKeysPerProject || 2);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadTone, setUploadTone] = useState<ToneOption>('cinematic');
  const [autoQueueOnUpload, setAutoQueueOnUpload] = useState(true);
  const [isZippingFolder, setIsZippingFolder] = useState(false);
  const [isZippingSRT, setIsZippingSRT] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Server Info & DB storage path
  const fetchServerInfo = async () => {
    try {
      const res = await fetch('/api/server/info');
      const data = await res.json();
      if (data.success) {
        setServerInfo(data);
      }
    } catch {}
  };

  // Fetch Server Config
  const fetchServerConfig = async () => {
    try {
      const res = await fetch('/api/server/config');
      const data = await res.json();
      if (data.success && data.config) {
        setServerConfig(data.config);
        setCustomConcurrentInput(String(data.config.maxConcurrentProjects || 2));
      }
    } catch {}
    void fetchFallbackConfig();
  };

  // Fetch Fallback Providers Config
  const fetchFallbackConfig = async () => {
    try {
      const res = await fetch('/api/server/fallback-providers');
      const data = await res.json();
      if (data.success && data.config) {
        setFallbackConfig(data.config);
        if (data.config.priorityOrder && Array.isArray(data.config.priorityOrder)) {
          setProviderPriorityOrder(data.config.priorityOrder);
        }
        if (data.pings) {
          setProviderPings(data.pings);
        }
        setOpenaiKeysText((data.config.openaiKeys || []).join('\n'));
        setClaudeKeysText((data.config.claudeKeys || []).join('\n'));
        if (data.config.customConfig) {
          setCustomBaseUrl(data.config.customConfig.baseUrl || '');
          setCustomApiKey(data.config.customConfig.apiKey || '');
          setCustomModel(data.config.customConfig.model || 'deepseek-chat');
          setCustomProviderName(data.config.customConfig.name || 'سرویس سفارشی');
        }
      }
    } catch {}
  };

  const handleMeasureAllPings = async () => {
    setIsMeasuringPings(true);
    try {
      const res = await fetch('/api/server/fallback-providers/measure-all-pings', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.pings) {
        setProviderPings(data.pings);
        onShowToast('✓ تست و سنجش پینگ تمامی هوش‌های مصنوعی انجام شد.', 'success');
      } else {
        onShowToast('خطا در سنجش پینگ مدل‌ها', 'error');
      }
    } catch {
      onShowToast('خطای شبکه در تست پینگ', 'error');
    } finally {
      setIsMeasuringPings(false);
    }
  };

  const handleMovePriority = async (index: number, direction: 'up' | 'down') => {
    const newOrder = [...providerPriorityOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;

    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    setProviderPriorityOrder(newOrder);

    try {
      const res = await fetch('/api/server/fallback-providers/priority-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorityOrder: newOrder, providerStrategy: fallbackConfig.providerStrategy }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast('ترتیب اولویت تغییر کرد و در سرور ذخیره شد.', 'info');
      }
    } catch {}
  };

  // Fetch Keys Details
  const fetchUnifiedKeys = async () => {
    try {
      const res = await fetch('/api/server/unified-keys');
      const data = await res.json();
      if (data.success && Array.isArray(data.keys)) {
        setUnifiedKeysList(data.keys);
      }
    } catch {}
  };

  const fetchServerKeys = async () => {
    try {
      void fetchUnifiedKeys();
      const res = await fetch('/api/server/keys');
      const data = await res.json();
      if (data.success) {
        setServerKeysCount(data.count || 0);
        if (Array.isArray(data.details)) {
          setKeysDetails(data.details);
        }
        if (Array.isArray(data.customServers)) {
          setCustomServersList(data.customServers);
        }
        if (Array.isArray(data.customKeys)) {
          setCustomKeysList(data.customKeys);
        }
      }
    } catch {}
  };

  const handleAddBatchKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = batchProviderKeysText.trim();
    if (!cleanText) {
      onShowToast('لطفاً حداقل یک کلید وارد کنید.', 'error');
      return;
    }
    setIsAddingBatchKeys(true);
    try {
      const res = await fetch('/api/server/unified-keys/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: batchProviderType,
          rawKeys: cleanText,
          model: batchProviderModel,
          name: batchProviderType === 'gemini' ? 'Google Gemini' : (batchProviderType === 'openai' ? 'OpenAI GPT' : 'Anthropic Claude'),
        }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلیدها با موفقیت به استخر افزوده شدند.', 'success');
        setBatchProviderKeysText('');
        await fetchUnifiedKeys();
        await fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در افزودن کلیدها', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور', 'error');
    } finally {
      setIsAddingBatchKeys(false);
    }
  };

  const handleAddBrokerKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brokerBaseUrl.trim()) {
      onShowToast('آدرس سرور واسط (Base URL) الزامی است.', 'error');
      return;
    }
    const cleanText = brokerKeysText.trim();
    if (!cleanText) {
      onShowToast('حداقل یک کلید برای سرور واسط وارد کنید.', 'error');
      return;
    }
    setIsAddingBrokerServer(true);
    try {
      const res = await fetch('/api/server/unified-keys/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'custom',
          name: brokerName.trim() || 'سرور واسط',
          baseUrl: brokerBaseUrl.trim(),
          model: brokerModel.trim() || 'deepseek-chat',
          rawKeys: cleanText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'سرور و کلیدهای واسط با موفقیت اضافه شدند.', 'success');
        setBrokerKeysText('');
        await fetchUnifiedKeys();
        await fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در افزودن سرور واسط', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور', 'error');
    } finally {
      setIsAddingBrokerServer(false);
    }
  };

  const handleMoveKeyPriority = async (id: string, direction: 'up' | 'down') => {
    try {
      const res = await fetch('/api/server/unified-keys/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, direction }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.keys)) {
        setUnifiedKeysList(data.keys);
      }
    } catch {}
  };

  const handleDeleteUnifiedKey = async (id: string) => {
    try {
      const res = await fetch(`/api/server/unified-keys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلید حذف شد.', 'info');
        await fetchUnifiedKeys();
        await fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در حذف کلید', 'error');
    }
  };

  const handleBatchDeleteUnifiedKeys = async () => {
    if (selectedUnifiedIds.length === 0) return;
    try {
      const res = await fetch('/api/server/unified-keys/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedUnifiedIds }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلیدهای انتخاب‌شده حذف شدند.', 'info');
        setSelectedUnifiedIds([]);
        await fetchUnifiedKeys();
        await fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در حذف گروهی کلیدها', 'error');
    }
  };

  const handlePurgeInvalidKeys = async () => {
    setIsPurgingInvalid(true);
    try {
      const res = await fetch('/api/server/unified-keys/purge-invalid', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message, data.purgedCount > 0 ? 'success' : 'info');
        await fetchUnifiedKeys();
        await fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در پاکسازی کلیدها', 'error');
      }
    } catch {
      onShowToast('خطا در پاکسازی خودکار کلیدهای نامعتبر', 'error');
    } finally {
      setIsPurgingInvalid(false);
    }
  };

  const handleTestUnifiedKey = async (id: string) => {
    try {
      onShowToast('در حال سنجش پینگ و اعتبار کلید از روی سرور...', 'info');
      const res = await fetch(`/api/server/unified-keys/test/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message, 'success');
      } else {
        onShowToast(data.message || 'تست کلید ناموفق بود.', 'error');
      }
      await fetchUnifiedKeys();
    } catch {
      onShowToast('خطا در تست کلید', 'error');
    }
  };

  const handleTestAllUnifiedKeys = async () => {
    if (isTestingAllKeys) return;
    try {
      setIsTestingAllKeys(true);
      onShowToast('در حال تست پینگ و اعتبار تمام کلیدها از روی سرور...', 'info');
      const res = await fetch('/api/server/unified-keys/test-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message, data.purged > 0 ? 'warning' : 'success');
      } else {
        onShowToast(data.message || 'خطا در تست دسته‌جمعی کلیدها', 'error');
      }
      await fetchUnifiedKeys();
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور برای تست دسته‌جمعی', 'error');
    } finally {
      setIsTestingAllKeys(false);
    }
  };

  const handleBatchSetModelUnifiedKeys = async (model: string) => {
    if (!model) return;
    try {
      const res = await fetch('/api/server/unified-keys/batch-set-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedUnifiedIds, model }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || `مدل با موفقیت تغییر کرد.`, 'success');
        await fetchUnifiedKeys();
      }
    } catch {
      onShowToast('خطا در تغییر مدل', 'error');
    }
  };

  const handleAddCustomServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = newServerKeysText
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k.length > 5);

    if (!newServerBaseUrl.trim()) {
      onShowToast('آدرس سرور (Base URL) الزامی است.', 'error');
      return;
    }
    if (lines.length === 0) {
      onShowToast('حداقل یک کلید API معتبر وارد نمایید.', 'error');
      return;
    }

    setIsSavingCustomServer(true);
    try {
      const res = await fetch('/api/server/custom-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newServerName.trim() || 'سرور سفارشی DeepSeek',
          baseUrl: newServerBaseUrl.trim(),
          model: newServerModel.trim() || 'deepseek-chat',
          apiKeys: lines,
          isEnabled: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || `سرور با ${lines.length} کلید با موفقیت اضافه شد.`, 'success');
        setCustomServersList(data.servers || []);
        setCustomKeysList(data.customKeys || []);
        setNewServerKeysText('');
        setIsAddingNewServer(false);
        await fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در ثبت سرور سفارشی', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    } finally {
      setIsSavingCustomServer(false);
    }
  };

  const handleDeleteCustomServer = async (id: string, name: string) => {
    if (!window.confirm(`آیا از حذف سرور سفارشی «${name}» مطمئن هستید؟`)) return;
    try {
      const res = await fetch(`/api/server/custom-servers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'سرور با موفقیت حذف شد.', 'info');
        setCustomServersList(data.servers || []);
        setCustomKeysList(data.customKeys || []);
        await fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در حذف سرور', 'error');
    }
  };

  const handleToggleCustomServer = async (id: string) => {
    try {
      const res = await fetch(`/api/server/custom-servers/${id}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setCustomServersList(data.servers || []);
        setCustomKeysList(data.customKeys || []);
        await fetchServerKeys();
      }
    } catch {}
  };

  const handleTestCustomServer = async (srv: any, singleKey?: string) => {
    const keyToTest = singleKey || srv.apiKey || (srv.apiKeys && srv.apiKeys[0]);
    if (!keyToTest) {
      onShowToast('کلیدی برای تست یافت نشد.', 'error');
      return;
    }
    setTestingCustomServerId(srv.id || singleKey);
    try {
      const res = await fetch('/api/server/fallback-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'custom',
          key: keyToTest,
          baseUrl: srv.baseUrl,
          model: srv.model,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(`✓ تست موفق سرور «${srv.name || srv.model}»: زمان تاخیر ${data.latencyMs} میلی‌ثانیه`, 'success');
      } else {
        onShowToast(`خطا در تست: ${data.message || data.error || 'عدم پاسخگویی سرور'}`, 'error');
      }
    } catch {
      onShowToast('خطای شبکه در تست سرور سفارشی', 'error');
    } finally {
      setTestingCustomServerId(null);
    }
  };

  // Fetch folders list
  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      if (data.success && Array.isArray(data.folders)) {
        setFolders(data.folders);
      }
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    } finally {
      setLoadingFolders(false);
    }
  };

  // Fetch all projects across all folders (for all_files view)
  const fetchAllProjects = async () => {
    try {
      setLoadingAllProjects(true);
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success && Array.isArray(data.projects)) {
        setAllProjects(data.projects);
      }
    } catch (err) {
      console.error('Failed to fetch all projects:', err);
    } finally {
      setLoadingAllProjects(false);
    }
  };

  // Fetch projects in selected folder
  const fetchProjects = async (folderId: string) => {
    if (!folderId) return;
    setLoadingProjects(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/projects`);
      const data = await res.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  };

  // Fetch worker status
  const fetchWorkerStatus = async () => {
    try {
      const res = await fetch('/api/background/status');
      const data = await res.json();
      if (data.success && data.status) {
        setWorkerStatus(data.status);
      }
    } catch {}
  };

  // Navigation: Enter into folder view
  const handleEnterFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setActiveView('inside_folder');
    fetchProjects(folderId);
  };

  // Navigation: Return to folders grid
  const handleBackToFolders = () => {
    setActiveView('folders_grid');
    setSelectedFolderId('');
    fetchFolders();
  };

  // Initial load
  useEffect(() => {
    fetchFolders();
    fetchAllProjects();
    fetchWorkerStatus();
    fetchServerKeys();
    fetchServerInfo();
    fetchServerConfig();
  }, []);

  // When selected folder changes and we are inside a folder
  useEffect(() => {
    if (selectedFolderId && activeView === 'inside_folder') {
      fetchProjects(selectedFolderId);
    }
  }, [selectedFolderId, activeView]);

  // Polling for live translation updates: lightweight status check every 2.5s, full lists refresh every 15s
  useEffect(() => {
    let tickCount = 0;
    const interval = setInterval(() => {
      tickCount++;
      // 1. Ultra lightweight background status check (~300 bytes) every 2.5s
      fetch('/api/background/status')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.status) {
            setWorkerStatus(data.status);
            // Smoothly sync live progress into current project cards without downloading full DB
            if (Array.isArray(data.status.activeProjects)) {
              const activeMap = new Map<string, { translatedCues: number; totalCues: number; progressPercent: number }>(
                data.status.activeProjects.map((ap: any) => [ap.id, ap])
              );
              setProjects((prev) =>
                prev.map((p) => {
                  const active = activeMap.get(p.id);
                  if (active) {
                    const isComp = p.status === 'completed' || active.translatedCues >= active.totalCues;
                    return {
                      ...p,
                      translatedCues: isComp ? (p.totalCues || active.totalCues) : active.translatedCues,
                      totalCues: active.totalCues,
                      status: isComp ? 'completed' : 'translating',
                    };
                  }
                  return p;
                })
              );
              setAllProjects((prev) =>
                prev.map((p) => {
                  const active = activeMap.get(p.id);
                  if (active) {
                    const isComp = p.status === 'completed' || active.translatedCues >= active.totalCues;
                    return {
                      ...p,
                      translatedCues: isComp ? (p.totalCues || active.totalCues) : active.translatedCues,
                      totalCues: active.totalCues,
                      status: isComp ? 'completed' : 'translating',
                    };
                  }
                  return p;
                })
              );
            }
          }
        })
        .catch(() => {});

      // 2. Full project list & folders count refresh only every 15 seconds (tickCount % 6 === 0)
      // This prevents massive background data usage while keeping the UI synchronized
      if (tickCount % 6 === 0) {
        if (selectedFolderId && activeView === 'inside_folder') {
          fetch(`/api/folders/${selectedFolderId}/projects`)
            .then((res) => res.json())
            .then((data) => {
              if (data.success && Array.isArray(data.projects)) {
                setProjects(data.projects);
              }
            })
            .catch(() => {});
        }
        fetch('/api/folders')
          .then((res) => res.json())
          .then((data) => {
            if (data.success && Array.isArray(data.folders)) {
              setFolders(data.folders);
            }
          })
          .catch(() => {});
        if (activeView === 'all_files') {
          fetch('/api/projects')
            .then((res) => res.json())
            .then((data) => {
              if (data.success && Array.isArray(data.projects)) {
                setAllProjects(data.projects);
              }
            })
            .catch(() => {});
        }
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [selectedFolderId, activeView]);

  // Create Folder Handler: Automatically enters the new folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) {
      onShowToast('لطفاً نام پوشه را وارد کنید.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName, description: newFolderDesc, tone: newFolderTone }),
      });
      const data = await res.json();
      if (data.success && data.folder) {
        setFolders((prev) => [...prev, { ...data.folder, projectCount: 0, completedCount: 0 }]);
        setSelectedFolderId(data.folder.id);
        setActiveView('inside_folder');
        setNewFolderName('');
        setNewFolderDesc('');
        setNewFolderTone('cinematic');
        setIsNewFolderOpen(false);
        onShowToast(`پوشه "${data.folder.name}" ساخته شد و وارد آن شدید. اکنون فایل‌های زیرنویس را آپلود کنید.`, 'success');
      }
    } catch {
      onShowToast('خطا در ایجاد پوشه', 'error');
    }
  };

  // Edit Folder Handler
  const handleEditFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFolderId || !editFolderName.trim()) return;

    try {
      const res = await fetch(`/api/folders/${selectedFolderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editFolderName, description: editFolderDesc, tone: editFolderTone }),
      });
      const data = await res.json();
      if (data.success && data.folder) {
        setFolders((prev) =>
          prev.map((f) => (f.id === selectedFolderId ? { ...f, name: data.folder.name, description: data.folder.description, tone: data.folder.tone } : f))
        );
        setIsEditFolderOpen(false);
        onShowToast('اطلاعات و لحن پوشه به‌روزرسانی شد.', 'success');
        await fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در ویرایش پوشه', 'error');
    }
  };

  // Quick Tone update directly from Folder Header Toolbar
  const handleUpdateFolderTone = async (newTone: ToneOption) => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone: newTone }),
      });
      const data = await res.json();
      if (data.success && data.folder) {
        setFolders((prev) =>
          prev.map((f) => (f.id === selectedFolderId ? { ...f, tone: data.folder.tone } : f))
        );
        onShowToast(`لحن پوشه به «${TONE_OPTIONS.find(t => t.id === newTone)?.labelFa || newTone}» تغییر یافت و بر روی تمام فایل‌های این پوشه اعمال شد.`, 'success');
        await fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در به‌روزرسانی لحن پوشه', 'error');
    }
  };


  // Folder-level Global Find & Replace
  const handleExecuteFolderBatchReplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFolderId || !batchFindText) {
      onShowToast('لطفاً عبارت مورد نظر برای جستجو را وارد کنید.', 'error');
      return;
    }
    setIsExecutingReplace(true);
    setReplaceResult(null);
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/batch-replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findText: batchFindText,
          replaceText: batchReplaceText,
          scope: batchScope,
          matchCase: batchMatchCase,
          wholeWord: batchWholeWord,
          useRegex: batchUseRegex,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReplaceResult(data);
        onShowToast(data.message || `جایگزینی سراسری انجام شد: ${data.totalOccurrences} مورد در ${data.affectedProjectsCount} فایل جایگزین شد.`, 'success');
        await fetchProjects(selectedFolderId);
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در اجرای جایگزینی سراسری', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور برای جایگزینی سراسری', 'error');
    } finally {
      setIsExecutingReplace(false);
    }
  };

  // Delete Folder Handler
  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!window.confirm(`آیا مطمئن هستید که می‌خواهید پوشه "${folderName}" و تمام زیرنویس‌های داخل آن را حذف کنید؟`)) {
      return;
    }

    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
        if (selectedFolderId === folderId) {
          handleBackToFolders();
        }
        onShowToast(`پوشه "${folderName}" حذف شد.`, 'info');
      }
    } catch {
      onShowToast('خطا در حذف پوشه', 'error');
    }
  };

  // Process & Upload files into the target folder
  const processAndUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0 || !selectedFolderId) return;

    const targetFolder = folders.find((f) => f.id === selectedFolderId);
    const folderName = targetFolder?.name || 'پوشه';

    setIsUploading(true);
    const parsedFilesData: Array<{
      name: string;
      format: string;
      rawHeader?: string;
      items: SubtitleItem[];
      sourceLanguage: string;
    }> = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();
        const parsed = parseSubtitleFile(content, file.name);
        if (parsed.items && parsed.items.length > 0) {
          parsedFilesData.push({
            name: file.name,
            format: parsed.format,
            rawHeader: parsed.rawHeader,
            items: parsed.items,
            sourceLanguage: 'auto',
          });
        }
      }

      if (parsedFilesData.length === 0) {
        onShowToast('فایل‌های انتخاب شده حاوی سطرهای زیرنویس معتبر نبودند.', 'error');
        setIsUploading(false);
        return;
      }

      const res = await fetch(`/api/folders/${selectedFolderId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: parsedFilesData,
          targetLanguage: 'fa',
          tone: uploadTone,
          autoQueue: autoQueueOnUpload,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onShowToast(`تعداد ${data.count} فایل زیرنویس با موفقیت به پوشه «${folderName}» اضافه شد.`, 'success');
        await fetchProjects(selectedFolderId);
        await fetchFolders();
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در آپلود فایل‌ها به سرور', 'error');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      onShowToast('خطا در خواندن یا آپلود فایل‌ها به سرور', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle Multi-file Upload into Folder via File Picker
  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processAndUploadFiles(files);
    }
  };

  // Drag and drop handlers for in-folder upload
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processAndUploadFiles(files);
    }
  };

  // Move project to another folder handler
  const handleMoveProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movingProject || !targetMoveFolderId) {
      onShowToast('لطفاً پوشه مقصد را انتخاب کنید.', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/projects/${movingProject.id}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFolderId: targetMoveFolderId }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'فایل با موفقیت به پوشه مقصد انتقال یافت.', 'success');
        setIsMoveModalOpen(false);
        setMovingProject(null);
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchFolders();
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در انتقال فایل', 'error');
      }
    } catch {
      onShowToast('خطا در انتقال فایل', 'error');
    }
  };

  // Start all files in folder
  const handleStartFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'ترجمه پس‌زمینه برای این پوشه آغاز شد.', 'success');
        fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در شروع ترجمه پوشه', 'error');
    }
  };

  // Pause all files in folder
  const handlePauseFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'ترجمه پوشه موقتاً متوقف شد.', 'info');
        fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در متوقف کردن ترجمه پوشه', 'error');
    }
  };

  // Resume all incomplete projects in folder
  const handleResumeFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/resume`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'پروژه‌های ناقص مجدداً در صف ترجمه قرار گرفتند.', 'success');
        fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در ادامه ترجمه پوشه', 'error');
    }
  };

  // Single Project Action Handlers
  const handleStartProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`فایل "${name}" به صف ترجمه پس‌زمینه سرور اضافه شد.`, 'success');
        if (selectedFolderId) fetchProjects(selectedFolderId);
        fetchAllProjects();
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در شروع ترجمه فایل', 'error');
    }
  };

  const handlePauseProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`ترجمه فایل "${name}" متوقف شد.`, 'info');
        if (selectedFolderId) fetchProjects(selectedFolderId);
        fetchAllProjects();
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در توقف ترجمه فایل', 'error');
    }
  };

  const handleResumeProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/resume`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`ادامه ترجمه "${name}" از آخرین سطر باقی‌مانده آغاز شد.`, 'success');
        if (selectedFolderId) fetchProjects(selectedFolderId);
        fetchAllProjects();
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در ازسرگیری ترجمه', 'error');
    }
  };

  const handleRestartProject = async (id: string, name: string, onlyIncomplete: boolean) => {
    const confirmMsg = onlyIncomplete
      ? `سطرهای ترجمه‌نشده یا دارای خطا در فایل "${name}" مجدداً ترجمه خواهند شد (سطرهای ترجمه شده حفظ می‌شوند). ادامه می‌دهید؟`
      : `تمام سطرهای فایل "${name}" پاک شده و از سطر اول مجدداً ترجمه خواهد شد. آیا مطمئنید؟`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/projects/${id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyIncomplete }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'درخواست ترجمه مجدد ثبت شد.', 'success');
        if (selectedFolderId) fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در ترجمه مجدد فایل', 'error');
    }
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (!window.confirm(`آیا از حذف فایل "${name}" مطمئن هستید؟`)) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
        onShowToast(`فایل "${name}" حذف شد.`, 'info');
        fetchFolders();
      }
    } catch {
      onShowToast('خطا در حذف فایل', 'error');
    }
  };

  // Bulk VTT ZIP Download for folder (reliable blob download with error handling)
  const handleDownloadFolderVTTZip = async () => {
    if (!selectedFolderId) return;
    const targetFolder = folders.find((f) => f.id === selectedFolderId);
    const folderName = targetFolder?.name || 'Subtitles';
    setIsZippingFolder(true);
    onShowToast('در حال آماده‌سازی و دانلود بسته زیپ VTT...', 'info');

    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/export/vtt`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'خطا در دریافت فایل ZIP از سرور');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folderName}_VTT.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      onShowToast('دانلود خروجی گروهی VTT با موفقیت انجام شد.', 'success');
    } catch (err: any) {
      console.error('Download VTT ZIP Error:', err);
      onShowToast(err?.message || 'خطا در دانلود خروجی گروهی VTT', 'error');
    } finally {
      setIsZippingFolder(false);
    }
  };

  // Bulk SRT ZIP Download for folder (reliable blob download with error handling)
  const handleDownloadFolderSRTZip = async () => {
    if (!selectedFolderId) return;
    const targetFolder = folders.find((f) => f.id === selectedFolderId);
    const folderName = targetFolder?.name || 'Subtitles';
    setIsZippingSRT(true);
    onShowToast('در حال آماده‌سازی و دانلود بسته زیپ SRT...', 'info');

    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/export/srt`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'خطا در دریافت فایل ZIP از سرور');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folderName}_SRT.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      onShowToast('دانلود خروجی گروهی SRT با موفقیت انجام شد.', 'success');
    } catch (err: any) {
      console.error('Download SRT ZIP Error:', err);
      onShowToast(err?.message || 'خطا در دانلود خروجی گروهی SRT', 'error');
    } finally {
      setIsZippingSRT(false);
    }
  };

  // Global Emergency Stop: pause all translations across all folders immediately
  const [isStoppingAll, setIsStoppingAll] = useState(false);
  const handleStopAllTranslations = async () => {
    setIsStoppingAll(true);
    try {
      const res = await fetch('/api/worker/pause-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'تمام عملیات ترجمه با موفقیت متوقف شد.', 'info');
        await fetchFolders();
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
        await fetchWorkerStatus();
      } else {
        onShowToast(data.error || 'خطا در متوقف کردن ترجمه‌ها', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور برای توقف ترجمه‌ها', 'error');
    } finally {
      setIsStoppingAll(false);
    }
  };

  // Global Resume: resume all paused translations across all folders
  const [isResumingAll, setIsResumingAll] = useState(false);
  const handleResumeAllTranslations = async () => {
    setIsResumingAll(true);
    try {
      const res = await fetch('/api/worker/resume-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'تمام پروژه‌ها برای ادامه ترجمه به صف اضافه شدند.', 'success');
        await fetchFolders();
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در ازسرگیری ترجمه‌ها', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور برای ادامه ترجمه‌ها', 'error');
    } finally {
      setIsResumingAll(false);
    }
  };

  // Turbo Complete: Instantly resolves audio tags and prioritizes 90%+ incomplete files to finish within seconds
  const [isTurboCompleting, setIsTurboCompleting] = useState(false);
  const handleTurboComplete = async () => {
    setIsTurboCompleting(true);
    try {
      const res = await fetch('/api/worker/turbo-complete', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'حالت توربو فعال شد: فایل‌های دارای سطر ناقص با اولویت فوری در صف قرار گرفتند.', 'success');
        await fetchFolders();
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در فعال‌سازی توربو', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور برای حالت توربو', 'error');
    } finally {
      setIsTurboCompleting(false);
    }
  };

  // Safe Clear Cache: Clears stuck locks, key exhaustion cooldowns, and re-queues incomplete files WITHOUT deleting subtitles
  const [isClearingCache, setIsClearingCache] = useState(false);
  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      const res = await fetch('/api/worker/clear-cache', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کش، قفل‌ها و وقفه‌های کلیدها پاکسازی شدند (همه زیرنویس‌ها محفوظ ماندند).', 'success');
        await fetchFolders();
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
        await fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در پاکسازی کش سرور', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور برای پاکسازی کش', 'error');
    } finally {
      setIsClearingCache(false);
    }
  };

  // Full Database Backup Download
  const handleDownloadBackup = () => {
    const link = document.createElement('a');
    link.href = '/api/backup';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast('دانلود نسخه پشتیبان کامل دیتابیس سرور آغاز شد...', 'info');
  };

  // Restore Database from Backup
  const handleRestoreSubmit = async (jsonString: string) => {
    if (!jsonString.trim()) {
      onShowToast('لطفاً محتوای فایل پشتیبان را وارد کنید.', 'error');
      return;
    }
    setIsRestoring(true);
    try {
      const blob = new Blob([jsonString], { type: 'application/octet-stream' });
      const res = await fetch('/api/backup/restore-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'دیتابیس با موفقیت بازگردانی شد.', 'success');
        setIsRestoreModalOpen(false);
        setRestoreJsonText('');
        await fetchFolders();
        if (selectedFolderId) {
          await fetchProjects(selectedFolderId);
        }
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در بازیابی نسخه پشتیبان', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور برای بازیابی', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  // Streaming File upload for restore: handles files of any size (e.g. 176MB) smoothly without memory freeze
  const handleRestoreFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRestoring(true);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    onShowToast(`در حال استریم و بازیابی فایل نسخه پشتیبان (${sizeMb} مگابایت) به سرور... لطفاً کمی شکیبا باشید.`, 'info');
    try {
      const res = await fetch('/api/backup/restore-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || `دیتابیس سرور با موفقیت از فایل ${file.name} بازیابی شد.`, 'success');
        setIsRestoreModalOpen(false);
        setRestoreJsonText('');
        await fetchFolders();
        if (selectedFolderId) {
          await fetchProjects(selectedFolderId);
        }
        await fetchAllProjects();
      } else {
        onShowToast(data.error || 'خطا در بازیابی دیتابیس', 'error');
      }
    } catch (err: any) {
      onShowToast('خطا در ارسال فایل پشتیبان: ' + (err?.message || 'قطع ارتباط'), 'error');
    } finally {
      setIsRestoring(false);
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
    }
  };

  // Direct Server-Side Key Ping Test
  const handleTestServerKey = async (specificKey?: string) => {
    setIsTestingKey(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/server/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: specificKey || undefined }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        onShowToast(`تست کلید موفق بود: تاخیر ${data.latencyMs}ms با مدل فوق‌سریع Gemini 3.1 Flash Lite`, 'success');
      } else {
        onShowToast(`نتیجه تست کلید: ${data.message || 'خطا'}`, 'error');
      }
      fetchServerKeys();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'خطا در ارتباط با سرور هنگام تست کلید',
      });
      onShowToast('خطا در تست کلید از روی سرور', 'error');
    } finally {
      setIsTestingKey(false);
    }
  };

  // Save server keys (batch)
  const handleSaveServerKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = serverKeysText
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k.length > 5);

    if (lines.length === 0) {
      onShowToast('هیچ کلید معتبری وارد نشد.', 'error');
      return;
    }

    const modelToSet = batchKeyModel === 'custom' ? customKeyModelInput.trim() : batchKeyModel;

    try {
      const res = await fetch('/api/server/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: lines, mode: keySaveMode, model: modelToSet }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلیدها با موفقیت در سرور ثبت شدند.', 'success');
        setServerKeysText('');
        fetchServerKeys();
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در ذخیره کلیدهای سرور', 'error');
    }
  };

  // Batch delete selected server keys or delete all
  const handleBatchDeleteKeys = async (deleteAll = false) => {
    if (!deleteAll && selectedKeyIndices.length === 0) {
      onShowToast('لطفاً حداقل یک کلید را برای حذف انتخاب کنید.', 'error');
      return;
    }
    const confirmMsg = deleteAll
      ? 'آیا مطمئن هستید که می‌خواهید تمام کلیدهای استخر سرور را حذف کنید؟'
      : `آیا از حذف ${selectedKeyIndices.length} کلید انتخاب‌شده مطمئن هستید؟`;
    if (!window.confirm(confirmMsg)) return;

    setIsBatchDeletingKeys(true);
    try {
      const res = await fetch('/api/server/keys/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indices: selectedKeyIndices, deleteAll }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'حذف کلیدها با موفقیت انجام شد.', 'info');
        setSelectedKeyIndices([]);
        await fetchServerKeys();
        await fetchWorkerStatus();
      } else {
        onShowToast(data.error || 'خطا در حذف کلیدها', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور برای حذف کلیدها', 'error');
    } finally {
      setIsBatchDeletingKeys(false);
    }
  };

  // Batch change active model for server keys
  const handleChangePoolModel = async (modelToApply: string) => {
    const targetModel = modelToApply === 'custom' ? customKeyModelInput.trim() : modelToApply;
    if (!targetModel) {
      onShowToast('لطفاً نام مدل را وارد کنید.', 'error');
      return;
    }
    setIsChangingPoolModel(true);
    try {
      const res = await fetch('/api/server/keys/change-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: targetModel }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || `مدل استخر با موفقیت به «${targetModel}» تغییر یافت.`, 'success');
        setBatchKeyModel(targetModel);
        await fetchWorkerStatus();
      } else {
        onShowToast(data.error || 'خطا در تغییر مدل استخر', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور برای تغییر مدل استخر', 'error');
    } finally {
      setIsChangingPoolModel(false);
    }
  };

  // Save Fallback AI Configuration (OpenAI, Claude, Custom)
  const handleSaveFallbackConfig = async () => {
    setIsSavingFallback(true);
    try {
      const payload = {
        openaiKeys: openaiKeysText.split('\n').map((k) => k.trim()).filter(Boolean),
        openaiModel: fallbackConfig.openaiModel || 'gpt-4o-mini',
        claudeKeys: claudeKeysText.split('\n').map((k) => k.trim()).filter(Boolean),
        claudeModel: fallbackConfig.claudeModel || 'claude-3-5-haiku-20241022',
        customConfig: {
          baseUrl: customBaseUrl.trim(),
          apiKey: customApiKey.trim(),
          model: customModel.trim() || 'deepseek-chat',
          name: customProviderName.trim() || 'سرویس سفارشی',
        },
        providerStrategy: fallbackConfig.providerStrategy || 'lowest_ping',
        priorityOrder: providerPriorityOrder,
      };
      const res = await fetch('/api/server/fallback-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setFallbackConfig(data.config);
        onShowToast(data.message || 'تنظیمات هوش‌های پشتیبان ذخیره شد.', 'success');
      } else {
        onShowToast(data.error || 'خطا در ذخیره هوش‌های پشتیبان', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    } finally {
      setIsSavingFallback(false);
    }
  };

  // Test Fallback Provider Key (OpenAI, Claude, Custom)
  const handleTestFallbackKey = async (provider: 'openai' | 'claude' | 'custom') => {
    setIsTestingFallback(true);
    setFallbackTestResult(null);
    try {
      let key = '';
      let baseUrl = '';
      let model = '';
      if (provider === 'openai') {
        key = (openaiKeysText.split('\n').map((k) => k.trim()).filter(Boolean)[0]) || '';
        model = fallbackConfig.openaiModel || 'gpt-4o-mini';
      } else if (provider === 'claude') {
        key = (claudeKeysText.split('\n').map((k) => k.trim()).filter(Boolean)[0]) || '';
        model = fallbackConfig.claudeModel || 'claude-3-5-haiku-20241022';
      } else {
        key = customApiKey.trim();
        baseUrl = customBaseUrl.trim();
        model = customModel.trim() || 'deepseek-chat';
      }

      if (!key) {
        onShowToast(`لطفاً ابتدا حداقل یک کلید برای ${provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'سرویس سفارشی'} وارد کنید.`, 'error');
        setIsTestingFallback(false);
        return;
      }

      const res = await fetch('/api/server/fallback-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key, baseUrl, model }),
      });
      const data = await res.json();
      setFallbackTestResult(data);
      if (data.success) {
        onShowToast(data.message, 'success');
      } else {
        onShowToast(data.message || 'خطا در تست کلید', 'error');
      }
    } catch (err: any) {
      setFallbackTestResult({ success: false, message: err?.message || 'خطای شبکه' });
      onShowToast('خطا در تست اتصال', 'error');
    } finally {
      setIsTestingFallback(false);
    }
  };

  // Reset Cooldown for all keys
  const handleResetAllCooldowns = async () => {
    try {
      const res = await fetch('/api/server/keys/reset-cooldowns', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'تمام کلیدها از حالت وقفه خارج شده و فوراً فعال شدند.', 'success');
        fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در فعال‌سازی کلیدها', 'error');
    }
  };

  // Reset Cooldown for a single key
  const handleResetSingleCooldown = async (index: number) => {
    try {
      const res = await fetch(`/api/server/keys/${index}/reset-cooldown`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلید مورد نظر فوراً فعال شد.', 'success');
        fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در رفع وقفه کلید', 'error');
    }
  };

  // Reset all key usage statistics
  const handleResetKeyStats = async () => {
    if (!window.confirm('آیا از ریست کردن آمار مصرف توکن‌ها برای تمام کلیدها اطمینان دارید؟')) return;
    try {
      const res = await fetch('/api/server/keys/stats', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast('آمار مصرف توکن‌های کلیدها بازنشانی شد.', 'info');
        fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در ریست آمار مصرف', 'error');
    }
  };

  // Edit single key
  const handleUpdateSingleKey = async (index: number) => {
    if (!editingKeyVal.trim()) {
      onShowToast('کلید جدید نمی‌تواند خالی باشد.', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/server/keys/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: editingKeyVal.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(`کلید #${index + 1} با موفقیت ویرایش شد.`, 'success');
        setEditingKeyIndex(null);
        setEditingKeyVal('');
        fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در ویرایش کلید', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور', 'error');
    }
  };

  // Delete single key
  const handleDeleteSingleKey = async (index: number) => {
    if (!window.confirm(`آیا از حذف کلید شماره #${index + 1} از استخر سرور اطمینان دارید؟`)) return;
    try {
      const res = await fetch(`/api/server/keys/${index}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`کلید #${index + 1} حذف شد.`, 'info');
        fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در حذف کلید', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    }
  };

  // Save Server Configuration (ALLOWED_ORIGIN, GEMINI_BASE_URL, maxConcurrentProjects)
  const handleSaveServerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/server/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverConfig),
      });
      const data = await res.json();
      if (data.success) {
        setServerConfig(data.config);
        setIsServerConfigOpen(false);
        onShowToast('تنظیمات سرور و پراکسی با موفقیت ذخیره شد.', 'success');
      } else {
        onShowToast(data.error || 'خطا در ذخیره تنظیمات', 'error');
      }
    } catch {
      onShowToast('خطا در اتصال به سرور', 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      
      {/* Autonomous Background Banner */}
      <div className="w-full bg-gradient-to-br from-indigo-950/90 via-slate-900/95 to-slate-950 border border-indigo-500/30 rounded-2xl p-4 sm:p-5 shadow-xl shadow-indigo-950/20 backdrop-blur-md flex flex-col gap-4 overflow-hidden">
        {/* Top Header Row: Icon, Title & Status Badges */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/30 shrink-0 mt-0.5 sm:mt-0">
              <Server className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white">
                  موتور دیتابیس و ترجمه مستقل در پس‌زمینه سرور
                </h2>
                <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Gemini 3.1 Flash Lite (موتور فوق‌سریع)
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                  <Database className="w-3 h-3 text-cyan-400" />
                  <span className="truncate max-w-[200px] sm:max-w-xs">{serverInfo?.databasePath || 'data/subtitles_db.json'}</span>
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                ترجمه کاملاً خودکار روی سرور مجازی (VPS) اجرا می‌شود و با بستن مرورگر متوقف نمی‌شود. موازی‌سازی با کلیدهای مجزا، کنترل دقیق نرخ و حفظ ۱۰۰٪ سطرها فعال است.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls Toolbar - Clean, Essential Controls */}
        <div className="w-full pt-3.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleResumeAllTranslations}
              disabled={isResumingAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50 active:scale-98"
              title="شروع و ادامه ترجمه تمام فایل‌ها در صف سرور به صورت خودکار و مستقل در پس‌زمینه"
            >
              {isResumingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 text-white fill-current" />}
              <span>شروع / ادامه ترجمه تمام فایل‌ها</span>
            </button>

            <button
              type="button"
              onClick={handleStopAllTranslations}
              disabled={isStoppingAll}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-500/40 shadow-xs transition-all cursor-pointer disabled:opacity-50 active:scale-98"
              title="توقف موقت عملیات ترجمه در تمامی پوشه‌ها و فایل‌ها (سطرهای ترجمه شده ۱۰۰٪ حفظ می‌شوند)"
            >
              {isStoppingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5 text-rose-400" />}
              <span>توقف ترجمه‌ها</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Backup & Restore Controls */}
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 text-cyan-300 hover:bg-slate-800 hover:text-cyan-200 border border-cyan-500/30 transition-colors shadow-xs cursor-pointer active:scale-98"
              title="دانلود فایل پشتیبان کامل دیتابیس سرور شامل تمام پروژه‌ها و زیرنویس‌ها"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>پشتیبان‌گیری (Backup)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsRestoreModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 text-amber-300 hover:bg-slate-800 hover:text-amber-200 border border-amber-500/30 transition-colors shadow-xs cursor-pointer active:scale-98"
              title="بازیابی و وارد کردن کل دیتابیس از فایل JSON پشتیبان"
            >
              <UploadCloud className="w-3.5 h-3.5 text-amber-400" />
              <span>بازیابی بکاپ (Restore)</span>
            </button>

            <span className="hidden sm:inline-block w-px h-5 bg-slate-800 mx-0.5" />

            <button
              type="button"
              onClick={() => {
                void fetchUnifiedKeys();
                fetchServerKeys();
                setIsKeysModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors shadow-xs cursor-pointer active:scale-98"
              title="مدیریت استخر یکپارچه کلیدهای هوش مصنوعی و تست سلامت"
            >
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>استخر کلیدها ({unifiedKeysList.length > 0 ? unifiedKeysList.length : serverKeysCount} فعال)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                fetchServerConfig();
                setIsServerConfigOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 text-violet-300 hover:bg-slate-800 hover:text-violet-200 border border-violet-500/30 transition-colors shadow-xs cursor-pointer active:scale-98"
              title="تنظیمات دامنه مجاز (ALLOWED_ORIGIN)، پراکسی و تعداد فایل همزمان"
            >
              <Settings className="w-3.5 h-3.5 text-violet-400" />
              <span>تنظیمات سرور</span>
            </button>
          </div>
        </div>
      </div>

      {/* Concise Folder-Based Translation Manager & 6-File Concurrency Controller */}
      {(() => {
        const filesConcurrency = serverConfig.maxConcurrentProjects || 6;

        // Determine current targeted folder: either the one we entered (activeView === 'inside_folder'),
        // or the folder currently being processed by worker, or the first available folder.
        const activeRunningFolderId = workerStatus?.folderId || (workerStatus?.activeProjects?.[0]?.folderId);
        const currentFolder = activeView === 'inside_folder' && selectedFolder
          ? selectedFolder
          : (activeRunningFolderId ? folders.find((f) => f.id === activeRunningFolderId) : folders[0]);

        // Projects belonging to this folder context
        const currentFolderProjects = currentFolder
          ? (activeView === 'inside_folder' ? projects : allProjects.filter((p) => p.folderId === currentFolder.id))
          : allProjects;

        // Count incomplete or untranslated files in this folder
        const folderIncompleteOrUntranslated = currentFolderProjects.filter((p) => {
          const isComp = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
          if (isComp) return false;
          const remaining = p.totalCues > 0 ? (p.totalCues - p.translatedCues) : 0;
          return remaining > 0;
        });

        // Reserve keys count
        const reserveKeysCount = workerStatus?.reserveKeysCount !== undefined
          ? workerStatus.reserveKeysCount
          : Math.max(0, serverKeysCount - (workerStatus?.inFlightKeyThreads || 0));

        // Sort folder projects for crisp display:
        // 1. Translating now
        // 2. Incomplete with progress / errors
        // 3. Untranslated queued
        // 4. Completed
        const sortedDisplayProjects = [...currentFolderProjects].sort((a, b) => {
          const isTranslatingA = a.status === 'translating' || workerStatus?.activeProjects?.some((ap) => ap.id === a.id);
          const isTranslatingB = b.status === 'translating' || workerStatus?.activeProjects?.some((ap) => ap.id === b.id);
          if (isTranslatingA && !isTranslatingB) return -1;
          if (!isTranslatingA && isTranslatingB) return 1;

          const isCompA = a.status === 'completed' || (a.totalCues > 0 && a.translatedCues >= a.totalCues);
          const isCompB = b.status === 'completed' || (b.totalCues > 0 && b.translatedCues >= b.totalCues);
          if (!isCompA && isCompB) return -1;
          if (isCompA && !isCompB) return 1;

          // Priority files first
          if (Boolean(a.isPriority) !== Boolean(b.isPriority)) {
            return a.isPriority ? -1 : 1;
          }

          // Incomplete files with fewer remaining cues first
          const remA = a.totalCues > 0 ? a.totalCues - a.translatedCues : 0;
          const remB = b.totalCues > 0 ? b.totalCues - b.translatedCues : 0;
          return remA - remB;
        });

        return (
          <div className="w-full bg-slate-900/95 border border-indigo-500/35 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-2xl text-xs backdrop-blur-md">
            {/* Live Diagnostic Banner: علت عدم پیشرفت یا اتمام سهمیه روزانه */}
            {workerStatus?.stuckReason && (
              <div className="p-4 rounded-2xl bg-rose-500/10 dark:bg-rose-950/40 border border-rose-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-900 dark:text-rose-200 animate-slide-up shadow-sm">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
                      <span>⚠️ علت توقف پیشرفت ترجمه زیرنویس‌ها:</span>
                      {workerStatus.dailyExhaustedKeys && workerStatus.dailyExhaustedKeys > 0 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-rose-600 text-white font-sans font-bold">
                          اتمام سهمیه روزانه ({workerStatus.dailyExhaustedKeys} کلید)
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs mt-1 leading-relaxed text-rose-200 font-medium">{workerStatus.stuckReason}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void fetchUnifiedKeys();
                      fetchServerKeys();
                      setIsKeysModalOpen(true);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>مدیریت کلیدها</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    disabled={isClearingCache}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                    title="پاکسازی کش سرور، رفع قفل‌ها و امتحان مجدد بدون حذف زیرنویس‌ها"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isClearingCache ? 'animate-spin' : ''}`} />
                    <span>پاکسازی کش و تست مجدد</span>
                  </button>
                </div>
              </div>
            )}

            {/* Top Bar: Concurrency Config & Single Primary CTA */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              
              {/* Concurrency Selector with 6 files default */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
                <span className="font-bold text-white flex items-center gap-2 shrink-0 text-sm">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>تعداد فایل‌های همزمان:</span>
                </span>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 4, 6, 8, 10, 12].map((num) => {
                    const isSelected = filesConcurrency === num;
                    const isDefault = num === 2;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleSetDualConcurrency(num, serverConfig.maxKeysPerProject || 2)}
                        className={`relative px-3 py-1.5 rounded-xl font-mono font-bold text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/40 border border-indigo-400 scale-105'
                            : 'bg-slate-800/90 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700/70'
                        }`}
                        title={`ترجمه همزمان ${num} فایل`}
                      >
                        <span>{num} فایل</span>
                        {isDefault && (
                          <span className={`absolute -top-2 -right-1 text-[9px] font-sans px-1 py-0.2 rounded-full font-extrabold ${
                            isSelected ? 'bg-amber-400 text-slate-950' : 'bg-indigo-950 text-amber-300 border border-amber-500/50'
                          }`}>
                            توصیه
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Manual Concurrency Input */}
                  <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-700/80 rounded-xl px-2 py-1">
                    <span className="text-[11px] text-slate-400 font-medium">تعداد دلخواه:</span>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={customConcurrentInput}
                      onChange={(e) => setCustomConcurrentInput(e.target.value)}
                      placeholder="۲"
                      className="w-12 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-0.5 text-xs text-amber-300 font-mono text-center focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = parseInt(customConcurrentInput, 10);
                        if (!isNaN(val) && val >= 1) handleSetDualConcurrency(val, serverConfig.maxKeysPerProject || 2);
                      }}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
                      title="تنظیم دقیق تعداد فایل‌های همزمان"
                    >
                      اعمال
                    </button>
                  </div>
                </div>
              </div>

              {/* Primary Action Buttons: "ترجمه فایل‌های ناقص" AND "🛑 توقف کامل تمام ترجمه‌ها" */}
              <div className="flex items-center gap-2.5 shrink-0 self-start lg:self-center flex-wrap">
                <button
                  type="button"
                  onClick={() => handleRetryIncomplete(currentFolder?.id)}
                  disabled={isRetryingIncomplete}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs transition-all cursor-pointer shadow-xl ${
                    folderIncompleteOrUntranslated.length > 0
                      ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 text-slate-950 hover:brightness-110 shadow-amber-500/30 ring-2 ring-amber-400/50 scale-[1.02]'
                      : 'bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 border border-indigo-500/40'
                  }`}
                  title="شروع ترجمه فایل‌های ناقص یا ترجمه‌نشده این پوشه با اولویت بالا"
                >
                  {isRetryingIncomplete ? (
                    <Loader2 className="w-4 h-4 animate-spin text-current" />
                  ) : (
                    <Zap className="w-4 h-4 fill-current text-current" />
                  )}
                  <span>⚡ ترجمه فایل‌های ناقص یا ترجمه‌نشده</span>
                  {folderIncompleteOrUntranslated.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-950 text-amber-300 border border-amber-400/60 font-bold">
                      {folderIncompleteOrUntranslated.length} فایل
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleRestartFolderFromScratch(currentFolder?.id, currentFolder?.name)}
                  disabled={isRestartingFolder}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 hover:border-amber-400 cursor-pointer transition-all shadow-lg shadow-amber-500/10"
                  title="پاکسازی تمام ترجمه‌های قبلی این پوشه و شروع ترجمه مجدد از ابتدا (۰٪) با موتور تمیز - بدون نیاز به آپلود مجدد فایل‌ها"
                >
                  {isRestartingFolder ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  ) : (
                    <RotateCcw className="w-4 h-4 text-amber-400" />
                  )}
                  <span>🔄 ترجمه مجدد پوشه از صفر</span>
                </button>

                <button
                  type="button"
                  onClick={handleStopAllTranslations}
                  disabled={isStoppingAll}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 border border-rose-400/40 cursor-pointer transition-all"
                  title="توقف فوری و کامل تمام ترجمه‌ها در تمامی پوشه‌ها و فایل‌ها (سطرهای ترجمه‌شده قبلی ۱۰۰٪ حفظ می‌شوند)"
                >
                  {isStoppingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <StopCircle className="w-4 h-4 text-white fill-current" />
                  )}
                  <span>🛑 توقف کامل تمام ترجمه‌ها</span>
                </button>
              </div>
            </div>

            {/* Folder Isolation Banner & Key Pool Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  <span>پوشه فعال:</span>
                  <span className="text-white bg-slate-800 px-2.5 py-0.5 rounded-lg border border-slate-700">
                    {currentFolder?.name || 'انتخاب‌نشده'}
                  </span>
                </div>

                <span className="text-slate-600">|</span>

                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 font-semibold">قانون جداسازی پوشه‌ای:</span>
                  <span className="text-slate-400">
                    تا پایان کامل فایل‌های این پوشه، سرور خودکار وارد پوشه بعدی نخواهد شد.
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                <span className="bg-indigo-950/70 border border-indigo-500/40 text-indigo-300 px-2.5 py-1 rounded-lg">
                  🔥 {filesConcurrency} فایل همزمان ({filesConcurrency} کلید فعال)
                </span>
                <span className="bg-amber-950/60 border border-amber-500/40 text-amber-300 px-2.5 py-1 rounded-lg" title="به محض اتمام هر فایل یا بروز محدودیت نرخ، کلید بعدی از رزرو جایگزین می‌شود">
                  🛡️ {reserveKeysCount} کلید رزرو
                </span>
              </div>
            </div>

            {/* Live Active Online Translation Monitor: کدوم یکی در حال ترجمه است */}
            {(() => {
              const activeList = workerStatus?.activeProjects || [];

              return (
                <div className={`rounded-2xl p-4 border transition-all flex flex-col gap-3 shadow-lg ${
                  activeList.length > 0
                    ? 'bg-slate-950/95 border-emerald-500/50 shadow-emerald-950/40 ring-1 ring-emerald-500/30'
                    : 'bg-slate-950/70 border-slate-800'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {activeList.length > 0 ? (
                        <span className="relative flex h-3.5 w-3.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                        </span>
                      ) : (
                        <span className="h-3 w-3 rounded-full bg-slate-600 inline-block"></span>
                      )}
                      <span className="font-extrabold text-sm sm:text-base text-white">
                        کدوم یکی در حال ترجمه است؟
                      </span>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        activeList.length > 0
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {activeList.length > 0
                          ? `🟢 هم‌اکنون ${activeList.length} فایل فعال`
                          : 'هیچ فایلی فعال نیست'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="bg-emerald-950/90 text-emerald-300 px-3 py-1 rounded-lg border border-emerald-500/40 font-bold flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        <span>ترجمه آنلاین همزمان: {activeList.length} از {filesConcurrency} کلید</span>
                      </span>
                    </div>
                  </div>

                  {/* زیرش بنویس اون‌هایی که فعال هستند در حال ترجمه آنلاین */}
                  <div className="flex flex-col gap-2.5">
                    <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span>فایل‌های فعال در حال ترجمه آنلاین (با پیشرفت لحظه‌ای):</span>
                      </span>
                      {activeList.length > 0 && (
                        <span className="text-[11px] font-mono text-slate-400">
                          هر فایل با ۱ کلید اختصاصی مجزا پردازش می‌شود
                        </span>
                      )}
                    </div>

                    {activeList.length === 0 ? (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-900/60 rounded-xl border border-slate-800/80 text-xs text-slate-400">
                        <div className="flex items-center gap-2.5">
                          <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>در حال حاضر هیچ فایلی به صورت آنلاین در حال ترجمه نیست.</span>
                        </div>
                        {folderIncompleteOrUntranslated.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleRetryIncomplete(currentFolder?.id)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer shadow-xs shrink-0"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>شروع آنلاین ترجمه {folderIncompleteOrUntranslated.length} فایل این پوشه</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activeList.map((ap) => {
                          const folderObj = folders.find((f) => f.id === ap.folderId);
                          const folderName = folderObj?.name || 'پوشه جاری';
                          const remainingCues = Math.max(0, ap.totalCues - ap.translatedCues);

                          return (
                            <div
                              key={ap.id}
                              className="bg-slate-900/95 border-2 border-emerald-500/60 hover:border-emerald-400 rounded-xl p-3 flex flex-col gap-2.5 shadow-md shadow-emerald-950/20 relative overflow-hidden"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-bold text-white text-xs truncate max-w-[170px] sm:max-w-[210px]" title={ap.name}>
                                      {ap.name}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono truncate">
                                      📁 {folderName}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-bold">
                                    {ap.keyMasked || 'کلید اختصاصی'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handlePauseProject(ap.id, ap.name)}
                                    className="p-1 rounded-md bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 cursor-pointer"
                                    title="توقف موقت این فایل"
                                  >
                                    <Pause className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                                <div
                                  className="bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400 h-full rounded-full transition-all duration-300"
                                  style={{ width: `${Math.max(5, ap.progressPercent)}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between text-[10px] font-mono">
                                <span className="text-emerald-300 font-bold">
                                  سطر {ap.translatedCues} از {ap.totalCues} ({ap.progressPercent}%)
                                </span>
                                <span className="text-slate-400">
                                  {remainingCues} سطر مانده
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Clean File List of this Folder */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-semibold">
                <span>سایر فایل‌های این پوشه ({sortedDisplayProjects.length} فایل):</span>
                <span>
                  {folderIncompleteOrUntranslated.length > 0 ? (
                    <span className="text-amber-400 font-bold">{folderIncompleteOrUntranslated.length} فایل نیازمند ترجمه</span>
                  ) : (
                    <span className="text-emerald-400 font-bold">تمام فایل‌های این پوشه ترجمه شده‌اند ✓</span>
                  )}
                </span>
              </div>

              {sortedDisplayProjects.length === 0 ? (
                <div className="text-center py-8 text-slate-500 bg-slate-950/40 border border-slate-800/80 rounded-xl flex flex-col items-center gap-2">
                  <Folder className="w-8 h-8 text-slate-600" />
                  <p>هیچ فایلی در این پوشه ثبت نشده است.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                  {sortedDisplayProjects.map((p) => {
                    const activeItem = workerStatus?.activeProjects?.find((ap) => ap.id === p.id);
                    const isTranslating = Boolean(activeItem);
                    const isCompleted = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
                    const isPaused = p.status === 'paused';
                    const pct = activeItem
                      ? activeItem.progressPercent
                      : (p.totalCues > 0 ? Math.floor((p.translatedCues / p.totalCues) * 100) : 0);
                    const transCues = activeItem ? activeItem.translatedCues : p.translatedCues;
                    const totCues = activeItem ? activeItem.totalCues : p.totalCues;
                    const remaining = Math.max(0, totCues - transCues);
                    const keyMask = activeItem?.keyMasked;

                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl p-3 flex flex-col gap-2 border transition-all ${
                          isTranslating
                            ? 'bg-slate-900 border-amber-500/70 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/30'
                            : isCompleted
                            ? 'bg-slate-950/80 border-emerald-500/25 hover:border-emerald-500/40'
                            : isPaused
                            ? 'bg-slate-950/60 border-slate-800 text-slate-400'
                            : Boolean(p.isPriority)
                            ? 'bg-slate-900 border-rose-500/40 shadow-xs'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {isTranslating ? (
                              <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                            ) : isCompleted ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : isPaused ? (
                              <Pause className="w-4 h-4 text-slate-500 shrink-0" />
                            ) : Boolean(p.isPriority) ? (
                              <Zap className="w-4 h-4 text-rose-400 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
                            )}
                            <span className="font-bold text-white text-xs truncate max-w-[200px] sm:max-w-[260px]" title={p.name}>
                              {p.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {keyMask && isTranslating && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                                {keyMask}
                              </span>
                            )}
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                              isTranslating
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                : isCompleted
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : isPaused
                                ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                : remaining > 0 && transCues > 0
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {isTranslating
                                ? `در حال ترجمه (${pct}%)`
                                : isCompleted
                                ? 'تکمیل شده (۱۰۰٪)'
                                : isPaused
                                ? `متوقف (${remaining} سطر مانده)`
                                : remaining > 0 && transCues > 0
                                ? `در صف سرور (${remaining} سطر مانده)`
                                : 'در صف ترجمه'}
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800/80">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isCompleted
                                ? 'bg-emerald-500'
                                : isTranslating
                                ? 'bg-gradient-to-r from-amber-500 via-indigo-500 to-amber-400'
                                : 'bg-indigo-600/70'
                            }`}
                            style={{ width: `${Math.max(isCompleted ? 100 : (transCues > 0 ? 5 : 0), pct)}%` }}
                          />
                        </div>

                        {/* Stats & Direct Action Button */}
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/60">
                          <span className="text-slate-400 font-mono text-[10px]">
                            {transCues} از {totCues} سطر
                            {remaining > 0 && !isCompleted && ` (${remaining} سطر باقی‌مانده)`}
                          </span>

                          <div className="flex items-center gap-1.5">
                            {isTranslating ? (
                              <button
                                type="button"
                                onClick={() => handlePauseProject(p.id, p.name)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer transition-colors"
                                title="توقف موقت ترجمه این فایل"
                              >
                                <Pause className="w-3 h-3" />
                                <span>توقف</span>
                              </button>
                            ) : isCompleted ? (
                              <a
                                href={`/api/projects/${p.id}/export/srt`}
                                download
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30"
                                title="دانلود زیرنویس SRT"
                              >
                                <Download className="w-3 h-3" />
                                <span>SRT</span>
                              </a>
                            ) : isPaused ? (
                              <button
                                type="button"
                                onClick={() => handleResumeProject(p.id, p.name)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition-colors shadow-xs"
                                title="ادامه ترجمه این فایل"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>ادامه</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePauseProject(p.id, p.name)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer transition-colors"
                                title="خروج از صف و توقف"
                              >
                                <Pause className="w-3 h-3" />
                                <span>توقف</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Live Worker Parallel Activity Bar if translating */}
      {workerStatus?.activeProjects && workerStatus.activeProjects.length > 0 && (
        <div className="w-full bg-gradient-to-r from-amber-500/15 via-indigo-950/40 to-amber-500/15 border border-amber-500/30 rounded-xl p-3.5 flex flex-col gap-2.5 text-xs text-amber-200 shadow-md">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              <span className="font-bold text-amber-300">
                در حال ترجمه موازی در سرور ({workerStatus.activeProjects.length} از حداکثر {workerStatus.maxConcurrentProjects} پردازش همزمان فعال):
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleStopAllTranslations}
                disabled={isStoppingAll}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-600/40 text-rose-200 hover:bg-rose-600/60 border border-rose-500/50 cursor-pointer transition-colors shadow-xs"
                title="توقف تمام ترجمه‌های فعال"
              >
                <StopCircle className="w-3.5 h-3.5 text-rose-300" />
                <span>توقف فوری همه</span>
              </button>
              <div className="text-[11px] text-slate-300 font-mono bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-700">
                {workerStatus.lastMessage}
              </div>
            </div>
          </div>

          {/* Active Parallel Jobs Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {workerStatus.activeProjects.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 bg-slate-900/90 border border-indigo-500/30 rounded-lg px-2.5 py-1.5 text-[11px]"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-bold text-white max-w-[200px] truncate">{p.name}</span>
                <span className="text-amber-400 font-mono">({p.progressPercent}% - {p.translatedCues}/{p.totalCues})</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {p.keyMasked}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Bar & Breadcrumb Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 px-4">
        {/* Breadcrumb Trail */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeView === 'inside_folder' && selectedFolder ? (
            <>
              <button
                type="button"
                onClick={handleBackToFolders}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-all shadow-xs"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>بازگشت به همه پوشه‌ها</span>
              </button>

              <span className="text-slate-600">/</span>

              <div className="flex items-center gap-1.5 text-xs text-white font-bold bg-slate-950 px-3 py-1 rounded-xl border border-slate-800">
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>{selectedFolder.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">({projects.length} فایل)</span>
              </div>

              <div className="hidden lg:flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>داخل پوشه: «{selectedFolder.name}»</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveView('folders_grid')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeView === 'folders_grid'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>پوشه‌ها ({folders.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('all_files');
                    fetchAllProjects();
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeView === 'all_files'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>تمام فایل‌ها ({allProjects.length})</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Search and Action Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeView === 'inside_folder'
                  ? 'جستجو در این پوشه...'
                  : activeView === 'all_files'
                  ? 'جستجو در تمام زیرنویس‌ها...'
                  : 'جستجو در نام پوشه‌ها...'
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-8 pl-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setIsNewFolderOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-xs shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>پوشه جدید</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: FOLDERS OVERVIEW GRID (روی پوشه کلیک کنید تا وارد آن شوید) */}
      {activeView === 'folders_grid' && (
        <div className="flex flex-col gap-5">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                <Folder className="w-3.5 h-3.5 text-indigo-400" />
                <span>تعداد کل پوشه‌ها</span>
              </span>
              <span className="text-xl font-bold text-white font-mono">{folders.length}</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>کل زیرنویس‌های ثبت‌شده</span>
              </span>
              <span className="text-xl font-bold text-white font-mono">
                {folders.reduce((acc, f) => acc + (f.projectCount || 0), 0)}
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>فایل‌های تکمیل شده</span>
              </span>
              <span className="text-xl font-bold text-emerald-400 font-mono">
                {folders.reduce((acc, f) => acc + (f.completedCount || 0), 0)}
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>مدل هوش مصنوعی</span>
              </span>
              <span className="text-xs font-bold text-amber-300 font-mono mt-1 truncate">Gemini 3.5 Flash Lite</span>
            </div>
          </div>

          {/* Folders Cards Grid */}
          {loadingFolders ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 text-xs gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span>در حال بارگذاری پوشه‌ها...</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-8 flex flex-col items-center gap-3">
              <FolderPlus className="w-10 h-10 text-indigo-400/50" />
              <div className="font-bold text-slate-300 text-sm">هنوز هیچ پوشه‌ای ایجاد نشده است</div>
              <p className="max-w-md text-slate-400">
                برای شروع ترجمه گروهی، ابتدا یک پوشه جدید بسازید (مانند «افشای کیهانی فصل اول»)، سپس وارد پوشه شده و فایل‌های خود را آپلود کنید.
              </p>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(true)}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-colors flex items-center gap-1.5"
              >
                <FolderPlus className="w-4 h-4" />
                <span>ایجاد اولین پوشه</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {folders
                .filter((f) => !searchQuery.trim() || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((folder) => {
                  const pct = folder.projectCount > 0 ? Math.round((folder.completedCount / folder.projectCount) * 100) : 0;
                  return (
                    <div
                      key={folder.id}
                      onClick={() => handleEnterFolder(folder.id)}
                      className="group bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-4 flex flex-col justify-between gap-4 transition-all duration-200 cursor-pointer shadow-md hover:shadow-indigo-950/30"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-xl bg-indigo-600/15 group-hover:bg-indigo-600/25 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:text-indigo-300 transition-colors shrink-0">
                              <Folder className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors line-clamp-1">
                                {folder.name}
                              </h4>
                              <span className="text-[11px] text-slate-400 font-mono">
                                {folder.projectCount} فایل زیرنویس
                              </span>
                            </div>
                          </div>

                          {/* Quick Card Menu */}
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleRestartFolderFromScratch(folder.id, folder.name)}
                              disabled={isRestartingFolder}
                              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer"
                              title="ترجمه مجدد کل این پوشه از صفر (پاکسازی ترجمه‌ها و شروع مجدد از ۰٪)"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditFolderName(folder.name);
                                setEditFolderDesc(folder.description || '');
                                setSelectedFolderId(folder.id);
                                setIsEditFolderOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition-colors"
                              title="ویرایش نام پوشه"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteFolder(folder.id, folder.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                              title="حذف پوشه"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {folder.description && (
                          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                            {folder.description}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 pt-3 border-t border-slate-800/80">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>پیشرفت ترجمه</span>
                          <span className="font-mono text-white font-semibold">
                            {folder.completedCount} از {folder.projectCount} ({pct}%)
                          </span>
                        </div>

                        <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {/* ENTER FOLDER BUTTON */}
                        <div className="flex items-center justify-between mt-1 pt-1">
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(folder.createdAt).toLocaleDateString('fa-IR')}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEnterFolder(folder.id);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 group-hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition-all"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>ورود به پوشه</span>
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: INSIDE FOLDER VIEW (ورود به داخل پوشه + آپلود مستقیم + مدیریت زیرنویس‌های این پوشه) */}
      {activeView === 'inside_folder' && selectedFolder && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {/* Folder Header Information Card */}
          <div className="w-full max-w-full overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900/95 to-indigo-950/40 rounded-2xl border border-indigo-500/30 p-4 sm:p-5 flex flex-col gap-4 shadow-lg shadow-indigo-950/20">
            {/* Top Row: Folder Identity & Meta & Tone Selector */}
            <div className="w-full flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3.5">
              <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-amber-400 flex items-center justify-center shrink-0 shadow-inner">
                  <FolderOpen className="w-6 h-6" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-300">صفحه فیلم‌ها و زیرنویس‌ها:</span>
                      <span className="text-amber-400 font-extrabold truncate max-w-xs sm:max-w-md">{selectedFolder.name}</span>
                    </h3>
                    <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                      {projects.length} فیلم/قسمت
                    </span>
                  </div>
                  {selectedFolder.description ? (
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed line-clamp-2">{selectedFolder.description}</p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-0.5">پوشه اختصاصی برای نگهداری و ترجمه فایل‌های این دسته‌بندی</p>
                  )}
                </div>
              </div>

              {/* Top-Right: Folder Tone Selector & Edit Folder Meta */}
              <div className="flex items-center gap-2 shrink-0 self-end lg:self-center flex-wrap">
                <div className="flex items-center gap-1.5 bg-slate-950/90 border border-indigo-500/30 rounded-xl px-2.5 py-1.5 shadow-xs">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs text-slate-300 font-semibold shrink-0">لحن پوشه:</span>
                  <select
                    value={selectedFolder.tone || 'cinematic'}
                    onChange={(e) => handleUpdateFolderTone(e.target.value as ToneOption)}
                    className="bg-transparent border-0 text-xs text-amber-300 font-bold focus:outline-none cursor-pointer pr-1"
                    title="تغییر لحن کل فایل‌های زیرنویس این پوشه"
                  >
                    {TONE_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id} className="bg-slate-900 text-slate-100">
                        {t.labelFa}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditFolderName(selectedFolder.name);
                    setEditFolderDesc(selectedFolder.description || '');
                    setEditFolderTone((selectedFolder.tone as ToneOption) || 'cinematic');
                    setIsEditFolderOpen(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  title="ویرایش نام و مشخصات پوشه"
                >
                  <Edit3 className="w-3.5 h-3.5 text-slate-400" />
                  <span className="hidden sm:inline">ویرایش پوشه</span>
                </button>
              </div>
            </div>

            {/* Bottom Row: Actions Toolbar divided into functional clusters, fully responsive and wrapped */}
            <div className="w-full pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5">
              {/* Cluster 1: Translation Controls */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400 font-semibold ml-1 hidden md:inline">ترجمه سرور:</span>
                
                <button
                  type="button"
                  onClick={handleStartFolder}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                  title="شروع ترجمه خودکار تمام فایل‌های این پوشه در پس‌زمینه سرور"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>شروع ترجمه فیلم‌ها</span>
                </button>

                <button
                  type="button"
                  onClick={handleResumeFolder}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors cursor-pointer"
                  title="ادامه ترجمه سطرهای باقی‌مانده تمام فایل‌های ناقص پوشه"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>ادامه فایل‌های ناقص</span>
                </button>

                <button
                  type="button"
                  onClick={handleTurboComplete}
                  disabled={isTurboCompleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 shadow-xs transition-colors cursor-pointer"
                  title="تکمیل فوری فایل‌های دارای سطر ناقص (۹۸٪ به بالا) بدون معطلی و با اولویت صف"
                >
                  {isTurboCompleting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                  <span>⚡ تکمیل فوری (توربو)</span>
                </button>

                <button
                  type="button"
                  onClick={handlePauseFolder}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer"
                  title="توقف موقت ترجمه این پوشه"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>توقف موقت</span>
                </button>
              </div>

              {/* Cluster 2: Export & Tools */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadFolderSRTZip}
                  disabled={isZippingSRT || projects.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-amber-200 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 disabled:opacity-50 transition-all cursor-pointer"
                  title="دانلود گروهی تمام زیرنویس‌های این پوشه با فرمت SubRip (.srt) در قالب فایل ZIP"
                >
                  {isZippingSRT ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 text-amber-400" />}
                  <span>خروجی گروهی SRT (ZIP)</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadFolderVTTZip}
                  disabled={isZippingFolder || projects.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-200 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 disabled:opacity-50 transition-all cursor-pointer"
                  title="دانلود گروهی تمام زیرنویس‌های این پوشه با فرمت WebVTT (.vtt) در قالب فایل ZIP"
                >
                  {isZippingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 text-emerald-400" />}
                  <span>خروجی گروهی VTT (ZIP)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBatchFindText('');
                    setBatchReplaceText('');
                    setReplaceResult(null);
                    setIsFolderBatchReplaceOpen(true);
                  }}
                  disabled={projects.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-violet-200 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 disabled:opacity-50 transition-all cursor-pointer"
                  title="جایگزینی سراسری کلمات و اصطلاحات در تمام زیرنویس‌های این پوشه"
                >
                  <Replace className="w-3.5 h-3.5 text-violet-400" />
                  <span>جایگزینی کلمات در پوشه</span>
                </button>
              </div>
            </div>
          </div>

          {/* DEDICATED IN-FOLDER UPLOAD ZONE (آپلود مستقیم در پوشه) */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-2xl border-2 border-dashed p-6 flex flex-col items-center justify-center gap-4 transition-all ${
              isDragOver
                ? 'bg-indigo-600/20 border-indigo-400 shadow-xl shadow-indigo-600/20 scale-[1.01]'
                : 'bg-slate-900/60 border-indigo-500/40 hover:border-indigo-500/70 hover:bg-slate-900/80'
            }`}
          >
            <div className="flex flex-col items-center text-center gap-2 max-w-xl">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <UploadCloud className="w-7 h-7" />
              </div>

              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <span>آپلود فایل‌های فیلم‌ها و زیرنویس‌ها در پوشه</span>
                <span className="text-amber-400">«{selectedFolder.name}»</span>
              </h4>

              <p className="text-xs text-slate-300 leading-relaxed">
                تمام فایل‌هایی که اینجا رها کنید یا انتخاب نمایید، به صورت اختصاصی برای پوشه <span className="text-indigo-300 font-bold">«{selectedFolder.name}»</span> ثبت شده و در دیتابیس سرور ذخیره می‌شوند.
              </p>

              <div className="flex items-center gap-2 flex-wrap justify-center text-[10px] font-mono text-slate-400">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">SRT</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">VTT</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">ASS</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">SSA</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">SUB</span>
              </div>
            </div>

            {/* Upload Options Row */}
            <div className="flex items-center gap-4 flex-wrap justify-center pt-2 border-t border-slate-800/80 w-full max-w-lg">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoQueueOnUpload}
                  onChange={(e) => setAutoQueueOnUpload(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 accent-indigo-600"
                />
                <span className="font-semibold">شروع خودکار ترجمه پس از آپلود</span>
              </label>

              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span>لحن پیش‌فرض اعمال‌شده:</span>
                <span className="font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                  {TONE_OPTIONS.find((t) => t.id === (selectedFolder.tone || 'cinematic'))?.labelFa || selectedFolder.tone || 'سینمایی'}
                </span>
              </div>
            </div>

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".srt,.vtt,.ass,.ssa,.sub"
              onChange={handleFilesUpload}
              className="hidden"
            />

            {/* Select Files Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>در حال آپلود و ذخیره فایل‌ها در پوشه...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>انتخاب فایل‌های زیرنویس این پوشه</span>
                </>
              )}
            </button>
          </div>

          {/* Subtitle Files List in Folder */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>فایل‌های زیرنویس پوشه «{selectedFolder.name}» ({projects.length})</span>
              </span>
              <span className="text-[11px] text-emerald-400 font-semibold">
                ✓ مشخص شده برای پوشه: «{selectedFolder.name}»
              </span>
            </div>

            {/* Filter Tabs & Incomplete Batch Resume Toolbar */}
            {(() => {
              const checkComplete = (p: ServerProjectItem) => p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
              const checkTranslating = (p: ServerProjectItem) => workerStatus?.activeProjects?.some((ap) => ap.id === p.id) || false;
              const checkDisrupted = (p: ServerProjectItem) => !checkComplete(p) && (Boolean(p.hasDisruption) || p.status === 'error' || Boolean(p.lastError));
              const checkIncomplete = (p: ServerProjectItem) => !checkComplete(p) && (p.status === 'has_incomplete' || checkDisrupted(p) || (p.totalCues > 0 && p.translatedCues < p.totalCues));

              const totalInc = projects.filter(checkIncomplete).length;
              const totalTr = projects.filter(checkTranslating).length;
              const totalComp = projects.filter(checkComplete).length;

              return (
                <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/90 p-2.5 rounded-2xl border border-slate-800 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setFileFilter('all')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                        fileFilter === 'all'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      همه ({projects.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setFileFilter('incomplete')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        fileFilter === 'incomplete'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                          : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
                      }`}
                      title="فیلتر فقط فایل‌هایی که هنوز ۱۰۰٪ ترجمه نشده‌اند"
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>فایل‌های ناقص</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${fileFilter === 'incomplete' ? 'bg-slate-950 text-amber-400' : 'bg-amber-400/20 text-amber-300'}`}>
                        {totalInc}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFileFilter('translating')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        fileFilter === 'translating'
                          ? 'bg-cyan-600 text-white shadow-xs'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Loader2 className={`w-3.5 h-3.5 ${totalTr > 0 ? 'animate-spin text-cyan-400' : ''}`} />
                      <span>در حال ترجمه ({totalTr})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFileFilter('completed')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        fileFilter === 'completed'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>تکمیل شده ({totalComp})</span>
                    </button>
                  </div>

                  {totalInc > 0 && (
                    <button
                      type="button"
                      onClick={() => handleRetryIncomplete(selectedFolderId)}
                      disabled={isRetryingIncomplete}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl shadow-md transition-all cursor-pointer"
                      title="قرار دادن تمام فایل‌های ناقص در صف و ترجمه سریع سطرهای باقی‌مانده آن‌ها بدون اتلاف وقت"
                    >
                      {isRetryingIncomplete ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      <span>تکمیل فوری {totalInc} فایل ناقص</span>
                    </button>
                  )}
                </div>
              );
            })()}

            {loadingProjects ? (
              <div className="py-16 flex items-center justify-center text-slate-400 text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                <span>در حال بارگذاری فایل‌های پوشه...</span>
              </div>
            ) : projects.length === 0 ? (
              <div className="py-14 text-center text-slate-400 text-xs bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-6 flex flex-col items-center gap-2">
                <FileText className="w-8 h-8 text-slate-500" />
                <span className="font-bold text-slate-300">این پوشه هنوز هیچ فایلی ندارد</span>
                <p className="text-slate-400 max-w-sm">
                  با استفاده از کادر آپلود بالا، فایل‌های زیرنویس (نظیر قسمت‌های ۱ تا ۲۶) را انتخاب کنید تا فوراً در این پوشه قرار گیرند.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {projects
                  .filter((p) => {
                    if (searchQuery.trim() && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                    const isComp = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
                    const isTr = workerStatus?.activeProjects?.some((ap) => ap.id === p.id) || false;
                    const isDisr = !isComp && (Boolean(p.hasDisruption) || p.status === 'error' || Boolean(p.lastError));
                    const isInc = !isComp && (p.status === 'has_incomplete' || isDisr || (p.totalCues > 0 && p.translatedCues < p.totalCues));

                    if (fileFilter === 'incomplete') return isInc;
                    if (fileFilter === 'translating') return isTr;
                    if (fileFilter === 'completed') return isComp;
                    return true;
                  })
                  .map((proj) => {
                    const isComplete = proj.status === 'completed' || (proj.totalCues > 0 && proj.translatedCues >= proj.totalCues);
                    // Accurately show isTranslating IF AND ONLY IF worker is actively running this project
                    const isTranslating = workerStatus?.activeProjects?.some((ap) => ap.id === proj.id) || false;
                    const isDisrupted = !isComplete && (Boolean(proj.hasDisruption) || proj.status === 'error' || Boolean(proj.lastError));
                    const isIncomplete = !isComplete && (proj.status === 'has_incomplete' || isDisrupted || (proj.totalCues > 0 && proj.translatedCues < proj.totalCues));
                    const isQueued = !isComplete && !isTranslating && (proj.status === 'queued' || proj.status === 'translating');
                    const isWaitingKeys = proj.status === 'waiting_for_keys';
                    const pct = isComplete ? 100 : (proj.totalCues > 0 ? Math.min(99, Math.floor((proj.translatedCues / proj.totalCues) * 100)) : 0);

                    return (
                      <div
                        key={proj.id}
                        className={`rounded-2xl border p-4 flex flex-col gap-3 transition-all shadow-xs ${
                          isDisrupted
                            ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-400/60'
                            : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              isDisrupted ? 'bg-rose-900/40 text-rose-400' : 'bg-slate-800 text-indigo-400'
                            }`}>
                              <FileText className="w-4 h-4" />
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-xs text-white truncate max-w-[280px] sm:max-w-[380px]">
                                  {proj.name}
                                </span>

                                {/* EXPLICIT FOLDER BADGE (مشخص شدن پوشه هر فایل) */}
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                                  <Folder className="w-3 h-3 text-indigo-400" />
                                  <span>{selectedFolder.name}</span>
                                </span>
                              </div>

                              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                                <span className="uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-bold">
                                  {proj.format}
                                </span>
                                <span>•</span>
                                <span className={isDisrupted ? 'text-rose-400 font-bold' : isIncomplete ? 'text-amber-400 font-bold' : ''}>
                                  {proj.translatedCues} / {proj.totalCues} سطر
                                </span>
                                {proj.tokenUsage?.totalTokens > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>{proj.tokenUsage.totalTokens.toLocaleString()} توکن</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Status Badge & Actions */}
                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {/* Status */}
                            {isComplete ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>تکمیل (۱۰۰٪)</span>
                              </span>
                            ) : isTranslating ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 animate-pulse">
                                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                <span>در حال ترجمه ({pct}%)</span>
                              </span>
                            ) : isDisrupted ? (
                              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3 text-rose-400" />
                                <span>⚠️ دچار اختلال ({pct}%)</span>
                              </span>
                            ) : isIncomplete ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3 text-amber-400" />
                                <span>ترجمه ناقص ({pct}%)</span>
                              </span>
                            ) : isWaitingKeys ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-purple-400" />
                                <span>در انتظار کلید/سهمیه ({pct}%)</span>
                              </span>
                            ) : isQueued ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>در صف سرور</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                                متوقف
                              </span>
                            )}

                            {/* Resume / Fix button if disrupted, incomplete, waiting, or paused */}
                            {(isDisrupted || isIncomplete || isWaitingKeys || proj.status === 'paused') && !isTranslating && (
                              <button
                                type="button"
                                onClick={() => handleResumeProject(proj.id, proj.name)}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
                                title="رفع خطا و ادامه خودکار ترجمه از آخرین سطر باقی‌مانده"
                              >
                                <RotateCcw className="w-3 h-3 text-amber-400" />
                                <span>رفع خطا و ادامه</span>
                              </button>
                            )}

                            {/* Start translation if idle */}
                            {!isTranslating && !isDisrupted && !isIncomplete && !isWaitingKeys && (
                              <button
                                type="button"
                                onClick={() => handleStartProject(proj.id, proj.name)}
                                disabled={isComplete}
                                className="p-1.5 text-slate-300 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30"
                                title="شروع ترجمه در پس‌زمینه"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                              </button>
                            )}

                            {/* Pause button */}
                            {isTranslating && (
                              <button
                                type="button"
                                onClick={() => handlePauseProject(proj.id, proj.name)}
                                className="p-1.5 text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors"
                                title="توقف موقت ترجمه"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Single SRT Export */}
                            <a
                              href={`/api/projects/${proj.id}/export/srt`}
                              download
                              className="p-1.5 text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                              title="دانلود فایل SubRip (.srt)"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>SRT</span>
                            </a>

                            {/* Single VTT Export */}
                            <a
                              href={`/api/projects/${proj.id}/export/vtt`}
                              download
                              className="p-1.5 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                              title="دانلود فایل WebVTT (.vtt)"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>VTT</span>
                            </a>

                            {/* View & Edit Subtitles In-Place Modal */}
                            <button
                              type="button"
                              onClick={() => handleOpenViewingProjectModal(proj, selectedFolder.name)}
                              className="p-1.5 text-slate-300 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                              title="مشاهده، بررسی و ویرایش دستی سطرها"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Move to another folder */}
                            <button
                              type="button"
                              onClick={() => {
                                setMovingProject({ ...proj, folderName: selectedFolder.name });
                                setTargetMoveFolderId('');
                                setIsMoveModalOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-amber-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                              title="انتقال این فایل به پوشه‌ای دیگر"
                            >
                              <MoveRight className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete File */}
                            <button
                              type="button"
                              onClick={() => handleDeleteProject(proj.id, proj.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                              title="حذف این زیرنویس"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Error message */}
                        {proj.lastError && (
                          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-amber-300">گزارش وضعیت:</span>
                              <span>{proj.lastError}</span>
                              <span className="text-emerald-400 font-semibold text-[10px] mt-0.5">
                                ✓ تمام سطرهای ترجمه شده تا به اینجا ({proj.translatedCues} سطر) در دیتابیس سرور کاملاً محفوظ است.
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Progress bar */}
                        <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isComplete
                                ? 'bg-emerald-500'
                                : isIncomplete
                                ? 'bg-amber-500'
                                : isWaitingKeys
                                ? 'bg-purple-500'
                                : 'bg-indigo-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: ALL FILES LIST ACROSS ALL FOLDERS (نمای جامع تمام فایل‌ها با برچسب مشخص پوشه) */}
      {activeView === 'all_files' && (
        <div className="flex flex-col gap-4 animate-fade-in">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span>تمام فایل‌های زیرنویس دیتابیس سرور ({allProjects.length})</span>
            </span>
            <span className="text-[11px] text-slate-400">
              کلیک روی برچسب پوشه شما را مستقیماً وارد آن پوشه می‌کند
            </span>
          </div>

          {/* Filter Tabs & Incomplete Batch Resume Toolbar for All Files */}
          {(() => {
            const checkComplete = (p: ServerProjectItem) => p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
            const checkTranslating = (p: ServerProjectItem) => workerStatus?.activeProjects?.some((ap) => ap.id === p.id) || false;
            const checkDisrupted = (p: ServerProjectItem) => !checkComplete(p) && (Boolean(p.hasDisruption) || p.status === 'error' || Boolean(p.lastError));
            const checkIncomplete = (p: ServerProjectItem) => !checkComplete(p) && (p.status === 'has_incomplete' || checkDisrupted(p) || (p.totalCues > 0 && p.translatedCues < p.totalCues));

            const totalInc = allProjects.filter(checkIncomplete).length;
            const totalTr = allProjects.filter(checkTranslating).length;
            const totalComp = allProjects.filter(checkComplete).length;

            return (
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/90 p-2.5 rounded-2xl border border-slate-800 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFileFilter('all')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                      fileFilter === 'all'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    همه ({allProjects.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setFileFilter('incomplete')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      fileFilter === 'incomplete'
                        ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                        : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
                    }`}
                    title="فیلتر فقط فایل‌هایی که هنوز ۱۰۰٪ تکمیل نشده‌اند"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>فایل‌های ناقص</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${fileFilter === 'incomplete' ? 'bg-slate-950 text-amber-400' : 'bg-amber-400/20 text-amber-300'}`}>
                      {totalInc}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFileFilter('translating')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      fileFilter === 'translating'
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <Loader2 className={`w-3.5 h-3.5 ${totalTr > 0 ? 'animate-spin text-cyan-400' : ''}`} />
                    <span>در حال ترجمه ({totalTr})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFileFilter('completed')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      fileFilter === 'completed'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تکمیل شده ({totalComp})</span>
                  </button>
                </div>

                {totalInc > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRetryIncomplete(undefined)}
                    disabled={isRetryingIncomplete}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl shadow-md transition-all cursor-pointer"
                    title="قرار دادن تمام فایل‌های ناقص در صف و تکمیل سریع سطرهای باقی‌مانده آن‌ها"
                  >
                    {isRetryingIncomplete ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    <span>تکمیل فوری {totalInc} فایل ناقص</span>
                  </button>
                )}
              </div>
            );
          })()}

          {loadingAllProjects ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 text-xs gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              <span>در حال بارگذاری تمام زیرنویس‌ها...</span>
            </div>
          ) : allProjects.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800 p-6">
              هنوز هیچ فایلی در سرور ثبت نشده است. ابتدا یک پوشه ایجاد کرده و فایل‌ها را آپلود کنید.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {allProjects
                .filter((p) => {
                  const matchesSearch = !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.folderName && p.folderName.toLowerCase().includes(searchQuery.toLowerCase()));
                  if (!matchesSearch) return false;

                  const isComp = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
                  const isTr = workerStatus?.activeProjects?.some((ap) => ap.id === p.id) || false;
                  const isDisr = !isComp && (Boolean(p.hasDisruption) || p.status === 'error' || Boolean(p.lastError));
                  const isInc = !isComp && (p.status === 'has_incomplete' || isDisr || (p.totalCues > 0 && p.translatedCues < p.totalCues));

                  if (fileFilter === 'incomplete') return isInc;
                  if (fileFilter === 'translating') return isTr;
                  if (fileFilter === 'completed') return isComp;
                  return true;
                })
                .map((proj) => {
                  const isComplete = proj.status === 'completed' || (proj.totalCues > 0 && proj.translatedCues >= proj.totalCues);
                  const pct = isComplete ? 100 : (proj.totalCues > 0 ? Math.min(99, Math.floor((proj.translatedCues / proj.totalCues) * 100)) : 0);
                  const isTranslating = workerStatus?.activeProjects?.some((ap) => ap.id === proj.id) || false;
                  const isDisrupted = !isComplete && (Boolean(proj.hasDisruption) || proj.status === 'error' || Boolean(proj.lastError));
                  const isIncomplete = !isComplete && (proj.status === 'has_incomplete' || isDisrupted || (proj.totalCues > 0 && proj.translatedCues < proj.totalCues));

                  return (
                    <div
                      key={proj.id}
                      className={`rounded-2xl border p-4 flex flex-col gap-2.5 transition-all shadow-xs ${
                        isDisrupted
                          ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-400/60'
                          : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileText className={`w-4 h-4 shrink-0 ${isDisrupted ? 'text-rose-400' : 'text-cyan-400'}`} />
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-white truncate max-w-[280px] sm:max-w-[360px]">
                                {proj.name}
                              </span>

                              {/* CLICKABLE FOLDER BADGE */}
                              <button
                                type="button"
                                onClick={() => handleEnterFolder(proj.folderId)}
                                className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                                title="ورود به این پوشه"
                              >
                                <Folder className="w-3 h-3 text-indigo-400" />
                                <span>{proj.folderName || 'پوشه'}</span>
                                <ExternalLink className="w-2.5 h-2.5 text-indigo-400" />
                              </button>
                            </div>

                            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                              <span className="uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-bold">
                                {proj.format}
                              </span>
                              <span>•</span>
                              <span className={isDisrupted ? 'text-rose-400 font-bold' : isIncomplete ? 'text-amber-400 font-bold' : ''}>
                                {proj.translatedCues} / {proj.totalCues} سطر ({pct}%)
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {isComplete ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              تکمیل (۱۰۰٪)
                            </span>
                          ) : isTranslating ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                              در حال ترجمه ({pct}%)
                            </span>
                          ) : isDisrupted ? (
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 text-rose-400" />
                              <span>⚠️ دچار اختلال ({pct}%)</span>
                            </span>
                          ) : isIncomplete ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              ترجمه ناقص ({pct}%)
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                              {proj.status === 'queued' ? 'در صف' : 'آماده'}
                            </span>
                          )}

                          {/* Resume / Fix button if disrupted or incomplete */}
                          {(isDisrupted || isIncomplete || proj.status === 'paused') && !isTranslating && (
                            <button
                              type="button"
                              onClick={() => handleResumeProject(proj.id, proj.name)}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
                              title="رفع خطا و ادامه ترجمه از آخرین سطر باقی‌مانده"
                            >
                              <RotateCcw className="w-3 h-3 text-amber-400" />
                              <span>رفع خطا و ادامه</span>
                            </button>
                          )}

                          {/* Single SRT */}
                          <a
                            href={`/api/projects/${proj.id}/export/srt`}
                            download
                            className="p-1.5 text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                            title="دانلود فایل SRT"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>SRT</span>
                          </a>

                          {/* Single VTT */}
                          <a
                            href={`/api/projects/${proj.id}/export/vtt`}
                            download
                            className="p-1.5 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                            title="دانلود فایل VTT"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>VTT</span>
                          </a>

                          {/* View & Edit Subtitles In-Place Modal */}
                          <button
                            type="button"
                            onClick={() => handleOpenViewingProjectModal(proj, proj.folderName)}
                            className="p-1.5 text-slate-300 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                            title="مشاهده، بررسی و ویرایش دستی سطرها"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Move to another folder */}
                          <button
                            type="button"
                            onClick={() => {
                              setMovingProject(proj);
                              setTargetMoveFolderId('');
                              setIsMoveModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-amber-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                            title="انتقال به پوشه دیگر"
                          >
                            <MoveRight className="w-3.5 h-3.5" />
                          </button>

                          {/* Enter Folder */}
                          <button
                            type="button"
                            onClick={() => handleEnterFolder(proj.folderId)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 transition-colors"
                            title="ورود به پوشه این فایل"
                          >
                            <FolderOpen className="w-3 h-3" />
                            <span>مشاهده در پوشه</span>
                          </button>
                        </div>
                      </div>

                      {/* Error / Disruption detail if present */}
                      {proj.lastError && (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-2.5 text-[11px] text-rose-200 flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-rose-300">گزارش وضعیت اختلال:</span>
                              <span className="leading-relaxed">{proj.lastError}</span>
                              <span className="text-emerald-400 font-semibold text-[10px] mt-0.5">
                                ✓ تمام سطرهای ترجمه شده ({proj.translatedCues} سطر) در دیتابیس سرور کاملاً محفوظ است.
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleResumeProject(proj.id, proj.name)}
                            className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                          >
                            رفع اختلال و تلاش مجدد
                          </button>
                        </div>
                      )}

                      {/* Progress bar */}
                      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isComplete ? 'bg-emerald-500' : isDisrupted ? 'bg-rose-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Move Project To Another Folder */}
      {isMoveModalOpen && movingProject && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MoveRight className="w-4 h-4 text-amber-400" />
                <span>انتقال زیرنویس به پوشه‌ای دیگر</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsMoveModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400 font-semibold">فایل زیرنویس:</span>
              <span className="text-xs font-bold text-white truncate max-w-full bg-slate-950 p-2.5 rounded-xl border border-slate-800 font-mono">
                {movingProject.name}
              </span>
            </div>

            <form onSubmit={handleMoveProjectSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                  انتخاب پوشه مقصد جدید:
                </label>
                <select
                  value={targetMoveFolderId}
                  onChange={(e) => setTargetMoveFolderId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- لطفاً یک پوشه را انتخاب کنید --</option>
                  {folders
                    .filter((f) => f.id !== movingProject.folderId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.projectCount} فایل)
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsMoveModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={!targetMoveFolderId}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 shadow-md transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>انتقال به این پوشه</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Folder */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-scale-up">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-indigo-400" />
              <span>ایجاد پوشه جدید</span>
            </h3>

            <form onSubmit={handleCreateFolder} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  نام پوشه (مثلاً: افشای کیهانی فصل اول):
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="افشای کیهانی فصل اول"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  توضیحات (اختیاری):
                </label>
                <input
                  type="text"
                  value={newFolderDesc}
                  onChange={(e) => setNewFolderDesc(e.target.value)}
                  placeholder="مستند علمی و تحقیقاتی کیهانی"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* TONE SELECTION FOR THIS FOLDER */}
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  لحن ترجمه اختصاصی برای این پوشه:
                </label>
                <select
                  value={newFolderTone}
                  onChange={(e) => setNewFolderTone(e.target.value as ToneOption)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-300 font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {TONE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-slate-100">
                      {t.labelFa} - {t.descriptionFa}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  تمام زیرنویس‌هایی که در این پوشه آپلود می‌شوند به صورت یکدست با این لحن ترجمه خواهند شد.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors"
                >
                  ساخت پوشه
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Folder */}
      {isEditFolderOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-scale-up">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-indigo-400" />
              <span>ویرایش پوشه</span>
            </h3>

            <form onSubmit={handleEditFolder} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">نام پوشه:</label>
                <input
                  type="text"
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">توضیحات:</label>
                <input
                  type="text"
                  value={editFolderDesc}
                  onChange={(e) => setEditFolderDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* TONE SELECTION FOR THIS FOLDER */}
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  لحن ترجمه اختصاصی برای این پوشه:
                </label>
                <select
                  value={editFolderTone}
                  onChange={(e) => setEditFolderTone(e.target.value as ToneOption)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-300 font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {TONE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-slate-100">
                      {t.labelFa} - {t.descriptionFa}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  تغییر لحن فوراً بر روی تمامی فایل‌های موجود در این پوشه اعمال می‌شود.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsEditFolderOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors"
                >
                  ذخیره تغییرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Global Batch Find & Replace in Folder */}
      {isFolderBatchReplaceOpen && selectedFolder && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 w-full max-w-xl shadow-2xl flex flex-col gap-4 animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Replace className="w-4 h-4 text-indigo-400" />
                <span>جایگزینی سراسری کلمات در پوشه «{selectedFolder.name}»</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsFolderBatchReplaceOpen(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-indigo-950/40 border border-indigo-500/20 rounded-xl p-3">
              این ابزار تمام فایل‌های زیرنویس موجود در پوشه <span className="text-amber-400 font-bold">«{selectedFolder.name}»</span> ({projects.length} فایل) را پیمایش کرده و کلمه یا عبارت مورد نظر شما را به طور یکپارچه در دیتابیس سرور جایگزین می‌نماید.
            </p>

            <form onSubmit={handleExecuteFolderBatchReplace} className="flex flex-col gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-300 font-semibold block">
                    کلمه یا عبارت دقیق برای جستجو:
                  </label>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    ✓ تطابق دقیق عبارت (Exact Phrase)
                  </span>
                </div>
                <input
                  type="text"
                  value={batchFindText}
                  onChange={(e) => setBatchFindText(e.target.value)}
                  placeholder="مثال: سلام دنیا (عیناً این دو کلمه کنار هم جایگزین می‌شوند)"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  جایگزین شود با:
                </label>
                <input
                  type="text"
                  value={batchReplaceText}
                  onChange={(e) => setBatchReplaceText(e.target.value)}
                  placeholder="مثال: هوشمندان فرازمینی (ET)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Scope & Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">محدوده جایگزینی:</label>
                  <select
                    value={batchScope}
                    onChange={(e) => setBatchScope(e.target.value as 'translated' | 'both')}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="translated">فقط در متن‌های ترجمه شده (فارسی)</option>
                    <option value="both">در هر دو (ترجمه شده + متن اصلی)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 justify-center pt-2 sm:pt-0">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchMatchCase}
                      onChange={(e) => setBatchMatchCase(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 accent-indigo-600"
                    />
                    <span>تطابق بزرگ/کوچکی حروف (Match Case)</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchWholeWord}
                      onChange={(e) => setBatchWholeWord(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 accent-indigo-600"
                    />
                    <span>فقط کلمات کامل (Whole Word)</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchUseRegex}
                      onChange={(e) => setBatchUseRegex(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 accent-indigo-600"
                    />
                    <span>عبارت منظم (Regex)</span>
                  </label>
                </div>
              </div>

              {/* Execution Result Banner */}
              {replaceResult && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-xs text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <span className="font-bold">عملیات با موفقیت انجام شد:</span>
                    <span>
                      تعداد <strong className="text-white">{replaceResult.totalOccurrences}</strong> مورد در <strong className="text-white">{replaceResult.affectedProjectsCount}</strong> فایل جایگزین و ذخیره شد.
                    </span>
                    {replaceResult.affectedProjects?.length > 0 && (
                      <span className="text-[11px] text-emerald-400/80">
                        فایل‌های تغییر یافته: {replaceResult.affectedProjects.slice(0, 5).join('، ')}{replaceResult.affectedProjects.length > 5 ? ' و...' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsFolderBatchReplaceOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  بستن
                </button>
                <button
                  type="submit"
                  disabled={isExecutingReplace || !batchFindText.trim()}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {isExecutingReplace ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>در حال جایگزینی در تمام فایل‌های پوشه...</span>
                    </>
                  ) : (
                    <>
                      <Replace className="w-3.5 h-3.5" />
                      <span>اجرای جایگزینی سراسری</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Server & Network Configuration (ALLOWED_ORIGIN & GEMINI_BASE_URL) */}
      {isServerConfigOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 w-full max-w-xl shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-violet-400" />
                <span>تنظیمات سرور، پراکسی و ترجمه موازی</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsServerConfigOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveServerConfig} className="flex flex-col gap-4">
              {/* ALLOWED_ORIGIN */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    <span>مجوز دسترسی دامنه (ALLOWED_ORIGIN):</span>
                  </span>
                  <span className="text-[11px] font-mono text-cyan-400">پیش‌فرض: * (دسترسی آزاد از همه هاست‌ها)</span>
                </label>
                <input
                  type="text"
                  value={serverConfig.allowedOrigin}
                  onChange={(e) => setServerConfig({ ...serverConfig, allowedOrigin: e.target.value })}
                  placeholder="*"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-cyan-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
                />
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  مقدار <code className="text-cyan-300 font-mono">*</code> به این معنی است که سرور از روی هر VPS، دامنه یا IP به راحتی در دسترس خواهد بود. برای محدودسازی به یک دامنه خاص، نشانی مانند <code className="text-cyan-300 font-mono">https://my-domain.com</code> وارد کنید.
                </p>
              </div>

              {/* GEMINI_BASE_URL */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                    <span>آدرس پایه سرویس جمینای (GEMINI_BASE_URL):</span>
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400">Google Official / Custom Proxy</span>
                </label>
                <input
                  type="text"
                  value={serverConfig.geminiBaseUrl}
                  onChange={(e) => setServerConfig({ ...serverConfig, geminiBaseUrl: e.target.value })}
                  placeholder="https://generativelanguage.googleapis.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
                />
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  پیش‌فرض روی سرور اصلی گوگل است. اگر سرور مجازی شما در منطقه‌ای با فیلترینگ یا محدودیت قرار دارد، می‌توانید یک آدرس Reverse Proxy یا آدرس Cloudflare Worker اختصاصی خود را در این فیلد قرار دهید.
                </p>
              </div>

              {/* Concurrency: maxConcurrentProjects (Active Files) */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    <span>تعداد فایل‌های ترجمه همزمان (Active Concurrent Files):</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-indigo-300 px-2.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                    {serverConfig.maxConcurrentProjects || 4} فایل
                  </span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={16}
                    step={1}
                    value={serverConfig.maxConcurrentProjects || 4}
                    onChange={(e) => setServerConfig({ ...serverConfig, maxConcurrentProjects: Number(e.target.value) })}
                    className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300 shrink-0">۱ تا ۱۶ فایل</span>
                </div>
              </div>

              {/* Concurrency: maxKeysPerProject */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>تعداد کلید همزمان برای هر فایل (Keys Per File):</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-cyan-300 px-2.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                    {serverConfig.maxKeysPerProject || 2} کلید {serverConfig.maxKeysPerProject === 2 ? '(پیش‌فرض بهینه)' : ''}
                  </span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={1}
                    value={serverConfig.maxKeysPerProject || 2}
                    onChange={(e) => setServerConfig({ ...serverConfig, maxKeysPerProject: Number(e.target.value) })}
                    className="w-full accent-cyan-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300 shrink-0">۱ تا ۴ کلید</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  هر فایل همزمان از این تعداد کلید به صورت موازی استفاده می‌کند (مثلاً ۵۰ سطر با کلید اول و ۵۰ سطر با کلید دوم به صورت همزمان).
                </p>
              </div>

              {/* Live Formula Preview Card */}
              {(() => {
                const f = serverConfig.maxConcurrentProjects || 4;
                const perFile = serverConfig.maxKeysPerProject || 2;
                const totalWorkingKeys = f * perFile;
                const cuesPerCall = perFile * 50;

                return (
                  <div className="bg-gradient-to-r from-indigo-950/40 via-slate-950 to-amber-950/30 border border-indigo-500/30 rounded-xl p-3.5 text-xs flex flex-col gap-2">
                    <div className="flex items-center gap-2 font-bold text-amber-300">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>محاسبه توان پردازش استخر کلیدها:</span>
                    </div>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      با <span className="text-white font-bold">{f} فایل همزمان</span> و <span className="text-cyan-300 font-bold">{perFile} کلید برای هر فایل</span>، دقیقاً <span className="text-amber-300 font-bold font-mono">{totalWorkingKeys} کلید موازی</span> همزمان از استخر کلیدها ({serverKeysCount} کلید موجود) فعال خواهد بود و در هر چرخه {cuesPerCall} سطر ترجمه می‌شود.
                    </p>
                    <div className="text-[10px] text-emerald-300 bg-emerald-950/50 p-2 rounded-lg border border-emerald-800/40 flex flex-col gap-1">
                      <span>🔄 چرخش هوشمند FIFO: کلیدی که سهمیه‌اش تمام شود فوراً به انتهای صف استخر رفته و کلید آزاد بعدی جایگزین آن می‌شود.</span>
                      <span>✨ آزادسازی خودکار: در ۳۵ سطر پایانی هر فایل تنها ۱ کلید درگیر مانده و کلیدهای دیگر به فایل بعدی داده می‌شوند.</span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsServerConfigOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSavingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>ذخیره تنظیمات</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Unified AI Keys Pool Management & Priority Control */}
      {isKeysModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 lg:p-7 w-full max-w-5xl shadow-2xl flex flex-col gap-5 animate-scale-up max-h-[94vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2.5">
                    <span>مدیریت استخر یکپارچه کلیدهای هوش مصنوعی</span>
                    <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      گردش یکپارچه بدون توقف
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    چرخش خودکار بین کلیدهای Gemini، واسط‌های DeepSeek، OpenAI و Claude بدون تفکیک استخر اصلی و فرعی — با اتمام هر کلید، کار به کلید بعدی منتقل می‌شود.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsKeysModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Top KPI Cards */}
            {(() => {
              const totalCount = unifiedKeysList.length;
              const activeCount = unifiedKeysList.filter((k) => !k.isExhausted && !k.isDisabled && !k.isDailyExhausted).length;
              const minuteCount = unifiedKeysList.filter((k) => k.isMinuteExhausted && !k.isDailyExhausted).length;
              const dailyCount = unifiedKeysList.filter((k) => k.isDailyExhausted || k.isDisabled).length;
              const totalTokensSum = unifiedKeysList.reduce((acc, k) => acc + (k.totalTokens || 0), 0);

              return (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      <span>کل کلیدهای فعال استخر</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-white">{totalCount}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-emerald-500/30 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>آماده ترجمه زنده</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-emerald-400">{activeCount}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-amber-500/30 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-amber-400 font-medium flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>وقفه دقیقه (RPM)</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-amber-400">{minuteCount}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-rose-500/30 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-rose-400 font-medium flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>اتمام سهمیه یا خطای 401</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-rose-400">{dailyCount}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-purple-500/30 rounded-2xl p-3 flex flex-col gap-1 col-span-2 sm:col-span-1">
                    <span className="text-[11px] text-purple-400 font-medium flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-purple-400" />
                      <span>کل توکن مصرفی</span>
                    </span>
                    <span className="text-lg font-bold font-mono text-purple-300">
                      {totalTokensSum > 1000000 ? (totalTokensSum / 1000000).toFixed(2) + 'M' : (totalTokensSum / 1000).toFixed(1) + 'k'}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Quick Action Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-2.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleTestAllUnifiedKeys}
                  disabled={isTestingAllKeys}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-600/30 border border-emerald-400/40 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95"
                  title="تست سلامت، پینگ و اعتبار تمام کلیدهای هوش مصنوعی استخر به صورت همزمان از روی سرور"
                >
                  {isTestingAllKeys ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Sparkles className="w-4 h-4 text-emerald-200" />}
                  <span>⚡ تست دسته‌جمعی همه APIها (یک‌مرتبه)</span>
                </button>

                <button
                  type="button"
                  onClick={handlePurgeInvalidKeys}
                  disabled={isPurgingInvalid}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="کلیدهایی که خطای 401 یا نامعتبر داده‌اند را بلافاصله از پایگاه‌داده حذف می‌کند"
                >
                  {isPurgingInvalid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-rose-400" />}
                  <span>پاکسازی خودکار کلیدهای نامعتبر (401)</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearCache}
                  disabled={isClearingCache}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="تمام وقفه‌های موقت و قفل‌های مسدود کلیدها را بازنشانی می‌کند"
                >
                  {isClearingCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 text-amber-400" />}
                  <span>رفع وقفه و بازگردانی تمام کلیدها</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetAllCooldowns}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>ریست وقفه‌های RPM</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void fetchUnifiedKeys();
                    void fetchServerKeys();
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>بروزرسانی لیست</span>
                </button>
              </div>
            </div>

            {/* SECTION 1: ADD KEYS (Two distinct tabs as requested) */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white">افزودن کلیدها به چرخه استخر</span>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setAddKeySectionTab('batch_main')}
                    className={'px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ' + (addKeySectionTab === 'batch_main' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white')}
                  >
                    ورود دسته‌جمعی کلیدها (Gemini / OpenAI / Claude)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddKeySectionTab('broker_custom')}
                    className={'px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ' + (addKeySectionTab === 'broker_custom' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-400 hover:text-white')}
                  >
                    شرکت‌های واسط و سرورهای اختصاصی (DeepSeek / OneAPI)
                  </button>
                </div>
              </div>

              {/* Tab A: Batch Main Keys Entry */}
              {addKeySectionTab === 'batch_main' && (
                <form onSubmit={handleAddBatchKeys} className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 mb-1 block">نوع هوش مصنوعی</label>
                      <select
                        value={batchProviderType}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBatchProviderType(val);
                          if (val === 'gemini') setBatchProviderModel('gemini-2.5-flash');
                          else if (val === 'openai') setBatchProviderModel('gpt-4o-mini');
                          else if (val === 'claude') setBatchProviderModel('claude-3-5-haiku-20241022');
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                      >
                        <option value="gemini">Google Gemini (پیش‌فرض سریع)</option>
                        <option value="openai">OpenAI GPT</option>
                        <option value="claude">Anthropic Claude</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-slate-400 block">مدل هوش مصنوعی</label>
                        <button
                          type="button"
                          onClick={() => setIsManualBatchModel(!isManualBatchModel)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer transition-colors"
                        >
                          {isManualBatchModel ? '← انتخاب از لیست' : '✎ ورود دستی مدل'}
                        </button>
                      </div>

                      {isManualBatchModel ? (
                        <div className="flex flex-col gap-1.5">
                          <input
                            type="text"
                            value={batchProviderModel}
                            onChange={(e) => setBatchProviderModel(e.target.value)}
                            placeholder="مثال: gemini-3.5-flash-lite یا gemini-3.7-flash"
                            dir="ltr"
                            className="w-full bg-slate-900 border border-indigo-500/50 rounded-xl px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-indigo-400 shadow-inner"
                          />
                          {batchProviderType === 'gemini' && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-[9px] text-slate-500">پیشنهادی:</span>
                              {[
                                'gemini-3.5-flash-lite',
                                'gemini-3.7-flash',
                                'gemini-2.5-flash',
                                'gemini-2.5-flash-lite',
                                'gemini-3.1-flash-lite',
                                'gemini-2.5-pro',
                              ].map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setBatchProviderModel(m)}
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : batchProviderType === 'gemini' ? (
                        <select
                          value={batchProviderModel}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setIsManualBatchModel(true);
                              setBatchProviderModel('');
                            } else {
                              setBatchProviderModel(e.target.value);
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500 font-mono"
                        >
                          <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (مدل ۳.۵ فلش لایت)</option>
                          <option value="gemini-3.7-flash">gemini-3.7-flash (مدل ۳.۷ فلش - جدید و پرسرعت)</option>
                          <option value="gemini-2.5-flash">gemini-2.5-flash (توصیه‌شده)</option>
                          <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (سریع و سبک)</option>
                          <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                          <option value="gemini-2.5-pro">gemini-2.5-pro (دقت بالا)</option>
                          <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                          <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                          <option value="__custom__">✎ ورود دستی نام دلخواه مدل...</option>
                        </select>
                      ) : batchProviderType === 'openai' ? (
                        <select
                          value={batchProviderModel}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setIsManualBatchModel(true);
                              setBatchProviderModel('');
                            } else {
                              setBatchProviderModel(e.target.value);
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500 font-mono"
                        >
                          <option value="gpt-4o-mini">gpt-4o-mini (اقتصادی و بسیار سریع)</option>
                          <option value="gpt-4o">gpt-4o</option>
                          <option value="o3-mini">o3-mini</option>
                          <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                          <option value="__custom__">✎ ورود دستی نام دلخواه مدل...</option>
                        </select>
                      ) : (
                        <select
                          value={batchProviderModel}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setIsManualBatchModel(true);
                              setBatchProviderModel('');
                            } else {
                              setBatchProviderModel(e.target.value);
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500 font-mono"
                        >
                          <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022 (سریع)</option>
                          <option value="claude-3-7-sonnet-20250219">claude-3-7-sonnet-20250219 (جدیدترین کلود)</option>
                          <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022</option>
                          <option value="__custom__">✎ ورود دستی نام دلخواه مدل...</option>
                        </select>
                      )}
                    </div>

                    <div className="flex flex-col justify-end">
                      <p className="text-[11px] text-slate-400">
                        کلیدها را خط به خط در جعبه پایین قرار دهید. تمام کلیدها با اولویت‌بندی به استخر افزوده خواهند شد.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-400 mb-1 block">
                      کلیدهای API (هر خط یک کلید — پشتیبانی از ده‌ها کلید همزمان):
                    </label>
                    <textarea
                      value={batchProviderKeysText}
                      onChange={(e) => setBatchProviderKeysText(e.target.value)}
                      placeholder={
                        batchProviderType === 'gemini'
                          ? "AIzaSy...\nAIzaSy...\nAIzaSy..."
                          : batchProviderType === 'openai'
                          ? "sk-proj-...\nsk-proj-..."
                          : "sk-ant-...\nsk-ant-..."
                      }
                      rows={3}
                      dir="ltr"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-indigo-500 placeholder:text-slate-600 resize-y"
                    />
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={isAddingBatchKeys || !batchProviderKeysText.trim()}
                      className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAddingBatchKeys ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      <span>افزودن دسته‌جمعی به استخر یکپارچه</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Tab B: Broker Custom Servers Entry */}
              {addKeySectionTab === 'broker_custom' && (
                <form onSubmit={handleAddBrokerKeys} className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 mb-1 block">نام شرکت یا سرور واسط</label>
                      <input
                        type="text"
                        value={brokerName}
                        onChange={(e) => setBrokerName(e.target.value)}
                        placeholder="مثال: DeepSeek واسط یا OneAPI"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-slate-400 block">آدرس سرور واسط (Base URL)</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setBrokerBaseUrl('https://api.deepseek.com');
                              setBrokerModel('deepseek-chat');
                            }}
                            className="text-[10px] text-amber-400 hover:underline cursor-pointer"
                          >
                            پیش‌فرض DeepSeek
                          </button>
                          <span className="text-slate-600">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              setBrokerBaseUrl('https://api.openai-proxy.org/v1');
                              setBrokerModel('deepseek-chat');
                            }}
                            className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                          >
                            پروکسی OneAPI
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={brokerBaseUrl}
                        onChange={(e) => setBrokerBaseUrl(e.target.value)}
                        placeholder="https://api.deepseek.com یا https://your-broker-url.com/v1"
                        dir="ltr"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-hidden focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 mb-1 block">نام مدل</label>
                      <input
                        type="text"
                        value={brokerModel}
                        onChange={(e) => setBrokerModel(e.target.value)}
                        placeholder="deepseek-chat"
                        dir="ltr"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-hidden focus:border-amber-500"
                      />
                    </div>

                    <div className="sm:col-span-2 flex items-center">
                      <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-2.5 text-[11px] text-amber-300 w-full flex items-center gap-2">
                        <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                        <span>
                          سرورهای واسط تاخیر دارند؛ سیستم تا دریافت پاسخ کامل منتظر می‌ماند و درخواست موازی ارسال نمی‌کند تا سقف درخواست ایجاد نشود.
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-400 mb-1 block">
                      کلیدهای این سرور واسط (هر خط یک کلید — می‌توانید ده‌ها کلید از شرکت واسط را همزمان اضافه کنید):
                    </label>
                    <textarea
                      value={brokerKeysText}
                      onChange={(e) => setBrokerKeysText(e.target.value)}
                      placeholder="sk-...\nsk-...\nsk-..."
                      rows={3}
                      dir="ltr"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-mono text-amber-400 focus:outline-hidden focus:border-amber-500 placeholder:text-slate-600 resize-y"
                    />
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={isAddingBrokerServer || !brokerKeysText.trim() || !brokerBaseUrl.trim()}
                      className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-md shadow-amber-600/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAddingBrokerServer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                      <span>افزودن سرور و کلیدهای واسط به استخر</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* SECTION 2: UNIFIED KEY LIST & PRIORITY CONTROL */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2.5">
                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-white ml-1">فهرست کلیدها و اولویت چرخش:</span>
                  <button
                    type="button"
                    onClick={() => setUnifiedKeyFilter('all')}
                    className={'px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ' + (unifiedKeyFilter === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-white')}
                  >
                    همه ({unifiedKeysList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnifiedKeyFilter('gemini')}
                    className={'px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ' + (unifiedKeyFilter === 'gemini' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-white')}
                  >
                    Gemini ({unifiedKeysList.filter((k) => k.provider === 'gemini').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnifiedKeyFilter('custom')}
                    className={'px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ' + (unifiedKeyFilter === 'custom' ? 'bg-amber-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-white')}
                  >
                    واسط DeepSeek ({unifiedKeysList.filter((k) => k.provider === 'custom').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnifiedKeyFilter('openai')}
                    className={'px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ' + (unifiedKeyFilter === 'openai' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-white')}
                  >
                    OpenAI ({unifiedKeysList.filter((k) => k.provider === 'openai').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnifiedKeyFilter('claude')}
                    className={'px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ' + (unifiedKeyFilter === 'claude' ? 'bg-purple-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-white')}
                  >
                    Claude ({unifiedKeysList.filter((k) => k.provider === 'claude').length})
                  </button>
                </div>

                {/* Batch Actions on Selection */}
                {selectedUnifiedIds.length > 0 && (
                  <div className="flex items-center gap-2 bg-indigo-950/60 border border-indigo-500/30 rounded-xl px-3 py-1.5 animate-scale-up">
                    <span className="text-xs text-indigo-300 font-bold">
                      {selectedUnifiedIds.length} کلید انتخاب شده:
                    </span>
                    <button
                      type="button"
                      onClick={handleBatchDeleteUnifiedKeys}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-600/30 text-rose-300 hover:bg-rose-600/50 border border-rose-500/40 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف گروهی</span>
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isManualBatchChangeModel ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={batchUnifiedModel}
                            onChange={(e) => setBatchUnifiedModel(e.target.value)}
                            placeholder="نام مدل دلخواه..."
                            dir="ltr"
                            className="bg-slate-900 border border-indigo-500/60 rounded-lg px-2.5 py-1 text-xs text-emerald-400 font-mono w-40 focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => setIsManualBatchChangeModel(false)}
                            className="text-[10px] text-slate-400 hover:text-white px-1 cursor-pointer"
                            title="بازگشت به لیست"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <select
                          value={batchUnifiedModel}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setIsManualBatchChangeModel(true);
                              setBatchUnifiedModel('');
                            } else {
                              setBatchUnifiedModel(e.target.value);
                            }
                          }}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-white font-mono"
                        >
                          <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (سریع)</option>
                          <option value="gemini-3.7-flash">gemini-3.7-flash (جدید)</option>
                          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                          <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                          <option value="deepseek-chat">deepseek-chat</option>
                          <option value="gpt-4o-mini">gpt-4o-mini</option>
                          <option value="claude-3-5-haiku-20241022">claude-3-5-haiku</option>
                          <option value="__custom__">✎ ورود دستی مدل...</option>
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => handleBatchSetModelUnifiedKeys(batchUnifiedModel)}
                        className="px-2 py-1 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors cursor-pointer"
                      >
                        تغییر مدل
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Selection helper row */}
              {unifiedKeysList.length > 0 && (
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const currentFiltered = unifiedKeysList.filter((k) => {
                          if (unifiedKeyFilter === 'all') return true;
                          return k.provider === unifiedKeyFilter;
                        });
                        if (selectedUnifiedIds.length === currentFiltered.length) {
                          setSelectedUnifiedIds([]);
                        } else {
                          setSelectedUnifiedIds(currentFiltered.map((k) => k.id));
                        }
                      }}
                      className="text-xs text-indigo-400 hover:underline cursor-pointer"
                    >
                      {selectedUnifiedIds.length === unifiedKeysList.length ? 'لغو انتخاب همه' : 'انتخاب همه کلیدها'}
                    </button>
                    <span>•</span>
                    <span>با دکمه‌های ▲ و ▼ اولویت چرخش کلیدها را به دلخواه جابه‌جا کنید.</span>
                  </div>
                </div>
              )}

              {/* Key Cards Container */}
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {(() => {
                  const filtered = unifiedKeysList.filter((k) => {
                    if (unifiedKeyFilter === 'all') return true;
                    return k.provider === unifiedKeyFilter;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                        <Key className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                        <p className="text-sm font-semibold text-slate-400">هیچ کلیدی در این دسته ثبت نشده است.</p>
                        <p className="text-xs text-slate-500 mt-1">از فرم بالا برای افزودن کلیدهای جدید استفاده کنید.</p>
                      </div>
                    );
                  }

                  return filtered.map((k, idx) => {
                    const isSelected = selectedUnifiedIds.includes(k.id);
                    const isMinuteWait = k.isMinuteExhausted && !k.isDailyExhausted;
                    const isDailyWait = k.isDailyExhausted;
                    const isKeyDead = k.isDisabled;

                    let providerBadgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                    let providerLabel = 'Gemini';
                    if (k.provider === 'custom') {
                      providerBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                      providerLabel = k.name || 'واسط DeepSeek';
                    } else if (k.provider === 'openai') {
                      providerBadgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                      providerLabel = 'OpenAI';
                    } else if (k.provider === 'claude') {
                      providerBadgeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
                      providerLabel = 'Claude';
                    }

                    return (
                      <div
                        key={k.id}
                        className={'p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap ' + (
                          isSelected
                            ? 'bg-indigo-950/30 border-indigo-500/50 shadow-md'
                            : 'bg-slate-950/70 border-slate-800/90 hover:border-slate-700'
                        )}
                      >
                        {/* Right: Selection & Priority controls & Info */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Selection Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedUnifiedIds((prev) => [...prev, k.id]);
                              } else {
                                setSelectedUnifiedIds((prev) => prev.filter((id) => id !== k.id));
                              }
                            }}
                            className="rounded-md border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer w-4 h-4"
                          />

                          {/* Priority Reordering Buttons */}
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveKeyPriority(k.id, 'up')}
                              disabled={idx === 0}
                              className="w-5 h-4.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-20 flex items-center justify-center text-[10px] cursor-pointer transition-colors"
                              title="افزایش اولویت (حرکت به بالا)"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveKeyPriority(k.id, 'down')}
                              disabled={idx === filtered.length - 1}
                              className="w-5 h-4.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-20 flex items-center justify-center text-[10px] cursor-pointer transition-colors"
                              title="کاهش اولویت (حرکت به پایین)"
                            >
                              ▼
                            </button>
                          </div>

                          {/* Priority Rank Badge */}
                          <div className="w-7 h-7 rounded-lg bg-slate-800/90 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-slate-300 shrink-0">
                            #{idx + 1}
                          </div>

                          {/* Provider & Key Info */}
                          <div className="min-w-0 flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={'text-[11px] font-bold px-2 py-0.5 rounded-lg border ' + providerBadgeColor}>
                                {providerLabel}
                              </span>
                              <span className="text-xs font-mono font-bold text-white tracking-wide" dir="ltr">
                                {k.maskedKey}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                                {k.model}
                              </span>
                              {k.baseUrl && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300/80 border border-amber-500/20 max-w-[180px] truncate" dir="ltr">
                                  {k.baseUrl}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-0.5">
                              <span>توکن: {(k.totalTokens || 0).toLocaleString('fa-IR')}</span>
                              <span>•</span>
                              <span>درخواست: {k.requestsCount || 0}</span>
                              {k.latencyMs && (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-400">پینگ: {k.latencyMs}ms</span>
                                </>
                              )}
                              {k.cooldownRemainingSeconds && k.cooldownRemainingSeconds > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="text-amber-400">وقفه: {k.cooldownRemainingSeconds} ثانیه</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Left: Realtime Status & Actions */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          {/* Live Status Badge */}
                          {isKeyDead ? (
                            <span className="text-[11px] px-2.5 py-1 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 font-semibold">
                              <AlertCircle className="w-3 h-3" />
                              <span>غیرمعتبر (401)</span>
                            </span>
                          ) : isDailyWait ? (
                            <span className="text-[11px] px-2.5 py-1 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/25 flex items-center gap-1 font-semibold">
                              <Clock className="w-3 h-3" />
                              <span>پایان سهمیه روزانه</span>
                            </span>
                          ) : isMinuteWait ? (
                            <span className="text-[11px] px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-semibold">
                              <Clock className="w-3 h-3" />
                              <span>وقفه دقیقه ({k.cooldownRemainingSeconds || 0}s)</span>
                            </span>
                          ) : (
                            <span className="text-[11px] px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-semibold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>آماده و فعال</span>
                            </span>
                          )}

                          {/* Test Key Button */}
                          <button
                            type="button"
                            onClick={() => handleTestUnifiedKey(k.id)}
                            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="تست اتصال و پینگ کلید"
                          >
                            <Activity className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete Key Button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteUnifiedKey(k.id)}
                            className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 transition-colors cursor-pointer"
                            title="حذف کلید از استخر"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 flex-wrap gap-2">
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>تمام کلیدها به عنوان همتاهای برابر (Peer) در یک استخر متوالی قرار دارند.</span>
              </div>
              <button
                type="button"
                onClick={() => setIsKeysModalOpen(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Restore Database Backup */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 w-full max-w-lg shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-amber-400" />
                <span>بازیابی اطلاعات دیتابیس (Restore Backup)</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsRestoreModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
              با بارگذاری فایل پشتیبان، تمام پوشه‌ها و پروژه‌های زیرنویس به فایل دیتابیس روی سرور (<code className="font-mono bg-slate-950 px-1.5 py-0.5 rounded text-white">data/subtitles_db.json</code>) بازگردانده می‌شوند.
            </div>

            {/* File upload trigger */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-300 font-semibold">
                انتخاب فایل JSON نسخه پشتیبان:
              </label>
              <input
                ref={restoreFileInputRef}
                type="file"
                accept=".json"
                onChange={handleRestoreFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => restoreFileInputRef.current?.click()}
                className="w-full py-3 px-4 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-xl bg-slate-950/60 hover:bg-slate-950 text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <UploadCloud className="w-4 h-4 text-amber-400" />
                <span>برای انتخاب فایل SubGameLab_Backup_*.json کلیک کنید</span>
              </button>
            </div>

            {/* Direct JSON paste option */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-300 font-semibold">
                یا متن JSON پشتیبان را اینجا الصاق کنید:
              </label>
              <textarea
                rows={4}
                value={restoreJsonText}
                onChange={(e) => setRestoreJsonText(e.target.value)}
                placeholder='{"version": 1, "folders": [...], "projects": [...]}'
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
              />
            </div>

            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={() => setIsRestoreModalOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={isRestoring || !restoreJsonText.trim()}
                onClick={() => handleRestoreSubmit(restoreJsonText)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isRestoring ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>در حال بازیابی دیتابیس...</span>
                  </>
                ) : (
                  <span>بازیابی دیتابیس</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: In-Place Subtitle Inspector & Manual Editor */}
      {viewingProject && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl h-[92vh] shadow-2xl flex flex-col overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm sm:text-base font-bold text-white truncate max-w-md">
                      {viewingProject.name}
                    </h3>
                    {viewingProjectFolderName && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                        <Folder className="w-3 h-3 text-indigo-400" />
                        <span>{viewingProjectFolderName}</span>
                      </span>
                    )}
                    <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {viewingProject.format}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="text-emerald-400 font-semibold font-mono">
                      {editedCues.filter(c => isCueProperlyTranslated(c.originalText, c.translatedText, 'fa')).length} از {editedCues.length} سطر فارسی ترجمه شده
                    </span>
                    <span>•</span>
                    <span className="text-amber-400 font-mono">
                      {editedCues.filter(c => !isCueProperlyTranslated(c.originalText, c.translatedText, 'fa')).length} سطر نیازمند ترجمه
                    </span>
                  </div>
                </div>
              </div>

              {/* Header Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const targetProj = viewingProject;
                    setViewingProject(null);
                    onOpenProjectInEditor({
                      id: targetProj.id,
                      name: targetProj.name,
                      folderName: viewingProjectFolderName,
                      items: editedCues,
                      format: targetProj.format as SubtitleFormat,
                      rawHeader: targetProj.rawHeader,
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-200 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors shadow-xs"
                  title="انتقال سطرها به ادیتور پیشرفته سینمایی با خط زمان و پخش‌کننده ویدیو"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                  <span>ادیتور پیشرفته سینما</span>
                </button>

                <a
                  href={`/api/projects/${viewingProject.id}/export/srt`}
                  download
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>SRT</span>
                </a>

                <a
                  href={`/api/projects/${viewingProject.id}/export/vtt`}
                  download
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>VTT</span>
                </a>

                <button
                  type="button"
                  disabled={isSavingProjectItems}
                  onClick={handleSaveViewingProjectChanges}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSavingProjectItems ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>در حال ذخیره...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>ذخیره تغییرات در دیتابیس</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setViewingProject(null)}
                  className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
                  title="بستن"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Sub-toolbar: Search & Filter Tabs */}
            <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setCuesFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    cuesFilter === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  همه سطرها ({editedCues.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCuesFilter('translated')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    cuesFilter === 'translated' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-emerald-300'
                  }`}
                >
                  فارسی / تکمیل ({editedCues.filter(c => isCueProperlyTranslated(c.originalText, c.translatedText, 'fa')).length})
                </button>
                <button
                  type="button"
                  onClick={() => setCuesFilter('untranslated')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    cuesFilter === 'untranslated' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-400 hover:text-amber-300'
                  }`}
                >
                  انگلیسی / ناقص ({editedCues.filter(c => !isCueProperlyTranslated(c.originalText, c.translatedText, 'fa')).length})
                </button>
              </div>

              {/* Search in Cues */}
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={cuesSearch}
                  onChange={(e) => setCuesSearch(e.target.value)}
                  placeholder="جستجو در متن انگلیسی یا ترجمه..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pr-8 pl-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Cues List */}
            {isLoadingViewingProject ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                <span className="text-xs">در حال بارگذاری سطرهای زیرنویس از سرور...</span>
              </div>
            ) : editedCues.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500 text-xs">
                هیچ سطری در این فایل یافت نشد یا در حال دریافت است.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 divide-y divide-slate-800/40">
                {editedCues
                .filter((cue) => {
                  const isTranslated = isCueProperlyTranslated(cue.originalText, cue.translatedText, 'fa');
                  if (cuesFilter === 'translated' && !isTranslated) return false;
                  if (cuesFilter === 'untranslated' && isTranslated) return false;
                  if (cuesSearch.trim()) {
                    const q = cuesSearch.toLowerCase();
                    return cue.originalText.toLowerCase().includes(q) || (cue.translatedText || '').toLowerCase().includes(q);
                  }
                  return true;
                })
                .map((cue) => {
                  const isProper = isCueProperlyTranslated(cue.originalText, cue.translatedText, 'fa');
                  return (
                    <div
                      key={cue.id}
                      className={`pt-3 first:pt-0 flex flex-col gap-2 rounded-xl p-3 transition-colors ${
                        !isProper ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-slate-900/40 border border-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[11px]">
                            {cue.id}
                          </span>
                          <span dir="ltr" className="text-slate-300 font-mono inline-flex items-center gap-1.5" style={{ direction: 'ltr' }}>
                            <span>{cue.startTime}</span>
                            <span className="text-slate-500">➔</span>
                            <span>{cue.endTime}</span>
                          </span>
                        </div>
                        {!isProper ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-sans">
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            <span>نیازمند ترجمه فارسی / انگلیسی باقی مانده</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 font-sans">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>فارسی</span>
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Original English Text */}
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between gap-1 text-xs text-slate-300 direction-ltr font-sans">
                          <div className="whitespace-pre-wrap select-text">{cue.originalText}</div>
                          <div className="flex items-center justify-end text-[10px] text-slate-500 font-mono">
                            انگلیسی اصلی
                          </div>
                        </div>

                        {/* Editable Persian Translated Text */}
                        <div className="flex flex-col gap-1">
                          <textarea
                            rows={Math.max(2, (cue.translatedText || '').split('\n').length)}
                            value={cue.translatedText || ''}
                            placeholder="متن ترجمه فارسی را وارد کنید..."
                            onChange={(e) => {
                              const newVal = e.target.value;
                              setEditedCues((prev) =>
                                prev.map((c) => (c.id === cue.id ? { ...c, translatedText: newVal } : c))
                              );
                            }}
                            className={`w-full bg-slate-950 border rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 direction-rtl font-sans transition-colors resize-y ${
                              !isProper ? 'border-amber-500/50 focus:border-amber-400' : 'border-slate-800 focus:border-indigo-500'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3 flex-wrap text-xs">
              <span className="text-slate-400">
                هر ویرایشی انجام دهید با کلیک روی دکمه ذخیره، مستقیماً در دیتابیس سرور ثبت می‌شود.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewingProject(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  بستن
                </button>
                <button
                  type="button"
                  disabled={isSavingProjectItems}
                  onClick={handleSaveViewingProjectChanges}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {isSavingProjectItems ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>در حال ذخیره در سرور...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>ذخیره تغییرات زیرنویس</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
