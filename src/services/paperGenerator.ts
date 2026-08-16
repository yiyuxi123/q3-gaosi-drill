import type { Question, MathModule, UserRecord } from '../types';

export interface PaperFilterOptions {
  title: string;
  grades: string[];
  modules: MathModule[];
  sections: string[]; // '兴趣篇' | '拓展篇' | '超越篇'
  questionCount: number;
  totalScore: number;
  durationMinutes: number;
  onlyErrorBook: boolean;
  errorBookQuestionIds?: string[];
}

export interface GeneratedPaper {
  id: string;
  title: string;
  generatedAt: string;
  durationMinutes: number;
  totalScore: number;
  questions: Question[];
}

export function getActiveErrorBookQuestionIds(
  allQuestions: Question[],
  userRecords: Record<string, UserRecord>
): string[] {
  const activeQuestionIds = new Set(allQuestions.map(question => question.id));
  return Object.keys(userRecords).filter(questionId => (
    activeQuestionIds.has(questionId) && userRecords[questionId]?.status === 'wrong'
  ));
}

/**
 * Return a uniformly shuffled copy without mutating the source array.
 * Keeping the random source injectable makes the algorithm deterministic in tests.
 */
export function fisherYatesShuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function generateExamPaper(
  allQuestions: Question[],
  options: PaperFilterOptions
): GeneratedPaper {
  if (options.grades.length === 0) {
    throw new Error('请至少选择一个年级后再生成试卷！');
  }
  if (options.modules.length === 0) {
    throw new Error('请至少选择一个奥数模块后再生成试卷！');
  }
  if (options.sections.length === 0) {
    throw new Error('请至少选择一个篇章后再生成试卷！');
  }

  let pool = [...allQuestions];

  // Grade filter
  pool = pool.filter(q => options.grades.includes(q.grade));

  // Module filter
  pool = pool.filter(q => options.modules.includes(q.module));

  // Section filter
  pool = pool.filter(q => options.sections.includes(q.section));

  // Error book only filter
  if (options.onlyErrorBook) {
    const errorSet = new Set(options.errorBookQuestionIds || []);
    pool = pool.filter(q => errorSet.has(q.id));
  }

  if (pool.length === 0) {
    throw new Error('当前筛选条件下未找到匹配的题目，请放宽年级或模块范围！');
  }

  // Shuffle uniformly. Array.sort with a random comparator is biased and can
  // also behave differently between JavaScript engines.
  const shuffled = fisherYatesShuffle(pool);
  const requestedCount = Number.isFinite(options.questionCount)
    ? Math.max(1, Math.floor(options.questionCount))
    : 1;
  const selectedCount = Math.min(requestedCount, shuffled.length);
  const selected = shuffled.slice(0, selectedCount);

  // Distribute an integer total without ever creating a negative last score.
  // If totalScore is smaller than the question count, a few questions may be
  // worth zero points, but the paper still preserves the requested total.
  const totalScore = Number.isFinite(options.totalScore) && options.totalScore > 0
    ? Math.round(options.totalScore)
    : 100;
  const baseScore = Math.floor(totalScore / selectedCount);
  const remainder = totalScore % selectedCount;

  const questionsWithScore = selected.map((q, idx) => ({
    ...q,
    score: baseScore + (idx < remainder ? 1 : 0)
  }));

  return {
    id: `paper_${Date.now()}`,
    title: options.title || '2026 Q3 季度考全真模拟测试卷',
    generatedAt: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    durationMinutes: options.durationMinutes || 90,
    totalScore,
    questions: questionsWithScore
  };
}
