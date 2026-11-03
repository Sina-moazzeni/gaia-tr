import { AIProvider } from '../types';

export interface ProviderModelOption {
  id: string;
  name: string;
  descFa: string;
  badge?: string;
  badgeColor?: string;
  speed?: string;
}

export interface AIProviderDefinition {
  id: AIProvider;
  name: string;
  nameFa: string;
  nameEn: string;
  descriptionFa: string;
  descriptionEn: string;
  badge: string;
  badgeColor: string;
  iconName: 'Sparkles' | 'Bot' | 'Zap' | 'Brain' | 'Cpu' | 'Globe' | 'Flame' | 'Terminal' | 'Server';
  defaultBaseUrl: string;
  defaultModel: string;
  popularModels: ProviderModelOption[];
  keyPlaceholder: string;
  keyLink: string;
  keyLinkLabelFa: string;
  keyLinkLabelEn: string;
  supportsMultiKey: boolean;
  isOpenAiCompatible: boolean;
}

export const AI_PROVIDERS_CONFIG: Record<AIProvider, AIProviderDefinition> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    nameFa: 'گوگل جمینای (Gemini)',
    nameEn: 'Google Gemini',
    descriptionFa: 'موتور هوش مصنوعی رسمی گوگل؛ با پشتیبانی از مدل‌های فوق سریع Flash و هوشمند Pro و پنجره کانتکست ۱ میلیون توکنی.',
    descriptionEn: 'Official Google AI engine with Flash & Pro models and 1M token context window.',
    badge: 'پیش‌فرض / پرسرعت',
    badgeColor: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    iconName: 'Sparkles',
    defaultBaseUrl: '',
    defaultModel: 'gemini-2.5-flash',
    popularModels: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', descFa: 'پرسرعت‌ترین و دقیق‌ترین برای زیرنویس و بازی', badge: 'پیشنهادی', badgeColor: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20', speed: 'فوق سریع' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', descFa: 'بالاترین قدرت استدلال برای ترجمه‌های بسیار پیچیده', badge: 'دقت بالا', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: 'عمیق' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', descFa: 'پایدار و اقتصادی با سرعت بسیار بالا', badge: 'پایدار', badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', speed: 'سریع' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', descFa: 'نسخه نسل قبل با سهمیه رایگان مناسب', badge: 'رایگان', badgeColor: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20', speed: 'اقتصادی' },
    ],
    keyPlaceholder: 'AIzaSy...',
    keyLink: 'https://aistudio.google.com/app/apikey',
    keyLinkLabelFa: 'دریافت کلید رایگان Gemini از Google AI Studio',
    keyLinkLabelEn: 'Get Free Gemini Key from Google AI Studio',
    supportsMultiKey: true,
    isOpenAiCompatible: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    nameFa: 'اوپن‌ای‌آی (OpenAI / ChatGPT)',
    nameEn: 'OpenAI (ChatGPT)',
    descriptionFa: 'پیشرو در مدل‌های زبانی با مدل‌های محبوب GPT-4o و GPT-4o-mini برای ترجمه دقیق و ادبی.',
    descriptionEn: 'World-leading models including GPT-4o and GPT-4o-mini for natural localization.',
    badge: 'محبوب و استاندارد',
    badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    iconName: 'Bot',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    popularModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', descFa: 'بسیار ارزان، فوق‌العاده سریع با کیفیت عالی', badge: 'پیشنهادی', badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', speed: 'فوق سریع' },
      { id: 'gpt-4o', name: 'GPT-4o', descFa: 'قدرتمندترین مدل چندوجهی اوپن‌ای‌آی', badge: 'پرچمدار', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: 'دقت بالا' },
      { id: 'o3-mini', name: 'o3-mini', descFa: 'مدل استدلالی با دقت تفکر و لحن بی‌نظیر', badge: 'استدلالی', badgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', speed: 'تفکر عمیق' },
      { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest', descFa: 'به‌روزترین نسخه چت‌جی‌پی‌تی رسمی', badge: 'جدید', badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', speed: 'عالی' },
    ],
    keyPlaceholder: 'sk-proj-... یا sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    keyLinkLabelFa: 'دریافت کلید API از پنل OpenAI',
    keyLinkLabelEn: 'Get API Key from OpenAI Platform',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    nameFa: 'دیپ‌سیک (DeepSeek)',
    nameEn: 'DeepSeek',
    descriptionFa: 'مدل‌های قدرتمند متن‌باز با کیفیت برتر و قیمت باورنکردنی ارزان (DeepSeek-V3 و DeepSeek-R1).',
    descriptionEn: 'State-of-the-art open-weights models (V3 & R1) with ultra-affordable pricing.',
    badge: 'بسیار ارزان و هوشمند',
    badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    iconName: 'Brain',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    popularModels: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (Chat)', descFa: 'بهترین انتخاب برای ترجمه سریع، ادبی و بسیار ارزان', badge: 'پیشنهادی', badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', speed: 'فوق سریع' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (Reasoner)', descFa: 'مدل استدلالی عمیق با زنجیره تفکر قوی', badge: 'استدلالی R1', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: 'تفکر عمیق' },
    ],
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.deepseek.com/api_keys',
    keyLinkLabelFa: 'دریافت کلید API از کنسول DeepSeek',
    keyLinkLabelEn: 'Get API Key from DeepSeek Platform',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
  groq: {
    id: 'groq',
    name: 'Groq (LPU)',
    nameFa: 'گراک (Groq Ultra-Fast)',
    nameEn: 'Groq (Ultra-Fast)',
    descriptionFa: 'سریع‌ترین شتاب‌دهنده سخت‌افزاری جهان (LPU)؛ تولید صدها توکن بر ثانیه برای ترجمه فوری با مدل‌های Llama 3.',
    descriptionEn: 'Lightning-fast LPU inference producing hundreds of tokens per second with Llama 3.',
    badge: 'فوق‌العاده سریع',
    badgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    iconName: 'Zap',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    popularModels: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', descFa: 'کیفیت فوق‌العاده بالا و سرعت سرسام‌آور ۷۰ میلیاردی', badge: 'پیشنهادی', badgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', speed: '۳۰۰+ tok/s' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', descFa: 'فوق سریع و سبک با کمترین زمان تأخیر', badge: 'فوق سریع', badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', speed: '۸۰۰+ tok/s' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B 32k', descFa: 'مدل ترکیبی موثر با پنجره کانتکست ۳۲ هزار توکن', badge: 'کانتکست بالا', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: '۴۰۰+ tok/s' },
    ],
    keyPlaceholder: 'gsk_...',
    keyLink: 'https://console.groq.com/keys',
    keyLinkLabelFa: 'دریافت کلید API رایگان از پنل Groq Console',
    keyLinkLabelEn: 'Get API Key from Groq Console',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    nameFa: 'کلود (Anthropic Claude)',
    nameEn: 'Anthropic Claude',
    descriptionFa: 'طبیعی‌ترین و روان‌ترین لحن ادبی در ترجمه زیرنویس و متون غنی داستانی بازی‌ها (Sonnet و Haiku).',
    descriptionEn: 'Superb literary translation nuances and natural flow for movies and video games.',
    badge: 'ترجمه ادبی و طبیعی',
    badgeColor: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    iconName: 'Flame',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    popularModels: [
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', descFa: 'بهترین کیفیت ترجمه ادبی، داستانی و سینمایی جهان', badge: 'بهترین کیفیت', badgeColor: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20', speed: 'ادبی عالی' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', descFa: 'سریع، اقتصادی، با لحن گفتاری فوق‌العاده صمیمی', badge: 'سریع و خوش‌قیمت', badgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', speed: 'فوق سریع' },
      { id: 'anthropic/claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', descFa: 'جدیدترین مدل هیبریدی استدلالی آنتروپیک', badge: 'جدیدترین', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: 'هوش برتر' },
    ],
    keyPlaceholder: 'sk-ant-... یا sk-or-...',
    keyLink: 'https://openrouter.ai/keys',
    keyLinkLabelFa: 'دریافت کلید OpenRouter (پشتیبانی از Claude بدون فیلتر)',
    keyLinkLabelEn: 'Get API Key from OpenRouter (Supports Claude)',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    nameFa: 'اوپن‌روتر (OpenRouter All-in-One)',
    nameEn: 'OpenRouter (All Models)',
    descriptionFa: 'درگاه یکپارچه به صدها مدل هوش مصنوعی (Claude, GPT-4o, DeepSeek, Llama 3, Gemini) با یک کلید واحد.',
    descriptionEn: 'Unified gateway to hundreds of AI models with single API key and competitive pricing.',
    badge: 'درگاه جامع مدل‌ها',
    badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    iconName: 'Globe',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat',
    popularModels: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', descFa: 'قیمت بسیار پایین و کیفیت عالی روی اوپن‌روتر', badge: 'پیشنهادی', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: 'سریع و ارزان' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', descFa: 'مدل هایکو از طریق اوپن‌روتر بدون نیاز به کارت خارجی', badge: 'ادبی و اقتصادی', badgeColor: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20', speed: 'فوق سریع' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', descFa: 'مدل مینی اوپن‌ای‌آی با پایداری حداکثری', badge: 'پایدار', badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', speed: 'بسیار سریع' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', descFa: 'مدل قدرتمند متای آزاد', badge: 'متن‌باز', badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', speed: 'عالی' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyLink: 'https://openrouter.ai/keys',
    keyLinkLabelFa: 'دریافت کلید API از OpenRouter',
    keyLinkLabelEn: 'Get API Key from OpenRouter Platform',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    nameFa: 'میسترال (Mistral AI)',
    nameEn: 'Mistral AI',
    descriptionFa: 'مدل‌های قدرتمند اروپایی Mistral Large و Codestral با پشتیبانی عالی از چندزبانگی.',
    descriptionEn: 'European AI flagship with strong multilingual translation and coding precision.',
    badge: 'چندزبانه و دقیق',
    badgeColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    iconName: 'Cpu',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    popularModels: [
      { id: 'mistral-large-latest', name: 'Mistral Large', descFa: 'مدل پرچمدار با بالاترین هوشمندی و درک زبانی', badge: 'پرچمدار', badgeColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', speed: 'دقت بالا' },
      { id: 'codestral-latest', name: 'Codestral', descFa: 'حفظ دقیق متغیرها، تگ‌ها و ساختار کدهای بازی', badge: 'ویژه بازی', badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', speed: 'دقیق' },
      { id: 'mistral-small-latest', name: 'Mistral Small', descFa: 'اقتصادی، کم‌مصرف و بسیار سریع', badge: 'اقتصادی', badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', speed: 'سریع' },
    ],
    keyPlaceholder: 'mis_...',
    keyLink: 'https://console.mistral.ai/api-keys',
    keyLinkLabelFa: 'دریافت کلید API از Mistral Console',
    keyLinkLabelEn: 'Get API Key from Mistral Console',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama / Local AI',
    nameFa: 'اولاما / هوش مصنوعی محلی (Ollama Offline)',
    nameEn: 'Ollama (Local / Offline)',
    descriptionFa: 'اجرای کاملاً آفلاین و رایگان روی کارت گرافیک یا پردازنده سیستم شما بدون ارسال داده به اینترنت.',
    descriptionEn: 'Fully local, offline and free inference on your own GPU/CPU without cloud dependency.',
    badge: 'کاملاً آفلاین و رایگان',
    badgeColor: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    iconName: 'Terminal',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    popularModels: [
      { id: 'llama3.2', name: 'Llama 3.2 (3B / 1B)', descFa: 'سبک، سریع و مناسب اجرا روی اکثر لپ‌تاپ‌ها', badge: 'سبک و روان', badgeColor: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20', speed: 'سیستم‌های معمولی' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', descFa: 'کیفیت عالی در ترجمه زبان فارسی و زبان‌های آسیایی', badge: 'کیفیت فارسی عالی', badgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', speed: 'کارت گرافیک ۶GB+' },
      { id: 'mistral', name: 'Mistral 7B', descFa: 'مدل کلاسیک، باثبات و قابل اعتماد', badge: 'کلاسیک', badgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', speed: 'کارت گرافیک ۶GB+' },
      { id: 'deepseek-r1:7b', name: 'DeepSeek R1 Distill 7B', descFa: 'مدل استدلالی محلی با قابلیت تفکر عمیق', badge: 'استدلالی لوکال', badgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', speed: 'استدلالی' },
    ],
    keyPlaceholder: 'اختیاری (برای اولاما معمولاً خالی بگذارید)',
    keyLink: 'https://ollama.com',
    keyLinkLabelFa: 'دانلود رایگان Ollama برای ویندوز / مک / لینوکس',
    keyLinkLabelEn: 'Download Ollama for Windows / Mac / Linux',
    supportsMultiKey: false,
    isOpenAiCompatible: true,
  },
  custom: {
    id: 'custom',
    name: 'Custom Provider (BYOK)',
    nameFa: 'سرویس‌دهنده سفارشی دلخواه (Custom)',
    nameEn: 'Custom Provider (BYOK)',
    descriptionFa: 'اتصال به هر سرور پروکسی، vLLM، LM Studio، Text Generation WebUI یا درگاه سازگار با پروتکل OpenAI.',
    descriptionEn: 'Connect to any OpenAI-compatible custom gateway, proxy, vLLM, or LM Studio endpoint.',
    badge: 'سازگار با پروتکل OpenAI',
    badgeColor: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    iconName: 'Server',
    defaultBaseUrl: '',
    defaultModel: '',
    popularModels: [],
    keyPlaceholder: 'sk-... یا کلید احراز هویت سرور شما',
    keyLink: '',
    keyLinkLabelFa: 'تنظیم دستی آدرس اندپوینت و کلید',
    keyLinkLabelEn: 'Configure Endpoint and Key Manually',
    supportsMultiKey: true,
    isOpenAiCompatible: true,
  },
};

export const ALL_PROVIDERS_LIST: AIProviderDefinition[] = Object.values(AI_PROVIDERS_CONFIG);

export function isOpenAiCompatibleProvider(provider: AIProvider): boolean {
  return provider !== 'gemini';
}
