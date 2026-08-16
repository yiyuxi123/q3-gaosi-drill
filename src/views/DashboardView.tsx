import React, { useEffect, useState } from 'react';
import { 
  Calendar, 
  Target, 
  Flame, 
  TrendingUp, 
  BookOpen, 
  FileText, 
  ArrowRight, 
  Sliders, 
  ChevronRight,
  PieChart,
  Megaphone,
  Quote,
  RefreshCw
} from 'lucide-react';
import type { 
  UserSummary, 
  Question, 
  Chapter, 
  MathModule, 
  ExamPlanConfig,
  TeamAnnouncement 
} from '../types';
import { formatExamDate } from '../services/examPlan';
import { getAvailableQuestionModules } from '../services/practiceSession';
import { MATH_QUOTES } from '../data/mathQuotes';
import { getNextQuoteIndex } from '../services/mathQuoteRotation';

interface DashboardViewProps {
  userSummary: UserSummary;
  allQuestions: Question[];
  chapters: Chapter[];
  daysRemaining: number;
  onNavigateTab: (tab: string, filterParams?: { chapterId?: string; questionId?: string; module?: MathModule }) => void;
  examPlan: ExamPlanConfig;
  onUpdateExamPlan: (plan: ExamPlanConfig) => boolean;
  announcements: TeamAnnouncement[];
  userRecords: Record<string, any>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  userSummary,
  allQuestions,
  chapters,
  daysRemaining,
  onNavigateTab,
  examPlan,
  onUpdateExamPlan,
  announcements,
  userRecords
}) => {
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [tempPlan, setTempPlan] = useState<ExamPlanConfig>(examPlan);
  const [planSaveError, setPlanSaveError] = useState('');
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * MATH_QUOTES.length));

  // Cloud sync can replace the plan after this view mounts. Keep the draft in
  // step while closed, but never overwrite edits in an open dialog.
  useEffect(() => {
    if (!isPlanModalOpen) setTempPlan(examPlan);
  }, [examPlan, isPlanModalOpen]);

  const moduleOrder: MathModule[] = ['计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学'];
  const modulesList = getAvailableQuestionModules(allQuestions, moduleOrder);

  const currentQuote = MATH_QUOTES[quoteIndex];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteIndex(previous => getNextQuoteIndex(MATH_QUOTES.length, previous));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Module statistics
  const moduleStats = modulesList.map((mod) => {
    const modQuestions = allQuestions.filter(q => q.module === mod);
    const solvedInMod = modQuestions.filter(q => !!userRecords[q.id]);
    const correctInMod = modQuestions.filter(q => userRecords[q.id]?.status === 'correct');
    
    return {
      module: mod,
      total: modQuestions.length,
      solved: solvedInMod.length,
      correct: correctInMod.length,
      completionRate: modQuestions.length > 0 ? Math.round((solvedInMod.length / modQuestions.length) * 100) : 0,
      accuracyRate: solvedInMod.length > 0 ? Math.round((correctInMod.length / solvedInMod.length) * 100) : 0
    };
  });

  const handleSavePlan = () => {
    setPlanSaveError('');
    if (!onUpdateExamPlan(tempPlan)) {
      setPlanSaveError(userSummary.username === 'guest'
        ? '请先登录账号，再保存个人备考计划。'
        : '计划没有保存成功，请按页面顶部提示处理后重试。');
      return;
    }
    setIsPlanModalOpen(false);
  };

  const remainingQuestions = Math.max(0, allQuestions.length - userSummary.solved_count);
  const dailyRemainingTarget = Math.ceil(remainingQuestions / Math.max(1, daysRemaining));

  // Streak title
  const getStreakTitle = (days: number) => {
    if (days >= 15) return '卓越考神 👑';
    if (days >= 7) return '奥数宗师 🌟';
    if (days >= 3) return '初露锋芒 ⚡';
    return '备考新秀 🌱';
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Pinned Announcements */}
      {announcements.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl shrink-0 border border-blue-100">
              <Megaphone className="w-4 h-4" />
            </div>
            <div className="flex-1 text-xs">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-slate-800">{announcements[0].title}</span>
                <span className="text-[10px] text-slate-400">{announcements[0].created_at}</span>
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                {announcements[0].content}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fresh Clean Hero Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 bg-slate-100 rounded-full text-xs font-semibold text-slate-700 mb-3 border border-slate-200">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              <span>{formatExamDate(examPlan.exam_date)} 统考</span>
              <span className="w-1 h-1 bg-slate-300 rounded-full" />
              <span className="text-blue-600 font-bold">倒计时 {daysRemaining} 天</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 m-0 flex items-center space-x-2">
              <span>欢迎回来，{userSummary.real_name} 老师</span>
              <span className="text-xs font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                {getStreakTitle(userSummary.streak_days)}
              </span>
            </h1>

            {/* Daily Quote Easter Egg */}
            <div className="flex items-start gap-2 text-xs text-slate-600 mt-2.5 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <Quote className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed" aria-live="polite">
                <span>“{currentQuote.text}”</span>
                <em className="text-slate-400 font-normal ml-1">—— {currentQuote.author}</em>
                <span className="ml-2 text-[10px] text-slate-400">数学名言库 {MATH_QUOTES.length} 条</span>
              </div>
              <button
                type="button"
                onClick={() => setQuoteIndex(previous => getNextQuoteIndex(MATH_QUOTES.length, previous))}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-blue-600 cursor-pointer"
                title="随机换一句数学名言"
                aria-label="随机换一句数学名言"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0">
            <button
              onClick={() => onNavigateTab('card_drill')}
              className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
              <span>进入章节顺序刷题</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onNavigateTab('paper')}
              className="flex items-center justify-center space-x-2 bg-slate-50 hover:bg-slate-100 text-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs border border-slate-200 transition cursor-pointer"
            >
              <FileText className="w-4 h-4 text-slate-500" />
              <span>自由组卷与 A4 打印</span>
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-100">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>总已刷题数</span>
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold mt-1 text-slate-900">
              {userSummary.solved_count} <span className="text-xs font-normal text-slate-400">/ {allQuestions.length}</span>
            </div>
            <div className="text-[11px] text-blue-600 mt-0.5 font-medium">
              完成率 {userSummary.completion_rate}%
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>综合正确率</span>
              <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold mt-1 text-emerald-600">
              {userSummary.accuracy_rate}%
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              对 {userSummary.correct_count} 题 · 错 {userSummary.wrong_count} 题
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>每日建议量</span>
              <Target className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold mt-1 text-slate-900">
              {dailyRemainingTarget} <span className="text-xs font-normal text-slate-400">题/天</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              按时刷完全库
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>连续打卡</span>
              <Flame className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold mt-1 text-amber-600">
              {userSummary.streak_days} <span className="text-xs font-normal text-slate-400">天</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              保持备战节奏
            </div>
          </div>
        </div>
      </div>

      {/* 7 Modules Map */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2 m-0">
              <PieChart className="w-5 h-5 text-blue-600" />
              <span>奥数 {moduleStats.length} 大核心模块掌握度</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              点击任意模块直接切入对应专题练习
            </p>
          </div>
          <button
            onClick={() => {
              setPlanSaveError('');
              setIsPlanModalOpen(true);
            }}
            className="text-xs font-bold text-slate-600 hover:text-blue-600 flex items-center space-x-1 bg-slate-100 px-3 py-1.5 rounded-xl transition cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>调整计划</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {moduleStats.map((item) => (
            <div 
              key={item.module}
              onClick={() => onNavigateTab('card_drill', { module: item.module })}
              className="p-4 rounded-2xl border border-slate-200 hover:border-blue-500 hover:bg-slate-50/50 transition cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  <span className="text-xs font-bold text-slate-800">{item.module}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  {item.solved} / {item.total} 题
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
                <div 
                  className="bg-blue-600 h-full rounded-full transition-all"
                  style={{ width: `${item.completionRate}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 font-medium">
                <span>完成率: <strong className="text-slate-700">{item.completionRate}%</strong></span>
                <span>正确率: <strong className="text-emerald-600">{item.accuracyRate}%</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chapters Preview */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2 m-0">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <span>高斯导引 15 讲章节导航</span>
          </h2>
          <button 
            onClick={() => onNavigateTab('card_drill')} 
            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center space-x-1 cursor-pointer"
          >
            <span>进入全部章节</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {chapters.slice(0, 6).map((ch) => {
            const chQuestions = allQuestions.filter(q => q.chapter_id === ch.id);
            const solvedCount = chQuestions.filter(q => !!userRecords[q.id]).length;
            const percent = chQuestions.length > 0 ? Math.round((solvedCount / chQuestions.length) * 100) : 0;

            return (
              <div
                key={ch.id}
                onClick={() => onNavigateTab('card_drill', { chapterId: ch.id })}
                className="p-3.5 rounded-2xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/20 transition cursor-pointer flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {ch.grade}
                    </span>
                    <span className="text-xs font-bold text-slate-800 line-clamp-1">
                      第{ch.chapter_num}讲 {ch.title}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {ch.module} · {ch.total_questions} 题
                  </div>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <div className="text-xs font-bold text-blue-600">{percent}%</div>
                  <div className="text-[10px] text-slate-400">{solvedCount}/{ch.total_questions}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Plan Config Modal */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
                <Sliders className="w-4 h-4 text-blue-600" />
                <span>备考计划设置</span>
              </h3>
              <button onClick={() => setIsPlanModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">备考推进策略</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'balanced', label: '稳扎稳打', desc: '各模块均衡' },
                  { id: 'module_focus', label: '模块攻坚', desc: '突破弱项' },
                  { id: 'rush', label: '考前冲刺', desc: '重点攻坚' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setTempPlan({ ...tempPlan, mode: m.id as any })}
                    className={`p-2.5 rounded-xl border text-center transition cursor-pointer ${
                      tempPlan.mode === m.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <div className="text-xs">{m.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {tempPlan.mode === 'module_focus' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">优先攻坚模块</label>
                <select
                  value={tempPlan.focus_module}
                  onChange={(e) => setTempPlan({ ...tempPlan, focus_module: e.target.value as MathModule })}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-white"
                >
                  {modulesList.map((m) => (
                    <option key={m} value={m}>{m} 模块</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>每日刷题目标</span>
                <span className="text-blue-600 font-bold">{tempPlan.daily_target} 题/天</span>
              </label>
              <input
                type="range"
                min="5"
                max="30"
                step="1"
                value={tempPlan.daily_target}
                onChange={(e) => setTempPlan({ ...tempPlan, daily_target: parseInt(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            {planSaveError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                {planSaveError}
              </div>
            )}

            <div className="pt-2 flex space-x-2">
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSavePlan}
                className="flex-1 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs cursor-pointer"
              >
                保存计划
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
