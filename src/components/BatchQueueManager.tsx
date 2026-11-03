import React, { useState } from 'react';
import { QueueFileItem, SubtitleFormat, GameFormat, BilingualConfig } from '../types';
import { UILanguage, TRANSLATIONS } from '../lib/i18n';
import { 
  Files, 
  Play, 
  Pause, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Download, 
  Trash2, 
  Plus, 
  Archive, 
  Loader2, 
  Eye, 
  FileText, 
  Zap,
  Sparkles,
  RefreshCw,
  Coins
} from 'lucide-react';
import JSZip from 'jszip';
import { exportSubtitleFile, RTL_LANGUAGES, fixRTLPunctuation } from '../lib/subtitleParser';
import { exportGameCSV, exportGameJSON, exportGameXLSX, exportGameTXT, appendHiddenRTLMarker } from '../lib/gameLocalizationParser';
import { exportBilingualSubtitleFile } from '../lib/bilingualHelper';
import { BatchFindReplaceModal, BatchReplaceOptions, BatchReplaceResult } from './BatchFindReplaceModal';

interface BatchQueueManagerProps {
  queue: QueueFileItem[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onStartBatch: () => void;
  onPauseBatch: () => void;
  isTranslating: boolean;
  isPaused: boolean;
  onAddMoreFilesClick: () => void;
  uiLang: UILanguage;
  targetLanguage: string;
  bilingualConfig?: BilingualConfig;
  appendRTLMarkers?: boolean;
  autoAdvance: boolean;
  setAutoAdvance: (val: boolean) => void;
  onGlobalBatchReplace: (
    findText: string,
    replaceText: string,
    options: BatchReplaceOptions
  ) => BatchReplaceResult;
}

export const BatchQueueManager: React.FC<BatchQueueManagerProps> = ({
  queue,
  activeFileId,
  onSelectFile,
  onRemoveFile,
  onStartBatch,
  onPauseBatch,
  isTranslating,
  isPaused,
  onAddMoreFilesClick,
  uiLang,
  targetLanguage,
  bilingualConfig,
  appendRTLMarkers = true,
  autoAdvance,
  setAutoAdvance,
  onGlobalBatchReplace,
}) => {
  const [isZipping, setIsZipping] = useState(false);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const t = TRANSLATIONS[uiLang];

  if (queue.length === 0) return null;

  const completedCount = queue.filter((f) => f.status === 'completed').length;
  const pendingCount = queue.filter((f) => f.status === 'pending').length;
  const errorCount = queue.filter((f) => f.status === 'error').length;
  const inProgressFile = queue.find((f) => f.status === 'translating');

  // Total tokens used across all completed files in queue
  const totalQueueTokens = queue.reduce((sum, f) => sum + (f.tokenStats?.totalTokens || 0), 0);

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Helper to generate export content for a single queue item
  const generateExportBlob = async (file: QueueFileItem): Promise<{ blob: Blob; fileName: string }> => {
    const isGame = ['csv', 'json', 'xlsx', 'txt'].includes(file.format);
    const isRTL = RTL_LANGUAGES.includes(targetLanguage);
    const targetExt = file.targetFormat || file.format;
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const outFileName = `${baseName}_${targetLanguage}.${targetExt}`;

    let processedItems = file.items.map((it) => {
      let tText = it.translatedText || it.originalText;
      if (isRTL) {
        tText = fixRTLPunctuation(tText);
        if (appendRTLMarkers) {
          tText = appendHiddenRTLMarker(tText);
        }
      }
      return { ...it, translatedText: tText };
    });

    if (isGame) {
      if (targetExt === 'csv') {
        const mapping = file.gameMapping || { sourceColumn: 'Source', targetColumn: 'Translation', hasHeaders: true };
        const content = exportGameCSV(processedItems, mapping, file.encoding || 'UTF-8');
        return { blob: new Blob([content], { type: 'text/csv;charset=utf-8' }), fileName: outFileName };
      } else if (targetExt === 'json') {
        const content = exportGameJSON(processedItems, file.gameOriginalStructure);
        return { blob: new Blob([content], { type: 'application/json;charset=utf-8' }), fileName: outFileName };
      } else if (targetExt === 'xlsx') {
        const mapping = file.gameMapping || { sourceColumn: 'Source', targetColumn: 'Translation', hasHeaders: true };
        const buffer = await exportGameXLSX(processedItems, mapping);
        return { blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName: outFileName };
      } else {
        const content = exportGameTXT(processedItems);
        return { blob: new Blob([content], { type: 'text/plain;charset=utf-8' }), fileName: outFileName };
      }
    } else {
      // Subtitle formats
      let content = '';
      if (bilingualConfig && bilingualConfig.enabled) {
        content = exportBilingualSubtitleFile(processedItems, targetExt as SubtitleFormat, bilingualConfig, file.rawHeader);
      } else {
        content = exportSubtitleFile(processedItems, targetExt as SubtitleFormat, file.rawHeader);
      }
      return { blob: new Blob([content], { type: 'text/plain;charset=utf-8' }), fileName: outFileName };
    }
  };

  const handleDownloadSingle = async (e: React.MouseEvent, file: QueueFileItem) => {
    e.stopPropagation();
    try {
      const { blob, fileName } = await generateExportBlob(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Download failed:', err);
    }
  };

  const handleDownloadAllZip = async () => {
    const readyFiles = queue.filter((f) => f.status === 'completed' || f.items.some((i) => i.translatedText));
    if (readyFiles.length === 0) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (const file of readyFiles) {
        const { blob, fileName } = await generateExportBlob(file);
        zip.file(fileName, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SubGameLab_Batch_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('ZIP generation failed:', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-indigo-500/30 p-4 lg:p-5 shadow-lg shadow-indigo-950/20 flex flex-col gap-4 transition-all animate-fade-in">
      
      {/* Queue Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Files className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>{uiLang === 'en' ? 'Batch Translation Queue' : uiLang === 'ar' ? 'قائمة انتظار الترجمة المجمعة' : 'صف ترجمه چند فایلی (Batch Queue)'}</span>
              </h3>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                {queue.length} {uiLang === 'en' ? 'files' : 'فایل'}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{completedCount} {uiLang === 'en' ? 'Completed' : 'تکمیل‌شده'}</span>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>{pendingCount} {uiLang === 'en' ? 'Pending' : 'در انتظار'}</span>
              </span>
              {totalQueueTokens > 0 && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-mono">
                    <Coins className="w-3.5 h-3.5" />
                    <span>{totalQueueTokens.toLocaleString()} {uiLang === 'en' ? 'tokens used' : 'توکن مصرفی'}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Global Queue Action Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
          {/* Auto-advance toggle */}
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span className="text-[11px] font-semibold">{uiLang === 'en' ? 'Auto-next file' : 'شروع خودکار فایل بعدی'}</span>
          </label>

          {/* Add more files */}
          <button
            type="button"
            onClick={onAddMoreFilesClick}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-500" />
            <span>{uiLang === 'en' ? 'Add Files' : 'افزودن فایل'}</span>
          </button>

          {/* Global Find & Replace in All Files */}
          <button
            type="button"
            onClick={() => setIsFindReplaceOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 transition-colors shadow-2xs"
            title={uiLang === 'en' ? 'Find & Replace phrase across all files in queue' : 'جستجو و جایگزینی یک عبارت در تمام فایل‌های صف بدون نیاز به باز کردن تکی'}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span>{uiLang === 'en' ? 'Replace in All Files' : 'جایگزینی در همه فایل‌ها'}</span>
          </button>

          {/* Download all as ZIP */}
          {completedCount > 0 && (
            <button
              type="button"
              onClick={handleDownloadAllZip}
              disabled={isZipping}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-all shadow-sm"
              title="Download all translated files as a ZIP archive"
            >
              {isZipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
              <span>{uiLang === 'en' ? 'Download All (ZIP)' : 'دانلود همه (ZIP)'}</span>
            </button>
          )}

          {/* Start/Pause Batch Button */}
          {!isTranslating ? (
            <button
              type="button"
              onClick={onStartBatch}
              disabled={pendingCount === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/20"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{uiLang === 'en' ? 'Translate Queue' : 'شروع ترجمه صف'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPauseBatch}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-amber-200 bg-amber-600 hover:bg-amber-500 transition-all shadow-md"
            >
              {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
              <span>{isPaused ? (uiLang === 'en' ? 'Resume' : 'ادامه') : (uiLang === 'en' ? 'Pause' : 'توقف موقت')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Queue File Items Grid */}
      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
        {queue.map((file, idx) => {
          const isActive = file.id === activeFileId;
          const isCurrentTranslating = file.status === 'translating';
          const fileProgress = file.totalCount > 0 ? Math.round((file.translatedCount / file.totalCount) * 100) : 0;

          return (
            <div
              key={file.id}
              onClick={() => onSelectFile(file.id)}
              className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 relative ${
                isActive
                  ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-500/20 shadow-sm'
                  : isCurrentTranslating
                  ? 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700'
                  : file.status === 'completed'
                  ? 'bg-slate-50/70 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-800'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="text-xs font-mono font-bold text-slate-400 w-5 shrink-0 text-center">
                    {idx + 1}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 font-mono truncate max-w-[220px] sm:max-w-md">
                        {file.name}
                      </span>
                      <span className="text-[10px] font-mono font-extrabold uppercase px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {file.format}
                      </span>
                      {isActive && (
                        <span className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold px-1.5 py-0.2 rounded border border-indigo-500/20">
                          {uiLang === 'en' ? 'Active in Editor' : 'فعال در ادیتور'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex-wrap">
                      <span>{formatBytes(file.size)}</span>
                      <span>•</span>
                      <span>{file.items.length} {t.linesCount}</span>
                      {file.tokenStats && file.tokenStats.totalTokens > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                            {file.tokenStats.totalTokens.toLocaleString()} tok
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {(file.status === 'completed' || (file.totalCount > 0 && file.translatedCount >= file.totalCount && file.status !== 'translating')) ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      <span>{uiLang === 'en' ? '100%' : 'تکمیل'}</span>
                    </span>
                  ) : file.status === 'translating' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                      <span>{fileProgress}%</span>
                    </span>
                  ) : file.status === 'pending' ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{uiLang === 'en' ? 'Queued' : 'در نوبت'}</span>
                    </span>
                  ) : file.status === 'error' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 text-rose-500" />
                      <span>{uiLang === 'en' ? 'Error' : 'خطا'}</span>
                    </span>
                  ) : null}

                  {/* Single Download button for completed files */}
                  {(file.status === 'completed' || file.items.some((i) => i.translatedText)) && (
                    <button
                      type="button"
                      onClick={(e) => handleDownloadSingle(e, file)}
                      className="p-1.5 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg transition-colors border border-emerald-200 dark:border-emerald-800"
                      title={uiLang === 'en' ? 'Download translated file' : 'دانلود فایل ترجمه‌شده'}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Remove file button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(file.id);
                    }}
                    disabled={file.status === 'translating'}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors disabled:opacity-30"
                    title={uiLang === 'en' ? 'Remove from queue' : 'حذف از صف'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Progress bar if translating */}
              {file.status === 'translating' && (
                <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${fileProgress}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Batch Find & Replace Modal */}
      <BatchFindReplaceModal
        isOpen={isFindReplaceOpen}
        onClose={() => setIsFindReplaceOpen(false)}
        queue={queue}
        onApplyReplace={onGlobalBatchReplace}
        uiLang={uiLang}
      />
    </div>
  );
};
