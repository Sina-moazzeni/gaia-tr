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
  resetKeyCooldown,
  getExhaustedKeysList,
  saveDatabaseSync, 
  getServerConfig,
  resetProjectTranslation,
  recordKeyUsage,
  ServerSubtitleProject 
} from './database';
import { isCueProperlyTranslated } from '../lib/subtitleParser';
import { SubtitleItem } from '../types';

// Primary & Fallback Models hierarchy:
// EXCLUSIVELY Gemini 3.5 Flash Lite as primary, and Gemini 3.1 Flash Lite if server 503 load occurs.
// No other models are used.
export const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
export const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite'
];

let activeTranslationModel = PRIMARY_MODEL;
let fallbackModelActivated = false;
let lastPrimaryProbeTimestamp = 0;
const PROBE_PRIMARY_COOLDOWN_MS = 15 * 60 * 1000; // Check every 15 minutes

export function getActiveTranslationModel(): string {
  return activeTranslationModel;
}

// Optimized batch size: 50 cues per request gives rich episodic context while maximizing throughput
const BATCH_SIZE = 50;

// Rate limiting & RPM pacing (minimum gap between requests on the same key ensures <15 RPM without hitting 429)
const lastKeyCallTime = new Map<string, number>();
const MIN_CALL_GAP_PER_KEY_MS = 2500; // 2.5 seconds minimum gap per key

// Progressive Patient Backoff: ensures the system never rushes when all keys hit rate limits or exhaustion
let consecutiveAllExhaustedRounds = 0;
let nextBackoffRetryTimestamp = 0;
const MAX_CONSECUTIVE_EXHAUSTED_ROUNDS = 5;
const BACKOFF_DELAYS_MS = [60_000, 120_000, 180_000, 240_000, 300_000]; // 1m, 2m, 3m, 4m, 5m

export function resetWorkerExhaustionBackoff(): void {
  consecutiveAllExhaustedRounds = 0;
  nextBackoffRetryTimestamp = 0;
}

let workerInterval: NodeJS.Timeout | null = null;
// Track in-flight cues across all parallel workers: "${projectId}_${cueId}"
const inFlightCueKeys = new Set<string>();
const busyKeys = new Set<string>();
const cueRetryCountMap = new Map<string, number>();

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
  // Strip formatting tags like <i>, </i>
  const stripped = trimmed.replace(/<[^>]+>|\{[^}]+\}/g, '').trim();

  // If purely music notes like "♪", "♪ ♪", "♫" or numbers/dashes
  if (/^[♪♫\s\d\-.,:;!?]+$/.test(stripped)) {
    return trimmed;
  }
  // Check [Music] or (Music) or [Applause]
  const tagMatch = stripped.match(/^[\[\(]([a-zA-Z\s]+)[\]\)]$/);
  if (tagMatch) {
    const rawTag = tagMatch[1].trim().toLowerCase();
    if (AUDIO_TAGS_MAP[rawTag]) {
      return AUDIO_TAGS_MAP[rawTag];
    }
    return `[${tagMatch[1].trim()}]`;
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
};

const LATIN_TO_PERSIAN_CHAR_MAP: Record<string, string> = {
  a: 'ا', b: 'ب', c: 'ک', d: 'د', e: 'ای', f: 'ف', g: 'گ', h: 'ه',
  i: 'ای', j: 'ج', k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'او', p: 'پ',
  q: 'ق', r: 'ر', s: 'س', t: 'ت', u: 'یو', v: 'و', w: 'و', x: 'اکس',
  y: 'ی', z: 'ز',
};

export function resolveStubbornEnglishCue(original: string, candidate: string): string {
  const clean = (candidate || original || '').trim();
  const lower = clean.toLowerCase().replace(/[^a-z]/g, '');

  if (COMMON_WORD_MAP[lower]) {
    return COMMON_WORD_MAP[lower];
  }

  // If candidate already has some Persian characters, keep candidate
  if (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(candidate)) {
    return candidate.trim();
  }

  const words = clean.split(/\s+/).map((word) => {
    const wLower = word.toLowerCase().replace(/[^a-z]/g, '');
    if (COMMON_WORD_MAP[wLower]) return COMMON_WORD_MAP[wLower];
    // Transliterate
    return word
      .toLowerCase()
      .split('')
      .map((ch) => LATIN_TO_PERSIAN_CHAR_MAP[ch] || ch)
      .join('');
  });

  const result = words.join(' ').trim();
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
  lastMessage: string;
  currentModel: string;
  fallbackActive: boolean;
}

let lastWorkerStatusMessage = 'موتور ترجمه چندمسیره پس‌زمینه آماده است (مدل اصلی: Gemini 3.5 Flash Lite با سوییچ هوشمند خودکار).';

export function getWorkerStatus(): WorkerStatus {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const config = getServerConfig();

  const translatingProjects = db.projects.filter(
    (p) => p.status === 'translating' || Array.from(inFlightCueKeys).some((k) => k.startsWith(p.id + '_'))
  );

  const activeProjectsSummaries: ActiveProjectSummary[] = translatingProjects.map((p) => {
    const pct = p.totalCues > 0 ? Math.round((p.translatedCues / p.totalCues) * 100) : 0;
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

  const exhaustedCount = allKeys.filter((k) => isKeyExhausted(k)).length;
  const activeKeysCount = Math.max(0, allKeys.length - exhaustedCount);

  return {
    isRunning: Boolean(workerInterval),
    activeProjectCount: translatingProjects.length,
    maxConcurrentProjects: config.maxConcurrentProjects || 4,
    maxTotalParallelKeys: config.maxTotalParallelKeys || 8,
    inFlightKeyThreads: busyKeys.size,
    activeProjects: activeProjectsSummaries,
    activeProjectId: firstActive ? firstActive.id : (queuedProject ? queuedProject.id : null),
    activeProjectName: firstActive ? firstActive.name : (queuedProject ? queuedProject.name : null),
    folderId: firstActive ? firstActive.folderId : (queuedProject ? queuedProject.folderId : null),
    progressPercent: firstActive && firstActive.totalCues > 0 ? Math.round((firstActive.translatedCues / firstActive.totalCues) * 100) : 0,
    translatedCues: firstActive ? firstActive.translatedCues : 0,
    totalCues: firstActive ? firstActive.totalCues : (queuedProject ? queuedProject.totalCues : 0),
    currentKeyIndex: getActiveKeyIndex() + 1,
    totalKeys: allKeys.length,
    activeKeys: activeKeysCount,
    exhaustedKeys: exhaustedCount,
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
}> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { success: false, latencyMs: 0, message: 'کلید API خالی است.' };
  }

  const modelsToTry = [activeTranslationModel, PRIMARY_MODEL, ...FALLBACK_MODELS].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  const start = Date.now();
  let lastErr: any = null;

  for (const modelCandidate of modelsToTry) {
    try {
      const ai = createGenAI(cleanKey);
      const res = await ai.models.generateContent({
        model: modelCandidate,
        contents: 'Ping',
        config: {
          maxOutputTokens: 5,
        },
      });

      const latencyMs = Date.now() - start;
      if (res.text !== undefined) {
        const isFallback = modelCandidate !== PRIMARY_MODEL;
        const msg = isFallback
          ? `اتصال موفق و کلید معتبر است (مدل اصلی ۳.۵ خطای ۵۰۳ موقت داشت، اتصال پایدار با مدل کمکی Gemini 3.1 Flash Lite در ${latencyMs}ms برقرار شد).`
          : `اتصال موفق و کلید معتبر است (پاسخ در ${latencyMs}ms با مدل اصلی Gemini 3.5 Flash Lite).`;

        return {
          success: true,
          latencyMs,
          message: msg,
          modelUsed: modelCandidate,
        };
      }
    } catch (err: any) {
      lastErr = err;
      const errMsg = String(err?.message || err);
      // If error is 503 High Demand, cascade to next fallback model immediately
      if (errMsg.includes('503') || errMsg.toLowerCase().includes('high demand') || errMsg.toLowerCase().includes('unavailable')) {
        console.warn(`[KeyTest] Model ${modelCandidate} returned 503 High Demand. Cascading to next model...`);
        continue;
      }
      // If auth error or 429 quota error, do not retry other models on this key
      break;
    }
  }

  const latencyMs = Date.now() - start;
  const msg = String(lastErr?.message || lastErr);
  let userMsg = `خطا در تست کلید: ${msg}`;
  if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource_exhausted')) {
    userMsg = 'سهمیه این کلید موقتاً به اتمام رسیده است (429 Quota Exhausted). سرور از کلید بعدی استفاده خواهد کرد.';
  } else if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('invalid api key')) {
    userMsg = 'کلید API نامعتبر است (Authentication / API Key Invalid). لطفاً از صحت کلید اطمینان حاصل فرمایید.';
  } else if (msg.includes('503') || msg.toLowerCase().includes('high demand')) {
    userMsg = 'سرورهای جمینای گوگل در حال حاضر با بار ترافیکی مقطعی روبرو هستند (503 High Demand). سیستم خودکار به مدل کمکی سوییچ خواهد کرد.';
  }

  return {
    success: false,
    latencyMs,
    message: userMsg,
    error: msg,
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

    // RPM Pacing: ensure minimum 4.2 seconds elapsed since last call on this specific key
    const lastCall = lastKeyCallTime.get(currentKey) || 0;
    const elapsedSinceLastCall = Date.now() - lastCall;
    if (elapsedSinceLastCall < MIN_CALL_GAP_PER_KEY_MS) {
      const waitMs = MIN_CALL_GAP_PER_KEY_MS - elapsedSinceLastCall;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    lastKeyCallTime.set(currentKey, Date.now());

    // Cascade models: try active model first, then fallback models if 503 High Demand occurs
    const modelsToAttempt = [activeTranslationModel, PRIMARY_MODEL, ...FALLBACK_MODELS].filter(
      (m, i, arr) => arr.indexOf(m) === i
    );

    let keyFailedWithRateOrAuth = false;

    for (const modelToUse of modelsToAttempt) {
      try {
        const ai = createGenAI(currentKey);
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userContent,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
          },
        });

        const rawText = response.text || '';
        let parsedJson: any = null;

        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsedJson = JSON.parse(jsonMatch[0]);
          }
        }

        if (parsedJson && Array.isArray(parsedJson.translations) && parsedJson.translations.length > 0) {
          // If we had to switch to a fallback model, register it as current
          if (modelToUse !== activeTranslationModel) {
            console.log(`[BackgroundWorker] Google 503 overcome: successfully translated batch using ${modelToUse}`);
            activeTranslationModel = modelToUse;
            fallbackModelActivated = modelToUse !== PRIMARY_MODEL;
          }

          const usage = response.usageMetadata;
          const returnedMap = new Map<number, string>();
          parsedJson.translations.forEach((t: any) => {
            if (t && typeof t.id === 'number' && t.text && String(t.text).trim()) {
              returnedMap.set(t.id, String(t.text).trim());
            }
          });

          // Verify if any cue was dropped by the model
          const missing = items.filter((it) => !returnedMap.has(it.id));
          if (missing.length > 0 && missing.length <= 5) {
            // Attempt a quick micro-call for the missed 1-5 cues so nothing is ever dropped
            try {
              const microPrompt = buildSubtitlePrompt(missing, targetLanguage, tone, customPrompt, context);
              const microRes = await ai.models.generateContent({
                model: modelToUse,
                contents: microPrompt.userContent,
                config: {
                  systemInstruction: microPrompt.systemInstruction,
                  responseMimeType: 'application/json',
                },
              });
              const microRaw = microRes.text || '';
              const microParsed = JSON.parse(microRaw);
              if (microParsed && Array.isArray(microParsed.translations)) {
                microParsed.translations.forEach((mt: any) => {
                  if (mt && typeof mt.id === 'number' && mt.text) {
                    returnedMap.set(mt.id, String(mt.text).trim());
                  }
                });
              }
            } catch {}
          }

          const finalTranslations = items.map((it) => {
            const rawTranslated = returnedMap.get(it.id);
            const isValid = rawTranslated && isCueProperlyTranslated(it.text, rawTranslated, targetLanguage);
            return {
              id: it.id,
              text: isValid ? rawTranslated.trim() : '',
            };
          });

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
          throw new Error('پاسخ مدل نامعتبر بود یا ترجمه خالی بازگشت.');
        }
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || err);

        const is503HighDemand =
          msg.includes('503') ||
          msg.toLowerCase().includes('high demand') ||
          msg.toLowerCase().includes('unavailable') ||
          msg.toLowerCase().includes('not found') ||
          msg.includes('404');

        if (is503HighDemand) {
          console.warn(`[BackgroundWorker] Model ${modelToUse} returned 503/Unavailable. Cascading to fallback model on same key...`);
          // Try next model candidate on this same key
          continue;
        }

        const isRateLimit =
          msg.includes('429') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('resource_exhausted') ||
          msg.toLowerCase().includes('tokens');

        const isAuthError =
          msg.includes('401') ||
          msg.includes('403') ||
          msg.toLowerCase().includes('invalid api key') ||
          msg.toLowerCase().includes('permission_denied');

        if (isRateLimit || isAuthError) {
          markKeyAsExhausted(currentKey, isRateLimit ? 'اتمام توکن/سهمیه (429)' : 'کلید نامعتبر');
          console.warn(`[BackgroundWorker] Key exhausted (${isRateLimit ? '429 RateLimit' : 'Auth'}). Switching to next available key...`);
          keyFailedWithRateOrAuth = true;
          break; // Break model loop to move to next key in keysQueue
        } else {
          console.warn(`[BackgroundWorker] Non-rate-limit error on model ${modelToUse}: ${msg.slice(0, 120)}`);
          await new Promise((r) => setTimeout(r, 1200));
          break;
        }
      }
    }

    if (keyFailedWithRateOrAuth) {
      continue;
    }
  }

  throw lastErr || new Error('خطا در ترجمه بسته پس از بررسی تمام کلیدهای فعال و مدل‌های کمکی.');
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

    for (const cue of chunkCues) {
      const liveItem = project.items.find((i) => i.id === cue.id);
      if (!liveItem) continue;

      const cueKey = `${project.id}_${cue.id}`;
      const candidate = resultMap.get(cue.id);

      // 1. Auto-resolve sound effects or musical symbols ([Music] -> [موسیقی], ♪, numbers)
      const soundFix = autoTranslateSoundEffect(cue.originalText);
      if (soundFix) {
        liveItem.translatedText = soundFix;
        cueRetryCountMap.delete(cueKey);
        continue;
      }

      // 2. Validate translation
      if (candidate && isCueProperlyTranslated(cue.originalText, candidate, project.targetLanguage)) {
        liveItem.translatedText = candidate;
        cueRetryCountMap.delete(cueKey);
      } else {
        // Validation failed (e.g. model returned English text or skipped)
        const retries = (cueRetryCountMap.get(cueKey) || 0) + 1;
        cueRetryCountMap.set(cueKey, retries);

        if (retries >= 2) {
          // Force repair via smart dictionary or transliteration to prevent infinite loops
          const repaired = resolveStubbornEnglishCue(cue.originalText, candidate || '');
          if (repaired) {
            liveItem.translatedText = repaired;
            cueRetryCountMap.delete(cueKey);
          }
        }
      }
    }

    // Successful batch translates -> reset progressive backoff
    consecutiveAllExhaustedRounds = 0;
    nextBackoffRetryTimestamp = 0;

    // Update counts & token stats using strict Persian translation verification
    project.translatedCues = project.items.filter((i) =>
      isCueProperlyTranslated(i.originalText, i.translatedText, project.targetLanguage)
    ).length;

    project.tokenUsage.promptTokens += result.tokens.prompt;
    project.tokenUsage.candidatesTokens += result.tokens.candidates;
    project.tokenUsage.totalTokens += result.tokens.total;
    project.lastError = undefined;
    project.errorMessage = undefined;

    const db = getDatabase();
    db.stats.totalTokensUsed += result.tokens.total;
    db.stats.totalTranslations++;
    recordKeyUsage(result.keyUsed || leasedKey, result.tokens);

    // Verify if any cues are still untranslated or in English
    const remainingUntranslated = project.items.filter(
      (i) => !isCueProperlyTranslated(i.originalText, i.translatedText, project.targetLanguage)
    );

    const hasOtherInFlight = Array.from(inFlightCueKeys).some(
      (k) => k.startsWith(project.id + '_') && !chunkCues.some((b) => k === project.id + '_' + b.id)
    );

    if (remainingUntranslated.length === 0 && !hasOtherInFlight) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
      project.translatedCues = project.totalCues;
      project.failedCueIds = [];
      lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت ۱۰۰٪ و بدون سطر انگلیسی تکمیل شد.`;
      console.log(`[BackgroundWorker] Project ${project.name} (${project.id}) fully completed and verified!`);
    } else {
      const pct = project.totalCues > 0 ? Math.round((project.translatedCues / project.totalCues) * 100) : 0;
      lastWorkerStatusMessage = `فایل "${project.name}": ترجمه معتبر ${project.translatedCues} از ${project.totalCues} سطر (${pct}%)`;
    }

    // Save progress to persistent JSON disk storage immediately!
    saveDatabaseSync();
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[BackgroundWorker] Batch error for ${project.name}:`, errMsg);

    const isAllExhausted = allKeys.every((k) => isKeyExhausted(k));
    if (isAllExhausted) {
      project.status = 'waiting_for_keys';
      project.lastError = 'سهمیه کلیدهای سرور تمام شد. ترجمه بدون از دست رفتن سطرها متوقف و منتظر بازیابی سهمیه است.';
      project.errorMessage = project.lastError;
    } else {
      project.lastError = `خطا در ترجمه دسته سطرهای اخیر: ${errMsg}`;
      project.errorMessage = project.lastError;
      project.failedCueIds = chunkCues.map((c) => c.id);
    }

    saveDatabaseSync();
    lastWorkerStatusMessage = `خطا در ترجمه "${project.name}": ${errMsg.slice(0, 80)}`;
  }
}

let lastKeyProbeTime = 0;
const KEY_PROBE_INTERVAL_MS = 25_000;

/**
 * Background probe for exhausted keys:
 * Tests exhausted keys in the background with a minimal request.
 * If Google accepts the key, we unfreeze it immediately without waiting for cooldown!
 */
async function probeExhaustedKeysInBackground(): Promise<void> {
  const now = Date.now();
  if (now - lastKeyProbeTime < KEY_PROBE_INTERVAL_MS) return;
  lastKeyProbeTime = now;

  const exhaustedKeys = getExhaustedKeysList();
  if (exhaustedKeys.length === 0) return;

  const testKey = exhaustedKeys[0];
  try {
    const probeAi = createGenAI(testKey);
    await probeAi.models.generateContent({
      model: activeTranslationModel,
      contents: 'سلام',
      config: { maxOutputTokens: 2 },
    });
    // Succeeded! Reset cooldown for this key immediately
    resetKeyCooldown(testKey);
    resetWorkerExhaustionBackoff();
    console.log(`[BackgroundWorker] Key ${testKey.slice(0, 6)}... passed background health probe and is restored!`);
  } catch {
    // Key still in quota lock
  }
}

/**
 * Main Worker Tick: Dispatches parallel project jobs up to maxConcurrentProjects
 * with Patient Progressive Backoff when all keys hit exhaustion limits.
 */
async function processTick(): Promise<void> {
  const db = getDatabase();
  const config = getServerConfig();
  const allKeys = getServerKeys();

  // If no keys configured, do not dispatch
  if (allKeys.length === 0) return;

  // Run lightweight background probe for exhausted keys
  void probeExhaustedKeysInBackground();

  const now = Date.now();

  // Periodic Primary Model Probe: If we had to switch to a fallback model due to Google 503 high demand,
  // probe the primary model every 15 minutes. If Google's load cleared, return to primary seamlessly.
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
      lastWorkerStatusMessage = `تمامی کلیدها در وقفه سهمیه هستند. شکیبایی صبورانه سرور بدون عجله (${waitSec} ثانیه تا تست مجدد - دور ${consecutiveAllExhaustedRounds} از ${MAX_CONSECUTIVE_EXHAUSTED_ROUNDS}). سطرهای قبلی در دیسک امن هستند.`;
      return;
    }

    if (consecutiveAllExhaustedRounds >= MAX_CONSECUTIVE_EXHAUSTED_ROUNDS) {
      // 5 consecutive rounds over 15+ minutes yielded all keys exhausted!
      let changed = false;
      db.projects.forEach((p) => {
        if (p.status === 'translating' || p.status === 'queued') {
          p.status = 'waiting_for_keys';
          p.lastError = 'سهمیه روزانه تمامی کلیدها به اتمام رسیده است (پس از ۵ نوبت بررسی صبورانه سرور). ترجمه با حفظ ۱۰۰٪ سطرهای ترجمه‌شده متوقف شد تا کلید یا سهمیه جدید اضافه گردد.';
          p.errorMessage = p.lastError;
          changed = true;
        }
      });
      if (changed) saveDatabaseSync();
      lastWorkerStatusMessage = 'سهمیه روزانه تمامی کلیدها به اتمام رسیده است. ترجمه متوقف شد تا کلید جدید یا سهمیه شارژ شود (تمام سطرها ذخیره شده‌اند).';
      return;
    }

    // Schedule next progressive backoff delay
    const delay = BACKOFF_DELAYS_MS[Math.min(consecutiveAllExhaustedRounds, BACKOFF_DELAYS_MS.length - 1)];
    consecutiveAllExhaustedRounds++;
    nextBackoffRetryTimestamp = now + delay;
    const delayMinutes = Math.round(delay / 60000);
    lastWorkerStatusMessage = `تمامی کلیدها به سقف سهمیه رسیده‌اند. سیستم بدون عجله به مدت ${delayMinutes} دقیقه استراحت می‌کند و سپس وضعیت کلیدها را مجدداً خواهد سنجید (دور ${consecutiveAllExhaustedRounds} از ${MAX_CONSECUTIVE_EXHAUSTED_ROUNDS})...`;
    return;
  }

  const maxActiveFiles = Math.max(1, Math.min(config.maxConcurrentProjects || 4, 16));
  const maxTotalKeys = Math.max(1, Math.min(config.maxTotalParallelKeys || 8, 32));
  const maxKeyThreads = Math.min(maxTotalKeys, Math.max(1, allKeys.length));

  // Check how many worker key slots are open
  let availableKeySlots = maxKeyThreads - busyKeys.size;
  if (availableKeySlots <= 0) return;

  // Find candidate projects needing work:
  // 1. Projects already marked 'translating'
  // 2. Projects in 'queued' status
  // 3. Projects in 'has_incomplete'
  // 4. Projects in 'waiting_for_keys' (if non-exhausted keys are now available)
  const candidateProjects = db.projects.filter((p) => {
    if (p.status === 'translating') return true;
    if (p.status === 'queued') return true;
    if (p.status === 'has_incomplete') return true;
    if (p.status === 'waiting_for_keys') {
      return allKeys.some((k) => !isKeyExhausted(k));
    }
    return false;
  });

  if (candidateProjects.length === 0) return;

  // ⚡ TURBO PRIORITY: Shortest-Remaining-Job-First (SRJF)
  // Files with few remaining untranslated cues (e.g. 95%+, 98% done with only 1-15 cues left)
  // are pushed to the TOP of the dispatch queue! They finish in 1 fast call (1-2 seconds)
  // and turn 100% green immediately instead of waiting 10 minutes behind large files!
  candidateProjects.sort((a, b) => {
    const untranslatedA = a.totalCues - a.translatedCues;
    const untranslatedB = b.totalCues - b.translatedCues;
    return untranslatedA - untranslatedB;
  });

  // Track which files currently have in-flight cues
  const activeInFlightProjectIds = new Set<string>();
  inFlightCueKeys.forEach((k) => {
    const pId = k.substring(0, k.indexOf('_'));
    if (pId) activeInFlightProjectIds.add(pId);
  });

  // Select the working set of files (strictly constrained to maxActiveFiles):
  // 1. First keep files that already have work in flight so they don't stall
  // 2. Next fill up to maxActiveFiles from the sorted candidates (incomplete files prioritized by SRJF)
  const activeWorkingProjects: ServerSubtitleProject[] = [];
  const selectedProjectIds = new Set<string>();

  for (const pId of activeInFlightProjectIds) {
    const proj = db.projects.find((p) => p.id === pId);
    if (proj && proj.status !== 'completed' && proj.status !== 'paused') {
      activeWorkingProjects.push(proj);
      selectedProjectIds.add(proj.id);
    }
  }

  for (const proj of candidateProjects) {
    if (activeWorkingProjects.length >= maxActiveFiles) break;
    if (!selectedProjectIds.has(proj.id)) {
      activeWorkingProjects.push(proj);
      selectedProjectIds.add(proj.id);
    }
  }

  if (activeWorkingProjects.length === 0) return;

  // Distribute parallel key threads among active files:
  // e.g. 4 files with 8 keys = 2 parallel keys per file (100 cues per cycle!)
  // e.g. 4 files with 12 keys = 3 parallel keys per file (150 cues per cycle!)
  const targetKeysPerFile = Math.max(1, Math.ceil(maxKeyThreads / activeWorkingProjects.length));

  // Dispatch parallel chunks across the active files
  for (const project of activeWorkingProjects) {
    if (availableKeySlots <= 0) break;

    const untranslatedCues = project.items.filter(
      (item) => !isCueProperlyTranslated(item.originalText, item.translatedText, project.targetLanguage)
    );

    if (untranslatedCues.length === 0) {
      const hasInFlight = Array.from(inFlightCueKeys).some((k) => k.startsWith(project.id + '_'));
      if (!hasInFlight && project.status !== 'completed') {
        project.status = 'completed';
        project.completedAt = new Date().toISOString();
        project.translatedCues = project.totalCues;
        project.failedCueIds = [];
        saveDatabaseSync();
      }
      continue;
    }

    const availableCues = untranslatedCues.filter((c) => !inFlightCueKeys.has(project.id + '_' + c.id));
    if (availableCues.length === 0) {
      // Remaining cues are currently being processed by parallel workers
      continue;
    }

    // Check how many chunks this project already has in flight
    const currentProjectInFlightCount = Array.from(inFlightCueKeys).filter((k) => k.startsWith(project.id + '_')).length;
    const currentInFlightBatches = Math.ceil(currentProjectInFlightCount / BATCH_SIZE);

    // Allow this project to take up to targetKeysPerFile batches (or more if remaining keys are idle)
    const allowedNewBatches = Math.max(1, targetKeysPerFile - currentInFlightBatches);
    const maxBatchesForThisPass = Math.min(
      Math.ceil(availableCues.length / BATCH_SIZE),
      availableKeySlots,
      allowedNewBatches
    );

    let chunksDispatched = 0;
    while (availableCues.length > 0 && availableKeySlots > 0 && chunksDispatched < maxBatchesForThisPass) {
      const keyInfo = leaseAvailableKey(Array.from(busyKeys));
      if (!keyInfo) break; // No more available idle keys

      const leasedKey = keyInfo.key;
      busyKeys.add(leasedKey);
      availableKeySlots--;
      chunksDispatched++;

      const chunkCues = availableCues.splice(0, BATCH_SIZE);
      chunkCues.forEach((c) => inFlightCueKeys.add(project.id + '_' + c.id));

      project.status = 'translating';
      project.workerKeyUsed = leasedKey;
      saveDatabaseSync();

      void (async () => {
        try {
          await processProjectChunkBatch(project.id, chunkCues, leasedKey);
        } catch (e) {
          console.error(`[BackgroundWorker] Unexpected error in worker for ${project.id}:`, e);
        } finally {
          chunkCues.forEach((c) => inFlightCueKeys.delete(project.id + '_' + c.id));
          busyKeys.delete(leasedKey);
        }
      })();
    }
  }
}

/**
 * Start the autonomous background loop
 */
export function startBackgroundWorker(): void {
  if (workerInterval) return;
  console.log('⚡ [BackgroundWorker] Subtitle Autonomous Parallel Translation Engine started.');
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
    (p) => p.folderId === folderId && p.status !== 'completed' && p.status !== 'translating'
  );

  folderProjects.forEach((p) => {
    p.status = 'queued';
    p.lastError = undefined;
    p.errorMessage = undefined;
  });

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
    if (p.status === 'translating' || p.status === 'queued' || p.status === 'waiting_for_keys') {
      p.status = 'paused';
      pausedCount++;
    }
  });

  inFlightCueKeys.clear();
  busyKeys.clear();
  lastWorkerStatusMessage = `تمام عملیات ترجمه سرور توسط کاربر متوقف شد (${pausedCount} فایل زیرنویس متوقف شدند).`;
  saveDatabaseSync();
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

    // 1. Auto-resolve sound effects, numbers, and symbols in-place
    project.items.forEach((item) => {
      if (!item.translatedText || !item.translatedText.trim() || !isCueProperlyTranslated(item.originalText, item.translatedText, targetLang)) {
        const soundFix = autoTranslateSoundEffect(item.originalText);
        if (soundFix) {
          item.translatedText = soundFix;
          autoFixedCues++;
        }
      }
    });

    const realTranslatedCount = project.items.filter((i) =>
      isCueProperlyTranslated(i.originalText, i.translatedText, targetLang)
    ).length;

    project.translatedCues = realTranslatedCount;

    if (realTranslatedCount >= project.totalCues && project.totalCues > 0) {
      project.status = 'completed';
      project.completedAt = project.completedAt || new Date().toISOString();
      project.lastError = undefined;
      project.errorMessage = undefined;
      project.failedCueIds = [];
      alreadyCompleteProjects++;
    } else {
      // Put into translation queue to be prioritized by SRJF
      project.status = 'queued';
      project.lastError = undefined;
      project.errorMessage = undefined;
      queuedProjects++;
    }
  });

  resetWorkerExhaustionBackoff();
  saveDatabaseSync();
  lastWorkerStatusMessage = `حالت توربو فعال شد: ${queuedProjects} فایل ناقص جهت تکمیل ۱۰۰٪ فوری در اولویت قرار گرفتند.`;
  return { totalScanned, autoFixedCues, queuedProjects, alreadyCompleteProjects };
}
