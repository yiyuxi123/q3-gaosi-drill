import React, { useEffect, useRef, useState } from 'react';
import { 
  Calendar, 
  CloudCheck, 
  CloudOff, 
  LogOut, 
  User, 
  ShieldCheck, 
  FileText, 
  CheckCircle2, 
  BookOpen, 
  Trophy, 
  Settings, 
  Sparkles,
  RefreshCw,
  KeyRound,
  LayoutDashboard
} from 'lucide-react';
import type { TeamMember, SyncConfig } from '../types';
import { changeCurrentUserPassword, describeLocalPersistenceError, isLocalPersistenceError } from '../services/storage';
import { formatExamDate } from '../services/examPlan';
import { getAvatarInitial } from '../services/userDisplay';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: TeamMember | null;
  onOpenLogin: () => void;
  onLogout: () => void;
  syncConfig: SyncConfig;
  isSyncing: boolean;
  onTriggerSync: () => void;
  onPasswordChanged: () => void;
  daysRemaining: number;
  examDate: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onOpenLogin,
  onLogout,
  syncConfig,
  isSyncing,
  onTriggerSync,
  onPasswordChanged,
  daysRemaining,
  examDate
}) => {
  const [isChangePassOpen, setIsChangePassOpen] = useState<boolean>(false);
  const [oldPass, setOldPass] = useState<string>('');
  const [newPass, setNewPass] = useState<string>('');
  const [passMsg, setPassMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const passwordCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPasswordCloseTimer = () => {
    if (passwordCloseTimerRef.current !== null) {
      clearTimeout(passwordCloseTimerRef.current);
      passwordCloseTimerRef.current = null;
    }
  };

  const resetPasswordModal = () => {
    clearPasswordCloseTimer();
    setIsChangePassOpen(false);
    setOldPass('');
    setNewPass('');
    setPassMsg(null);
  };

  const closePasswordModal = () => {
    if (isSavingPassword) return;
    resetPasswordModal();
  };

  const openPasswordModal = () => {
    clearPasswordCloseTimer();
    setOldPass('');
    setNewPass('');
    setPassMsg(null);
    setIsChangePassOpen(true);
  };

  useEffect(() => {
    // A password modal belongs to one login session only.
    resetPasswordModal();
    setIsSavingPassword(false);
  }, [currentUser?.username, currentUser?.account_id]);

  useEffect(() => () => clearPasswordCloseTimer(), []);

  const navItems = [
    { id: 'dashboard', label: '备考首页', icon: LayoutDashboard },
    { id: 'card_drill', label: '卡片刷题', icon: BookOpen },
    { id: 'quick_entry', label: '快速录入', icon: CheckCircle2 },
    { id: 'ebbinghaus_error', label: '艾宾浩斯错题', icon: Sparkles },
    { id: 'paper', label: '组卷打印', icon: FileText },
    { id: 'leaderboard', label: '排行榜', icon: Trophy },
    ...(currentUser?.role === 'admin' ? [{ id: 'admin', label: '管理中心', icon: Settings }] : [])
  ];

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || isSavingPassword) return;
    setPassMsg(null);
    setIsSavingPassword(true);

    try {
      if (newPass.length < 3) {
        setPassMsg({ type: 'error', text: '新密码长度至少为 3 位！' });
        return;
      }

      const result = await changeCurrentUserPassword(currentUser.username, oldPass, newPass);
      if (!result.success) {
        setPassMsg({ type: 'error', text: result.message });
        return;
      }
      onPasswordChanged();
      setPassMsg({ type: 'success', text: '密码修改成功，正在同步到其他设备。' });
      setOldPass('');
      setNewPass('');
      clearPasswordCloseTimer();
      passwordCloseTimerRef.current = setTimeout(() => {
        passwordCloseTimerRef.current = null;
        setIsChangePassOpen(false);
        setPassMsg(null);
      }, 1500);
    } catch (error) {
      setPassMsg({
        type: 'error',
        text: isLocalPersistenceError(error)
          ? describeLocalPersistenceError(error)
          : error instanceof Error ? error.message : '密码修改失败'
      });
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <header className="no-print sticky top-0 z-40 bg-white border-b border-slate-200">
      {/* Top Countdown Banner */}
      <div className="bg-slate-900 text-white px-4 py-1.5 text-xs font-medium flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Calendar className="w-3.5 h-3.5 text-blue-400" />
          <span>
            目标：<strong className="font-semibold text-slate-100">{formatExamDate(examDate)}</strong> 第三季度考
          </span>
          <span className="bg-blue-600 text-white font-bold px-2 py-0.2 rounded text-[11px]">
            倒计时 {daysRemaining} 天
          </span>
        </div>
        <div className="flex items-center space-x-3 text-[11px] text-slate-300">
          <button 
            onClick={onTriggerSync} 
            disabled={isSyncing}
            className="hover:text-white flex items-center space-x-1 transition cursor-pointer bg-slate-800 hover:bg-slate-700 disabled:cursor-wait disabled:opacity-70 px-2 py-0.5 rounded"
            title="点击与坚果云多端同步"
          >
            {isSyncing || syncConfig.sync_status === 'syncing' ? (
              <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
            ) : syncConfig.sync_status === 'error' ? (
              <CloudOff className="w-3 h-3 text-red-400" />
            ) : (
              <CloudCheck className="w-3 h-3 text-emerald-400" />
            )}
            <span>坚果云同步：{isSyncing ? '同步中…' : syncConfig.last_synced_at || '就绪'}</span>
          </button>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div 
            onClick={() => setActiveTab('dashboard')} 
            className="flex items-center space-x-3 cursor-pointer select-none"
          >
            <img
              src="/logo.png"
              alt="卓越教育"
              className="h-9 object-contain"
            />
            <div className="border-l border-slate-200 pl-3">
              <span className="font-bold text-slate-900 text-sm sm:text-base tracking-tight block">
                Q3 季度考智能备考
              </span>
              <span className="text-[10px] text-slate-500 hidden sm:block">
                高斯导引全套15讲 · 团队云同步
              </span>
            </div>
          </div>

          {/* Desktop Nav Items */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User Profile / Auth Area */}
          <div className="flex items-center space-x-2">
            {currentUser ? (
              <div className="flex items-center space-x-2 bg-slate-50 hover:bg-slate-100 p-1.5 rounded-xl border border-slate-200 transition">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  {getAvatarInitial(currentUser.real_name, currentUser.username)}
                </div>
                <div className="text-left pr-1 hidden sm:block">
                  <div className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                    <span>{currentUser.real_name}</span>
                    {currentUser.role === 'admin' && (
                      <span title="管理员"><ShieldCheck className="w-3.5 h-3.5 text-amber-600" /></span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    账号: {currentUser.username}
                  </div>
                </div>

                <button
                  onClick={openPasswordModal}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg transition"
                  title="修改我的私密密码"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition"
                  title="退出登录"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenLogin}
                className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition"
              >
                <User className="w-3.5 h-3.5" />
                <span>登录账号</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Nav Bar */}
        <div className="md:hidden flex items-center justify-between overflow-x-auto py-2 border-t border-slate-100 space-x-1 no-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center flex-1 min-w-[50px] py-1 px-1 rounded-md text-[10px] font-medium ${
                  isActive ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-500'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Change Password Modal */}
      {isChangePassOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="修改密码"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 border border-slate-200 space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
                <KeyRound className="w-4 h-4 text-blue-600" />
                <span>修改个人私密密码</span>
              </h3>
              <button
                type="button"
                onClick={closePasswordModal}
                disabled={isSavingPassword}
                aria-label="关闭修改密码窗口"
                className="text-slate-400 hover:text-slate-600 disabled:cursor-wait disabled:opacity-40"
              >
                &times;
              </button>
            </div>

            {passMsg && (
              <div className={`p-2.5 rounded-xl text-xs font-medium ${
                passMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {passMsg.text}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">当前原密码</label>
                <input
                  type="password"
                  required
                  placeholder="请输入当前密码 (默认: 123)"
                  value={oldPass}
                  onChange={(e) => setOldPass(e.target.value)}
                  disabled={isSavingPassword}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:outline-hidden focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">新密码</label>
                <input
                  type="password"
                  required
                  placeholder="请输入您的新私密密码"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  disabled={isSavingPassword}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:outline-hidden focus:border-blue-600"
                />
              </div>

              <div className="pt-2 flex space-x-2">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  disabled={isSavingPassword}
                  className="flex-1 py-2 bg-slate-100 disabled:bg-slate-50 text-slate-600 disabled:text-slate-300 rounded-xl font-bold hover:bg-slate-200 cursor-pointer disabled:cursor-wait"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSavingPassword}
                  className="flex-1 py-2 bg-blue-600 disabled:bg-blue-300 text-white rounded-xl font-bold hover:bg-blue-700 shadow-xs cursor-pointer disabled:cursor-wait"
                >
                  {isSavingPassword ? '保存中…' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
