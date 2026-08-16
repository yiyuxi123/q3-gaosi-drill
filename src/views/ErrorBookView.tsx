import React, { useState } from 'react';
import { 
  Sparkles, 
  Flame, 
  CheckCircle2, 
  ChevronRight, 
  Users
} from 'lucide-react';
import type { Question, UserRecord, MathModule } from '../types';
import { getTeamErrorItems } from '../services/storage';
import { markPracticeRecordMastered } from '../services/ebbinghaus';
import { MathRenderer } from '../components/MathRenderer';

interface ErrorBookViewProps {
  allQuestions: Question[];
  userRecords: Record<string, UserRecord>;
  onSaveRecord: (record: UserRecord) => void;
  onOpenQuestionModal: (question: Question) => void;
}

export const ErrorBookView: React.FC<ErrorBookViewProps> = ({
  allQuestions,
  userRecords,
  onSaveRecord,
  onOpenQuestionModal
}) => {
  const [activeTab, setActiveTab] = useState<'personal' | 'team_top20'>('personal');
  const [selectedModule, setSelectedModule] = useState<string>('all');
  const [selectedGrade, setSelectedGrade] = useState<string>('all');

  const modulesList: (MathModule | 'all')[] = ['all', '计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学'];
  const grades = ['all', '三年级', '四年级', '五年级', '六年级'];

  // Personal error questions
  const personalErrorQuestions = allQuestions.filter((q) => {
    const rec = userRecords[q.id];
    const isWrong = rec?.status === 'wrong';
    const matchMod = selectedModule === 'all' || q.module === selectedModule;
    const matchGrade = selectedGrade === 'all' || q.grade === selectedGrade;
    return isWrong && matchMod && matchGrade;
  });

  // Team top 20 error questions
  const teamErrorItems = getTeamErrorItems(allQuestions).slice(0, 20);

  const handleMarkMastered = (q: Question) => {
    const existing = userRecords[q.id];
    if (!existing) return;
    onSaveRecord(markPracticeRecordMastered(
      existing,
      { question_id: q.id, chapter_id: q.chapter_id }
    ));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 bg-rose-50 text-rose-600 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </span>
            <h1 className="text-base font-bold text-slate-900 m-0">错题攻坚广场</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            个人专属错题本 · 团队 Top 20 高频易错题广场 · 攻克薄弱考点
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('personal')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'personal'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            我的个人错题本 ({personalErrorQuestions.length})
          </button>
          <button
            onClick={() => setActiveTab('team_top20')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center space-x-1 ${
              activeTab === 'team_top20'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-amber-500" />
            <span>全员高频易错榜</span>
          </button>
        </div>
      </div>

      {/* Personal Tab */}
      {activeTab === 'personal' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-wrap items-center gap-2">
            <div className="flex items-center space-x-1 bg-slate-50 p-1 rounded-lg border border-slate-100">
              {grades.map(g => (
                <button
                  key={g}
                  onClick={() => setSelectedGrade(g)}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                    selectedGrade === g ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {g === 'all' ? '全部年级' : g}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-1 overflow-x-auto py-1">
              {modulesList.map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModule(m)}
                  className={`px-2 py-1 rounded text-xs font-medium transition cursor-pointer shrink-0 ${
                    selectedModule === m ? 'bg-blue-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {m === 'all' ? '全部模块' : m}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          {personalErrorQuestions.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-xs space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto text-xl font-bold">
                ✓
              </div>
              <h3 className="text-sm font-bold text-slate-800">太棒了！当前筛选下暂无错题</h3>
              <p className="text-xs text-slate-500">已做试题均已攻克，请继续保持！</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {personalErrorQuestions.map((q) => (
                <div
                  key={q.id}
                  className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs hover:border-rose-300 transition flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold bg-rose-50 text-rose-700 px-2 py-0.5 rounded border border-rose-100">
                        【{q.grade}·第{q.chapter_num}讲】{q.display_title}
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {q.module} · {q.sub_module}
                      </span>
                    </div>

                    {/* Math Content */}
                    <div className="text-xs text-slate-800 leading-relaxed font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <MathRenderer content={q.content} />
                    </div>

                    {/* Solution Snippet */}
                    <div className="text-xs bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 text-emerald-900">
                      <strong>【标准答案】：</strong> {q.answer}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <button
                      onClick={() => handleMarkMastered(q)}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-200 transition cursor-pointer flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>标记已掌握 (移出错题本)</span>
                    </button>

                    <button
                      onClick={() => onOpenQuestionModal(q)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1 shadow-xs"
                    >
                      <span>重做与精讲</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Team Top 20 Tab */}
      {activeTab === 'team_top20' && (
        <div className="space-y-4">
          <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 text-xs text-amber-900 flex items-center space-x-2">
            <Flame className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              汇总全教研组错题数据，以下为全员错误率最高的 20 道经典压轴与易错题，建议重点教研教法与组卷演练。
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {teamErrorItems.map((item, idx) => (
              <div
                key={item.question_id}
                className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span className="w-5 h-5 rounded-md bg-amber-500 text-white font-bold text-[11px] flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        【{item.question.grade}·第{item.question.chapter_num}讲】{item.question.display_title}
                      </span>
                    </div>
                    <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                      错误率 {item.wrong_rate}%（{item.wrong_count}次 · {item.wrong_users.length}人）
                    </span>
                  </div>

                  <div className="text-xs text-slate-800 leading-relaxed font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <MathRenderer content={item.question.content} />
                  </div>

                  <div className="text-[11px] text-slate-500">
                    曾错教师: {item.wrong_users.join('、')}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                  <button
                    onClick={() => onOpenQuestionModal(item.question)}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1 shadow-xs"
                  >
                    <span>进入精讲与同类练</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
