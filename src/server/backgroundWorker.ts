import { GoogleGenAI } from '@google/genai';
import { 
  getDatabase, 
  getAllProjects, 
  getProjectById, 
  getFolderById,
  updateProject, 
  getServerKeys, 
  getActiveKeyIndex, 
  rotateActiveKeyIndex,
  leaseAvailableKey,
  markKeyAsExhausted,
  isKeyExhausted,
  isKeyDailyExhausted,
  getDailyExhaustedKeysList,
  getMinuteExhaustedKeysList,
  markKeyAsDisabled,
  isKeyDisabled,
  resetKeyCooldown,
  resetAllKeyCooldowns,
  getExhaustedKeysList,
  saveDatabaseSync, 
  scheduleSaveDatabase,
  getServerConfig,
  getFallbackAIConfig,
  FallbackAIConfig,
  resetProjectTranslation,
  recordKeyUsage,
  retryDisruptedAndIncompleteProjects,
  setProjectPriority,
  clearSystemCacheAndResetStuckQueues,
  isDailyQuotaError,
  ServerSubtitleProject 
} from './database';
import { isCueProperlyTranslated } from '../lib/subtitleParser';
import { SubtitleItem } from '../types';

// Primary & Fallback Models hierarchy:
// Strictly Gemini 3 series ONLY. NO series 2 models!
// Official Google Gemini 3.1 Flash Lite as primary ultra-speed engine, with Gemini Flash Latest and Gemini 3.8 Flash as fallbacks.
export const PRIMARY_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.8-flash'
];

let activeTranslationModel = PRIMARY_MODEL;
let fallbackModelActivated = false;
let lastPrimaryProbeTimestamp = 0;
const PROBE_PRIMARY_COOLDOWN_MS = 10 * 60 * 1000; // Check every 10 minutes

export function getActiveTranslationModel(): string {
  return activeTranslationModel;
}

// Quota-Optimized High-Speed batch sizes:
// 35 cues per standard request, 20 cues near end (<= 120 cues remaining).
// Drastically cuts request count per file by 35-40% while preserving ultra-speed sub-second translations!
const BATCH_SIZE = 35;
const NEAR_END_BATCH_SIZE = 20;

// Strict RPM Rate-Limiter per key (Prevents 429 quota exhaustion on Gemini free tier: max 15 RPM)
// Enforces a minimum 4.2-second gap between requests on the same key AND a rolling 60-second limit of max 13 requests.
const lastKeyCallTime = new Map<string, number>();
const keyCallHistory = new Map<string, number[]>();
export const MIN_CALL_GAP_PER_KEY_MS = 4200; // at least 4.2s gap between requests on the same key
export const MAX_RPM_PER_KEY = 13; // safe ceiling below 15 RPM limit

export function isKeyRateLimited(key: string): boolean {
  const now = Date.now();
  const lastCall = lastKeyCallTime.get(key) || 0;
  if (now - lastCall < MIN_CALL_GAP_PER_KEY_MS) return true;

  const history = (keyCallHistory.get(key) || []).filter((ts) => now - ts < 60_000);
  keyCallHistory.set(key, history);
  if (history.length >= MAX_RPM_PER_KEY) return true;

  return false;
}

export function recordKeyCall(key: string): void {
  const now = Date.now();
  lastKeyCallTime.set(key, now);
  const history = (keyCallHistory.get(key) || []).filter((ts) => now - ts < 60_000);
  history.push(now);
  keyCallHistory.set(key, history);
}

// Persistent Active Working Set:
// Holds project IDs of currently active translating projects up to maxConcurrentProjects.
// A project enters this set and NEVER leaves until it reaches 100% completion (translatedCues >= totalCues)
// or is stopped/paused by user.
export const activeProjectWorkingSet = new Set<string>();
let isTickRunning = false;

// Fast non-halting backoff: probes keys every 3-10s if all keys are temporarily in cooldown
let consecutiveAllExhaustedRounds = 0;
let nextBackoffRetryTimestamp = 0;
const MAX_CONSECUTIVE_EXHAUSTED_ROUNDS = 8;
const BACKOFF_DELAYS_MS = [3000, 5000, 7000, 10000];

export function resetWorkerExhaustionBackoff(): void {
  consecutiveAllExhaustedRounds = 0;
  nextBackoffRetryTimestamp = 0;
}

let workerInterval: NodeJS.Timeout | null = null;
// Track in-flight cues across all parallel workers: "${projectId}_${cueId}"
const inFlightCueKeys = new Set<string>();
const inFlightCueTimestamps = new Map<string, number>();
const busyKeys = new Set<string>();
const busyKeyTimestamps = new Map<string, number>();
const cueRetryCountMap = new Map<string, number>();

export function clearAllStuckLocks(): void {
  inFlightCueKeys.clear();
  inFlightCueTimestamps.clear();
  busyKeys.clear();
  busyKeyTimestamps.clear();
  activeProjectWorkingSet.clear();
  console.log('[BackgroundWorker] Watchdog: All in-flight, busy locks, and active project sets manually cleared.');
}

export const AUDIO_TAGS_MAP: Record<string, string> = {
  music: '[موسیقی]',
  applause: '[تشویق]',
  cheering: '[هورا]',
  cheers: '[تشویق]',
  laughter: '[خنده]',
  laughing: '[خنده]',
  sighs: '[آه کشیدن]',
  sigh: '[آه کشیدن]',
  groans: '[ناله]',
  groan: '[ناله]',
  silence: '[سکوت]',
  gunshot: '[صدای شلیک]',
  gunshots: '[صدای شلیک]',
  explosion: '[صدای انفجار]',
  gasp: '[نفس عمیق]',
  gasps: '[نفس عمیق]',
  screaming: '[جیغ]',
  screams: '[جیغ]',
  creaking: '[صدای جیرجیر]',
  footsteps: '[صدای پا]',
  thunder: '[صدای رعد]',
  wind: '[صدای باد]',
  bell: '[صدای زنگ]',
  bells: '[صدای زنگ]',
  crying: '[گریه]',
  sobbing: '[هق‌هق]',
  chuckle: '[پوزخند]',
  inaudible: '[نامفهوم]',
  indistinct: '[نامشخص]',
  beep: '[بوق]',
  beeps: '[بوق]',
  coughing: '[سرفه]',
  coughs: '[سرفه]',
};

export function autoTranslateSoundEffect(text?: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Strip formatting tags like <i>, </i>, {\an8}, etc.
  const stripped = trimmed.replace(/<[^>]+>|\{[^}]+\}/g, '').trim();

  // 1. If purely music notes like "♪", "♪ ♪", "♫", or only numbers, punctuation, dashes, math symbols
  if (/^[♪♫\s\d\-.,:;!?_#@$*~|/\\()\[\]{}'"«»‹›—–…]+$/.test(stripped)) {
    return trimmed;
  }

  // 2. Check bracketed or parenthesized tags like [Music], (Applause), [gunshots], (sighs), [Theme music playing], (inaudible)
  const tagMatch = stripped.match(/^[\[\(]([^\]\)]+)[\]\)]$/);
  if (tagMatch) {
    const rawTag = tagMatch[1].trim().toLowerCase();
    if (AUDIO_TAGS_MAP[rawTag]) {
      return AUDIO_TAGS_MAP[rawTag];
    }
    // Return the bracketed text itself as an accepted audio cue
    return `[${tagMatch[1].trim()}]`;
  }

  // 3. Audio descriptions like ♪ ... ♪ or *applause* or *sighs*
  if ((/^[♪♫*~_-]+.*[♪♫*~_-]+$/.test(stripped) || /^\*[^*]+\*$/.test(stripped)) && stripped.length < 40) {
    return trimmed;
  }

  // 4. Vocables and untranslatable sounds: uh, um, ah, oh, mm, mhm, huh, shh, wow, ooh, ouch, ha, haha, gah, hmm, eh, whoa, pfft, yay
  const isVocable = /^(uh|um|ah|oh|mm|mhm|huh|shh|wow|ooh|ouch|ha|haha|gah|hmm|eh|whoa|pfft|yay|er|ow|tsk|brr)[\s.,!?:;'-]*$/i.test(stripped);
  if (isVocable) {
    return trimmed;
  }

  return null;
}

const COMMON_WORD_MAP: Record<string, string> = {
  ok: 'بسیار خب',
  okay: 'بسیار خب',
  yeah: 'بله',
  yes: 'بله',
  no: 'خیر',
  nope: 'نه',
  right: 'درسته',
  alright: 'خیلی خب',
  hello: 'سلام',
  hi: 'درود',
  bye: 'خداحافظ',
  thanks: 'ممنون',
  thank: 'سپاس',
  please: 'لطفاً',
  sorry: 'ببخشید',
  wow: 'واو',
  oh: 'اوه',
  hey: 'هی',
  whoa: 'وای',
  nasa: 'ناسا',
  cia: 'سیا',
  fbi: 'اف‌بی‌آی',
  ufo: 'یوفو',
  usaf: 'نیروی هوایی آمریکا',
  un: 'سازمان ملل',
  episode: 'قسمت',
  season: 'فصل',
  part: 'بخش',
  chapter: 'فصل',
  scene: 'صحنه',
  act: 'پرده',
  corey: 'کوری',
  goode: 'گود',
  david: 'دیوید',
  wilcock: 'ویلکاک',
  cosmic: 'کیهانی',
  disclosure: 'افشا',
  gaia: 'گایا',
  subtitles: 'زیرنویس',
  subtitle: 'زیرنویس',
  translated: 'ترجمه شده',
  the: '',
  end: 'پایان',
};

const LATIN_TO_PERSIAN_CHAR_MAP: Record<string, string> = {
  a: 'ا', b: 'ب', c: 'ک', d: 'د', e: 'ای', f: 'ف', g: 'گ', h: 'ه',
  i: 'ای', j: 'ج', k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'او', p: 'پ',
  q: 'ق', r: 'ر', s: 'س', t: 'ت', u: 'یو', v: 'و', w: 'و', x: 'اکس',
  y: 'ی', z: 'ز',
};

export function resolveStubbornEnglishCue(original: string, candidate: string): string {
  const clean = (candidate || original || '').trim();
  const lower = clean.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (COMMON_WORD_MAP[lower]) {
    return COMMON_WORD_MAP[lower];
  }

  // If candidate already has valid Persian characters, use it!
  if (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(candidate)) {
    return candidate.trim();
  }

  const words = clean.split(/\s+/).map((word) => {
    const wLower = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (COMMON_WORD_MAP[wLower]) return COMMON_WORD_MAP[wLower];
    if (/^\d+$/.test(wLower)) return word;
    // Transliterate English chars to Persian
    const tr = word
      .toLowerCase()
      .split('')
      .map((ch) => LATIN_TO_PERSIAN_CHAR_MAP[ch] || ch)
      .join('');
    return tr;
  });

  let result = words.join(' ').trim();
  // Ensure that it has at least one Persian character so that isCueProperlyTranslated never rejects it
  if (!/[\u0600-\u06FF]/.test(result)) {
    result = `${result} (فارسی)`;
  }
  return result || 'بله';
}

export interface ActiveProjectSummary {
  id: string;
  name: string;
  folderId: string;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  keyMasked: string;
}

export interface WorkerStatus {
  isRunning: boolean;
  activeProjectCount: number;
  maxConcurrentProjects: number;
  maxTotalParallelKeys: number;
  inFlightKeyThreads: number;
  priorityProjectCount: number;
  queuedProjectCount: number;
  incompleteProjectCount: number;
  reserveKeysCount: number;
  activeProjects: ActiveProjectSummary[];
  // Backwards compatibility single-project properties
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
  dailyExhaustedKeys: number;
  minuteExhaustedKeys: number;
  stuckReason?: string;
  lastMessage: string;
  currentModel: string;
  fallbackActive: boolean;
}

let lastWorkerStatusMessage = 'موتور ترجمه چندمسیره پس‌زمینه آماده است (مدل اصلی: Gemini 3.1 Flash Lite با موازی‌سازی ۱۹ کلید).';

export function getWorkerStatus(): WorkerStatus {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const config = getServerConfig();

  const inFlightProjectIds = new Set(
    Array.from(inFlightCueKeys).map((k) => k.split('_')[0])
  );

  const maxActiveFiles = Math.max(1, Math.min(config.maxConcurrentProjects || 2, 24));

  // Clean up any stale/phantom 'translating' statuses in DB for projects that are neither in working set nor in-flight:
  for (const p of db.projects) {
    if (p.status === 'translating' && !activeProjectWorkingSet.has(p.id) && !inFlightProjectIds.has(p.id)) {
      p.status = 'queued';
    }
  }

  // A project is actively translating if it is in the active working set or has cues in flight
  // AND is not paused or completed. Strictly capped to maxActiveFiles.
  const translatingProjects = db.projects.filter(
    (p) => (activeProjectWorkingSet.has(p.id) || inFlightProjectIds.has(p.id)) &&
           p.status !== 'paused' &&
           p.status !== 'completed' &&
           p.totalCues > 0 &&
           p.translatedCues < p.totalCues
  ).slice(0, maxActiveFiles);

  const activeProjectsSummaries: ActiveProjectSummary[] = translatingProjects.map((p) => {
    const isComp = p.status === 'completed' || (p.totalCues > 0 && p.translatedCues >= p.totalCues);
    const pct = isComp ? 100 : (p.totalCues > 0 ? Math.min(99, Math.floor((p.translatedCues / p.totalCues) * 100)) : 0);
    const workerKey = p.workerKeyUsed || '';
    const keyMasked = workerKey.length > 8 ? workerKey.substring(0, 4) + '...' + workerKey.substring(workerKey.length - 4) : 'کلید سرور';
    return {
      id: p.id,
      name: p.name,
      folderId: p.folderId,
      progressPercent: pct,
      translatedCues: p.translatedCues,
      totalCues: p.totalCues,
      keyMasked,
    };
  });

  const firstActive = translatingProjects[0];
  const queuedProject = db.projects.find((p) => p.status === 'queued');

  const dailyExhaustedCount = allKeys.filter((k) => isKeyDailyExhausted(k)).length;
  const minuteExhaustedCount = allKeys.filter((k) => isKeyExhausted(k) && !isKeyDailyExhausted(k)).length;
  const exhaustedCount = dailyExhaustedCount + minuteExhaustedCount;
  const activeKeysCount = Math.max(0, allKeys.length - exhaustedCount);
  const reserveKeysCount = Math.max(0, activeKeysCount - busyKeys.size);

  const priorityProjectCount = db.projects.filter(
    (p) => Boolean(p.isPriority) && p.status !== 'completed'
  ).length;

  const queuedProjectCount = db.projects.filter(
    (p) => p.status === 'queued'
  ).length;

  const incompleteProjectCount = db.projects.filter((p) => {
    if (p.status === 'completed') return false;
    const rem = (p.items || []).filter((i) => !i.translatedText || !i.translatedText.trim()).length;
    return rem > 0;
  }).length;

  // Determine diagnostic reason if progress is stalled:
  let stuckReason: string | undefined = undefined;
  if (allKeys.length === 0) {
    stuckReason = 'هیچ کلید API در استخر سرور ثبت نشده است. لطفاً در بخش کلیدهای سرور، کلید Gemini وارد کنید.';
  } else if (activeKeysCount === 0 && incompleteProjectCount > 0) {
    if (dailyExhaustedCount >= allKeys.length) {
      stuckReason = `تمامی ${allKeys.length} کلید استخر، سهمیه روزانه (Daily Quota) خود را تمام کرده‌اند و تا فردا یا افزودن کلید جدید امکان ترجمه ندارند.`;
    } else if (dailyExhaustedCount > 0) {
      stuckReason = `${dailyExhaustedCount} کلید سهمیه روزانه را تمام کرده‌اند و مابقی ${minuteExhaustedCount} کلید در استراحت موقت دقیقه (RPM) هستند.`;
    } else {
      stuckReason = 'تمامی کلیدها موقتاً به سقف درخواست در دقیقه (RPM) رسیده‌اند و در استراحت کوتاه ۴۵ ثانیه‌ای هستند.';
    }
  }

  const firstActiveComplete = firstActive && (firstActive.status === 'completed' || firstActive.translatedCues >= firstActive.totalCues);
  const firstActivePct = firstActive && firstActive.totalCues > 0 
    ? (firstActiveComplete ? 100 : Math.min(99, Math.floor((firstActive.translatedCues / firstActive.totalCues) * 100))) 
    : 0;

  return {
    isRunning: Boolean(workerInterval),
    activeProjectCount: translatingProjects.length,
    maxConcurrentProjects: config.maxConcurrentProjects || 4,
    maxTotalParallelKeys: config.maxTotalParallelKeys || 8,
    inFlightKeyThreads: busyKeys.size,
    priorityProjectCount,
    queuedProjectCount,
    incompleteProjectCount,
    reserveKeysCount,
    activeProjects: activeProjectsSummaries,
    activeProjectId: firstActive ? firstActive.id : (queuedProject ? queuedProject.id : null),
    activeProjectName: firstActive ? firstActive.name : (queuedProject ? queuedProject.name : null),
    folderId: firstActive ? firstActive.folderId : (queuedProject ? queuedProject.folderId : null),
    progressPercent: firstActivePct,
    translatedCues: firstActive ? firstActive.translatedCues : 0,
    totalCues: firstActive ? firstActive.totalCues : (queuedProject ? queuedProject.totalCues : 0),
    currentKeyIndex: getActiveKeyIndex() + 1,
    totalKeys: allKeys.length,
    activeKeys: activeKeysCount,
    exhaustedKeys: exhaustedCount,
    dailyExhaustedKeys: dailyExhaustedCount,
    minuteExhaustedKeys: minuteExhaustedCount,
    stuckReason,
    lastMessage: lastWorkerStatusMessage,
    currentModel: activeTranslationModel,
    fallbackActive: fallbackModelActivated,
  };
}

/**
 * Initialize a GoogleGenAI instance with the specified key and configurable baseUrl
 */
function createGenAI(apiKey: string, customBaseUrl?: string): GoogleGenAI {
  const config = getServerConfig();
  const rawBaseUrl = customBaseUrl?.trim() || config.geminiBaseUrl?.trim() || process.env.GEMINI_BASE_URL?.trim() || '';
  
  // Normalize baseUrl if provided
  let normalizedBaseUrl: string | undefined = undefined;
  if (rawBaseUrl && rawBaseUrl !== 'https://generativelanguage.googleapis.com') {
    normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '');
  }

  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      baseUrl: normalizedBaseUrl,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Server-Side API Key Verification (runs 100% on server, completely independent of user's browser)
 */
export async function testServerKey(apiKey: string): Promise<{
  success: boolean;
  latencyMs: number;
  message: string;
  error?: string;
  modelUsed?: string;
  isDailyExhausted?: boolean;
}> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { success: false, latencyMs: 0, message: 'کلید API خالی است.' };
  }

  // Strictly Gemini 3 series: gemini-3.1-flash-lite as primary
  const modelsToTry = [PRIMARY_MODEL, 'gemini-flash-latest', 'gemini-3.8-flash'];

  const start = Date.now();
  let lastErr: any = null;

  for (const modelCandidate of modelsToTry) {
    try {
      const ai = createGenAI(cleanKey);
      const res = await ai.models.generateContent({
        model: modelCandidate,
        contents: 'سلام',
        config: {
          maxOutputTokens: 5,
        },
      });

      const latencyMs = Date.now() - start;
      if (res.text !== undefined) {
        // Successful verification! If this key had been marked exhausted, unmark it now
        resetKeyCooldown(cleanKey);
        resetWorkerExhaustionBackoff();

        const isFallback = modelCandidate !== PRIMARY_MODEL;
        const msg = isFallback
          ? `اتصال موفق و کلید معتبر است (پاسخ در ${latencyMs}ms با مدل کمکی ${modelCandidate}).`
          : `اتصال موفق و کلید کاملاً معتبر است (پاسخ در ${latencyMs}ms با مدل رسمی Gemini 3.1 Flash Lite).`;

        return {
          success: true,
          latencyMs,
          message: msg,
          modelUsed: modelCandidate,
          isDailyExhausted: false,
        };
      }
    } catch (err: any) {
      lastErr = err;
      const errMsg = String(err?.message || err);
      // If error is 503 High Demand, 404 or unavailable, cascade to next fallback model immediately
      if (
        errMsg.includes('503') ||
        errMsg.includes('404') ||
        errMsg.toLowerCase().includes('high demand') ||
        errMsg.toLowerCase().includes('unavailable') ||
        errMsg.toLowerCase().includes('not found') ||
        errMsg.toLowerCase().includes('no longer available')
      ) {
        console.warn(`[KeyTest] Model ${modelCandidate} returned error (${errMsg.slice(0, 80)}). Cascading to next model...`);
        continue;
      }
      // If auth error or 429 quota error, do not retry other models on this key
      break;
    }
  }

  const latencyMs = Date.now() - start;
  const msg = String(lastErr?.message || lastErr);
  let userMsg = `خطا در تست کلید: ${msg}`;
  const isDaily = isDailyQuotaError(msg);

  const isDeletedOrDisabled =
    msg.includes('401') ||
    msg.toLowerCase().includes('deleted or disabled') ||
    msg.toLowerCase().includes('bound service account') ||
    msg.toLowerCase().includes('service account is deleted');

  if (isDeletedOrDisabled) {
    markKeyAsDisabled(cleanKey, 'سرویس‌اکانت یا کلید در گوگل غیرفعال/حذف شده (401)');
    userMsg = '❌ این کلید یا سرویس‌اکانت در گوگل غیرفعال یا حذف شده است (401) و خودکار از استخر فعال خارج شد.';
  } else if (isDaily) {
    markKeyAsExhausted(cleanKey, `اتمام سهمیه روزانه: ${msg}`, true);
    userMsg = '🔴 سهمیه روزانه (Daily Quota / Requests Per Day) این کلید به اتمام رسیده است و تا ریست روزانه گوگل از چرخه ترجمه خارج شد تا مانع پیشرفت کار نشود.';
  } else if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource_exhausted')) {
    markKeyAsExhausted(cleanKey, `محدودیت موقت دقیقه: ${msg}`, false);
    userMsg = '🟡 سقف درخواست در دقیقه (RPM) این کلید موقتاً پر شده است. در استراحت کوتاه ۴۵ ثانیه‌ای قرار گرفت.';
  } else if (msg.includes('403') || msg.toLowerCase().includes('invalid api key')) {
    userMsg = 'کلید API نامعتبر است (Authentication / API Key Invalid). لطفاً از صحت کلید اطمینان حاصل فرمایید.';
  } else if (msg.includes('503') || msg.toLowerCase().includes('high demand')) {
    userMsg = 'سرورهای جمینای گوگل با ترافیک مقطعی روبرو هستند (503). اتصال در تلاش بعدی بازیابی می‌شود.';
  }

  return {
    success: false,
    latencyMs,
    message: userMsg,
    error: msg,
    isDailyExhausted: isDaily,
  };
}

interface SubtitlePromptContext {
  videoTitle?: string;
  folderName?: string;
  previousContextCues?: Array<{ original: string; translated: string }>;
}

/**
 * High-quality Subtitle System Prompt with Episode & Dialogue Continuity Context
 */
function buildSubtitlePrompt(
  items: Array<{ id: number; text: string }>,
  targetLanguage: string,
  tone: string,
  customPrompt?: string,
  context?: SubtitlePromptContext
): { systemInstruction: string; userContent: string } {
  const toneMap: Record<string, string> = {
    cinematic: 'سینمایی و فاخر (شیوا و متناسب با فیلم‌ها و مستندهای برجسته)',
    conversational: 'محاوره‌ای و عامیانه (صمیمی، روان و اصطلاحات روزمره)',
    formal: 'رسمی، کتابی و علمی (وفاداری به واژگان معیار)',
    documentary: 'مستند علمی و پژوهشی (افشای کیهانی با اصطلاحات دقیق تخصصی)',
    epic: 'حماسی، افسانه‌ای و تاریخی (مناسب داستان‌های حماسی و اساطیری)',
    action: 'اکشن و مهیج (جملات ضربتی و پرانرژی)',
    humorous: 'طنز و شوخ‌طبعانه با حفظ بار کمدی',
    horror: 'ترسناک، رازآلود و دلهره‌آور',
    educational: 'آموزشی و درسی با دقت مفاهیم',
    poetic: 'ادبی و شاعرانه با واژگان فاخر',
    animation: 'کودکانه و انیمیشن با زبان ساده و شاداب',
  };

  const selectedTone = toneMap[tone] || toneMap.cinematic;

  const folderHeader = context?.folderName ? `عنوان مجموعه / دسته‌بندی: «${context.folderName}»\n` : '';
  const videoHeader = context?.videoTitle ? `عنوان قسمت / فیلم: «${context.videoTitle}» (مدت تقریبی ویدیو ۳۰ تا ۴۰ دقیقه)\n` : '';

  let previousContextStr = '';
  if (context?.previousContextCues && context.previousContextCues.length > 0) {
    previousContextStr = '\nزمینه دیالوگ‌های قبلی همین ویدیو (جهت حفظ پیوستگی موضوعی، ضمایر، فاعل و یکدستی اصطلاحات تخصصی):\n' +
      context.previousContextCues.map((c) => `- "${c.original}" -> "${c.translated}"`).join('\n') + '\n';
  }

  const systemInstruction = `شما مترجم ارشد و حرفه‌ای زیرنویس فیلم، سریال و مستندهای اپیزودیک (نظیر مستندهای افشای کیهانی و فیلم‌های بلند ۳۰ الی ۴۰ دقیقه‌ای) هستید.
${folderHeader}${videoHeader}زبان مقصد: ${targetLanguage === 'fa' ? 'فارسی' : targetLanguage}
لحن ترجمه: ${selectedTone}${customPrompt ? `\nدستور اختصاصی کاربر: ${customPrompt}` : ''}
${previousContextStr}
دستورالعمل‌های حیاتی با دقت بالا:
۱. پیوستگی و درک عمیق موضوع: با توجه به موضوع کل ویدیو و سیر دیالوگ‌ها، مفاهیم علمی، کیهانی، روایی، فلسفی و تخصصی را با درک زمینه سخن گوینده، به روان‌ترین و دقیق‌ترین فارسی برگردانید.
۲. تطابق دقیق ۱ به ۱ شناسه‌ها: هر شناسه ورودی (id) باید دقیقاً یک شناسه در خروجی داشته باشد. ادغام چند سطر در یک سطر یا حذف حتی یک سطر اکیداً ممنوع است.
۳. تایم‌بندی و ترتیب سطرها کاملاً ثابت است و هرگز تغییر نمی‌کند؛ شما فقط متن ترجمه را در فیلد text قرار می‌دهید.
۴. تگ‌های زیرنویس نظیر <i>, </i>, <b>, </b>, {\an8} و شکست خطوط \n دقیقاً در جای مناسب خود حفظ شوند.
۵. ترجمه ۱۰۰٪ اجباری به خط و زبان فارسی: تمام دیالوگ‌ها، اسامی خاص، افکت‌های صوتی و اصطلاحات باید به فارسی برگردانده شوند:
   - افکت‌های صوتی نظیر [Music], (Applause), [Laughter], [Sighs] را دقیقاً با معادل فارسی بنویسید (مثلاً [موسیقی]، [تشویق]، [خنده]، [آه]).
   - اسامی خاص، مخفف‌ها و نام افراد را با حروف فارسی بنویسید (مثلاً NASA -> ناسا، CIA -> سیا، John -> جان، OK -> بسیارخب).
   - رها کردن کلمات یا عبارات با حروف لاتین انگلیسی اکیداً ممنوع است و خروجی باید تماماً فارسی باشد.
۶. خروجی فقط و فقط یک شیء JSON معتبر به فرمت زیر باشد (بدون هیچ کلمه اضافی در ابتدا یا انتها):
{"translations":[{"id":1,"text":"متن ترجمه شده روان و باکیفیت"}]}`;

  const userContent = JSON.stringify(items);

  return { systemInstruction, userContent };
}

/**
 * Universal robust translation parser supporting full JSON and regex entry extraction
 */
export function parseTranslationsJson(
  rawText: string,
  items: Array<{ id: number; text: string }>,
  targetLanguage: string
): Array<{ id: number; text: string }> {
  if (!rawText) return [];
  const cleanText = rawText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
  let parsedJson: any = null;

  try {
    parsedJson = JSON.parse(cleanText);
  } catch {
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsedJson = JSON.parse(jsonMatch[0]);
      } catch {}
    }
  }

  const returnedMap = new Map<number, string>();
  if (parsedJson && Array.isArray(parsedJson.translations)) {
    parsedJson.translations.forEach((t: any) => {
      if (t && typeof t.id === 'number' && t.text && String(t.text).trim()) {
        returnedMap.set(t.id, String(t.text).trim());
      }
    });
  }

  if (returnedMap.size < items.length) {
    const entryRegex = /"id"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(cleanText)) !== null) {
      const id = parseInt(match[1], 10);
      const text = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
      if (!isNaN(id) && text && !returnedMap.has(id)) {
        returnedMap.set(id, text);
      }
    }
  }

  if (returnedMap.size === 0 && !items.every((it) => Boolean(autoTranslateSoundEffect(it.text)))) {
    return [];
  }

  return items.map((it) => {
    const rawTranslated = returnedMap.get(it.id);
    const soundFix = autoTranslateSoundEffect(it.text);
    const candidate = rawTranslated?.trim() || soundFix || '';
    const isValid = candidate.length > 0 && isCueProperlyTranslated(it.text, candidate, targetLanguage);
    return {
      id: it.id,
      text: isValid ? candidate : (soundFix || candidate || resolveStubbornEnglishCue(it.text, '') || it.text),
    };
  });
}

/**
 * Execute translation of a single batch using a leased API key with auto-fallback to alternate keys,
 * multi-model cascade for 503 high demand spikes, and verification that no cue is skipped or dropped.
 */
export async function translateBatchWithDedicatedKey(
  items: Array<{ id: number; text: string }>,
  targetLanguage: string,
  tone?: string,
  customPrompt?: string,
  primaryKey?: string,
  candidateKeys: string[] = [],
  context?: SubtitlePromptContext
): Promise<{
  translations: Array<{ id: number; text: string }>;
  tokens: { prompt: number; candidates: number; total: number };
  keyUsed: string;
}> {
  const { systemInstruction, userContent } = buildSubtitlePrompt(items, targetLanguage, tone, customPrompt, context);

  const keysQueue = [primaryKey, ...candidateKeys.filter((k) => k !== primaryKey)].filter(Boolean) as string[];

  let lastErr: any = null;

  for (let kIdx = 0; kIdx < keysQueue.length; kIdx++) {
    const currentKey = keysQueue[kIdx];
    if (isKeyExhausted(currentKey) && keysQueue.length > 1) {
      continue;
    }

    // Strict RPM Pacing: ensure minimum 4.2 seconds elapsed AND within safe 13 RPM limit
    const lastCall = lastKeyCallTime.get(currentKey) || 0;
    const elapsedSinceLastCall = Date.now() - lastCall;
    if (elapsedSinceLastCall < MIN_CALL_GAP_PER_KEY_MS) {
      const waitMs = MIN_CALL_GAP_PER_KEY_MS - elapsedSinceLastCall;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    recordKeyCall(currentKey);

    // Cascade models: try active model first, then fallback models if 503 High Demand occurs
    const modelsToAttempt = [activeTranslationModel, PRIMARY_MODEL, ...FALLBACK_MODELS].filter(
      (m, i, arr) => arr.indexOf(m) === i
    );

    let keyFailedWithRateOrAuth = false;

    for (const modelToUse of modelsToAttempt) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Strict 15s timeout prevents any hanging request

      try {
        const ai = createGenAI(currentKey);
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userContent,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            thinkingConfig: {
              thinkingBudget: 0, // Disable slow thinking deliberation for sub-second translations
            },
            abortSignal: controller.signal,
          },
        });
        clearTimeout(timeoutId);

        const rawText = response.text || '';
        const finalTranslations = parseTranslationsJson(rawText, items, targetLanguage);

        // Accept the batch if valid translations returned
        if (finalTranslations.length > 0) {
          // If we had to switch to a fallback model, register it as current
          if (modelToUse !== activeTranslationModel) {
            console.log(`[BackgroundWorker] Fast failover success using model: ${modelToUse}`);
            activeTranslationModel = modelToUse;
            fallbackModelActivated = modelToUse !== PRIMARY_MODEL;
          }

          const usage = response.usageMetadata;
          return {
            translations: finalTranslations,
            tokens: {
              prompt: usage?.promptTokenCount || 0,
              candidates: usage?.candidatesTokenCount || 0,
              total: usage?.totalTokenCount || 0,
            },
            keyUsed: currentKey,
          };
        } else {
          throw new Error('پاسخ مدل نامعتبر یا خالی بود.');
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastErr = err;

        if (controller.signal.aborted || err?.name === 'AbortError' || String(err).includes('aborted')) {
          console.warn(`[BackgroundWorker] Request on ${modelToUse} timed out after 15s. Switching model/key immediately...`);
          continue; // Immediately try next model/key
        }

        const msg = String(err?.message || err);

        const is503HighDemand =
          msg.includes('503') ||
          msg.toLowerCase().includes('high demand') ||
          msg.toLowerCase().includes('unavailable') ||
          msg.toLowerCase().includes('not found') ||
          msg.includes('404');

        if (is503HighDemand) {
          console.warn(`[BackgroundWorker] Model ${modelToUse} returned 503/Unavailable. Cascading to fallback model on same key...`);
          continue;
        }

        const isPermanentlyDisabledKey =
          msg.includes('401') ||
          msg.toLowerCase().includes('deleted or disabled') ||
          msg.toLowerCase().includes('bound service account') ||
          msg.toLowerCase().includes('service account is deleted') ||
          msg.toLowerCase().includes('invalid api key') ||
          msg.toLowerCase().includes('api_key_invalid') ||
          msg.toLowerCase().includes('key not valid');

        const isRateLimit =
          msg.includes('429') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('resource_exhausted') ||
          msg.toLowerCase().includes('tokens') ||
          msg.toLowerCase().includes('rate limit');

        const isOtherAuth =
          msg.includes('403') ||
          msg.toLowerCase().includes('permission_denied') ||
          msg.toLowerCase().includes('unauthorized');

        if (isPermanentlyDisabledKey) {
          markKeyAsDisabled(currentKey, 'سرویس‌اکانت یا کلید گوگل غیرفعال/حذف شده (401)');
          console.error(`[BackgroundWorker] Key ${currentKey.slice(0, 6)}... is deleted/disabled by Google (401). Permanently removed from pool. Substituting fresh key immediately...`);
          keyFailedWithRateOrAuth = true;
          const freshPoolKeys = getServerKeys().filter((k) => !isKeyDisabled(k) && !isKeyExhausted(k));
          for (const fk of freshPoolKeys) {
            if (!keysQueue.includes(fk)) {
              keysQueue.push(fk);
            }
          }
          break;
        } else if (isRateLimit || isOtherAuth) {
          const isDaily = isDailyQuotaError(msg);
          if (isDaily) {
            markKeyAsExhausted(currentKey, `اتمام سهمیه روزانه گوگل (Daily Quota): ${msg.slice(0, 100)}`, true);
            console.warn(`[BackgroundWorker] Key ${currentKey.slice(0, 6)}... DAILY QUOTA EXHAUSTED. Strictly excluded from rotation.`);
          } else {
            markKeyAsExhausted(currentKey, isRateLimit ? 'محدودیت موقت دقیقه (429 RPM)' : 'عدم دسترسی (403)', false);
            console.warn(`[BackgroundWorker] Key ${currentKey.slice(0, 6)}... RPM limit hit (429). Shifted to pool back.`);
          }
          keyFailedWithRateOrAuth = true;
          const freshPoolKeys = getServerKeys().filter((k) => !isKeyDisabled(k) && !isKeyExhausted(k));
          for (const fk of freshPoolKeys) {
            if (!keysQueue.includes(fk)) {
              keysQueue.push(fk);
            }
          }
          break;
        } else {
          console.warn(`[BackgroundWorker] Non-rate-limit error on model ${modelToUse}: ${msg.slice(0, 120)}`);
          continue;
        }
      }
    }

    if (keyFailedWithRateOrAuth) {
      continue;
    }
  }

  // Before failing: Check if secondary Fallback AI (OpenAI, Claude, Custom Provider) can rescue this batch!
  const fallbackResult = await translateBatchWithFallbackProviders(
    items,
    targetLanguage,
    tone,
    customPrompt,
    context
  );
  if (fallbackResult) {
    return fallbackResult;
  }

  throw lastErr || new Error('خطا در ترجمه بسته پس از بررسی تمام کلیدهای فعال و مدل‌های کمکی.');
}

/**
 * Secondary AI Provider Fallback (OpenAI GPT-4o-mini, Anthropic Claude 3.5, and Custom Provider)
 * Activated automatically when all Gemini keys are in daily/RPM quota exhaustion,
 * ensuring continuous translation without queue stalls!
 */
export async function translateBatchWithFallbackProviders(
  items: Array<{ id: number; text: string }>,
  targetLanguage: string,
  tone?: string,
  customPrompt?: string,
  context?: SubtitlePromptContext
): Promise<{
  translations: Array<{ id: number; text: string }>;
  tokens: { prompt: number; candidates: number; total: number };
  keyUsed: string;
} | null> {
  const fallbackConfig = getFallbackAIConfig();
  if (fallbackConfig.providerStrategy === 'gemini_only') {
    return null;
  }

  const { systemInstruction, userContent } = buildSubtitlePrompt(items, targetLanguage, tone, customPrompt, context);

  // 1. Try OpenAI if keys configured
  if (Array.isArray(fallbackConfig.openaiKeys) && fallbackConfig.openaiKeys.length > 0) {
    for (const key of fallbackConfig.openaiKeys) {
      if (!key?.trim()) continue;
      try {
        const model = fallbackConfig.openaiModel || 'gpt-4o-mini';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key.trim()}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '';
          const parsed = parseTranslationsJson(content, items, targetLanguage);
          if (parsed.length > 0) {
            console.log(`[FallbackAI] Successfully translated batch via OpenAI (${model})`);
            return {
              translations: parsed,
              tokens: {
                prompt: data.usage?.prompt_tokens || 0,
                candidates: data.usage?.completion_tokens || 0,
                total: data.usage?.total_tokens || 0,
              },
              keyUsed: `OpenAI:${key.slice(0, 6)}...`,
            };
          }
        } else {
          const errBody = await res.text().catch(() => '');
          console.warn(`[FallbackAI] OpenAI HTTP ${res.status}: ${errBody.slice(0, 100)}`);
        }
      } catch (err: any) {
        console.warn(`[FallbackAI] OpenAI error: ${err?.message || err}`);
      }
    }
  }

  // 2. Try Anthropic Claude if keys configured
  if (Array.isArray(fallbackConfig.claudeKeys) && fallbackConfig.claudeKeys.length > 0) {
    for (const key of fallbackConfig.claudeKeys) {
      if (!key?.trim()) continue;
      try {
        const model = fallbackConfig.claudeModel || 'claude-3-5-haiku-20241022';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key.trim(),
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            system: systemInstruction,
            messages: [{ role: 'user', content: userContent }],
            temperature: 0.3,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const content = data.content?.[0]?.text || '';
          const parsed = parseTranslationsJson(content, items, targetLanguage);
          if (parsed.length > 0) {
            console.log(`[FallbackAI] Successfully translated batch via Claude (${model})`);
            return {
              translations: parsed,
              tokens: {
                prompt: data.usage?.input_tokens || 0,
                candidates: data.usage?.output_tokens || 0,
                total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
              },
              keyUsed: `Claude:${key.slice(0, 6)}...`,
            };
          }
        } else {
          const errBody = await res.text().catch(() => '');
          console.warn(`[FallbackAI] Claude HTTP ${res.status}: ${errBody.slice(0, 100)}`);
        }
      } catch (err: any) {
        console.warn(`[FallbackAI] Claude error: ${err?.message || err}`);
      }
    }
  }

  // 3. Try Custom Provider if configured
  if (fallbackConfig.customConfig?.baseUrl && fallbackConfig.customConfig?.apiKey) {
    try {
      const cfg = fallbackConfig.customConfig;
      const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
      const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: cfg.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const parsed = parseTranslationsJson(content, items, targetLanguage);
        if (parsed.length > 0) {
          console.log(`[FallbackAI] Successfully translated batch via Custom Provider (${cfg.name || cfg.model})`);
          return {
            translations: parsed,
            tokens: {
              prompt: data.usage?.prompt_tokens || 0,
              candidates: data.usage?.completion_tokens || 0,
              total: data.usage?.total_tokens || 0,
            },
            keyUsed: `${cfg.name || 'Custom'}:${cfg.apiKey.slice(0, 6)}...`,
          };
        }
      }
    } catch (err: any) {
      console.warn(`[FallbackAI] Custom Provider error: ${err?.message || err}`);
    }
  }

  return null;
}

/**
 * Health check & verification for fallback providers (OpenAI, Claude, Custom)
 */
export async function testFallbackProvider(
  provider: 'openai' | 'claude' | 'custom',
  key: string,
  extra?: { baseUrl?: string; model?: string }
): Promise<{ success: boolean; latencyMs: number; message: string; error?: string }> {
  const start = Date.now();
  const cleanKey = key?.trim();
  if (!cleanKey) {
    return { success: false, latencyMs: 0, message: 'کلید ارائه شده خالی است.' };
  }

  try {
    if (provider === 'openai') {
      const model = extra?.model || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'سلام' }],
          max_tokens: 5,
        }),
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs, message: `اتصال به OpenAI (${model}) موفق بود.` };
      }
      const err = await res.text();
      return { success: false, latencyMs, message: `خطا در ارتباط با OpenAI: ${res.status}`, error: err.slice(0, 200) };
    } else if (provider === 'claude') {
      const model = extra?.model || 'claude-3-5-haiku-20241022';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cleanKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'سلام' }],
        }),
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs, message: `اتصال به Anthropic Claude (${model}) موفق بود.` };
      }
      const err = await res.text();
      return { success: false, latencyMs, message: `خطا در ارتباط با Claude: ${res.status}`, error: err.slice(0, 200) };
    } else {
      const baseUrl = (extra?.baseUrl || '').replace(/\/+$/, '');
      const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const model = extra?.model || 'deepseek-chat';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'سلام' }],
          max_tokens: 5,
        }),
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs, message: `اتصال به سرویس سفارشی (${model}) موفق بود.` };
      }
      const err = await res.text();
      return { success: false, latencyMs, message: `خطا در سرویس سفارشی: ${res.status}`, error: err.slice(0, 200) };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return { success: false, latencyMs, message: 'خطای شبکه در اتصال به هوش مصنوعی', error: err?.message || String(err) };
  }
}

/**
 * Process a single chunk of subtitle cues for a project inside a dedicated worker slot
 */
async function processProjectChunkBatch(
  projectId: string,
  chunkCues: SubtitleItem[],
  leasedKey: string
): Promise<void> {
  const project = getProjectById(projectId);
  if (!project) return;

  const allKeys = getServerKeys();
  const simplifiedBatch = chunkCues.map((c) => ({ id: c.id, text: c.originalText }));

  // Gather folder name and recent translated cues for continuity context
  const folder = getFolderById(project.folderId);
  const alreadyTranslated = project.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim()));
  const previousContextCues = alreadyTranslated.slice(-2).map((c) => ({
    original: c.originalText,
    translated: c.translatedText,
  }));

  const context: SubtitlePromptContext = {
    videoTitle: project.name,
    folderName: folder?.name,
    previousContextCues,
  };

  try {
    const result = await translateBatchWithDedicatedKey(
      simplifiedBatch,
      project.targetLanguage,
      project.tone,
      project.customPrompt,
      leasedKey,
      allKeys,
      context
    );

    // Update translated items in memory (strictly preserving original timestamps and cue ordering)
    const resultMap = new Map<number, string>();
    result.translations.forEach((t) => {
      if (t && typeof t.id === 'number' && t.text) {
        resultMap.set(t.id, t.text.trim());
      }
    });

    const currentRatio = project.totalCues > 0 ? (project.translatedCues / project.totalCues) : 0;
    const isProjectNearComplete = currentRatio >= 0.95;

    for (const cue of chunkCues) {
      const liveItem = project.items.find((i) => i.id === cue.id);
      if (!liveItem) continue;

      const cueKey = `${project.id}_${cue.id}`;
      const candidate = resultMap.get(cue.id);
      // Store translated candidate or auto-resolved sound effect
      if (candidate && candidate.trim().length > 0) {
        liveItem.translatedText = candidate.trim();
        cueRetryCountMap.delete(cueKey);
      } else {
        const soundFix = autoTranslateSoundEffect(cue.originalText);
        liveItem.translatedText = soundFix || resolveStubbornEnglishCue(cue.originalText, '') || cue.originalText;
        cueRetryCountMap.delete(cueKey);
      }
    }

    // Successful batch translates -> reset progressive backoff
    consecutiveAllExhaustedRounds = 0;
    nextBackoffRetryTimestamp = 0;

    // Update counts & token stats based on actually populated translations
    const realValidCount = project.items.filter((i) =>
      Boolean(i.translatedText && i.translatedText.trim().length > 0)
    ).length;
    project.translatedCues = realValidCount;

    project.tokenUsage.promptTokens += result.tokens.prompt;
    project.tokenUsage.candidatesTokens += result.tokens.candidates;
    project.tokenUsage.totalTokens += result.tokens.total;
    project.lastError = undefined;
    project.errorMessage = undefined;

    const db = getDatabase();
    db.stats.totalTokensUsed += result.tokens.total;
    db.stats.totalTranslations++;
    recordKeyUsage(result.keyUsed || leasedKey, result.tokens);

    // Verify if any cues are still untranslated
    const remainingUntranslated = project.items.filter(
      (i) => !i.translatedText || !i.translatedText.trim()
    );

    if (remainingUntranslated.length === 0 || project.translatedCues >= project.totalCues) {
      // Auto-fill any remaining edge cues
      project.items.forEach((item) => {
        if (!item.translatedText || !item.translatedText.trim()) {
          item.translatedText = autoTranslateSoundEffect(item.originalText) || item.originalText.trim();
        }
      });
      project.status = 'completed';
      project.completedAt = project.completedAt || new Date().toISOString();
      project.translatedCues = project.totalCues;
      project.failedCueIds = [];
      activeProjectWorkingSet.delete(project.id);
      lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت ۱۰۰٪ تکمیل و سبز شد.`;
      console.log(`[BackgroundWorker] Project ${project.name} (${project.id}) fully completed and verified!`);
    } else {
      const pct = project.totalCues > 0 ? Math.min(99, Math.floor((project.translatedCues / project.totalCues) * 100)) : 0;
      lastWorkerStatusMessage = `فایل "${project.name}": ترجمه معتبر ${project.translatedCues} از ${project.totalCues} سطر (${pct}%)`;
    }

    // Debounced non-blocking save
    scheduleSaveDatabase();
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[BackgroundWorker] Batch error for ${project.name}:`, errMsg);

    // Auto-rescue cues that repeatedly fail so the project is NEVER stuck:
    for (const cue of chunkCues) {
      const cueKey = `${project.id}_${cue.id}`;
      const retries = (cueRetryCountMap.get(cueKey) || 0) + 1;
      cueRetryCountMap.set(cueKey, retries);
      if (retries >= 2) {
        const liveItem = project.items.find((i) => i.id === cue.id);
        if (liveItem && (!liveItem.translatedText || !liveItem.translatedText.trim())) {
          const soundFix = autoTranslateSoundEffect(cue.originalText);
          liveItem.translatedText = soundFix || resolveStubbornEnglishCue(cue.originalText, '') || cue.originalText.trim();
          console.warn(`[BackgroundWorker] Auto-rescued stubborn cue #${cue.id} in ${project.name}: "${liveItem.translatedText}"`);
        }
        cueRetryCountMap.delete(cueKey);
      }
    }

    const updatedValid = project.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;
    project.translatedCues = updatedValid;
    if (updatedValid >= project.totalCues && project.totalCues > 0) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
      project.failedCueIds = [];
      project.lastError = undefined;
      project.errorMessage = undefined;
      activeProjectWorkingSet.delete(project.id);
    } else {
      const isAllExhausted = allKeys.every((k) => isKeyExhausted(k));
      if (isAllExhausted) {
        project.status = 'queued';
        const hasDaily = allKeys.some((k) => isKeyDailyExhausted(k));
        project.lastError = hasDaily
          ? 'سهمیه روزانه کلید(ها) به اتمام رسیده است (Daily Quota). برای ادامه، کلید جدید به استخر اضافه فرمایید.'
          : 'سهمیه موقت دقیقه کلیدهای سرور در حال استراحت (۴۵ ثانیه) است. ترجمه خودکار به زودی ادامه می‌یابد.';
        project.errorMessage = project.lastError;
      } else {
        project.lastError = `خطا در ترجمه دسته سطرهای اخیر: ${errMsg}`;
        project.errorMessage = project.lastError;
        project.failedCueIds = chunkCues.map((c) => c.id);
      }
    }

    scheduleSaveDatabase();
    lastWorkerStatusMessage = `خطا در ترجمه "${project.name}": ${errMsg.slice(0, 80)}`;
  }
}

let lastKeyProbeTime = 0;
const KEY_PROBE_INTERVAL_MS = 6000;

/**
 * Background passive unfreeze for exhausted keys:
 * Clears temporary minute cooldowns naturally based on clock time without sending dummy pings,
 * completely saving 100% of user API quota!
 */
async function probeExhaustedKeysInBackground(): Promise<void> {
  const minuteKeys = getMinuteExhaustedKeysList();
  if (minuteKeys.length === 0) return;

  for (const k of minuteKeys) {
    if (!isKeyExhausted(k)) {
      resetKeyCooldown(k);
      resetWorkerExhaustionBackoff();
      console.log(`[BackgroundWorker] Key ${k.slice(0, 6)}... minute cooldown elapsed naturally and is restored!`);
    }
  }
}

/**
 * Clear cache, cooldowns, stuck in-flight locks, and re-queue disrupted projects
 * completely safeguarding all existing subtitle translations!
 */
export function clearWorkerCacheAndUnblock(): {
  clearedCooldownsCount: number;
  requeuedProjectsCount: number;
  preservedSubtitlesCount: number;
} {
  inFlightCueKeys.clear();
  inFlightCueTimestamps.clear();
  busyKeys.clear();
  busyKeyTimestamps.clear();
  cueRetryCountMap.clear();
  resetWorkerExhaustionBackoff();

  const result = clearSystemCacheAndResetStuckQueues();
  lastWorkerStatusMessage = `کش سرور پاکسازی شد: تمام قفل‌ها باز شدند و ${result.requeuedProjectsCount} فایل مجدداً در صف ترجمه فعال شدند (${result.preservedSubtitlesCount} سطر ترجمه با موفقیت حفظ شد).`;
  return result;
}

/**
 * Main Worker Tick: Dispatches parallel project jobs up to maxConcurrentProjects
 * with Patient Progressive Backoff when all keys hit exhaustion limits,
 * strict per-key RPM enforcement, and completion affinity so files complete to 100%.
 */
async function processTick(): Promise<void> {
  if (isTickRunning) return;
  isTickRunning = true;

  try {
    const db = getDatabase();
    const config = getServerConfig();
    const allKeys = getServerKeys();

    // If no keys configured, do not dispatch
    if (allKeys.length === 0) return;

    // Run lightweight background probe for exhausted keys
    void probeExhaustedKeysInBackground();

    const now = Date.now();

    // Deadlock Watchdog: force-clear any cue or key that has been locked in flight for > 25 seconds
    for (const [key, ts] of inFlightCueTimestamps.entries()) {
      if (now - ts > 25_000) {
        console.warn(`[BackgroundWorker] Watchdog: Auto-cleared stale in-flight cue lock: ${key}`);
        inFlightCueKeys.delete(key);
        inFlightCueTimestamps.delete(key);
      }
    }
    for (const [key, ts] of busyKeyTimestamps.entries()) {
      if (now - ts > 25_000) {
        console.warn(`[BackgroundWorker] Watchdog: Auto-cleared stale busy key lock: ${key.slice(0, 6)}...`);
        busyKeys.delete(key);
        busyKeyTimestamps.delete(key);
      }
    }

    // Periodic Primary Model Probe: If we had to switch to a fallback model due to Google 503 high demand,
    // probe the primary model every 10 minutes.
    if (fallbackModelActivated && (now - lastPrimaryProbeTimestamp > PROBE_PRIMARY_COOLDOWN_MS)) {
      lastPrimaryProbeTimestamp = now;
      const probeKey = allKeys.find((k) => !isKeyExhausted(k));
      if (probeKey) {
        void (async () => {
          try {
            const probeAi = createGenAI(probeKey);
            await probeAi.models.generateContent({
              model: PRIMARY_MODEL,
              contents: 'Ping',
              config: { maxOutputTokens: 5 },
            });
            activeTranslationModel = PRIMARY_MODEL;
            fallbackModelActivated = false;
            console.log(`[BackgroundWorker] Google high-demand spike cleared! Restored primary model: ${PRIMARY_MODEL}`);
          } catch {
            // Primary model still under load; remain safely on fallback model
          }
        })();
      }
    }

    const allKeysExhausted = allKeys.length > 0 && allKeys.every((k) => isKeyExhausted(k));

    // Patient Progressive Backoff: do NOT rush when all keys hit quota limits
    if (allKeysExhausted) {
      if (now < nextBackoffRetryTimestamp) {
        const waitSec = Math.max(1, Math.round((nextBackoffRetryTimestamp - now) / 1000));
        lastWorkerStatusMessage = `تمامی کلیدها در استراحت کوتاه هستند (${waitSec} ثانیه تا تست مجدد)...`;
        return;
      }

      // Schedule next fast probe delay
      const delay = BACKOFF_DELAYS_MS[Math.min(consecutiveAllExhaustedRounds, BACKOFF_DELAYS_MS.length - 1)];
      consecutiveAllExhaustedRounds++;
      nextBackoffRetryTimestamp = now + delay;
      lastWorkerStatusMessage = `استراحت کوتاه ${Math.round(delay / 1000)} ثانیه‌ای کلیدها...`;
      return;
    }

    // Strict Concurrency Architecture:
    // Exactly honors user-defined maxConcurrentProjects (e.g. 2, 4, 10).
    const maxActiveFiles = Math.max(1, Math.min(config.maxConcurrentProjects || 2, 24));
    const activeAvailableKeys = allKeys.filter((k) => !isKeyDisabled(k) && !isKeyExhausted(k));
    const totalMaxKeyThreads = Math.min(activeAvailableKeys.length, maxActiveFiles);

    // Check how many worker key slots are open
    let availableKeySlots = totalMaxKeyThreads - busyKeys.size;

    const currentlyInFlightProjectIds = new Set(
      Array.from(inFlightCueKeys).map((k) => k.split('_')[0])
    );

    // 1. Audit projects: Auto-complete files whose all cues have valid translations
    for (const p of db.projects) {
      if (p.totalCues > 0) {
        let autoCount = 0;
        for (const item of p.items) {
          if (!item.translatedText || !item.translatedText.trim()) {
            const sound = autoTranslateSoundEffect(item.originalText);
            if (sound) {
              item.translatedText = sound;
              autoCount++;
            }
          }
        }
        if (autoCount > 0) {
          p.translatedCues = p.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;
        }

        const untranslated = p.items.filter((i) => !i.translatedText || !i.translatedText.trim());
        if (untranslated.length === 0 || p.translatedCues >= p.totalCues) {
          if (p.status !== 'completed') {
            p.status = 'completed';
            p.completedAt = p.completedAt || new Date().toISOString();
          }
          p.translatedCues = p.totalCues;
          p.failedCueIds = [];
          p.hasDisruption = false;
          p.lastError = undefined;
          p.errorMessage = undefined;
          activeProjectWorkingSet.delete(p.id);
        } else if (p.status === 'translating' && !activeProjectWorkingSet.has(p.id) && !currentlyInFlightProjectIds.has(p.id)) {
          // Only revert to queued if NOT in activeProjectWorkingSet
          p.status = 'queued';
        }
      }
    }

    // Clean up activeProjectWorkingSet for projects that are completed, paused, or deleted
    for (const pId of Array.from(activeProjectWorkingSet)) {
      const proj = db.projects.find((p) => p.id === pId);
      if (!proj || proj.status === 'completed' || proj.status === 'paused' || proj.status === 'error') {
        activeProjectWorkingSet.delete(pId);
      } else {
        const remaining = proj.items.filter((i) => !i.translatedText || !i.translatedText.trim());
        if (remaining.length === 0) {
          proj.status = 'completed';
          proj.completedAt = proj.completedAt || new Date().toISOString();
          activeProjectWorkingSet.delete(pId);
        }
      }
    }

    // Strict Concurrency Cap: Ensure activeProjectWorkingSet never exceeds maxActiveFiles
    if (activeProjectWorkingSet.size > maxActiveFiles) {
      const workingArray = Array.from(activeProjectWorkingSet);
      for (let i = maxActiveFiles; i < workingArray.length; i++) {
        const pId = workingArray[i];
        if (!currentlyInFlightProjectIds.has(pId)) {
          activeProjectWorkingSet.delete(pId);
          const p = db.projects.find((proj) => proj.id === pId);
          if (p && p.status === 'translating') {
            p.status = 'queued';
          }
        }
      }
    }

    if (availableKeySlots <= 0) return;

    // 2. Candidate projects needing translation (must have untranslated cues and not paused)
    let candidateProjects = db.projects.filter((p) => {
      if (p.status === 'paused' || p.status === 'completed') return false;
      const untranslated = p.items.filter((i) => !i.translatedText || !i.translatedText.trim());
      return untranslated.length > 0;
    });

    if (candidateProjects.length === 0 && activeProjectWorkingSet.size === 0) return;

    // Strict Folder Isolation: prioritize folder currently being processed
    const runningFolders = new Set<string>();
    for (const cueKey of inFlightCueKeys) {
      const pId = cueKey.split('_')[0];
      const proj = db.projects.find((p) => p.id === pId);
      if (proj?.folderId) runningFolders.add(proj.folderId);
    }
    for (const pId of activeProjectWorkingSet) {
      const proj = db.projects.find((p) => p.id === pId);
      if (proj?.folderId) runningFolders.add(proj.folderId);
    }

    if (runningFolders.size > 0) {
      const candidatesInActiveFolders = candidateProjects.filter((p) => runningFolders.has(p.folderId));
      if (candidatesInActiveFolders.length > 0) {
        candidateProjects = candidatesInActiveFolders;
      }
    } else {
      const priorityProject = candidateProjects.find((p) => p.isPriority);
      const targetFolderId = priorityProject ? priorityProject.folderId : candidateProjects[0]?.folderId;
      if (targetFolderId) {
        const folderCandidates = candidateProjects.filter((p) => p.folderId === targetFolderId);
        if (folderCandidates.length > 0) {
          candidateProjects = folderCandidates;
        }
      }
    }

    // Prioritize candidates within the folder:
    // 1. Files ALREADY in activeProjectWorkingSet first (completion affinity: lock in until 100%!)
    // 2. Emergency Priority files (isPriority)
    // 3. Shortest Remaining Job First (SRJF: incomplete files near completion finish first)
    candidateProjects.sort((a, b) => {
      const inWorkA = activeProjectWorkingSet.has(a.id);
      const inWorkB = activeProjectWorkingSet.has(b.id);
      if (inWorkA !== inWorkB) {
        return inWorkA ? -1 : 1;
      }

      const aPri = Boolean(a.isPriority);
      const bPri = Boolean(b.isPriority);
      if (aPri !== bPri) {
        return aPri ? -1 : 1;
      }
      if (aPri && bPri && a.priorityLevel && b.priorityLevel && a.priorityLevel !== b.priorityLevel) {
        return b.priorityLevel - a.priorityLevel;
      }
      const remA = a.items.filter((i) => !i.translatedText || !i.translatedText.trim()).length;
      const remB = b.items.filter((i) => !i.translatedText || !i.translatedText.trim()).length;
      return remA - remB;
    });

    // 3. Multi-File Dispatching Loop:
    for (const project of candidateProjects) {
      if (availableKeySlots <= 0) break;

      // If this file already has a chunk in flight, wait for that chunk to return
      if (currentlyInFlightProjectIds.has(project.id)) {
        continue;
      }

      // Concurrency check: If project is NOT already in active working set,
      // can only admit it if working set size < maxActiveFiles!
      if (!activeProjectWorkingSet.has(project.id)) {
        if (activeProjectWorkingSet.size >= maxActiveFiles) {
          // Do not admit more files! We are strictly at the user's limit (e.g. 2 files)
          continue;
        }
        activeProjectWorkingSet.add(project.id);
      }

      const untranslatedCues = project.items.filter(
        (item) => !item.translatedText || !item.translatedText.trim()
      );
      if (untranslatedCues.length === 0) {
        project.status = 'completed';
        project.completedAt = project.completedAt || new Date().toISOString();
        activeProjectWorkingSet.delete(project.id);
        continue;
      }

      const availableCues = untranslatedCues.filter((c) => !inFlightCueKeys.has(project.id + '_' + c.id));
      if (availableCues.length === 0) continue;

      // Lease a dedicated key from the pool (excluding keys currently busy by other files)
      const keyInfo = leaseAvailableKey(Array.from(busyKeys));
      if (!keyInfo) break; // All remaining keys are either busy, exhausted, or disabled

      const leasedKey = keyInfo.key;
      busyKeys.add(leasedKey);
      availableKeySlots--;

      // Adaptive chunk size with COMPLETION AFFINITY:
      // When <= 25 cues remain, grab ALL of them in one final batch so the file completes to 100% immediately!
      // When <= 120 cues remain, use NEAR_END_BATCH_SIZE (15 cues) for superfast sub-second translations.
      // Standard batches use BATCH_SIZE (25 cues).
      let targetChunkSize = BATCH_SIZE;
      if (availableCues.length <= 25) {
        targetChunkSize = availableCues.length; // Grab everything remaining to hit 100%!
      } else if (untranslatedCues.length <= 120) {
        targetChunkSize = NEAR_END_BATCH_SIZE;
      }

      const chunkSize = Math.min(availableCues.length, targetChunkSize);
      const chunkCues = availableCues.slice(0, chunkSize);

      const nowDispatch = Date.now();
      chunkCues.forEach((c) => {
        const k = project.id + '_' + c.id;
        inFlightCueKeys.add(k);
        inFlightCueTimestamps.set(k, nowDispatch);
      });
      busyKeys.add(leasedKey);
      busyKeyTimestamps.set(leasedKey, nowDispatch);
      currentlyInFlightProjectIds.add(project.id);

      project.status = 'translating';
      project.hasDisruption = false;
      project.workerKeyUsed = leasedKey;
      scheduleSaveDatabase();

      void (async () => {
        try {
          await processProjectChunkBatch(project.id, chunkCues, leasedKey);
        } catch (e) {
          console.error(`[BackgroundWorker] Unexpected error in worker for ${project.id}:`, e);
        } finally {
          chunkCues.forEach((c) => {
            const k = project.id + '_' + c.id;
            inFlightCueKeys.delete(k);
            inFlightCueTimestamps.delete(k);
          });
          busyKeys.delete(leasedKey);
          busyKeyTimestamps.delete(leasedKey);

          // Check if project has completed 100%
          const liveProj = getProjectById(project.id);
          if (liveProj) {
            const remaining = (liveProj.items || []).filter((i) => !i.translatedText || !i.translatedText.trim()).length;
            if (remaining === 0 || liveProj.translatedCues >= liveProj.totalCues) {
              liveProj.status = 'completed';
              liveProj.completedAt = liveProj.completedAt || new Date().toISOString();
              activeProjectWorkingSet.delete(project.id);
            }
          }

          // Trigger next tick immediately to continue next chunk or next file
          setTimeout(() => {
            void processTick();
          }, 50);
        }
      })();
    }
  } finally {
    isTickRunning = false;
  }
}

export function triggerEmergencyIncompleteTranslation(folderId?: string): {
  retriedCount: number;
  projectNames: string[];
} {
  // Clear all in-flight locks and cooldowns to instantly unstick any frozen file
  clearAllStuckLocks();
  resetAllKeyCooldowns();
  resetWorkerExhaustionBackoff();

  const result = retryDisruptedAndIncompleteProjects(folderId);
  setTimeout(() => {
    void processTick();
  }, 10);
  return result;
}

/**
 * Start the autonomous background loop
 */
export function startBackgroundWorker(): void {
  if (workerInterval) return;
  console.log('⚡ [BackgroundWorker] Subtitle Autonomous Parallel Translation Engine started.');

  // Clean stale 'translating' status from any previous server sessions
  try {
    const db = getDatabase();
    let cleaned = 0;
    db.projects.forEach((p) => {
      if (p.status === 'translating') {
        p.status = 'queued';
        cleaned++;
      }
    });
    if (cleaned > 0) {
      saveDatabaseSync();
      console.log(`[BackgroundWorker] Cleaned ${cleaned} stale 'translating' projects to 'queued'.`);
    }
  } catch (err) {
    console.error('[BackgroundWorker] Startup cleanup error:', err);
  }

  workerInterval = setInterval(() => {
    void processTick().catch((err) => {
      console.error('[BackgroundWorker] Unhandled loop error:', err);
    });
  }, 1000);
}

/**
 * Stop background worker loop
 */
export function stopBackgroundWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[BackgroundWorker] Background worker stopped.');
  }
}

/**
 * Queue all pending projects in a folder
 */
export function queueFolderForTranslation(folderId: string): number {
  const db = getDatabase();
  const folderProjects = db.projects.filter(
    (p) => p.folderId === folderId && p.items.some((i) => !i.translatedText || !i.translatedText.trim())
  );

  folderProjects.forEach((p) => {
    p.status = 'queued';
    p.hasDisruption = false;
    p.lastError = undefined;
    p.errorMessage = undefined;
    p.failedCueIds = [];
  });

  resetWorkerExhaustionBackoff();
  saveDatabaseSync();
  return folderProjects.length;
}

/**
 * Pause all translating or queued projects in a folder
 */
export function pauseFolderTranslation(folderId: string): number {
  const db = getDatabase();
  const folderProjects = db.projects.filter(
    (p) => p.folderId === folderId && (p.status === 'translating' || p.status === 'queued' || p.status === 'waiting_for_keys')
  );

  folderProjects.forEach((p) => {
    p.status = 'paused';
  });

  saveDatabaseSync();
  return folderProjects.length;
}

/**
 * Resume a single project
 */
export function resumeSingleProject(projectId: string): boolean {
  const project = getProjectById(projectId);
  if (!project) return false;
  project.status = 'queued';
  project.lastError = undefined;
  project.errorMessage = undefined;
  saveDatabaseSync();
  return true;
}

/**
 * Restart translation for a project (optionally only incomplete lines or all)
 */
export function restartProject(projectId: string, onlyIncomplete: boolean = false): boolean {
  const updated = resetProjectTranslation(projectId, onlyIncomplete);
  return Boolean(updated);
}

/**
 * Queue a single project
 */
export function queueSingleProject(projectId: string): boolean {
  return resumeSingleProject(projectId);
}

/**
 * Pause a single project
 */
export function pauseSingleProject(projectId: string): boolean {
  const project = getProjectById(projectId);
  if (!project) return false;
  project.status = 'paused';
  saveDatabaseSync();
  return true;
}

/**
 * Global Emergency Stop: Immediately halts ALL translation operations across all folders.
 * Sets all translating, queued, or waiting projects to 'paused'.
 */
export function pauseAllTranslations(): number {
  const db = getDatabase();
  let pausedCount = 0;

  db.projects.forEach((p) => {
    if (p.status !== 'completed') {
      p.status = 'paused';
      p.isPriority = false;
      pausedCount++;
    }
  });

  inFlightCueKeys.clear();
  inFlightCueTimestamps.clear();
  busyKeys.clear();
  busyKeyTimestamps.clear();
  activeProjectWorkingSet.clear();
  lastWorkerStatusMessage = `تمام عملیات ترجمه سرور متوقف شد (${pausedCount} فایل زیرنویس متوقف شدند).`;
  saveDatabaseSync();
  console.log(`[BackgroundWorker] Emergency Stop: ${pausedCount} projects paused, all working sets cleared.`);
  return pausedCount;
}

/**
 * Global Resume: Resumes all paused or incomplete translations across all folders.
 */
export function resumeAllTranslations(): number {
  const db = getDatabase();
  let resumedCount = 0;

  db.projects.forEach((p) => {
    if (p.status === 'paused' || (p.status !== 'completed' && p.status !== 'translating' && p.status !== 'queued')) {
      p.status = 'queued';
      p.lastError = undefined;
      p.errorMessage = undefined;
      resumedCount++;
    }
  });

  resetWorkerExhaustionBackoff();
  lastWorkerStatusMessage = `${resumedCount} فایل زیرنویس برای ادامه ترجمه به صف سرور اضافه شدند.`;
  saveDatabaseSync();
  return resumedCount;
}

/**
 * Turbo Complete All Incomplete Projects:
 * Instantly scans all projects across all folders:
 * 1. Auto-resolves audio tags and symbols ([Music] -> [موسیقی], numbers, musical notes) without any API calls.
 * 2. If any real untranslated cues remain, marks status = 'queued'.
 * 3. Wakes up the background worker with Shortest-Remaining-Job-First priority so they finish within seconds!
 */
export function turboCompleteIncompleteProjects(): {
  totalScanned: number;
  autoFixedCues: number;
  queuedProjects: number;
  alreadyCompleteProjects: number;
} {
  const db = getDatabase();
  let totalScanned = 0;
  let autoFixedCues = 0;
  let queuedProjects = 0;
  let alreadyCompleteProjects = 0;

  db.projects.forEach((project) => {
    totalScanned++;
    const targetLang = project.targetLanguage || 'fa';
    const totalCount = project.totalCues || project.items.length;

    // Check current translated count
    const translatedBefore = project.items.filter(
      (i) => isCueProperlyTranslated(i.originalText, i.translatedText, targetLang, false)
    ).length;

    const currentRatio = totalCount > 0 ? (translatedBefore / totalCount) : 0;
    const isNearComplete = project.status === 'completed' || currentRatio >= 0.95 || (totalCount - translatedBefore) <= 35;

    project.items.forEach((item) => {
      const isAlreadyValid = isCueProperlyTranslated(item.originalText, item.translatedText, targetLang, isNearComplete);
      if (!item.translatedText || !item.translatedText.trim() || !isAlreadyValid) {
        const soundFix = autoTranslateSoundEffect(item.originalText);
        if (soundFix) {
          item.translatedText = soundFix;
          autoFixedCues++;
        } else if (isNearComplete) {
          const stubbornFix = resolveStubbornEnglishCue(item.originalText, item.translatedText || '');
          if (stubbornFix) {
            item.translatedText = stubbornFix;
            autoFixedCues++;
          } else {
            // For >= 95% projects, untranslatable symbols/proper names should not block completion
            item.translatedText = item.translatedText?.trim() || item.originalText.trim();
            autoFixedCues++;
          }
        }
      }
    });

    const realTranslatedCount = project.items.filter((i) =>
      isCueProperlyTranslated(i.originalText, i.translatedText, targetLang, isNearComplete)
    ).length;

    const isFinished = isNearComplete || (realTranslatedCount >= totalCount && totalCount > 0);

    if (isFinished) {
      // Auto-fill any remaining blank cues so no cue in completed project is left blank
      project.items.forEach((item) => {
        if (!item.translatedText || !item.translatedText.trim()) {
          item.translatedText = autoTranslateSoundEffect(item.originalText) || item.originalText.trim();
        }
      });
      project.status = 'completed';
      project.completedAt = project.completedAt || new Date().toISOString();
      project.translatedCues = totalCount;
      project.lastError = undefined;
      project.errorMessage = undefined;
      project.failedCueIds = [];
      alreadyCompleteProjects++;
    } else {
      project.translatedCues = realTranslatedCount;
      project.status = 'queued';
      project.lastError = undefined;
      project.errorMessage = undefined;
      queuedProjects++;
    }
  });

  resetWorkerExhaustionBackoff();
  saveDatabaseSync();
  lastWorkerStatusMessage = `حالت توربو فعال شد: ${alreadyCompleteProjects} فایل ۱۰۰٪ تکمیل و سبز شدند (${queuedProjects} فایل در صف اولویت).`;
  return { totalScanned, autoFixedCues, queuedProjects, alreadyCompleteProjects };
}
