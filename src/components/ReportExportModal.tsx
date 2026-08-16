import React, { useEffect, useRef, useState } from 'react';
import { 
  Share2, 
  FileText, 
  Image as ImageIcon, 
  Check, 
  X, 
  Trophy, 
  Flame, 
  Sparkles
} from 'lucide-react';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import type { UserSummary } from '../types';
import { formatExamDate } from '../services/examPlan';
import { calculatePdfPageOffsets } from '../services/pdfExport';
import { createSubmissionLock } from '../services/practiceSession';
import { canvasToBlob, deliverFiles, isMobileLike } from '../services/fileDelivery';

interface ReportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  leaderboardData: UserSummary[];
  totalQuestionsCount: number;
  examDate: string;
  daysRemaining: number;
}

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  isOpen,
  onClose,
  leaderboardData,
  totalQuestionsCount,
  examDate,
  daysRemaining
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const exportLockRef = useRef(createSubmissionLock());

  useEffect(() => {
    if (!isOpen) setStatusMsg(null);
  }, [isOpen]);

  const handleClose = () => {
    if (exportLockRef.current.isLocked()) return;
    onClose();
  };

  if (!isOpen) return null;

  const totalSolved = leaderboardData.reduce((acc, u) => acc + u.solved_count, 0);
  const avgAccuracy = leaderboardData.length > 0 
    ? Math.round(leaderboardData.reduce((acc, u) => acc + u.accuracy_rate, 0) / leaderboardData.length)
    : 0;
  const examDateLabel = formatExamDate(examDate);
  const examDateToken = examDate.replace(/-/g, '') || '统考';

  // Generate PNG image blob
  const generateCanvas = async (purpose: 'highQuality' | 'quickShare' = 'highQuality') => {
    if (!reportRef.current) return null;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const mobile = isMobileLike();
    return await html2canvas(reportRef.current, {
      scale: purpose === 'quickShare'
        ? (mobile ? 1.2 : 2)
        : (mobile ? 1.6 : 2.2),
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
  };

  // 1. Export as High-Res PNG Image
  const handleDownloadImage = async () => {
    if (!exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setStatusMsg({ type: 'info', text: '正在生成高清海报长图...' });

    try {
      const canvas = await generateCanvas();
      if (!canvas) throw new Error('Canvas render failed');

      const mode = await deliverFiles([{
        blob: await canvasToBlob(canvas, 'image/png'),
        filename: `卓越教育_${examDateToken}备考全员学情榜_${new Date().toISOString().slice(0, 10)}.png`
      }], {
        title: `卓越教育 · ${examDateLabel}统考全员学情榜`,
        preferShare: isMobileLike()
      });
      setStatusMsg({
        type: 'success',
        text: mode === 'shared' ? '已打开系统分享，可保存到相册或发送给微信。' : '高清报表图片已下载。'
      });
    } catch (err: any) {
      console.error(err);
      setStatusMsg({ type: 'error', text: '生成失败，请重试' });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  // 2. Export as PDF Document
  const handleDownloadPDF = async () => {
    if (!exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setStatusMsg({ type: 'info', text: '正在排版生成标准 PDF 文档...' });

    try {
      const canvas = await generateCanvas();
      if (!canvas) throw new Error('Canvas render failed');

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      calculatePdfPageOffsets(pdfHeight, pageHeight).forEach((offset, index) => {
        if (index > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, offset, pdfWidth, pdfHeight);
      });
      const mode = await deliverFiles([{
        blob: pdf.output('blob'),
        filename: `卓越教育_${examDateToken}备考全员学情报表_${new Date().toISOString().slice(0, 10)}.pdf`
      }], {
        title: `卓越教育 · ${examDateLabel}统考全员学情榜`,
        preferShare: isMobileLike()
      });
      setStatusMsg({
        type: 'success',
        text: mode === 'shared' ? '已打开系统分享，可选择打印或发送。' : '标准 PDF 文档已下载。'
      });
    } catch (err: any) {
      console.error(err);
      setStatusMsg({ type: 'error', text: 'PDF 导出失败，请重试' });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  // 3. Native Share (WeChat / System Share)
  const handleNativeShare = async () => {
    if (!exportLockRef.current.tryLock()) return;
    setIsExporting(true);
    setStatusMsg({ type: 'info', text: '正在快速生成分享图...' });

    try {
      const mobile = isMobileLike();
      const canvas = await generateCanvas('quickShare');
      if (!canvas) throw new Error('Canvas render failed');
      setStatusMsg({ type: 'info', text: '分享图已生成，正在打开微信 / QQ...' });

      const mode = await deliverFiles([{
        blob: mobile
          ? await canvasToBlob(canvas, 'image/jpeg', 0.84)
          : await canvasToBlob(canvas, 'image/png'),
        filename: `${examDateToken}_学情报表.${mobile ? 'jpg' : 'png'}`
      }], {
        title: `卓越教育 · ${examDateLabel}统考全员学情榜`,
        text: `全员总刷题 ${totalSolved} 题，平均正确率 ${avgAccuracy}%，距 ${examDateLabel}统考还剩 ${daysRemaining} 天！`,
        preferShare: true,
        desktopClipboard: true
      });
      setStatusMsg({
        type: 'success',
        text: mode === 'shared'
          ? '已打开系统分享，可直接发送给微信。'
          : mode === 'copied'
            ? '海报已复制，请打开微信电脑版并在聊天框按 Ctrl+V。'
            : '浏览器未允许复制，海报已下载；可将图片拖入微信聊天框。'
      });
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      setStatusMsg({ type: cancelled ? 'info' : 'error', text: cancelled ? '已取消分享。' : '分享生成失败，请重试。' });
    } finally {
      exportLockRef.current.release();
      setIsExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="导出学情战报"
      className="no-print fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in overflow-y-auto"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Modal Top Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 m-0">导出精美学情战报 (图片 / PDF / 微信分享)</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">支持一键生成高清长图、官方 PDF 格式及调起微信跨端分享</p>
            </div>
          </div>
          <button 
            onClick={handleClose}
            disabled={isExporting}
            aria-label="关闭学情战报导出窗口"
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-wait rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Toast */}
        {statusMsg && (
          <div className={`mx-4 mt-3 p-3 text-xs rounded-xl border flex items-center space-x-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : statusMsg.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
          }`}>
            {statusMsg.type === 'error'
              ? <X className="w-4 h-4 shrink-0" />
              : <Check className="w-4 h-4 shrink-0" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Visual Report Card Preview Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/70">
          <div 
            ref={reportRef}
            className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200 space-y-6 text-slate-800 font-sans"
            style={{ width: '100%', maxWidth: '520px', margin: '0 auto' }}
          >
            {/* Poster Header */}
            <div className="text-center space-y-3 pb-6 border-b border-slate-100 relative">
              <div className="flex items-center justify-center space-x-2">
                <img src="/logo.png" alt="卓越教育" className="h-8 w-auto object-contain" />
                <span className="text-[11px] font-black tracking-widest text-blue-600 uppercase bg-blue-50 px-2.5 py-0.5 rounded-full">
                  卓越教育 · 高斯奥数研学中心
                </span>
              </div>

              <div className="text-center text-slate-900 tracking-tight m-0 leading-tight">
                <div className="text-sm font-bold text-blue-700">{examDateLabel}统考</div>
                <h2 className="text-xl font-black m-0 mt-1 whitespace-nowrap">全员学情战报</h2>
              </div>

              <div className="inline-flex items-center space-x-1.5 bg-rose-50 border border-rose-200/80 text-rose-700 px-3 py-1 rounded-full text-xs font-bold">
                <Flame className="w-3.5 h-3.5 text-rose-500" />
                <span>距 {examDateLabel}统考倒计时: {daysRemaining} 天</span>
              </div>
            </div>

            {/* Core Stats Metric Cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
              <div className="p-3 bg-blue-50/70 rounded-2xl border border-blue-100 space-y-0.5">
                <div className="text-[10px] font-bold text-blue-600">全员总刷题</div>
                <div className="text-lg font-black text-blue-900 font-mono">{totalSolved} <span className="text-[10px] font-normal">题</span></div>
              </div>

              <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-100 space-y-0.5">
                <div className="text-[10px] font-bold text-emerald-600">全员平均正确率</div>
                <div className="text-lg font-black text-emerald-900 font-mono">{avgAccuracy}%</div>
              </div>

              <div className="p-3 bg-amber-50/70 rounded-2xl border border-amber-100 space-y-0.5">
                <div className="text-[10px] font-bold text-amber-600">参战教研老师</div>
                <div className="text-lg font-black text-amber-900 font-mono">{leaderboardData.length} <span className="text-[10px] font-normal">位</span></div>
              </div>
            </div>

            {/* Leaderboard Table List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-black text-slate-900 px-1">
                <span className="flex items-center space-x-1">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <span>教研备战先锋榜</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal">实时数据更新</span>
              </div>

              <div className="space-y-2.5">
                {leaderboardData.slice(0, 7).map((u, idx) => {
                  const medalColors = [
                    'bg-amber-400 text-amber-900 shadow-xs shadow-amber-200',
                    'bg-slate-300 text-slate-800',
                    'bg-amber-700/70 text-white'
                  ];

                  return (
                    <div 
                      key={u.username}
                      className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                          idx < 3 ? medalColors[idx] : 'bg-slate-200 text-slate-600'
                        }`}>
                          {idx + 1}
                        </span>

                        <div className="truncate">
                          <div className="font-bold text-slate-900 text-xs truncate">
                            {u.real_name} 
                            <span className="text-[10px] text-slate-400 font-normal ml-1">(@{u.username})</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            已攻克 {u.solved_count}/{totalQuestionsCount} 题 · 连胜 {u.streak_days} 天
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-black text-emerald-600 font-mono text-sm">
                          {u.accuracy_rate}%
                        </div>
                        <div className="text-[9px] text-slate-400 font-medium">
                          完成度 {u.completion_rate}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Poster Footer */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
              <div>卓越教育 · 教学教研督导组监制</div>
              <div className="font-mono">{new Date().toLocaleDateString('zh-CN')}</div>
            </div>
          </div>
        </div>

        {/* Action Buttons Bar */}
        <div className="p-4 sm:p-5 bg-white border-t border-slate-100 flex flex-col sm:flex-row gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isExporting}
            onClick={handleNativeShare}
            className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl text-xs font-bold shadow-md hover:shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
          >
            <Share2 className="w-4 h-4" />
            <span>{isMobileLike() ? '📲 微信 / QQ 跨端分享战报' : '📋 复制海报到微信电脑版'}</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleDownloadImage}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold shadow-md hover:shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
          >
            <ImageIcon className="w-4 h-4" />
            <span>🖼️ 保存高清海报图片 (PNG)</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleDownloadPDF}
            className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-bold shadow-md hover:shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>📄 导出 PDF 格式报表</span>
          </button>
        </div>
      </div>
    </div>
  );
};
