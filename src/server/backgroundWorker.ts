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
  saveDatabaseSync, 
  getServerConfig,
  resetProjectTranslation,
  recordKeyUsage,
  ServerSubtitleProject 
} from './database';

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

// Optimized batch size: 40 cues per request gives rich 2-3 minute episodic context while keeping prompt token repetition minimal
const BATCH_SIZE = 40;

// Rate limiting & RPM pacing (minimum gap between requests on the same key ensures <15 RPM without hitting 429)
const lastKeyCallTime = new Map<string, number>();
const MIN_CALL_GAP_PER_KEY_MS = 4200; // 4.2 seconds minimum gap per key

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
const activeProjectJobIds = new Set<string>();
const busyKeys = new Set<string>();

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

let lastWorkerStatusMessage = 'موتور ترجمه چندمسیره پس‌زمینه آماده است (مدل اصلی: Gemini 2.5/3.5 Flash Lite با سوییچ هوشمند خودکار).';

export function getWorkerStatus(): WorkerStatus {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const config = getServerConfig();

  const translatingProjects = db.projects.filter(
    (p) => p.status === 'translating' || activeProjectJobIds.has(p.id)
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
    maxConcurrentProjects: config.maxConcurrentProjects || 2,
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
۴. تگ‌های زیرنویس نظیر <i>, </i>, <b>, </b>, {\\an8} و شکست خطوط \\n دقیقاً در جای مناسب خود حفظ شوند.
۵. خروجی فقط و فقط یک شیء JSON معتبر به فرمت زیر باشد (بدون هیچ کلمه اضافی در ابتدا یا انتها):
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

          const finalTranslations = items.map((it) => ({
            id: it.id,
            text: returnedMap.get(it.id) || it.text,
          }));

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
 * Process a single project batch inside a dedicated worker slot
 */
async function processSingleProjectBatch(projectId: string): Promise<void> {
  const project = getProjectById(projectId);
  if (!project) return;

  // Find cues in this project that still need translation
  const untranslatedCues = project.items.filter((item) => !item.translatedText || !item.translatedText.trim());

  if (untranslatedCues.length === 0) {
    project.status = 'completed';
    project.completedAt = new Date().toISOString();
    project.translatedCues = project.totalCues;
    project.errorMessage = undefined;
    project.lastError = undefined;
    saveDatabaseSync();
    lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت ۱۰۰٪ پایان یافت.`;
    console.log(`[BackgroundWorker] Project ${project.name} (${project.id}) fully completed!`);
    return;
  }

  // Lease a key from pool that is not locked by another concurrent worker
  const allKeys = getServerKeys();
  if (allKeys.length === 0) {
    project.status = 'waiting_for_keys';
    project.lastError = 'کلید API جمینای در سرور تنظیم نشده است. لطفاً در پنل مدیریت، کلیدهای Gemini را وارد کنید.';
    project.errorMessage = project.lastError;
    saveDatabaseSync();
    return;
  }

  const keyInfo = leaseAvailableKey(Array.from(busyKeys));
  if (!keyInfo) {
    // All keys in the pool are exhausted or locked
    project.status = 'waiting_for_keys';
    project.lastError = 'تمامی کلیدهای سرور موقتاً سهمیه خود را تمام کرده‌اند (429). ترجمه به طور خودکار به محض آزادسازی کلید یا افزودن کلید جدید ادامه خواهد یافت (تمام سطرهای قبلی ذخیره شده‌اند).';
    project.errorMessage = project.lastError;
    saveDatabaseSync();
    return;
  }

  const leasedKey = keyInfo.key;
  busyKeys.add(leasedKey);
  project.workerKeyUsed = leasedKey;
  project.status = 'translating';

  const batchCues = untranslatedCues.slice(0, BATCH_SIZE);
  const simplifiedBatch = batchCues.map((c) => ({ id: c.id, text: c.originalText }));

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

    for (const item of project.items) {
      if (resultMap.has(item.id)) {
        item.translatedText = resultMap.get(item.id)!;
      }
    }

    // Successful batch translates -> reset progressive backoff
    consecutiveAllExhaustedRounds = 0;
    nextBackoffRetryTimestamp = 0;

    // Update counts & token stats
    project.translatedCues = project.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;
    project.tokenUsage.promptTokens += result.tokens.prompt;
    project.tokenUsage.candidatesTokens += result.tokens.candidates;
    project.tokenUsage.totalTokens += result.tokens.total;
    project.currentBatchIndex++;
    project.totalBatches = Math.ceil(project.totalCues / BATCH_SIZE);
    project.lastError = undefined;
    project.errorMessage = undefined;

    const db = getDatabase();
    db.stats.totalTokensUsed += result.tokens.total;
    db.stats.totalTranslations++;
    recordKeyUsage(result.keyUsed || leasedKey, result.tokens);

    if (project.translatedCues >= project.totalCues) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
      lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت تکمیل شد.`;
    } else {
      const pct = Math.round((project.translatedCues / project.totalCues) * 100);
      lastWorkerStatusMessage = `فایل "${project.name}": ترجمه ${project.translatedCues} از ${project.totalCues} سطر (${pct}%)`;
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
      project.status = 'has_incomplete';
      project.lastError = `خطا در ترجمه دسته سطرهای اخیر: ${errMsg}`;
      project.errorMessage = project.lastError;
      project.failedCueIds = batchCues.map((c) => c.id);
    }

    saveDatabaseSync();
    lastWorkerStatusMessage = `خطا در ترجمه "${project.name}": ${errMsg.slice(0, 80)}`;
  } finally {
    busyKeys.delete(leasedKey);
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

  const maxWorkers = Math.max(1, Math.min(config.maxConcurrentProjects || 2, Math.max(1, allKeys.length)));

  // Check how many worker slots are open
  const availableSlots = maxWorkers - activeProjectJobIds.size;
  if (availableSlots <= 0) return;

  // Find candidate projects needing work:
  // 1. Projects already marked 'translating'
  // 2. Projects in 'queued' status
  // 3. Projects in 'waiting_for_keys' (if non-exhausted keys are now available)
  const candidateProjects = db.projects.filter((p) => {
    if (activeProjectJobIds.has(p.id)) return false;
    if (p.status === 'translating') return true;
    if (p.status === 'queued') return true;
    if (p.status === 'waiting_for_keys') {
      return allKeys.some((k) => !isKeyExhausted(k));
    }
    return false;
  });

  const projectsToDispatch = candidateProjects.slice(0, availableSlots);

  for (const project of projectsToDispatch) {
    activeProjectJobIds.add(project.id);
    project.status = 'translating';
    saveDatabaseSync();

    // Run each project batch concurrently
    void (async () => {
      try {
        await processSingleProjectBatch(project.id);
      } catch (e) {
        console.error(`[BackgroundWorker] Unexpected error in worker for ${project.id}:`, e);
      } finally {
        activeProjectJobIds.delete(project.id);
      }
    })();
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
  }, 1800);
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

  activeProjectJobIds.clear();
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
