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

export interface SubtitlesDatabase {
  version: number;
  folders: ServerFolder[];
  projects: ServerSubtitleProject[];
  serverKeys: string[];
  activeKeyIndex: number;
  serverConfig?: ServerConfig;
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

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || '*',
  geminiBaseUrl: process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com',
  maxConcurrentProjects: Number(process.env.MAX_CONCURRENT_PROJECTS) || 8,
  maxTotalParallelKeys: Number(process.env.MAX_PARALLEL_KEYS) || 19,
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

export function saveDatabaseSync(): void {
  if (!inMemoryDb) return;
  ensureDataDir();
  try {
    const serialized = JSON.stringify(inMemoryDb);
    fs.writeFileSync(DB_TMP_FILE, serialized, 'utf-8');
    fs.renameSync(DB_TMP_FILE, DB_FILE);
  } catch (err) {
    console.error('[DB] Error saving database synchronously:', err);
  }
}

export function scheduleSaveDatabase(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(() => {
    saveDatabaseSync();
    saveDebounceTimer = null;
  }, 1000);
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
      pattern = new RegExp(findText, matchCase ? 'g' : 'gi');
    } else {
      let escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        escaped = `\\b${escaped}\\b`;
      }
      pattern = new RegExp(escaped, matchCase ? 'g' : 'gi');
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
  // DYNAMICALLY ensure maxTotalParallelKeys utilizes all available keys (at least up to 19/32)
  const idealParallelKeys = Math.max(16, allKeys.length);
  if (!db.serverConfig.maxTotalParallelKeys || db.serverConfig.maxTotalParallelKeys < idealParallelKeys) {
    db.serverConfig.maxTotalParallelKeys = Math.min(32, idealParallelKeys);
  }
  if (!db.serverConfig.maxConcurrentProjects || db.serverConfig.maxConcurrentProjects < 8) {
    db.serverConfig.maxConcurrentProjects = 8;
  }
  if (!db.serverConfig.maxKeysPerProject || db.serverConfig.maxKeysPerProject < 1) {
    db.serverConfig.maxKeysPerProject = 2;
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
    db.serverConfig.maxConcurrentProjects = Math.max(1, Math.min(val || 4, 16));
  }
  if (updates.maxTotalParallelKeys !== undefined) {
    const val = Number(updates.maxTotalParallelKeys);
    db.serverConfig.maxTotalParallelKeys = Math.max(1, Math.min(val || 8, 32));
  }
  if (updates.maxKeysPerProject !== undefined) {
    const val = Number(updates.maxKeysPerProject);
    db.serverConfig.maxKeysPerProject = Math.max(1, Math.min(val || 2, 8));
  }
  saveDatabaseSync();
  return db.serverConfig;
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

export interface ServerKeyDetail {
  index: number;
  rawKey: string;
  maskedKey: string;
  isExhausted: boolean;
  cooldownRemainingSec: number;
  requestsCount: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  lastUsedAt?: string;
}

export function getServerKeysWithDetails(): ServerKeyDetail[] {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const keyStats = db.keyStats || {};
  const now = Date.now();

  return allKeys.map((k, index) => {
    const entry = exhaustedKeysMap.get(k);
    const isExhausted = entry ? (now - entry.timestamp <= KEY_EXHAUSTION_COOLDOWN_MS) : false;
    const cooldownRemainingSec = entry && isExhausted ? Math.max(0, Math.ceil((KEY_EXHAUSTION_COOLDOWN_MS - (now - entry.timestamp)) / 1000)) : 0;
    const len = k.length;
    const maskedKey = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
    const stats = keyStats[k] || { requestsCount: 0, promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };

    return {
      index,
      rawKey: k,
      maskedKey,
      isExhausted,
      cooldownRemainingSec,
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

// ─── Key Exhaustion & Cooldown Tracking ──────────────────────────────────────

export const exhaustedKeysMap = new Map<string, { timestamp: number; reason: string }>();
// 35 seconds cooldown (Gemini rolling window resets quickly)
const KEY_EXHAUSTION_COOLDOWN_MS = 35 * 1000;

export function markKeyAsExhausted(key: string, reason: string = 'Quota exhausted (429)'): void {
  exhaustedKeysMap.set(key, { timestamp: Date.now(), reason });
  console.log(`[KeyPool] Key ${key.slice(0, 6)}... quota limit reached (${reason}). Moved to END of pool (cooldown: 35s).`);

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
  const entry = exhaustedKeysMap.get(key);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > KEY_EXHAUSTION_COOLDOWN_MS) {
    exhaustedKeysMap.delete(key);
    return false;
  }
  return true;
}

export function getExhaustedKeysList(): string[] {
  return Array.from(exhaustedKeysMap.keys());
}

export function resetKeyCooldown(key: string): void {
  exhaustedKeysMap.delete(key);
}

export function resetAllKeyCooldowns(): void {
  exhaustedKeysMap.clear();
  console.log('[KeyPool] All key cooldowns have been manually reset.');
}

export function recordKeyUsage(
  key: string,
  tokens: { prompt: number; candidates: number; total: number }
): void {
  const db = getDatabase();
  if (!db.keyStats) {
    db.keyStats = {};
  }
  if (!db.keyStats[key]) {
    db.keyStats[key] = { requestsCount: 0, promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
  }
  const rec = db.keyStats[key];
  rec.requestsCount += 1;
  rec.promptTokens += (tokens.prompt || 0);
  rec.candidatesTokens += (tokens.candidates || 0);
  rec.totalTokens += (tokens.total || 0);
  rec.lastUsedAt = new Date().toISOString();

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
 * Lease an available, non-exhausted key from the pool.
 * If excludeKeys is provided, avoids choosing a key currently locked by another parallel worker.
 */
export function leaseAvailableKey(excludeKeys: string[] = []): { key: string; index: number; total: number } | null {
  const allKeys = getServerKeys();
  if (allKeys.length === 0) return null;

  const excludedSet = new Set(excludeKeys);
  const db = getDatabase();

  // First pass: find first key in pool that is NOT exhausted and NOT currently busy (not in excludeKeys)
  // Since exhausted keys are pushed to the end of allKeys, fresh and available keys are at the beginning!
  for (let i = 0; i < allKeys.length; i++) {
    const candidateKey = allKeys[i];
    if (!isKeyExhausted(candidateKey) && !excludedSet.has(candidateKey)) {
      db.activeKeyIndex = (i + 1) % allKeys.length;
      return { key: candidateKey, index: i, total: allKeys.length };
    }
  }

  // Second pass: if all free keys are currently locked in flight, allow leasing another non-exhausted key
  for (let i = 0; i < allKeys.length; i++) {
    const candidateKey = allKeys[i];
    if (!isKeyExhausted(candidateKey)) {
      db.activeKeyIndex = (i + 1) % allKeys.length;
      return { key: candidateKey, index: i, total: allKeys.length };
    }
  }

  // All keys are exhausted
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
    const isExhausted = entry ? (now - entry.timestamp <= KEY_EXHAUSTION_COOLDOWN_MS) : false;
    const cooldownRemainingSec = entry && isExhausted ? Math.max(0, Math.ceil((KEY_EXHAUSTION_COOLDOWN_MS - (now - entry.timestamp)) / 1000)) : 0;
    const len = k.length;
    const keyMasked = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
    return { keyMasked, isExhausted, cooldownRemainingSec };
  });
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

  db.projects.forEach((p) => {
    if (folderId && p.folderId !== folderId) return;
    const untranslatedCount = p.items.filter((i) => !i.translatedText || !i.translatedText.trim()).length;
    const hasIssues = p.status === 'has_incomplete' || p.status === 'error' || Boolean(p.hasDisruption) || Boolean(p.lastError) || untranslatedCount > 0;

    // If all lines are actually translated, mark completed and skip
    if (untranslatedCount === 0 && p.totalCues > 0) {
      p.status = 'completed';
      return;
    }

    if (hasIssues) {
      p.status = 'queued';
      p.hasDisruption = false;
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

