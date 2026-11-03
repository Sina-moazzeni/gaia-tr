/**
 * Centralized Model Registry for Google Gemini Models
 * Configured exclusively for Gemini 3.5 Flash Lite as requested.
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
    modelId: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    family: 'Gemini Flash Lite',
    status: 'stable',
    capability: 'translation',
    recommendedUseCase: 'موتور اصلی ترجمه زیرنویس با هوش بالا، روانی بی‌نظیر و حداقل مصرف توکن',
    translationSuitability: 'fast_volume',
    speed: '🚀 ۰.۲۵s',
    speedFa: '🚀 فوق‌سریع و اقتصادی (۰.۲۵ ثانیه)',
    speedEn: '🚀 Ultra-Fast & Efficient (0.25s)',
    speedAr: '🚀 فائق السرعة واقتصادي (0.25 ثانية)',
    quality: '⭐⭐⭐⭐⭐ (عالی‌ترین کیفیت و درک پیوسته دیالوگ‌ها)',
    costTier: 'ultra_low',
    badge: 'مدل اصلی فعال / Primary Engine',
    badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    reasoningLevel: 'standard',
    descriptionFa: 'مدل اصلی و پیش‌فرض؛ دارای درک عمیق از خط داستانی و هماهنگی میلی‌ثانیه‌ای تایم‌بندی.',
    descriptionEn: 'Primary translation engine optimized for high-volume subtitles and minimal quota consumption.',
    descriptionAr: 'النموذج الرئيسي للترجمة السريعة والذكية.',
    isStreaming: false,
    requiresPaidTier: false,
    contextWindow: '1M tokens',
    maxOutputTokens: 65536,
    structuredOutput: true,
    thinkingSupport: true,
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    family: 'Gemini Flash Lite',
    status: 'stable',
    capability: 'translation',
    recommendedUseCase: 'موتور کمکی و رزرو در صورت بروز خطای ۵۰۳ یا شلوغی سرور گوگل',
    translationSuitability: 'fast_volume',
    speed: '⚡ ۰.۳s',
    speedFa: '⚡ پشتیبان اضطراری و سریع (۰.۳ ثانیه)',
    speedEn: '⚡ Fast Fallback (0.3s)',
    speedAr: '⚡ بديل سريع في حالات الضغط',
    quality: '⭐⭐⭐⭐⭐ (پایداری عالی هنگام بار بالای سرورهای اصلی)',
    costTier: 'ultra_low',
    badge: 'پشتیبان کمکی / Auto Fallback',
    badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    reasoningLevel: 'standard',
    descriptionFa: 'مدل رزرو انحصاری؛ در صورت شلوغی سرور گوگل فعال شده و بلافاصله پس از رفع شلوغی به ۳.۵ بازمی‌گردد.',
    descriptionEn: 'Dedicated backup model that takes over during 503 load spikes.',
    descriptionAr: 'النموذج الاحتياطي التلقائي.',
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

export const DEFAULT_TRANSLATION_MODEL_ID = 'gemini-3.5-flash-lite';
export const DEFAULT_TRANSCRIPTION_MODEL_ID = 'gemini-3.5-flash-lite';

export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  'gemini-3.5-flash-lite': ALL_MODELS[0],
  'gemini-3.1-flash-lite': ALL_MODELS[1],
};

export function resolveModelId(inputModel?: string): string {
  if (inputModel === 'gemini-3.1-flash-lite') return 'gemini-3.1-flash-lite';
  return DEFAULT_TRANSLATION_MODEL_ID;
}

export function getTranslationFallbackChain(primaryModelId: string): string[] {
  return ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
}

export function formatModelDisplayLabel(model: ModelDefinition): string {
  return `${model.displayName} — ${model.badge}`;
}
