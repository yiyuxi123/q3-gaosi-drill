import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { LoginModal } from './components/LoginModal';
import { EasterEggWoodFish } from './components/EasterEggWoodFish';
import { CardDrillView } from './views/CardDrillView';
import { EbbinghausErrorView } from './views/EbbinghausErrorView';
import { PaperGeneratorView } from './views/PaperGeneratorView';
import { LeaderboardView } from './views/LeaderboardView';
import { AdminView } from './views/AdminView';
import { DashboardView } from './views/DashboardView';
import { QuickEntryView } from './views/QuickEntryView';

import type { 
  TeamMember, 
  Question, 
  Chapter, 
  UserRecord, 
  SyncConfig, 
  ExamPlanConfig,
  TeamAnnouncement
} from './types';

import { 
  getCurrentUser, 
  setCurrentUser, 
  getTeamMembers, 
  getUserRecords, 
  saveUserRecord, 
  batchSaveUserRecords,
  getExamPlan, 
  saveExamPlan, 
  getAnnouncements, 
  addAnnouncement,
  getUserSummary, 
  getTeamLeaderboard,
  initializeSeedData,
  isSyncRefreshForCurrentSession,
  tryLocalPersistence
} from './services/storage';

import { 
  getSyncConfig, 
  saveSyncConfig, 
  queuePushToCloud, 
  pullCloudData,
  pullSharedTeamData
} from './services/webdav';
import { calculateDaysRemaining } from './services/examPlan';
import { loadQuestionBank } from './services/questionBank';
import { createSubmissionLock, getNextDrillFilter, type DrillFilter } from './services/practiceSession';

const DEFAULT_EXAM_PLAN: ExamPlanConfig = {
  mode: 'balanced',
  focus_module: '几何',
  daily_target: 10,
  exam_date: '2026-09-18'
};

export default function App() {
  const [currentUser, setCurrentUserState] = useState<TeamMember | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [drillFilter, setDrillFilter] = useState<DrillFilter | undefined>(undefined);

  // Core Question Bank
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loadingBank, setLoadingBank] = useState(true);
  const [bankLoadError, setBankLoadError] = useState('');
  const [bankLoadWarning, setBankLoadWarning] = useState('');

  // App State
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [userRecords, setUserRecords] = useState<Record<string, UserRecord>>({});
  const [syncConfig, setSyncConfigState] = useState<SyncConfig>(getSyncConfig());
  const [examPlan, setExamPlanState] = useState<ExamPlanConfig>(DEFAULT_EXAM_PLAN);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [operationError, setOperationError] = useState('');
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const manualSyncLockRef = useRef(createSubmissionLock());

  // Follow the user's editable exam plan instead of a fixed campaign date.
  const daysRemaining = calculateDaysRemaining(examPlan.exam_date);

  const refreshAfterSync = useCallback((username: string): boolean => {
    const storedUser = getCurrentUser();
    // A slow upload for user A may finish after the browser has already logged
    // in as user B. That stale callback must never reset B's live session.
    if (!isSyncRefreshForCurrentSession(username, storedUser?.username)) {
      return false;
    }

    const members = getTeamMembers();
    const activeMember = members.find(
      member => member.username.toLowerCase() === username.toLowerCase()
    );

    setTeamMembers(members);
    setAnnouncements(getAnnouncements());
    setSyncConfigState(getSyncConfig());

    if (
      !storedUser
      || storedUser.username.toLowerCase() !== username.toLowerCase()
      || !activeMember
    ) {
      setCurrentUser(null);
      setCurrentUserState(null);
      setUserRecords({});
      setExamPlanState(DEFAULT_EXAM_PLAN);
      setActiveTab('dashboard');
      setIsLoginModalOpen(true);
      return false;
    }

    const refreshedUser = { ...storedUser, ...activeMember };
    setCurrentUser(refreshedUser);
    setCurrentUserState(refreshedUser);
    setUserRecords(getUserRecords(username));
    setExamPlanState(getExamPlan(username));
    return true;
  }, []);

  const refreshSharedAccounts = useCallback(async (): Promise<void> => {
    await pullSharedTeamData();
    setTeamMembers(getTeamMembers());
    setAnnouncements(getAnnouncements());
    setSyncConfigState(getSyncConfig());
  }, []);

  const watchQueuedCloudSync = useCallback((
    username: string,
    syncPromise: Promise<boolean>,
    savedItemLabel: string
  ): void => {
    void syncPromise.then(success => {
      const sessionIsCurrent = refreshAfterSync(username);
      if (sessionIsCurrent && !success) {
        setOperationError(`${savedItemLabel}已保存在本机，但云同步失败。请检查顶部同步状态，网络恢复后点击“坚果云同步”重试。`);
      } else if (sessionIsCurrent && success) {
        setOperationError(current => current.includes('云同步') ? '' : current);
      }
    }).catch(error => {
      const sessionIsCurrent = refreshAfterSync(username);
      if (sessionIsCurrent) {
        const detail = error instanceof Error && error.message ? `：${error.message}` : '';
        setOperationError(`${savedItemLabel}已保存在本机，但云同步异常${detail}。请稍后手动重试。`);
      }
    });
  }, [refreshAfterSync]);

  const reloadQuestionBank = useCallback(async (): Promise<void> => {
    setLoadingBank(true);
    setBankLoadError('');
    setBankLoadWarning('');
    try {
      const result = await loadQuestionBank();
      setAllQuestions(result.questions);
      setChapters(result.chapters);
      setBankLoadWarning(result.warning || '');
    } catch (error) {
      setAllQuestions([]);
      setChapters([]);
      setBankLoadError(error instanceof Error ? error.message : '题库加载失败，请稍后重试');
    } finally {
      setLoadingBank(false);
    }
  }, []);

  // 1. Initial Load
  useEffect(() => {
    initializeSeedData();
    const existingUser = getCurrentUser();
    if (existingUser) {
      setCurrentUserState(existingUser);
      setUserRecords(getUserRecords(existingUser.username));
      setExamPlanState(getExamPlan(existingUser.username));
    } else {
      // Prompt login
      setIsLoginModalOpen(true);
    }

    setTeamMembers(getTeamMembers());
    setAnnouncements(getAnnouncements());

    void reloadQuestionBank();

    // Initial silent WebDAV sync pull. Refresh every local slice after the
    // service has applied the merged cloud snapshot.
    if (existingUser) {
      void pullCloudData(existingUser.username).then(() => {
        refreshAfterSync(existingUser.username);
      });
    } else if (getSyncConfig().webdav_url) {
      // A new member must be able to download the shared login roster before
      // their username exists on this device.
      void refreshSharedAccounts();
    }
  }, [refreshAfterSync, refreshSharedAccounts, reloadQuestionBank]);

  const handleLoginSuccess = (user: TeamMember) => {
    setOperationError('');
    setDrillFilter(undefined);
    setCurrentUserState(user);
    setUserRecords(getUserRecords(user.username));
    setExamPlanState(getExamPlan(user.username));
    void pullCloudData(user.username).then(() => {
      refreshAfterSync(user.username);
    });
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentUserState(null);
    setUserRecords({});
    setExamPlanState(DEFAULT_EXAM_PLAN);
    setDrillFilter(undefined);
    setActiveTab('dashboard');
    setIsLoginModalOpen(true);
    setOperationError('');
  };

  const handleSaveRecord = (record: UserRecord): boolean => {
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return false;
    }
    const saved = tryLocalPersistence(() => saveUserRecord(currentUser.username, record));
    if (!saved.success) {
      setOperationError(saved.message);
      return false;
    }
    const updated = saved.value;
    setUserRecords({ ...updated });
    setOperationError('');
    watchQueuedCloudSync(currentUser.username, queuePushToCloud(currentUser.username, updated), '本次答题记录');
    return true;
  };

  const handleBatchSaveRecords = (records: UserRecord[]) => {
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return false;
    }
    const saved = tryLocalPersistence(() => batchSaveUserRecords(currentUser.username, records));
    if (!saved.success) {
      setOperationError(saved.message);
      return false;
    }
    const updated = saved.value;
    setUserRecords({ ...updated });
    setOperationError('');
    watchQueuedCloudSync(currentUser.username, queuePushToCloud(currentUser.username, updated), '批量录入记录');
    return true;
  };

  const handleUpdateExamPlan = (newPlan: ExamPlanConfig): boolean => {
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return false;
    }
    const saved = tryLocalPersistence(() => saveExamPlan(currentUser.username, newPlan));
    if (!saved.success) {
      setOperationError(saved.message);
      return false;
    }
    setExamPlanState(saved.value);
    setOperationError('');
    watchQueuedCloudSync(currentUser.username, queuePushToCloud(currentUser.username, userRecords), '备考计划');
    return true;
  };

  const handleAdminSharedDataChange = () => {
    setTeamMembers(getTeamMembers());
    setAnnouncements(getAnnouncements());
    setCurrentUserState(getCurrentUser());
    if (!currentUser) return;

    watchQueuedCloudSync(currentUser.username, queuePushToCloud(
      currentUser.username,
      getUserRecords(currentUser.username),
      { sharedDataAuthority: 'local' }
    ), '团队设置');
  };

  const handleUpdateSyncConfig = (cfg: SyncConfig) => {
    const saved = tryLocalPersistence(() => saveSyncConfig({
      ...getSyncConfig(),
      webdav_url: cfg.webdav_url,
      webdav_username: cfg.webdav_username,
      webdav_password: cfg.webdav_password,
      opencodego_api_key: cfg.opencodego_api_key,
      auto_sync: cfg.auto_sync
    }));
    if (!saved.success) {
      setOperationError(saved.message);
      return false;
    }
    setSyncConfigState(saved.value);
    setOperationError('');
    return true;
  };

  const handleTriggerSync = async () => {
    if (!manualSyncLockRef.current.tryLock()) return;
    setIsManualSyncing(true);
    try {
      if (currentUser) {
        const username = currentUser.username;
        const res = await pullCloudData(username);
        refreshAfterSync(username);
        setOperationError(res.success ? '' : res.message);
        alert(res.message);
      } else {
        const res = await pullSharedTeamData();
        setTeamMembers(getTeamMembers());
        setAnnouncements(getAnnouncements());
        setSyncConfigState(getSyncConfig());
        setOperationError(res.success ? '' : res.message);
        alert(res.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '云同步发生未知错误，请稍后重试';
      setOperationError(message);
      alert(message);
    } finally {
      manualSyncLockRef.current.release();
      setIsManualSyncing(false);
      setSyncConfigState(getSyncConfig());
    }
  };

  const handleNavigateTab = (
    tab: string,
    filterParams?: DrillFilter
  ) => {
    if (tab === 'admin' && currentUser?.role !== 'admin') {
      alert('管理中心仅限教研管理员访问！');
      return;
    }
    setActiveTab(tab);
    setDrillFilter(currentFilter => getNextDrillFilter(currentFilter, tab, filterParams));
  };

  const activeQuestionIds = allQuestions.map(question => question.id);
  const currentUserSummary = currentUser 
    ? getUserSummary(currentUser.username, activeQuestionIds)
    : {
        username: 'guest',
        real_name: '未登录访客',
        role: 'user' as const,
        daily_target: 10,
        focus_module: '几何' as const,
        plan_mode: 'balanced' as const,
        solved_count: 0,
        correct_count: 0,
        wrong_count: 0,
        accuracy_rate: 0,
        completion_rate: 0,
        streak_days: 0,
        last_active_at: ''
      };

  const leaderboard = getTeamLeaderboard(activeQuestionIds);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans antialiased">
      {/* Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleNavigateTab}
        currentUser={currentUser}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
        syncConfig={syncConfig}
        isSyncing={isManualSyncing}
        onTriggerSync={handleTriggerSync}
        onPasswordChanged={handleAdminSharedDataChange}
        daysRemaining={daysRemaining}
        examDate={examPlan.exam_date}
      />

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {operationError && (
          <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
            <span>⚠️ {operationError}</span>
            <button
              type="button"
              onClick={() => setOperationError('')}
              className="shrink-0 font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
              aria-label="关闭错误提示"
            >
              关闭
            </button>
          </div>
        )}
        {loadingBank ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-3">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-medium">正在载入高斯导引全套数字化题库...</p>
          </div>
        ) : bankLoadError ? (
          <div role="alert" className="max-w-lg mx-auto my-12 rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm space-y-4">
            <div className="text-3xl">⚠️</div>
            <div>
              <h2 className="text-base font-bold text-slate-900">题库没有加载成功</h2>
              <p className="mt-2 text-xs leading-relaxed text-rose-700">{bankLoadError}</p>
              <p className="mt-1 text-[11px] text-slate-500">请检查网络或部署文件，然后点击下方按钮重新载入。</p>
            </div>
            <button
              type="button"
              onClick={() => void reloadQuestionBank()}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
            >
              重新加载题库
            </button>
          </div>
        ) : (
          <>
            {bankLoadWarning && (
              <div role="status" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {bankLoadWarning}
              </div>
            )}
            {activeTab === 'dashboard' && (
              <DashboardView
                userSummary={currentUserSummary}
                allQuestions={allQuestions}
                chapters={chapters}
                daysRemaining={daysRemaining}
                onNavigateTab={handleNavigateTab}
                examPlan={examPlan}
                onUpdateExamPlan={handleUpdateExamPlan}
                announcements={announcements}
                userRecords={userRecords}
              />
            )}

            {activeTab === 'card_drill' && (
              <CardDrillView
                chapters={chapters}
                allQuestions={allQuestions}
                userRecords={userRecords}
                onSaveRecord={handleSaveRecord}
                initialFilter={drillFilter}
              />
            )}

            {activeTab === 'quick_entry' && (
              <QuickEntryView
                chapters={chapters}
                allQuestions={allQuestions}
                userRecords={userRecords}
                onBatchSaveRecords={handleBatchSaveRecords}
              />
            )}

            {activeTab === 'ebbinghaus_error' && (
              <EbbinghausErrorView
                allQuestions={allQuestions}
                userRecords={userRecords}
                onSaveRecord={handleSaveRecord}
                onNavigateToDrill={() => handleNavigateTab('card_drill')}
              />
            )}

            {activeTab === 'paper' && (
              <PaperGeneratorView
                allQuestions={allQuestions}
                userRecords={userRecords}
                onBatchSaveRecords={handleBatchSaveRecords}
                onNavigateToErrorBook={() => setActiveTab('ebbinghaus_error')}
              />
            )}

            {activeTab === 'leaderboard' && (
              <LeaderboardView
                leaderboard={leaderboard}
                currentUsername={currentUser?.username}
                totalQuestionsCount={allQuestions.length}
              />
            )}

            {activeTab === 'admin' && (
              currentUser?.role === 'admin' ? (
                <AdminView
                  members={teamMembers}
                  onRefreshMembers={handleAdminSharedDataChange}
                  syncConfig={syncConfig}
                  onUpdateSyncConfig={handleUpdateSyncConfig}
                  examDate={examPlan.exam_date}
                  daysRemaining={daysRemaining}
                  onAddAnnouncement={(ann) => {
                    const saved = tryLocalPersistence(() => addAnnouncement(ann));
                    if (!saved.success) {
                      setOperationError(saved.message);
                      return false;
                    }
                    setOperationError('');
                    handleAdminSharedDataChange();
                    return true;
                  }}
                  leaderboardData={leaderboard}
                  totalQuestionsCount={allQuestions.length}
                  currentUser={currentUser}
                />
              ) : (
                <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm max-w-md mx-auto my-12 space-y-3">
                  <h3 className="text-sm font-bold text-slate-800">无访问权限</h3>
                  <p className="text-xs text-slate-500">管理中心仅限教研管理员账号访问。</p>
                  <button
                    onClick={() => setActiveTab('card_drill')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    返回卡片刷题
                  </button>
                </div>
              )
            )}
          </>
        )}
      </main>

      {/* Zen Wooden Fish Easter Egg Widget */}
      <EasterEggWoodFish />

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        onRefreshAccounts={refreshSharedAccounts}
      />
    </div>
  );
}
