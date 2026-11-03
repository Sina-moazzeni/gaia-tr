import React, { useState, useMemo } from 'react';
import { QueueFileItem, SubtitleItem } from '../types';
import { UILanguage } from '../lib/i18n';
import {
  Sparkles,
  Search,
  Replace,
  X,
  CheckCircle2,
  AlertCircle,
  FileText,
  Layers,
  ArrowRight
} from 'lucide-react';

export interface BatchReplaceOptions {
  scope: 'translated' | 'both';
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export interface BatchReplaceResult {
  totalReplacements: number;
  affectedFilesCount: number;
  fileDetails: Array<{ fileId: string; fileName: string; count: number }>;
}

interface BatchFindReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: QueueFileItem[];
  onApplyReplace: (
    findText: string,
    replaceText: string,
    options: BatchReplaceOptions
  ) => BatchReplaceResult;
  uiLang: UILanguage;
}

export const BatchFindReplaceModal: React.FC<BatchFindReplaceModalProps> = ({
  isOpen,
  onClose,
  queue,
  onApplyReplace,
  uiLang,
}) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [scope, setScope] = useState<'translated' | 'both'>('translated');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [lastResult, setLastResult] = useState<BatchReplaceResult | null>(null);

  // Helper to compile regex safely
  const regexPattern = useMemo(() => {
    if (!findText) return null;
    try {
      if (useRegex) {
        return new RegExp(findText, matchCase ? 'g' : 'gi');
      }
      let escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        escaped = `\\b${escaped}\\b`;
      }
      return new RegExp(escaped, matchCase ? 'g' : 'gi');
    } catch {
      return null;
    }
  }, [findText, useRegex, wholeWord, matchCase]);

  // Compute live match breakdown across all queue files
  const matchBreakdown = useMemo(() => {
    if (!regexPattern || !findText.trim()) {
      return { totalMatches: 0, filesWithMatches: [] };
    }

    let total = 0;
    const list: Array<{ id: string; name: string; count: number; totalItems: number }> = [];

    queue.forEach((file) => {
      let fileCount = 0;
      file.items.forEach((item) => {
        if (scope === 'translated' || scope === 'both') {
          if (item.translatedText) {
            const matches = item.translatedText.match(regexPattern);
            if (matches) fileCount += matches.length;
          }
        }
        if (scope === 'both') {
          if (item.originalText) {
            const matches = item.originalText.match(regexPattern);
            if (matches) fileCount += matches.length;
          }
        }
      });

      if (fileCount > 0) {
        total += fileCount;
        list.push({
          id: file.id,
          name: file.name,
          count: fileCount,
          totalItems: file.items.length,
        });
      }
    });

    return { totalMatches: total, filesWithMatches: list };
  }, [queue, regexPattern, findText, scope]);

  if (!isOpen) return null;

  const handleExecuteReplace = () => {
    if (!findText.trim() || matchBreakdown.totalMatches === 0) return;

    const result = onApplyReplace(findText, replaceText, {
      scope,
      matchCase,
      wholeWord,
      useRegex,
    });

    setLastResult(result);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl flex flex-col gap-5 text-slate-900 dark:text-slate-100 max-h-[92vh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-150"
        dir={uiLang === 'en' ? 'ltr' : 'rtl'}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/20">
              <Replace className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>{uiLang === 'en' ? 'Global Find & Replace in All Files' : 'جستجو و جایگزینی سراسری در تمام فایل‌ها'}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 font-bold">
                  {queue.length} {uiLang === 'en' ? 'Files' : 'فایل'}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {uiLang === 'en'
                  ? 'Replace a specific phrase across all queued translated files at once without opening each file manually.'
                  : 'یک کلمه یا عبارت خاص را به صورت یک‌جا در تمام فایل‌های ترجمه شده صف جایگزین کنید، بدون نیاز به باز کردن جداگانه هر فایل.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inputs */}
        <div className="flex flex-col gap-3.5">
          {/* Find Text */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-indigo-500" />
                <span>{uiLang === 'en' ? 'Find Phrase' : 'عبارت مورد جستجو (متن فعلی):'}</span>
              </span>
              {findText.trim() && (
                <span className={`text-[11px] font-mono font-bold ${matchBreakdown.totalMatches > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {matchBreakdown.totalMatches} {uiLang === 'en' ? 'matches found' : 'مورد یافت شد'}
                </span>
              )}
            </label>
            <input
              type="text"
              value={findText}
              onChange={(e) => {
                setFindText(e.target.value);
                setLastResult(null);
              }}
              placeholder={uiLang === 'en' ? 'e.g., Old Character Name or Mistranslated Term...' : 'مثلاً: نام اشتباه شخصیت، اصطلاح بازی یا واژه ترجمه شده...'}
              className="text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 rounded-2xl px-3.5 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {/* Replace Text */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Replace className="w-3.5 h-3.5 text-emerald-500" />
              <span>{uiLang === 'en' ? 'Replace With' : 'عبارت جایگزین (متن جدید):'}</span>
            </label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => {
                setReplaceText(e.target.value);
                setLastResult(null);
              }}
              placeholder={uiLang === 'en' ? 'e.g., New Correct Name or Term...' : 'مثلاً: نام اصلاح شده یا معادل صحیح...'}
              className="text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 rounded-2xl px-3.5 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          {/* Options & Scope */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200 dark:border-slate-800">
            {/* Scope */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                {uiLang === 'en' ? 'Target Scope:' : 'محدوده جایگزینی:'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScope('translated')}
                  className={`text-xs px-2.5 py-1.5 rounded-xl border font-medium transition-all ${
                    scope === 'translated'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {uiLang === 'en' ? 'Translations Only' : 'فقط متن‌های ترجمه شده'}
                </button>
                <button
                  type="button"
                  onClick={() => setScope('both')}
                  className={`text-xs px-2.5 py-1.5 rounded-xl border font-medium transition-all ${
                    scope === 'both'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {uiLang === 'en' ? 'Both Source & Target' : 'متن اصلی و ترجمه'}
                </button>
              </div>
            </div>

            {/* Match Modifiers */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                {uiLang === 'en' ? 'Match Modifiers:' : 'تنظیمات تطابق:'}
              </span>
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={matchCase}
                    onChange={(e) => setMatchCase(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>{uiLang === 'en' ? 'Match Case' : 'حساس به بزرگی/کوچکی'}</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={wholeWord}
                    disabled={useRegex}
                    onChange={(e) => setWholeWord(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                  />
                  <span>{uiLang === 'en' ? 'Whole Word' : 'کلمه کامل'}</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={useRegex}
                    onChange={(e) => setUseRegex(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>{uiLang === 'en' ? 'Regex' : 'عبارت باقاعده'}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Live File Matches Preview */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
              <span>{uiLang === 'en' ? 'Affected Files Breakdown' : 'وضعیت تطابق در فایل‌های صف:'}</span>
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {matchBreakdown.filesWithMatches.length} / {queue.length} {uiLang === 'en' ? 'files contain matches' : 'فایل دارای این عبارت'}
            </span>
          </div>

          <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-2xl p-2 bg-slate-50/50 dark:bg-slate-950/30 flex flex-col gap-1.5">
            {matchBreakdown.filesWithMatches.length > 0 ? (
              matchBreakdown.filesWithMatches.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono font-bold truncate max-w-[280px] sm:max-w-md text-slate-800 dark:text-slate-200">
                      {f.name}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800 shrink-0">
                    {f.count} {uiLang === 'en' ? 'matches' : 'مورد'}
                  </span>
                </div>
              ))
            ) : (
              <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center gap-1">
                {findText.trim() ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-500/70" />
                    <span>{uiLang === 'en' ? 'No matches found in any queue files.' : 'هیچ موردی با این عبارت در فایل‌های صف یافت نشد.'}</span>
                  </>
                ) : (
                  <span>{uiLang === 'en' ? 'Type a phrase above to see matching files preview.' : 'عبارتی را در کادر بالا وارد کنید تا پیش‌نمایش فایل‌های منطبق نمایش داده شود.'}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Success Message Banner */}
        {lastResult && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              {uiLang === 'en'
                ? `Successfully replaced ${lastResult.totalReplacements} occurrence(s) across ${lastResult.affectedFilesCount} file(s)!`
                : `تعداد ${lastResult.totalReplacements} مورد با موفقیت در ${lastResult.affectedFilesCount} فایل جایگزین شدند!`}
            </span>
          </div>
        )}

        {/* Actions Footer */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {uiLang === 'en' ? 'Close' : 'انصراف و بستن'}
          </button>

          <button
            type="button"
            onClick={handleExecuteReplace}
            disabled={!findText.trim() || matchBreakdown.totalMatches === 0}
            className="px-5 py-2.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:pointer-events-none text-white transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {uiLang === 'en'
                ? `Replace in All Files (${matchBreakdown.totalMatches})`
                : `جایگزینی در تمام فایل‌ها (${matchBreakdown.totalMatches} مورد)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
