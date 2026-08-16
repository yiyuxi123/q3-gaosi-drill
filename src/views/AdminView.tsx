import React, { useEffect, useRef, useState } from 'react';
import { 
  Users, 
  ShieldCheck, 
  KeyRound, 
  UserPlus, 
  Trash2, 
  Download, 
  FileText,
  Megaphone, 
  CloudCheck, 
  Check, 
  AlertCircle,
  Save,
  Eye,
  EyeOff,
  Undo2,
  Pencil,
  X
} from 'lucide-react';
import type { TeamMember, SyncConfig, TeamAnnouncement, UserSummary } from '../types';
import { addTeamMember, createAnnouncementId, deleteTeamMember, describeLocalPersistenceError, getDefaultPasswordForMember, getRecoverableDeletedMembers, isLocalPersistenceError, restoreTeamMember, setUserPassword, updateTeamMember, DEFAULT_PASSWORD } from '../services/storage';
import { ReportExportModal } from '../components/ReportExportModal';
import { buildLeaderboardCsv } from '../services/csvExport';
import { deliverFiles, isMobileLike } from '../services/fileDelivery';
import { createLatestCallbackTimer, createSubmissionLock } from '../services/practiceSession';

interface AdminViewProps {
  members: TeamMember[];
  onRefreshMembers: () => void;
  syncConfig: SyncConfig;
  onUpdateSyncConfig: (cfg: SyncConfig) => boolean;
  examDate: string;
  daysRemaining: number;
  onAddAnnouncement: (ann: TeamAnnouncement) => boolean;
  leaderboardData: UserSummary[];
  totalQuestionsCount: number;
  currentUser: TeamMember | null;
}

export const AdminView: React.FC<AdminViewProps> = ({
  members,
  onRefreshMembers,
  syncConfig,
  onUpdateSyncConfig,
  examDate,
  daysRemaining,
  onAddAnnouncement,
  leaderboardData,
  totalQuestionsCount,
  currentUser
}) => {
  const [activeTab, setActiveTab] = useState<'members' | 'sync' | 'announcements'>('members');
  
  // New Member State
  const [newUsername, setNewUsername] = useState('');
  const [newRealName, setNewRealName] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  const [memberAction, setMemberAction] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editRealName, setEditRealName] = useState('');
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user');
  const recoverableMembers = getRecoverableDeletedMembers();

  // Sync Form State
  const [tempSync, setTempSync] = useState<SyncConfig>(syncConfig);
  const [isSyncDraftDirty, setIsSyncDraftDirty] = useState(false);
  const [syncSaved, setSyncSaved] = useState(false);
  const [syncSaveError, setSyncSaveError] = useState('');
  const [showWebdavPassword, setShowWebdavPassword] = useState(true);
  const [showApiKey, setShowApiKey] = useState(true);
  const syncSavedTimerRef = useRef(createLatestCallbackTimer());

  // Announcement Form State
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annSuccess, setAnnSuccess] = useState(false);
  const [annError, setAnnError] = useState('');
  const [annPublishing, setAnnPublishing] = useState(false);
  const announcementLockRef = useRef(createSubmissionLock());
  const announcementSuccessTimerRef = useRef(createLatestCallbackTimer());
  const csvExportLockRef = useRef(createSubmissionLock());
  const [isCsvExporting, setIsCsvExporting] = useState(false);
  const [csvExportStatus, setCsvExportStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (!isSyncDraftDirty) setTempSync(syncConfig);
  }, [syncConfig, isSyncDraftDirty]);

  useEffect(() => () => {
    syncSavedTimerRef.current.clear();
    announcementSuccessTimerRef.current.clear();
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (memberAction) return;
    setMemberError('');
    setMemberSuccess('');

    if (!newUsername.trim() || !newRealName.trim()) {
      setMemberError('请完整填写姓名和拼音缩写！');
      return;
    }

    try {
      setMemberAction('adding');
      await addTeamMember({
        username: newUsername.trim().toLowerCase(),
        real_name: newRealName.trim(),
        role: newRole,
        created_at: new Date().toISOString().slice(0, 10),
        last_login_at: new Date().toISOString()
      }, DEFAULT_PASSWORD);

      setMemberSuccess(`成员【${newRealName}】添加成功！初始密码为: ${DEFAULT_PASSWORD}`);
      setNewUsername('');
      setNewRealName('');
      onRefreshMembers();
    } catch (err: any) {
      setMemberError(isLocalPersistenceError(err) ? describeLocalPersistenceError(err) : err.message || '添加失败');
    } finally {
      setMemberAction(null);
    }
  };

  const handleDeleteMember = (username: string) => {
    if (username === 'admin') {
      alert('系统内置教研管理员账号不可删除！');
      return;
    }
    if (currentUser?.username.toLowerCase() === username.toLowerCase()) {
      alert('不能注销当前正在使用的管理员账号。请先登录其他管理员账号后再操作！');
      return;
    }
    if (confirm(`确定要注销成员账号 [${username}] 吗？`)) {
      try {
        setMemberError('');
        deleteTeamMember(username);
        onRefreshMembers();
      } catch (error) {
        setMemberError(isLocalPersistenceError(error)
          ? describeLocalPersistenceError(error)
          : error instanceof Error ? error.message : '注销成员失败，请重试');
      }
    }
  };

  const handleResetPassword = async (m: TeamMember) => {
    if (memberAction) return;
    const resetPassword = getDefaultPasswordForMember(m.username);
    try {
      setMemberAction(m.username);
      await setUserPassword(m.username, resetPassword);
      onRefreshMembers();
      alert(`成员 ${m.real_name} (${m.username}) 的密码已重置为: ${resetPassword}`);
    } catch (error) {
      alert(isLocalPersistenceError(error)
        ? describeLocalPersistenceError(error)
        : error instanceof Error ? error.message : '密码重置失败');
    } finally {
      setMemberAction(null);
    }
  };

  const startEditingMember = (member: TeamMember) => {
    if (memberAction) return;
    setMemberError('');
    setMemberSuccess('');
    setEditingUsername(member.username);
    setEditRealName(member.real_name);
    setEditRole(member.role);
  };

  const handleSaveMember = (member: TeamMember) => {
    if (memberAction) return;
    try {
      setMemberAction(`edit:${member.username}`);
      setMemberError('');
      const updated = updateTeamMember(member.username, {
        real_name: editRealName,
        role: editRole
      });
      setMemberSuccess(`成员【${updated.real_name}】的资料已更新并等待云同步。`);
      setEditingUsername(null);
      onRefreshMembers();
    } catch (error) {
      setMemberError(isLocalPersistenceError(error)
        ? describeLocalPersistenceError(error)
        : error instanceof Error ? error.message : '成员资料修改失败');
    } finally {
      setMemberAction(null);
    }
  };

  const handleRestoreMember = (username: string) => {
    try {
      setMemberError('');
      const restored = restoreTeamMember(username);
      setMemberSuccess(`成员【${restored.real_name}】已恢复；下次同步会重新启用坚果云历史数据。`);
      onRefreshMembers();
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : '恢复成员失败');
    }
  };

  const handleSaveSync = () => {
    syncSavedTimerRef.current.clear();
    setSyncSaveError('');
    const updatedConfig: SyncConfig = {
      ...syncConfig,
      webdav_url: tempSync.webdav_url,
      webdav_username: tempSync.webdav_username,
      webdav_password: tempSync.webdav_password,
      opencodego_api_key: tempSync.opencodego_api_key,
      auto_sync: tempSync.auto_sync
    };
    if (!onUpdateSyncConfig(updatedConfig)) {
      setSyncSaved(false);
      setSyncSaveError('同步配置没有保存成功，请按页面顶部提示处理后重试。');
      return;
    }
    setTempSync(updatedConfig);
    setIsSyncDraftDirty(false);
    setSyncSaved(true);
    syncSavedTimerRef.current.schedule(() => setSyncSaved(false), 2000);
  };

  const handlePublishAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annContent.trim()) return;
    if (!announcementLockRef.current.tryLock()) return;
    announcementSuccessTimerRef.current.clear();
    setAnnError('');
    setAnnPublishing(true);

    let saved = false;
    try {
      saved = onAddAnnouncement({
        id: createAnnouncementId(),
        title: annTitle.trim(),
        content: annContent.trim(),
        created_at: new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        author: currentUser?.real_name || '教研管理员',
        is_pinned: true
      });
    } catch (error) {
      setAnnError(error instanceof Error ? error.message : '公告发布失败，请重试。');
    }
    if (!saved) {
      announcementLockRef.current.release();
      setAnnPublishing(false);
      setAnnSuccess(false);
      setAnnError(current => current || '公告没有发布成功，请按页面顶部提示处理后重试。');
      return;
    }

    setAnnTitle('');
    setAnnContent('');
    setAnnPublishing(false);
    setAnnSuccess(true);
    announcementSuccessTimerRef.current.schedule(() => setAnnSuccess(false), 2500);
  };

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleExportCSV = async () => {
    if (!csvExportLockRef.current.tryLock()) return;
    setIsCsvExporting(true);
    setCsvExportStatus({ type: 'info', text: '正在准备 CSV 文件…' });
    try {
      const content = buildLeaderboardCsv(leaderboardData);
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const mode = await deliverFiles([{
        blob,
        filename: `2026_Q3备考全员学情报表_${new Date().toISOString().slice(0, 10)}.csv`
      }], {
        title: '2026 Q3 备考全员学情报表',
        text: '团队备考学情 CSV 数据',
        preferShare: isMobileLike()
      });
      setCsvExportStatus({
        type: 'success',
        text: mode === 'shared' ? 'CSV 已生成，请选择保存位置或发送到微信。' : 'CSV 已下载。'
      });
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      setCsvExportStatus({
        type: cancelled ? 'info' : 'error',
        text: cancelled ? '已取消导出。' : error instanceof Error ? `CSV 导出失败：${error.message}` : 'CSV 导出失败，请重试'
      });
    } finally {
      csvExportLockRef.current.release();
      setIsCsvExporting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <h1 className="text-base font-bold text-slate-900 m-0">教研管理后台</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            团队账号管理 · 拼音缩写配置 · 坚果云云同步 · 全员学情报表导出
          </p>
        </div>

        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button
            onClick={handleExportCSV}
            disabled={isCsvExporting}
            className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-xs transition cursor-pointer disabled:cursor-wait"
          >
            <Download className="w-4 h-4" />
            <span>{isCsvExporting ? '正在导出…' : '导出 CSV'}</span>
          </button>
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>图片 / PDF / 分享</span>
          </button>
        </div>
      </div>

      {csvExportStatus && (
        <div className={`p-3 text-xs rounded-xl border flex items-center space-x-2 ${
          csvExportStatus.type === 'success'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : csvExportStatus.type === 'error'
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : 'bg-blue-50 text-blue-700 border-blue-200'
        }`}>
          {csvExportStatus.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          <span>{csvExportStatus.text}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2">
        {[
          { id: 'members', label: '团队成员管理', icon: Users },
          { id: 'sync', label: '坚果云与大模型配置', icon: CloudCheck },
          { id: 'announcements', label: '全员备考动员通知', icon: Megaphone },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Members */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* Add Member Card */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5 m-0">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <span>添加新成员 (姓名拼音缩写账号)</span>
            </h2>

            {memberError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{memberError}</span>
              </div>
            )}

            {memberSuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-xl border border-emerald-200 flex items-center space-x-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{memberSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddMember} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">真实姓名</label>
                <input
                  type="text"
                  required
                  placeholder="如: 陈九"
                  value={newRealName}
                  onChange={(e) => setNewRealName(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">拼音缩写账号 (小写)</label>
                <input
                  type="text"
                  required
                  placeholder="如: cj"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">权限角色</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-white"
                >
                  <option value="user">普通备考教师</option>
                  <option value="admin">教研管理员</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={memberAction === 'adding'}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:cursor-wait flex items-center justify-center space-x-1"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{memberAction === 'adding' ? '添加中…' : '确认添加'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Members Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">全体成员列表 ({members.length} 人)</span>
              <span className="text-[11px] text-slate-400">普通成员初始密码为 123</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4">教师姓名</th>
                    <th className="py-3 px-4">拼音缩写账号</th>
                    <th className="py-3 px-4">权限角色</th>
                    <th className="py-3 px-4">加入日期</th>
                    <th className="py-3 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr key={m.username} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {editingUsername === m.username ? (
                          <input
                            value={editRealName}
                            onChange={(event) => setEditRealName(event.target.value)}
                            className="w-28 rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold"
                            aria-label={`修改 ${m.username} 的姓名`}
                          />
                        ) : m.real_name}
                      </td>
                      <td className="py-3 px-4 font-mono text-blue-600 font-bold">{m.username}</td>
                      <td className="py-3 px-4">
                        {editingUsername === m.username ? (
                          <select
                            value={editRole}
                            onChange={(event) => setEditRole(event.target.value as 'user' | 'admin')}
                            disabled={m.username === 'admin' || currentUser?.username.toLowerCase() === m.username.toLowerCase()}
                            className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] disabled:bg-slate-100"
                            aria-label={`修改 ${m.username} 的权限角色`}
                          >
                            <option value="user">普通教师</option>
                            <option value="admin">管理员</option>
                          </select>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {m.role === 'admin' ? '管理员' : '教师'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{m.created_at}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {editingUsername === m.username ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveMember(m)}
                              disabled={memberAction === `edit:${m.username}`}
                              className="px-2 py-1 bg-blue-600 disabled:bg-blue-300 text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:cursor-wait"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUsername(null)}
                              className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
                              title="取消编辑"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditingMember(m)}
                            className="p-1 text-slate-400 hover:text-blue-600 rounded transition cursor-pointer"
                            title="编辑姓名与角色"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleResetPassword(m)}
                          disabled={memberAction === m.username}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg text-[11px] font-bold transition cursor-pointer disabled:cursor-wait inline-flex items-center space-x-1"
                        >
                          <KeyRound className="w-3 h-3 text-slate-500" />
                          <span>重置密码</span>
                        </button>
                        {m.username !== 'admin' && (
                          <button
                            onClick={() => handleDeleteMember(m.username)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition cursor-pointer"
                            title="注销该成员"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {recoverableMembers.length > 0 && (
            <div className="bg-amber-50 rounded-3xl border border-amber-200 p-4 space-y-3">
              <div>
                <div className="text-xs font-bold text-amber-950">账号回收站 ({recoverableMembers.length})</div>
                <div className="text-[11px] text-amber-800 mt-0.5">坚果云仅保存删除标记，历史刷题数据仍可恢复。</div>
              </div>
              <div className="space-y-2">
                {recoverableMembers.map(({ member, deletedAt }) => (
                  <div key={member.username} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2">
                    <div className="text-xs">
                      <span className="font-bold text-slate-900">{member.real_name}</span>
                      <span className="ml-2 font-mono text-slate-500">{member.username}</span>
                      <span className="ml-2 text-[10px] text-slate-400">删除于 {new Date(deletedAt).toLocaleString('zh-CN')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreMember(member.username)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600 cursor-pointer"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      恢复账号
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Sync Config */}
      {activeTab === 'sync' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4 max-w-2xl">
          <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5 m-0">
            <CloudCheck className="w-4 h-4 text-blue-600" />
            <span>坚果云 WebDAV & 大模型 API 配置</span>
          </h2>

          {syncSaved && (
            <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-xl border border-emerald-200 flex items-center space-x-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>配置已保存成功！多端同步将自动使用最新凭据。</span>
            </div>
          )}
          {syncSaveError && (
            <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{syncSaveError}</span>
            </div>
          )}

          <div className="space-y-3">
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-[11px] leading-relaxed text-amber-800">
              本安装包已内置默认同步凭据，首次打开即可使用。下面的账号、授权码和 API Key 可直接查看，也可修改后保存到本机。
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">坚果云 WebDAV 地址</label>
              <input
                type="text"
                value={tempSync.webdav_url}
                onChange={(e) => { setIsSyncDraftDirty(true); setTempSync({ ...tempSync, webdav_url: e.target.value }); }}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-200 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">坚果云注册邮箱账号</label>
              <input
                type="text"
                value={tempSync.webdav_username}
                onChange={(e) => { setIsSyncDraftDirty(true); setTempSync({ ...tempSync, webdav_username: e.target.value }); }}
                className="w-full p-2.5 text-xs rounded-xl border border-slate-200 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">坚果云第三方应用授权码</label>
              <div className="relative">
                <input
                  type={showWebdavPassword ? 'text' : 'password'}
                  value={tempSync.webdav_password}
                  onChange={(e) => { setIsSyncDraftDirty(true); setTempSync({ ...tempSync, webdav_password: e.target.value }); }}
                  className="w-full p-2.5 pr-10 text-xs rounded-xl border border-slate-200 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowWebdavPassword(value => !value)}
                  className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-blue-600 cursor-pointer"
                  aria-label={showWebdavPassword ? '隐藏坚果云授权码' : '显示坚果云授权码'}
                >
                  {showWebdavPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">OpenCodeGo / DeepSeek API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={tempSync.opencodego_api_key}
                  onChange={(e) => { setIsSyncDraftDirty(true); setTempSync({ ...tempSync, opencodego_api_key: e.target.value }); }}
                  className="w-full p-2.5 pr-10 text-xs rounded-xl border border-slate-200 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(value => !value)}
                  className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-blue-600 cursor-pointer"
                  aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-3">
              <button
                type="button"
                onClick={handleSaveSync}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1.5 shadow-xs"
              >
                <Save className="w-4 h-4" />
                <span>保存云同步配置</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Announcements */}
      {activeTab === 'announcements' && (
        <div className="space-y-6 max-w-2xl">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5 m-0">
              <Megaphone className="w-4 h-4 text-blue-600" />
              <span>发布全员备考置顶动员通知</span>
            </h2>

            {annSuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-xl border border-emerald-200 flex items-center space-x-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>通知已成功发布，并在全员首页大盘顶部置顶展示！</span>
              </div>
            )}
            {annError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{annError}</span>
              </div>
            )}

            <form onSubmit={handlePublishAnnouncement} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">通知标题</label>
                <input
                  type="text"
                  required
                  placeholder="如: 距9.18季度考倒计时30天冲刺动员"
                  value={annTitle}
                  onChange={(e) => {
                    announcementLockRef.current.reset();
                    setAnnPublishing(false);
                    setAnnSuccess(false);
                    setAnnTitle(e.target.value);
                  }}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">通知详情内容</label>
                <textarea
                  rows={4}
                  required
                  placeholder="请输入通知详细内容..."
                  value={annContent}
                  onChange={(e) => {
                    announcementLockRef.current.reset();
                    setAnnPublishing(false);
                    setAnnSuccess(false);
                    setAnnContent(e.target.value);
                  }}
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200"
                />
              </div>

              <button
                type="submit"
                disabled={annPublishing || !annTitle.trim() || !annContent.trim()}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center space-x-1.5 shadow-xs"
              >
                <Megaphone className="w-4 h-4" />
                <span>{annPublishing ? '发布中…' : '立即发布并置顶'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Brand High-Res Graphic & PDF Report Export Modal with WeChat Native Share */}
      <ReportExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        leaderboardData={leaderboardData}
        totalQuestionsCount={totalQuestionsCount}
        examDate={examDate}
        daysRemaining={daysRemaining}
      />
    </div>
  );
};
