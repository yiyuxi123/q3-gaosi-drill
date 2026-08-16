import type { AnswerStatus, MathModule, Question } from '../types';

export interface DrillFilter {
  chapterId?: string;
  questionId?: string;
  module?: MathModule;
}

export type DrillKeyboardAction =
  | 'submit_answer'
  | 'toggle_answer'
  | 'next'
  | 'previous'
  | 'mark_wrong'
  | 'mark_correct';

export interface DrillKeyboardContext {
  key: string;
  targetTagName?: string;
  targetIsContentEditable?: boolean;
  isAnswerInput?: boolean;
  hasOpenDialog?: boolean;
}

/**
 * Resolve a card-drill shortcut without stealing keys from forms or dialogs.
 * Login/password dialogs can remain mounted over the drill page, so handling
 * every window keydown would otherwise prevent their Enter-to-submit action.
 */
export const getDrillKeyboardAction = ({
  key,
  targetTagName = '',
  targetIsContentEditable = false,
  isAnswerInput = false,
  hasOpenDialog = false
}: DrillKeyboardContext): DrillKeyboardAction | null => {
  if (hasOpenDialog) return null;

  const normalizedTag = targetTagName.toUpperCase();
  const isInteractiveTarget = targetIsContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(normalizedTag);
  if (isInteractiveTarget) {
    return isAnswerInput && key === 'Enter' ? 'submit_answer' : null;
  }

  if (key === ' ' || key === 'Enter') return 'toggle_answer';
  if (key === 'ArrowRight' || key === 'PageDown') return 'next';
  if (key === 'ArrowLeft' || key === 'PageUp') return 'previous';
  if (key === '1') return 'mark_wrong';
  if (key === '2') return 'mark_correct';
  return null;
};

export const getNextDrillFilter = (
  currentFilter: DrillFilter | undefined,
  destinationTab: string,
  requestedFilter?: DrillFilter
): DrillFilter | undefined => (
  destinationTab === 'card_drill' ? requestedFilter : currentFilter
);

export interface DrillQuestionSelection {
  grade: string;
  chapterId: string;
  section: string;
  module?: MathModule | null;
}

export const filterDrillQuestions = (
  questions: Question[],
  selection: DrillQuestionSelection
): Question[] => questions.filter(question => {
  if (selection.grade !== '全部' && question.grade !== selection.grade) return false;
  if (selection.module) {
    if (question.module !== selection.module) return false;
  } else if (selection.chapterId && question.chapter_id !== selection.chapterId) {
    return false;
  }
  if (selection.section !== '全部' && question.section !== selection.section) return false;
  return true;
});

export const getAvailableQuestionModules = (
  questions: Question[],
  preferredOrder: MathModule[]
): MathModule[] => {
  const available = new Set(questions.map(question => question.module));
  return preferredOrder.filter(module => available.has(module));
};

export const clampQuestionIndex = (index: number, questionCount: number): number => {
  if (questionCount <= 0) return 0;
  return Math.min(Math.max(0, index), questionCount - 1);
};

/** Pick another question uniformly without immediately repeating the current one. */
export const getRandomQuestionIndex = (
  questionIds: string[],
  currentIndex: number,
  strategy: 'uniform' | 'unseen_first' | 'wrong_first' = 'uniform',
  recordStatuses: Record<string, AnswerStatus | undefined> = {},
  random: () => number = Math.random
): number => {
  const questionCount = questionIds.length;
  if (questionCount <= 1) return clampQuestionIndex(currentIndex, questionCount);
  const safeCurrentIndex = clampQuestionIndex(currentIndex, questionCount);
  const allOtherIndexes = questionIds
    .map((_, index) => index)
    .filter(index => index !== safeCurrentIndex);
  let candidates = allOtherIndexes;
  if (strategy === 'wrong_first') {
    const wrong = allOtherIndexes.filter(index => recordStatuses[questionIds[index]] === 'wrong');
    const unseen = allOtherIndexes.filter(index => !recordStatuses[questionIds[index]]);
    candidates = wrong.length > 0 ? wrong : unseen.length > 0 ? unseen : allOtherIndexes;
  } else if (strategy === 'unseen_first') {
    const unseen = allOtherIndexes.filter(index => !recordStatuses[questionIds[index]]);
    candidates = unseen.length > 0 ? unseen : allOtherIndexes;
  }
  const randomValue = Math.min(Math.max(random(), 0), 0.9999999999999999);
  return candidates[Math.floor(randomValue * candidates.length)];
};

export const getNextQuestionIdAfterCommit = (
  questionIds: string[],
  currentQuestionId: string
): string | null => {
  if (questionIds.length <= 1) return null;
  const currentIndex = questionIds.indexOf(currentQuestionId);
  if (currentIndex < 0) return questionIds[0] || null;
  return questionIds[(currentIndex + 1) % questionIds.length] || null;
};

export interface SubmissionLock {
  tryLock: () => boolean;
  release: () => void;
  reset: () => void;
  isLocked: () => boolean;
}

export const createSubmissionLock = (): SubmissionLock => {
  let locked = false;

  return {
    tryLock() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    reset() {
      locked = false;
    },
    isLocked() {
      return locked;
    }
  };
};

export interface LatestCallbackTimer {
  schedule: (callback: () => void, delayMs: number) => void;
  clear: () => void;
  isPending: () => boolean;
}

/** Keep only the latest transient UI callback, cancelling older notices. */
export const createLatestCallbackTimer = (): LatestCallbackTimer => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  return {
    schedule(callback, delayMs) {
      clear();
      timeoutId = setTimeout(() => {
        timeoutId = null;
        callback();
      }, delayMs);
    },
    clear,
    isPending() {
      return timeoutId !== null;
    }
  };
};

export interface QuestionCommitGuard {
  tryCommit: (questionId: string) => boolean;
  release: (questionId: string) => void;
  reset: () => void;
}

export const createQuestionCommitGuard = (): QuestionCommitGuard => {
  let committedQuestionId: string | null = null;

  return {
    tryCommit(questionId) {
      if (committedQuestionId === questionId) return false;
      committedQuestionId = questionId;
      return true;
    },
    release(questionId) {
      if (committedQuestionId === questionId) committedQuestionId = null;
    },
    reset() {
      committedQuestionId = null;
    }
  };
};
