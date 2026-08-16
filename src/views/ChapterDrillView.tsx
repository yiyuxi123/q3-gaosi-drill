import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { 
  BookOpen, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  ChevronLeft, 
  Edit3,
  Lightbulb,
  LoaderCircle,
  BrainCircuit,
  Image as ImageIcon
} from 'lucide-react';
import type { Chapter, Question, UserRecord, MathModule } from '../types';
import { getAiProblemExplanation, type AiExplanationResult } from '../services/aiTutor';
import { calculatePracticeAttemptRecord } from '../services/ebbinghaus';
import { MathRenderer } from '../components/MathRenderer';

interface ChapterDrillViewProps {
  chapters: Chapter[];
  allQuestions: Question[];
  userRecords: Record<string, UserRecord>;
  onSaveRecord: (record: UserRecord) => void;
  initialFilter?: { chapterId?: string; questionId?: string; module?: MathModule };
}

export const ChapterDrillView: React.FC<ChapterDrillViewProps> = ({
  chapters,
  allQuestions,
  userRecords,
  onSaveRecord,
  initialFilter
}) => {
  const [selectedGrade, setSelectedGrade] = useState<string>('all');
  const [selectedModule, setSelectedModule] = useState<string>(initialFilter?.module || 'all');
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [showAiAnalysis, setShowAiAnalysis] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AiExplanationResult | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  const [showSliceImage, setShowSliceImage] = useState<boolean>(true);
  const aiRequestIdRef = useRef(0);

  useEffect(() => {
    if (!initialFilter?.chapterId) return;
    const found = chapters.find(c => c.id === initialFilter.chapterId);
    if (!found) return;

    const chapterQuestions = allQuestions.filter(question => question.chapter_id === found.id);
    const targetQuestion = initialFilter.questionId
      ? chapterQuestions.find(question => question.id === initialFilter.questionId)
      : chapterQuestions[0];

    setActiveChapter(found);
    if (targetQuestion) {
      aiRequestIdRef.current += 1;
      setCurrentQuestion(targetQuestion);
      setShowAiAnalysis(false);
      setAiResult(null);
      setAiError('');
      setAiLoading(false);
    }
  }, [initialFilter, chapters, allQuestions]);

  useEffect(() => {
    if (!currentQuestion) return;
    const record = userRecords[currentQuestion.id];
    setNoteText(record?.user_notes ?? record?.notes ?? '');
  }, [currentQuestion, userRecords]);

  const grades = ['all', '三年级', '四年级', '五年级', '六年级'];
  const modulesList: (MathModule | 'all')[] = ['all', '计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学'];

  const filteredChapters = chapters.filter((c) => {
    const matchGrade = selectedGrade === 'all' || c.grade === selectedGrade;
    const matchMod = selectedModule === 'all' || c.module === selectedModule;
    return matchGrade && matchMod;
  });

  const openChapter = (ch: Chapter, targetQid?: string) => {
    setActiveChapter(ch);
    const chQuestions = allQuestions.filter(q => q.chapter_id === ch.id);
    const targetQ = targetQid 
      ? chQuestions.find(q => q.id === targetQid) 
      : chQuestions[0];
    
    if (targetQ) {
      selectQuestion(targetQ);
    }
  };

  const selectQuestion = (q: Question) => {
    aiRequestIdRef.current += 1;
    setCurrentQuestion(q);
    setShowAiAnalysis(false);
    setAiResult(null);
    setAiError('');
    setAiLoading(false);
  };

  const handleMarkStatus = (status: 'correct' | 'wrong') => {
    if (!currentQuestion) return;
    const existing = userRecords[currentQuestion.id];
    const newRecord: UserRecord = {
      ...calculatePracticeAttemptRecord(
        existing,
        { question_id: currentQuestion.id, chapter_id: currentQuestion.chapter_id },
        status === 'correct',
        noteText
      ),
      notes: noteText,
      source: 'online'
    };
    onSaveRecord(newRecord);

    if (status === 'correct') {
      confetti({
        particleCount: 30,
        spread: 50,
        origin: { y: 0.7 }
      });
    }
  };

  const handleSaveNotes = () => {
    if (!currentQuestion) return;
    const existing = userRecords[currentQuestion.id];
    if (!existing || (existing.user_notes ?? existing.notes ?? '') === noteText) return;
    // Editing a note is not a new answer attempt. Preserve the score, review
    // stage and timestamps instead of routing through handleMarkStatus.
    onSaveRecord({ ...existing, user_notes: noteText, notes: noteText });
  };

  const handleRequestAi = async () => {
    if (!currentQuestion || aiLoading) return;
    setShowAiAnalysis(true);
    if (aiResult) return;
    const requestedQuestionId = currentQuestion.id;
    const requestId = ++aiRequestIdRef.current;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await getAiProblemExplanation(currentQuestion);
      if (requestId === aiRequestIdRef.current && currentQuestion.id === requestedQuestionId) {
        setAiResult(res);
      }
    } catch (error) {
      if (requestId === aiRequestIdRef.current && currentQuestion.id === requestedQuestionId) {
        setAiError(error instanceof Error ? error.message : 'AI 讲解暂时不可用，请稍后重试。');
      }
    } finally {
      if (requestId === aiRequestIdRef.current) {
        setAiLoading(false);
      }
    }
  };

  const currentChapterQuestions = activeChapter 
    ? allQuestions.filter(q => q.chapter_id === activeChapter.id)
    : [];
  
  const currentIndex = currentQuestion 
    ? currentChapterQuestions.findIndex(q => q.id === currentQuestion.id)
    : -1;

  const handlePrevQuestion = () => {
    if (currentIndex > 0) {
      selectQuestion(currentChapterQuestions[currentIndex - 1]);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex < currentChapterQuestions.length - 1) {
      selectQuestion(currentChapterQuestions[currentIndex + 1]);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Filter Bar */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900 flex items-center space-x-2 m-0">
              <BookOpen className="w-5 h-5 text-blue-600" />
              <span>高斯导引 15 讲章节刷题</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              单题高清切片对照 · KaTeX 数学公式渲染 · 即时判分
            </p>
          </div>

          <div className="text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            共 <strong className="text-blue-600">{filteredChapters.length}</strong> 讲核心专题
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-slate-100">
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
            {grades.map((g) => (
              <button
                key={g}
                onClick={() => setSelectedGrade(g)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  selectedGrade === g
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g === 'all' ? '全部年级' : g}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-1 overflow-x-auto py-1">
            {modulesList.map((m) => (
              <button
                key={m}
                onClick={() => setSelectedModule(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 ${
                  selectedModule === m
                    ? 'bg-blue-600 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m === 'all' ? '全部模块' : m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chapters Grid View */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredChapters.map((ch) => {
          const chQuestions = allQuestions.filter(q => q.chapter_id === ch.id);
          const solvedInCh = chQuestions.filter(q => !!userRecords[q.id]);
          const correctInCh = chQuestions.filter(q => userRecords[q.id]?.status === 'correct');
          const wrongInCh = chQuestions.filter(q => userRecords[q.id]?.status === 'wrong');
          const compRate = chQuestions.length > 0 ? Math.round((solvedInCh.length / chQuestions.length) * 100) : 0;

          return (
            <div
              key={ch.id}
              onClick={() => openChapter(ch)}
              className="bg-white rounded-3xl p-5 border border-slate-200 hover:border-blue-500 hover:shadow-md transition cursor-pointer flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100">
                      {ch.grade}
                    </span>
                    <span className="text-[11px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                      {ch.module}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-blue-600">{compRate}%</span>
                </div>

                <h3 className="text-sm font-bold text-slate-900 mt-2.5 group-hover:text-blue-600 transition">
                  第{ch.chapter_num}讲 {ch.title}
                </h3>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                  考点：{ch.sub_module}
                </p>

                <div className="flex items-center space-x-1.5 mt-3 text-[10px] text-slate-500">
                  {ch.sections.map((sec) => (
                    <span key={sec.name} className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                      {sec.name} {sec.count}题
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all"
                    style={{ width: `${compRate}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                  <span>已完成 {solvedInCh.length}/{ch.total_questions} 题</span>
                  <span className="flex items-center space-x-2">
                    <span className="text-emerald-600">对 {correctInCh.length}</span>
                    <span className="text-rose-500">错 {wrongInCh.length}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Single Question Practice Modal */}
      {activeChapter && currentQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-xl max-w-5xl w-full h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="bg-white px-6 py-3.5 flex items-center justify-between border-b border-slate-200 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                  {currentQuestion.grade_num}年
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800 flex items-center space-x-2">
                    <span>第{activeChapter.chapter_num}讲《{activeChapter.title}》</span>
                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px]">
                      {currentQuestion.short_title}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    难度：{currentQuestion.difficulty_stars} · {currentQuestion.module} · {currentQuestion.sub_module}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowSliceImage(!showSliceImage)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-xl border transition cursor-pointer flex items-center space-x-1 ${
                    showSliceImage ? 'bg-blue-50 border-blue-200 text-blue-700 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                  title="切换单题切片对照"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{showSliceImage ? '隐藏单题切片' : '显示单题切片'}</span>
                </button>

                <button
                  onClick={() => setActiveChapter(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg text-lg transition cursor-pointer"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Quick Navigation Strip */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center space-x-1.5 overflow-x-auto shrink-0">
              <span className="text-[11px] font-bold text-slate-500 shrink-0 mr-1">讲次题号:</span>
              {currentChapterQuestions.map((q, idx) => {
                const rec = userRecords[q.id];
                const isSelected = q.id === currentQuestion.id;
                return (
                  <button
                    key={q.id}
                    onClick={() => selectQuestion(q)}
                    className={`w-7 h-7 rounded-lg text-xs font-bold shrink-0 transition flex items-center justify-center cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-blue-600 bg-blue-600 text-white shadow-xs'
                        : rec?.status === 'correct'
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                        : rec?.status === 'wrong'
                        ? 'bg-rose-100 text-rose-700 border border-rose-300'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-50">
              {/* Left Column: Digitized Math Problem + Single Question Crop */}
              <div className="flex-1 overflow-auto p-6 space-y-5">
                {/* Digitized Problem Box */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-3">
                  <div className="text-xs font-bold text-slate-500 flex items-center justify-between pb-2 border-b border-slate-100">
                    <span>题目内容 ({currentQuestion.short_title})</span>
                    <span className="text-blue-600">满分 {currentQuestion.score} 分</span>
                  </div>

                  <div className="text-sm text-slate-900 leading-relaxed font-medium py-1">
                    <MathRenderer content={currentQuestion.content} />
                  </div>

                  {/* Single Question Cropped Slice (Focused Single Problem, NOT Full Page) */}
                  {showSliceImage && (currentQuestion as any).q_slice_url && (
                    <div className="pt-3 border-t border-slate-100">
                      <div className="text-[11px] text-slate-400 mb-1.5 flex items-center space-x-1">
                        <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                        <span>单题原图切片对照：</span>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-center max-h-56 overflow-hidden">
                        <img
                          src={(currentQuestion as any).q_slice_url}
                          alt="单题原图切片"
                          className="max-h-52 rounded object-contain"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Step by Step Explanation & Standard Answer */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                  <div className="text-xs font-bold text-slate-800 flex items-center justify-between pb-2 border-b border-slate-100">
                    <span>官方标准答案与详细推导</span>
                    <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px]">
                      参考答案
                    </span>
                  </div>

                  <div className="bg-emerald-50/80 p-3 rounded-xl border border-emerald-200 text-xs">
                    <strong className="text-emerald-900">【标准答案】：</strong>
                    <span className="font-bold text-emerald-800 ml-1">{currentQuestion.answer}</span>
                  </div>

                  <div className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <MathRenderer content={currentQuestion.explanation} />
                  </div>

                  {/* Single Answer Slice Image (if available) */}
                  {showSliceImage && (currentQuestion as any).ans_slice_url && (
                    <div className="pt-2 border-t border-slate-100">
                      <div className="text-[11px] text-slate-400 mb-1.5">官方单题解答切片：</div>
                      <div className="bg-slate-50 p-2 rounded-xl border border-slate-200 flex justify-center max-h-48 overflow-hidden">
                        <img
                          src={(currentQuestion as any).ans_slice_url}
                          alt="单题解答切片"
                          className="max-h-44 rounded object-contain"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Score Recording & Notes */}
              <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-slate-200 p-5 flex flex-col justify-between overflow-y-auto shrink-0">
                <div className="space-y-4">
                  {/* Status Indicator */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 text-xs font-bold">
                    <span className="text-slate-600">作答状态：</span>
                    {userRecords[currentQuestion.id]?.status === 'correct' ? (
                      <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>做对了 (正确)</span>
                      </span>
                    ) : userRecords[currentQuestion.id]?.status === 'wrong' ? (
                      <span className="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 flex items-center space-x-1">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>错题 (已入错题本)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                        尚未判定
                      </span>
                    )}
                  </div>

                  {/* Immediate Scoring Buttons */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      做完记录得分：
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleMarkStatus('correct')}
                        className={`py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1 transition cursor-pointer ${
                          userRecords[currentQuestion.id]?.status === 'correct'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>做对了 (✔)</span>
                      </button>

                      <button
                        onClick={() => handleMarkStatus('wrong')}
                        className={`py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1 transition cursor-pointer ${
                          userRecords[currentQuestion.id]?.status === 'wrong'
                            ? 'bg-rose-600 text-white shadow-xs'
                            : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                        }`}
                      >
                        <XCircle className="w-4 h-4" />
                        <span>做错了 (✘)</span>
                      </button>
                    </div>
                  </div>

                  {/* Personal Notes */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                      <span className="flex items-center space-x-1">
                        <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                        <span>个人解题笔记</span>
                      </span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="记录本题的易错点、公式或思路..."
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onBlur={handleSaveNotes}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:border-blue-600"
                    />
                  </div>

                  {/* AI Explanation Optional */}
                  <div className="pt-2 border-t border-slate-100">
                    <button
                      onClick={handleRequestAi}
                      disabled={aiLoading}
                      className="w-full py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-wait text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center space-x-1.5"
                    >
                      {aiLoading
                        ? <LoaderCircle className="w-4 h-4 text-purple-600 animate-spin" />
                        : <Lightbulb className="w-3.5 h-3.5 text-amber-500" />}
                      <span>{aiLoading ? '正在读题与验算…' : aiError ? '重试智能进阶精讲' : aiResult ? '查看智能进阶精讲' : '智能进阶精讲'}</span>
                    </button>
                  </div>

                  {showAiAnalysis && aiLoading && (
                    <div aria-live="polite" role="status" className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-[11px] text-purple-900 animate-in fade-in flex items-center gap-2 font-bold">
                      <LoaderCircle className="w-4 h-4 animate-spin shrink-0" />
                      <span>正在读取题目、核对官方答案并分步验算，请稍候…</span>
                    </div>
                  )}

                  {showAiAnalysis && aiError && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-800 animate-in fade-in">
                      {aiError}
                    </div>
                  )}

                  {showAiAnalysis && aiResult && (
                    <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 text-xs space-y-3 animate-in fade-in text-blue-950">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-blue-900 flex items-center gap-1.5">
                          <BrainCircuit className="w-4 h-4" />
                          智能分步精讲
                        </strong>
                        <span className="text-[10px] rounded-full bg-white border border-blue-100 px-2 py-1 text-blue-600">
                          {aiResult.model}{aiResult.source === 'local' ? ' · 本地回退' : ''}
                        </span>
                      </div>
                      {aiResult.warning && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] text-amber-900">
                          {aiResult.warning}
                        </div>
                      )}
                      <div>
                        <div className="font-bold mb-1">核心思路</div>
                        <p className="text-slate-700 text-[11px] leading-relaxed whitespace-pre-wrap m-0">{aiResult.analysis}</p>
                      </div>
                      {aiResult.stepByStepSolution.length > 0 && (
                        <ol className="list-decimal pl-5 space-y-1.5 text-[11px] text-slate-700">
                          {aiResult.stepByStepSolution.map((step, index) => (
                            <li key={`${index}-${step}`} className="leading-relaxed pl-0.5">{step}</li>
                          ))}
                        </ol>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg bg-white border border-blue-100 p-2.5">
                          <div className="font-bold text-blue-900 mb-1">最终答案</div>
                          <div className="text-[11px] text-slate-700">{aiResult.finalAnswer}</div>
                        </div>
                        <div className="rounded-lg bg-white border border-blue-100 p-2.5">
                          <div className="font-bold text-blue-900 mb-1">教学避坑</div>
                          <div className="text-[11px] text-slate-700">{aiResult.teacherTips}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Navigation (Prev / Next) */}
                <div className="flex items-center space-x-2 pt-4 border-t border-slate-100">
                  <button
                    onClick={handlePrevQuestion}
                    disabled={currentIndex <= 0}
                    className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 text-xs font-bold flex items-center justify-center space-x-1 transition cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>上一题</span>
                  </button>

                  <button
                    onClick={handleNextQuestion}
                    disabled={currentIndex >= currentChapterQuestions.length - 1}
                    className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 text-xs font-bold flex items-center justify-center space-x-1 transition cursor-pointer shadow-xs"
                  >
                    <span>下一题</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
