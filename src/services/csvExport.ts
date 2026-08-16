import type { UserSummary } from '../types';

function escapeCsvCell(value: string | number): string {
  let text = String(value);
  // Spreadsheet applications can execute cells beginning with these symbols.
  // Prefixing an apostrophe preserves the visible text without evaluating it.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildLeaderboardCsv(leaderboardData: UserSummary[]): string {
  const rows: Array<Array<string | number>> = [
    ['姓名', '拼音账号', '角色', '已刷题数', '正确数', '错误数', '正确率', '完成率', '连续打卡天数', '最后活跃'],
    ...leaderboardData.map(user => [
      user.real_name,
      user.username,
      user.role === 'admin' ? '管理员' : '教师',
      user.solved_count,
      user.correct_count,
      user.wrong_count,
      `${user.accuracy_rate}%`,
      `${user.completion_rate}%`,
      `${user.streak_days}天`,
      user.last_active_at ? user.last_active_at.slice(0, 10) : '未记录'
    ])
  ];
  return `\uFEFF${rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n')}`;
}
