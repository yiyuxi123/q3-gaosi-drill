import React, { useRef, useState } from 'react';
import { User, Lock, ArrowRight, AlertCircle } from 'lucide-react';
import { authenticateUser, describeLocalPersistenceError, isLocalPersistenceError } from '../services/storage';
import type { TeamMember } from '../types';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: TeamMember) => void;
  onRefreshAccounts?: () => Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLoginSuccess, onRefreshAccounts }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loginRequestIdRef = useRef(0);

  if (!isOpen) return null;

  const handleClose = () => {
    loginRequestIdRef.current += 1;
    setPassword('');
    setErrorMsg('');
    setIsSubmitting(false);
    onClose();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg('');
    setIsSubmitting(true);
    const requestId = ++loginRequestIdRef.current;

    try {
      // Prefer the authoritative roster so a password changed on another
      // device cannot be bypassed by an obsolete local credential. Offline
      // failures are non-throwing and still fall back to the local snapshot.
      if (onRefreshAccounts) await onRefreshAccounts();
      if (requestId !== loginRequestIdRef.current) return;
      const res = await authenticateUser(username, password);
      if (requestId !== loginRequestIdRef.current) return;
      if (!res.success || !res.user) {
        setErrorMsg(res.message || '登录失败，请检查账号与密码');
        return;
      }

      setUsername('');
      setPassword('');
      setErrorMsg('');
      onLoginSuccess(res.user);
      onClose();
    } catch (error) {
      if (requestId === loginRequestIdRef.current) {
        setErrorMsg(isLocalPersistenceError(error)
          ? describeLocalPersistenceError(error)
          : error instanceof Error ? error.message : '登录失败，请稍后重试');
      }
    } finally {
      if (requestId === loginRequestIdRef.current) setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="账号登录"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
        {/* Header with 卓越教育 Logo */}
        <div className="p-6 text-center border-b border-slate-100 bg-slate-50/50">
          <div className="flex justify-center mb-3">
            <img 
              src="/logo.png" 
              alt="卓越教育" 
              className="h-12 object-contain"
            />
          </div>
          <h2 className="text-base font-bold text-slate-800 m-0">2026 Q3 季度考备考登录</h2>
          <p className="text-xs text-slate-500 mt-1">
            个人专属账号登录 · 严格数据隔离与坚果云多端同步
          </p>
        </div>

        {/* Body Form */}
        <div className="p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            {errorMsg && (
              <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs border border-rose-200 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>姓名拼音缩写 (登录账号)</span>
                <span className="text-[11px] text-slate-400 font-normal">如: 张三输入 zs</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="请输入您的拼音缩写 (如: zs / ls / ww / admin)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-50 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>个人私密密码</span>
                <span className="text-[11px] text-slate-400 font-normal">初始默认: 123</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  placeholder="请输入您的密码 (初始默认: 123)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:cursor-wait flex items-center justify-center space-x-1.5 mt-2"
            >
              <span>{isSubmitting ? '正在核对账号…' : '确认登录进入我的题库'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Footer Note */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>登录后可在右上角随时修改个人密码</span>
          <button onClick={handleClose} className="hover:text-slate-600 cursor-pointer">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
