const DAY_MS = 24 * 60 * 60 * 1000;

export function parseLocalExamDate(examDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return null;
  const [year, month, day] = examDate.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function calculateDaysRemaining(examDate: string, now: Date = new Date()): number {
  const target = parseLocalExamDate(examDate);
  if (!target || Number.isNaN(now.getTime())) return 0;
  const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((targetDay - currentDay) / DAY_MS));
}

export function formatExamDate(examDate: string): string {
  const target = parseLocalExamDate(examDate);
  if (!target) return examDate;
  return `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日`;
}
