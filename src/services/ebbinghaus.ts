import type { UserRecord } from '../types';
import { createReviewHistoryEntry, incrementPracticeCounters } from './attemptTracking';

// Ebbinghaus review intervals in days: [0, 1, 2, 4, 7, 15]
export const EBBINGHAUS_INTERVALS_DAYS = [0, 1, 2, 4, 7, 15];

export interface EbbinghausStatus {
  stage: number; // 0 to 5
  stageName: string;
  isDue: boolean;
  daysRemaining: number;
  isMastered: boolean;
  nextReviewDateStr: string;
}

export function getEbbinghausStatus(record?: UserRecord): EbbinghausStatus {
  if (!record || record.status !== 'wrong') {
    return {
      stage: 5,
      stageName: '已掌握',
      isDue: false,
      daysRemaining: 0,
      isMastered: true,
      nextReviewDateStr: '已掌握'
    };
  }

  const stage = record.ebbinghaus_stage !== undefined ? record.ebbinghaus_stage : 0;
  const isMastered = stage >= 5;

  const stageNames = [
    '第0阶段 (今日新错)',
    '第1阶段 (1天后复习)',
    '第2阶段 (2天后复习)',
    '第3阶段 (4天后复习)',
    '第4阶段 (7天后巩固)',
    '第5阶段 (彻底掌握)'
  ];

  if (isMastered) {
    return {
      stage: 5,
      stageName: '已攻克掌握',
      isDue: false,
      daysRemaining: 0,
      isMastered: true,
      nextReviewDateStr: '已达成掌握'
    };
  }

  const now = new Date().getTime();
  let nextReviewTime = now;

  if (record.next_review_at) {
    nextReviewTime = new Date(record.next_review_at).getTime();
  } else {
    // If not set, calculate based on last_attempt_at + interval
    const lastAttempt = record.last_attempt_at ? new Date(record.last_attempt_at).getTime() : now;
    const intervalDays = EBBINGHAUS_INTERVALS_DAYS[stage] || 0;
    nextReviewTime = lastAttempt + intervalDays * 24 * 60 * 60 * 1000;
  }

  const diffMs = nextReviewTime - now;
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  const isDue = diffMs <= 0 || stage === 0;

  const nextDate = new Date(nextReviewTime);
  const nextDateStr = `${nextDate.getMonth() + 1}月${nextDate.getDate()}日`;

  return {
    stage,
    stageName: stageNames[stage] || '复习中',
    isDue,
    daysRemaining: Math.max(0, diffDays),
    isMastered: false,
    nextReviewDateStr: isDue ? '今日待复习' : nextDateStr
  };
}

/**
 * Handle a review test attempt according to Ebbinghaus forgetting curve
 */
export function calculateNextEbbinghausRecord(
  prevRecord: UserRecord,
  passed: boolean,
  userNotes?: string
): UserRecord {
  const currentStage = prevRecord.ebbinghaus_stage !== undefined ? prevRecord.ebbinghaus_stage : 0;
  const now = new Date();
  const nowIso = now.toISOString();

  let nextStage = currentStage;
  if (passed) {
    // Advance to next stage
    nextStage = Math.min(5, currentStage + 1);
  } else {
    // Relapse: Drop back to stage 0 for immediate re-learning
    nextStage = 0;
  }

  const nextIntervalDays = EBBINGHAUS_INTERVALS_DAYS[nextStage] || 0;
  const nextReviewDate = new Date(now.getTime() + nextIntervalDays * 24 * 60 * 60 * 1000);

  const history = [
    ...(prevRecord.review_history || []),
    createReviewHistoryEntry(nowIso, passed)
  ];
  const counters = incrementPracticeCounters(prevRecord, passed);

  return {
    ...prevRecord,
    status: nextStage >= 5 ? 'correct' : 'wrong',
    is_mastered: nextStage >= 5,
    ebbinghaus_stage: nextStage,
    next_review_at: nextReviewDate.toISOString(),
    last_attempt_at: nowIso,
    ...counters,
    review_history: history,
    user_notes: userNotes ?? prevRecord.user_notes
  };
}

/**
 * Save a normal drill or paper attempt without accidentally enrolling a
 * first-time correct answer into the staged error-review queue.
 */
export function calculatePracticeAttemptRecord(
  prevRecord: UserRecord | undefined,
  question: Pick<UserRecord, 'question_id' | 'chapter_id'>,
  passed: boolean,
  userNotes?: string
): UserRecord {
  const nowIso = new Date().toISOString();
  const baseRecord: UserRecord = prevRecord || {
    ...question,
    status: passed ? 'correct' : 'wrong',
    attempt_count: 0,
    last_attempt_at: nowIso
  };

  // Once a question is in the error-review queue, attempts advance or reset
  // its Ebbinghaus stage. A normal first-time correct answer bypasses it.
  if (baseRecord.status === 'wrong' || !passed) {
    return calculateNextEbbinghausRecord(baseRecord, passed, userNotes);
  }

  const counters = incrementPracticeCounters(baseRecord, passed);

  return {
    ...baseRecord,
    status: 'correct',
    is_mastered: true,
    ebbinghaus_stage: 5,
    next_review_at: undefined,
    last_attempt_at: nowIso,
    ...counters,
    review_history: [
      ...(baseRecord.review_history || []),
      createReviewHistoryEntry(nowIso, passed)
    ],
    user_notes: userNotes ?? baseRecord.user_notes
  };
}

/**
 * Explicitly remove a question from the error book while retaining its full
 * learning history. This is intentionally different from advancing one review
 * stage through calculateNextEbbinghausRecord.
 */
export function markPracticeRecordMastered(
  prevRecord: UserRecord,
  question: Pick<UserRecord, 'question_id' | 'chapter_id'>
): UserRecord {
  const nowIso = new Date().toISOString();
  const notes = prevRecord.user_notes ?? prevRecord.notes;
  const counters = incrementPracticeCounters(prevRecord, true);
  return {
    ...prevRecord,
    ...question,
    status: 'correct',
    is_mastered: true,
    ebbinghaus_stage: 5,
    next_review_at: undefined,
    last_attempt_at: nowIso,
    ...counters,
    review_history: [
      ...(prevRecord.review_history || []),
      createReviewHistoryEntry(nowIso, true)
    ],
    user_notes: notes,
    notes
  };
}

export function isDueForReview(record: UserRecord): boolean {
  return getEbbinghausStatus(record).isDue;
}

export function getStageDescription(stage?: number): string {
  const s = stage || 0;
  const descs = [
    '第0阶段 (今日新错)',
    '第1阶段 (1天后复习)',
    '第2阶段 (2天后复习)',
    '第3阶段 (4天后复习)',
    '第4阶段 (7天后巩固)',
    '第5阶段 (彻底掌握)'
  ];
  return descs[s] || '复习中';
}
