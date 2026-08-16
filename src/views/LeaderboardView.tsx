import React, { useState } from 'react';
import { Trophy } from 'lucide-react';
import type { UserSummary } from '../types';
import { getAvatarInitial } from '../services/userDisplay';

interface LeaderboardViewProps {
  leaderboard: UserSummary[];
  currentUserPinyin?: string;
  currentUsername?: string;
  totalQuestions?: number;
  totalQuestionsCount?: number;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  leaderboard,
  currentUserPinyin,
  currentUsername,
  totalQuestions,
  totalQuestionsCount
}) => {
  const activeUser = currentUsername || currentUserPinyin || '';
  const totalQ = totalQuestionsCount || totalQuestions || 362;
  const [rankType, setRankType] = useState<'solved' | 'completion' | 'accuracy' | 'streak'>('solved');

  const sortedList = [...leaderboard].sort((a, b) => {
    if (rankType === 'solved') return b.solved_count - a.solved_count;
    if (rankType === 'completion') return b.completion_rate - a.completion_rate;
    if (rankType === 'accuracy') return b.accuracy_rate - a.accuracy_rate;
    if (rankType === 'streak') return b.streak_days - a.streak_days;
    return 0;
  });

  const top3 = sortedList.slice(0, 3);

  const getRankBadgeColor = (idx: number) => {
    if (idx === 0) return 'bg-amber-400 text-amber-950 ring-2 ring-amber-300';
    if (idx === 1) return 'bg-slate-300 text-slate-900 ring-2 ring-slate-200';
    if (idx === 2) return 'bg-amber-700 text-white ring-2 ring-amber-600';
    return 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900 flex items-center space-x-2 m-0">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span>教研团队备考排行榜</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              全团队无服务器多端坚果云实时云汇总 · 互相激励 · 决胜 9.18
            </p>
          </div>

          {/* Dimension Selector */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setRankType('solved')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                rankType === 'solved' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              刷题总量榜
            </button>
            <button
              onClick={() => setRankType('completion')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                rankType === 'completion' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              完成率榜
            </button>
            <button
              onClick={() => setRankType('accuracy')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                rankType === 'accuracy' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              正确率榜
            </button>
            <button
              onClick={() => setRankType('streak')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                rankType === 'streak' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              连续打卡榜
            </button>
          </div>
        </div>
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
        {/* Silver (2nd) */}
        {top3[1] && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs text-center flex flex-col items-center justify-between order-2 sm:order-1 sm:mt-6">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-slate-200 text-slate-700 flex items-center justify-center font-black text-lg mx-auto mb-2 shadow-inner">
                {getAvatarInitial(top3[1].real_name, top3[1].username)}
              </div>
              <div className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 mb-1">
                🥈 亚军 第2名
              </div>
              <h3 className="text-sm font-bold text-slate-800 m-0">{top3[1].real_name}</h3>
              <p className="text-[10px] text-slate-400 font-mono">账号: {top3[1].username}</p>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 w-full text-xs font-bold text-indigo-600">
              {rankType === 'solved' && `已刷 ${top3[1].solved_count} 题`}
              {rankType === 'completion' && `完成率 ${top3[1].completion_rate}%`}
              {rankType === 'accuracy' && `正确率 ${top3[1].accuracy_rate}%`}
              {rankType === 'streak' && `连续打卡 ${top3[1].streak_days} 天`}
            </div>
          </div>
        )}

        {/* Gold (1st) */}
        {top3[0] && (
          <div className="bg-gradient-to-b from-amber-500 to-amber-600 text-white rounded-2xl p-6 shadow-lg shadow-amber-200 text-center flex flex-col items-center justify-between order-1 sm:order-2 scale-105 z-10">
            <div>
              <div className="w-16 h-16 rounded-2xl bg-white/20 text-white flex items-center justify-center font-black text-2xl mx-auto mb-2 shadow-inner backdrop-blur-xs">
                {getAvatarInitial(top3[0].real_name, top3[0].username)}
              </div>
              <div className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-300 text-amber-950 mb-1 shadow-xs">
                👑 冠军 第1名
              </div>
              <h3 className="text-base font-bold text-white m-0">{top3[0].real_name}</h3>
              <p className="text-[11px] text-amber-100 font-mono">账号: {top3[0].username}</p>
            </div>
            <div className="mt-4 pt-3 border-t border-white/20 w-full text-sm font-black text-yellow-200">
              {rankType === 'solved' && `已刷 ${top3[0].solved_count} 题 (完成率 ${top3[0].completion_rate}%)`}
              {rankType === 'completion' && `完成率 ${top3[0].completion_rate}% (${top3[0].solved_count}/${totalQ})`}
              {rankType === 'accuracy' && `正确率 ${top3[0].accuracy_rate}% (做对 ${top3[0].correct_count} 题)`}
              {rankType === 'streak' && `连续打卡 ${top3[0].streak_days} 天`}
            </div>
          </div>
        )}

        {/* Bronze (3rd) */}
        {top3[2] && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs text-center flex flex-col items-center justify-between order-3 sm:order-3 sm:mt-8">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center font-black text-lg mx-auto mb-2 shadow-inner">
                {getAvatarInitial(top3[2].real_name, top3[2].username)}
              </div>
              <div className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 mb-1">
                🥉 季军 第3名
              </div>
              <h3 className="text-sm font-bold text-slate-800 m-0">{top3[2].real_name}</h3>
              <p className="text-[10px] text-slate-400 font-mono">账号: {top3[2].username}</p>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 w-full text-xs font-bold text-indigo-600">
              {rankType === 'solved' && `已刷 ${top3[2].solved_count} 题`}
              {rankType === 'completion' && `完成率 ${top3[2].completion_rate}%`}
              {rankType === 'accuracy' && `正确率 ${top3[2].accuracy_rate}%`}
              {rankType === 'streak' && `连续打卡 ${top3[2].streak_days} 天`}
            </div>
          </div>
        )}
      </div>

      {/* Complete Rankings Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 font-bold text-xs text-slate-700 flex items-center justify-between">
          <span>全团队排名明细表 (共 {sortedList.length} 人)</span>
          <span className="text-[11px] text-slate-400 font-normal">
            数据自动从坚果云汇总更新
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
              <tr>
                <th className="py-3 px-4 w-16 text-center">排名</th>
                <th className="py-3 px-4">同事姓名</th>
                <th className="py-3 px-4">拼音账号</th>
                <th className="py-3 px-4 text-center">已刷题量</th>
                <th className="py-3 px-4 text-center">题库完成率</th>
                <th className="py-3 px-4 text-center">正确率</th>
                <th className="py-3 px-4 text-center">连续打卡</th>
                <th className="py-3 px-4 text-right">最近活跃</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedList.map((item, idx) => {
                const isMe = item.username.toLowerCase() === activeUser.toLowerCase();
                return (
                  <tr
                    key={item.username}
                    className={`hover:bg-slate-50/80 transition ${
                      isMe ? 'bg-indigo-50/50 font-bold' : ''
                    }`}
                  >
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold text-[11px] ${getRankBadgeColor(idx)}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-slate-900">{item.real_name}</span>
                        {isMe && (
                          <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.2 rounded font-bold">
                            我
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {item.username}
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-slate-800">
                      {item.solved_count} 题
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-indigo-600 h-full rounded-full"
                            style={{ width: `${item.completion_rate}%` }}
                          />
                        </div>
                        <span className="text-slate-600">{item.completion_rate}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-emerald-600">
                      {item.accuracy_rate}%
                    </td>
                    <td className="py-3 px-4 text-center text-amber-600 font-bold">
                      🔥 {item.streak_days} 天
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] text-slate-400">
                      {item.last_active_at ? item.last_active_at.slice(0, 10) : '今日'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
