import React, { useState, useMemo } from 'react';
import { UILanguage, TRANSLATIONS } from '../lib/i18n';
import { AI_MODELS } from '../constants';
import { AI_PROVIDERS_CONFIG } from '../lib/providersConfig';
import { 
  AIModelId, 
  AIProvider, 
  CustomProviderConfig, 
  TokenUsageStats,
  BatchHealthStatus,
  FailedTranslationItem
} from '../types';
import { 
  Pause, 
  Play, 
  XCircle, 
  Loader2, 
  Zap, 
  Radio, 
  BrainCircuit, 
  Sparkles, 
  Flame,
  Gauge,
  ShieldAlert,
  Clock,
  Server,
  Coins,
  Layers,
  ShieldCheck,
  ArrowRightLeft,
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RotateCw,
  FileDown,
  BarChart2,
  Download,
  Info
} from 'lucide-react';

interface TranslationProgressProps {
  currentBatch: number;
  totalBatches: number;
  translatedLines: number;
  totalLines: number;
  isPaused: boolean;
  onPauseToggle: () => void;
  onCancel: () => void;
  retryInfo?: { batch: number; attempt: number; maxRetries: number } | null;
  uiLang: UILanguage;
  selectedModel?: string;
  activeProvider?: AIProvider;
  customProviderConfig?: CustomProviderConfig;
  isFallbackActive?: boolean;
  rateLimitPacing?: boolean;
  pacingRemainingSec?: number | null;
  tokenUsage?: TokenUsageStats;
  activeKeyIndex?: number;
  totalKeysCount?: number;
  batchHealth?: BatchHealthStatus[];
  failedItems?: FailedTranslationItem[];
  onDownloadErrorReport?: () => void;
  fileName?: string;
}

export const TranslationProgress: React.FC<TranslationProgressProps> = ({
  currentBatch,
  totalBatches,
  translatedLines,
  totalLines,
  isPaused,
  onPauseToggle,
  onCancel,
  retryInfo,
  uiLang,
  selectedModel = 'gemini-3.6-flash',
  activeProvider = 'gemini',
  customProviderConfig,
  isFallbackActive = false,
  rateLimitPacing = false,
  pacingRemainingSec = null,
  tokenUsage,
  activeKeyIndex = 0,
  totalKeysCount = 1,
  batchHealth,
  failedItems = [],
  onDownloadErrorReport,
  fileName,
}) => {
  const percentage = totalLines > 0 ? Math.min(100, Math.round((translatedLines / totalLines) * 100)) : 0;
  const t = TRANSLATIONS[uiLang];

  const isNonGemini = activeProvider !== 'gemini';
  const providerDef = activeProvider ? AI_PROVIDERS_CONFIG[activeProvider] : undefined;
  const customModelName = customProviderConfig?.model?.trim() || selectedModel || 'Custom Model';

  let modelDisplayName = '';
  let modelBadge = '';
  let modelBadgeColor = '';

  if (isNonGemini && !isFallbackActive) {
    modelDisplayName = `${providerDef ? providerDef.name.split(' ')[0] : 'AI'} (${customModelName})`;
    modelBadge = providerDef?.name || customProviderConfig?.name || (uiLang === 'en' ? 'AI Provider' : 'سرویس‌دهنده هوش مصنوعی');
    modelBadgeColor = providerDef?.badgeColor || 'bg-purple-500/20 text-purple-300 border-purple-500/40';
  } else {
    const foundModel = AI_MODELS.find((m) => m.id === selectedModel) || AI_MODELS[0];
    modelDisplayName = foundModel.name;
    modelBadge = foundModel.badge;
    modelBadgeColor = foundModel.badgeColor;
  }

  const getModelIcon = (id?: string) => {
    if (isNonGemini && !isFallbackActive) {
      return <Server className="w-5 h-5 text-purple-400" />;
    }
    switch (id) {
      case 'gemini-live-stream':
        return <Radio className="w-5 h-5 text-rose-400 animate-pulse" />;
      case 'gemini-3.1-pro-preview':
      case 'gemini-3.1-pro':
      case 'gemini-2.5-pro':
        return <BrainCircuit className="w-5 h-5 text-purple-400" />;
      case 'gemini-3.8-flash':
        return <Sparkles className="w-5 h-5 text-emerald-400" />;
      case 'gemini-3.7-flash':
        return <Zap className="w-5 h-5 text-teal-400" />;
      case 'gemini-3.1-flash-lite':
        return <Gauge className="w-5 h-5 text-amber-400" />;
      case 'gemini-3.5-flash':
        return <Flame className="w-5 h-5 text-cyan-400" />;
      case 'gemini-3.6-flash':
      default:
        return <Zap className="w-5 h-5 text-emerald-400" />;
    }
  };

  const [hoveredBatch, setHoveredBatch] = useState<BatchHealthStatus | null>(null);

  // Compute or format batches health status matrix
  const batches: BatchHealthStatus[] = useMemo(() => {
    if (batchHealth && batchHealth.length > 0) {
      return batchHealth;
    }
    const list: BatchHealthStatus[] = [];
    const total = Math.max(1, totalBatches);
    const approxBatchSize = totalLines > 0 ? Math.ceil(totalLines / total) : 35;

    for (let i = 1; i <= total; i++) {
      const startCue = (i - 1) * approxBatchSize + 1;
      const endCue = Math.min(totalLines, i * approxBatchSize);
      const cueRange = totalLines > 0 ? `${startCue} - ${endCue}` : undefined;

      const batchFails = failedItems.filter((f) => f.batchIndex === i);

      let status: 'success' | 'failed' | 'retrying' | 'running' | 'pending' = 'pending';
      let error: string | undefined = undefined;
      let retryCount: number | undefined = undefined;

      if (batchFails.length > 0) {
        status = 'failed';
        error = batchFails[0].error || 'Batch failed during translation.';
      } else if (i < currentBatch) {
        status = 'success';
      } else if (i === currentBatch) {
        if (retryInfo && retryInfo.attempt > 1) {
          status = 'retrying';
          retryCount = retryInfo.attempt;
        } else {
          status = 'running';
        }
      } else {
        status = 'pending';
      }

      list.push({
        batchIndex: i,
        status,
        cueRange,
        cuesCount: totalLines > 0 ? Math.max(1, endCue - startCue + 1) : approxBatchSize,
        retryCount,
        maxRetries: retryInfo?.maxRetries || 3,
        error,
      });
    }
    return list;
  }, [batchHealth, totalBatches, totalLines, currentBatch, retryInfo, failedItems]);

  const succeededCount = batches.filter((b) => b.status === 'success').length;
  const failedCount = batches.filter((b) => b.status === 'failed').length;
  const retryingCount = batches.filter((b) => b.status === 'retrying' || b.status === 'running').length;
  const pendingCount = batches.filter((b) => b.status === 'pending').length;

  const processedBatches = succeededCount + failedCount;
  const healthScore = processedBatches > 0
    ? Math.round((succeededCount / processedBatches) * 100)
    : 100;

  // Handler for downloading comprehensive JSON Error & Health Diagnostics Report
  const handleDownloadErrorReport = () => {
    if (onDownloadErrorReport) {
      onDownloadErrorReport();
      return;
    }

    const failedBatches = batches.filter((b) => b.status === 'failed');
    const reportPayload = {
      reportTitle: 'SubGame Lab - Translation Health & Error Diagnostic Report',
      generatedAt: new Date().toISOString(),
      fileName: fileName || 'Untitled_Subtitle',
      modelUsed: selectedModel,
      provider: activeProvider,
      overallHealthScore: `${healthScore}%`,
      summary: {
        totalBatches: batches.length,
        succeededBatches: succeededCount,
        failedBatches: failedCount,
        retryingOrActiveBatches: retryingCount,
        pendingBatches: pendingCount,
        totalLinesCount: totalLines,
        translatedLinesCount: translatedLines,
        totalFailedItemsLogged: failedItems.length,
      },
      failedBatchesSummary: failedBatches.map((fb) => ({
        batchIndex: fb.batchIndex,
        cueRange: fb.cueRange,
        cuesCount: fb.cuesCount,
        error: fb.error || 'Batch translation failed',
        retryCount: fb.retryCount || 3,
      })),
      failedItemsDetails: failedItems.length > 0 ? failedItems : (
        failedBatches.length > 0
          ? failedBatches.map((b) => ({
              batchIndex: b.batchIndex,
              cueRange: b.cueRange,
              note: 'Batch failed and original timing/text was kept intact.',
            }))
          : []
      ),
      allBatchesStatus: batches.map((b) => ({
        batch: b.batchIndex,
        status: b.status,
        cues: b.cueRange,
        error: b.error || null,
      })),
    };

    const jsonStr = JSON.stringify(reportPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cleanName = (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'translation').replace(/\s+/g, '_');
    link.download = `translation_error_report_${cleanName}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getStatusLabel = (status: BatchHealthStatus['status']) => {
    switch (status) {
      case 'success':
        return uiLang === 'en' ? 'Succeeded' : uiLang === 'ar' ? 'ناجح' : 'موفق';
      case 'failed':
        return uiLang === 'en' ? 'Failed' : uiLang === 'ar' ? 'فشل' : 'ناموفق (خطا)';
      case 'retrying':
        return uiLang === 'en' ? 'Retrying' : uiLang === 'ar' ? 'إعادة المحاولة' : 'در حال تلاش مجدد';
      case 'running':
        return uiLang === 'en' ? 'Translating' : uiLang === 'ar' ? 'قيد الترجمة' : 'در حال ترجمه';
      case 'pending':
      default:
        return uiLang === 'en' ? 'Pending' : uiLang === 'ar' ? 'قيد الانتظار' : 'در انتظار';
    }
  };

  const getStatusColorClass = (status: BatchHealthStatus['status']) => {
    switch (status) {
      case 'success':
        return 'bg-emerald-500 hover:bg-emerald-400 border-emerald-400/50 text-white shadow-emerald-500/20';
      case 'failed':
        return 'bg-rose-500 hover:bg-rose-400 border-rose-400/70 text-white shadow-rose-500/30 ring-1 ring-rose-400/40';
      case 'retrying':
        return 'bg-amber-400 hover:bg-amber-300 border-amber-300 text-slate-950 shadow-amber-400/30 animate-pulse';
      case 'running':
        return 'bg-cyan-500 hover:bg-cyan-400 border-cyan-300 text-slate-950 shadow-cyan-500/30 animate-pulse';
      case 'pending':
      default:
        return 'bg-slate-800/90 hover:bg-slate-750 border-slate-700/60 text-slate-400';
    }
  };

  const getPausedNotice = () => {
    if (uiLang === 'en') return 'Translation paused. Click "Resume" to continue.';
    if (uiLang === 'ar') return 'تم إيقاف الترجمة مؤقتًا. انقر على "استئناف" للمتابعة.';
    return 'ترجمه به صورت موقت متوقف شده است. روی «ادامه» کلیک کنید.';
  };

  const activeHoverOrCurrent = hoveredBatch || batches.find((b) => b.batchIndex === currentBatch) || batches[0];

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-indigo-500/40 p-5 shadow-2xl shadow-indigo-950/40 backdrop-blur-md flex flex-col gap-4">
      
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
            {isPaused ? <Pause className="w-5 h-5 text-amber-400" /> : getModelIcon(selectedModel)}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                <span>{t.translatingProgress} {modelDisplayName}</span>
              </h3>
              {isFallbackActive && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {uiLang === 'en' ? '(Fallback Active)' : uiLang === 'ar' ? '(محرك احتياطي نشط)' : '(موتور پشتیبان فعال)'}
                </span>
              )}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${modelBadgeColor}`}>
                {modelBadge}
              </span>
              <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                {percentage}%
              </span>
              {rateLimitPacing && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  {t.rateLimitPacingBadge}
                </span>
              )}
              {retryInfo && retryInfo.attempt > 1 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                  {t.retryAttempt} {retryInfo.attempt}/{retryInfo.maxRetries}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {t.batch} <strong className="text-white font-mono">{currentBatch}</strong> {t.of} <strong className="text-white font-mono">{totalBatches}</strong> •{' '}
              <strong className="text-emerald-400 font-mono">{translatedLines}</strong> {t.of} <strong className="text-slate-300 font-mono">{totalLines}</strong> {t.linesCount}
            </p>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={onPauseToggle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t.resume}</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.pause}</span>
              </>
            )}
          </button>

          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>{t.cancel}</span>
          </button>
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full bg-slate-950 rounded-full h-3 border border-slate-800 p-0.5 overflow-hidden">
        <div
          className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-500 h-full rounded-full transition-all duration-300 relative"
          style={{ width: `${percentage}%` }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.3)_50%,transparent_100%)] animate-shimmer" />
        </div>
      </div>

      {/* Visual Translation Health Section */}
      <div className="bg-slate-950/85 border border-slate-800/90 rounded-xl p-4 flex flex-col gap-3.5">
        {/* Header & Quick Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-bold text-slate-200">
                {uiLang === 'en' ? 'Translation Health' : uiLang === 'ar' ? 'صحة الترجمة' : 'سلامت ترجمه'}
              </span>
            </div>

            {/* Health Score Pill */}
            {failedCount === 0 ? (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>{healthScore}% {uiLang === 'en' ? 'Healthy' : 'سلامت'}</span>
              </span>
            ) : (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse">
                <AlertTriangle className="w-3 h-3 text-rose-400" />
                <span>{healthScore}% {uiLang === 'en' ? 'Health Score' : 'سلامت'} ({failedCount} {uiLang === 'en' ? 'failed' : 'خطا'})</span>
              </span>
            )}
          </div>

          {/* Download Error Report Button */}
          <button
            type="button"
            onClick={handleDownloadErrorReport}
            title={uiLang === 'en' ? 'Download Error & Health Diagnostic Report (.json)' : 'دانلود گزارش خطای ترجمه و وضعیت دسته‌ها (.json)'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              failedCount > 0 || failedItems.length > 0
                ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 shadow-md shadow-rose-950/50 hover:scale-[1.02]'
                : 'bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-700/80 hover:text-white'
            }`}
          >
            <FileDown className={`w-3.5 h-3.5 ${failedCount > 0 ? 'text-rose-400' : 'text-slate-400'}`} />
            <span>{uiLang === 'en' ? 'Download Error Report' : uiLang === 'ar' ? 'تحميل تقرير الأخطاء' : 'دانلود گزارش خطاها'}</span>
            {failedCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-bold leading-none">
                {failedCount}
              </span>
            )}
          </button>
        </div>

        {/* Stacked Proportional Health Bar */}
        <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden flex border border-slate-800">
          {succeededCount > 0 && (
            <div 
              style={{ width: `${(succeededCount / batches.length) * 100}%` }} 
              className="bg-emerald-500 transition-all duration-300"
              title={`${succeededCount} Succeeded`}
            />
          )}
          {retryingCount > 0 && (
            <div 
              style={{ width: `${(retryingCount / batches.length) * 100}%` }} 
              className="bg-amber-400 animate-pulse transition-all duration-300"
              title={`${retryingCount} Retrying / In-progress`}
            />
          )}
          {failedCount > 0 && (
            <div 
              style={{ width: `${(failedCount / batches.length) * 100}%` }} 
              className="bg-rose-500 transition-all duration-300"
              title={`${failedCount} Failed`}
            />
          )}
          {pendingCount > 0 && (
            <div 
              style={{ width: `${(pendingCount / batches.length) * 100}%` }} 
              className="bg-slate-800 transition-all duration-300"
              title={`${pendingCount} Pending`}
            />
          )}
        </div>

        {/* Color-Coded Batches Visual Bar Chart */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 font-medium">
              <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>{uiLang === 'en' ? 'Batch Breakdown:' : 'نمودار تفکیکی دسته‌های ترجمه:'}</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {uiLang === 'en' ? 'Hover for details' : 'روی هر ستون نشانه بگیرید'}
            </span>
          </div>

          <div className="max-h-36 overflow-y-auto p-2 bg-slate-900/60 rounded-lg border border-slate-800/80 scrollbar-thin">
            <div className="flex flex-wrap gap-1.5 items-center">
              {batches.map((batch) => {
                const isHovered = hoveredBatch?.batchIndex === batch.batchIndex;
                const isCurrent = currentBatch === batch.batchIndex;
                return (
                  <button
                    key={`batch-health-${batch.batchIndex}`}
                    type="button"
                    onMouseEnter={() => setHoveredBatch(batch)}
                    onMouseLeave={() => setHoveredBatch(null)}
                    onClick={() => setHoveredBatch(batch)}
                    className={`h-7 px-2 min-w-[28px] rounded-md font-mono text-[10px] font-bold border transition-all duration-150 flex items-center justify-center shrink-0 ${getStatusColorClass(
                      batch.status
                    )} ${isHovered ? 'scale-110 z-10 ring-2 ring-indigo-400' : ''} ${
                      isCurrent && batch.status !== 'failed' ? 'ring-2 ring-indigo-500/80 animate-pulse' : ''
                    }`}
                    title={`Batch #${batch.batchIndex} (${batch.cueRange || 'lines'}): ${getStatusLabel(batch.status)}`}
                  >
                    <span>{batch.batchIndex}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active Hovered/Current Batch Inspection Strip */}
        {activeHoverOrCurrent && (
          <div className="text-xs rounded-lg bg-slate-900/90 border border-slate-800 px-3 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-white">
                {uiLang === 'en' ? `Batch #${activeHoverOrCurrent.batchIndex}` : `دسته #${activeHoverOrCurrent.batchIndex}`}
              </span>
              {activeHoverOrCurrent.cueRange && (
                <span className="text-[11px] text-slate-400 font-mono">
                  ({uiLang === 'en' ? `Lines ${activeHoverOrCurrent.cueRange}` : `خطوط ${activeHoverOrCurrent.cueRange}`})
                </span>
              )}
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  activeHoverOrCurrent.status === 'success'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : activeHoverOrCurrent.status === 'failed'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : activeHoverOrCurrent.status === 'retrying' || activeHoverOrCurrent.status === 'running'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {getStatusLabel(activeHoverOrCurrent.status)}
                {activeHoverOrCurrent.status === 'retrying' && activeHoverOrCurrent.retryCount
                  ? ` (${activeHoverOrCurrent.retryCount}/${activeHoverOrCurrent.maxRetries || 3})`
                  : ''}
              </span>
            </div>

            {activeHoverOrCurrent.error ? (
              <span className="text-[11px] text-rose-300 font-mono truncate max-w-xs" title={activeHoverOrCurrent.error}>
                {activeHoverOrCurrent.error}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                {activeHoverOrCurrent.status === 'success'
                  ? uiLang === 'en' ? 'Translated cleanly' : 'بدون خطا ترجمه شد'
                  : activeHoverOrCurrent.status === 'pending'
                  ? uiLang === 'en' ? 'Queued' : 'در صف انجام'
                  : uiLang === 'en' ? 'In progress' : 'در حال پردازش'}
              </span>
            )}
          </div>
        )}

        {/* Color Legend & Summary Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-850 text-xs">
          {/* Succeeded */}
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-slate-400 text-[11px]">{uiLang === 'en' ? 'Succeeded:' : 'موفق:'}</span>
            <span className="font-mono font-bold text-emerald-400">{succeededCount}</span>
          </div>

          {/* Retrying / Running */}
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
            <span className="text-slate-400 text-[11px]">{uiLang === 'en' ? 'Retrying / Running:' : 'در حال تلاش / اجرا:'}</span>
            <span className="font-mono font-bold text-amber-400">{retryingCount}</span>
          </div>

          {/* Failed */}
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <span className="text-slate-400 text-[11px]">{uiLang === 'en' ? 'Failed:' : 'ناموفق:'}</span>
            <span className="font-mono font-bold text-rose-400">{failedCount}</span>
          </div>

          {/* Pending */}
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700 shrink-0" />
            <span className="text-slate-400 text-[11px]">{uiLang === 'en' ? 'Pending:' : 'در انتظار:'}</span>
            <span className="font-mono font-bold text-slate-400">{pendingCount}</span>
          </div>
        </div>

        {/* Failed items notice banner */}
        {failedCount > 0 && (
          <div className="bg-rose-950/30 border border-rose-800/50 rounded-lg p-2.5 flex items-start gap-2.5 text-xs text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">
                {uiLang === 'en'
                  ? `${failedCount} batch(es) encountered errors during translation. Original lines have been safely kept to protect timing alignment.`
                  : `${failedCount} دسته با خطا مواجه شدند. زمان‌بندی و متن اصلی دست‌نخورده باقی ماندند تا پس از بررسی یا تغییر کلید ادامه دهید.`}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadErrorReport}
              className="text-[11px] font-semibold text-rose-300 hover:text-white underline shrink-0 cursor-pointer"
            >
              {uiLang === 'en' ? 'Save JSON Report' : 'دانلود گزارش'}
            </button>
          </div>
        )}
      </div>

      {/* Real-time Token Usage & Remaining Quota Monitor */}
      {tokenUsage && tokenUsage.sessionTotalTokens > 0 && (
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-slate-200">
                {uiLang === 'en' ? 'Token Usage & Remaining Quota' : 'محاسبه توکن‌های مصرفی و سهمیه مانده'}
              </span>
            </div>

            {totalKeysCount && totalKeysCount > 1 ? (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-indigo-950/70 text-indigo-300 border border-indigo-800 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {uiLang === 'en'
                    ? `Key #${(activeKeyIndex ?? 0) + 1} of ${totalKeysCount} (Auto-failover active)`
                    : `کلید #${(activeKeyIndex ?? 0) + 1} از ${totalKeysCount} (چرخش خودکار در صورت اتمام توکن)`}
                </span>
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {/* Batch Tokens */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Current Batch Tokens' : 'توکن این دسته'}
              </span>
              <span className="text-sm font-bold font-mono text-indigo-300 mt-0.5">
                {tokenUsage.totalTokens.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en'
                  ? `In: ${tokenUsage.promptTokens} | Out: ${tokenUsage.candidatesTokens}`
                  : `ورودی: ${tokenUsage.promptTokens} | خروجی: ${tokenUsage.candidatesTokens}`}
              </span>
            </div>

            {/* Session Total Used */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Session Total Used' : 'کل توکن مصرفی'}
              </span>
              <span className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                {tokenUsage.sessionTotalTokens.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en'
                  ? `Prompt: ${tokenUsage.sessionPromptTokens}`
                  : `ورودی کل: ${tokenUsage.sessionPromptTokens}`}
              </span>
            </div>

            {/* Remaining Context */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Remaining Context Window' : 'ظرفیت مانده در کانتکست'}
              </span>
              <span className="text-sm font-bold font-mono text-cyan-300 mt-0.5">
                {tokenUsage.remainingTokensInContext.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en'
                  ? `Limit: ${(tokenUsage.contextLimit / 1000).toFixed(0)}k`
                  : `سقف: ${(tokenUsage.contextLimit / 1000).toFixed(0)} هزار`}
              </span>
            </div>

            {/* Estimated Remaining Quota (TPM) */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Est. Quota Remaining (TPM)' : 'سهمیه مانده در دقیقه (TPM)'}
              </span>
              <span className="text-sm font-bold font-mono text-purple-300 mt-0.5">
                {tokenUsage.estimatedTpmRemaining.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en' ? '1M TPM Tier' : 'سقف ۱ میلیون در دقیقه'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pacing Cooldown Feedback Notification */}
      {pacingRemainingSec !== null && pacingRemainingSec > 0 && !isPaused && (
        <div className="text-center text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 py-1.5 px-3 rounded-lg font-medium flex items-center justify-center gap-2 animate-pulse">
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{t.pacingWaitingDelay.replace('{seconds}', String(pacingRemainingSec))}</span>
        </div>
      )}

      {isPaused && (
        <div className="text-center text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 py-1.5 rounded-lg font-medium">
          {getPausedNotice()}
        </div>
      )}

    </div>
  );
};

