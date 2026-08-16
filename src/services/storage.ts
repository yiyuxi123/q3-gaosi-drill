import type {
  UserRecord,
  UserSummary,
  TeamMember,
  ExamPlanConfig,
  TeamAnnouncement,
  TeamMemberMutation,
  Question,
  TeamErrorItem
} from '../types';
import { createPasswordCredential, verifyPasswordCredential } from './passwordCredential';
import { parseLocalExamDate } from './examPlan';

const STORAGE_KEYS = {
  CURRENT_USER: 'strj_current_user',
  MEMBERS: 'strj_team_members',
  USER_PASSWORDS: 'strj_user_passwords',
  RECORDS_PREFIX: 'strj_records_',
  PLANS_PREFIX: 'strj_plan_',
  ANNOUNCEMENTS: 'strj_announcements',
  SYNC_CONFIG: 'strj_sync_config',
  PENDING_DELETED_USERS: 'strj_pending_deleted_users',
  MEMBER_MUTATIONS: 'strj_member_mutations',
};

export type LocalPersistenceResult<T> =
  | { success: true; value: T }
  | { success: false; message: string };

export function isLocalPersistenceError(error: unknown): boolean {
  const errorName = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : '';
  return errorName === 'QuotaExceededError'
    || errorName === 'NS_ERROR_DOM_QUOTA_REACHED'
    || errorName === 'SecurityError'
    || errorName === 'NotAllowedError';
}

export function describeLocalPersistenceError(error: unknown): string {
  const errorName = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : '';
  if (errorName === 'QuotaExceededError' || errorName === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return '本机存储空间不足，数据尚未保存。请清理浏览器站点数据或磁盘空间后重试。';
  }
  if (errorName === 'SecurityError' || errorName === 'NotAllowedError') {
    return '浏览器禁止本机存储，数据尚未保存。请关闭无痕模式或允许此站点保存数据后重试。';
  }
  const detail = error instanceof Error && error.message ? `：${error.message}` : '';
  return `本机保存失败${detail}`;
}

export function tryLocalPersistence<T>(operation: () => T): LocalPersistenceResult<T> {
  try {
    return { success: true, value: operation() };
  } catch (error) {
    return { success: false, message: describeLocalPersistenceError(error) };
  }
}

function runLocalStorageTransaction<T>(keys: string[], operation: () => T): T {
  const uniqueKeys = [...new Set(keys)];
  const snapshots = new Map<string, string | null>();
  uniqueKeys.forEach(key => snapshots.set(key, localStorage.getItem(key)));

  try {
    return operation();
  } catch (error) {
    // Best-effort rollback keeps a failed multi-key account operation from
    // being reported as failed after only half of it has already taken effect.
    [...uniqueKeys].reverse().forEach(key => {
      try {
        const previous = snapshots.get(key);
        if (previous === null || previous === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
      } catch {
        // Preserve the original failure; attempt every remaining rollback key.
      }
    });
    throw error;
  }
}

// Initial default team members
export const DEFAULT_MEMBERS: TeamMember[] = [
  { username: 'admin', real_name: '教研管理员', role: 'admin', created_at: '2026-08-01', last_login_at: '2026-08-15' },
  { username: 'zs', real_name: '张三', role: 'user', created_at: '2026-08-01', last_login_at: '2026-08-15' },
  { username: 'ls', real_name: '李四', role: 'user', created_at: '2026-08-01', last_login_at: '2026-08-14' },
  { username: 'ww', real_name: '王五', role: 'user', created_at: '2026-08-01', last_login_at: '2026-08-15' },
  { username: 'zl', real_name: '赵六', role: 'user', created_at: '2026-08-02', last_login_at: '2026-08-13' },
  { username: 'qj', real_name: '钱七', role: 'user', created_at: '2026-08-03', last_login_at: '2026-08-14' },
  { username: 'sb', real_name: '孙八', role: 'user', created_at: '2026-08-04', last_login_at: '2026-08-15' },
];

function cloneDefaultMembers(): TeamMember[] {
  return DEFAULT_MEMBERS.map(member => ({ ...member }));
}

function isStoredTeamMember(value: unknown): value is TeamMember {
  if (!value || typeof value !== 'object') return false;
  const member = value as Partial<TeamMember>;
  return typeof member.username === 'string'
    && member.username.trim().length > 0
    && typeof member.real_name === 'string'
    && (member.role === 'user' || member.role === 'admin');
}

export const DEFAULT_PASSWORD = '123';
export const ADMIN_PASSWORD = '1415926';
const DEFAULT_EXAM_PLAN: ExamPlanConfig = {
  mode: 'balanced',
  focus_module: '几何',
  daily_target: 10,
  exam_date: '2026-09-18'
};
const MATH_MODULES = new Set(['计算', '计数', '数论', '几何', '应用题', '数字谜', '组合数学']);

function createAccountId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `account-${globalThis.crypto.randomUUID()}`;
  }
  return `account-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getDefaultPasswordForMember(username: string): string {
  return username.toLowerCase() === 'admin' ? ADMIN_PASSWORD : DEFAULT_PASSWORD;
}

// Passwords storage
export function getUserPassword(username: string): string {
  const u = username.toLowerCase();
  const defaultPass = getDefaultPasswordForMember(u);
  try {
    const data = localStorage.getItem(STORAGE_KEYS.USER_PASSWORDS);
    if (!data) return defaultPass;
    const map = JSON.parse(data);
    return map[u] || defaultPass;
  } catch {
    return defaultPass;
  }
}

interface MemberCredentialSnapshot {
  member: TeamMember;
  credential: string;
  isHashed: boolean;
}

function isSameAccount(expected: TeamMember, current: TeamMember): boolean {
  if (expected.username.toLowerCase() !== current.username.toLowerCase()) return false;
  if (expected.account_id || current.account_id) {
    return Boolean(expected.account_id)
      && Boolean(current.account_id)
      && expected.account_id === current.account_id;
  }
  return expected.created_at === current.created_at;
}

function captureMemberCredential(member: TeamMember): MemberCredentialSnapshot {
  return {
    member: { ...member },
    credential: member.password_hash || getUserPassword(member.username),
    isHashed: Boolean(member.password_hash)
  };
}

async function verifyCapturedCredential(
  snapshot: MemberCredentialSnapshot,
  password: string
): Promise<boolean> {
  return snapshot.isHashed
    ? verifyPasswordCredential(password, snapshot.credential)
    : password === snapshot.credential;
}

function getUnchangedMember(snapshot: MemberCredentialSnapshot): TeamMember | null {
  const member = getTeamMembers().find(
    item => item.username.toLowerCase() === snapshot.member.username.toLowerCase()
  );
  if (!member || !isSameAccount(snapshot.member, member)) return null;
  const currentCredential = member.password_hash || getUserPassword(member.username);
  return currentCredential === snapshot.credential ? member : null;
}

function currentSessionMatches(snapshot: MemberCredentialSnapshot): boolean {
  const currentUser = getCurrentUser();
  return Boolean(currentUser && isSameAccount(snapshot.member, currentUser));
}

function removeLegacyUserPassword(username: string): void {
  const data = localStorage.getItem(STORAGE_KEYS.USER_PASSWORDS);
  if (!data) return;
  let map: Record<string, string>;
  try {
    map = JSON.parse(data) as Record<string, string>;
  } catch {
    return;
  }
  delete map[username.toLowerCase()];
  localStorage.setItem(STORAGE_KEYS.USER_PASSWORDS, JSON.stringify(map));
}

export async function setUserPassword(username: string, newPass: string): Promise<TeamMember> {
  const normalized = username.toLowerCase();
  const initialMember = getTeamMembers().find(
    member => member.username.toLowerCase() === normalized
  );
  if (!initialMember) throw new Error(`账号 "${normalized}" 不存在`);
  const snapshot = captureMemberCredential(initialMember);
  const credential = await createPasswordCredential(newPass);
  const members = getTeamMembers();
  const existing = members.find(member => member.username.toLowerCase() === normalized);
  if (!existing) throw new Error(`账号 "${normalized}" 不存在`);
  const existingCredential = existing.password_hash || getUserPassword(normalized);
  if (!isSameAccount(snapshot.member, existing) || existingCredential !== snapshot.credential) {
    throw new Error(`账号 "${normalized}" 已在操作期间发生变化，本次密码修改未生效`);
  }

  const updatedMember = { ...existing, password_hash: credential };
  const currentUser = getCurrentUser();
  return runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.USER_PASSWORDS,
    STORAGE_KEYS.MEMBER_MUTATIONS,
    STORAGE_KEYS.CURRENT_USER
  ], () => {
    saveTeamMembers(members.map(member => (
      member.username.toLowerCase() === normalized ? updatedMember : member
    )));
    removeLegacyUserPassword(normalized);
    recordTeamMemberMutation(normalized, {
      operation: 'upsert',
      updated_at: new Date().toISOString(),
      member: updatedMember
    });
    if (currentUser?.username.toLowerCase() === normalized) {
      setCurrentUser({ ...currentUser, ...updatedMember });
    }
    return updatedMember;
  });
}

export type CurrentPasswordChangeResult =
  | { success: true; member: TeamMember }
  | { success: false; reason: 'wrong_password' | 'session_changed'; message: string };

/**
 * Change the signed-in user's password without allowing a slow PBKDF2 task to
 * write into a different login session or a newly reused username.
 */
export async function changeCurrentUserPassword(
  username: string,
  oldPass: string,
  newPass: string
): Promise<CurrentPasswordChangeResult> {
  const normalized = username.toLowerCase();
  const currentUser = getCurrentUser();
  const member = getTeamMembers().find(item => item.username.toLowerCase() === normalized);
  if (
    !currentUser
    || currentUser.username.toLowerCase() !== normalized
    || !member
    || !isSameAccount(member, currentUser)
  ) {
    return {
      success: false,
      reason: 'session_changed',
      message: '登录账号已发生变化，请重新打开修改密码窗口。'
    };
  }

  const snapshot = captureMemberCredential(member);
  if (!(await verifyCapturedCredential(snapshot, oldPass))) {
    return { success: false, reason: 'wrong_password', message: '原密码不正确！' };
  }
  if (!currentSessionMatches(snapshot) || !getUnchangedMember(snapshot)) {
    return {
      success: false,
      reason: 'session_changed',
      message: '登录账号或密码已在操作期间发生变化，请重新登录后再试。'
    };
  }

  const credential = await createPasswordCredential(newPass);
  const latestMember = getUnchangedMember(snapshot);
  if (!currentSessionMatches(snapshot) || !latestMember) {
    return {
      success: false,
      reason: 'session_changed',
      message: '登录账号或密码已在操作期间发生变化，本次修改未生效。'
    };
  }

  const members = getTeamMembers();
  const transactionMember = members.find(item => item.username.toLowerCase() === normalized);
  if (!transactionMember || !isSameAccount(snapshot.member, transactionMember)) {
    return {
      success: false,
      reason: 'session_changed',
      message: '登录账号已发生变化，本次修改未生效。'
    };
  }
  const updatedMember = { ...transactionMember, password_hash: credential };
  return runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.USER_PASSWORDS,
    STORAGE_KEYS.MEMBER_MUTATIONS,
    STORAGE_KEYS.CURRENT_USER
  ], () => {
    saveTeamMembers(members.map(item => (
      item.username.toLowerCase() === normalized ? updatedMember : item
    )));
    removeLegacyUserPassword(normalized);
    recordTeamMemberMutation(normalized, {
      operation: 'upsert',
      updated_at: new Date().toISOString(),
      member: updatedMember
    });
    setCurrentUser(updatedMember);
    return { success: true as const, member: updatedMember };
  });
}

export async function verifyUserPassword(username: string, password: string): Promise<boolean> {
  const normalized = username.toLowerCase();
  const member = getTeamMembers().find(item => item.username.toLowerCase() === normalized);
  if (!member) return false;
  if (member.password_hash) {
    return verifyPasswordCredential(password, member.password_hash);
  }
  return password === getUserPassword(normalized);
}

export function initializeSeedData() {
  try {
    if (!localStorage.getItem(STORAGE_KEYS.MEMBERS)) {
      localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(DEFAULT_MEMBERS));
    }

    // Keep a plaintext password only for legacy members that have not yet been
    // migrated to a synced one-way credential.
    const passData = localStorage.getItem(STORAGE_KEYS.USER_PASSWORDS);
    let passMap: Record<string, string> = {};
    if (passData) {
      try { passMap = JSON.parse(passData); } catch {}
    }
    const initializedMembers = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]') as TeamMember[];
      } catch {
        return [];
      }
    })();
    const adminHasCredential = initializedMembers.some(
      member => member.username.toLowerCase() === 'admin' && Boolean(member.password_hash)
    );
    if (!adminHasCredential && (!passMap['admin'] || passMap['admin'] === '123')) {
      passMap['admin'] = ADMIN_PASSWORD;
      localStorage.setItem(STORAGE_KEYS.USER_PASSWORDS, JSON.stringify(passMap));
    }

    // Pre-seed some mock records for realistic leaderboard on first load
    const storedMembers = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]') as TeamMember[];
      } catch {
        return [];
      }
    })();
    const activeUsernames = new Set(storedMembers.map(member => member.username.toLowerCase()));
    const sampleUsers = ['zs', 'ls', 'ww', 'zl'].filter(username => activeUsernames.has(username));
    sampleUsers.forEach((u, uIdx) => {
      const key = `${STORAGE_KEYS.RECORDS_PREFIX}${u}`;
      if (!localStorage.getItem(key)) {
        const records: Record<string, UserRecord> = {};
        const count = (uIdx + 1) * 25 + 10;
        for (let i = 1; i <= count; i++) {
          const qid = `g3_ch11_兴趣_${(i % 6) + 1}`;
          records[`g3_ch11_${i}`] = {
            question_id: qid,
            status: i % 5 === 0 ? 'wrong' : 'correct',
            attempt_count: 1,
            last_attempt_at: new Date(Date.now() - (i % 7) * 86400000).toISOString(),
            source: 'online'
          };
        }
        localStorage.setItem(key, JSON.stringify(records));
      }
    });

    if (!localStorage.getItem(STORAGE_KEYS.ANNOUNCEMENTS)) {
      const initialAnnouncements: TeamAnnouncement[] = [
        {
          id: 'ann_1',
          title: '2026年Q3季度考备战通知（9月18日统考）',
          content: '第三季度考将于2026年9月18日举行，高斯导引全套15讲核心题库已完成数字化录入。请各位老师做好每日备考规划，注重错题巩固与组卷模拟。',
          created_at: '2026-08-15 09:00',
          author: '教研管理员',
          is_pinned: true
        }
      ];
      localStorage.setItem(STORAGE_KEYS.ANNOUNCEMENTS, JSON.stringify(initialAnnouncements));
    }
  } catch {
    // The app remains usable in read-only/private storage environments. Any
    // user-initiated write will report a precise persistence error instead.
  }
}

// Current User Auth
export function getCurrentUser(): TeamMember | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (!data) return null;
    const parsed = JSON.parse(data) as unknown;
    return isStoredTeamMember(parsed) ? { ...parsed } : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: TeamMember | null) {
  if (!user) {
    try {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    } catch {
      // Logging out of the live UI must still work in read-only storage.
    }
  } else {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  }
}

/** Ignore a completed async sync when the user has switched accounts. */
export function isSyncRefreshForCurrentSession(
  syncedUsername: string,
  currentUsername?: string | null
): boolean {
  return !currentUsername || syncedUsername.toLowerCase() === currentUsername.toLowerCase();
}

// Authenticate user with personal password
export interface AuthenticationResult {
  success: boolean;
  user?: TeamMember;
  message?: string;
  reason?: 'not_found' | 'wrong_password' | 'account_changed';
}

export async function authenticateUser(username: string, pass: string): Promise<AuthenticationResult> {
  initializeSeedData();
  const trimmed = username.trim().toLowerCase();
  const members = getTeamMembers();
  const found = members.find(m => m.username.toLowerCase() === trimmed);

  if (!found) {
    return {
      success: false,
      reason: 'not_found',
      message: `拼音账号 "${trimmed}" 不存在，请联系管理员添加！`
    };
  }

  const credentialSnapshot = captureMemberCredential(found);
  if (!(await verifyCapturedCredential(credentialSnapshot, pass))) {
    return {
      success: false,
      reason: 'wrong_password',
      message: '密码错误，请输入您设置的个人私密密码！'
    };
  }

  // Upgrade a legacy password and record the login time in one shared member
  // mutation. Recheck after every asynchronous derivation so a deleted/reused
  // username cannot inherit an obsolete login attempt.
  const credential = credentialSnapshot.isHashed
    ? credentialSnapshot.credential
    : await createPasswordCredential(pass);
  const latestMember = getUnchangedMember(credentialSnapshot);
  if (!latestMember) {
    return {
      success: false,
      reason: 'account_changed',
      message: '账号信息已在登录期间发生变化，请重新输入密码登录。'
    };
  }

  const membersAtCommit = getTeamMembers();
  const commitMember = membersAtCommit.find(member => member.username.toLowerCase() === trimmed);
  if (!commitMember || !isSameAccount(credentialSnapshot.member, commitMember)) {
    return {
      success: false,
      reason: 'account_changed',
      message: '账号信息已发生变化，请重新登录。'
    };
  }

  const updatedUser = {
    ...commitMember,
    account_id: commitMember.account_id || createAccountId(),
    password_hash: credential,
    last_login_at: new Date().toISOString()
  };
  return runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.USER_PASSWORDS,
    STORAGE_KEYS.MEMBER_MUTATIONS,
    STORAGE_KEYS.CURRENT_USER
  ], () => {
    saveTeamMembers(membersAtCommit.map(member => (
      member.username.toLowerCase() === trimmed ? updatedUser : member
    )));
    removeLegacyUserPassword(trimmed);
    recordTeamMemberMutation(trimmed, {
      operation: 'upsert',
      updated_at: new Date().toISOString(),
      member: updatedUser
    });
    setCurrentUser(updatedUser);
    return { success: true, user: updatedUser };
  });
}

// Team Members
export function getTeamMembers(): TeamMember[] {
  initializeSeedData();
  try {
    const data = localStorage.getItem(STORAGE_KEYS.MEMBERS);
    if (!data) return cloneDefaultMembers();
    const parsed = JSON.parse(data) as unknown;
    if (!Array.isArray(parsed)) return cloneDefaultMembers();
    const members = parsed.filter(isStoredTeamMember).map(member => ({ ...member }));
    return members.length > 0 ? members : cloneDefaultMembers();
  } catch {
    return cloneDefaultMembers();
  }
}

export function saveTeamMembers(members: TeamMember[]) {
  localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(members));
}

export function getTeamMemberMutations(): Record<string, TeamMemberMutation> {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.MEMBER_MUTATIONS);
    if (!data) return {};
    const parsed = JSON.parse(data) as Record<string, TeamMemberMutation>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTeamMemberMutations(mutations: Record<string, TeamMemberMutation>): void {
  localStorage.setItem(STORAGE_KEYS.MEMBER_MUTATIONS, JSON.stringify(mutations));
}

function recordTeamMemberMutation(username: string, mutation: TeamMemberMutation): void {
  const normalized = username.toLowerCase();
  saveTeamMemberMutations({
    ...getTeamMemberMutations(),
    [normalized]: mutation
  });
}

export async function addTeamMember(member: TeamMember, initialPass: string = DEFAULT_PASSWORD): Promise<void> {
  const normalizedMember = { ...member, username: member.username.toLowerCase() };
  const members = getTeamMembers();
  if (members.some(m => m.username.toLowerCase() === normalizedMember.username)) {
    throw new Error(`拼音缩写账号 "${member.username}" 已存在！`);
  }
  if (getPendingDeletedUsernames().includes(normalizedMember.username)) {
    throw new Error(`账号 "${normalizedMember.username}" 的云端旧数据尚未清理，请先完成一次同步再重新添加！`);
  }
  const memberWithCredential = {
    ...normalizedMember,
    // A reused username is a new person, even if a caller accidentally passes
    // a copied TeamMember object carrying the old identity.
    account_id: createAccountId(),
    password_hash: await createPasswordCredential(initialPass)
  };
  runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.USER_PASSWORDS,
    STORAGE_KEYS.MEMBER_MUTATIONS
  ], () => {
    saveTeamMembers([...members, memberWithCredential]);
    removeLegacyUserPassword(normalizedMember.username);
    recordTeamMemberMutation(normalizedMember.username, {
      operation: 'upsert',
      updated_at: new Date().toISOString(),
      member: memberWithCredential
    });
  });
}

export function getPendingDeletedUsernames(): string[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PENDING_DELETED_USERS);
    if (!data) return [];
    const parsed = JSON.parse(data) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()))]
      : [];
  } catch {
    return [];
  }
}

export function clearPendingDeletedUsernames(usernames: string[]): void {
  const cleared = new Set(usernames.map(username => username.toLowerCase()));
  const remaining = getPendingDeletedUsernames().filter(username => !cleared.has(username));
  localStorage.setItem(STORAGE_KEYS.PENDING_DELETED_USERS, JSON.stringify(remaining));
}

export function purgeUserData(username: string): void {
  const normalized = username.toLowerCase();
  localStorage.removeItem(`${STORAGE_KEYS.RECORDS_PREFIX}${normalized}`);
  localStorage.removeItem(`${STORAGE_KEYS.PLANS_PREFIX}${normalized}`);

  const passwordData = localStorage.getItem(STORAGE_KEYS.USER_PASSWORDS);
  if (passwordData) {
    let passwords: Record<string, string> | null = null;
    try {
      passwords = JSON.parse(passwordData) as Record<string, string>;
    } catch {
      passwords = null;
    }
    if (passwords) {
      delete passwords[normalized];
      localStorage.setItem(STORAGE_KEYS.USER_PASSWORDS, JSON.stringify(passwords));
    }
  }

  const currentUser = getCurrentUser();
  if (currentUser?.username.toLowerCase() === normalized) {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }
}

export function updateTeamMember(
  username: string,
  updates: Pick<TeamMember, 'real_name' | 'role'>
): TeamMember {
  const normalized = username.toLowerCase();
  const previousMembers = getTeamMembers();
  const previousMember = previousMembers.find(member => member.username.toLowerCase() === normalized);
  if (!previousMember) throw new Error(`账号 "${normalized}" 不存在`);

  const realName = updates.real_name.trim();
  if (!realName) throw new Error('教师姓名不能为空');
  if (normalized === 'admin' && updates.role !== 'admin') {
    throw new Error('系统内置管理员不能改为普通教师');
  }

  const updatedMember: TeamMember = {
    ...previousMember,
    real_name: realName,
    role: updates.role
  };
  const currentUser = getCurrentUser();

  runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.MEMBER_MUTATIONS,
    STORAGE_KEYS.CURRENT_USER
  ], () => {
    saveTeamMembers(previousMembers.map(member => (
      member.username.toLowerCase() === normalized ? updatedMember : member
    )));
    recordTeamMemberMutation(normalized, {
      operation: 'upsert',
      updated_at: new Date().toISOString(),
      member: updatedMember
    });
    if (currentUser && isSameAccount(currentUser, previousMember)) {
      setCurrentUser(updatedMember);
    }
  });

  return updatedMember;
}

export function deleteTeamMember(username: string) {
  const normalized = username.toLowerCase();
  const previousMembers = getTeamMembers();
  const deletedMember = previousMembers.find(m => m.username.toLowerCase() === normalized);
  const members = previousMembers.filter(m => m.username.toLowerCase() !== normalized);
  runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.PENDING_DELETED_USERS,
    STORAGE_KEYS.MEMBER_MUTATIONS,
    `${STORAGE_KEYS.RECORDS_PREFIX}${normalized}`,
    `${STORAGE_KEYS.PLANS_PREFIX}${normalized}`,
    STORAGE_KEYS.USER_PASSWORDS,
    STORAGE_KEYS.CURRENT_USER
  ], () => {
    saveTeamMembers(members);
    const pending = new Set(getPendingDeletedUsernames());
    pending.add(normalized);
    localStorage.setItem(STORAGE_KEYS.PENDING_DELETED_USERS, JSON.stringify([...pending]));
    recordTeamMemberMutation(normalized, {
      operation: 'delete',
      updated_at: new Date().toISOString(),
      member: deletedMember
    });
    purgeUserData(normalized);
  });
}

export function getRecoverableDeletedMembers(): Array<{ member: TeamMember; deletedAt: string }> {
  const active = new Set(getTeamMembers().map(member => member.username.toLowerCase()));
  return Object.entries(getTeamMemberMutations())
    .filter(([username, mutation]) => (
      mutation.operation === 'delete'
      && mutation.member
      && !active.has(username.toLowerCase())
    ))
    .map(([, mutation]) => ({ member: mutation.member!, deletedAt: mutation.updated_at }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function restoreTeamMember(username: string): TeamMember {
  const normalized = username.toLowerCase();
  const mutation = getTeamMemberMutations()[normalized];
  if (mutation?.operation !== 'delete' || !mutation.member) {
    throw new Error(`账号 "${normalized}" 没有可恢复的删除快照`);
  }
  const restored = { ...mutation.member, username: normalized };
  const currentMembers = getTeamMembers();
  if (currentMembers.some(member => member.username.toLowerCase() === normalized)) return restored;

  runLocalStorageTransaction([
    STORAGE_KEYS.MEMBERS,
    STORAGE_KEYS.PENDING_DELETED_USERS,
    STORAGE_KEYS.MEMBER_MUTATIONS
  ], () => {
    saveTeamMembers([...currentMembers, restored]);
    clearPendingDeletedUsernames([normalized]);
    recordTeamMemberMutation(normalized, {
      operation: 'upsert',
      updated_at: new Date().toISOString(),
      member: restored
    });
  });
  return restored;
}

// User Practice Records
export function getUserRecords(username: string): Record<string, UserRecord> {
  const key = `${STORAGE_KEYS.RECORDS_PREFIX}${username.toLowerCase()}`;
  try {
    const data = localStorage.getItem(key);
    if (!data) return {};
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const normalized: Record<string, UserRecord> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([recordKey, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const raw = value as Partial<UserRecord>;
      const questionId = typeof raw.question_id === 'string' && raw.question_id
        ? raw.question_id
        : recordKey;
      if (!questionId || !['correct', 'wrong', 'unsolved'].includes(String(raw.status))) return;

      const normalizeCounterMap = (counter: unknown): Record<string, number> | undefined => {
        if (!counter || typeof counter !== 'object' || Array.isArray(counter)) return undefined;
        const entries = Object.entries(counter as Record<string, unknown>)
          .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && Number(entry[1]) >= 0)
          .map(([deviceId, count]) => [deviceId, Math.floor(Number(count))] as const);
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
      };
      const reviewHistory = Array.isArray(raw.review_history)
        ? raw.review_history.filter(entry => (
            entry
            && typeof entry.reviewed_at === 'string'
            && typeof entry.passed === 'boolean'
          )).map(entry => ({
            ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
            reviewed_at: entry.reviewed_at,
            passed: entry.passed
          }))
        : undefined;
      const stageNumber = Number(raw.ebbinghaus_stage);
      const stage = Number.isInteger(stageNumber) && stageNumber >= 0 && stageNumber <= 5
        ? stageNumber
        : undefined;
      const attemptCounters = normalizeCounterMap(raw.attempt_counts_by_device);
      const wrongCounters = normalizeCounterMap(raw.wrong_counts_by_device);

      normalized[questionId] = {
        question_id: questionId,
        ...(typeof raw.chapter_id === 'string' ? { chapter_id: raw.chapter_id } : {}),
        status: raw.status as UserRecord['status'],
        attempt_count: Number.isFinite(raw.attempt_count) && Number(raw.attempt_count) >= 0
          ? Math.floor(Number(raw.attempt_count))
          : 0,
        last_attempt_at: typeof raw.last_attempt_at === 'string' ? raw.last_attempt_at : '',
        ...(typeof raw.user_answer === 'string' ? { user_answer: raw.user_answer } : {}),
        ...(typeof raw.is_mastered === 'boolean' ? { is_mastered: raw.is_mastered } : {}),
        ...(Number.isFinite(raw.wrong_count) && Number(raw.wrong_count) >= 0
          ? { wrong_count: Math.floor(Number(raw.wrong_count)) }
          : {}),
        ...(typeof raw.user_notes === 'string' ? { user_notes: raw.user_notes } : {}),
        ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
        ...(['online', 'manual', 'ai_ocr'].includes(String(raw.source))
          ? { source: raw.source as UserRecord['source'] }
          : {}),
        ...(stage !== undefined ? { ebbinghaus_stage: stage } : {}),
        ...(typeof raw.next_review_at === 'string' ? { next_review_at: raw.next_review_at } : {}),
        ...(reviewHistory ? { review_history: reviewHistory } : {}),
        ...(attemptCounters ? { attempt_counts_by_device: attemptCounters } : {}),
        ...(wrongCounters ? { wrong_counts_by_device: wrongCounters } : {})
      };
    });
    return normalized;
  } catch {
    return {};
  }
}

export function saveUserRecord(username: string, record: UserRecord): Record<string, UserRecord> {
  const records = getUserRecords(username);
  records[record.question_id] = record;
  const key = `${STORAGE_KEYS.RECORDS_PREFIX}${username.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(records));
  return records;
}

export function batchSaveUserRecords(username: string, newRecords: UserRecord[]): Record<string, UserRecord> {
  const records = getUserRecords(username);
  newRecords.forEach(r => {
    records[r.question_id] = r;
  });
  const key = `${STORAGE_KEYS.RECORDS_PREFIX}${username.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(records));
  return records;
}

// Exam Plan Config
export function getExamPlan(username: string): ExamPlanConfig {
  const key = `${STORAGE_KEYS.PLANS_PREFIX}${username.toLowerCase()}`;
  try {
    const data = localStorage.getItem(key);
    if (data) {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const plan = parsed as Partial<ExamPlanConfig>;
        return {
          mode: ['balanced', 'module_focus', 'rush'].includes(String(plan.mode))
            ? plan.mode as ExamPlanConfig['mode']
            : DEFAULT_EXAM_PLAN.mode,
          focus_module: MATH_MODULES.has(String(plan.focus_module))
            ? plan.focus_module as ExamPlanConfig['focus_module']
            : DEFAULT_EXAM_PLAN.focus_module,
          daily_target: Number.isFinite(plan.daily_target) && Number(plan.daily_target) > 0
            ? Math.min(100, Math.floor(Number(plan.daily_target)))
            : DEFAULT_EXAM_PLAN.daily_target,
          exam_date: typeof plan.exam_date === 'string' && parseLocalExamDate(plan.exam_date)
            ? plan.exam_date
            : DEFAULT_EXAM_PLAN.exam_date,
          ...(typeof plan.updated_at === 'string' ? { updated_at: plan.updated_at } : {})
        };
      }
    }
  } catch {
    // Fall through to the default plan.
  }
  return { ...DEFAULT_EXAM_PLAN };
}

export function saveExamPlan(username: string, plan: ExamPlanConfig): ExamPlanConfig {
  const updatedPlan = { ...plan, updated_at: new Date().toISOString() };
  const key = `${STORAGE_KEYS.PLANS_PREFIX}${username.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(updatedPlan));
  return updatedPlan;
}

/** Store a plan received from cloud without making it look like a local edit. */
export function storeExamPlanSnapshot(username: string, plan: ExamPlanConfig): void {
  const key = `${STORAGE_KEYS.PLANS_PREFIX}${username.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(plan));
}

// Announcements
export function getAnnouncements(): TeamAnnouncement[] {
  initializeSeedData();
  try {
    const data = localStorage.getItem(STORAGE_KEYS.ANNOUNCEMENTS);
    if (!data) return [];
    const parsed = JSON.parse(data) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is TeamAnnouncement => {
      if (!value || typeof value !== 'object') return false;
      const announcement = value as Partial<TeamAnnouncement>;
      return typeof announcement.id === 'string'
        && typeof announcement.title === 'string'
        && typeof announcement.content === 'string'
        && typeof announcement.created_at === 'string'
        && typeof announcement.author === 'string';
    }).map(announcement => ({ ...announcement }));
  } catch {
    return [];
  }
}

export function addAnnouncement(ann: TeamAnnouncement) {
  const list = getAnnouncements();
  list.unshift(ann);
  saveAnnouncements(list);
}

export function createAnnouncementId(): string {
  if (globalThis.crypto?.randomUUID) return `ann_${globalThis.crypto.randomUUID()}`;
  return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function saveAnnouncements(announcements: TeamAnnouncement[]) {
  localStorage.setItem(STORAGE_KEYS.ANNOUNCEMENTS, JSON.stringify(announcements));
}

export function calculateConsecutiveActiveDays(records: UserRecord[], now: Date = new Date()): number {
  const activeDayNumbers = new Set<number>();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const addActivityDate = (timestamp?: string) => {
    if (!timestamp) return;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return;

    // Convert the user's local calendar day to a stable UTC day number. This
    // avoids counting two attempts on the same local day twice.
    const dayNumber = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    if (dayNumber <= today) activeDayNumbers.add(dayNumber);
  };

  records.forEach(record => {
    addActivityDate(record.last_attempt_at);
    record.review_history?.forEach(entry => addActivityDate(entry.reviewed_at));
  });

  const days = [...activeDayNumbers].sort((a, b) => b - a);
  if (days.length === 0) return 0;

  const oneDayMs = 24 * 60 * 60 * 1000;
  // A current streak may have activity today or yesterday. Anything older is
  // a historical streak and must not remain permanently on the leaderboard.
  if (today - days[0] > oneDayMs) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i - 1] - days[i] !== oneDayMs) break;
    streak += 1;
  }

  return streak;
}

export type QuestionSummaryScope = number | readonly string[];

export interface UserProgressCounts {
  solvedCount: number;
  correctCount: number;
  wrongCount: number;
  accuracyRate: number;
  completionRate: number;
  streakDays: number;
}

export function calculateUserProgress(
  records: Record<string, UserRecord>,
  questionScope: QuestionSummaryScope,
  now: Date = new Date()
): UserProgressCounts {
  const validQuestionIds = typeof questionScope === 'number' ? null : new Set(questionScope);
  const totalQuestionsCount = typeof questionScope === 'number'
    ? Math.max(0, questionScope)
    : validQuestionIds!.size;
  const values = Object.values(records).filter(record => (
    !validQuestionIds || validQuestionIds.has(record.question_id)
  ));
  const solvedCount = values.length;
  const correctCount = values.filter(value => value.status === 'correct').length;
  const wrongCount = values.filter(value => value.status === 'wrong').length;

  return {
    solvedCount,
    correctCount,
    wrongCount,
    accuracyRate: solvedCount > 0 ? Math.round((correctCount / solvedCount) * 100) : 0,
    completionRate: totalQuestionsCount > 0
      ? Math.min(100, Math.round((solvedCount / totalQuestionsCount) * 100))
      : 0,
    streakDays: calculateConsecutiveActiveDays(values, now)
  };
}

// Calculate User Summary & Real Streak Days
export function getUserSummary(username: string, questionScope: QuestionSummaryScope = 362): UserSummary {
  const members = getTeamMembers();
  const member = members.find(m => m.username.toLowerCase() === username.toLowerCase()) || {
    username,
    real_name: username,
    role: 'user' as const,
    created_at: '2026-08-01',
    last_login_at: new Date().toISOString()
  };

  const records = getUserRecords(username);
  const plan = getExamPlan(username);
  const progress = calculateUserProgress(records, questionScope);

  return {
    username: member.username,
    real_name: member.real_name,
    role: member.role,
    daily_target: plan.daily_target,
    focus_module: plan.focus_module,
    plan_mode: plan.mode,
    solved_count: progress.solvedCount,
    correct_count: progress.correctCount,
    wrong_count: progress.wrongCount,
    accuracy_rate: progress.accuracyRate,
    completion_rate: progress.completionRate,
    streak_days: progress.streakDays,
    last_active_at: member.last_login_at || new Date().toISOString()
  };
}

export function getTeamLeaderboard(questionScope: QuestionSummaryScope = 362): UserSummary[] {
  const members = getTeamMembers();
  const summaries = members.map(m => getUserSummary(m.username, questionScope));
  return summaries.sort((a, b) => b.solved_count - a.solved_count);
}

// Team High-Frequency Error Questions
export function getTeamErrorItems(allQuestions: Question[]): TeamErrorItem[] {
  const members = getTeamMembers();
  const questionErrorMap: Record<string, { wrongUsers: Set<string>; attempts: number; wrongAttempts: number }> = {};

  members.forEach(m => {
    const records = getUserRecords(m.username);
    Object.values(records).forEach(r => {
      if (!questionErrorMap[r.question_id]) {
        questionErrorMap[r.question_id] = { wrongUsers: new Set(), attempts: 0, wrongAttempts: 0 };
      }
      const item = questionErrorMap[r.question_id];
      const attempts = Math.max(1, r.attempt_count || 0);
      const wrongAttempts = Math.max(0, r.wrong_count ?? (r.status === 'wrong' ? 1 : 0));
      item.attempts += attempts;
      item.wrongAttempts += Math.min(wrongAttempts, attempts);
      if (wrongAttempts > 0) {
        item.wrongUsers.add(m.real_name || m.username);
      }
    });
  });

  const qMap = new Map<string, Question>();
  allQuestions.forEach(q => qMap.set(q.id, q));

  const results: TeamErrorItem[] = [];

  Object.entries(questionErrorMap).forEach(([qid, info]) => {
    const q = qMap.get(qid);
    if (q && info.wrongAttempts > 0) {
      results.push({
        question_id: qid,
        question: q,
        wrong_count: info.wrongAttempts,
        attempt_count: info.attempts,
        wrong_rate: Math.round((info.wrongAttempts / Math.max(info.attempts, 1)) * 100),
        wrong_users: [...info.wrongUsers],
        solution_tips: [
          '注意分类讨论时不要遗漏临界情况',
          '先画草图标记已知线段与已知比例模型',
          '尝试代入特殊值或逆向倒推法检验'
        ]
      });
    }
  });

  return results.sort((a, b) => b.wrong_count - a.wrong_count);
}
