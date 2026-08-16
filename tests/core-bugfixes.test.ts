import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAutoGradableAnswer, verifyAnswer } from '../src/services/answerVerifier';
import { calculateNextEbbinghausRecord, calculatePracticeAttemptRecord, markPracticeRecordMastered } from '../src/services/ebbinghaus';
import { fisherYatesShuffle, generateExamPaper, getActiveErrorBookQuestionIds, type PaperFilterOptions } from '../src/services/paperGenerator';
import { addTeamMember, authenticateUser, batchSaveUserRecords, calculateConsecutiveActiveDays, calculateUserProgress, changeCurrentUserPassword, clearPendingDeletedUsernames, createAnnouncementId, deleteTeamMember, getAnnouncements, getCurrentUser, getDefaultPasswordForMember, getExamPlan, getPendingDeletedUsernames, getRecoverableDeletedMembers, getTeamErrorItems, getTeamMemberMutations, getTeamMembers, getUserRecords, isSyncRefreshForCurrentSession, restoreTeamMember, setUserPassword, tryLocalPersistence, updateTeamMember } from '../src/services/storage';
import { applyTeamMemberMutations, DEFAULT_SYNC_CONFIG, fetchWithSyncTimeout, getSyncConfig, markRemoteUserDataDeleted, mergeAnnouncements, mergeExamPlans, mergeTeamMemberMutations, mergeTeamMembers, mergeUserRecords, pullCloudData, pullSharedTeamData, queuePushToCloud } from '../src/services/webdav';
import { createPasswordCredential } from '../src/services/passwordCredential';
import { buildTutorPrompt, fetchWithAiTimeout, getAiProblemExplanation, parseAiExplanationResponse, shouldUseVision } from '../src/services/aiTutor';
import { calculateDaysRemaining, formatExamDate } from '../src/services/examPlan';
import { calculatePdfPageOffsets, PAPER_EXPORT_ROOT_ID, requirePaperExportRoot, sanitizeDownloadFilename } from '../src/services/pdfExport';
import { loadQuestionBank } from '../src/services/questionBank';
import { buildLeaderboardCsv } from '../src/services/csvExport';
import { copyTextToClipboard } from '../src/services/clipboard';
import { clampQuestionIndex, createLatestCallbackTimer, createQuestionCommitGuard, createSubmissionLock, filterDrillQuestions, getAvailableQuestionModules, getDrillKeyboardAction, getNextDrillFilter, getNextQuestionIdAfterCommit, getRandomQuestionIndex } from '../src/services/practiceSession';
import { calculateContinuousImageSize, calculateLongImageSize, paginatePaperBlocks } from '../src/services/paperPageRenderer';
import { getNextQuoteIndex } from '../src/services/mathQuoteRotation';
import { MATH_QUOTES } from '../src/data/mathQuotes';
import { getAvatarInitial } from '../src/services/userDisplay';
import { deliverFiles } from '../src/services/fileDelivery';
import type { Chapter, Question, UserRecord } from '../src/types';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    chapter_id: '三年级_11',
    grade: '三年级',
    grade_num: 3,
    chapter_num: 11,
    chapter_title: '第11讲',
    module: '应用题',
    sub_module: '盈亏问题',
    section: '兴趣篇',
    section_num: 1,
    global_chapter_num: 11,
    display_title: '测试题',
    short_title: '测试题',
    difficulty: 2,
    difficulty_stars: '★',
    score: 10,
    content: '测试内容',
    answer: '1/2',
    explanation: '测试解析',
    q_page_url: '',
    q_page_num: 0,
    ans_page_url: '',
    ans_page_num: 0,
    all_q_pages: [],
    all_ans_pages: [],
    tags: [],
    ...overrides
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: '三年级_11',
    grade: '三年级',
    grade_num: 3,
    chapter_num: 11,
    title: '第11讲',
    module: '应用题',
    sub_module: '盈亏问题',
    difficulty: 2,
    total_questions: 1,
    sections: [],
    q_pages: [],
    ans_pages: [],
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local persistence failures', () => {
  it('returns read-safe defaults when browser storage access is blocked', () => {
    const blockedStorage = {
      getItem: () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); },
      setItem: () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); },
      removeItem: () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); },
      clear: () => undefined,
      key: () => null,
      length: 0
    };
    vi.stubGlobal('localStorage', blockedStorage);

    expect(getCurrentUser()).toBeNull();
    expect(getUserRecords('blocked')).toEqual({});
    expect(getExamPlan('blocked')).toMatchObject({ daily_target: 10, exam_date: '2026-09-18' });
    const fallbackMembers = getTeamMembers();
    expect(fallbackMembers.some(member => member.username === 'admin')).toBe(true);
    fallbackMembers.splice(0, fallbackMembers.length);
    expect(getTeamMembers().some(member => member.username === 'admin')).toBe(true);
    expect(getSyncConfig()).toMatchObject({ sync_status: 'idle' });
  });

  it('turns quota exceptions into a retryable failed-save result', () => {
    const data = new Map<string, string>();
    const quotaError = Object.assign(new Error('quota full'), { name: 'QuotaExceededError' });
    const quotaStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: () => { throw quotaError; },
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', quotaStorage);

    const saved = tryLocalPersistence(() => batchSaveUserRecords('quota', [{
      question_id: 'q1',
      status: 'correct',
      attempt_count: 1,
      last_attempt_at: '2026-08-16T10:00:00Z'
    }]));
    expect(saved).toEqual({
      success: false,
      message: '本机存储空间不足，数据尚未保存。请清理浏览器站点数据或磁盘空间后重试。'
    });
  });

  it('rolls back a partially written member addition', async () => {
    const data = new Map<string, string>();
    const quotaError = Object.assign(new Error('quota full'), { name: 'QuotaExceededError' });
    let failMutationOnce = true;
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === 'strj_member_mutations' && failMutationOnce) {
          failMutationOnce = false;
          throw quotaError;
        }
        data.set(key, value);
      },
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', storage);
    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    data.set('strj_team_members', JSON.stringify([admin]));
    data.set('strj_user_passwords', JSON.stringify({ admin: 'admin-pass' }));

    await expect(addTeamMember({
      username: 'new',
      real_name: '新成员',
      role: 'user',
      created_at: '2026-08-16',
      last_login_at: '2026-08-16'
    })).rejects.toMatchObject({ name: 'QuotaExceededError' });

    expect(getTeamMembers().map(member => member.username)).toEqual(['admin']);
    expect(getTeamMemberMutations()).toEqual({});
    expect(JSON.parse(data.get('strj_user_passwords') || '{}')).toEqual({ admin: 'admin-pass' });
  });

  it('rolls back a partially written member deletion without purging study data', () => {
    const data = new Map<string, string>();
    const quotaError = Object.assign(new Error('quota full'), { name: 'QuotaExceededError' });
    let failMutationOnce = true;
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === 'strj_member_mutations' && failMutationOnce) {
          failMutationOnce = false;
          throw quotaError;
        }
        data.set(key, value);
      },
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', storage);
    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const member = { username: 'zs', real_name: '张三', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    data.set('strj_team_members', JSON.stringify([admin, member]));
    data.set('strj_records_zs', JSON.stringify({ q1: { question_id: 'q1', status: 'wrong' } }));

    expect(() => deleteTeamMember('zs')).toThrow('quota full');

    expect(getTeamMembers().map(item => item.username)).toEqual(['admin', 'zs']);
    expect(getPendingDeletedUsernames()).toEqual([]);
    expect(getTeamMemberMutations()).toEqual({});
    expect(data.get('strj_records_zs')).toContain('q1');
  });

  it('sanitizes parseable but structurally corrupted browser data', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', storage);
    data.set('strj_team_members', JSON.stringify({ not: 'an array' }));
    data.set('strj_current_user', JSON.stringify({ username: 42, role: 'owner' }));
    data.set('strj_records_bad', JSON.stringify({
      q1: {
        question_id: 'q1',
        status: 'wrong',
        attempt_count: 'three',
        last_attempt_at: 123,
        ebbinghaus_stage: 99,
        review_history: { not: 'an array' },
        attempt_counts_by_device: { deviceA: 2, deviceB: 'bad' }
      },
      q2: null
    }));
    data.set('strj_plan_bad', JSON.stringify({
      mode: 'rush',
      focus_module: '数论',
      daily_target: 999,
      exam_date: '2026-02-31'
    }));
    data.set('strj_announcements', JSON.stringify({ title: 'not an array' }));
    data.set('strj_sync_config', JSON.stringify({
      webdav_url: 42,
      auto_sync: 'yes',
      sync_status: 'forever'
    }));

    expect(getCurrentUser()).toBeNull();
    expect(getTeamMembers().some(member => member.username === 'admin')).toBe(true);
    expect(getUserRecords('bad')).toEqual({
      q1: expect.objectContaining({
        question_id: 'q1',
        status: 'wrong',
        attempt_count: 0,
        last_attempt_at: '',
        attempt_counts_by_device: { deviceA: 2 }
      })
    });
    expect(getUserRecords('bad').q1).not.toHaveProperty('ebbinghaus_stage');
    expect(getUserRecords('bad').q1).not.toHaveProperty('review_history');
    expect(getExamPlan('bad')).toMatchObject({
      mode: 'rush',
      focus_module: '数论',
      daily_target: 100,
      exam_date: '2026-09-18'
    });
    expect(getAnnouncements()).toEqual([]);
    expect(getSyncConfig()).toMatchObject({
      webdav_username: DEFAULT_SYNC_CONFIG.webdav_username,
      webdav_password: DEFAULT_SYNC_CONFIG.webdav_password,
      opencodego_api_key: DEFAULT_SYNC_CONFIG.opencodego_api_key,
      auto_sync: true,
      sync_status: 'idle'
    });
    expect(typeof getSyncConfig().webdav_url).toBe('string');
  });
});

describe('cloud request timeout', () => {
  it('settles a permanently stalled WebDAV request so later syncs can retry', async () => {
    const stalledFetcher = vi.fn(() => new Promise<Response>(() => {}));
    await expect(fetchWithSyncTimeout('/dav/records_test.json', {}, 5, stalledFetcher as unknown as typeof fetch))
      .rejects.toThrow('云同步请求超时');
  });
});

describe('AI request timeout', () => {
  it('settles a permanently stalled model request so the UI can recover', async () => {
    const stalledFetcher = vi.fn(() => new Promise<Response>(() => {}));
    await expect(fetchWithAiTimeout('/ai', {}, 5, stalledFetcher as unknown as typeof fetch))
      .rejects.toThrow('AI 请求超时');
  });
});

describe('clipboard fallback', () => {
  it('uses the modern clipboard API when it succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacyCopy = vi.fn(() => true);

    await copyTextToClipboard('试卷内容', { writeText, legacyCopy });

    expect(writeText).toHaveBeenCalledWith('试卷内容');
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it('falls back when clipboard permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    const legacyCopy = vi.fn(() => true);

    await expect(copyTextToClipboard('试卷内容', { writeText, legacyCopy })).resolves.toBeUndefined();
    expect(legacyCopy).toHaveBeenCalledWith('试卷内容');
  });

  it('reports a real failure when neither copy method works', async () => {
    const denied = new Error('permission denied');

    await expect(copyTextToClipboard('试卷内容', {
      writeText: vi.fn().mockRejectedValue(denied),
      legacyCopy: () => false
    })).rejects.toBe(denied);
  });
});

describe('mobile browser file delivery', () => {
  function installDownloadEnvironment() {
    const click = vi.fn();
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    class TestFile extends Blob {
      name: string;
      lastModified = 0;

      constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
        super(parts, options);
        this.name = name;
      }
    }
    vi.stubGlobal('File', TestFile);
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', style: {}, click, remove: vi.fn() }),
      body: { appendChild }
    });
    vi.stubGlobal('window', { setTimeout: vi.fn() });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    return { click, appendChild };
  }

  it('downloads instead of falsely reporting success when canShare is unavailable', async () => {
    const { click } = installDownloadEnvironment();
    const share = vi.fn();
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 1, share });

    const mode = await deliverFiles(
      [{ blob: new Blob(['a,b'], { type: 'text/csv' }), filename: 'report.csv' }],
      { title: '导出报表', preferShare: true }
    );

    expect(mode).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('falls back to a download when the mobile share sheet rejects the file', async () => {
    const { click } = installDownloadEnvironment();
    const share = vi.fn(async () => { throw new DOMException('Not allowed', 'NotAllowedError'); });
    vi.stubGlobal('navigator', {
      userAgent: 'Android Mobile',
      maxTouchPoints: 1,
      canShare: vi.fn(() => true),
      share
    });

    const mode = await deliverFiles(
      [{ blob: new Blob(['image'], { type: 'image/png' }), filename: 'poster.png' }],
      { title: '分享海报', preferShare: true }
    );

    expect(mode).toBe('downloaded');
    expect(share).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('practice interaction guards', () => {
  it('allows only one save for the same question until navigation resets it', () => {
    const guard = createQuestionCommitGuard();

    expect(guard.tryCommit('q1')).toBe(true);
    expect(guard.tryCommit('q1')).toBe(false);
    guard.reset();
    expect(guard.tryCommit('q1')).toBe(true);
  });

  it('blocks repeated form submissions until failure recovery or a new session', () => {
    const lock = createSubmissionLock();

    expect(lock.tryLock()).toBe(true);
    expect(lock.isLocked()).toBe(true);
    expect(lock.tryLock()).toBe(false);
    lock.release();
    expect(lock.tryLock()).toBe(true);
    lock.reset();
    expect(lock.isLocked()).toBe(false);
  });

  it('unlocks a failed save without unlocking a newer question', () => {
    const guard = createQuestionCommitGuard();

    expect(guard.tryCommit('q1')).toBe(true);
    expect(guard.tryCommit('q2')).toBe(true);
    guard.release('q1');
    expect(guard.tryCommit('q2')).toBe(false);
    guard.release('q2');
    expect(guard.tryCommit('q2')).toBe(true);
  });

  it('replaces stale transient-status timers and supports unmount cleanup', () => {
    vi.useFakeTimers();
    try {
      const timer = createLatestCallbackTimer();
      const events: string[] = [];

      timer.schedule(() => events.push('old'), 2000);
      vi.advanceTimersByTime(1500);
      timer.schedule(() => events.push('latest'), 2000);
      vi.advanceTimersByTime(600);
      expect(events).toEqual([]);
      expect(timer.isPending()).toBe(true);

      vi.advanceTimersByTime(1400);
      expect(events).toEqual(['latest']);
      expect(timer.isPending()).toBe(false);

      timer.schedule(() => events.push('unmounted'), 1000);
      timer.clear();
      vi.runAllTimers();
      expect(events).toEqual(['latest']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears stale drill deep links only when entering normal card practice', () => {
    const deepLink = { chapterId: '四年级_20', questionId: 'q6' };

    expect(getNextDrillFilter(deepLink, 'dashboard')).toEqual(deepLink);
    expect(getNextDrillFilter(deepLink, 'card_drill')).toBeUndefined();
    expect(getNextDrillFilter(undefined, 'card_drill', { module: '几何' })).toEqual({ module: '几何' });
  });

  it('selects every question in a module instead of only its first chapter', () => {
    const questions = [
      makeQuestion({ id: 'q1', chapter_id: '三年级_11', grade: '三年级', module: '应用题', section: '兴趣篇' }),
      makeQuestion({ id: 'q2', chapter_id: '五年级_12', grade: '五年级', module: '应用题', section: '拓展篇' }),
      makeQuestion({ id: 'q3', chapter_id: '五年级_15', grade: '五年级', module: '几何', section: '兴趣篇' })
    ];

    expect(filterDrillQuestions(questions, {
      grade: '全部',
      chapterId: '',
      section: '全部',
      module: '应用题'
    }).map(question => question.id)).toEqual(['q1', 'q2']);
    expect(filterDrillQuestions(questions, {
      grade: '五年级',
      chapterId: '五年级_12',
      section: '拓展篇'
    }).map(question => question.id)).toEqual(['q2']);
    expect(getAvailableQuestionModules(questions, ['计算', '数论', '几何', '应用题'])).toEqual(['几何', '应用题']);
  });

  it('keeps the visible question index inside a changing filtered list', () => {
    expect(clampQuestionIndex(5, 2)).toBe(1);
    expect(clampQuestionIndex(-2, 3)).toBe(0);
    expect(clampQuestionIndex(4, 0)).toBe(0);
  });

  it('advances review to another question without wrapping a one-item queue', () => {
    expect(getNextQuestionIdAfterCommit(['q1', 'q2', 'q3'], 'q2')).toBe('q3');
    expect(getNextQuestionIdAfterCommit(['q1', 'q2', 'q3'], 'q3')).toBe('q1');
    expect(getNextQuestionIdAfterCommit(['q1'], 'q1')).toBeNull();
    expect(getNextQuestionIdAfterCommit(['q1', 'q2'], 'missing')).toBe('q1');
  });
});

describe('answer verification', () => {
  it('accepts equivalent numbers but rejects answer substrings', () => {
    expect(verifyAnswer('0.5', '1/2').isCorrect).toBe(true);
    expect(verifyAnswer('解析', '见解析')).toMatchObject({ isCorrect: false, isGradable: false });
    expect(verifyAnswer('北京', '答案是北京市').isCorrect).toBe(false);
  });

  it('removes compound units without leaving partial unit text', () => {
    expect(verifyAnswer('25', '25平方厘米').isCorrect).toBe(true);
    expect(verifyAnswer('0.6', '0.6平方千米').isCorrect).toBe(true);
    expect(verifyAnswer('80', '80颗').isCorrect).toBe(true);
    expect(verifyAnswer('21', '21公顷').isCorrect).toBe(true);
  });

  it('grades ordered multi-part answers across punctuation and item labels', () => {
    expect(verifyAnswer('4,3', '4本；3人').isCorrect).toBe(true);
    expect(verifyAnswer('270,5600', '（1）270；（2）5600').isCorrect).toBe(true);
    expect(verifyAnswer('12,21', '（1）12种(2）21种').isCorrect).toBe(true);
    expect(verifyAnswer('2.28,4.56', '（1）2.28平方厘米（2）4.56平方厘米').isCorrect).toBe(true);
    expect(verifyAnswer('38,7', '7人，38个').isCorrect).toBe(false);
  });

  it('supports mixed fractions, Chinese fractions, percentages and labeled ratios', () => {
    expect(verifyAnswer('113.6666667', '113又2/3分钟').isCorrect).toBe(true);
    expect(verifyAnswer('1/3', '3分之1').isCorrect).toBe(true);
    expect(verifyAnswer('0.25', '25%').isCorrect).toBe(true);
    expect(verifyAnswer('15:6:4', '大：中：小=15：6：4').isCorrect).toBe(true);
  });

  it('routes prose, malformed and compound-currency answers to manual review', () => {
    expect(isAutoGradableAnswer('分两种情况说明：先分类讨论再证明')).toBe(false);
    expect(isAutoGradableAnswer('间；45个')).toBe(false);
    expect(isAutoGradableAnswer('60 200')).toBe(false);
    expect(isAutoGradableAnswer('0(1)3；(2)30')).toBe(false);
    expect(isAutoGradableAnswer('4月11日0:00')).toBe(false);
    expect(isAutoGradableAnswer('小宇家2元7角6分；小达家1元8角')).toBe(false);
  });
});

describe('question bank loading', () => {
  const createMemoryStorage = () => {
    const data = new Map<string, string>();
    return {
      data,
      storage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
        clear: () => data.clear(),
        key: (index: number) => [...data.keys()][index] ?? null,
        get length() { return data.size; }
      }
    };
  };
  const jsonResponse = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as Response;

  it('validates and caches a complete network question bank', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const question = makeQuestion();
    const chapter = makeChapter();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('questions')
        ? jsonResponse([question])
        : jsonResponse([chapter])
    ));

    const loaded = await loadQuestionBank(fetcher as typeof fetch);
    expect(loaded).toMatchObject({ source: 'network', questions: [question], chapters: [chapter] });
    expect(memory.data.has('strj_question_bank_cache_v1')).toBe(true);
  });

  it('restores the last valid local copy when the network is unavailable', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const question = makeQuestion();
    const chapter = makeChapter();
    const onlineFetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('questions')
        ? jsonResponse([question])
        : jsonResponse([chapter])
    ));
    await loadQuestionBank(onlineFetcher as typeof fetch);

    const offlineFetcher = vi.fn(async () => { throw new Error('offline'); });
    const restored = await loadQuestionBank(offlineFetcher as unknown as typeof fetch);
    expect(restored).toMatchObject({ source: 'cache', questions: [question], chapters: [chapter] });
    expect(restored.warning).toContain('本机副本');
  });

  it('reports HTTP failures when no valid cache exists', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('questions')
        ? jsonResponse({}, 404)
        : jsonResponse([makeChapter()])
    ));

    await expect(loadQuestionBank(fetcher as typeof fetch)).rejects.toThrow('HTTP 404');
  });

  it('rejects partial deployments where a question points to a missing chapter', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('questions')
        ? jsonResponse([makeQuestion({ chapter_id: 'missing' })])
        : jsonResponse([makeChapter()])
    ));

    await expect(loadQuestionBank(fetcher as typeof fetch)).rejects.toThrow('不存在的章节');
  });

  it('rejects a bank missing fields required by the rendered views', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('questions')
        ? jsonResponse([makeQuestion({ short_title: '' })])
        : jsonResponse([makeChapter()])
    ));

    await expect(loadQuestionBank(fetcher as typeof fetch)).rejects.toThrow('short_title');
  });

  it('stops waiting for stalled requests and restores the cached bank', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const question = makeQuestion();
    const chapter = makeChapter();
    const onlineFetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('questions')
        ? jsonResponse([question])
        : jsonResponse([chapter])
    ));
    await loadQuestionBank(onlineFetcher as typeof fetch);

    const stalledFetcher = vi.fn(() => new Promise<Response>(() => {}));
    const restored = await loadQuestionBank(stalledFetcher as unknown as typeof fetch, 5);
    expect(restored).toMatchObject({ source: 'cache', questions: [question], chapters: [chapter] });
    expect(restored.warning).toContain('本机副本');
  });

  it('reports a timeout when a stalled request has no cached fallback', async () => {
    const memory = createMemoryStorage();
    vi.stubGlobal('localStorage', memory.storage);
    const stalledFetcher = vi.fn(() => new Promise<Response>(() => {}));

    await expect(loadQuestionBank(stalledFetcher as unknown as typeof fetch, 5)).rejects.toThrow('加载超时');
  });
});

describe('CSV export', () => {
  it('quotes delimiters and prevents spreadsheet formula execution', () => {
    const csv = buildLeaderboardCsv([{
      username: '=danger',
      real_name: '王,老师"甲',
      role: 'user',
      daily_target: 10,
      plan_mode: 'balanced',
      solved_count: 5,
      correct_count: 4,
      wrong_count: 1,
      accuracy_rate: 80,
      completion_rate: 50,
      streak_days: 2,
      last_active_at: '2026-08-16T10:00:00Z'
    }]);

    expect(csv.startsWith('\uFEFF姓名,')).toBe(true);
    expect(csv).toContain('"王,老师""甲"');
    expect(csv).toContain("'=danger");
    expect(csv).toContain('80%,50%,2天,2026-08-16');
    expect(csv).toContain('\r\n');
  });
});

describe('practice records', () => {
  it('stores a first-time correct answer as correct and mastered', () => {
    const record = calculatePracticeAttemptRecord(
      undefined,
      { question_id: 'q1', chapter_id: 'c1' },
      true
    );
    expect(record).toMatchObject({ status: 'correct', is_mastered: true, attempt_count: 1 });
    expect(record.review_history).toHaveLength(1);
    expect(record.review_history?.[0].passed).toBe(true);
  });

  it('enrolls an incorrect answer at stage zero', () => {
    const record = calculatePracticeAttemptRecord(
      undefined,
      { question_id: 'q1', chapter_id: 'c1' },
      false
    );
    expect(record).toMatchObject({ status: 'wrong', ebbinghaus_stage: 0, wrong_count: 1 });
  });

  it('does not mutate review history and permits clearing notes', () => {
    const previous: UserRecord = {
      question_id: 'q1',
      status: 'wrong',
      attempt_count: 1,
      last_attempt_at: '2026-08-16T00:00:00Z',
      user_notes: '旧笔记',
      review_history: []
    };
    const next = calculateNextEbbinghausRecord(previous, true, '');
    expect(previous.review_history).toEqual([]);
    expect(next.review_history).toHaveLength(1);
    expect(next.user_notes).toBe('');
  });

  it('marks an error mastered without erasing attempts, mistakes, history or legacy notes', () => {
    const previous: UserRecord = {
      question_id: 'q1',
      chapter_id: 'c1',
      status: 'wrong',
      attempt_count: 4,
      wrong_count: 3,
      last_attempt_at: '2026-08-15T00:00:00Z',
      notes: '保留这条笔记',
      ebbinghaus_stage: 2,
      next_review_at: '2026-08-17T00:00:00Z',
      review_history: [{ reviewed_at: '2026-08-15T00:00:00Z', passed: false }]
    };

    const mastered = markPracticeRecordMastered(previous, { question_id: 'q1', chapter_id: 'c1' });

    expect(mastered).toMatchObject({
      status: 'correct',
      is_mastered: true,
      ebbinghaus_stage: 5,
      attempt_count: 5,
      wrong_count: 3,
      notes: '保留这条笔记',
      user_notes: '保留这条笔记'
    });
    expect(mastered.next_review_at).toBeUndefined();
    expect(mastered.review_history).toHaveLength(2);
    expect(previous.review_history).toHaveLength(1);
  });
});

describe('paper generation', () => {
  it('generates a default-module paper from classified bank data', () => {
    const paper = generateExamPaper([makeQuestion()], {
      title: '测试卷',
      grades: ['三年级'],
      modules: ['应用题'],
      sections: ['兴趣篇'],
      questionCount: 1,
      totalScore: 100,
      durationMinutes: 45,
      onlyErrorBook: false
    });
    expect(paper.questions).toHaveLength(1);
    expect(paper.questions[0].score).toBe(100);
  });

  it('uses Fisher-Yates without mutating the source array', () => {
    const source = [1, 2, 3, 4];
    expect(fisherYatesShuffle(source, () => 0)).toEqual([2, 3, 4, 1]);
    expect(source).toEqual([1, 2, 3, 4]);
  });

  it('normalizes an invalid count and never produces negative scores', () => {
    const questions = Array.from({ length: 4 }, (_, index) => makeQuestion({ id: `q${index + 1}` }));
    const paper = generateExamPaper(questions, {
      title: '低分值测试卷',
      grades: ['三年级'],
      modules: ['应用题'],
      sections: ['兴趣篇'],
      questionCount: 4,
      totalScore: 2,
      durationMinutes: 45,
      onlyErrorBook: false
    });
    expect(paper.questions.map(question => question.score).every(score => score >= 0)).toBe(true);
    expect(paper.questions.reduce((sum, question) => sum + question.score, 0)).toBe(2);

    const normalizedCountPaper = generateExamPaper(questions, {
      title: '题数边界测试卷',
      grades: ['三年级'],
      modules: ['应用题'],
      sections: ['兴趣篇'],
      questionCount: 0,
      totalScore: 10,
      durationMinutes: 45,
      onlyErrorBook: false
    });
    expect(normalizedCountPaper.questions).toHaveLength(1);
    expect(normalizedCountPaper.questions[0].score).toBe(10);
  });

  it('does not interpret an empty visible filter as selecting the whole bank', () => {
    const baseOptions: PaperFilterOptions = {
      title: '筛选测试卷',
      grades: ['三年级'],
      modules: ['应用题'],
      sections: ['兴趣篇'],
      questionCount: 1,
      totalScore: 100,
      durationMinutes: 45,
      onlyErrorBook: false
    };

    expect(() => generateExamPaper([makeQuestion()], { ...baseOptions, grades: [] })).toThrow('至少选择一个年级');
    expect(() => generateExamPaper([makeQuestion()], { ...baseOptions, modules: [] })).toThrow('至少选择一个奥数模块');
    expect(() => generateExamPaper([makeQuestion()], { ...baseOptions, sections: [] })).toThrow('至少选择一个篇章');
  });

  it('treats an empty error book as empty and excludes removed-bank records', () => {
    const question = makeQuestion();
    const options: PaperFilterOptions = {
      title: '错题卷',
      grades: ['三年级'],
      modules: ['应用题'],
      sections: ['兴趣篇'],
      questionCount: 1,
      totalScore: 100,
      durationMinutes: 45,
      onlyErrorBook: true
    };
    const records = {
      q1: { question_id: 'q1', status: 'wrong', attempt_count: 1, last_attempt_at: '2026-08-16T10:00:00Z' },
      removed: { question_id: 'removed', status: 'wrong', attempt_count: 1, last_attempt_at: '2026-08-16T10:00:00Z' }
    } satisfies Record<string, UserRecord>;

    expect(() => generateExamPaper([question], options)).toThrow('未找到匹配');
    expect(getActiveErrorBookQuestionIds([question], records)).toEqual(['q1']);
  });
});

describe('exam plan dates', () => {
  it('uses the edited exam date for countdowns and labels', () => {
    expect(calculateDaysRemaining('2026-08-18', new Date('2026-08-16T10:00:00'))).toBe(2);
    expect(calculateDaysRemaining('2026-08-15', new Date('2026-08-16T10:00:00'))).toBe(0);
    expect(calculateDaysRemaining('invalid', new Date('2026-08-16T10:00:00'))).toBe(0);
    expect(formatExamDate('2026-12-03')).toBe('2026年12月3日');
  });

  it('rejects calendar dates that JavaScript would silently roll forward', () => {
    expect(formatExamDate('2026-02-29')).toBe('2026-02-29');
    expect(formatExamDate('2026-02-31')).toBe('2026-02-31');
    expect(formatExamDate('2024-02-29')).toBe('2024年2月29日');
    expect(calculateDaysRemaining('2026-02-31', new Date('2026-02-01T10:00:00'))).toBe(0);
  });
});

describe('card drill keyboard shortcuts', () => {
  it('never steals Enter or number keys from dialogs and form controls', () => {
    expect(getDrillKeyboardAction({ key: 'Enter', targetTagName: 'INPUT', hasOpenDialog: true })).toBeNull();
    expect(getDrillKeyboardAction({ key: '2', targetTagName: 'BODY', hasOpenDialog: true })).toBeNull();
    expect(getDrillKeyboardAction({ key: ' ', targetTagName: 'BUTTON' })).toBeNull();
    expect(getDrillKeyboardAction({ key: 'ArrowRight', targetTagName: 'SELECT' })).toBeNull();
  });

  it('submits only the dedicated answer input and keeps page shortcuts working', () => {
    expect(getDrillKeyboardAction({ key: 'Enter', targetTagName: 'INPUT', isAnswerInput: true })).toBe('submit_answer');
    expect(getDrillKeyboardAction({ key: 'Enter', targetTagName: 'INPUT' })).toBeNull();
    expect(getDrillKeyboardAction({ key: 'ArrowRight', targetTagName: 'BODY' })).toBe('next');
    expect(getDrillKeyboardAction({ key: '2', targetTagName: 'BODY' })).toBe('mark_correct');
  });

  it('picks a random next question without immediately repeating the current one', () => {
    expect(getRandomQuestionIndex(['q1'], 0, 'uniform', {}, () => 0.5)).toBe(0);
    expect(getRandomQuestionIndex(['q1', 'q2', 'q3', 'q4'], 1, 'uniform', {}, () => 0)).toBe(0);
    expect(getRandomQuestionIndex(['q1', 'q2', 'q3', 'q4'], 1, 'uniform', {}, () => 0.34)).toBe(2);
    expect(getRandomQuestionIndex(['q1', 'q2', 'q3', 'q4'], 1, 'uniform', {}, () => 0.999)).toBe(3);
    expect(getRandomQuestionIndex(
      ['q1', 'q2', 'q3', 'q4'],
      0,
      'wrong_first',
      { q2: 'correct', q3: 'wrong' },
      () => 0
    )).toBe(2);
    expect(getRandomQuestionIndex(
      ['q1', 'q2', 'q3'],
      0,
      'unseen_first',
      { q2: 'correct' },
      () => 0
    )).toBe(2);
  });
});

describe('math quote rotation', () => {
  it('ships a 200+ quote library without duplicate source entries', () => {
    expect(MATH_QUOTES.length).toBeGreaterThanOrEqual(200);
    expect(new Set(MATH_QUOTES.map(quote => quote.sourceNo)).size).toBe(MATH_QUOTES.length);
    expect(MATH_QUOTES.every(quote => quote.text.trim().length >= 4 && quote.author.trim().length > 0)).toBe(true);
  });

  it('never repeats the currently visible quote when alternatives exist', () => {
    expect(getNextQuoteIndex(1, 0, () => 0.8)).toBe(0);
    expect(getNextQuoteIndex(4, 1, () => 0)).toBe(0);
    expect(getNextQuoteIndex(4, 1, () => 0.34)).toBe(2);
    expect(getNextQuoteIndex(4, 1, () => 0.999)).toBe(3);
  });
});

describe('PDF pagination', () => {
  it('places tall exports on every required page without dropping the tail', () => {
    expect(calculatePdfPageOffsets(296, 297)).toEqual([0]);
    expect(calculatePdfPageOffsets(700, 297)).toEqual([0, -297, -594]);
  });

  it('uses one required export root and reports a missing rendered paper', () => {
    const root = {} as HTMLElement;
    expect(requirePaperExportRoot({ getElementById: id => id === PAPER_EXPORT_ROOT_ID ? root : null })).toBe(root);
    expect(() => requirePaperExportRoot({ getElementById: () => null })).toThrow('找不到可导出的试卷内容');
  });

  it('sanitizes user-entered paper titles before using them as filenames', () => {
    expect(sanitizeDownloadFilename('  模拟卷:第1/2套?.  ')).toBe('模拟卷_第1_2套_');
    expect(sanitizeDownloadFilename('...')).toBe('模拟试卷');
  });

  it('keeps questions together and splits an oversized answer without losing content', () => {
    const slices = paginatePaperBlocks([
      { height: 70, keepTogether: true },
      { height: 40, keepTogether: true },
      { height: 230, forceBreakBefore: true, keepTogether: false }
    ], 100, 5);
    expect(slices).toEqual([
      { blockIndex: 0, pageIndex: 0, y: 0, sourceY: 0, height: 70 },
      { blockIndex: 1, pageIndex: 1, y: 0, sourceY: 0, height: 40 },
      { blockIndex: 2, pageIndex: 2, y: 0, sourceY: 0, height: 100 },
      { blockIndex: 2, pageIndex: 3, y: 0, sourceY: 100, height: 100 },
      { blockIndex: 2, pageIndex: 4, y: 0, sourceY: 200, height: 30 }
    ]);
  });

  it('keeps a stitched long image within mobile canvas limits', () => {
    expect(calculateLongImageSize(1)).toEqual({ width: 1240, height: 1754 });
    const long = calculateLongImageSize(15);
    expect(long.width).toBeGreaterThanOrEqual(640);
    expect(long.height).toBeLessThanOrEqual(30_000);
    expect(long.width * long.height).toBeLessThanOrEqual(18_000_000);
  });

  it('keeps quick-share images legible while respecting mobile pixel limits', () => {
    expect(calculateContinuousImageSize(794, 6000)).toEqual({ width: 820, height: 6196 });
    const veryLong = calculateContinuousImageSize(794, 24_000);
    expect(veryLong.width).toBeGreaterThanOrEqual(540);
    expect(veryLong.height).toBeLessThanOrEqual(24_000);
    expect(veryLong.width * veryLong.height).toBeLessThanOrEqual(12_000_000);
  });
});

describe('user avatar display', () => {
  it('shows only the first Chinese character and falls back to the account initial', () => {
    expect(getAvatarInitial(' 小面包 ', 'xmb')).toBe('小');
    expect(getAvatarInitial('Teacher Wang', 'wang')).toBe('W');
    expect(getAvatarInitial('', '')).toBe('人');
  });
});

describe('AI tutor requests', () => {
  it('disables hidden thinking so a visible structured answer is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              analysis: '先建立数量关系。',
              stepByStepSolution: ['列式', '计算', '验算'],
              finalAnswer: '10',
              teacherTips: '注意单位。',
              relatedConcepts: ['应用题']
            })
          }
        }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAiProblemExplanation(
      makeQuestion({ id: 'ai-thinking-test', answer: '10', q_slice_url: undefined }),
      'test-key'
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);

    expect(requestBody.thinking).toEqual({ type: 'disabled' });
    expect(result).toMatchObject({ source: 'ai', model: 'deepseek-v4-flash', finalAnswer: '10' });
  });

  it('uses vision for layout-sensitive modules and includes both source images', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/bank/')) {
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['image'], { type: 'image/png' })
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({
              analysis: '根据数位布局逐位判断。',
              stepByStepSolution: ['先识别每一列', '再处理进位约束', '最后代回验算'],
              finalAnswer: '10',
              teacherTips: '注意进位。',
              relatedConcepts: ['数字谜']
            })
          }]
        })
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const question = makeQuestion({
      id: 'ai-dual-image-test',
      module: '数字谜',
      answer: '10',
      content: '这是一道文字很长但其竖式布局仍然决定数位关系的数字谜题，必须读取原图才能准确恢复空格位置。',
      q_slice_url: '/bank/question.png',
      ans_slice_url: '/bank/answer.png'
    });

    expect(shouldUseVision(question)).toBe(true);
    await expect(getAiProblemExplanation(question, 'test-key')).resolves.toMatchObject({ model: 'qwen3.7-plus' });
    const visionCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/messages'));
    const body = JSON.parse(visionCall?.[1]?.body as string);
    const contentBlocks = body.messages[0].content as Array<{ type: string }>;
    expect(contentBlocks.filter(block => block.type === 'image')).toHaveLength(2);
  });

  it('keeps complex official answer text as a labelled OCR reference', () => {
    const prompt = buildTutorPrompt(makeQuestion({
      answer: '分两种情况说明：第一种有12种，第二种有21种，并分别证明'
    }));

    expect(prompt).toContain('OCR 转写的官方参考答案');
    expect(prompt).toContain('第一种有12种');
    expect(prompt).toContain('必须独立验算');
  });

  it('rejects a confident wrong answer and tries the next text model', async () => {
    const responses = ['9', '10'];
    const fetchMock = vi.fn(async () => {
      const finalAnswer = responses.shift() || '10';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                analysis: '先列出数量关系并逐步求解。',
                stepByStepSolution: ['根据条件列式', '完成计算', '代回题意检查'],
                finalAnswer,
                teacherTips: '注意验算。',
                relatedConcepts: ['应用题']
              })
            }
          }]
        })
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAiProblemExplanation(
      makeQuestion({ id: 'ai-answer-validation-test', answer: '10', q_slice_url: undefined }),
      'test-key'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ model: 'mimo-v2.5', finalAnswer: '10' });
  });

  it('uses the full stored solution when every AI model is temporarily unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getAiProblemExplanation(makeQuestion({
      id: 'ai-local-complete-fallback-test',
      answer: '4本；3人',
      content: '老师先发本子，后来又来2人，剩下12本还能发给几人？',
      explanation: '比较前后剩下的本数，老师后来又发了20-12=8本。这8本分给新来的2人，每人8÷2=4本。剩下12本还能发给12÷4=3人。'
    }), 'test-key');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      source: 'local',
      model: '本地教学框架',
      finalAnswer: '4本；3人'
    });
    expect(result.analysis).toContain('题库中已经整理并核验的完整解析');
    expect(result.stepByStepSolution.join('')).toContain('20-12=8');
    expect(result.warning).toContain('deepseek-v4-flash: HTTP 502');
    expect(result.warning).toContain('mimo-v2.5: HTTP 502');
  });

  it('recovers useful fields from truncated JSON without exposing prompt field names', () => {
    const result = parseAiExplanationResponse(
      `"analysis": "比较两次分配后的剩余量。",
      "stepByStepSolution": [
        "步骤1：剩余减少20-12=8本。",
        "步骤2：每人分到8÷2=4本。",
        "步骤3：还能分给12÷4=3人。"
      ],
      "finalAnswer": "4本；3人",
      "teacherTips": "不要把8本误当成每人所得。",
      "relatedConcepts": ["盈亏问题",`,
      makeQuestion({ answer: '4本；3人' }),
      'qwen3.7-plus'
    );

    expect(result.analysis).toBe('比较两次分配后的剩余量。');
    expect(result.stepByStepSolution).toEqual([
      '剩余减少20-12=8本。',
      '每人分到8÷2=4本。',
      '还能分给12÷4=3人。'
    ]);
    expect(result.finalAnswer).toBe('4本；3人');
    expect([
      result.analysis,
      ...result.stepByStepSolution,
      result.finalAnswer,
      result.teacherTips,
      ...result.relatedConcepts
    ].join('\n')).not.toMatch(/(?:analysis|stepByStepSolution|finalAnswer|teacherTips|relatedConcepts)\s*:/);
  });

  it('uses the vision endpoint as recovery when both text models return 502', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/bank/')) {
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['image'], { type: 'image/png' })
        } as Response;
      }
      if (url.includes('/chat/completions')) {
        return { ok: false, status: 502 } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({
              analysis: '比较前后剩余量。',
              stepByStepSolution: ['先求减少量', '再求每人本数', '最后求可分人数'],
              finalAnswer: '4本；3人',
              teacherTips: '注意减少量是两人的总数。',
              relatedConcepts: ['盈亏问题']
            })
          }]
        })
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAiProblemExplanation(makeQuestion({
      id: 'ai-vision-recovery-after-502',
      answer: '4本；3人',
      content: '原有若干学生平均分作业本，后来又来了2名同学。第一次分后剩20本，第二次分后剩12本，问每人几本、剩余还能分给几人？',
      q_slice_url: '/bank/question.png'
    }), 'test-key');

    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/chat/completions'))).toHaveLength(2);
    expect(result).toMatchObject({ source: 'ai', model: 'qwen3.7-plus', finalAnswer: '4本；3人' });
  });
});

describe('activity streak and cloud merge', () => {
  it('ignores a stale sync callback after switching accounts', () => {
    expect(isSyncRefreshForCurrentSession('alice', 'bob')).toBe(false);
    expect(isSyncRefreshForCurrentSession('Alice', 'alice')).toBe(true);
    expect(isSyncRefreshForCurrentSession('alice', null)).toBe(true);
  });

  it('purges a deleted member locally and does not recreate seeded history', () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const member = { username: 'zs', real_name: '张三', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin, member]));
    memoryStorage.setItem('strj_user_passwords', JSON.stringify({ admin: 'admin-pass', zs: 'private-pass' }));
    memoryStorage.setItem('strj_records_zs', JSON.stringify({ q1: { question_id: 'q1' } }));
    memoryStorage.setItem('strj_plan_zs', JSON.stringify({ daily_target: 20 }));
    memoryStorage.setItem('strj_current_user', JSON.stringify(member));

    deleteTeamMember('zs');

    expect(getTeamMembers().map(item => item.username)).toEqual(['admin']);
    expect(memoryStorage.getItem('strj_records_zs')).toBeNull();
    expect(memoryStorage.getItem('strj_plan_zs')).toBeNull();
    expect(memoryStorage.getItem('strj_current_user')).toBeNull();
    expect(JSON.parse(memoryStorage.getItem('strj_user_passwords') || '{}').zs).toBeUndefined();
    expect(getPendingDeletedUsernames()).toEqual(['zs']);
    expect(getTeamMemberMutations().zs.operation).toBe('delete');
    expect(memoryStorage.getItem('strj_records_zs')).toBeNull();
  });

  it('blocks username reuse until old cloud data is confirmed deleted', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const member = { username: 'reuse', real_name: '旧成员', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([member]));

    deleteTeamMember('reuse');
    await expect(addTeamMember({ ...member, real_name: '新成员' })).rejects.toThrow('云端旧数据尚未清理');
    clearPendingDeletedUsernames(['reuse']);
    await addTeamMember({ ...member, real_name: '新成员' });

    expect(getPendingDeletedUsernames()).toEqual([]);
    expect(getTeamMemberMutations().reuse).toMatchObject({
      operation: 'upsert',
      member: { username: 'reuse', real_name: '新成员' }
    });
  });

  it('uses synced one-way credentials instead of another device default password', async () => {
    const createMemoryStorage = () => {
      const data = new Map<string, string>();
      return {
        data,
        storage: {
          getItem: (key: string) => data.get(key) ?? null,
          setItem: (key: string, value: string) => data.set(key, value),
          removeItem: (key: string) => data.delete(key),
          clear: () => data.clear(),
          key: (index: number) => [...data.keys()][index] ?? null,
          get length() { return data.size; }
        }
      };
    };
    const member = { username: 'x', real_name: '用户X', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };

    const deviceA = createMemoryStorage();
    vi.stubGlobal('localStorage', deviceA.storage);
    deviceA.data.set('strj_team_members', JSON.stringify([member]));
    deviceA.data.set('strj_user_passwords', JSON.stringify({ x: '123' }));
    deviceA.data.set('strj_current_user', JSON.stringify(member));
    const updatedMember = await setUserPassword('x', 'new-secret');
    expect(updatedMember.password_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(updatedMember.password_hash).not.toContain('new-secret');
    expect(JSON.parse(deviceA.data.get('strj_user_passwords') || '{}').x).toBeUndefined();
    expect(getCurrentUser()?.password_hash).toBe(updatedMember.password_hash);

    const deviceB = createMemoryStorage();
    vi.stubGlobal('localStorage', deviceB.storage);
    deviceB.data.set('strj_team_members', JSON.stringify([updatedMember]));
    await expect(authenticateUser('x', '123')).resolves.toMatchObject({
      success: false,
      reason: 'wrong_password'
    });
    await expect(authenticateUser('x', 'new-secret')).resolves.toMatchObject({
      success: true,
      user: { username: 'x' }
    });
  });

  it('records the successful login timestamp in the shared member mutation', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const credential = await createPasswordCredential('private-password');
    const member = {
      username: 'x',
      account_id: 'account-x',
      real_name: '用户X',
      role: 'user' as const,
      created_at: '2026-01-01',
      last_login_at: '2026-01-01',
      password_hash: credential
    };
    data.set('strj_team_members', JSON.stringify([member]));

    const result = await authenticateUser('x', 'private-password');

    expect(result).toMatchObject({ success: true, user: { username: 'x' } });
    const loginAt = result.user?.last_login_at;
    expect(loginAt).not.toBe(member.last_login_at);
    expect(getCurrentUser()?.last_login_at).toBe(loginAt);
    expect(getTeamMembers()[0].last_login_at).toBe(loginAt);
    expect(getTeamMemberMutations().x).toMatchObject({
      operation: 'upsert',
      member: { username: 'x', last_login_at: loginAt, password_hash: credential }
    });
  });

  it('does not complete a stale login after that username has been replaced', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const oldCredential = await createPasswordCredential('old-password');
    const replacementCredential = await createPasswordCredential('replacement-password');
    const oldMember = { username: 'x', account_id: 'old-account', real_name: '旧用户', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01', password_hash: oldCredential };
    const replacement = { ...oldMember, account_id: 'replacement-account', real_name: '新用户', password_hash: replacementCredential };
    data.set('strj_team_members', JSON.stringify([oldMember]));

    const pendingLogin = authenticateUser('x', 'old-password');
    data.set('strj_team_members', JSON.stringify([replacement]));
    const result = await pendingLogin;

    expect(result).toMatchObject({ success: false, reason: 'account_changed' });
    expect(getCurrentUser()).toBeNull();
    expect(getTeamMembers()[0]).toEqual(replacement);
    expect(getTeamMemberMutations().x).toBeUndefined();
  });

  it('does not change a password after the active account switches', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const credentialA = await createPasswordCredential('password-a');
    const credentialB = await createPasswordCredential('password-b');
    const userA = { username: 'a', account_id: 'account-a', real_name: '用户A', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01', password_hash: credentialA };
    const userB = { username: 'b', account_id: 'account-b', real_name: '用户B', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01', password_hash: credentialB };
    data.set('strj_team_members', JSON.stringify([userA, userB]));
    data.set('strj_current_user', JSON.stringify(userA));

    const pendingChange = changeCurrentUserPassword('a', 'password-a', 'new-password-a');
    data.set('strj_current_user', JSON.stringify(userB));
    const result = await pendingChange;

    expect(result).toMatchObject({ success: false, reason: 'session_changed' });
    expect(getCurrentUser()).toEqual(userB);
    expect(getTeamMembers().find(member => member.username === 'a')?.password_hash).toBe(credentialA);
    expect(getTeamMemberMutations().a).toBeUndefined();
  });

  it('changes only the active account password and publishes the credential', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const credential = await createPasswordCredential('old-password');
    const member = { username: 'x', account_id: 'account-x', real_name: '用户X', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01', password_hash: credential };
    data.set('strj_team_members', JSON.stringify([member]));
    data.set('strj_current_user', JSON.stringify(member));

    const result = await changeCurrentUserPassword('x', 'old-password', 'new-password');

    expect(result).toMatchObject({ success: true, member: { username: 'x' } });
    const changedCredential = getTeamMembers()[0].password_hash;
    expect(changedCredential).not.toBe(credential);
    expect(getCurrentUser()?.password_hash).toBe(changedCredential);
    expect(getTeamMemberMutations().x.member?.password_hash).toBe(changedCredential);
    await expect(authenticateUser('x', 'old-password')).resolves.toMatchObject({ success: false });
    await expect(authenticateUser('x', 'new-password')).resolves.toMatchObject({ success: true });
  });

  it('does not reset a reused username after password derivation has started', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const oldCredential = await createPasswordCredential('old-password');
    const replacementCredential = await createPasswordCredential('replacement-password');
    const oldMember = { username: 'x', account_id: 'old-account', real_name: '旧用户', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01', password_hash: oldCredential };
    const replacement = { ...oldMember, account_id: 'replacement-account', real_name: '新用户', password_hash: replacementCredential };
    data.set('strj_team_members', JSON.stringify([oldMember]));

    const pendingReset = setUserPassword('x', 'admin-reset');
    data.set('strj_team_members', JSON.stringify([replacement]));

    await expect(pendingReset).rejects.toThrow('已在操作期间发生变化');
    expect(getTeamMembers()[0]).toEqual(replacement);
    expect(getTeamMemberMutations().x).toBeUndefined();
  });

  it('publishes a locally changed credential during the next account sync', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const oldCredential = await createPasswordCredential('old-password');
    const newCredential = await createPasswordCredential('new-password');
    const oldMember = { username: 'x', real_name: '用户X', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01', password_hash: oldCredential };
    const updatedMember = { ...oldMember, password_hash: newCredential };
    memoryStorage.setItem('strj_team_members', JSON.stringify([updatedMember]));
    memoryStorage.setItem('strj_member_mutations', JSON.stringify({
      x: { operation: 'upsert', updated_at: '2026-08-16T11:00:00Z', member: updatedMember }
    }));
    memoryStorage.setItem('strj_records_x', JSON.stringify({}));

    let uploadedSharedPayload: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET' && url.endsWith('/shared_team.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            updatedAt: '2026-08-16T10:00:00Z',
            teamMembers: [oldMember],
            announcements: [],
            memberMutations: {
              x: { operation: 'upsert', updated_at: '2026-08-16T10:00:00Z', member: oldMember }
            }
          })
        };
      }
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ schemaVersion: 1, records: {} })
        };
      }
      if (url.endsWith('/shared_team.json')) {
        uploadedSharedPayload = JSON.parse(String(init?.body));
      }
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    expect(await pullCloudData('x')).toMatchObject({ success: true });
    expect(uploadedSharedPayload.memberMutations.x.member.password_hash).toBe(newCredential);
    expect(uploadedSharedPayload.teamMembers[0].password_hash).toBe(newCredential);
  });

  it('downloads the shared login roster before any user is signed in', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const newMember = {
      username: 'new',
      real_name: '云端新成员',
      role: 'user' as const,
      created_at: '2026-08-16',
      last_login_at: '2026-08-16',
      password_hash: await createPasswordCredential('123')
    };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin]));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-08-16T10:00:00Z',
        teamMembers: [admin, newMember],
        announcements: [],
        memberMutations: {
          new: { operation: 'upsert', updated_at: '2026-08-16T10:00:00Z', member: newMember }
        }
      })
    })));

    expect(await pullSharedTeamData()).toMatchObject({ success: true });
    expect(getTeamMembers().map(item => item.username)).toEqual(['admin', 'new']);
    await expect(authenticateUser('new', '123')).resolves.toMatchObject({ success: true });
  });

  it('purges cached data for a remotely deleted non-current member', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const current = { username: 'current', real_name: '当前用户', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const removed = { username: 'removed', real_name: '已删除用户', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([current, removed]));
    memoryStorage.setItem('strj_current_user', JSON.stringify(current));
    memoryStorage.setItem('strj_user_passwords', JSON.stringify({ removed: 'old-password' }));
    memoryStorage.setItem('strj_records_removed', JSON.stringify({ q1: { question_id: 'q1' } }));
    memoryStorage.setItem('strj_plan_removed', JSON.stringify({ daily_target: 20 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-08-16T10:00:00Z',
        teamMembers: [current],
        announcements: [],
        memberMutations: {
          removed: { operation: 'delete', updated_at: '2026-08-16T10:00:00Z' }
        }
      })
    })));

    expect(await pullSharedTeamData()).toMatchObject({ success: true });
    expect(memoryStorage.getItem('strj_records_removed')).toBeNull();
    expect(memoryStorage.getItem('strj_plan_removed')).toBeNull();
    expect(JSON.parse(memoryStorage.getItem('strj_user_passwords') || '{}').removed).toBeUndefined();
    expect(JSON.parse(memoryStorage.getItem('strj_current_user') || '{}').username).toBe('current');
  });

  it('purges old records when a deleted username is later reused by a new identity', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const staleMember = { username: 'reuse', account_id: 'old-account', real_name: '旧成员', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const replacement = { ...staleMember, account_id: 'new-account', real_name: '新成员', password_hash: await createPasswordCredential('123') };
    memoryStorage.setItem('strj_team_members', JSON.stringify([staleMember]));
    memoryStorage.setItem('strj_records_reuse', JSON.stringify({ oldQuestion: { question_id: 'oldQuestion' } }));
    memoryStorage.setItem('strj_plan_reuse', JSON.stringify({ daily_target: 99 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-08-16T11:00:00Z',
        teamMembers: [replacement],
        announcements: [],
        memberMutations: {
          reuse: { operation: 'upsert', updated_at: '2026-08-16T11:00:00Z', member: replacement }
        }
      })
    })));

    expect(await pullSharedTeamData()).toMatchObject({ success: true });
    expect(memoryStorage.getItem('strj_records_reuse')).toBeNull();
    expect(memoryStorage.getItem('strj_plan_reuse')).toBeNull();
    expect(getTeamMembers()[0]).toMatchObject({ account_id: 'new-account', real_name: '新成员' });
  });

  it('uses the administrator-specific default when resetting the built-in account', () => {
    expect(getDefaultPasswordForMember('admin')).toBe('1415926');
    expect(getDefaultPasswordForMember('zs')).toBe('123');
  });

  it('counts only consecutive active calendar days', () => {
    const records = [
      { question_id: 'q1', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-16T01:00:00+08:00' },
      { question_id: 'q2', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-15T01:00:00+08:00' },
      { question_id: 'q3', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-12T01:00:00+08:00' }
    ] satisfies UserRecord[];
    const now = new Date('2026-08-16T12:00:00+08:00');
    expect(calculateConsecutiveActiveDays(records, now)).toBe(2);
    expect(calculateConsecutiveActiveDays([], now)).toBe(0);
  });

  it('does not report an expired historical streak as current', () => {
    const records = [
      { question_id: 'q1', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-10T12:00:00+08:00' },
      { question_id: 'q2', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-09T12:00:00+08:00' },
      { question_id: 'future', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-20T12:00:00+08:00' }
    ] satisfies UserRecord[];

    expect(calculateConsecutiveActiveDays(records, new Date('2026-08-16T12:00:00+08:00'))).toBe(0);
  });

  it('retains consecutive activity when the same question is practised on several days', () => {
    const record = {
      question_id: 'q1',
      status: 'correct',
      attempt_count: 3,
      last_attempt_at: '2026-08-16T12:00:00+08:00',
      review_history: [
        { reviewed_at: '2026-08-14T12:00:00+08:00', passed: true },
        { reviewed_at: '2026-08-15T12:00:00+08:00', passed: true },
        { reviewed_at: '2026-08-16T12:00:00+08:00', passed: true }
      ]
    } satisfies UserRecord;

    expect(calculateConsecutiveActiveDays([record], new Date('2026-08-16T18:00:00+08:00'))).toBe(3);
  });

  it('excludes records for questions no longer present in the active bank', () => {
    const records = {
      active: { question_id: 'active', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-16T10:00:00+08:00' },
      removed: { question_id: 'removed', status: 'wrong', attempt_count: 1, last_attempt_at: '2026-08-16T11:00:00+08:00' }
    } satisfies Record<string, UserRecord>;

    expect(calculateUserProgress(records, ['active'], new Date('2026-08-16T18:00:00+08:00'))).toEqual({
      solvedCount: 1,
      correctCount: 1,
      wrongCount: 0,
      accuracyRate: 100,
      completionRate: 100,
      streakDays: 1
    });
  });

  it('keeps the newest record from local and cloud snapshots', () => {
    const local: Record<string, UserRecord> = {
      q1: { question_id: 'q1', status: 'correct', attempt_count: 2, last_attempt_at: '2026-08-16T10:00:00Z' }
    };
    const remote: Record<string, UserRecord> = {
      q1: { question_id: 'q1', status: 'wrong', attempt_count: 1, last_attempt_at: '2026-08-15T10:00:00Z' },
      q2: { question_id: 'q2', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-16T11:00:00Z' }
    };
    expect(mergeUserRecords(local, remote)).toMatchObject({ q1: local.q1, q2: remote.q2 });
  });

  it('merges concurrent offline attempts from different devices exactly once', () => {
    const createMemoryStorage = (deviceId: string) => {
      const data = new Map<string, string>([['strj_device_id', deviceId]]);
      return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
        clear: () => data.clear(),
        key: (index: number) => [...data.keys()][index] ?? null,
        get length() { return data.size; }
      };
    };
    const commonRecord: UserRecord = {
      question_id: 'q1',
      status: 'wrong',
      attempt_count: 2,
      wrong_count: 1,
      ebbinghaus_stage: 0,
      last_attempt_at: '2026-08-15T10:00:00Z'
    };

    vi.stubGlobal('localStorage', createMemoryStorage('device-a'));
    const deviceARecord = calculateNextEbbinghausRecord(commonRecord, true);
    vi.stubGlobal('localStorage', createMemoryStorage('device-b'));
    const deviceBRecord = calculateNextEbbinghausRecord(commonRecord, false);

    const firstMerge = mergeUserRecords(
      { q1: deviceARecord },
      { q1: deviceBRecord }
    ).q1;
    expect(firstMerge).toMatchObject({ attempt_count: 4, wrong_count: 2 });
    expect(firstMerge.attempt_counts_by_device).toEqual({ legacy: 2, 'device-a': 1, 'device-b': 1 });
    expect(firstMerge.wrong_counts_by_device).toEqual({ legacy: 1, 'device-b': 1 });
    expect(firstMerge.review_history).toHaveLength(2);

    const repeatedMerge = mergeUserRecords(
      { q1: firstMerge },
      { q1: deviceBRecord }
    ).q1;
    expect(repeatedMerge).toMatchObject({ attempt_count: 4, wrong_count: 2 });
    expect(repeatedMerge.review_history).toHaveLength(2);

    vi.stubGlobal('localStorage', createMemoryStorage('device-a'));
    const nextARecord = calculateNextEbbinghausRecord(firstMerge, true);
    vi.stubGlobal('localStorage', createMemoryStorage('device-b'));
    const nextBRecord = calculateNextEbbinghausRecord(firstMerge, false);
    const secondMerge = mergeUserRecords(
      { q1: nextARecord },
      { q1: nextBRecord }
    ).q1;

    expect(secondMerge).toMatchObject({ attempt_count: 6, wrong_count: 3 });
    expect(secondMerge.review_history).toHaveLength(4);
  });

  it('keeps legacy scalar counters compatible without doubling snapshots', () => {
    const local: UserRecord = {
      question_id: 'q1',
      status: 'correct',
      attempt_count: 5,
      wrong_count: 2,
      last_attempt_at: '2026-08-16T10:00:00Z'
    };
    const remote: UserRecord = {
      question_id: 'q1',
      status: 'wrong',
      attempt_count: 4,
      wrong_count: 2,
      last_attempt_at: '2026-08-16T09:00:00Z'
    };

    const merged = mergeUserRecords({ q1: local }, { q1: remote }).q1;
    expect(merged).toMatchObject({ status: 'correct', attempt_count: 5, wrong_count: 2 });
    expect(merged.attempt_counts_by_device).toEqual({ legacy: 5 });
    expect(merged.wrong_counts_by_device).toEqual({ legacy: 2 });
  });

  it('uploads and stores the union of local and cloud device counters', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);

    const localRecord: UserRecord = {
      question_id: 'q1',
      status: 'wrong',
      attempt_count: 3,
      wrong_count: 1,
      attempt_counts_by_device: { legacy: 2, 'device-a': 1 },
      wrong_counts_by_device: { legacy: 1 },
      last_attempt_at: '2026-08-16T10:00:00Z'
    };
    const remoteRecord: UserRecord = {
      question_id: 'q1',
      status: 'wrong',
      attempt_count: 3,
      wrong_count: 2,
      attempt_counts_by_device: { legacy: 2, 'device-b': 1 },
      wrong_counts_by_device: { legacy: 1, 'device-b': 1 },
      last_attempt_at: '2026-08-16T11:00:00Z'
    };
    memoryStorage.setItem('strj_records_u1', JSON.stringify({ q1: localRecord }));

    let uploadedPayload: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET' && url.endsWith('/shared_team.json')) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            records: { q1: remoteRecord }
          })
        };
      }
      uploadedPayload = JSON.parse(String(init?.body));
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    expect(await queuePushToCloud('u1', { q1: localRecord })).toBe(true);
    expect(uploadedPayload.records.q1).toMatchObject({ attempt_count: 4, wrong_count: 2 });
    expect(uploadedPayload.records.q1.attempt_counts_by_device).toEqual({
      legacy: 2,
      'device-a': 1,
      'device-b': 1
    });
    expect(JSON.parse(memoryStorage.getItem('strj_records_u1') || '{}').q1).toMatchObject({
      attempt_count: 4,
      wrong_count: 2
    });
  });

  it('keeps the newest exam plan and handles legacy plans safely', () => {
    const legacyPlan = {
      mode: 'balanced' as const,
      focus_module: '几何' as const,
      daily_target: 10,
      exam_date: '2026-09-18'
    };
    const olderPlan = { ...legacyPlan, daily_target: 15, updated_at: '2026-08-15T10:00:00Z' };
    const newerPlan = { ...legacyPlan, daily_target: 30, updated_at: '2026-08-16T10:00:00Z' };

    expect(mergeExamPlans(olderPlan, newerPlan)).toEqual(newerPlan);
    expect(mergeExamPlans(newerPlan, olderPlan)).toEqual(newerPlan);
    expect(mergeExamPlans(newerPlan, legacyPlan)).toEqual(newerPlan);
    expect(mergeExamPlans(legacyPlan, { ...legacyPlan, daily_target: 20 })).toEqual({
      ...legacyPlan,
      daily_target: 20
    });
  });

  it('merges shared team data without dropping local additions', () => {
    const localMember = { username: 'local', real_name: '本机', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const remoteMember = { username: 'remote', real_name: '云端', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    expect(mergeTeamMembers([localMember], [remoteMember]).map(item => item.username)).toEqual(['remote', 'local']);

    const localAnnouncement = { id: 'local', title: '本机', content: '本机', created_at: '2026-08-16', author: 'A' };
    const remoteAnnouncement = { id: 'remote', title: '云端', content: '云端', created_at: '2026-08-15', author: 'B' };
    expect(mergeAnnouncements([localAnnouncement], [remoteAnnouncement]).map(item => item.id)).toEqual(['local', 'remote']);
  });

  it('preserves an offline announcement when pulling an older shared snapshot', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const localAnnouncement = { id: 'local-offline', title: '离线公告', content: '尚未上传', created_at: '2026-08-17T10:00:00Z', author: '管理员' };
    const remoteAnnouncement = { id: 'remote-old', title: '云端公告', content: '已有内容', created_at: '2026-08-16T10:00:00Z', author: '管理员' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin]));
    memoryStorage.setItem('strj_announcements', JSON.stringify([localAnnouncement]));

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-08-16T10:00:00Z',
        teamMembers: [admin],
        announcements: [remoteAnnouncement]
      })
    })));

    expect(await pullSharedTeamData()).toMatchObject({ success: true });
    expect(getAnnouncements().map(item => item.id)).toEqual(['local-offline', 'remote-old']);
  });

  it('keeps concurrent additions while a newer deletion tombstone prevents resurrection', () => {
    const oldMember = { username: 'old', real_name: '旧成员', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const localMember = { username: 'local', real_name: '本机新增', role: 'user' as const, created_at: '2026-08-16', last_login_at: '2026-08-16' };
    const remoteMember = { username: 'remote', real_name: '云端新增', role: 'user' as const, created_at: '2026-08-16', last_login_at: '2026-08-16' };
    const localMutations = {
      old: { operation: 'upsert' as const, updated_at: '2026-08-15T10:00:00Z', member: oldMember },
      local: { operation: 'upsert' as const, updated_at: '2026-08-16T10:00:00Z', member: localMember }
    };
    const remoteMutations = {
      old: { operation: 'delete' as const, updated_at: '2026-08-16T11:00:00Z' },
      remote: { operation: 'upsert' as const, updated_at: '2026-08-16T10:30:00Z', member: remoteMember }
    };

    const mutations = mergeTeamMemberMutations(localMutations, remoteMutations);
    const members = applyTeamMemberMutations(
      mergeTeamMembers([oldMember, localMember], [remoteMember]),
      mutations
    );

    expect(members.map(member => member.username).sort()).toEqual(['local', 'remote']);
    expect(mutations.old.operation).toBe('delete');
  });

  it('uses deterministic ties and collision-resistant IDs for concurrent administrators', () => {
    const memberA = { username: 'same', account_id: 'account-a', real_name: '管理员甲', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const memberB = { ...memberA, account_id: 'account-b', real_name: '管理员乙' };
    const mutationA = { same: { operation: 'upsert' as const, updated_at: '2026-08-17T12:00:00.000Z', member: memberA } };
    const mutationB = { same: { operation: 'upsert' as const, updated_at: '2026-08-17T12:00:00.000Z', member: memberB } };
    expect(mergeTeamMemberMutations(mutationA, mutationB)).toEqual(mergeTeamMemberMutations(mutationB, mutationA));
    expect(new Set(Array.from({ length: 200 }, () => createAnnouncementId())).size).toBe(200);
  });

  it('retries an ETag conflict and preserves changes from two administrators', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const admin = { username: 'admin', account_id: 'admin-a', real_name: '管理员甲', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const local = { username: 'local', account_id: 'local-a', real_name: '甲新增', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const remoteA = { username: 'remote-a', account_id: 'remote-a', real_name: '云端已有', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const remoteB = { username: 'remote-b', account_id: 'remote-b', real_name: '乙刚新增', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin, local]));
    let sharedGetCount = 0;
    let sharedPutCount = 0;
    let finalShared: any;
    const ifMatchHeaders: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/shared_team.json') && init?.method === 'GET') {
        sharedGetCount += 1;
        const second = sharedGetCount > 1;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: (name: string) => name.toLowerCase() === 'etag' ? (second ? '"v2"' : '"v1"') : null },
          json: async () => ({
            schemaVersion: 1,
            updatedAt: '2026-08-17T00:00:00Z',
            teamMembers: second ? [admin, remoteA, remoteB] : [admin, remoteA],
            announcements: [],
            memberMutations: {}
          })
        };
      }
      if (url.endsWith('/shared_team.json') && init?.method === 'PUT') {
        sharedPutCount += 1;
        ifMatchHeaders.push(String((init.headers as Record<string, string>)?.['If-Match'] || ''));
        if (sharedPutCount === 1) return { ok: false, status: 412, statusText: 'Precondition Failed' };
        finalShared = JSON.parse(String(init.body));
        return { ok: true, status: 200, statusText: 'OK' };
      }
      if (init?.method === 'GET') return { ok: false, status: 404, statusText: 'Not Found' };
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    expect(await queuePushToCloud('admin', {}, { sharedDataAuthority: 'local' })).toBe(true);
    expect(ifMatchHeaders).toEqual(['"v1"', '"v2"']);
    expect(finalShared.teamMembers.map((member: { username: string }) => member.username).sort()).toEqual(['admin', 'local', 'remote-a', 'remote-b']);
    expect(getTeamMembers().map(member => member.username).sort()).toEqual(['admin', 'local', 'remote-a', 'remote-b']);
  });

  it('retries a user-record ETag conflict and preserves answers from another device', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const admin = { username: 'admin', account_id: 'admin-a', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin]));
    memoryStorage.setItem('strj_records_admin', JSON.stringify({
      local: { question_id: 'local', status: 'correct', last_attempt_at: '2026-08-17T09:00:00Z' }
    }));
    let userGetCount = 0;
    let userPutCount = 0;
    let finalPayload: any;
    const ifMatchHeaders: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/records_admin.json') && init?.method === 'GET') {
        userGetCount += 1;
        const afterConflict = userGetCount > 1;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: (name: string) => name.toLowerCase() === 'etag' ? (afterConflict ? '"u2"' : '"u1"') : null },
          json: async () => ({
            schemaVersion: 1,
            username: 'admin',
            accountId: 'admin-a',
            updatedAt: '2026-08-17T09:00:00Z',
            records: {
              remoteA: { question_id: 'remoteA', status: 'correct', last_attempt_at: '2026-08-17T09:05:00Z' },
              ...(afterConflict ? { remoteB: { question_id: 'remoteB', status: 'wrong', last_attempt_at: '2026-08-17T09:10:00Z' } } : {})
            },
            teamMembers: [admin],
            announcements: []
          })
        };
      }
      if (url.endsWith('/records_admin.json') && init?.method === 'PUT') {
        userPutCount += 1;
        ifMatchHeaders.push(String((init.headers as Record<string, string>)?.['If-Match'] || ''));
        if (userPutCount === 1) return { ok: false, status: 412, statusText: 'Precondition Failed' };
        finalPayload = JSON.parse(String(init.body));
        return { ok: true, status: 200, statusText: 'OK' };
      }
      if (url.endsWith('/shared_team.json') && init?.method === 'GET') {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    expect(await queuePushToCloud('admin', getUserRecords('admin'))).toBe(true);
    expect(ifMatchHeaders).toEqual(['"u1"', '"u2"']);
    expect(Object.keys(finalPayload.records).sort()).toEqual(['local', 'remoteA', 'remoteB']);
    expect(Object.keys(getUserRecords('admin')).sort()).toEqual(['local', 'remoteA', 'remoteB']);
  });

  it('keeps a recoverable member snapshot when an account is deleted and restored', () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const member = { username: 'restore', account_id: 'account-old', real_name: '待恢复', role: 'user' as const, password_hash: 'v1$test', created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([member]));
    memoryStorage.setItem('strj_records_restore', JSON.stringify({ q1: { question_id: 'q1' } }));

    deleteTeamMember('restore');
    expect(getRecoverableDeletedMembers()[0].member).toMatchObject({ username: 'restore', account_id: 'account-old' });
    expect(memoryStorage.getItem('strj_records_restore')).toBeNull();
    expect(restoreTeamMember('restore')).toMatchObject({ username: 'restore', account_id: 'account-old' });
    expect(getTeamMembers().some(item => item.username === 'restore')).toBe(true);
    expect(getPendingDeletedUsernames()).toEqual([]);
  });

  it('records an administrator roster edit and refreshes the active identity', () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const admin = { username: 'admin', account_id: 'admin-a', real_name: '旧管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const teacher = { username: 'ls', account_id: 'teacher-a', real_name: '李老师', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin, teacher]));
    memoryStorage.setItem('strj_current_user', JSON.stringify(admin));

    expect(updateTeamMember('admin', { real_name: '新管理员', role: 'admin' })).toMatchObject({ real_name: '新管理员' });
    expect(updateTeamMember('ls', { real_name: '李主任', role: 'admin' })).toMatchObject({ real_name: '李主任', role: 'admin' });
    expect(getCurrentUser()).toMatchObject({ real_name: '新管理员', role: 'admin' });
    expect(getTeamMembers().find(member => member.username === 'ls')).toMatchObject({ real_name: '李主任', role: 'admin' });
    expect(getTeamMemberMutations().ls).toMatchObject({
      operation: 'upsert',
      member: { username: 'ls', real_name: '李主任', role: 'admin', account_id: 'teacher-a' }
    });
    expect(() => updateTeamMember('admin', { real_name: '新管理员', role: 'user' })).toThrow('系统内置管理员不能改为普通教师');
  });

  it('marks a Nutstore backup as deleted without issuing an HTTP DELETE', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const member = { username: 'deleted', account_id: 'account-old', real_name: '已删除', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_member_mutations', JSON.stringify({
      deleted: { operation: 'delete', updated_at: '2026-08-17T00:00:00Z', member }
    }));
    const methods: string[] = [];
    let uploaded: any;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      methods.push(init?.method || 'GET');
      if (init?.method === 'GET') return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ schemaVersion: 1, username: 'deleted', accountId: 'account-old', records: { q1: { question_id: 'q1' } } })
      };
      uploaded = JSON.parse(String(init?.body));
      return { ok: true, status: 200, statusText: 'OK' };
    });

    await markRemoteUserDataDeleted(DEFAULT_SYNC_CONFIG, 'deleted', 'admin', fetcher as unknown as typeof fetch);
    expect(methods).toEqual(['GET', 'PUT']);
    expect(uploaded.records).toHaveProperty('q1');
    expect(uploaded.deletion).toMatchObject({ isDeleted: true, deletedBy: 'admin', recoverable: true, accountId: 'account-old' });
  });

  it('uses accumulated attempts for team error rates', () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    memoryStorage.setItem('strj_team_members', JSON.stringify([
      { username: 'u1', real_name: '用户一', role: 'user', created_at: '2026-01-01', last_login_at: '2026-01-01' }
    ]));
    memoryStorage.setItem('strj_records_u1', JSON.stringify({
      q1: { question_id: 'q1', status: 'correct', attempt_count: 5, wrong_count: 2, last_attempt_at: '2026-08-16T00:00:00Z' }
    }));

    expect(getTeamErrorItems([makeQuestion()])[0]).toMatchObject({
      wrong_count: 2,
      attempt_count: 5,
      wrong_rate: 40,
      wrong_users: ['用户一']
    });
  });

  it('serializes cloud writes so the newest local snapshot is uploaded last', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const uploadedQuestionSets: string[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      const payload = JSON.parse(String(init?.body));
      uploadedQuestionSets.push(Object.keys(payload.records));
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    const q1: UserRecord = { question_id: 'q1', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-16T10:00:00Z' };
    const q2: UserRecord = { question_id: 'q2', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-16T10:01:00Z' };
    memoryStorage.setItem('strj_records_u1', JSON.stringify({ q1 }));
    const firstPush = queuePushToCloud('u1', { q1 });
    memoryStorage.setItem('strj_records_u1', JSON.stringify({ q1, q2 }));
    const secondPush = queuePushToCloud('u1', { q1, q2 });

    await Promise.all([firstPush, secondPush]);
    expect(uploadedQuestionSets.at(-1)).toEqual(['q1', 'q2']);
  });

  it('serializes manual pulls with background pushes', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const member = { username: 'u1', real_name: '用户一', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([member]));
    memoryStorage.setItem('strj_announcements', JSON.stringify([]));

    let activeRequests = 0;
    let maxActiveRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 2));
      activeRequests -= 1;

      if (init?.method === 'GET' && url.endsWith('/shared_team.json')) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            username: 'u1',
            updatedAt: '2026-08-16T10:00:00Z',
            records: {},
            teamMembers: [member],
            announcements: [],
            examPlan: { mode: 'balanced', focus_module: '几何', daily_target: 10, exam_date: '2026-09-18' }
          })
        };
      }
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    await Promise.all([
      queuePushToCloud('u1', {}),
      pullCloudData('u1')
    ]);

    expect(maxActiveRequests).toBe(1);
  });

  it('initializes a missing cloud file without deadlocking the sync queue', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);
    const member = { username: 'u1', real_name: '用户一', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([member]));
    memoryStorage.setItem('strj_announcements', JSON.stringify([]));
    let putCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return { ok: false, status: 404, statusText: 'Not Found' };
      putCount += 1;
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    const result = await pullCloudData('u1');

    expect(result.success).toBe(true);
    expect(putCount).toBe(1);
  });

  it('uploads an admin deletion without restoring the stale remote member', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);

    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const deleted = { username: 'old', real_name: '已删除成员', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const localAddition = { username: 'local-new', real_name: '本机新增', role: 'user' as const, created_at: '2026-08-16', last_login_at: '2026-08-16' };
    const remoteAddition = { username: 'remote-new', real_name: '云端新增', role: 'user' as const, created_at: '2026-08-16', last_login_at: '2026-08-16' };
    const localPlan = { mode: 'balanced' as const, focus_module: '几何' as const, daily_target: 20, exam_date: '2026-09-18', updated_at: '2026-08-16T10:00:00Z' };
    const remotePlan = { ...localPlan, daily_target: 10, updated_at: '2026-08-15T10:00:00Z' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin, localAddition]));
    memoryStorage.setItem('strj_announcements', JSON.stringify([
      { id: 'local-ann', title: '本机公告', content: '本机', created_at: '2026-08-16T11:00:00Z', author: '本机' }
    ]));
    memoryStorage.setItem('strj_plan_admin', JSON.stringify(localPlan));
    memoryStorage.setItem('strj_pending_deleted_users', JSON.stringify(['old']));

    let uploadedUserPayload: any;
    let uploadedSharedPayload: any;
    const deleteMethods: string[] = [];
    let markedDeletedPayload: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        if (url.endsWith('/shared_team.json')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              schemaVersion: 1,
              updatedAt: '2026-08-15T10:00:00Z',
              teamMembers: [admin, deleted, remoteAddition],
              announcements: [
                { id: 'remote-ann', title: '云端公告', content: '云端', created_at: '2026-08-16T10:00:00Z', author: '云端' }
              ]
            })
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            username: 'admin',
            updatedAt: '2026-08-15T10:00:00Z',
            records: {},
            teamMembers: [admin, deleted],
            announcements: [],
            examPlan: remotePlan
          })
        };
      }
      if (init?.method === 'DELETE') deleteMethods.push(url);
      if (url.endsWith('/shared_team.json')) {
        uploadedSharedPayload = JSON.parse(String(init?.body));
      } else if (url.endsWith('/records_old.json')) {
        markedDeletedPayload = JSON.parse(String(init?.body));
      } else {
        uploadedUserPayload = JSON.parse(String(init?.body));
      }
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    await queuePushToCloud('admin', {}, { sharedDataAuthority: 'local' });

    expect(uploadedSharedPayload.teamMembers.map((member: { username: string }) => member.username).sort()).toEqual(['admin', 'local-new', 'remote-new']);
    expect(uploadedSharedPayload.announcements.map((item: { id: string }) => item.id).sort()).toEqual(['local-ann', 'remote-ann']);
    expect(uploadedSharedPayload.memberMutations.old.operation).toBe('delete');
    expect(uploadedUserPayload.teamMembers.map((member: { username: string }) => member.username).sort()).toEqual(['admin', 'local-new', 'remote-new']);
    expect(uploadedUserPayload.examPlan).toEqual(localPlan);
    expect(deleteMethods).toEqual([]);
    expect(markedDeletedPayload.deletion).toMatchObject({ isDeleted: true, deletedBy: 'admin', recoverable: true });
    expect(markedDeletedPayload.records).toEqual({});
    expect(getPendingDeletedUsernames()).toEqual([]);
  });

  it('loads team changes from one canonical shared file for every user', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);

    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const ordinaryUser = { username: 'ordinary-user', real_name: '普通成员', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const staleLocalMember = { username: 'removed', real_name: '云端已删除', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const newMember = { username: 'new', real_name: '新成员', role: 'user' as const, created_at: '2026-08-16', last_login_at: '2026-08-16' };
    const announcement = { id: 'new-ann', title: '新公告', content: '全员可见', created_at: '2026-08-16', author: '管理员' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin, ordinaryUser, staleLocalMember]));
    memoryStorage.setItem('strj_announcements', JSON.stringify([]));

    let uploadedUserPayload: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET' && url.endsWith('/shared_team.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            updatedAt: '2026-08-16T10:00:00Z',
            teamMembers: [admin, ordinaryUser, newMember],
            announcements: [announcement]
          })
        };
      }
      if (init?.method === 'GET') {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      uploadedUserPayload = JSON.parse(String(init?.body));
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    await queuePushToCloud('ordinary-user', {});

    expect(JSON.parse(memoryStorage.getItem('strj_team_members') || '[]').map((member: { username: string }) => member.username)).toEqual(['admin', 'ordinary-user', 'new']);
    expect(JSON.parse(memoryStorage.getItem('strj_announcements') || '[]')).toEqual([announcement]);
    expect(uploadedUserPayload.teamMembers.map((member: { username: string }) => member.username)).toEqual(['admin', 'ordinary-user', 'new']);
  });

  it('logs out a member removed from the canonical team snapshot without re-uploading data', async () => {
    const data = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; }
    };
    vi.stubGlobal('localStorage', memoryStorage);

    const admin = { username: 'admin', real_name: '管理员', role: 'admin' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    const removed = { username: 'removed', real_name: '已注销', role: 'user' as const, created_at: '2026-01-01', last_login_at: '2026-01-01' };
    memoryStorage.setItem('strj_team_members', JSON.stringify([admin, removed]));
    memoryStorage.setItem('strj_announcements', JSON.stringify([]));
    memoryStorage.setItem('strj_current_user', JSON.stringify(removed));
    memoryStorage.setItem('strj_records_removed', JSON.stringify({
      q1: { question_id: 'q1', status: 'correct', attempt_count: 1, last_attempt_at: '2026-08-16T00:00:00Z' }
    }));

    let putCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET' && url.endsWith('/shared_team.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            updatedAt: '2026-08-16T10:00:00Z',
            teamMembers: [admin],
            announcements: []
          })
        };
      }
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            schemaVersion: 1,
            records: {},
            teamMembers: [admin, removed],
            announcements: []
          })
        };
      }
      putCount += 1;
      return { ok: true, status: 200, statusText: 'OK' };
    }));

    const success = await queuePushToCloud('removed', {});

    expect(success).toBe(false);
    expect(memoryStorage.getItem('strj_current_user')).toBeNull();
    expect(memoryStorage.getItem('strj_records_removed')).toBeNull();
    expect(putCount).toBe(0);
  });
});
