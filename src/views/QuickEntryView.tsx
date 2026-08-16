import React, { useEffect, useRef, useState } from 'react';
import { 
  CheckCircle2, 
  Camera, 
  Upload, 
  Sparkles, 
  Save, 
  RefreshCw, 
  Check
} from 'lucide-react';
import type { Chapter, Question, UserRecord } from '../types';
import { recognizePhotoAnswer, type PhotoOcrResult } from '../services/aiTutor';
import { calculatePracticeAttemptRecord } from '../services/ebbinghaus';
import { createSubmissionLock } from '../services/practiceSession';

interface QuickEntryViewProps {
  chapters: Chapter[];
  allQuestions: Question[];
  userRecords: Record<string, UserRecord>;
  onBatchSaveRecords: (records: UserRecord[]) => boolean;
}

export const QuickEntryView: React.FC<QuickEntryViewProps> = ({
  chapters,
  allQuestions,
  userRecords,
  onBatchSaveRecords
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'camera'>('matrix');
  const [selectedChapterId, setSelectedChapterId] = useState<string>(chapters[0]?.id || 'g3_ch11');
  const [localStatuses, setLocalStatuses] = useState<Record<string, 'correct' | 'wrong' | 'unsolved'>>({});
  const [matrixSavedSuccess, setMatrixSavedSuccess] = useState<boolean>(false);

  // AI Camera states
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [ocrResult, setOcrResult] = useState<PhotoOcrResult | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedOcrQuestionId, setSelectedOcrQuestionId] = useState<string>('');
  const [ocrSaveStatus, setOcrSaveStatus] = useState<'correct' | 'wrong' | null>(null);
  const [ocrSaved, setOcrSaved] = useState<boolean>(false);
  const [ocrSavedSuccess, setOcrSavedSuccess] = useState<boolean>(false);
  const previewUrlRef = useRef<string | null>(null);
  const ocrRequestIdRef = useRef(0);
  const ocrSaveLockedRef = useRef(false);
  const matrixSaveLockRef = useRef(createSubmissionLock());

  useEffect(() => {
    if (chapters.length > 0 && !chapters.some(chapter => chapter.id === selectedChapterId)) {
      setSelectedChapterId(chapters[0].id);
    }
  }, [chapters, selectedChapterId]);

  useEffect(() => () => {
    ocrRequestIdRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const selectedChapter = chapters.find(c => c.id === selectedChapterId) || chapters[0];
  const chapterQuestions = allQuestions.filter(q => q.chapter_id === selectedChapter?.id);
  const selectedOcrQuestion = chapterQuestions.find(question => question.id === selectedOcrQuestionId);

  useEffect(() => {
    if (!chapterQuestions.some(question => question.id === selectedOcrQuestionId)) {
      setSelectedOcrQuestionId(chapterQuestions[0]?.id || '');
    }
  }, [chapterQuestions, selectedOcrQuestionId]);

  // Initialize or reset local statuses when chapter changes
  const getInitialStatus = (qid: string): 'correct' | 'wrong' | 'unsolved' => {
    return localStatuses[qid] || userRecords[qid]?.status || 'unsolved';
  };

  const handleToggleStatus = (qid: string) => {
    matrixSaveLockRef.current.reset();
    const current = getInitialStatus(qid);
    const hasSavedAttempt = Boolean(userRecords[qid]);
    const next = hasSavedAttempt
      ? (current === 'correct' ? 'wrong' : 'correct')
      : (current === 'unsolved' ? 'correct' : current === 'correct' ? 'wrong' : 'unsolved');

    setLocalStatuses(previous => {
      const updated = { ...previous };
      if (next === 'unsolved') delete updated[qid];
      else updated[qid] = next;
      return updated;
    });
    setMatrixSavedSuccess(false);
  };

  const handleBatchSubmit = () => {
    if (!matrixSaveLockRef.current.tryLock()) return;
    const recordsToSave = chapterQuestions.flatMap((question) => {
      const status = localStatuses[question.id];
      if (status !== 'correct' && status !== 'wrong') return [];
      const record = calculatePracticeAttemptRecord(
        userRecords[question.id],
        { question_id: question.id, chapter_id: question.chapter_id },
        status === 'correct'
      );
      return [{ ...record, source: 'manual' as const }];
    });

    if (recordsToSave.length === 0) {
      matrixSaveLockRef.current.release();
      return;
    }

    if (!onBatchSaveRecords(recordsToSave)) {
      matrixSaveLockRef.current.release();
      return;
    }
    setLocalStatuses({});
    setMatrixSavedSuccess(true);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const requestId = ++ocrRequestIdRef.current;

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setPreviewImage(previewUrl);
    setOcrResult(null);
    setOcrSaveStatus(null);
    setOcrSaved(false);
    setOcrSavedSuccess(false);
    ocrSaveLockedRef.current = false;
    setOcrLoading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      if (requestId !== ocrRequestIdRef.current) return;
      try {
        const base64 = reader.result as string;
        const res = await recognizePhotoAnswer(base64);
        if (requestId === ocrRequestIdRef.current) {
          setOcrResult(res);
          setOcrSaveStatus(res.detectedStatus === 'unknown' ? null : res.detectedStatus);
        }
      } catch (error) {
        if (requestId === ocrRequestIdRef.current) {
          setOcrResult({
            recognizedText: '图片读取或 AI 识别失败。',
            detectedStatus: 'unknown',
            confidence: 0,
            warning: error instanceof Error ? error.message : String(error)
          });
        }
      } finally {
        if (requestId === ocrRequestIdRef.current) setOcrLoading(false);
      }
    };
    reader.onerror = () => {
      if (requestId !== ocrRequestIdRef.current) return;
      setOcrResult({
        recognizedText: '图片读取失败，请重新选择照片。',
        detectedStatus: 'unknown',
        confidence: 0,
        warning: reader.error?.message || '浏览器无法读取该图片。'
      });
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOcrResult = () => {
    if (ocrSaveLockedRef.current || !selectedOcrQuestion || !ocrResult || !ocrSaveStatus) return;
    ocrSaveLockedRef.current = true;
    const record = calculatePracticeAttemptRecord(
      userRecords[selectedOcrQuestion.id],
      { question_id: selectedOcrQuestion.id, chapter_id: selectedOcrQuestion.chapter_id },
      ocrSaveStatus === 'correct'
    );
    const savedRecord: UserRecord = {
      ...record,
      user_answer: ocrResult.recognizedText,
      source: 'ai_ocr'
    };
    if (!onBatchSaveRecords([savedRecord])) {
      ocrSaveLockedRef.current = false;
      return;
    }
    setOcrSaved(true);
    setOcrSavedSuccess(true);
  };

  // Calculations for current chapter matrix
  const totalInCh = chapterQuestions.length;
  const correctCount = chapterQuestions.filter(q => getInitialStatus(q.id) === 'correct').length;
  const wrongCount = chapterQuestions.filter(q => getInitialStatus(q.id) === 'wrong').length;
  const solvedCount = correctCount + wrongCount;
  const accuracyRate = solvedCount > 0 ? Math.round((correctCount / solvedCount) * 100) : 0;
  const hasMatrixChanges = chapterQuestions.some(question => (
    localStatuses[question.id] === 'correct' || localStatuses[question.id] === 'wrong'
  ));

  if (!selectedChapter) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-800">
        题库章节尚未加载成功，请返回首页刷新题库后再使用快速录入。
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900 flex items-center space-x-2 m-0">
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              <span>线下纸质刷题 · 极速成绩录入与 AI 拍照批改</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              纸质试卷做完后无需手动翻页，1秒矩阵批量录入或拍照识别自动建档并同步坚果云
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'matrix' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              矩阵极速勾选
            </button>
            <button
              onClick={() => setActiveTab('camera')}
              className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer flex items-center space-x-1 ${
                activeTab === 'camera' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>AI 拍照判卷</span>
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'matrix' ? (
        <div className="space-y-6">
          {/* Chapter Selector Strip */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-2">选择已完成的讲次：</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {chapters.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    matrixSaveLockRef.current.reset();
                    setSelectedChapterId(ch.id);
                    setLocalStatuses({});
                    setMatrixSavedSuccess(false);
                  }}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    selectedChapterId === ch.id
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-900 font-bold shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="text-[10px] text-slate-400 font-medium">{ch.grade}</div>
                  <div className="text-xs truncate font-bold">第{ch.chapter_num}讲 {ch.title}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Matrix Grid */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 m-0">
                  {selectedChapter.grade} 第{selectedChapter.chapter_num}讲《{selectedChapter.title}》
                </h2>
                <div className="flex items-center space-x-3 text-xs text-slate-500 mt-1">
                  <span>模块：{selectedChapter.module}</span>
                  <span>总题量：{totalInCh} 题</span>
                  <span className="text-emerald-600 font-bold">做对：{correctCount} 题</span>
                  <span className="text-rose-600 font-bold">做错：{wrongCount} 题</span>
                  <span>正确率：<strong className="text-indigo-600">{accuracyRate}%</strong></span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleBatchSubmit}
                  disabled={!hasMatrixChanges}
                  className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-100 transition cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>一键保存并同步云端</span>
                </button>
              </div>
            </div>

            {matrixSavedSuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center space-x-2 animate-in fade-in">
                <Check className="w-4 h-4" />
                <span>录入成功！成绩已保存至本地，并已加入坚果云增量同步队列。</span>
              </div>
            )}

            {/* Click legend */}
            <div className="flex items-center space-x-4 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl">
              <span className="font-bold text-slate-700">点击方块循环切换状态：</span>
              <span className="flex items-center space-x-1"><span className="w-3.5 h-3.5 bg-slate-200 rounded" /><span>未作答</span></span>
              <span className="flex items-center space-x-1"><span className="w-3.5 h-3.5 bg-emerald-500 rounded text-white text-[9px] flex items-center justify-center">✔</span><span>正确 (绿色)</span></span>
              <span className="flex items-center space-x-1"><span className="w-3.5 h-3.5 bg-rose-500 rounded text-white text-[9px] flex items-center justify-center">✘</span><span>错题 (红色)</span></span>
            </div>

            {/* Question Matrix Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {chapterQuestions.map((q) => {
                const st = getInitialStatus(q.id);
                return (
                  <button
                    key={q.id}
                    onClick={() => handleToggleStatus(q.id)}
                    className={`p-3 rounded-2xl border text-center transition cursor-pointer select-none group flex flex-col items-center justify-center ${
                      st === 'correct'
                        ? 'bg-emerald-500 border-emerald-600 text-white shadow-md shadow-emerald-100 scale-[1.02]'
                        : st === 'wrong'
                        ? 'bg-rose-500 border-rose-600 text-white shadow-md shadow-rose-100 scale-[1.02]'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-[10px] opacity-80">{q.section}</div>
                    <div className="text-sm font-black mt-0.5">{q.short_title.replace(`${q.section} `, '')}</div>
                    <div className="mt-1.5 text-xs font-bold">
                      {st === 'correct' ? '✔ 做对' : st === 'wrong' ? '✘ 错题' : '⚪ 未答'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* AI Camera & Photo OCR Mode */
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
          <div className="border-2 border-dashed border-indigo-200 rounded-3xl p-8 text-center bg-indigo-50/30 hover:bg-indigo-50/60 transition">
            <input
              type="file"
              accept="image/*"
              id="photo-ocr-input"
              className="hidden"
              onChange={handlePhotoUpload}
            />
            <label
              htmlFor="photo-ocr-input"
              className="flex flex-col items-center justify-center cursor-pointer"
            >
              <div className="w-16 h-16 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 mb-3 hover:scale-105 transition-transform">
                <Camera className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">
                拍摄实体试卷 / 上传答卷照片
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                支持手机摄像头拍照或相册上传，AI 提取作答与批改痕迹，复核题号后即可保存
              </p>
              <span className="mt-4 inline-flex items-center space-x-1.5 bg-white border border-indigo-200 text-indigo-600 text-xs font-bold px-4 py-2 rounded-xl shadow-xs">
                <Upload className="w-3.5 h-3.5" />
                <span>选择照片进行识别</span>
              </span>
            </label>
          </div>

          {/* OCR Processing or Result */}
          {ocrLoading && (
            <div className="p-6 bg-slate-50 rounded-2xl text-center border border-slate-200 space-y-2">
              <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto" />
              <div className="text-xs font-bold text-slate-700">Qwen 3.7 Plus 正在识别题目与作答痕迹...</div>
              <p className="text-[11px] text-slate-400">无法可靠核验时会标记为“需人工确认”，不会默认判对或判错</p>
            </div>
          )}

          {ocrResult && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-bold text-slate-800">试卷智能识别报告</span>
                </div>
                <span className="text-[11px] text-slate-600 font-bold bg-white px-2 py-0.5 rounded border border-slate-200">
                  匹配置信度 {Math.round(ocrResult.confidence * 100)}%
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="text-slate-400">识别内容：</div>
                  <div className="font-bold text-slate-800 whitespace-pre-wrap">{ocrResult.recognizedText}</div>
                  <div className="text-slate-400 mt-2">判分结论：</div>
                  <div className={`font-bold ${
                    ocrResult.detectedStatus === 'correct'
                      ? 'text-emerald-600'
                      : ocrResult.detectedStatus === 'wrong'
                        ? 'text-rose-600'
                        : 'text-amber-700'
                  }`}>
                    {ocrResult.detectedStatus === 'correct'
                      ? '识别为正确，请人工复核后保存'
                      : ocrResult.detectedStatus === 'wrong'
                        ? '识别为错误，请人工复核后加入错题本'
                        : '证据不足，需要人工确认'}
                  </div>
                  {ocrResult.warning && <div className="mt-2 text-amber-700">{ocrResult.warning}</div>}
                </div>

                {previewImage && (
                  <div className="bg-white p-2 rounded-xl border border-slate-200 flex justify-center">
                    <img src={previewImage} alt="上传试卷" className="max-h-36 rounded object-contain" />
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="font-bold text-slate-800">人工复核并保存</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="block text-[11px] text-slate-500">所属讲次</span>
                    <select
                      value={selectedChapterId}
                      disabled={ocrSaved}
                      onChange={(event) => setSelectedChapterId(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {chapters.map(chapter => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.grade} 第{chapter.chapter_num}讲 {chapter.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] text-slate-500">对应题目</span>
                    <select
                      value={selectedOcrQuestionId}
                      disabled={ocrSaved}
                      onChange={(event) => setSelectedOcrQuestionId(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {chapterQuestions.map(question => (
                        <option key={question.id} value={question.id}>
                          {question.short_title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500 mr-1">确认结果：</span>
                  <button
                    type="button"
                    disabled={ocrSaved}
                    onClick={() => {
                      if (!ocrSaveLockedRef.current) setOcrSaveStatus('correct');
                    }}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                      ocrSaveStatus === 'correct'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-emerald-200 text-emerald-700'
                    }`}
                  >
                    ✔ 正确
                  </button>
                  <button
                    type="button"
                    disabled={ocrSaved}
                    onClick={() => {
                      if (!ocrSaveLockedRef.current) setOcrSaveStatus('wrong');
                    }}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                      ocrSaveStatus === 'wrong'
                        ? 'bg-rose-600 border-rose-600 text-white'
                        : 'bg-white border-rose-200 text-rose-700'
                    }`}
                  >
                    ✘ 错误
                  </button>
                  <button
                    type="button"
                    disabled={!selectedOcrQuestion || !ocrSaveStatus || ocrSaved}
                    onClick={handleSaveOcrResult}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {ocrSaved ? '已保存' : '保存并同步'}
                  </button>
                </div>

                {ocrSavedSuccess && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
                    已保存到学习记录，并加入云同步队列。题号与判分已锁定；如需录入另一题，请上传新照片。
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
