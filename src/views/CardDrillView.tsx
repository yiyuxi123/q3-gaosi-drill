import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Eye, 
  Check, 
  X, 
  BookOpen, 
  Bot, 
  BrainCircuit, 
  FileCheck,
  Send,
  SkipForward,
  Maximize2,
  Shuffle,
  LoaderCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Question, Chapter, UserRecord, MathModule } from '../types';
import { getAiProblemExplanation, type AiExplanationResult } from '../services/aiTutor';
import { calculatePracticeAttemptRecord } from '../services/ebbinghaus';
import { verifyAnswer, getAnswerFormatHint, isAutoGradableAnswer, type AnswerCheckResult } from '../services/answerVerifier';
import { ImageLightboxModal } from '../components/ImageLightboxModal';
import { MathRenderer } from '../components/MathRenderer';
import {
  clampQuestionIndex,
  createQuestionCommitGuard,
  filterDrillQuestions,
  getDrillKeyboardAction,
  getRandomQuestionIndex
} from '../services/practiceSession';

interface CardDrillViewProps {
  chapters: Chapter[];
  allQuestions: Question[];
  userRecords: Record<string, UserRecord>;
  onSaveRecord: (record: UserRecord) => boolean;
  initialFilter?: { chapterId?: string; questionId?: string; module?: MathModule };
}

type RandomStrategy = 'uniform' | 'unseen_first' | 'wrong_first';
type RandomRange = 'current' | 'chapter' | 'grade' | 'all';

export const CardDrillView: React.FC<CardDrillViewProps> = ({
  chapters,
  allQuestions,
  userRecords,
  onSaveRecord,
  initialFilter
}) => {
  // Filter States
  const [selectedGrade, setSelectedGrade] = useState<string>('全部');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [selectedSection, setSelectedSection] = useState<string>('全部');
  const [selectedModule, setSelectedModule] = useState<MathModule | null>(null);

  // Active question index in filtered list
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isRandomMode, setIsRandomMode] = useState(false);
  const [randomStrategy, setRandomStrategy] = useState<RandomStrategy>('uniform');
  const [randomRange, setRandomRange] = useState<RandomRange>('current');
  const [randomHistory, setRandomHistory] = useState<number[]>([0]);
  const [randomCursor, setRandomCursor] = useState(0);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState<boolean>(false);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiExplanation, setAiExplanation] = useState<AiExplanationResult | null>(null);
  const [aiError, setAiError] = useState<string>('');

  // Display Mode: 'dual' (图文双显), 'text' (纯文字版), 'image' (纯原版切片)
  const [displayMode, setDisplayMode] = useState<'dual' | 'text' | 'image'>('dual');

  // Interactive Answer Input State
  const [userAnswerInput, setUserAnswerInput] = useState<string>('');
  const [checkResult, setCheckResult] = useState<AnswerCheckResult | null>(null);

  // Lightbox Modal State
  const [lightboxImg, setLightboxImg] = useState<{ url: string; title: string } | null>(null);
  const [failedQuestionImageUrls, setFailedQuestionImageUrls] = useState<Set<string>>(() => new Set());
  const [failedAnswerImageUrls, setFailedAnswerImageUrls] = useState<Set<string>>(() => new Set());
  const pendingAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitGuardRef = useRef(createQuestionCommitGuard());
  const [committedQuestionId, setCommittedQuestionId] = useState<string | null>(null);
  const activeQuestionIdRef = useRef<string | undefined>(undefined);
  const visibleQuestionIndexRef = useRef(0);
  const aiRequestIdRef = useRef(0);
  const automaticAiQuestionIdRef = useRef<string | undefined>(undefined);
  const aiExplanationPanelRef = useRef<HTMLDivElement | null>(null);

  const revealAiExplanation = useCallback(() => {
    setIsAnswerRevealed(true);
    window.setTimeout(() => {
      if (window.matchMedia('(max-width: 639px)').matches) {
        aiExplanationPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  }, []);

  const cancelPendingAdvance = useCallback(() => {
    if (pendingAdvanceRef.current) {
      clearTimeout(pendingAdvanceRef.current);
      pendingAdvanceRef.current = null;
    }
  }, []);

  // Filtered Chapters & Questions
  const filteredChapters = chapters.filter(ch => {
    if (selectedGrade !== '全部' && ch.grade !== selectedGrade) return false;
    if (selectedModule && ch.module !== selectedModule) return false;
    return true;
  });

  const activeChapterId = selectedModule
    ? selectedChapterId
    : selectedChapterId || (filteredChapters[0] ? filteredChapters[0].id : '');

  const currentFilterQuestions = filterDrillQuestions(allQuestions, {
    grade: selectedGrade,
    chapterId: activeChapterId,
    section: selectedSection,
    module: selectedModule
  });
  const randomRangeQuestions = randomRange === 'all'
    ? allQuestions
    : randomRange === 'grade'
      ? (selectedGrade === '全部' ? allQuestions : allQuestions.filter(question => question.grade === selectedGrade))
      : randomRange === 'chapter'
        ? allQuestions.filter(question => question.chapter_id === activeChapterId)
        : currentFilterQuestions;
  const filteredQuestions = isRandomMode ? randomRangeQuestions : currentFilterQuestions;
  const visibleQuestionIndex = clampQuestionIndex(currentIndex, filteredQuestions.length);
  visibleQuestionIndexRef.current = visibleQuestionIndex;
  const currentQ = filteredQuestions[visibleQuestionIndex];
  activeQuestionIdRef.current = currentQ?.id;
  const currentRecord = currentQ ? userRecords[currentQ.id] : undefined;
  const canAutoGrade = currentQ ? isAutoGradableAnswer(currentQ.answer) : false;
  const questionImageUrl = currentQ?.q_slice_url && !failedQuestionImageUrls.has(currentQ.q_slice_url)
    ? currentQ.q_slice_url
    : undefined;
  const answerImageUrl = currentQ?.ans_slice_url && !failedAnswerImageUrls.has(currentQ.ans_slice_url)
    ? currentQ.ans_slice_url
    : undefined;

  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter.module) {
      setSelectedGrade('全部');
      setSelectedModule(initialFilter.module);
      setSelectedChapterId('');
      setSelectedSection('全部');
      setCurrentIndex(0);
      return;
    }

    const questionChapterId = initialFilter.questionId
      ? allQuestions.find(question => question.id === initialFilter.questionId)?.chapter_id
      : undefined;
    const targetChapter = initialFilter.chapterId
      ? chapters.find(chapter => chapter.id === initialFilter.chapterId)
      : questionChapterId
        ? chapters.find(chapter => chapter.id === questionChapterId)
        : undefined;
    if (!targetChapter) return;

    const targetQuestions = allQuestions.filter(question => question.chapter_id === targetChapter.id);
    const targetIndex = initialFilter.questionId
      ? targetQuestions.findIndex(question => question.id === initialFilter.questionId)
      : 0;
    setSelectedGrade(targetChapter.grade);
    setSelectedModule(null);
    setSelectedChapterId(targetChapter.id);
    setSelectedSection('全部');
    setCurrentIndex(Math.max(0, targetIndex));
  }, [initialFilter, chapters, allQuestions]);

  useEffect(() => {
    if (currentIndex !== visibleQuestionIndex) setCurrentIndex(visibleQuestionIndex);
  }, [currentIndex, visibleQuestionIndex]);

  useEffect(() => {
    setRandomHistory([visibleQuestionIndexRef.current]);
    setRandomCursor(0);
  }, [selectedGrade, activeChapterId, selectedSection, selectedModule, isRandomMode, randomRange, randomStrategy]);

  useEffect(() => {
    aiRequestIdRef.current += 1;
    automaticAiQuestionIdRef.current = undefined;
    cancelPendingAdvance();
    setIsAnswerRevealed(false);
    setAiExplanation(null);
    setAiError('');
    setUserAnswerInput('');
    setCheckResult(null);
    setIsAiLoading(false);
    commitGuardRef.current.reset();
    setCommittedQuestionId(null);
  }, [currentQ?.id, cancelPendingAdvance]);

  useEffect(() => () => cancelPendingAdvance(), [cancelPendingAdvance]);

  useEffect(() => () => {
    aiRequestIdRef.current += 1;
    automaticAiQuestionIdRef.current = undefined;
  }, []);

  const handleNext = useCallback(() => {
    cancelPendingAdvance();
    if (isRandomMode) {
      if (randomCursor < randomHistory.length - 1) {
        const nextCursor = randomCursor + 1;
        setRandomCursor(nextCursor);
        setCurrentIndex(randomHistory[nextCursor]);
        return;
      }
      if (filteredQuestions.length <= 1) return;
      const recordStatuses = Object.fromEntries(filteredQuestions.map(question => [question.id, userRecords[question.id]?.status]));
      const nextIndex = getRandomQuestionIndex(
        filteredQuestions.map(question => question.id),
        visibleQuestionIndex,
        randomStrategy,
        recordStatuses
      );
      setRandomHistory(previous => [...previous, nextIndex]);
      setRandomCursor(previous => previous + 1);
      setCurrentIndex(nextIndex);
      return;
    }
    if (visibleQuestionIndex < filteredQuestions.length - 1) {
      setCurrentIndex(visibleQuestionIndex + 1);
    }
  }, [cancelPendingAdvance, filteredQuestions, isRandomMode, randomCursor, randomHistory, randomStrategy, userRecords, visibleQuestionIndex]);

  const handlePrev = useCallback(() => {
    cancelPendingAdvance();
    if (isRandomMode) {
      if (randomCursor <= 0) return;
      const previousCursor = randomCursor - 1;
      setRandomCursor(previousCursor);
      setCurrentIndex(randomHistory[previousCursor]);
      return;
    }
    if (visibleQuestionIndex > 0) {
      setCurrentIndex(visibleQuestionIndex - 1);
    }
  }, [cancelPendingAdvance, isRandomMode, randomCursor, randomHistory, visibleQuestionIndex]);

  const handleToggleRandomMode = () => {
    cancelPendingAdvance();
    setIsRandomMode(previous => {
      const next = !previous;
      setCurrentIndex(0);
      setRandomHistory([0]);
      setRandomCursor(0);
      return next;
    });
  };

  const handleMark = useCallback((passed: boolean) => {
    if (!currentQ) return;
    if (!commitGuardRef.current.tryCommit(currentQ.id)) return;

    const updatedRecord = calculatePracticeAttemptRecord(
      currentRecord,
      { question_id: currentQ.id, chapter_id: currentQ.chapter_id },
      passed
    );
    if (!onSaveRecord(updatedRecord)) {
      commitGuardRef.current.release(currentQ.id);
      return;
    }
    setCommittedQuestionId(currentQ.id);

    if (passed) {
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.85 }
      });
      cancelPendingAdvance();
      const markedQuestionId = currentQ.id;
      pendingAdvanceRef.current = setTimeout(() => {
        pendingAdvanceRef.current = null;
        if (activeQuestionIdRef.current === markedQuestionId) handleNext();
      }, 350);
    } else {
      setIsAnswerRevealed(true);
    }
  }, [cancelPendingAdvance, currentQ, currentRecord, handleNext, onSaveRecord]);

  const handleSubmitAnswer = useCallback(() => {
    if (!currentQ || !userAnswerInput.trim()) return;

    const res = verifyAnswer(userAnswerInput, currentQ.answer);
    setCheckResult(res);

    if (!res.isGradable) {
      setIsAnswerRevealed(true);
      return;
    }

    if (res.isCorrect) {
      handleMark(true);
    } else {
      handleMark(false);
    }
  }, [currentQ, handleMark, userAnswerInput]);

  const handleSkip = () => {
    handleMark(false);
    setIsAnswerRevealed(true);
  };

  // Keyboard navigation shortcuts. Keeping this below the handlers and listing
  // them as dependencies ensures key presses always use the latest question.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const action = getDrillKeyboardAction({
        key: e.key,
        targetTagName: target?.tagName,
        targetIsContentEditable: target?.isContentEditable,
        isAnswerInput: target?.dataset.drillAnswerInput === 'true',
        hasOpenDialog: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
      });
      if (!action) return;

      e.preventDefault();
      if (action === 'submit_answer') handleSubmitAnswer();
      else if (action === 'toggle_answer') setIsAnswerRevealed(previous => !previous);
      else if (action === 'next') handleNext();
      else if (action === 'previous') handlePrev();
      else if (action === 'mark_wrong') handleMark(false);
      else if (action === 'mark_correct') handleMark(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSubmitAnswer, handleNext, handlePrev, handleMark]);

  const handleFetchAi = async () => {
    if (!currentQ || isAiLoading) return;
    if (aiExplanation) {
      revealAiExplanation();
      return;
    }
    const requestedQuestionId = currentQ.id;
    const requestId = ++aiRequestIdRef.current;
    revealAiExplanation();
    setIsAiLoading(true);
    setAiError('');
    try {
      const res = await getAiProblemExplanation(currentQ);
      if (requestId === aiRequestIdRef.current && activeQuestionIdRef.current === requestedQuestionId) {
        setAiExplanation(res);
        revealAiExplanation();
      }
    } catch (error) {
      if (requestId === aiRequestIdRef.current && activeQuestionIdRef.current === requestedQuestionId) {
        setAiError(error instanceof Error ? error.message : 'AI解析暂时不可用，请稍后重试');
      }
    } finally {
      if (requestId === aiRequestIdRef.current) setIsAiLoading(false);
    }
  };

  // When the source book has no usable answer crop, write a structured AI
  // explanation automatically as soon as the learner reveals the answer.
  // The AI service caches the result per question, so revisiting is instant.
  useEffect(() => {
    if (!currentQ || !isAnswerRevealed || answerImageUrl || aiExplanation || aiError) return;
    if (automaticAiQuestionIdRef.current === currentQ.id) return;
    const requestedQuestionId = currentQ.id;
    const requestId = ++aiRequestIdRef.current;
    automaticAiQuestionIdRef.current = requestedQuestionId;
    setIsAiLoading(true);
    setAiError('');
    getAiProblemExplanation(currentQ)
      .then(result => {
        if (requestId === aiRequestIdRef.current && activeQuestionIdRef.current === requestedQuestionId) {
          setAiExplanation(result);
        }
      })
      .catch(error => {
        if (requestId === aiRequestIdRef.current && activeQuestionIdRef.current === requestedQuestionId) {
          setAiError(error instanceof Error ? error.message : 'AI解析暂时不可用，请稍后重试');
        }
      })
      .finally(() => {
        if (requestId === aiRequestIdRef.current) {
          automaticAiQuestionIdRef.current = undefined;
          setIsAiLoading(false);
        }
      });
  }, [currentQ, isAnswerRevealed, answerImageUrl, aiExplanation, aiError]);

  const grades = ['全部', '三年级', '四年级', '五年级', '六年级'];
  const sections = ['全部', '兴趣篇', '拓展篇', '超越篇'];

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-28 animate-in fade-in">
      {/* Top Filter and Chapter Selector Bar */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-3">
        {/* Grade Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            <span className="text-xs font-bold text-slate-400 shrink-0 mr-1">年级:</span>
            {grades.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => { 
                  cancelPendingAdvance();
                  setSelectedGrade(g); 
                  setSelectedModule(null);
                  setSelectedChapterId('');
                  setCurrentIndex(0); 
                }}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                  selectedGrade === g 
                    ? 'bg-blue-600 text-white shadow-xs' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Question Index Progress */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-pressed={isRandomMode}
              onClick={handleToggleRandomMode}
              className={`px-3 py-1 rounded-full text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                isRandomMode
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="随机抽题且不立即重复，仍可返回上一道抽过的题"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>{isRandomMode ? '随机已开启' : '随机模式'}</span>
            </button>
            <div className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
              {isRandomMode ? (
                <>第 <span className="text-amber-600 font-black">{randomCursor + 1}</span> 抽 · 题库 {filteredQuestions.length}</>
              ) : (
                <>题号: <span className="text-blue-600 font-black">{filteredQuestions.length > 0 ? visibleQuestionIndex + 1 : 0}</span> / {filteredQuestions.length}</>
              )}
            </div>
          </div>
        </div>

        {isRandomMode && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
            <label className="text-[11px] font-bold text-amber-900">
              <span className="block mb-1">如何随机</span>
              <select
                value={randomStrategy}
                onChange={(event) => {
                  cancelPendingAdvance();
                  setRandomStrategy(event.target.value as RandomStrategy);
                  setCurrentIndex(0);
                }}
                className="w-full rounded-xl border border-amber-200 bg-white p-2.5 text-xs font-bold text-slate-800"
              >
                <option value="uniform">完全随机（每题机会相同）</option>
                <option value="unseen_first">未做优先（做完后全题随机）</option>
                <option value="wrong_first">错题优先（无错题时抽未做题）</option>
              </select>
            </label>
            <label className="text-[11px] font-bold text-amber-900">
              <span className="block mb-1">随机范围</span>
              <select
                value={randomRange}
                onChange={(event) => {
                  cancelPendingAdvance();
                  setRandomRange(event.target.value as RandomRange);
                  setCurrentIndex(0);
                }}
                className="w-full rounded-xl border border-amber-200 bg-white p-2.5 text-xs font-bold text-slate-800"
              >
                <option value="current">当前筛选（年级 / 讲次 / 篇章）</option>
                <option value="chapter">当前讲次（忽略篇章）</option>
                <option value="grade">当前年级（忽略讲次与篇章）</option>
                <option value="all">全题库（{allQuestions.length} 题）</option>
              </select>
            </label>
          </div>
        )}

        {/* Chapters Dropdown & Section Filter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">
              {selectedModule ? `${selectedModule}专题范围` : '选择讲次 (真题 15 讲)'}
            </label>
            <select
              value={activeChapterId}
              onChange={(e) => {
                cancelPendingAdvance();
                setSelectedChapterId(e.target.value);
                if (e.target.value) setSelectedModule(null);
                setCurrentIndex(0);
              }}
              className="w-full p-2.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-slate-800"
            >
              {selectedModule && (
                <option value="">全部 {selectedModule} 讲次（共 {filteredQuestions.length} 题）</option>
              )}
              {filteredChapters.map(ch => (
                <option key={ch.id} value={ch.id}>
                  {ch.grade} · {ch.title} ({ch.module})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">篇章难度梯度</label>
            <div className="flex items-center space-x-1.5">
              {sections.map(sec => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => { cancelPendingAdvance(); setSelectedSection(sec); setCurrentIndex(0); }}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-center ${
                    selectedSection === sec
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {sec}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Flashcard Container: Text Version + Precise Cropped Diagram */}
      {currentQ ? (
        <div className="bg-white rounded-3xl p-5 sm:p-8 border border-slate-200 shadow-md space-y-5">
          {/* Card Top Title Bar & Display Mode Switch */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-black rounded-lg">
                {currentQ.grade}
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-900">
                {currentQ.chapter_title} · {currentQ.short_title}
              </span>
              <span className="text-[11px] px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md font-bold">
                {currentQ.module}
              </span>
            </div>

            {/* Mode Switcher Buttons */}
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setDisplayMode('dual')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  displayMode === 'dual' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
                title="图文双显"
              >
                图文双显
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('text')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  displayMode === 'text' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
                title="纯文字版"
              >
                纯文字
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('image')}
                disabled={!questionImageUrl}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition disabled:text-slate-300 disabled:cursor-not-allowed ${
                  displayMode === 'image' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
                title={questionImageUrl ? '原版切片' : '本题没有可用的原版切片'}
              >
                原版切片
              </button>
            </div>
          </div>

          {/* 1. Mathematical Problem Text (KaTeX Formatted) */}
          {(displayMode === 'dual' || displayMode === 'text' || !questionImageUrl) && (
            <div className="text-sm sm:text-base text-slate-800 leading-relaxed font-medium bg-slate-50/60 p-4 rounded-2xl border border-slate-100">
              <MathRenderer content={currentQ.content} />
            </div>
          )}

          {/* 2. Precise Question Crop / Diagram Snippet (Click to Zoom Lightbox) */}
          {(displayMode === 'dual' || displayMode === 'image') && questionImageUrl && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 px-1">
                <span className="flex items-center space-x-1">
                  <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                  <span>原书高清单题切片与图示 (点击放大):</span>
                </span>
                <span className="text-blue-600 flex items-center space-x-1 cursor-pointer">
                  <Maximize2 className="w-3 h-3" />
                  <span>全屏放大</span>
                </span>
              </div>

              <div 
                onClick={() => setLightboxImg({ url: questionImageUrl, title: currentQ.display_title })}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-center shadow-inner overflow-hidden cursor-zoom-in hover:border-blue-300 transition"
              >
                <img 
                  src={questionImageUrl}
                  alt="题目精准切片" 
                  className="max-h-72 rounded-xl mx-auto object-contain shadow-xs"
                  onError={() => setFailedQuestionImageUrls(previous => new Set(previous).add(questionImageUrl))}
                />
              </div>
            </div>
          )}

          {currentQ.q_slice_url && !questionImageUrl && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-900">
              原题切片加载失败，已自动显示文字版题目。
            </div>
          )}

          {/* 3. Interactive Answer Input & Tolerance Check Bar */}
          <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-blue-900 font-bold">
              <span>✍️ 答案输入判分 (防作弊防误判):</span>
              <span className="text-[11px] font-normal text-blue-700">
                {getAnswerFormatHint(currentQ.answer)}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="text"
                data-drill-answer-input="true"
                value={userAnswerInput}
                onChange={(e) => setUserAnswerInput(e.target.value)}
                disabled={!canAutoGrade || committedQuestionId === currentQ.id}
                placeholder={canAutoGrade ? '输入答案数值（如: 10）后按回车提交' : '暂无文本标准答案，请查看答案切片后手动标记'}
                className="flex-1 p-2.5 text-xs font-bold rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
              />

              <button
                type="button"
                onClick={handleSubmitAnswer}
                disabled={!canAutoGrade || committedQuestionId === currentQ.id}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center space-x-1 cursor-pointer shrink-0 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
                <span>判分</span>
              </button>

              <button
                type="button"
                onClick={handleSkip}
                disabled={committedQuestionId === currentQ.id}
                className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-slate-600 rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer shrink-0"
                title="跳过并推入今日错题复习池"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>跳过</span>
              </button>
            </div>

            {/* Check Feedback Banner */}
            {checkResult && (
              <div className={`p-2.5 rounded-xl text-xs font-bold animate-in fade-in flex items-center justify-between ${
                !checkResult.isGradable
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : checkResult.isCorrect 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                  : 'bg-rose-100 text-rose-800 border border-rose-300'
              }`}>
                <span>{checkResult.feedback}</span>
                {!checkResult.isGradable ? (
                  <span className="text-amber-800 font-black">请手动标记</span>
                ) : checkResult.isCorrect ? (
                  <span className="text-emerald-700 font-black">✔ 正确 +1</span>
                ) : (
                  <span className="text-rose-700 font-black">已收录至艾宾浩斯错题本</span>
                )}
              </div>
            )}
          </div>

          {/* 4. Authentic Answer & Explanation Reveal Card */}
          {aiError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center justify-between gap-3">
              <span>AI解析失败：{aiError}</span>
              <button
                type="button"
                disabled={isAiLoading}
                onClick={handleFetchAi}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-rose-200 font-bold hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
              >
                重试
              </button>
            </div>
          )}

          {isAiLoading && (
            <div aria-live="polite" className="p-3 rounded-xl border border-purple-200 bg-purple-50 text-xs text-purple-900 flex items-center gap-2 font-bold">
              <LoaderCircle className="w-4 h-4 animate-spin shrink-0" />
              <span>正在读取题目、核对官方答案并分步验算，请稍候…</span>
            </div>
          )}

          {isAnswerRevealed ? (
            <div className="p-5 sm:p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
                <div className="flex items-center space-x-2 font-bold text-slate-900 text-xs">
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  <span>标准答案与官方名师精解</span>
                </div>
                <span className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-mono font-bold">
                  答案: {canAutoGrade ? currentQ.answer : '请查看官方切片'}
                </span>
              </div>

              {/* Precise Answer Crop (Click to Zoom Lightbox) */}
              {answerImageUrl && (
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-slate-400">官方原版答案书解析切片 (点击放大):</div>
                  <div 
                    onClick={() => setLightboxImg({ url: answerImageUrl, title: `${currentQ.display_title} · 答案解析` })}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-center overflow-hidden cursor-zoom-in hover:border-emerald-300 transition"
                  >
                    <img 
                      src={answerImageUrl}
                      alt="名师解析精准切片" 
                      className="max-h-64 rounded-lg mx-auto object-contain shadow-xs"
                      onError={() => setFailedAnswerImageUrls(previous => new Set(previous).add(answerImageUrl))}
                    />
                  </div>
                </div>
              )}

              {currentQ.ans_slice_url && !answerImageUrl && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-900">
                  官方解析切片加载失败，正在改用 AI 文字解析。
                </div>
              )}

              {!currentQ.ans_slice_url && !canAutoGrade && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-900">
                  该题答案资产缺失，已停止自动判分。请联系题库管理员补录官方答案。
                </div>
              )}

              {/* Structured low-cost AI tutor explanation */}
              {aiExplanation && (
                <div ref={aiExplanationPanelRef} id="ai-explanation-panel" className="p-4 bg-blue-50/80 rounded-xl border border-blue-200 text-xs text-blue-950 space-y-3 scroll-mt-24">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-1.5 font-bold text-blue-800">
                      <BrainCircuit className="w-4 h-4" />
                      <span>AI 名师分步精讲</span>
                    </div>
                    <span className="text-[10px] text-blue-600 bg-white/80 px-2 py-1 rounded-full border border-blue-100">
                      {aiExplanation.model}{aiExplanation.source === 'local' ? ' · 本地回退' : ''}
                    </span>
                  </div>
                  {aiExplanation.warning && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                      {aiExplanation.warning}
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-blue-900 mb-1">核心思路</div>
                    <p className="leading-relaxed whitespace-pre-wrap m-0">{aiExplanation.analysis}</p>
                  </div>
                  {aiExplanation.stepByStepSolution.length > 0 && (
                    <ol className="space-y-1.5 list-decimal pl-5">
                      {aiExplanation.stepByStepSolution.map((step, index) => (
                        <li key={`${index}-${step}`} className="leading-relaxed pl-1">{step}</li>
                      ))}
                    </ol>
                  )}
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/80 border border-blue-100 p-2.5">
                      <div className="font-bold text-blue-900 mb-1">最终答案</div>
                      <div>{aiExplanation.finalAnswer}</div>
                    </div>
                    <div className="rounded-lg bg-white/80 border border-blue-100 p-2.5">
                      <div className="font-bold text-blue-900 mb-1">教学避坑</div>
                      <div>{aiExplanation.teacherTips}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setIsAnswerRevealed(true)}
                className="inline-flex items-center space-x-2 px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-bold transition cursor-pointer shadow-md"
              >
                <Eye className="w-4 h-4" />
                <span>查看答案与名师解析 (快捷键: 空格)</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 text-slate-400">
          暂无题目，请切换年级或讲次
        </div>
      )}

      {(isAiLoading || aiError) && (
        <div
          aria-live="assertive"
          role="status"
          className={`fixed left-3 right-3 bottom-24 z-50 sm:hidden rounded-2xl px-4 py-3 shadow-xl border flex items-center gap-3 text-xs font-bold ${
            aiError
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-purple-700 border-purple-500 text-white'
          }`}
        >
          {aiError ? <Bot className="w-5 h-5 shrink-0" /> : <LoaderCircle className="w-5 h-5 animate-spin shrink-0" />}
          <span className="min-w-0 flex-1">
            {aiError ? `解析失败：${aiError}` : '正在读题、核对答案并分步验算…'}
          </span>
          {aiError && (
            <button
              type="button"
              onClick={handleFetchAi}
              className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-rose-700 border border-rose-200"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* Fixed Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 sm:p-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
          <button
            type="button"
            disabled={!currentQ || (isRandomMode ? randomCursor === 0 : visibleQuestionIndex === 0)}
            onClick={handlePrev}
            className="p-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700 rounded-2xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">上一题</span>
          </button>

          {/* Low-cost AI tutor */}
          <button
            type="button"
            disabled={isAiLoading || !currentQ}
            onClick={handleFetchAi}
            aria-label={isAiLoading ? '智能精讲正在解析' : '打开智能分步精讲'}
            className="w-12 h-12 p-0 sm:w-auto sm:h-auto sm:px-4 sm:py-3 bg-purple-50 hover:bg-purple-100 disabled:bg-purple-100 text-purple-700 rounded-2xl text-xs font-bold transition flex items-center justify-center sm:space-x-1.5 cursor-pointer disabled:cursor-wait shrink-0 border border-purple-200"
          >
            {isAiLoading ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Bot className="w-5 h-5" />}
            <span className="hidden sm:inline">{isAiLoading ? '解析中…' : aiExplanation ? '查看精讲' : '智能精讲'}</span>
          </button>

          {/* Mark Actions */}
          <div className="flex items-center space-x-2 flex-1 justify-center max-w-md">
            <button
              type="button"
              disabled={!currentQ || committedQuestionId === currentQ.id}
              onClick={() => handleMark(false)}
              className="flex-1 py-3.5 bg-rose-50 hover:bg-rose-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed text-rose-700 active:bg-rose-200 rounded-2xl text-xs sm:text-sm font-black transition flex items-center justify-center space-x-1.5 border border-rose-200 shadow-xs cursor-pointer"
            >
              <X className="w-4 h-4 text-rose-600" />
              <span>✘ 没做对 (重练)</span>
            </button>

            <button
              type="button"
              disabled={!currentQ || committedQuestionId === currentQ.id}
              onClick={() => handleMark(true)}
              className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed active:bg-emerald-800 text-white rounded-2xl text-xs sm:text-sm font-black transition flex items-center justify-center space-x-1.5 shadow-md cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>✔ 做对了 (下一题)</span>
            </button>
          </div>

          <button
            type="button"
            disabled={!currentQ || (isRandomMode ? filteredQuestions.length <= 1 : visibleQuestionIndex >= filteredQuestions.length - 1)}
            onClick={handleNext}
            className="p-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700 rounded-2xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer shrink-0"
          >
            <span className="hidden sm:inline">{isRandomMode ? '随机下一题' : '下一题'}</span>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Full-Screen Lightbox Image Viewer */}
      {lightboxImg && (
        <ImageLightboxModal
          isOpen={true}
          imageUrl={lightboxImg.url}
          title={lightboxImg.title}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
};
