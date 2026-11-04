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
  Zap
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
  const [customConcurrentInput, setCustomConcurrentInput] = useState<string>('6');
  const [fileFilter, setFileFilter] = useState<'all' | 'incomplete' | 'translating' | 'completed' | 'disrupted'>('all');
  const [activeQueueSubTab, setActiveQueueSubTab] = useState<'translating' | 'emergency' | 'untranslated' | 'completed'>('translating');

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

  const handleSetDualConcurrency = async (files?: number, _keysPerProject?: number) => {
    try {
      const targetFiles = files || serverConfig.maxConcurrentProjects || 4;
      const validFiles = Math.max(1, Math.min(targetFiles, 50));
      const payload: Record<string, any> = {
        maxConcurrentProjects: validFiles,
        maxKeysPerProject: 1, // Strictly 1 dedicated key per file
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
        onShowToast(`ظرفیت همزمانی سرور تنظیم شد: دقیقاً ${data.config.maxConcurrentProjects} فایل همزمان (هر فایل ۱ کلید اختصاصی از استخر).`, 'success');
      }
    } catch {
      onShowToast('خطا در به‌روزرسانی تنظیمات سرور', 'error');
    }
  };

  const handleSetConcurrency = (val: number) => handleSetDualConcurrency(val, 1);

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
        setCustomConcurrentInput(String(data.config.maxConcurrentProjects || 4));
      }
    } catch {}
  };

  // Fetch Keys Details
  const fetchServerKeys = async () => {
    try {
      const res = await fetch('/api/server/keys');
      const data = await res.json();
      if (data.success) {
        setServerKeysCount(data.count || 0);
        if (Array.isArray(data.details)) {
          setKeysDetails(data.details);
        }
      }
    } catch {}
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
    if (!window.confirm('آیا می‌خواهید تمام عملیات ترجمه در سرور را متوقف کنید؟ (تمامی سطرهای ترجمه‌شده قبلی کاملاً محفوظ می‌مانند)')) {
      return;
    }
    setIsStoppingAll(true);
    try {
      const res = await fetch('/api/worker/pause-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'تمام عملیات ترجمه با موفقیت متوقف شد.', 'info');
        await fetchFolders();
        if (selectedFolderId) await fetchProjects(selectedFolderId);
        await fetchAllProjects();
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

    try {
      const res = await fetch('/api/server/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: lines, mode: keySaveMode }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلیدها با موفقیت در سرور ثبت شدند.', 'success');
        setServerKeysText('');
        fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در ذخیره کلیدهای سرور', 'error');
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

        {/* Action Controls Toolbar - Fully Contained, Grouped & Wrapped so it never overflows */}
        <div className="w-full pt-3.5 border-t border-slate-800/80 flex flex-wrap items-center justify-start gap-2">
          {/* Action Group 1: Translation Execution */}
          <button
            type="button"
            onClick={handleStopAllTranslations}
            disabled={isStoppingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600/25 text-rose-300 hover:bg-rose-600/35 border border-rose-500/40 shadow-xs transition-all cursor-pointer"
            title="توقف اضطراری کل عملیات ترجمه در تمامی پوشه‌ها و فایل‌ها (سطرهای قبلی ۱۰۰٪ حفظ می‌شوند)"
          >
            {isStoppingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5 text-rose-400" />}
            <span>توقف ترجمه‌ها</span>
          </button>

          <button
            type="button"
            onClick={handleResumeAllTranslations}
            disabled={isResumingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600/25 text-emerald-300 hover:bg-emerald-600/35 border border-emerald-500/40 shadow-xs transition-all cursor-pointer"
            title="ادامه ترجمه تمام فایل‌های متوقف‌شده یا در انتظار در صف سرور"
          >
            {isResumingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />}
            <span>ادامه کل فایل‌ها</span>
          </button>

          <button
            type="button"
            onClick={() => handleRetryIncomplete(activeView === 'inside_folder' ? selectedFolderId : undefined)}
            disabled={isRetryingIncomplete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500/25 text-amber-300 hover:bg-amber-500/35 border border-amber-500/40 shadow-xs transition-all cursor-pointer"
            title="رفع خودکار اختلالات سهمیه، خطاها و ادامه ترجمه تمام فایل‌های ناقص"
          >
            {isRetryingIncomplete ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <RotateCcw className="w-3.5 h-3.5 text-amber-400" />}
            <span>🛠️ رفع خطای فایل‌های ناقص</span>
          </button>

          <button
            type="button"
            onClick={handleTurboComplete}
            disabled={isTurboCompleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-500/25 text-indigo-300 hover:bg-indigo-500/35 border border-indigo-500/40 shadow-xs transition-all cursor-pointer"
            title="تکمیل فوری و اولویت‌دار فایل‌های ناقص (۹۸٪ به بالا) بدون معطلی و با رفع خودکار افکت‌های صوتی"
          >
            {isTurboCompleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>⚡ تکمیل فوری سطرها (توربو)</span>
          </button>

          <span className="hidden sm:inline-block w-px h-5 bg-slate-800 mx-0.5" />

          {/* Action Group 2: Database & Audit */}
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 text-cyan-300 hover:bg-slate-800 hover:text-cyan-200 border border-cyan-500/30 transition-colors shadow-xs cursor-pointer"
            title="دانلود فایل پشتیبان کامل دیتابیس سرور شامل تمام پروژه‌ها و زیرنویس‌ها"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>پشتیبان‌گیری (Backup)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsRestoreModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 text-amber-300 hover:bg-slate-800 hover:text-amber-200 border border-amber-500/30 transition-colors shadow-xs cursor-pointer"
            title="بازیابی کل دیتابیس از فایل JSON پشتیبان (با پشتیبانی از فایل‌های سنگین)"
          >
            <UploadCloud className="w-3.5 h-3.5 text-amber-400" />
            <span>بازیابی (Restore)</span>
          </button>

          <button
            type="button"
            onClick={handleAuditAndFixEnglish}
            disabled={isAuditing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors shadow-xs cursor-pointer"
            title="بررسی دقیق تمام زیرنویس‌ها برای یافتن هرگونه سطر انگلیسی باقی‌مانده و ترجمه مجدد ۱۰۰٪ فارسی آن‌ها"
          >
            {isAuditing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>رفع سطور انگلیسی</span>
          </button>

          <span className="hidden sm:inline-block w-px h-5 bg-slate-800 mx-0.5" />

          {/* Action Group 3: Server & Key Management */}
          <button
            type="button"
            onClick={() => {
              fetchServerKeys();
              setIsKeysModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors shadow-xs cursor-pointer"
            title="مدیریت، چرخش خودکار و تست کلیدهای API از روی سرور"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>استخر کلیدها ({serverKeysCount} فعال)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              fetchServerConfig();
              setIsServerConfigOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 text-violet-300 hover:bg-slate-800 hover:text-violet-200 border border-violet-500/30 transition-colors shadow-xs cursor-pointer"
            title="تنظیمات دامنه مجاز (ALLOWED_ORIGIN)، پراکسی جمینای (GEMINI_BASE_URL) و تعداد ترجمه همزمان"
          >
            <Settings className="w-3.5 h-3.5 text-violet-400" />
            <span>تنظیمات سرور</span>
          </button>
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
                    const isDefault = num === 6;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleSetDualConcurrency(num, 1)}
                        className={`relative px-3 py-1.5 rounded-xl font-mono font-bold text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/40 border border-indigo-400 scale-105'
                            : 'bg-slate-800/90 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700/70'
                        }`}
                        title={`ترجمه همزمان ${num} فایل با ${num} کلید مجزا (بقیه در رزرو)`}
                      >
                        <span>{num} فایل</span>
                        {isDefault && (
                          <span className={`absolute -top-2 -right-1 text-[9px] font-sans px-1 py-0.2 rounded-full font-extrabold ${
                            isSelected ? 'bg-amber-400 text-slate-950' : 'bg-indigo-950 text-amber-300 border border-amber-500/50'
                          }`}>
                            پیش‌فرض
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* The ONLY Primary Action Button: "ترجمه فایل‌های ناقص یا ترجمه‌نشده" */}
              <div className="flex items-center gap-2 shrink-0 self-start lg:self-center">
                <button
                  type="button"
                  onClick={() => handleRetryIncomplete(currentFolder?.id)}
                  disabled={isRetryingIncomplete}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs transition-all cursor-pointer shadow-xl ${
                    folderIncompleteOrUntranslated.length > 0
                      ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 text-slate-950 hover:brightness-110 shadow-amber-500/30 ring-2 ring-amber-400/50 scale-[1.02]'
                      : 'bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 border border-indigo-500/40'
                  }`}
                  title="شروع ترجمه فایل‌های ناقص یا ترجمه‌نشده این پوشه با اولویت اضطراری (اولویت ۱) و اختصاص ۶ کلید همزمان"
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

            {/* Clean File List of this Folder */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-semibold">
                <span>لیست فایل‌های پوشه ({sortedDisplayProjects.length} فایل):</span>
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
                    const isTranslating = p.status === 'translating' || Boolean(activeItem);
                    const isCompleted = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
                    const pct = activeItem
                      ? activeItem.progressPercent
                      : (p.totalCues > 0 ? Math.floor((p.translatedCues / p.totalCues) * 100) : 0);
                    const transCues = activeItem ? activeItem.translatedCues : p.translatedCues;
                    const totCues = activeItem ? activeItem.totalCues : p.totalCues;
                    const remaining = Math.max(0, totCues - transCues);
                    const keyMask = activeItem?.keyMasked || (p.workerKeyUsed ? p.workerKeyUsed.slice(0, 4) + '...' + p.workerKeyUsed.slice(-4) : null);

                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl p-3 flex flex-col gap-2 border transition-all ${
                          isTranslating
                            ? 'bg-slate-900 border-amber-500/50 shadow-md shadow-amber-500/10'
                            : isCompleted
                            ? 'bg-slate-950/80 border-emerald-500/25 hover:border-emerald-500/40'
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
                            ) : Boolean(p.isPriority) ? (
                              <Zap className="w-4 h-4 text-rose-400 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-slate-500 shrink-0" />
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
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : isCompleted
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : remaining > 0 && transCues > 0
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {isTranslating
                                ? `در حال ترجمه (${pct}%)`
                                : isCompleted
                                ? 'تکمیل شده (۱۰۰٪)'
                                : remaining > 0 && transCues > 0
                                ? `ناقص (${remaining} سطر مانده)`
                                : 'ترجمه‌نشده'}
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
                                title="توقف موقت"
                              >
                                <Pause className="w-3 h-3" />
                                <span>توقف</span>
                              </button>
                            ) : !isCompleted ? (
                              <button
                                type="button"
                                onClick={() => handleStartProject(p.id, p.name)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer transition-colors shadow-xs"
                                title="شروع ترجمه این فایل"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>شروع</span>
                              </button>
                            ) : (
                              <a
                                href={`/api/projects/${p.id}/export/srt`}
                                download
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30"
                                title="دانلود زیرنویس SRT"
                              >
                                <Download className="w-3 h-3" />
                                <span>SRT</span>
                              </a>
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
                              <span>{proj.lastError.includes('429') ? 'محدودیت سهمیه موقت کلید جمینای (429 Quota Exhausted)' : proj.lastError}</span>
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
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  کلمه یا عبارت جستجو:
                </label>
                <input
                  type="text"
                  value={batchFindText}
                  onChange={(e) => setBatchFindText(e.target.value)}
                  placeholder="مثال: موجودات فضایی"
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

      {/* Modal: Server Keys Management Dashboard & Token Analytics */}
      {isKeysModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 lg:p-7 w-full max-w-4xl shadow-2xl flex flex-col gap-5 animate-scale-up max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <span>مدیریت استخر کلیدهای هوش مصنوعی و آمار مصرف توکن</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Gemini 3.5 Flash Lite
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    نمایش وضعیت زنده، میزان توکن مصرفی هر کلید، چرخش خودکار و رفع وقفه سهمیه
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

            {/* KPI Summary Cards */}
            {(() => {
              const totalKeys = keysDetails.length;
              const activeKeys = keysDetails.filter((k) => !k.isExhausted).length;
              const restingKeys = keysDetails.filter((k) => k.isExhausted).length;
              const totalTokensSum = keysDetails.reduce((acc, k) => acc + (k.totalTokens || 0), 0);
              const totalReqsSum = keysDetails.reduce((acc, k) => acc + (k.requestsCount || 0), 0);

              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-indigo-400" />
                      <span>کلیدهای ثبت‌شده</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-white">{totalKeys}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>کلیدهای آماده و فعال</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-emerald-400">{activeKeys}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-rose-400" />
                      <span>وقفه موقت (۱ دقیقه)</span>
                    </span>
                    <span className="text-xl font-bold font-mono text-rose-400">{restingKeys}</span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>مجموع توکن مصرفی</span>
                    </span>
                    <span className="text-lg font-bold font-mono text-amber-300">
                      {totalTokensSum.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      در {totalReqsSum} درخواست API
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Quick Actions & Optimization Guidance */}
            <div className="bg-gradient-to-r from-indigo-950/60 via-slate-950/90 to-indigo-950/60 border border-indigo-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
              <div className="flex flex-col gap-1 text-xs text-slate-300 leading-relaxed">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>بهینه‌سازی حداکثری مصرف توکن و زمان استراحت کلیدها:</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  • دسته‌ها به <span className="text-emerald-300 font-bold font-mono">۵۰ سطر</span> در هر درخواست افزایش یافت تا پرامپت تکراری حذف و <span className="text-emerald-300 font-bold">بیش از ۶۰٪ در مصرف توکن صرفه‌جویی شود</span>.
                </p>
                <p className="text-[11px] text-slate-300">
                  • زمان خنک‌سازی سهمیه به جای ۱۵ دقیقه، تنها روی <span className="text-amber-300 font-bold font-mono">۶۰ ثانیه</span> تنظیم شد تا در چرخش ۱۱ کلید، کلیدها بدون توقف آماده استفاده باشند.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  onClick={handleResetAllCooldowns}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
                  title="خارج کردن تمام کلیدها از حالت وقفه و فعال‌سازی فوری"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>رفع وقفه فوری تمام کلیدها</span>
                </button>
              </div>
            </div>

            {/* Registered Keys List with Token Usage Table */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  <span>فهرست کامل کلیدها و گزارش تفکیکی توکن ({keysDetails.length} کلید)</span>
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetKeyStats}
                    className="text-[11px] text-slate-400 hover:text-amber-300 transition-colors flex items-center gap-1 bg-slate-800/60 px-2 py-1 rounded-lg border border-slate-700/60 cursor-pointer"
                    title="صفر کردن کنتور توکن‌ها برای محاسبه جدید"
                  >
                    <Trash2 className="w-3 h-3 text-slate-400" />
                    <span>ریست آمار توکن‌ها</span>
                  </button>

                  <button
                    type="button"
                    onClick={fetchServerKeys}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>بروزرسانی وضعیت</span>
                  </button>
                </div>
              </div>

              {keysDetails.length === 0 ? (
                <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-center">
                  هنوز هیچ کلیدی در سرور ذخیره نشده است. با استفاده از کادر زیر کلیدهای Gemini خود را وارد کنید.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1 border border-slate-800/80 rounded-2xl p-2 bg-slate-950/50">
                  {keysDetails.map((k) => (
                    <div
                      key={k.index}
                      className={`flex flex-col p-3 rounded-xl border text-xs transition-all ${
                        k.isExhausted
                          ? 'bg-rose-500/5 border-rose-500/30'
                          : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {editingKeyIndex === k.index ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingKeyVal}
                            onChange={(e) => setEditingKeyVal(e.target.value)}
                            className="w-full bg-slate-950 border border-indigo-500 rounded-lg px-2.5 py-1 text-xs text-white font-mono direction-ltr"
                            placeholder="AIzaSy..."
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateSingleKey(k.index)}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shrink-0 cursor-pointer"
                          >
                            ذخیره
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKeyIndex(null);
                              setEditingKeyVal('');
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs shrink-0 cursor-pointer"
                          >
                            انصراف
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                          {/* Key Identity & Status */}
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-mono text-slate-300 font-bold shrink-0">
                              #{k.index + 1}
                            </span>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-white tracking-wider truncate font-semibold">
                                  {k.maskedKey}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(k.rawKey);
                                    onShowToast('کلید در کلیپ‌بورد کپی شد.', 'info');
                                  }}
                                  className="text-slate-500 hover:text-slate-300 p-0.5"
                                  title="کپی کلید کامل"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>

                              <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-0.5">
                                {k.isDisabled ? (
                                  <span className="flex items-center gap-1 text-rose-400 font-bold bg-rose-500/15 px-2 py-0.5 rounded-md border border-rose-500/30">
                                    <AlertCircle className="w-3 h-3 text-rose-400" />
                                    <span>غیرفعال (۴۰۱ - حذف‌شده یا فاقد دسترسی در گوگل)</span>
                                  </span>
                                ) : k.isExhausted ? (
                                  <span className="flex items-center gap-1 text-amber-400 font-semibold bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                                    <Clock className="w-3 h-3" />
                                    <span>وقفه سهمیه ({k.cooldownRemainingSec}s مانده)</span>
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>آماده و فعال در صف چرخش</span>
                                  </span>
                                )}

                                {k.lastUsedAt && (
                                  <span className="text-slate-500 font-mono">
                                    آخرین استفاده: {new Date(k.lastUsedAt).toLocaleTimeString('fa-IR')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Token Consumption Stats Badges */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[11px]">
                              <span className="text-slate-400">درخواست‌ها:</span>
                              <span className="font-mono text-white font-bold">{k.requestsCount || 0}</span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[11px]">
                              <span className="text-slate-400">توکن ورودی:</span>
                              <span className="font-mono text-cyan-300">{(k.promptTokens || 0).toLocaleString()}</span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[11px]">
                              <span className="text-slate-400">توکن ترجمه:</span>
                              <span className="font-mono text-emerald-300">{(k.candidatesTokens || 0).toLocaleString()}</span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-indigo-950/60 px-2 py-1 rounded-lg border border-indigo-500/30 text-[11px]">
                              <span className="text-indigo-300 font-bold">کل توکن:</span>
                              <span className="font-mono text-amber-300 font-bold">{(k.totalTokens || 0).toLocaleString()}</span>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center">
                            {k.isExhausted && (
                              <button
                                type="button"
                                onClick={() => handleResetSingleCooldown(k.index)}
                                className="px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-bold transition-colors cursor-pointer"
                                title="رفع وقفه این کلید و آماده‌سازی فوری"
                              >
                                رفع وقفه
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleTestServerKey(k.rawKey)}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold transition-colors cursor-pointer"
                              title="تست آنلاین این کلید از روی سرور"
                            >
                              تست زنده
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setEditingKeyIndex(k.index);
                                setEditingKeyVal(k.rawKey);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
                              title="ویرایش کلید"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteSingleKey(k.index)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
                              title="حذف کلید"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Server-Side Key Ping Test Box */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>تست آنلاین ارتباط و سرعت مدل Gemini 3.5 Flash Lite از روی سرور</span>
                </span>
                <button
                  type="button"
                  disabled={isTestingKey}
                  onClick={() => handleTestServerKey()}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isTestingKey ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>در حال تست اتصال از سرور...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span>تست آنلاین کلید اصلی</span>
                    </>
                  )}
                </button>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-xl text-xs leading-relaxed border ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>{testResult.success ? '✓ پاسخ موفق سرور جمینای' : '✗ خطا در پاسخگویی سرور'}</span>
                    {testResult.latencyMs && (
                      <span className="font-mono text-[11px] bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
                        زمان پاسخ: {testResult.latencyMs} میلی‌ثانیه | مدل: {testResult.modelUsed || 'Gemini 3.5 Flash Lite'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-90">{testResult.message}</p>
                </div>
              )}
            </div>

            {/* Batch Add Keys Form */}
            <form onSubmit={handleSaveServerKeys} className="flex flex-col gap-3 pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs text-slate-300 font-semibold block">
                  افزودن کلیدهای API جدید به استخر (هر کلید در یک سطر):
                </label>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="keyMode"
                      value="append"
                      checked={keySaveMode === 'append'}
                      onChange={() => setKeySaveMode('append')}
                      className="accent-indigo-500"
                    />
                    <span>افزودن به استخر موجود</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="keyMode"
                      value="replace"
                      checked={keySaveMode === 'replace'}
                      onChange={() => setKeySaveMode('replace')}
                      className="accent-indigo-500"
                    />
                    <span>جایگزینی کل استخر کلیدها</span>
                  </label>
                </div>
              </div>

              <textarea
                rows={3}
                value={serverKeysText}
                onChange={(e) => setServerKeysText(e.target.value)}
                placeholder={"AIzaSy...\nAIzaSy..."}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-amber-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr placeholder-slate-600"
              />

              <div className="flex items-center justify-end gap-2.5 mt-1">
                <button
                  type="button"
                  onClick={() => setIsKeysModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  بستن پنجره
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>ثبت و ذخیره کلیدها</span>
                </button>
              </div>
            </form>
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
                          <span className="text-slate-300 dir-ltr">{cue.startTime} ➔ {cue.endTime}</span>
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
