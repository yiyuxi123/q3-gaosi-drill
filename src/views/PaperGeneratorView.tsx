import React, { useRef, useState } from 'react';
import { 
  FileText, 
  Printer, 
  RefreshCw, 
  Sparkles, 
  Check, 
  Download,
  ClipboardEdit,
  Award,
  ArrowRight,
  Share2,
  Copy,
  X,
  BookOpen
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Question, UserRecord, MathModule } from '../types';
import {
  generateExamPaper,
  getActiveErrorBookQuestionIds,
  type GeneratedPaper,
  type PaperFilterOptions
} from '../services/paperGenerator';
import { MathRenderer } from '../components/MathRenderer';
import { calculatePracticeAttemptRecord } from '../services/ebbinghaus';
import {
  PAPER_EXPORT_ROOT_ID,
  requirePaperExportRoot,
  sanitizeDownloadFilename
} from '../services/pdfExport';
import { copyTextToClipboard } from '../services/clipboard';
import { createSubmissionLock } from '../services/practiceSession';
import { deliverFiles, isMobileLike } from '../services/fileDelivery';
import { renderPaperPages, renderPaperShareImage, stitchPaperPages } from '../services/paperPageRenderer';

interface PaperGeneratorViewProps {
  allQuestions: Question[];
  userRecords: Record<string, UserRecord>;
  onBatchSaveRecords: (records: UserRecord[]) => boolean;
  onNavigateToErrorBook?: () => void;
}

export const PaperGeneratorView: React.FC<PaperGeneratorViewProps> = ({
  allQuestions,
  userRecords,
  onBatchSaveRecords,
  onNavigateToErrorBook
}) => {
  const [paperTitle, setPaperTitle] = useState('2026年第三季度高斯奥数全真模拟卷');
  const [selectedGrades, setSelectedGrades] = useState<string[]>(['三年级', '四年级', '五年级', '六年级']);
  const [selectedModules, setSelectedModules] = useState<MathModule[]>(['计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学']);
  const [selectedSections, setSelectedSections] = useState<string[]>(['兴趣篇', '拓展篇', '超越篇']);
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [totalScore, setTotalScore] = useState<number>(100);
  const [durationMinutes, setDurationMinutes] = useState<number>(90);
  const [onlyErrorBook, setOnlyErrorBook] = useState<boolean>(false);

  const [generatedPaper, setGeneratedPaper] = useState<GeneratedPaper | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Paper Score Entry State
  const [isScoreModalOpen, setIsScoreModalOpen] = useState(false);
  const [questionScores, setQuestionScores] = useState<Record<string, number>>({});
  const [scoreSuccess, setScoreSuccess] = useState(false);
  const [scoreSummary, setScoreSummary] = useState<{ total: number; max: number; wrongCount: number } | null>(null);
  const scoreSaveLockRef = useRef(createSubmissionLock());

  // Export / Share Modal
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const [previewImageUrls, setPreviewImageUrls] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const exportLockRef = useRef(createSubmissionLock());

  const gradesList = ['三年级', '四年级', '五年级', '六年级'];
  const modulesList: MathModule[] = ['计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学'];
  const sectionsList = ['兴趣篇', '拓展篇', '超越篇'];

  const errorBookQuestionIds = getActiveErrorBookQuestionIds(allQuestions, userRecords);
  const paperDownloadName = sanitizeDownloadFilename(generatedPaper?.title || '模拟试卷');

  const handleGenerate = () => {
    setErrorMsg('');
    setIsGenerating(true);
    setGeneratedPaper(null);
    setQuestionScores({});
    setScoreSummary(null);
    setScoreSuccess(false);
    scoreSaveLockRef.current.reset();
    setIsScoreModalOpen(false);
    setIsExportModalOpen(false);
    setExportStatus(null);
    setPreviewImageUrls([]);

    try {
      const options: PaperFilterOptions = {
        title: paperTitle,
        grades: selectedGrades,
        modules: selectedModules,
        sections: selectedSections,
        questionCount: questionCount,
        totalScore: totalScore,
        durationMinutes: durationMinutes,
        onlyErrorBook: onlyErrorBook,
        errorBookQuestionIds: errorBookQuestionIds
      };

      const paper = generateExamPaper(allQuestions, options);
      setGeneratedPaper(paper);
      
      const initialScores: Record<string, number> = {};
      paper.questions.forEach(q => {
        initialScores[q.id] = q.score;
      });
      setQuestionScores(initialScores);
    } catch (err: any) {
      setErrorMsg(err.message || '组卷失败，请调整筛选条件');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenScoreModal = () => {
    if (!generatedPaper) return;
    setIsScoreModalOpen(true);
  };

  const handleSetQuestionScore = (qid: string, score: number) => {
    if (scoreSaveLockRef.current.isLocked()) return;
    setQuestionScores(prev => ({
      ...prev,
      [qid]: score
    }));
  };

  const handleBatchSubmitScores = () => {
    if (!generatedPaper || !scoreSaveLockRef.current.tryLock()) return;

    let currentTotal = 0;
    let wrongCount = 0;
    const recordsToSave: UserRecord[] = [];

    generatedPaper.questions.forEach(q => {
      const scoreGot = questionScores[q.id] !== undefined ? questionScores[q.id] : q.score;
      currentTotal += scoreGot;

      const isCorrect = scoreGot >= q.score;
      if (!isCorrect) wrongCount++;

      const updatedRecord = calculatePracticeAttemptRecord(
        userRecords[q.id],
        { question_id: q.id, chapter_id: q.chapter_id },
        isCorrect, 
        `【纸卷模考】得分: ${scoreGot}/${q.score}分`
      );

      recordsToSave.push(updatedRecord);
    });

    if (!onBatchSaveRecords(recordsToSave)) {
      scoreSaveLockRef.current.release();
      return;
    }

    setScoreSummary({
      total: currentTotal,
      max: generatedPaper.totalScore,
      wrongCount
    });

    setScoreSuccess(true);
    confetti({
      particleCount: 70,
      spread: 60,
      origin: { y: 0.6 }
    });
  };

  const handlePrint = () => {
    if (exportLockRef.current.isLocked()) return;
    if (isMobileLike()) {
      void handleExportPdf();
      return;
    }
    setIsExportModalOpen(false);
    window.setTimeout(() => window.print(), 80);
  };

  const buildPaperText = () => {
    if (!generatedPaper) return '';
    let text = `${generatedPaper.title}\n满分: ${generatedPaper.totalScore}分 | 考试时间: ${generatedPaper.durationMinutes}分钟\n\n`;
    generatedPaper.questions.forEach((q, idx) => {
      text += `第${idx + 1}题 (${q.score}分) 【${q.grade}·${q.module}·${q.section}】\n${q.content}\n\n`;
    });
    text += `\n========== 参考答案与解析 ==========\n`;
    generatedPaper.questions.forEach((q, idx) => {
      text += `第${idx + 1}题答案: ${q.answer}\n解析: ${q.explanation || '略'}\n\n`;
    });

    return text;
  };

  const copyPaperText = async () => {
    const text = buildPaperText();
    if (!text) throw new Error('试卷内容为空');
    await copyTextToClipboard(text);
  };

  const handleCopyPaperText = async () => {
    if (!generatedPaper || !exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setExportStatus({ type: 'info', text: '正在复制整卷文字与答案…' });
    try {
      await copyPaperText();
      setExportStatus({ type: 'success', text: '整卷文字及答案已复制到剪贴板。' });
    } catch (error) {
      console.error(error);
      setExportStatus({ type: 'error', text: '复制失败，请允许剪贴板权限后重试。' });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  const handleExportImage = async () => {
    if (!generatedPaper || !exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setExportStatus({ type: 'info', text: '正在生成高清长图…' });
    try {
      const el = requirePaperExportRoot();
      const pages = await renderPaperPages(el, (completed, total) => {
        setExportStatus({ type: 'info', text: `正在排版第 ${completed}/${total} 个内容块…` });
      });
      setExportStatus({ type: 'info', text: `正在将 ${pages.length} 页拼接为一张高清长图…` });
      const longImage = await stitchPaperPages(pages);
      setPreviewImageUrls([longImage.dataUrl]);
      const mode = await deliverFiles([{
        blob: longImage.blob,
        filename: `${paperDownloadName}_高清长图.jpg`
      }], {
        title: generatedPaper.title,
        text: `完整试卷高清长图，内部按 ${pages.length} 个 A4 页面排版`,
        preferShare: isMobileLike()
      });
      setIsExportModalOpen(false);
      setExportStatus({
        type: 'success',
        text: mode === 'shared' ? '已打开系统分享，可保存到相册或发送给微信。' : '一张完整高清长图已下载。'
      });
    } catch (e: any) {
      console.error(e);
      setExportStatus({ type: 'error', text: `导出图片失败：${e?.message || '请重试'}` });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!generatedPaper || !exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setExportStatus({ type: 'info', text: '正在生成 A4 PDF…' });
    try {
      const el = requirePaperExportRoot();
      const { jsPDF } = await import('jspdf');
      const pages = await renderPaperPages(el, (completed, total) => {
        setExportStatus({ type: 'info', text: `正在排版第 ${completed}/${total} 个内容块…` });
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      pages.forEach((page, index) => {
        if (index > 0) pdf.addPage();
        pdf.addImage(page.dataUrl, 'JPEG', 0, 0, 210, 297);
      });
      const mode = await deliverFiles([{
        blob: pdf.output('blob'),
        filename: `${paperDownloadName}.pdf`
      }], {
        title: generatedPaper.title,
        text: `标准 A4 试卷，共 ${pages.length} 页`,
        preferShare: isMobileLike()
      });
      setExportStatus({
        type: 'success',
        text: mode === 'shared' ? 'PDF 已生成，请选择系统打印、保存或微信发送。' : `PDF 已生成并下载，共 ${pages.length} 页。`
      });
    } catch (e: any) {
      console.error(e);
      setExportStatus({ type: 'error', text: `导出 PDF 失败：${e?.message || '请重试'}` });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  const handleNativeSharePaper = async () => {
    if (!generatedPaper || !exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setExportStatus({ type: 'info', text: '正在快速生成整卷分享图…' });

    try {
      const shareImage = await renderPaperShareImage(requirePaperExportRoot(), message => {
        setExportStatus({ type: 'info', text: message });
      });
      setExportStatus({ type: 'info', text: '分享图已生成，正在打开微信 / QQ…' });
      const mode = await deliverFiles([{
        blob: shareImage.blob,
        filename: `${paperDownloadName}_分享长图.jpg`
      }], {
        title: generatedPaper.title,
        text: `满分 ${generatedPaper.totalScore} 分，完整试卷长图`,
        preferShare: true
      });
      setExportStatus({
        type: 'success',
        text: mode === 'shared' ? '已打开系统分享。' : '浏览器不支持文件分享，试卷图片已下载。'
      });
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      if (cancelled) {
        setExportStatus({ type: 'info', text: '已取消分享。' });
        return;
      }

      console.error(error);
      setExportStatus({ type: 'error', text: '文件分享失败，请重试或改用 PDF 导出。' });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  const handleCloseExportModal = () => {
    if (exportLockRef.current.isLocked()) return;
    setIsExportModalOpen(false);
  };

  const toggleGrade = (g: string) => {
    setSelectedGrades(prev => 
      prev.includes(g) ? prev.filter(item => item !== g) : [...prev, g]
    );
  };

  const toggleModule = (m: MathModule) => {
    setSelectedModules(prev => 
      prev.includes(m) ? prev.filter(item => item !== m) : [...prev, m]
    );
  };

  const toggleSection = (s: string) => {
    setSelectedSections(prev => 
      prev.includes(s) ? prev.filter(item => item !== s) : [...prev, s]
    );
  };

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto animate-in fade-in">
      {/* Top Config Card (Hidden during printing) */}
      <div className="no-print bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900 flex items-center space-x-2 m-0">
              <FileText className="w-5 h-5 text-blue-600" />
              <span>A4 智能组卷与线下录分系统</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              高斯奥数真题自由抽样 · 标准 A4 排版 · 纸卷作答录分与艾宾浩斯错题库联动
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {generatedPaper && (
              <>
                <button
                  type="button"
                  onClick={handleOpenScoreModal}
                  className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <ClipboardEdit className="w-4 h-4" />
                  <span>📝 纸卷录分 (匹配错题本)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setExportStatus(null);
                    setIsExportModalOpen(true);
                  }}
                  className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>🖨️ 打印 / 跨端分享</span>
                </button>
              </>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
            {errorMsg}
          </div>
        )}

        {/* Configurations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">试卷标题</label>
            <input
              type="text"
              value={paperTitle}
              onChange={(e) => setPaperTitle(e.target.value)}
              className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">题目数量</label>
            <select
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white"
            >
              <option value={5}>5 题 (快速小测)</option>
              <option value={10}>10 题 (标准阶段测)</option>
              <option value={15}>15 题 (全真模考卷)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">试卷满分</label>
            <select
              value={totalScore}
              onChange={(e) => setTotalScore(Number(e.target.value))}
              className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white"
            >
              <option value={100}>100 分 (标准百分制)</option>
              <option value={120}>120 分 (竞赛满分制)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">建议考试时长</label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white"
            >
              <option value={45}>45 分钟</option>
              <option value={60}>60 分钟</option>
              <option value={90}>90 分钟</option>
            </select>
          </div>
        </div>

        {/* Filter Badges */}
        <div className="space-y-2.5 pt-1">
          {/* Grade filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 w-14">年级:</span>
            {gradesList.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(g)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                  selectedGrades.includes(g)
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Module filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 w-14">模块:</span>
            {modulesList.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => toggleModule(m)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                  selectedModules.includes(m)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Section difficulty filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 w-14">篇章:</span>
            {sectionsList.map(section => (
              <button
                key={section}
                type="button"
                onClick={() => toggleSection(section)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                  selectedSections.includes(section)
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {section}
              </button>
            ))}
          </div>

          {/* Error book toggle */}
          <div className="pt-1">
            <label className="flex items-center space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyErrorBook}
                onChange={(e) => setOnlyErrorBook(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-bold text-slate-700">
                🎯 仅从个人错题本中抽取题目 (针对性靶向补弱，当前错题: {errorBookQuestionIds.length} 道)
              </span>
            </label>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-2xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>立即智能生成考卷</span>
          </button>
        </div>
      </div>

      {/* Generated Standard A4 Exam Paper Display */}
      {generatedPaper ? (
        <div
          id={PAPER_EXPORT_ROOT_ID}
          className="paper-print-root bg-white rounded-3xl p-6 sm:p-12 border border-slate-200 shadow-sm print:border-none print:shadow-none print:p-0 space-y-6"
        >
          {/* Printable Exam Header */}
          <div data-paper-export-block data-paper-keep-together="true" className="text-center space-y-2 pb-4 border-b-2 border-slate-900">
            <div className="flex items-center justify-center space-x-2">
              <img src="/logo.png" alt="卓越教育" className="h-8 w-auto object-contain" />
              <span className="text-xs font-bold tracking-widest text-slate-600 uppercase">
                卓越教育 · 2026 Q3 高斯奥数模拟统考
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight m-0">
              {generatedPaper.title}
            </h2>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-slate-600">
              <span>满分: {generatedPaper.totalScore}分</span>
              <span>•</span>
              <span>考试时长: {generatedPaper.durationMinutes}分钟</span>
              <span>•</span>
              <span>题量: {generatedPaper.questions.length}题</span>
            </div>

            {/* Candidate Header Bar */}
            <div className="flex items-center justify-around max-w-lg mx-auto pt-2 border-t border-slate-200 text-xs font-serif text-slate-700">
              <div>校区：____________</div>
              <div>姓名：____________</div>
              <div>成绩：____________</div>
            </div>
          </div>

          {/* Standard Math Problems List */}
          <div className="space-y-6">
            {generatedPaper.questions.map((q, idx) => (
              <div
                key={q.id}
                data-paper-export-block
                data-paper-keep-together="true"
                className="paper-question-block space-y-2 break-inside-avoid border-b border-slate-100 pb-4"
              >
                <div className="flex items-start space-x-2">
                  <span className="px-2 py-0.5 bg-slate-900 text-white rounded text-xs font-bold shrink-0">
                    {idx + 1}
                  </span>
                  <div className="text-xs font-bold text-slate-800">
                    <span>(本题 {q.score} 分)</span>
                    <span className="ml-2 text-slate-500 font-normal">
                      【{q.grade}·第{q.chapter_num}讲·{q.section}·{q.module}】
                    </span>
                  </div>
                </div>

                {/* Prefer the audited source crop so figures and formulas stay exact. */}
                {q.q_slice_url ? (
                  <div className="pl-6 pt-1 w-full">
                    <img 
                      src={q.q_slice_url} 
                      alt={`第 ${idx + 1} 题原题`}
                      className="max-w-full w-auto max-h-none rounded-lg border border-slate-200 object-contain shadow-xs"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-slate-800 leading-relaxed pl-6 font-medium">
                    <MathRenderer content={q.content} />
                  </div>
                )}

                {/* Neat compact calculation blank line */}
                <div className="pl-6 pt-2 text-[11px] text-slate-400 font-mono flex items-center justify-between border-t border-dashed border-slate-200 mt-2">
                  <span>演算过程及答题区：</span>
                  <span>得分：______</span>
                </div>
              </div>
            ))}
          </div>

          {/* Standard Answer Key Card */}
          <div className="paper-answer-section break-before-page pt-8 border-t-2 border-slate-900 space-y-4">
            <div
              data-paper-export-block
              data-paper-page-break-before="true"
              data-paper-keep-together="true"
              className="text-center space-y-0.5"
            >
              <h3 className="text-sm font-black text-slate-900 m-0">
                {generatedPaper.title} · 参考答案与名师解析
              </h3>
              <p className="text-[11px] text-slate-400">仅供教师与家长阅卷使用</p>
            </div>

            <div className="space-y-3">
              {generatedPaper.questions.map((q, idx) => (
                <div
                  key={q.id}
                  data-paper-export-block
                  data-paper-keep-together="false"
                  className="paper-answer-block p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-slate-800">第 {idx + 1} 题 ({q.score}分)</span>
                    <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-mono">
                      答案: {q.answer}
                    </span>
                  </div>
                  {q.ans_slice_url ? (
                    <img
                      src={q.ans_slice_url}
                      alt={`第 ${idx + 1} 题官方解析`}
                      className="max-w-full w-auto max-h-none object-contain bg-white rounded-lg"
                    />
                  ) : (
                    <div className="text-slate-600 text-[11px] leading-relaxed">
                      <MathRenderer content={q.explanation || q.analysis || '详见高斯导引标准解答'} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 text-slate-400 space-y-2 shadow-sm">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-slate-700">尚未生成试卷</div>
          <p className="text-xs text-slate-400">在上方选择年级、奥数模块与题量，一键生成标准 A4 考卷。</p>
        </div>
      )}

      {/* Score Entry Modal */}
      {isScoreModalOpen && generatedPaper && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="试卷打印与分享"
          className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
        >
          <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <ClipboardEdit className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-800 m-0">纸卷线下作答快速录分</h3>
              </div>
              <button onClick={() => setIsScoreModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {scoreSuccess && scoreSummary && (
              <div className="p-4 bg-emerald-50 text-emerald-800 text-xs rounded-2xl border border-emerald-200 space-y-2">
                <div className="flex items-center space-x-2 font-bold text-sm">
                  <Award className="w-5 h-5 text-emerald-600" />
                  <span>成绩已录入！总得分: {scoreSummary.total} / {scoreSummary.max} 分</span>
                </div>
                <p className="text-[11px] text-emerald-700">
                  共 {generatedPaper.questions.length} 题，其中错题 {scoreSummary.wrongCount} 题，已全量同步至【艾宾浩斯错题本】！
                </p>
                {onNavigateToErrorBook && scoreSummary.wrongCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsScoreModalOpen(false);
                      onNavigateToErrorBook();
                    }}
                    className="mt-1 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center space-x-1 cursor-pointer"
                  >
                    <span>前往艾宾浩斯错题本复习</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Questions scoring list */}
            <div className="flex-1 overflow-auto space-y-2.5 p-1">
              {generatedPaper.questions.map((q, idx) => {
                const curScore = questionScores[q.id] !== undefined ? questionScores[q.id] : q.score;
                const isFull = curScore >= q.score;
                const isZero = curScore === 0;

                return (
                  <div key={q.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="font-bold text-slate-800">第 {idx + 1} 题</span>
                      <span className="text-slate-400 ml-1">({q.score}分)</span>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        type="button"
                        disabled={scoreSuccess}
                        onClick={() => handleSetQuestionScore(q.id, q.score)}
                        className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                          isFull ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        ✔ 满分
                      </button>

                      <button
                        type="button"
                        disabled={scoreSuccess}
                        onClick={() => handleSetQuestionScore(q.id, 0)}
                        className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                          isZero ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        ✘ 0分 (错题)
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total score tally and submit */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <div className="text-xs font-bold text-slate-700">
                总得分: <span className="text-emerald-600 text-base font-black">
                  {Object.values(questionScores).reduce((a, b) => a + b, 0)}
                </span> / {generatedPaper.totalScore} 分
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={scoreSuccess}
                  onClick={handleBatchSubmitScores}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-md transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>保存并同步错题本</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsScoreModalOpen(false)}
                  className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export / Share Modal */}
      {isExportModalOpen && generatedPaper && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Printer className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800 m-0">试卷打印与跨端分享</h3>
              </div>
              <button
                type="button"
                onClick={handleCloseExportModal}
                disabled={isExporting}
                aria-label="关闭试卷导出窗口"
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-wait text-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {exportStatus && (
              <div className={`p-2.5 text-xs rounded-xl border flex items-center space-x-1.5 ${
                exportStatus.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : exportStatus.type === 'error'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                <Check className="w-4 h-4" />
                <span>{exportStatus.text}</span>
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={handleExportPdf}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-wait text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>📄 导出标准 A4 PDF 文件 (直接打印)</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={handleExportImage}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-wait text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>📥 导出一张高清长图 (保存到相册)</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={handlePrint}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-wait text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>🖨️ 调用系统打印机</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={handleNativeSharePaper}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-wait text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>📲 发送给微信 / QQ / 同事分享</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={handleCopyPaperText}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-200 disabled:cursor-wait text-slate-700 rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>📋 一键复制整卷文字与答案卡</span>
              </button>
            </div>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleCloseExportModal}
                disabled={isExporting}
                className="text-xs text-slate-400 hover:text-slate-600 disabled:text-slate-300 disabled:cursor-wait font-bold cursor-pointer"
              >
                取消返回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated Long-Image Preview Modal for Mobile Long-Press Save */}
      {previewImageUrls.length > 0 && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-5 border border-slate-200 space-y-3 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                <Download className="w-4 h-4 text-indigo-600" />
                <span>📱 完整试卷高清长图已生成</span>
              </div>
              <button onClick={() => setPreviewImageUrls([])} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-2.5 bg-indigo-50 text-indigo-900 rounded-xl text-xs font-medium">
              💡 手机端会调起系统分享；也可以长按下方整张长图，保存图片到相册。
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-2xl p-2 bg-slate-50 text-center space-y-3">
              {previewImageUrls.map((url, index) => (
                <div key={index} className="space-y-1">
                  <img
                    src={url}
                    alt="完整试卷高清长图"
                    className="max-w-full rounded-xl mx-auto shadow-sm"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setPreviewImageUrls([])}
                className="w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
