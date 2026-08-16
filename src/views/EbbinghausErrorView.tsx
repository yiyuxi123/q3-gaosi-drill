import React, { useEffect, useRef, useState } from 'react';
import { 
  BrainCircuit, 
  Check, 
  X, 
  Award, 
  ChevronRight,
  Maximize2,
  FileCheck,
  Send,
  Eye
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Question, UserRecord } from '../types';
import { calculateNextEbbinghausRecord, isDueForReview, getStageDescription } from '../services/ebbinghaus';
import { verifyAnswer, getAnswerFormatHint, type AnswerCheckResult } from '../services/answerVerifier';
import { ImageLightboxModal } from '../components/ImageLightboxModal';
import { MathRenderer } from '../components/MathRenderer';
import { createQuestionCommitGuard, getNextQuestionIdAfterCommit } from '../services/practiceSession';

interface EbbinghausErrorViewProps {
  allQuestions: Question[];
  userRecords: Record<string, UserRecord>;
  onSaveRecord: (record: UserRecord) => boolean;
  onNavigateToDrill?: () => void;
}

export const EbbinghausErrorView: React.FC<EbbinghausErrorViewProps> = ({
  allQuestions,
  userRecords,
  onSaveRecord
}) => {
  const [filterMode, setFilterMode] = useState<'today_due' | 'all_errors' | 'mastered'>('today_due');
  const [selectedGrade, setSelectedGrade] = useState<string>('全部');
  const [selectedQId, setSelectedQId] = useState<string | null>(null);
  const [isAnsRevealed, setIsAnsRevealed] = useState<boolean>(false);
  const [userAnswerInput, setUserAnswerInput] = useState<string>('');
  const [checkResult, setCheckResult] = useState<AnswerCheckResult | null>(null);
  const [checkedQuestionId, setCheckedQuestionId] = useState<string | null>(null);
  const [lastReviewNotice, setLastReviewNotice] = useState<{
    title: string;
    message: string;
    passed: boolean;
  } | null>(null);
  const [lightboxImg, setLightboxImg] = useState<{ url: string; title: string } | null>(null);
  const commitGuardRef = useRef(createQuestionCommitGuard());
  const [committedQuestionId, setCommittedQuestionId] = useState<string | null>(null);

  const errorList = Object.values(userRecords)
    .filter(rec => rec.status === 'wrong' || (rec.ebbinghaus_stage !== undefined && rec.ebbinghaus_stage > 0) || rec.is_mastered)
    .map(rec => {
      const q = allQuestions.find(item => item.id === rec.question_id);
      return { record: rec, question: q };
    })
    .filter(item => item.question !== undefined);

  const todayDueList = errorList.filter(item => isDueForReview(item.record));
  const masteredList = errorList.filter(item => item.record.is_mastered || (item.record.ebbinghaus_stage !== undefined && item.record.ebbinghaus_stage >= 5));
  const activeErrorList = errorList.filter(item => !item.record.is_mastered && (item.record.ebbinghaus_stage === undefined || item.record.ebbinghaus_stage < 5));

  const currentDisplayList = (
    filterMode === 'today_due' 
      ? todayDueList 
      : filterMode === 'mastered' 
        ? masteredList 
        : activeErrorList
  ).filter(item => {
    if (selectedGrade !== '全部' && item.question?.grade !== selectedGrade) return false;
    return true;
  });

  const activeItem = currentDisplayList.find(item => item.question?.id === selectedQId) || currentDisplayList[0];
  const activeQuestionId = activeItem?.question?.id;

  useEffect(() => {
    setIsAnsRevealed(false);
    setUserAnswerInput('');
    setCheckResult(null);
    setCheckedQuestionId(null);
    commitGuardRef.current.reset();
    setCommittedQuestionId(null);
  }, [activeQuestionId]);

  const handleReviewMark = (passed: boolean, resultToShow?: AnswerCheckResult) => {
    if (!activeItem || !activeItem.question) return;
    if (!commitGuardRef.current.tryCommit(activeItem.question.id)) return;

    const nextRec = calculateNextEbbinghausRecord(activeItem.record, passed);
    if (!onSaveRecord(nextRec)) {
      commitGuardRef.current.release(activeItem.question.id);
      return;
    }
    setCommittedQuestionId(activeItem.question.id);

    if (passed) {
      confetti({
        particleCount: 35,
        spread: 50,
        origin: { y: 0.8 }
      });
    }

    setIsAnsRevealed(Boolean(resultToShow && !passed));
    setUserAnswerInput('');
    setCheckResult(resultToShow || null);
    setCheckedQuestionId(resultToShow ? activeItem.question.id : null);
    setLastReviewNotice({
      title: activeItem.question.display_title,
      message: resultToShow?.feedback || (passed
        ? '复习结果已记录，并已安排下一阶段复习。'
        : '已记录为仍需强化，本题会重新进入复习计划。'),
      passed
    });
    setSelectedQId(getNextQuestionIdAfterCommit(
      currentDisplayList.map(item => item.question!.id),
      activeItem.question.id
    ));
  };

  const handleCheckAnswer = () => {
    if (!activeItem || !activeItem.question || !userAnswerInput.trim()) return;

    const res = verifyAnswer(userAnswerInput, activeItem.question.answer);
    setCheckResult(res);
    setCheckedQuestionId(activeItem.question.id);

    if (!res.isGradable) {
      setIsAnsRevealed(true);
      return;
    }

    if (res.isCorrect) {
      handleReviewMark(true, res);
    } else {
      handleReviewMark(false, res);
    }
  };

  const grades = ['全部', '三年级', '四年级', '五年级', '六年级'];

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24 animate-in fade-in">
      {/* Top Header Card */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2.5 bg-purple-100 text-purple-700 rounded-2xl">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900">艾宾浩斯抗遗忘错题精练</h2>
              <p className="text-xs text-slate-500 font-medium">依据 1-2-4-7-15 天科学遗忘曲线动态调度错题</p>
            </div>
          </div>

          {/* Tab Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => { setFilterMode('today_due'); setSelectedQId(null); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterMode === 'today_due' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              🔔 今日待复习 ({todayDueList.length})
            </button>
            <button
              type="button"
              onClick={() => { setFilterMode('all_errors'); setSelectedQId(null); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterMode === 'all_errors' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              📚 全部错题 ({activeErrorList.length})
            </button>
            <button
              type="button"
              onClick={() => { setFilterMode('mastered'); setSelectedQId(null); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterMode === 'mastered' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              🏆 已斩获 ({masteredList.length})
            </button>
          </div>
        </div>

        {/* Grade Filter */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 no-scrollbar pt-1 border-t border-slate-100">
          <span className="text-xs font-bold text-slate-400 shrink-0 mr-1">年级:</span>
          {grades.map(g => (
            <button
              key={g}
              type="button"
              onClick={() => { setSelectedGrade(g); setSelectedQId(null); }}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                selectedGrade === g ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {lastReviewNotice && (
        <div className={`flex items-center justify-between gap-3 rounded-2xl border p-3 text-xs font-bold ${
          lastReviewNotice.passed
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}>
          <span>{lastReviewNotice.title}：{lastReviewNotice.message}</span>
          <button
            type="button"
            onClick={() => setLastReviewNotice(null)}
            className="shrink-0 rounded-lg px-2 py-1 hover:bg-white/70"
          >
            关闭
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {currentDisplayList.length > 0 && activeItem && activeItem.question ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Left Column: Error Question Queue */}
          <div className="md:col-span-1 bg-white rounded-3xl p-3 sm:p-4 border border-slate-200 shadow-sm max-h-[600px] overflow-y-auto space-y-2">
            <div className="text-xs font-bold text-slate-400 px-2 pb-1">
              错题队列 ({currentDisplayList.length} 题)
            </div>
            {currentDisplayList.map((item, idx) => {
              const q = item.question!;
              const isSelected = q.id === (selectedQId || activeItem.question?.id);
              return (
                <div
                  key={q.id}
                  onClick={() => {
                    setSelectedQId(q.id);
                    setIsAnsRevealed(false);
                    setUserAnswerInput('');
                    setCheckResult(null);
                  }}
                  className={`p-3 rounded-2xl border text-xs cursor-pointer transition flex items-center justify-between ${
                    isSelected 
                      ? 'bg-purple-50 border-purple-300 text-purple-950 font-bold shadow-xs' 
                      : 'bg-slate-50/70 border-slate-200/70 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="truncate mr-2">
                    <div className="truncate">{idx + 1}. {q.chapter_title}</div>
                    <div className="text-[10px] text-slate-400 font-normal">{q.short_title} · {getStageDescription(item.record.ebbinghaus_stage)}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
              );
            })}
          </div>

          {/* Right Column: Review Practice Workspace */}
          <div className="md:col-span-2 bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-md space-y-4">
            {/* Title & Ebbinghaus Badge */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 bg-purple-100 text-purple-800 text-xs font-black rounded-lg">
                  {activeItem.question.grade}
                </span>
                <span className="text-xs sm:text-sm font-bold text-slate-900">
                  {activeItem.question.chapter_title} · {activeItem.question.short_title}
                </span>
              </div>
              <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold rounded-xl">
                第 {activeItem.record.ebbinghaus_stage || 0} 阶段 · {getStageDescription(activeItem.record.ebbinghaus_stage)}
              </span>
            </div>

            {/* Question Text */}
            <div className="text-sm text-slate-800 font-medium bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <MathRenderer content={activeItem.question.content} />
            </div>

            {/* Question Crop Diagram (Click to Zoom Lightbox) */}
            {activeItem.question.q_slice_url && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 px-1">
                  <span>原书单题切片与图示 (点击放大):</span>
                  <span className="text-purple-600 flex items-center space-x-1 cursor-pointer">
                    <Maximize2 className="w-3 h-3" />
                    <span>全屏放大</span>
                  </span>
                </div>
                <div
                  onClick={() => setLightboxImg({ url: activeItem.question!.q_slice_url!, title: activeItem.question!.display_title })}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-center overflow-hidden cursor-zoom-in hover:border-purple-300 transition"
                >
                  <img 
                    src={activeItem.question.q_slice_url} 
                    alt="题目精准切片" 
                    className="max-h-60 rounded-xl mx-auto object-contain"
                  />
                </div>
              </div>
            )}

            {/* Answer Input & Verification */}
            <div className="p-3.5 bg-purple-50/60 rounded-2xl border border-purple-100 space-y-2">
              <div className="text-xs text-purple-900 font-bold">
                ✍️ 复习答题验算 ({getAnswerFormatHint(activeItem.question.answer)})
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={userAnswerInput}
                  onChange={(e) => setUserAnswerInput(e.target.value)}
                  disabled={committedQuestionId === activeItem.question.id}
                  placeholder="输入答案数值后点击判分"
                  className="flex-1 p-2.5 text-xs font-bold rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:border-purple-600"
                />
                <button
                  type="button"
                  disabled={committedQuestionId === activeItem.question.id}
                  onClick={handleCheckAnswer}
                  className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center space-x-1 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>判分</span>
                </button>
              </div>

              {checkResult && checkedQuestionId === activeItem.question.id && (
                <div className={`p-2.5 rounded-xl text-xs font-bold animate-in fade-in ${
                  !checkResult.isGradable
                    ? 'bg-amber-100 text-amber-900'
                    : checkResult.isCorrect
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                }`}>
                  {checkResult.feedback}
                </div>
              )}
            </div>

            {/* Answer & Explanation Reveal */}
            {isAnsRevealed ? (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center space-x-1 text-xs font-bold text-slate-800">
                    <FileCheck className="w-4 h-4 text-emerald-600" />
                    <span>官方原版答案与精解</span>
                  </div>
                  <span className="px-2.5 py-0.5 bg-emerald-600 text-white rounded-md text-xs font-mono font-bold">
                    答案: {activeItem.question.answer}
                  </span>
                </div>

                {activeItem.question.ans_slice_url && (
                  <div 
                    onClick={() => setLightboxImg({ url: activeItem.question!.ans_slice_url!, title: `${activeItem.question!.display_title} · 答案解析` })}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-center overflow-hidden cursor-zoom-in hover:border-emerald-300 transition"
                  >
                    <img 
                      src={activeItem.question.ans_slice_url} 
                      alt="解析切片" 
                      className="max-h-56 rounded-lg mx-auto object-contain"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setIsAnsRevealed(true)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer inline-flex items-center space-x-1.5 shadow-sm"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>查看官方答案解析</span>
                </button>
              </div>
            )}

            {/* Bottom Pass/Fail Action */}
            {committedQuestionId === activeItem.question.id && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600">
                本轮复习结果已保存，为避免重复计数，本题操作已锁定。
                {currentDisplayList.length > 1 ? ' 请从左侧切换其他题。' : ' 当前队列暂无其他题目。'}
              </div>
            )}
            <div className="flex items-center space-x-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={committedQuestionId === activeItem.question.id}
                onClick={() => handleReviewMark(false)}
                className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed text-rose-700 font-black rounded-2xl text-xs sm:text-sm border border-rose-200 transition flex items-center justify-center space-x-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>仍需强化 (降级重练)</span>
              </button>
              <button
                type="button"
                disabled={committedQuestionId === activeItem.question.id}
                onClick={() => handleReviewMark(true)}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black rounded-2xl text-xs sm:text-sm transition flex items-center justify-center space-x-1 shadow-md cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>已完全掌握 (晋级)</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 text-slate-400 space-y-2">
          <Award className="w-12 h-12 mx-auto text-emerald-400" />
          <p className="font-bold text-slate-700 text-sm">今日无待复习错题，太棒了！</p>
          <p className="text-xs text-slate-400">已严格按照艾宾浩斯周期完成全部强化训练</p>
        </div>
      )}

      {/* Lightbox Modal */}
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
