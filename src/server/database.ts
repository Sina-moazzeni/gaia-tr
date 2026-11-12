import fs from 'fs';
import path from 'path';
import { SubtitleItem } from '../types';
import { isCueProperlyTranslated } from '../lib/subtitleParser';

export interface ServerFolder {
  id: string;
  name: string;
  description?: string;
  tone?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'idle' | 'queued' | 'translating' | 'paused' | 'waiting_for_keys' | 'has_incomplete' | 'completed' | 'error';

export interface ServerSubtitleProject {
  id: string;
  folderId: string;
  name: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sub';
  rawHeader?: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone: string;
  customPrompt?: string;
  status: ProjectStatus;
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

export interface ServerConfig {
  allowedOrigin: string; // default '*'
  geminiBaseUrl: string; // default 'https://generativelanguage.googleapis.com'
  maxConcurrentProjects: number; // default 8 (Active files concurrently translating)
  maxTotalParallelKeys?: number; // default 19 (Total parallel key workers across files)
  maxKeysPerProject?: number; // default 2 (Max parallel keys assigned per single file)
}

export interface KeyUsageRecord {
  requestsCount: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  lastUsedAt?: string;
  lastError?: string;
}

export interface CustomServerConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeys?: string[]; // multiple keys for this proxy broker (e.g. dozens of DeepSeek broker keys)
  model: string;
  isEnabled?: boolean;
  createdAt?: string;
  requestsCount?: number;
  tokensCount?: number;
}

export type ProviderType = 'custom' | 'gemini' | 'openai' | 'claude';

export interface ProviderPingRecord {
  provider: ProviderType;
  latencyMs: number;
  lastCheckedAt: string;
  isAvailable: boolean;
  model?: string;
  note?: string;
}

export interface FallbackAIConfig {
  openaiKeys: string[];
  openaiModel: string; // e.g. 'gpt-4o-mini'
  claudeKeys: string[];
  claudeModel: string; // e.g. 'claude-3-5-haiku-20241022'
  customConfig?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    name?: string;
  };
  customServers?: CustomServerConfig[];
  providerStrategy:
    | 'lowest_ping'
    | 'custom_priority'
    | 'custom_first'
    | 'gemini_with_fallback'
    | 'gemini_only'
    | 'openai'
    | 'claude'
    | 'custom';
  priorityOrder?: ProviderType[]; // Ordered list of providers (e.g. ['custom', 'gemini', 'openai', 'claude'])
  providerLatencies?: Record<string, ProviderPingRecord>;
}

export interface UnifiedKeyEntry {
  id: string;
  provider: ProviderType;
  key: string;
  maskedKey: string;
  name: string;
  model: string;
  baseUrl?: string;
  priority: number;
  isEnabled: boolean;
  requestsCount: number;
  totalTokens: number;
  promptTokens?: number;
  candidatesTokens?: number;
  lastUsedAt?: string;
  lastError?: string;
  latencyMs?: number;
  createdAt: string;
}

export interface SubtitlesDatabase {
  version: number;
  folders: ServerFolder[];
  projects: ServerSubtitleProject[];
  serverKeys: string[];
  unifiedKeys?: UnifiedKeyEntry[];
  activeKeyIndex: number;
  serverConfig?: ServerConfig;
  fallbackAiConfig?: FallbackAIConfig;
  customServers?: CustomServerConfig[];
  keyStats?: Record<string, KeyUsageRecord>;
  stats: {
    totalTranslations: number;
    totalTokensUsed: number;
  };
}

const DATA_DIR = process.env.DATA_DIR?.trim() || process.env.SUBTITLES_DB_DIR?.trim() || path.join(process.cwd(), 'data');
const DB_FILE = process.env.SUBTITLES_DB_PATH?.trim() || path.join(DATA_DIR, 'subtitles_db.json');
const DB_TMP_FILE = path.join(DATA_DIR, 'subtitles_db.json.tmp');

let inMemoryDb: SubtitlesDatabase | null = null;
let saveDebounceTimer: NodeJS.Timeout | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export const DEFAULT_FALLBACK_AI_CONFIG: FallbackAIConfig = {
  openaiKeys: [],
  openaiModel: 'gpt-4o-mini',
  claudeKeys: [],
  claudeModel: 'claude-3-5-haiku-20241022',
  customConfig: {
    baseUrl: '',
    apiKey: '',
    model: 'deepseek-chat',
    name: 'سرویس سفارشی',
  },
  customServers: [],
  providerStrategy: 'lowest_ping', // Default: Lowest Ping / Fastest response
  priorityOrder: ['custom', 'gemini', 'openai', 'claude'], // DeepSeek/Custom is first by default
  providerLatencies: {},
};

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || '*',
  geminiBaseUrl: process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com',
  maxConcurrentProjects: Number(process.env.MAX_CONCURRENT_PROJECTS) || 6,
  maxTotalParallelKeys: Number(process.env.MAX_PARALLEL_KEYS) || 19,
  maxKeysPerProject: 2,
};

function loadDatabaseFromDisk(): SubtitlesDatabase {
  ensureDataDir();

  const defaultDb: SubtitlesDatabase = {
    version: 1,
    folders: [
      {
        id: 'folder_cosmic_disclosure_s01',
        name: 'افشای کیهانی فصل اول',
        description: 'پوشه پیش‌فرض زیرنویس‌های مستند افشای کیهانی (Cosmic Disclosure Season 1)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    projects: [],
    serverKeys: [],
    activeKeyIndex: 0,
    stats: {
      totalTranslations: 0,
      totalTokensUsed: 0,
    },
  };

  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB] Failed to create initial database file:', e);
    }
    return defaultDb;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.folders || !Array.isArray(parsed.folders)) {
      parsed.folders = defaultDb.folders;
    }
    if (!parsed.projects || !Array.isArray(parsed.projects)) {
      parsed.projects = [];
    }
    if (!parsed.serverKeys || !Array.isArray(parsed.serverKeys)) {
      parsed.serverKeys = [];
    }
    if (parsed.activeKeyIndex === undefined) {
      parsed.activeKeyIndex = 0;
    }
    if (!parsed.stats) {
      parsed.stats = { totalTranslations: 0, totalTokensUsed: 0 };
    }
    if (!parsed.customServers || !Array.isArray(parsed.customServers)) {
      parsed.customServers = [];
    }
    if (!parsed.unifiedKeys || !Array.isArray(parsed.unifiedKeys)) {
      parsed.unifiedKeys = [];
    }
    if (!parsed.fallbackAiConfig) {
      parsed.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
    } else {
      if (!parsed.fallbackAiConfig.priorityOrder || !Array.isArray(parsed.fallbackAiConfig.priorityOrder)) {
        parsed.fallbackAiConfig.priorityOrder = ['custom', 'gemini', 'openai', 'claude'];
      }
      if (!parsed.fallbackAiConfig.providerLatencies) {
        parsed.fallbackAiConfig.providerLatencies = {};
      }
    }
    if (!parsed.serverConfig) {
      parsed.serverConfig = { ...DEFAULT_SERVER_CONFIG };
    } else {
      parsed.serverConfig = {
        allowedOrigin: parsed.serverConfig.allowedOrigin ?? DEFAULT_SERVER_CONFIG.allowedOrigin,
        geminiBaseUrl: parsed.serverConfig.geminiBaseUrl ?? DEFAULT_SERVER_CONFIG.geminiBaseUrl,
        maxConcurrentProjects: Number(parsed.serverConfig.maxConcurrentProjects) || DEFAULT_SERVER_CONFIG.maxConcurrentProjects,
      };
    }
    return parsed;
  } catch (err) {
    console.error('[DB] Error parsing database file, returning default:', err);
    return defaultDb;
  }
}

let hasAuditedOnStartup = false;

export function getDatabase(): SubtitlesDatabase {
  if (!inMemoryDb) {
    inMemoryDb = loadDatabaseFromDisk();
    if (!hasAuditedOnStartup) {
      hasAuditedOnStartup = true;
      setTimeout(() => {
        try { auditAndFixEnglishCues(); } catch {}
      }, 500);
    }
  }
  return inMemoryDb;
}

let isDiskSaving = false;
let hasPendingDiskSave = false;

export function saveDatabaseSync(): void {
  if (!inMemoryDb) return;
  if (isDiskSaving) {
    hasPendingDiskSave = true;
    return;
  }
  isDiskSaving = true;
  ensureDataDir();
  try {
    const serialized = JSON.stringify(inMemoryDb);
    fs.writeFile(DB_TMP_FILE, serialized, 'utf-8', (err) => {
      if (!err) {
        try { fs.renameSync(DB_TMP_FILE, DB_FILE); } catch {}
      }
      isDiskSaving = false;
      if (hasPendingDiskSave) {
        hasPendingDiskSave = false;
        setTimeout(() => saveDatabaseSync(), 250);
      }
    });
  } catch (err) {
    isDiskSaving = false;
    console.error('[DB] Error saving database:', err);
  }
}

export function scheduleSaveDatabase(): void {
  saveDatabaseSync();
}

// ─── Folder Operations ────────────────────────────────────────────────────────

export function getAllFolders(): (ServerFolder & { projectCount: number; completedCount: number })[] {
  const db = getDatabase();
  return db.folders.map((folder) => {
    const folderProjects = db.projects.filter((p) => p.folderId === folder.id);
    const completedCount = folderProjects.filter((p) => p.status === 'completed').length;
    return {
      ...folder,
      projectCount: folderProjects.length,
      completedCount,
    };
  });
}

export function getFolderById(id: string): ServerFolder | undefined {
  const db = getDatabase();
  return db.folders.find((f) => f.id === id);
}

export function createFolder(name: string, description?: string, tone?: string): ServerFolder {
  const db = getDatabase();
  const folder: ServerFolder = {
    id: 'folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    name: name.trim(),
    description: description?.trim(),
    tone: tone?.trim() || 'cinematic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.folders.push(folder);
  saveDatabaseSync();
  return folder;
}

export function updateFolder(id: string, updates: Partial<Pick<ServerFolder, 'name' | 'description' | 'tone'>>): ServerFolder | null {
  const db = getDatabase();
  const folder = db.folders.find((f) => f.id === id);
  if (!folder) return null;
  if (updates.name) folder.name = updates.name.trim();
  if (updates.description !== undefined) folder.description = updates.description.trim();
  if (updates.tone !== undefined) {
    folder.tone = updates.tone.trim();
    // Also propagate to all projects currently in this folder
    db.projects.forEach((p) => {
      if (p.folderId === id) {
        p.tone = folder.tone || 'cinematic';
      }
    });
  }
  folder.updatedAt = new Date().toISOString();
  saveDatabaseSync();
  return folder;
}

export function deleteFolder(id: string): boolean {
  const db = getDatabase();
  const initialLength = db.folders.length;
  db.folders = db.folders.filter((f) => f.id !== id);
  // Also remove all projects in this folder
  db.projects = db.projects.filter((p) => p.folderId !== id);
  if (db.folders.length !== initialLength) {
    saveDatabaseSync();
    return true;
  }
  return false;
}

export function batchReplaceInFolder(
  folderId: string,
  options: {
    findText: string;
    replaceText: string;
    scope?: 'translated' | 'both';
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
  }
): {
  totalReplacements: number;
  affectedFilesCount: number;
  fileDetails: Array<{ fileId: string; fileName: string; count: number }>;
} {
  const db = getDatabase();
  const projects = db.projects.filter((p) => p.folderId === folderId);
  const { findText, replaceText, scope = 'translated', matchCase = false, wholeWord = false, useRegex = false } = options;

  let pattern: RegExp;
  try {
    if (useRegex) {
      pattern = new RegExp(findText, matchCase ? 'gu' : 'giu');
    } else {
      let escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        // Unicode-aware word boundary for Persian, Arabic, English, etc.
        escaped = `(?<=^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`;
      }
      pattern = new RegExp(escaped, matchCase ? 'gu' : 'giu');
    }
  } catch {
    return { totalReplacements: 0, affectedFilesCount: 0, fileDetails: [] };
  }

  let totalReplacements = 0;
  const fileDetails: Array<{ fileId: string; fileName: string; count: number }> = [];

  for (const project of projects) {
    let projectCount = 0;
    project.items = project.items.map((item) => {
      let modified = false;
      let newTranslated = item.translatedText;
      let newOriginal = item.originalText;

      if (scope === 'translated' || scope === 'both') {
        if (newTranslated) {
          const matches = newTranslated.match(pattern);
          if (matches) {
            projectCount += matches.length;
            newTranslated = newTranslated.replace(pattern, replaceText);
            modified = true;
          }
        }
      }

      if (scope === 'both') {
        if (newOriginal) {
          const matches = newOriginal.match(pattern);
          if (matches) {
            projectCount += matches.length;
            newOriginal = newOriginal.replace(pattern, replaceText);
            modified = true;
          }
        }
      }

      if (modified) {
        return {
          ...item,
          translatedText: newTranslated,
          originalText: newOriginal,
        };
      }
      return item;
    });

    if (projectCount > 0) {
      project.updatedAt = new Date().toISOString();
      totalReplacements += projectCount;
      fileDetails.push({
        fileId: project.id,
        fileName: project.name,
        count: projectCount,
      });
    }
  }

  if (totalReplacements > 0) {
    saveDatabaseSync();
  }

  return {
    totalReplacements,
    affectedFilesCount: fileDetails.length,
    fileDetails,
  };
}

// ─── Project Operations ───────────────────────────────────────────────────────

export function getProjectsByFolder(folderId: string): ServerSubtitleProject[] {
  const db = getDatabase();
  return db.projects.filter((p) => p.folderId === folderId);
}

export function getAllProjects(): ServerSubtitleProject[] {
  const db = getDatabase();
  return db.projects;
}

export function getProjectById(id: string): ServerSubtitleProject | undefined {
  const db = getDatabase();
  return db.projects.find((p) => p.id === id);
}

export function createProject(data: {
  folderId: string;
  name: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sub';
  rawHeader?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  tone?: string;
  customPrompt?: string;
  items: SubtitleItem[];
  autoQueue?: boolean;
}): ServerSubtitleProject {
  const db = getDatabase();
  const totalCues = data.items.length;
  const translatedCues = data.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;

  const project: ServerSubtitleProject = {
    id: 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    folderId: data.folderId,
    name: data.name,
    format: data.format,
    rawHeader: data.rawHeader,
    sourceLanguage: data.sourceLanguage || 'auto',
    targetLanguage: data.targetLanguage || 'fa',
    tone: data.tone || 'cinematic',
    customPrompt: data.customPrompt,
    status: data.autoQueue ? 'queued' : 'idle',
    totalCues,
    translatedCues,
    currentBatchIndex: 0,
    totalBatches: Math.ceil(totalCues / 25),
    items: data.items,
    tokenUsage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.projects.push(project);
  saveDatabaseSync();
  return project;
}

export function updateProject(id: string, updates: Partial<ServerSubtitleProject>): ServerSubtitleProject | null {
  const db = getDatabase();
  const project = db.projects.find((p) => p.id === id);
  if (!project) return null;

  Object.assign(project, updates);
  if (updates.items && Array.isArray(updates.items)) {
    project.totalCues = project.items.length;
    project.translatedCues = project.items.filter((i) =>
      isCueProperlyTranslated(i.originalText, i.translatedText, project.targetLanguage)
    ).length;
    if (project.translatedCues >= project.totalCues && project.totalCues > 0) {
      project.status = 'completed';
      project.completedAt = project.completedAt || new Date().toISOString();
    }
  }
  project.updatedAt = new Date().toISOString();
  saveDatabaseSync();
  return project;
}

export function deleteProject(id: string): boolean {
  const db = getDatabase();
  const initialLength = db.projects.length;
  db.projects = db.projects.filter((p) => p.id !== id);
  if (db.projects.length !== initialLength) {
    saveDatabaseSync();
    return true;
  }
  return false;
}

// ─── Server Configuration Operations ──────────────────────────────────────────

export function getServerConfig(): ServerConfig {
  const db = getDatabase();
  const allKeys = getServerKeys();
  if (!db.serverConfig) {
    db.serverConfig = { ...DEFAULT_SERVER_CONFIG };
    saveDatabaseSync();
  }
  // Default to 6 concurrent projects if not set, allow any user-configured value between 1 and 24
  if (!db.serverConfig.maxConcurrentProjects || db.serverConfig.maxConcurrentProjects < 1) {
    db.serverConfig.maxConcurrentProjects = 6;
  }
  // Default to 2 keys per project if not set
  if (!db.serverConfig.maxKeysPerProject || db.serverConfig.maxKeysPerProject < 1) {
    db.serverConfig.maxKeysPerProject = 2;
  }
  const idealParallelKeys = Math.max(allKeys.length, db.serverConfig.maxConcurrentProjects);
  if (!db.serverConfig.maxTotalParallelKeys || db.serverConfig.maxTotalParallelKeys < 1) {
    db.serverConfig.maxTotalParallelKeys = Math.min(32, Math.max(4, idealParallelKeys));
  }
  return db.serverConfig;
}

export function updateServerConfig(updates: Partial<ServerConfig>): ServerConfig {
  const db = getDatabase();
  if (!db.serverConfig) {
    db.serverConfig = { ...DEFAULT_SERVER_CONFIG };
  }
  if (updates.allowedOrigin !== undefined) {
    db.serverConfig.allowedOrigin = updates.allowedOrigin.trim() || '*';
  }
  if (updates.geminiBaseUrl !== undefined) {
    db.serverConfig.geminiBaseUrl = updates.geminiBaseUrl.trim() || 'https://generativelanguage.googleapis.com';
  }
  if (updates.maxConcurrentProjects !== undefined) {
    const val = Number(updates.maxConcurrentProjects);
    db.serverConfig.maxConcurrentProjects = Math.max(1, Math.min(val || 2, 24));
  }
  if (updates.maxTotalParallelKeys !== undefined) {
    const val = Number(updates.maxTotalParallelKeys);
    db.serverConfig.maxTotalParallelKeys = Math.max(1, Math.min(val || 8, 32));
  }
  if (updates.maxKeysPerProject !== undefined) {
    const val = Number(updates.maxKeysPerProject);
    db.serverConfig.maxKeysPerProject = Math.max(1, Math.min(val || 1, 8));
  }
  saveDatabaseSync();
  return db.serverConfig;
}

// ─── Fallback AI Configuration (OpenAI, Claude, Custom) ──────────────────────

export function getFallbackAIConfig(): FallbackAIConfig {
  const db = getDatabase();
  if (!db.fallbackAiConfig) {
    db.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
    saveDatabaseSync();
  }
  return db.fallbackAiConfig;
}

export function updateFallbackAIConfig(updates: Partial<FallbackAIConfig>): FallbackAIConfig {
  const db = getDatabase();
  if (!db.fallbackAiConfig) {
    db.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
  }
  if (updates.openaiKeys !== undefined) {
    db.fallbackAiConfig.openaiKeys = updates.openaiKeys.map((k) => k.trim()).filter(Boolean);
  }
  if (updates.openaiModel !== undefined) {
    db.fallbackAiConfig.openaiModel = updates.openaiModel.trim() || 'gpt-4o-mini';
  }
  if (updates.claudeKeys !== undefined) {
    db.fallbackAiConfig.claudeKeys = updates.claudeKeys.map((k) => k.trim()).filter(Boolean);
  }
  if (updates.claudeModel !== undefined) {
    db.fallbackAiConfig.claudeModel = updates.claudeModel.trim() || 'claude-3-5-haiku-20241022';
  }
  if (updates.customConfig !== undefined) {
    db.fallbackAiConfig.customConfig = {
      baseUrl: updates.customConfig.baseUrl?.trim() || '',
      apiKey: updates.customConfig.apiKey?.trim() || '',
      model: updates.customConfig.model?.trim() || 'deepseek-chat',
      name: updates.customConfig.name?.trim() || 'سرویس سفارشی',
    };
  }
  if (updates.providerStrategy !== undefined) {
    db.fallbackAiConfig.providerStrategy = updates.providerStrategy;
  }
  if (updates.priorityOrder !== undefined && Array.isArray(updates.priorityOrder)) {
    db.fallbackAiConfig.priorityOrder = updates.priorityOrder;
  }
  if (updates.providerLatencies !== undefined) {
    db.fallbackAiConfig.providerLatencies = {
      ...(db.fallbackAiConfig.providerLatencies || {}),
      ...updates.providerLatencies,
    };
  }
  saveDatabaseSync();
  return db.fallbackAiConfig;
}

export function recordProviderPing(
  provider: ProviderType,
  latencyMs: number,
  isAvailable = true,
  model?: string,
  note?: string
): ProviderPingRecord {
  const db = getDatabase();
  if (!db.fallbackAiConfig) db.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
  if (!db.fallbackAiConfig.providerLatencies) db.fallbackAiConfig.providerLatencies = {};

  const record: ProviderPingRecord = {
    provider,
    latencyMs: Math.max(1, Math.round(latencyMs)),
    lastCheckedAt: new Date().toISOString(),
    isAvailable,
    model,
    note,
  };

  db.fallbackAiConfig.providerLatencies[provider] = record;
  saveDatabaseSync();
  return record;
}

export function getProviderPings(): Record<string, ProviderPingRecord> {
  const db = getDatabase();
  return db.fallbackAiConfig?.providerLatencies || {};
}

export function setPriorityOrder(order: ProviderType[]): ProviderType[] {
  const db = getDatabase();
  if (!db.fallbackAiConfig) db.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
  db.fallbackAiConfig.priorityOrder = order;
  saveDatabaseSync();
  return order;
}

export function setOpenAiKeys(keys: string[]): string[] {
  const config = updateFallbackAIConfig({ openaiKeys: keys });
  return config.openaiKeys;
}

export function setClaudeKeys(keys: string[]): string[] {
  const config = updateFallbackAIConfig({ claudeKeys: keys });
  return config.claudeKeys;
}

export function setCustomProviderConfig(cfg: { baseUrl: string; apiKey: string; model: string; name?: string }) {
  return updateFallbackAIConfig({ customConfig: cfg });
}

// ─── Custom AI Servers Pool (DeepSeek, Brokers, OneAPI, OpenRouter) ──────────

export function getCustomServers(): CustomServerConfig[] {
  const db = getDatabase();
  if (!db.customServers) {
    db.customServers = [];
  }
  // Auto-migrate single legacy customConfig if exists and list is empty
  if (db.customServers.length === 0 && db.fallbackAiConfig?.customConfig?.baseUrl && db.fallbackAiConfig?.customConfig?.apiKey) {
    const legacy = db.fallbackAiConfig.customConfig;
    db.customServers.push({
      id: 'cs_legacy',
      name: legacy.name || 'DeepSeek واسط پیش‌فرض',
      baseUrl: legacy.baseUrl,
      apiKey: legacy.apiKey,
      apiKeys: [legacy.apiKey],
      model: legacy.model || 'deepseek-chat',
      isEnabled: true,
      createdAt: new Date().toISOString(),
      requestsCount: 0,
      tokensCount: 0,
    });
    saveDatabaseSync();
  }
  return db.customServers;
}

export function addCustomServer(data: {
  name: string;
  baseUrl: string;
  apiKey?: string;
  apiKeys?: string[];
  model: string;
  isEnabled?: boolean;
}): CustomServerConfig {
  const db = getDatabase();
  if (!db.customServers) db.customServers = [];

  const cleanKeys: string[] = [];
  if (data.apiKey && data.apiKey.trim()) cleanKeys.push(data.apiKey.trim());
  if (Array.isArray(data.apiKeys)) {
    data.apiKeys.forEach((k) => {
      const trimmed = k?.trim();
      if (trimmed && !cleanKeys.includes(trimmed)) cleanKeys.push(trimmed);
    });
  }

  const newServer: CustomServerConfig = {
    id: `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: data.name?.trim() || 'سرور سفارشی DeepSeek',
    baseUrl: data.baseUrl?.trim() || 'https://api.deepseek.com/v1',
    apiKey: cleanKeys[0] || '',
    apiKeys: cleanKeys,
    model: data.model?.trim() || 'deepseek-chat',
    isEnabled: data.isEnabled !== false,
    createdAt: new Date().toISOString(),
    requestsCount: 0,
    tokensCount: 0,
  };

  db.customServers.push(newServer);

  if (!db.fallbackAiConfig) db.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
  db.fallbackAiConfig.customServers = db.customServers;
  if (!db.fallbackAiConfig.customConfig || !db.fallbackAiConfig.customConfig.apiKey) {
    db.fallbackAiConfig.customConfig = {
      baseUrl: newServer.baseUrl,
      apiKey: newServer.apiKey,
      model: newServer.model,
      name: newServer.name,
    };
  }

  saveDatabaseSync();
  return newServer;
}

export function updateCustomServer(id: string, updates: Partial<CustomServerConfig>): CustomServerConfig | null {
  const db = getDatabase();
  const servers = getCustomServers();
  const srv = servers.find((s) => s.id === id);
  if (!srv) return null;

  if (updates.name !== undefined) srv.name = updates.name.trim() || srv.name;
  if (updates.baseUrl !== undefined) srv.baseUrl = updates.baseUrl.trim() || srv.baseUrl;
  if (updates.model !== undefined) srv.model = updates.model.trim() || srv.model;
  if (updates.isEnabled !== undefined) srv.isEnabled = updates.isEnabled;
  if (updates.apiKeys !== undefined) {
    const cleanKeys = updates.apiKeys.map((k) => k?.trim()).filter(Boolean);
    srv.apiKeys = cleanKeys;
    srv.apiKey = cleanKeys[0] || '';
  } else if (updates.apiKey !== undefined) {
    const trimmed = updates.apiKey.trim();
    srv.apiKey = trimmed;
    if (trimmed && (!srv.apiKeys || !srv.apiKeys.includes(trimmed))) {
      srv.apiKeys = [trimmed, ...(srv.apiKeys || [])];
    }
  }

  if (db.fallbackAiConfig) {
    db.fallbackAiConfig.customServers = db.customServers;
  }
  saveDatabaseSync();
  return srv;
}

export function deleteCustomServer(id: string): boolean {
  const db = getDatabase();
  if (!db.customServers) return false;
  const initialLen = db.customServers.length;
  db.customServers = db.customServers.filter((s) => s.id !== id);
  if (db.fallbackAiConfig) {
    db.fallbackAiConfig.customServers = db.customServers;
  }
  saveDatabaseSync();
  return db.customServers.length < initialLen;
}

export function getAllCustomKeysFlat(): Array<{
  serverId: string;
  serverName: string;
  baseUrl: string;
  model: string;
  rawKey: string;
  maskedKey: string;
  isEnabled: boolean;
  requestsCount?: number;
  tokensCount?: number;
}> {
  const servers = getCustomServers();
  const list: Array<{
    serverId: string;
    serverName: string;
    baseUrl: string;
    model: string;
    rawKey: string;
    maskedKey: string;
    isEnabled: boolean;
    requestsCount?: number;
    tokensCount?: number;
  }> = [];

  servers.forEach((srv) => {
    const keys = Array.isArray(srv.apiKeys) && srv.apiKeys.length > 0
      ? srv.apiKeys
      : (srv.apiKey ? [srv.apiKey] : []);

    keys.forEach((k) => {
      if (!k || !k.trim()) return;
      const len = k.length;
      const maskedKey = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
      list.push({
        serverId: srv.id,
        serverName: srv.name,
        baseUrl: srv.baseUrl,
        model: srv.model,
        rawKey: k,
        maskedKey,
        isEnabled: srv.isEnabled !== false,
        requestsCount: srv.requestsCount || 0,
        tokensCount: srv.tokensCount || 0,
      });
    });
  });

  return list;
}

// ─── Server Key Pool Operations ──────────────────────────────────────────────

export function getServerKeys(): string[] {
  const db = getDatabase();
  const userKeys = (db.serverKeys || []).map((k) => k.trim()).filter(Boolean);
  if (userKeys.length > 0) {
    return userKeys;
  }
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return [envKey];
  return [];
}

export function addServerKeys(newKeys: string[]): string[] {
  const db = getDatabase();
  const current = new Set(db.serverKeys || []);
  newKeys.forEach((k) => {
    const trimmed = k.trim();
    if (trimmed) current.add(trimmed);
  });
  db.serverKeys = Array.from(current);
  // Clear any temporary exhaustion for freshly added keys
  newKeys.forEach((k) => resetKeyCooldown(k));
  saveDatabaseSync();
  return getServerKeys();
}

export function setServerKeys(keys: string[]): string[] {
  const db = getDatabase();
  db.serverKeys = keys.map((k) => k.trim()).filter(Boolean);
  db.activeKeyIndex = 0;
  // When replacing all keys, clear all old exhausted states completely
  exhaustedKeysMap.clear();
  // Clear any waiting_for_keys status on projects so they resume immediately
  db.projects.forEach((p) => {
    if (p.status === 'waiting_for_keys' || p.status === 'has_incomplete') {
      p.status = 'queued';
      p.lastError = undefined;
      p.errorMessage = undefined;
    }
  });
  saveDatabaseSync();
  return getServerKeys();
}

export function updateSingleServerKey(index: number, newKey: string): string[] {
  const db = getDatabase();
  const trimmed = newKey.trim();
  if (!trimmed) {
    throw new Error('کلید جدید نمی‌تواند خالی باشد.');
  }
  if (!db.serverKeys) db.serverKeys = [];
  if (index >= 0 && index < db.serverKeys.length) {
    const oldKey = db.serverKeys[index];
    resetKeyCooldown(oldKey);
    db.serverKeys[index] = trimmed;
    resetKeyCooldown(trimmed);
  } else {
    db.serverKeys.push(trimmed);
    resetKeyCooldown(trimmed);
  }
  saveDatabaseSync();
  return getServerKeys();
}

export function deleteSingleServerKey(index: number): string[] {
  const db = getDatabase();
  if (db.serverKeys && index >= 0 && index < db.serverKeys.length) {
    const deletedKey = db.serverKeys[index];
    resetKeyCooldown(deletedKey);
    db.serverKeys.splice(index, 1);
    if (db.activeKeyIndex >= db.serverKeys.length) {
      db.activeKeyIndex = Math.max(0, db.serverKeys.length - 1);
    }
    saveDatabaseSync();
  }
  return getServerKeys();
}

export function deleteBatchServerKeys(indices: number[]): string[] {
  const db = getDatabase();
  if (!db.serverKeys || db.serverKeys.length === 0) return [];
  const indexSet = new Set(indices);
  const remainingKeys: string[] = [];
  db.serverKeys.forEach((key, idx) => {
    if (indexSet.has(idx)) {
      resetKeyCooldown(key);
    } else {
      remainingKeys.push(key);
    }
  });
  db.serverKeys = remainingKeys;
  db.activeKeyIndex = 0;
  saveDatabaseSync();
  return getServerKeys();
}

export function deleteAllServerKeys(): string[] {
  const db = getDatabase();
  if (db.serverKeys) {
    db.serverKeys.forEach((k) => resetKeyCooldown(k));
    db.serverKeys = [];
    db.activeKeyIndex = 0;
    saveDatabaseSync();
  }
  return [];
}

export type KeyExhaustionType = 'minute' | 'daily';

export interface ExhaustionEntry {
  timestamp: number;
  reason: string;
  type: KeyExhaustionType;
  cooldownMs: number;
}

export interface ServerKeyDetail {
  index: number;
  rawKey: string;
  maskedKey: string;
  isExhausted: boolean;
  isDailyExhausted: boolean;
  isMinuteExhausted: boolean;
  exhaustionType?: KeyExhaustionType;
  exhaustionReason?: string;
  cooldownRemainingSec: number;
  isDisabled: boolean;
  disabledReason?: string;
  requestsCount: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  lastUsedAt?: string;
}

// ─── Permanently Disabled / Deleted Keys (401, Deleted Service Account) ──────
export const disabledKeysMap = new Map<string, { timestamp: number; reason: string }>();

export function markKeyAsDisabled(key: string, reason: string = 'Service account deleted or disabled (401)'): void {
  disabledKeysMap.set(key, { timestamp: Date.now(), reason });
  console.warn(`[KeyPool] PERMANENTLY DISABLED KEY ${key.slice(0, 6)}...: ${reason}`);

  // Automatically purge this dead key from db.unifiedKeys, db.serverKeys, and customServers
  try {
    const db = getDatabase();
    if (Array.isArray(db.unifiedKeys)) {
      db.unifiedKeys = db.unifiedKeys.filter((k) => k.key !== key);
      db.unifiedKeys.forEach((k, idx) => { k.priority = idx; });
    }
    if (Array.isArray(db.serverKeys) && db.serverKeys.includes(key)) {
      db.serverKeys = db.serverKeys.filter((k) => k !== key);
      if (db.activeKeyIndex >= db.serverKeys.length) {
        db.activeKeyIndex = 0;
      }
    }
    if (Array.isArray(db.customServers)) {
      db.customServers.forEach((srv) => {
        if (srv.apiKey === key) srv.apiKey = '';
        if (Array.isArray(srv.apiKeys)) {
          srv.apiKeys = srv.apiKeys.filter((k) => k !== key);
          if (!srv.apiKey && srv.apiKeys.length > 0) srv.apiKey = srv.apiKeys[0];
        }
      });
    }
    saveDatabaseSync();
  } catch (err) {
    console.error('[KeyPool] Error removing disabled key from db:', err);
  }
}

export function isKeyDisabled(key: string): boolean {
  return disabledKeysMap.has(key);
}

export function getDisabledKeysList(): Array<{ key: string; reason: string; timestamp: number }> {
  return Array.from(disabledKeysMap.entries()).map(([k, v]) => ({
    key: k,
    reason: v.reason,
    timestamp: v.timestamp,
  }));
}

export function removeDisabledKey(key: string): void {
  disabledKeysMap.delete(key);
}

export function clearAllDisabledKeys(): void {
  disabledKeysMap.clear();
}

// ─── Key Exhaustion & Cooldown Tracking ──────────────────────────────────────

export const exhaustedKeysMap = new Map<string, ExhaustionEntry>();
const MINUTE_COOLDOWN_MS = 12 * 1000; // Fast 12-second recovery for minute rate limit (RPM)
const DAILY_COOLDOWN_MS = 14 * 60 * 60 * 1000; // 14 hours for daily quota limit (RPD)

export function isDailyQuotaError(errorMessage: string): boolean {
  if (!errorMessage) return false;
  const lower = String(errorMessage).toLowerCase();

  // If error explicitly mentions minute, RPM, or TPM, it is 100% a short-term minute rate limit, NEVER daily!
  if (
    lower.includes('per minute') ||
    lower.includes('per_minute') ||
    lower.includes('requests per minute') ||
    lower.includes('tokens per minute') ||
    lower.includes('rpm') ||
    lower.includes('tpm')
  ) {
    return false;
  }

  // Only classify as daily if Google explicitly specifies daily requests / per day
  return (
    lower.includes('requests per day') ||
    lower.includes('requests_per_day') ||
    lower.includes('per day per project') ||
    lower.includes('daily request quota') ||
    lower.includes('daily quota exceeded') ||
    (lower.includes('quota exceeded for quota metric') && lower.includes('requests per day'))
  );
}

export function markKeyAsExhausted(key: string, reason: string = 'Quota exhausted (429)', isDaily?: boolean): void {
  const isDailyLimit = isDaily !== undefined ? isDaily : isDailyQuotaError(reason);
  const type: KeyExhaustionType = isDailyLimit ? 'daily' : 'minute';
  const cooldownMs = isDailyLimit ? DAILY_COOLDOWN_MS : MINUTE_COOLDOWN_MS;

  exhaustedKeysMap.set(key, {
    timestamp: Date.now(),
    reason,
    type,
    cooldownMs,
  });

  if (isDailyLimit) {
    console.warn(`[KeyPool] 🔴 DAILY QUOTA EXHAUSTED for key ${key.slice(0, 6)}... (${reason}). STRICTLY EXCLUDED from rotation pool for 14 hours.`);
  } else {
    console.log(`[KeyPool] 🟡 Key ${key.slice(0, 6)}... hit temporary RPM limit (${reason}). Short cooldown (${cooldownMs / 1000}s).`);
  }

  // FIFO Queue Rotation: Immediately move the exhausted key to the END of db.serverKeys
  // so fresh, unexhausted keys are immediately at index 0 and picked up without delay!
  try {
    const db = getDatabase();
    if (Array.isArray(db.serverKeys) && db.serverKeys.includes(key) && db.serverKeys.length > 1) {
      db.serverKeys = db.serverKeys.filter((k) => k !== key);
      db.serverKeys.push(key);
      if (db.activeKeyIndex >= db.serverKeys.length) {
        db.activeKeyIndex = 0;
      }
      saveDatabaseSync();
    }
  } catch {}
}

export function isKeyExhausted(key: string): boolean {
  if (isKeyDisabled(key)) return true;
  const entry = exhaustedKeysMap.get(key);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > entry.cooldownMs) {
    exhaustedKeysMap.delete(key);
    return false;
  }
  return true;
}

export function isKeyDailyExhausted(key: string): boolean {
  if (isKeyDisabled(key)) return false;
  const entry = exhaustedKeysMap.get(key);
  if (!entry || entry.type !== 'daily') return false;
  if (Date.now() - entry.timestamp > entry.cooldownMs) {
    exhaustedKeysMap.delete(key);
    return false;
  }
  return true;
}

export function getDailyExhaustedKeysList(): string[] {
  return Array.from(exhaustedKeysMap.entries())
    .filter(([k, v]) => v.type === 'daily' && Date.now() - v.timestamp <= v.cooldownMs && !isKeyDisabled(k))
    .map(([k]) => k);
}

export function getMinuteExhaustedKeysList(): string[] {
  return Array.from(exhaustedKeysMap.entries())
    .filter(([k, v]) => v.type === 'minute' && Date.now() - v.timestamp <= v.cooldownMs && !isKeyDisabled(k))
    .map(([k]) => k);
}

export function getExhaustedKeysList(): string[] {
  return Array.from(exhaustedKeysMap.keys()).filter((k) => !isKeyDisabled(k));
}

export function resetKeyCooldown(key: string): void {
  exhaustedKeysMap.delete(key);
}

export function resetAllKeyCooldowns(includeDaily = true): void {
  if (includeDaily) {
    exhaustedKeysMap.clear();
  } else {
    for (const [k, v] of Array.from(exhaustedKeysMap.entries())) {
      if (v.type === 'minute') {
        exhaustedKeysMap.delete(k);
      }
    }
  }
  console.log('[KeyPool] All key cooldowns have been manually reset.');
}

export function getServerKeysWithDetails(): ServerKeyDetail[] {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const keyStats = db.keyStats || {};
  const now = Date.now();

  return allKeys.map((k, index) => {
    const entry = exhaustedKeysMap.get(k);
    const isExhausted = entry ? (now - entry.timestamp <= entry.cooldownMs) : false;
    const isDailyExhausted = Boolean(isExhausted && entry?.type === 'daily');
    const isMinuteExhausted = Boolean(isExhausted && entry?.type === 'minute');
    const cooldownRemainingSec = entry && isExhausted ? Math.max(0, Math.ceil((entry.cooldownMs - (now - entry.timestamp)) / 1000)) : 0;
    const disabledEntry = disabledKeysMap.get(k);
    const isDisabled = Boolean(disabledEntry);
    const disabledReason = disabledEntry?.reason;

    const len = k.length;
    const maskedKey = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
    const stats = keyStats[k] || { requestsCount: 0, promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };

    return {
      index,
      rawKey: k,
      maskedKey,
      isExhausted,
      isDailyExhausted,
      isMinuteExhausted,
      exhaustionType: entry?.type,
      exhaustionReason: entry?.reason,
      cooldownRemainingSec,
      isDisabled,
      disabledReason,
      requestsCount: stats.requestsCount || 0,
      promptTokens: stats.promptTokens || 0,
      candidatesTokens: stats.candidatesTokens || 0,
      totalTokens: stats.totalTokens || 0,
      lastUsedAt: stats.lastUsedAt,
    };
  });
}

export function getActiveKeyIndex(): number {
  const db = getDatabase();
  return db.activeKeyIndex || 0;
}

export function rotateActiveKeyIndex(): number {
  const db = getDatabase();
  const allKeys = getServerKeys();
  if (allKeys.length <= 1) return 0;
  db.activeKeyIndex = ((db.activeKeyIndex || 0) + 1) % allKeys.length;
  saveDatabaseSync();
  return db.activeKeyIndex;
}

/**
 * Safely clears cache, key exhaustion cooldowns, and resets stuck queues
 * WITHOUT deleting any folders, projects, or translated subtitle cues!
 */
export function clearSystemCacheAndResetStuckQueues(): {
  clearedCooldownsCount: number;
  requeuedProjectsCount: number;
  preservedSubtitlesCount: number;
} {
  const cooldownsCount = exhaustedKeysMap.size;
  exhaustedKeysMap.clear();

  const db = getDatabase();
  let requeuedCount = 0;
  let preservedCount = 0;

  db.projects.forEach((p) => {
    // Count preserved translated items (100% safeguarded)
    const translatedCount = (p.items || []).filter((item) => Boolean(item.translatedText && item.translatedText.trim())).length;
    preservedCount += translatedCount;

    // If project is incomplete or paused or error, re-queue it cleanly
    const isCompleted = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
    if (!isCompleted) {
      p.status = 'queued';
      p.lastError = undefined;
      p.errorMessage = undefined;
      p.failedCueIds = [];
      p.hasDisruption = false;
      requeuedCount++;
    } else {
      p.lastError = undefined;
      p.errorMessage = undefined;
    }
  });

  saveDatabaseSync();
  console.log(`[CacheClear] Cleared ${cooldownsCount} key cooldowns. Re-queued ${requeuedCount} projects. Preserved ${preservedCount} translated subtitle cues!`);
  return {
    clearedCooldownsCount: cooldownsCount,
    requeuedProjectsCount: requeuedCount,
    preservedSubtitlesCount: preservedCount,
  };
}

export function recordKeyUsage(
  keyIdentifier: string,
  tokens: { prompt: number; candidates: number; total: number }
): void {
  const db = getDatabase();
  if (!db.keyStats) {
    db.keyStats = {};
  }
  if (!db.keyStats[keyIdentifier]) {
    db.keyStats[keyIdentifier] = { requestsCount: 0, promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
  }
  const rec = db.keyStats[keyIdentifier];
  rec.requestsCount += 1;
  rec.promptTokens += (tokens.prompt || 0);
  rec.candidatesTokens += (tokens.candidates || 0);
  rec.totalTokens += (tokens.total || 0);
  rec.lastUsedAt = new Date().toISOString();

  // Also sync token metrics to UnifiedKeyEntry in db.unifiedKeys for live UI display
  if (Array.isArray(db.unifiedKeys)) {
    const matched = db.unifiedKeys.find(
      (k) =>
        k.key === keyIdentifier ||
        k.maskedKey === keyIdentifier ||
        k.id === keyIdentifier ||
        (k.maskedKey && keyIdentifier.includes(k.maskedKey)) ||
        (keyIdentifier && k.key && keyIdentifier.includes(k.key.slice(0, 10)))
    );
    if (matched) {
      matched.requestsCount = (matched.requestsCount || 0) + 1;
      matched.totalTokens = (matched.totalTokens || 0) + (tokens.total || 0);
      matched.promptTokens = (matched.promptTokens || 0) + (tokens.prompt || 0);
      matched.candidatesTokens = (matched.candidatesTokens || 0) + (tokens.candidates || 0);
      matched.lastUsedAt = new Date().toISOString();
    }
  }

  if (!db.stats) {
    db.stats = { totalTranslations: 0, totalTokensUsed: 0 };
  }
  db.stats.totalTokensUsed += (tokens.total || 0);
  scheduleSaveDatabase();
}

export function resetKeyStats(): void {
  const db = getDatabase();
  db.keyStats = {};
  saveDatabaseSync();
}

/**
 * Lease an available, non-exhausted, non-disabled key from the pool.
 * If excludeKeys is provided, avoids choosing a key currently locked by another parallel worker.
 */
export function leaseAvailableKey(excludeKeys: string[] = []): { key: string; index: number; total: number } | null {
  const allKeys = getServerKeys().filter((k) => !isKeyDisabled(k));
  if (allKeys.length === 0) return null;

  const excludedSet = new Set(excludeKeys);
  const db = getDatabase();

  // First pass: find first key in pool that is NOT exhausted, NOT disabled, and NOT currently busy
  for (let i = 0; i < allKeys.length; i++) {
    const candidateKey = allKeys[i];
    if (!isKeyDisabled(candidateKey) && !isKeyExhausted(candidateKey) && !excludedSet.has(candidateKey)) {
      db.activeKeyIndex = (i + 1) % allKeys.length;
      return { key: candidateKey, index: i, total: allKeys.length };
    }
  }

  // Second pass: if all free keys are currently locked in flight, allow leasing another non-exhausted key
  for (let i = 0; i < allKeys.length; i++) {
    const candidateKey = allKeys[i];
    if (!isKeyDisabled(candidateKey) && !isKeyExhausted(candidateKey)) {
      db.activeKeyIndex = (i + 1) % allKeys.length;
      return { key: candidateKey, index: i, total: allKeys.length };
    }
  }

  // All keys are exhausted or disabled
  return null;
}

export function getActiveAvailableKey(): { key: string; index: number; total: number } | null {
  return leaseAvailableKey([]);
}

export function getKeyExhaustionStatus(): Array<{ keyMasked: string; isExhausted: boolean; cooldownRemainingSec: number }> {
  const allKeys = getServerKeys();
  const now = Date.now();
  return allKeys.map((k) => {
    const entry = exhaustedKeysMap.get(k);
    const isExhausted = entry ? (now - entry.timestamp <= entry.cooldownMs) : false;
    const cooldownRemainingSec = entry && isExhausted ? Math.max(0, Math.ceil((entry.cooldownMs - (now - entry.timestamp)) / 1000)) : 0;
    const len = k.length;
    const keyMasked = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
    return { keyMasked, isExhausted, cooldownRemainingSec };
  });
}

// ─── Unified Key Pool Operations (Single Peer Rotation & Seamless Failover) ──

export function maskKeyString(k: string): string {
  if (!k) return '****';
  const clean = k.trim();
  if (clean.length <= 8) return '****';
  return clean.substring(0, 4) + '...' + clean.substring(clean.length - 4);
}

export function syncUnifiedKeysToLegacy(): void {
  const db = getDatabase();
  if (!Array.isArray(db.unifiedKeys)) return;

  // 1. Sync Gemini keys
  const geminiKeys = db.unifiedKeys
    .filter((k) => k.provider === 'gemini' && k.isEnabled && !isKeyDisabled(k.key))
    .map((k) => k.key);
  db.serverKeys = geminiKeys;

  // 2. Sync Custom servers
  const customEntries = db.unifiedKeys.filter((k) => k.provider === 'custom');
  if (customEntries.length > 0) {
    if (!db.customServers) db.customServers = [];
    const map = new Map<string, { name: string; baseUrl: string; model: string; keys: string[] }>();
    customEntries.forEach((c) => {
      const groupKey = `${c.baseUrl || ''}_${c.model}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          name: c.name.replace(/\s*\(\d+\)$/, '').trim() || 'سرور سفارشی',
          baseUrl: c.baseUrl || 'https://api.deepseek.com/v1',
          model: c.model || 'deepseek-chat',
          keys: [],
        });
      }
      if (c.key && !map.get(groupKey)!.keys.includes(c.key)) {
        map.get(groupKey)!.keys.push(c.key);
      }
    });

    db.customServers = Array.from(map.values()).map((g, idx) => ({
      id: `cs_${idx}_${Date.now()}`,
      name: g.name,
      baseUrl: g.baseUrl,
      apiKey: g.keys[0] || '',
      apiKeys: g.keys,
      model: g.model,
      isEnabled: true,
      createdAt: new Date().toISOString(),
      requestsCount: 0,
      tokensCount: 0,
    }));
  }

  // 3. Sync OpenAI & Claude keys
  if (!db.fallbackAiConfig) db.fallbackAiConfig = { ...DEFAULT_FALLBACK_AI_CONFIG };
  db.fallbackAiConfig.openaiKeys = db.unifiedKeys
    .filter((k) => k.provider === 'openai' && k.isEnabled)
    .map((k) => k.key);
  db.fallbackAiConfig.claudeKeys = db.unifiedKeys
    .filter((k) => k.provider === 'claude' && k.isEnabled)
    .map((k) => k.key);
}

export function getUnifiedKeys(): UnifiedKeyEntry[] {
  const db = getDatabase();
  if (!db.unifiedKeys) {
    db.unifiedKeys = [];
  }

  // Auto-migration on first call if unifiedKeys is empty
  if (db.unifiedKeys.length === 0) {
    let priorityCounter = 0;

    // 1. Existing Gemini keys
    if (Array.isArray(db.serverKeys)) {
      db.serverKeys.forEach((key, idx) => {
        if (!key || !key.trim()) return;
        db.unifiedKeys!.push({
          id: `uk_gemini_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          provider: 'gemini',
          key: key.trim(),
          maskedKey: maskKeyString(key),
          name: `Gemini Key #${idx + 1}`,
          model: 'gemini-2.5-flash',
          priority: priorityCounter++,
          isEnabled: true,
          requestsCount: db.keyStats?.[key]?.requestsCount || 0,
          totalTokens: db.keyStats?.[key]?.totalTokens || 0,
          createdAt: new Date().toISOString(),
        });
      });
    }

    // 2. Custom servers (DeepSeek, proxy brokers)
    const customServers = getCustomServers();
    customServers.forEach((srv) => {
      const keys = Array.isArray(srv.apiKeys) && srv.apiKeys.length > 0 ? srv.apiKeys : (srv.apiKey ? [srv.apiKey] : []);
      keys.forEach((key, kIdx) => {
        if (!key || !key.trim()) return;
        db.unifiedKeys!.push({
          id: `uk_custom_${Date.now()}_${kIdx}_${Math.random().toString(36).substring(2, 6)}`,
          provider: 'custom',
          key: key.trim(),
          maskedKey: maskKeyString(key),
          name: keys.length > 1 ? `${srv.name} (${kIdx + 1})` : srv.name,
          model: srv.model || 'deepseek-chat',
          baseUrl: srv.baseUrl || 'https://api.deepseek.com/v1',
          priority: priorityCounter++,
          isEnabled: srv.isEnabled !== false,
          requestsCount: srv.requestsCount || 0,
          totalTokens: srv.tokensCount || 0,
          createdAt: new Date().toISOString(),
        });
      });
    });

    // 3. OpenAI keys
    if (db.fallbackAiConfig?.openaiKeys && Array.isArray(db.fallbackAiConfig.openaiKeys)) {
      db.fallbackAiConfig.openaiKeys.forEach((key, idx) => {
        if (!key || !key.trim()) return;
        db.unifiedKeys!.push({
          id: `uk_openai_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          provider: 'openai',
          key: key.trim(),
          maskedKey: maskKeyString(key),
          name: `OpenAI Key #${idx + 1}`,
          model: db.fallbackAiConfig?.openaiModel || 'gpt-4o-mini',
          priority: priorityCounter++,
          isEnabled: true,
          requestsCount: 0,
          totalTokens: 0,
          createdAt: new Date().toISOString(),
        });
      });
    }

    // 4. Claude keys
    if (db.fallbackAiConfig?.claudeKeys && Array.isArray(db.fallbackAiConfig.claudeKeys)) {
      db.fallbackAiConfig.claudeKeys.forEach((key, idx) => {
        if (!key || !key.trim()) return;
        db.unifiedKeys!.push({
          id: `uk_claude_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          provider: 'claude',
          key: key.trim(),
          maskedKey: maskKeyString(key),
          name: `Claude Key #${idx + 1}`,
          model: db.fallbackAiConfig?.claudeModel || 'claude-3-5-haiku-20241022',
          priority: priorityCounter++,
          isEnabled: true,
          requestsCount: 0,
          totalTokens: 0,
          createdAt: new Date().toISOString(),
        });
      });
    }

    if (db.unifiedKeys.length > 0) {
      saveDatabaseSync();
    }
  }

  return [...db.unifiedKeys]
    .map((k) => {
      const stats = db.keyStats?.[k.key] || db.keyStats?.[k.maskedKey] || db.keyStats?.[k.id];
      if (stats) {
        k.requestsCount = Math.max(k.requestsCount || 0, stats.requestsCount || 0);
        k.totalTokens = Math.max(k.totalTokens || 0, stats.totalTokens || 0);
        k.promptTokens = Math.max(k.promptTokens || 0, stats.promptTokens || 0);
        k.candidatesTokens = Math.max(k.candidatesTokens || 0, stats.candidatesTokens || 0);
        k.lastUsedAt = k.lastUsedAt || stats.lastUsedAt;
      }
      return k;
    })
    .sort((a, b) => a.priority - b.priority);
}

export function addUnifiedKeys(
  newEntries: Array<{
    provider: ProviderType;
    key: string;
    name?: string;
    model?: string;
    baseUrl?: string;
  }>
): UnifiedKeyEntry[] {
  const db = getDatabase();
  const existing = getUnifiedKeys();
  let maxPriority = existing.reduce((max, k) => Math.max(max, k.priority), -1);

  const defaultModels: Record<ProviderType, string> = {
    gemini: 'gemini-2.5-flash',
    custom: 'deepseek-chat',
    openai: 'gpt-4o-mini',
    claude: 'claude-3-5-haiku-20241022',
  };

  const defaultNames: Record<ProviderType, string> = {
    gemini: 'Google Gemini',
    custom: 'سرور واسط / خصوصی',
    openai: 'OpenAI GPT',
    claude: 'Anthropic Claude',
  };

  newEntries.forEach((entry, idx) => {
    const rawKey = entry.key?.trim();
    if (!rawKey) return;

    const found = db.unifiedKeys!.find((k) => k.key === rawKey && k.provider === entry.provider);
    if (found) {
      found.isEnabled = true;
      resetKeyCooldown(rawKey);
      return;
    }

    maxPriority++;
    const provider = entry.provider || 'gemini';
    const name = entry.name?.trim() || `${defaultNames[provider]} #${db.unifiedKeys!.length + 1}`;
    const model = entry.model?.trim() || defaultModels[provider];
    const baseUrl = provider === 'custom' ? (entry.baseUrl?.trim() || 'https://api.deepseek.com/v1') : undefined;

    db.unifiedKeys!.push({
      id: `uk_${provider}_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
      provider,
      key: rawKey,
      maskedKey: maskKeyString(rawKey),
      name,
      model,
      baseUrl,
      priority: maxPriority,
      isEnabled: true,
      requestsCount: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString(),
    });

    resetKeyCooldown(rawKey);
  });

  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return getUnifiedKeys();
}

export function reorderUnifiedKeys(orderedIds: string[]): UnifiedKeyEntry[] {
  const db = getDatabase();
  const keys = getUnifiedKeys();
  const idMap = new Map(keys.map((k) => [k.id, k]));

  const newOrder: UnifiedKeyEntry[] = [];
  orderedIds.forEach((id, idx) => {
    const key = idMap.get(id);
    if (key) {
      key.priority = idx;
      newOrder.push(key);
      idMap.delete(id);
    }
  });

  Array.from(idMap.values()).forEach((key) => {
    key.priority = newOrder.length;
    newOrder.push(key);
  });

  db.unifiedKeys = newOrder;
  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return getUnifiedKeys();
}

export function moveUnifiedKey(id: string, direction: 'up' | 'down'): UnifiedKeyEntry[] {
  const keys = getUnifiedKeys();
  const idx = keys.findIndex((k) => k.id === id);
  if (idx === -1) return keys;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= keys.length) return keys;

  const currentKey = keys[idx];
  const targetKey = keys[targetIdx];
  const tempPriority = currentKey.priority;
  currentKey.priority = targetKey.priority;
  targetKey.priority = tempPriority;

  const db = getDatabase();
  db.unifiedKeys = keys;
  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return getUnifiedKeys();
}

export function deleteUnifiedKey(id: string): UnifiedKeyEntry[] {
  const db = getDatabase();
  const keys = getUnifiedKeys();
  const target = keys.find((k) => k.id === id);
  if (target) {
    resetKeyCooldown(target.key);
    disabledKeysMap.delete(target.key);
  }

  db.unifiedKeys = keys.filter((k) => k.id !== id);
  db.unifiedKeys.forEach((k, idx) => {
    k.priority = idx;
  });

  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return getUnifiedKeys();
}

export function deleteBatchUnifiedKeys(ids: string[]): UnifiedKeyEntry[] {
  const db = getDatabase();
  const keys = getUnifiedKeys();
  const idSet = new Set(ids);

  keys.forEach((k) => {
    if (idSet.has(k.id)) {
      resetKeyCooldown(k.key);
      disabledKeysMap.delete(k.key);
    }
  });

  db.unifiedKeys = keys.filter((k) => !idSet.has(k.id));
  db.unifiedKeys.forEach((k, idx) => {
    k.priority = idx;
  });

  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return getUnifiedKeys();
}

export function purgeInvalidKeys(): { purgedCount: number; purgedKeys: string[] } {
  const db = getDatabase();
  const keys = getUnifiedKeys();
  const deadKeys: string[] = [];
  const remaining = keys.filter((k) => {
    const errStr = (k.lastError || '').toLowerCase();
    const isDead =
      isKeyDisabled(k.key) ||
      disabledKeysMap.has(k.key) ||
      k.lastError?.includes('401') ||
      k.lastError?.includes('API_KEY_INVALID') ||
      errStr.includes('suspended') ||
      errStr.includes('consumer has been suspended') ||
      errStr.includes('permission denied') ||
      errStr.includes('permission_denied') ||
      (k.lastError?.includes('403') && !errStr.includes('quota'));
    if (isDead) {
      deadKeys.push(k.maskedKey);
      resetKeyCooldown(k.key);
      disabledKeysMap.delete(k.key);
      return false;
    }
    return true;
  });

  remaining.forEach((k, idx) => {
    k.priority = idx;
  });

  db.unifiedKeys = remaining;
  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return { purgedCount: deadKeys.length, purgedKeys: deadKeys };
}

export function updateUnifiedKey(id: string, updates: Partial<UnifiedKeyEntry>): UnifiedKeyEntry | null {
  const db = getDatabase();
  const keys = getUnifiedKeys();
  const key = keys.find((k) => k.id === id);
  if (!key) return null;

  if (updates.name !== undefined) key.name = updates.name.trim() || key.name;
  if (updates.model !== undefined) key.model = updates.model.trim() || key.model;
  if (updates.baseUrl !== undefined) key.baseUrl = updates.baseUrl.trim() || key.baseUrl;
  if (updates.isEnabled !== undefined) key.isEnabled = updates.isEnabled;
  if (updates.priority !== undefined) key.priority = updates.priority;
  if (updates.latencyMs !== undefined) key.latencyMs = updates.latencyMs;

  db.unifiedKeys = keys;
  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return key;
}

export function batchSetModelUnifiedKeys(ids: string[], model: string): UnifiedKeyEntry[] {
  const db = getDatabase();
  const keys = getUnifiedKeys();
  const idSet = new Set(ids);
  const cleanModel = model?.trim();
  if (!cleanModel) return keys;

  keys.forEach((k) => {
    if (ids.length === 0 || idSet.has(k.id)) {
      k.model = cleanModel;
    }
  });

  db.unifiedKeys = keys;
  syncUnifiedKeysToLegacy();
  saveDatabaseSync();
  return getUnifiedKeys();
}

let lastLeasedUnifiedIndex = 0;

export function leaseAvailableUnifiedKey(excludeKeyIds: string[] = []): UnifiedKeyEntry | null {
  const keys = getUnifiedKeys();
  if (keys.length === 0) return null;

  const excludedSet = new Set(excludeKeyIds);
  const n = keys.length;

  // Round-robin pass: distribute files across all available unexhausted keys to prevent piling onto a single key
  for (let offset = 0; offset < n; offset++) {
    const idx = (lastLeasedUnifiedIndex + offset) % n;
    const entry = keys[idx];
    if (!entry.isEnabled) continue;
    if (isKeyDisabled(entry.key)) continue;
    if (isKeyExhausted(entry.key)) continue;
    if (excludedSet.has(entry.id) || excludedSet.has(entry.key)) continue;

    lastLeasedUnifiedIndex = (idx + 1) % n;
    return entry;
  }

  return null;
}

// ─── Project Retranslation & Incomplete Reset ────────────────────────────────

export function resetProjectTranslation(projectId: string, onlyIncomplete: boolean = false): ServerSubtitleProject | null {
  const db = getDatabase();
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return null;

  if (onlyIncomplete) {
    // Keep already translated lines, just clear any failed states and queue project
    project.status = 'queued';
    project.errorMessage = undefined;
    project.lastError = undefined;
    project.failedCueIds = [];
    project.translatedCues = project.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;
  } else {
    // Retranslate all from scratch
    project.status = 'queued';
    project.errorMessage = undefined;
    project.lastError = undefined;
    project.failedCueIds = [];
    project.currentBatchIndex = 0;
    project.translatedCues = 0;
    project.completedAt = undefined;
    project.items.forEach((item) => {
      item.translatedText = '';
    });
  }

  project.updatedAt = new Date().toISOString();
  saveDatabaseSync();
  return project;
}

/**
 * Resets all subtitle projects in a given folder completely from scratch:
 * - Wipes all item.translatedText = '' so progress returns to 0%
 * - Sets translatedCues = 0, currentBatchIndex = 0, completedAt = undefined
 * - Sets status = 'queued', isPriority = true, clears errors and failed cues
 * - Preserves original English items, timestamps, IDs, and structure (no re-upload needed)
 */
export function resetFolderTranslationFromScratch(folderId: string): { count: number; folderName: string; projectIds: string[] } {
  const db = getDatabase();
  const folder = db.folders.find((f) => f.id === folderId);
  const folderName = folder ? folder.name : folderId;

  const projectsInFolder = db.projects.filter((p) => p.folderId === folderId);
  const projectIds: string[] = [];

  projectsInFolder.forEach((project) => {
    projectIds.push(project.id);
    project.status = 'queued';
    project.errorMessage = undefined;
    project.lastError = undefined;
    project.failedCueIds = [];
    project.currentBatchIndex = 0;
    project.translatedCues = 0;
    project.completedAt = undefined;
    project.isPriority = true;
    project.tokenUsage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
    project.items.forEach((item) => {
      item.translatedText = '';
    });
    project.updatedAt = new Date().toISOString();
  });

  resetAllKeyCooldowns(false);
  saveDatabaseSync();
  return { count: projectsInFolder.length, folderName, projectIds };
}

/**
 * Auto-audit all subtitle projects on server.
 * Any cue that has English original text but was left with English translatedText
 * is reset to empty string ('') so the background worker can properly translate it into Persian.
 * If a project marked as 'completed' has missing or English cues, its status is reset to 'queued'
 * so it completes 100% of the lines before moving on.
 */
export function auditAndFixEnglishCues(): { totalFixedCues: number; affectedProjectsCount: number } {
  const db = getDatabase();
  let totalFixedCues = 0;
  let affectedProjectsCount = 0;

  db.projects.forEach((project) => {
    let projectFixed = false;
    const targetLang = project.targetLanguage || 'fa';
    const totalCount = project.totalCues || project.items.length;

    const currentRatio = totalCount > 0 ? (project.translatedCues / totalCount) : 0;
    const isNearComplete = project.status === 'completed' || currentRatio >= 0.95 || (totalCount - project.translatedCues) <= 35;

    project.items.forEach((item) => {
      if (item.translatedText && item.translatedText.trim()) {
        const isValid = isCueProperlyTranslated(item.originalText, item.translatedText, targetLang, isNearComplete);
        if (!isValid && !isNearComplete) {
          item.translatedText = '';
          totalFixedCues++;
          projectFixed = true;
        }
      } else if (isNearComplete) {
        // Auto-fill empty cues in near-complete files
        item.translatedText = item.originalText.trim();
        projectFixed = true;
      }
    });

    const realTranslatedCount = project.items.filter((i) =>
      isCueProperlyTranslated(i.originalText, i.translatedText, targetLang, isNearComplete)
    ).length;

    if (isNearComplete || (realTranslatedCount >= totalCount && totalCount > 0)) {
      project.translatedCues = totalCount;
      if (project.status !== 'completed') {
        project.status = 'completed';
        project.completedAt = project.completedAt || new Date().toISOString();
        project.lastError = undefined;
        project.errorMessage = undefined;
        project.failedCueIds = [];
        projectFixed = true;
      }
    } else {
      project.translatedCues = realTranslatedCount;
    }

    if (projectFixed) {
      affectedProjectsCount++;
      project.updatedAt = new Date().toISOString();
    }
  });

  if (affectedProjectsCount > 0) {
    saveDatabaseSync();
    console.log(`[DB Audit] Audit complete. ${affectedProjectsCount} projects evaluated/verified.`);
  }

  return { totalFixedCues, affectedProjectsCount };
}

// ─── Database Backup & Restore Operations ────────────────────────────────────

export function createBackupJson(): string {
  const db = getDatabase();
  const backup = {
    exportedAt: new Date().toISOString(),
    version: db.version,
    app: 'SubGame Lab',
    databaseFilePath: DB_FILE,
    folders: db.folders,
    projects: db.projects,
    stats: db.stats,
    serverKeysCount: db.serverKeys.length,
    serverKeys: db.serverKeys,
  };
  return JSON.stringify(backup, null, 2);
}

export function restoreBackupJson(jsonString: string): { success: boolean; foldersCount: number; projectsCount: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.folders) || !Array.isArray(parsed.projects)) {
      return { success: false, foldersCount: 0, projectsCount: 0, error: 'فرمت فایل پشتیبان نامعتبر است.' };
    }

    const db = getDatabase();
    db.folders = parsed.folders;
    db.projects = parsed.projects;
    if (parsed.stats) db.stats = parsed.stats;
    if (Array.isArray(parsed.serverKeys) && parsed.serverKeys.length > 0) {
      db.serverKeys = parsed.serverKeys;
    }
    saveDatabaseSync();
    return {
      success: true,
      foldersCount: db.folders.length,
      projectsCount: db.projects.length,
    };
  } catch (err: any) {
    return { success: false, foldersCount: 0, projectsCount: 0, error: err?.message || 'خطا در خواندن فایل پشتیبان' };
  }
}

export function restoreBackupFileDirect(filePath: string): { success: boolean; foldersCount: number; projectsCount: number; error?: string } {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.folders) || !Array.isArray(parsed.projects)) {
      return { success: false, foldersCount: 0, projectsCount: 0, error: 'فرمت فایل پشتیبان نامعتبر است (آرایه‌های پوشه یا پروژه‌ها یافت نشد).' };
    }

    const db = getDatabase();
    db.folders = parsed.folders;
    db.projects = parsed.projects;
    if (parsed.stats) db.stats = parsed.stats;
    if (Array.isArray(parsed.serverKeys) && parsed.serverKeys.length > 0) {
      db.serverKeys = parsed.serverKeys;
    }
    saveDatabaseSync();
    console.log(`[DB Restore] Successfully restored ${db.folders.length} folders and ${db.projects.length} projects from backup file (${(raw.length / (1024 * 1024)).toFixed(1)} MB).`);
    return {
      success: true,
      foldersCount: db.folders.length,
      projectsCount: db.projects.length,
    };
  } catch (err: any) {
    console.error('[DB Restore] Error parsing backup file:', err);
    return { success: false, foldersCount: 0, projectsCount: 0, error: err?.message || 'خطا در خواندن و بازیابی فایل پشتیبان' };
  }
}

export function getDatabaseFilePath(): string {
  return DB_FILE;
}

export function retryDisruptedAndIncompleteProjects(folderId?: string): {
  retriedCount: number;
  projectNames: string[];
} {
  const db = getDatabase();
  const retried: string[] = [];
  const priorityTime = Date.now();

  // Clear any temporary key exhaustions so all active keys can be leased immediately
  resetAllKeyCooldowns();

  db.projects.forEach((p) => {
    if (folderId && p.folderId !== folderId) return;
    const untranslatedCount = (p.items || []).filter((i) => !i.translatedText || !i.translatedText.trim()).length;
    const hasIssues = p.status === 'has_incomplete' || p.status === 'error' || p.status === 'waiting_for_keys' || p.status === 'paused' || Boolean(p.hasDisruption) || Boolean(p.lastError) || (untranslatedCount > 0 && p.status !== 'completed');

    // If all lines are actually translated, mark completed and skip
    if (untranslatedCount === 0 && p.totalCues > 0) {
      p.status = 'completed';
      p.isPriority = false;
      return;
    }

    if (untranslatedCount > 0) {
      p.status = 'queued';
      p.hasDisruption = false;
      p.isPriority = true; // Mark as emergency priority
      p.priorityLevel = priorityTime;
      p.lastError = undefined;
      p.errorMessage = undefined;
      p.failedCueIds = [];
      retried.push(p.name);
    }
  });

  if (retried.length > 0) {
    saveDatabaseSync();
  }

  return {
    retriedCount: retried.length,
    projectNames: retried,
  };
}

export function setProjectPriority(projectId: string, isPriority: boolean): ServerSubtitleProject | null {
  const db = getDatabase();
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return null;

  project.isPriority = isPriority;
  if (isPriority) {
    project.priorityLevel = Date.now();
    if (project.status === 'paused' || project.status === 'idle' || project.status === 'error' || project.status === 'waiting_for_keys' || project.status === 'has_incomplete') {
      project.status = 'queued';
    }
    project.hasDisruption = false;
    project.lastError = undefined;
    project.errorMessage = undefined;
  }
  project.updatedAt = new Date().toISOString();
  saveDatabaseSync();
  return project;
}

export function isIncompleteProject(p: ServerSubtitleProject): boolean {
  if (!p || !p.items || p.items.length === 0) return false;
  const untranslated = p.items.filter((i) => !i.translatedText || !i.translatedText.trim()).length;
  return untranslated > 0;
}

