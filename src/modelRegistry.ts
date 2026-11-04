/**
 * Centralized Model Registry for Google Gemini Models
 * Configured with Gemini 3.1 Flash Lite as the official high-speed, high-throughput primary model.
 */

export type ModelStatus = 'stable' | 'preview' | 'deprecated';
export type ModelCapabilityType = 'translation' | 'transcription' | 'specialized';
export type TranslationSuitabilityTier = 'best_quality' | 'high_quality' | 'fast_volume' | 'advanced_reasoning' | 'realtime_stream';

export interface ModelDefinition {
  modelId: string;
  displayName: string;
  family: string;
  status: ModelStatus;
  capability: ModelCapabilityType;
  recommendedUseCase: string;
  translationSuitability: TranslationSuitabilityTier;
  speed: string;
  speedFa: string;
  speedEn: string;
  speedAr: string;
  quality: string;
  costTier: 'ultra_low' | 'standard' | 'paid_premium';
  badge: string;
  badgeColor: string;
  reasoningLevel: 'standard' | 'high' | 'ultra' | 'realtime';
  descriptionFa: string;
  descriptionEn: string;
  descriptionAr: string;
  isStreaming?: boolean;
  requiresPaidTier?: boolean;
  contextWindow?: string;
  maxOutputTokens?: number;
  structuredOutput: boolean;
  thinkingSupport: boolean;
}

export const ALL_MODELS: ModelDefinition[] = [
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    family: 'Gemini Flash Lite',
    status: 'stable',
    capability: 'translation',
    recommendedUseCase: 'موتور اصلی و فوق‌سریع ترجمه زیرنویس با سرعت آنی، هماهنگی میلی‌ثانیه‌ای و حداقل مصرف سهمیه',
    translationSuitability: 'fast_volume',
    speed: '🚀 ۰.۱۵s',
    speedFa: '🚀 فوق‌سریع و اقتصادی (۰.۱۵ ثانیه)',
    speedEn: '🚀 Ultra-Fast & Efficient (0.15s)',
    speedAr: '🚀 فائق السرعة واقتصادي (0.15 ثانية)',
    quality: '⭐⭐⭐⭐⭐ (عالی‌ترین کیفیت، دقت و پیوستگی دیالوگ‌ها)',
    costTier: 'ultra_low',
    badge: 'مدل اصلی فعال / Primary Engine',
    badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    reasoningLevel: 'standard',
    descriptionFa: 'مدل رسمی و اصلی گوگل برای ترجمه با حجم بالا، پاسخ آنی و بدون خطای ۴۰۴.',
    descriptionEn: 'Primary ultra-fast translation engine optimized for massive subtitle volume and minimal quota usage.',
    descriptionAr: 'النموذج الرئيسي للترجمة السريعة والذكية.',
    isStreaming: false,
    requiresPaidTier: false,
    contextWindow: '1M tokens',
    maxOutputTokens: 65536,
    structuredOutput: true,
    thinkingSupport: true,
  },
  {
    modelId: 'gemini-flash-latest',
    displayName: 'Gemini Flash Latest',
    family: 'Gemini Flash',
    status: 'stable',
    capability: 'translation',
    recommendedUseCase: 'موتور کمکی و رزرو در صورت بروز شلوغی سرور گوگل یا خطای ۵۰۳',
    translationSuitability: 'fast_volume',
    speed: '⚡ ۰.۲۵s',
    speedFa: '⚡ پشتیبان اضطراری و سریع (۰.۲۵ ثانیه)',
    speedEn: '⚡ Fast Fallback (0.25s)',
    speedAr: '⚡ بديل سريع في حالات الضغط',
    quality: '⭐⭐⭐⭐⭐ (پایداری عالی هنگام بار بالای سرورهای اصلی)',
    costTier: 'ultra_low',
    badge: 'پشتیبان کمکی / Auto Fallback',
    badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    reasoningLevel: 'standard',
    descriptionFa: 'مدل رزرو خودکار؛ در صورت ترافیک مقطعی فعال شده و سیستم را بدون وقفه فعال نگه می‌دارد.',
    descriptionEn: 'Dedicated backup model that takes over smoothly during 503 load spikes.',
    descriptionAr: 'النموذج الاحتياطي التلقائي.',
    isStreaming: false,
    requiresPaidTier: false,
    contextWindow: '1M tokens',
    maxOutputTokens: 65536,
    structuredOutput: true,
    thinkingSupport: true,
  },
  {
    modelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    family: 'Gemini Flash',
    status: 'stable',
    capability: 'translation',
    recommendedUseCase: 'موتور هوشمند پیشرفته با قدرت درک عمیق ادبی و سینمایی',
    translationSuitability: 'high_quality',
    speed: '⚡ ۰.۳s',
    speedFa: '⚡ باکیفیت و سریع (۰.۳ ثانیه)',
    speedEn: '⚡ High Quality (0.3s)',
    speedAr: '⚡ عالي الجودة',
    quality: '⭐⭐⭐⭐⭐ (درک سینمایی و فاخر)',
    costTier: 'standard',
    badge: 'مدل سینمایی / Cinematic Engine',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    reasoningLevel: 'standard',
    descriptionFa: 'مدل پیشرفته فلش برای ترجمه‌های فاخر و سینمایی با بالاترین دایره واژگان.',
    descriptionEn: 'Advanced model for high-end cinematic and documentary translation.',
    descriptionAr: 'نموذج متقدم للترجمة السينمائية.',
    isStreaming: false,
    requiresPaidTier: false,
    contextWindow: '1M tokens',
    maxOutputTokens: 65536,
    structuredOutput: true,
    thinkingSupport: true,
  },
];

export const TRANSLATION_MODELS: ModelDefinition[] = ALL_MODELS;
export const TRANSCRIPTION_MODELS: ModelDefinition[] = ALL_MODELS;

export const DEFAULT_TRANSLATION_MODEL_ID = 'gemini-3.1-flash-lite';
export const DEFAULT_TRANSCRIPTION_MODEL_ID = 'gemini-3.1-flash-lite';

export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  'gemini-3.1-flash-lite': ALL_MODELS[0],
  'gemini-flash-latest': ALL_MODELS[1],
  'gemini-3.8-flash': ALL_MODELS[2],
  // Backwards compatibility alias
  'gemini-3.5-flash-lite': ALL_MODELS[0],
};

export function resolveModelId(inputModel?: string): string {
  if (inputModel === 'gemini-flash-latest') return 'gemini-flash-latest';
  if (inputModel === 'gemini-3.8-flash') return 'gemini-3.8-flash';
  return DEFAULT_TRANSLATION_MODEL_ID;
}

export function getTranslationFallbackChain(primaryModelId: string): string[] {
  return ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
}

export function formatModelDisplayLabel(model: ModelDefinition): string {
  return `${model.displayName} — ${model.badge}`;
}
