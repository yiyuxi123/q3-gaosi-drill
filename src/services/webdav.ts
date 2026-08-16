import type {
  ExamPlanConfig,
  SyncConfig,
  TeamAnnouncement,
  TeamMember,
  TeamMemberMutation,
  UserRecord
} from '../types';
import {
  batchSaveUserRecords,
  clearPendingDeletedUsernames,
  getAnnouncements,
  getExamPlan,
  getPendingDeletedUsernames,
  getTeamMembers,
  getTeamMemberMutations,
  getUserRecords,
  saveAnnouncements,
  saveTeamMembers,
  saveTeamMemberMutations,
  storeExamPlanSnapshot,
  purgeUserData
} from './storage';
import { mergePracticeCounters, mergeReviewHistory } from './attemptTracking';

const USE_LOCAL_DESKTOP_PROXY = import.meta.env.DEV || import.meta.env.MODE.startsWith('desktop');

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  webdav_url: USE_LOCAL_DESKTOP_PROXY
    ? '/dav/dav/strj_exam'
    : 'https://dav.jianguoyun.com/dav/strj_exam',
  webdav_username: __BUILTIN_NUTSTORE_USERNAME__,
  webdav_password: __BUILTIN_NUTSTORE_PASSWORD__,
  opencodego_api_key: __BUILTIN_OPENCODE_API_KEY__,
  auto_sync: true,
  sync_status: 'idle'
};

export interface CloudSyncPayload {
  schemaVersion: 1;
  username: string;
  accountId?: string;
  updatedAt: string;
  records: Record<string, UserRecord>;
  teamMembers: TeamMember[];
  announcements: TeamAnnouncement[];
  examPlan: ExamPlanConfig;
  deletion?: {
    isDeleted: true;
    deletedAt: string;
    deletedBy: string;
    accountId?: string;
    recoverable: true;
  };
}

export interface CloudSharedPayload {
  schemaVersion: 1;
  updatedAt: string;
  teamMembers: TeamMember[];
  announcements: TeamAnnouncement[];
  memberMutations?: Record<string, TeamMemberMutation>;
}

const SYNC_STORAGE_KEY = 'strj_sync_config';
const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

export function getSyncConfig(): SyncConfig {
  try {
    const data = localStorage.getItem(SYNC_STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...DEFAULT_SYNC_CONFIG };
      }
      const stored = parsed as Partial<SyncConfig>;
      const merged: SyncConfig = {
        webdav_url: typeof stored.webdav_url === 'string' ? stored.webdav_url : DEFAULT_SYNC_CONFIG.webdav_url,
        webdav_username: typeof stored.webdav_username === 'string' && stored.webdav_username.trim()
          ? stored.webdav_username
          : DEFAULT_SYNC_CONFIG.webdav_username,
        webdav_password: typeof stored.webdav_password === 'string' && stored.webdav_password.trim()
          ? stored.webdav_password
          : DEFAULT_SYNC_CONFIG.webdav_password,
        opencodego_api_key: typeof stored.opencodego_api_key === 'string' && stored.opencodego_api_key.trim()
          ? stored.opencodego_api_key
          : DEFAULT_SYNC_CONFIG.opencodego_api_key,
        auto_sync: typeof stored.auto_sync === 'boolean' ? stored.auto_sync : DEFAULT_SYNC_CONFIG.auto_sync,
        sync_status: ['idle', 'syncing', 'success', 'error'].includes(String(stored.sync_status))
          ? stored.sync_status as SyncConfig['sync_status']
          : DEFAULT_SYNC_CONFIG.sync_status,
        ...(typeof stored.last_synced_at === 'string' ? { last_synced_at: stored.last_synced_at } : {}),
        ...(typeof stored.last_error_msg === 'string' ? { last_error_msg: stored.last_error_msg } : {})
      };
      // Older builds stored the direct Nutstore URL. Keep the editable bundled
      // credentials, but route local development through the same-origin proxy.
      if (USE_LOCAL_DESKTOP_PROXY && /^https:\/\/dav\.jianguoyun\.com/i.test(merged.webdav_url)) {
        const migrated = {
          ...merged,
          webdav_url: DEFAULT_SYNC_CONFIG.webdav_url
        };
        try {
          localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(migrated));
        } catch {
          // Return the scrubbed runtime value even when storage is read-only.
        }
        return migrated;
      }
      return merged;
    }
  } catch {
    // Storage may be unavailable in private/read-only browser contexts.
  }
  return { ...DEFAULT_SYNC_CONFIG };
}

export function saveSyncConfig(cfg: Partial<SyncConfig>): SyncConfig {
  const current = getSyncConfig();
  const updated = { ...current, ...cfg };
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

function saveSyncStatus(cfg: Partial<SyncConfig>): SyncConfig {
  try {
    return saveSyncConfig(cfg);
  } catch {
    // A sync result must still settle even when status metadata cannot be
    // persisted, otherwise one failed localStorage write blocks the queue.
    return { ...getSyncConfig(), ...cfg };
  }
}

function getAuthHeader(config: SyncConfig): string | undefined {
  if (!config.webdav_username || !config.webdav_password) return undefined;
  return 'Basic ' + btoa(`${config.webdav_username}:${config.webdav_password}`);
}

function getRequestHeaders(
  config: SyncConfig,
  extra: Record<string, string> = {}
): Record<string, string> {
  const authorization = getAuthHeader(config);
  return authorization ? { ...extra, Authorization: authorization } : extra;
}

export async function fetchWithSyncTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_SYNC_TIMEOUT_MS,
  fetcher: typeof fetch = globalThis.fetch
): Promise<Response> {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_SYNC_TIMEOUT_MS;
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const request = fetcher(input, {
    ...init,
    signal: controller?.signal || init.signal
  });
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`云同步请求超时（已等待 ${Math.ceil(effectiveTimeoutMs / 1000)} 秒）`));
      controller?.abort();
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function getRemoteBaseUrl(config: SyncConfig): string {
  const baseUrl = config.webdav_url.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('尚未配置 WebDAV 同步地址');
  return baseUrl;
}

function getRemoteDataUrl(config: SyncConfig, username: string): string {
  return `${getRemoteBaseUrl(config)}/records_${encodeURIComponent(username.toLowerCase())}.json`;
}

function getRemoteSharedDataUrl(config: SyncConfig): string {
  return `${getRemoteBaseUrl(config)}/shared_team.json`;
}

export function mergeTeamMembers(local: TeamMember[], remote: TeamMember[]): TeamMember[] {
  const merged = new Map(remote.map(member => [member.username.toLowerCase(), member]));
  local.forEach(member => merged.set(member.username.toLowerCase(), member));
  return [...merged.values()];
}

function memberMutationTimestamp(mutation?: TeamMemberMutation): number {
  if (!mutation?.updated_at) return 0;
  const timestamp = new Date(mutation.updated_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function mergeTeamMemberMutations(
  local: Record<string, TeamMemberMutation>,
  remote: Record<string, TeamMemberMutation>
): Record<string, TeamMemberMutation> {
  const merged: Record<string, TeamMemberMutation> = {};
  const usernames = new Set([...Object.keys(remote), ...Object.keys(local)]);

  usernames.forEach(rawUsername => {
    const username = rawUsername.toLowerCase();
    const localMutation = local[rawUsername] || local[username];
    const remoteMutation = remote[rawUsername] || remote[username];
    if (!localMutation) {
      if (remoteMutation) merged[username] = remoteMutation;
      return;
    }
    if (!remoteMutation) {
      merged[username] = localMutation;
      return;
    }

    const localTimestamp = memberMutationTimestamp(localMutation);
    const remoteTimestamp = memberMutationTimestamp(remoteMutation);
    if (localTimestamp > remoteTimestamp) merged[username] = localMutation;
    else if (remoteTimestamp > localTimestamp) merged[username] = remoteMutation;
    else if (localMutation.operation !== remoteMutation.operation) {
      merged[username] = localMutation.operation === 'delete' ? localMutation : remoteMutation;
    } else {
      // Equal timestamps can happen on separate offline devices. Use a stable
      // tie-breaker so every administrator converges on the same snapshot.
      const localKey = JSON.stringify(localMutation);
      const remoteKey = JSON.stringify(remoteMutation);
      merged[username] = localKey.localeCompare(remoteKey) >= 0 ? localMutation : remoteMutation;
    }
  });

  return merged;
}

export function applyTeamMemberMutations(
  members: TeamMember[],
  mutations: Record<string, TeamMemberMutation>
): TeamMember[] {
  const resolved = new Map(members.map(member => [member.username.toLowerCase(), member]));
  Object.entries(mutations).forEach(([rawUsername, mutation]) => {
    const username = rawUsername.toLowerCase();
    if (mutation.operation === 'delete') {
      resolved.delete(username);
    } else if (mutation.member) {
      resolved.set(username, { ...mutation.member, username });
    }
  });
  return [...resolved.values()];
}

export function mergeAnnouncements(
  local: TeamAnnouncement[],
  remote: TeamAnnouncement[]
): TeamAnnouncement[] {
  const merged = new Map(remote.map(item => [item.id, item]));
  local.forEach(item => merged.set(item.id, item));
  return [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function examPlanTimestamp(plan: ExamPlanConfig): number {
  if (!plan.updated_at) return 0;
  const timestamp = new Date(plan.updated_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Choose the most recently edited plan. For two legacy snapshots without a
 * timestamp, prefer the remote copy so an initial pull keeps historic cloud data.
 */
export function mergeExamPlans(
  local: ExamPlanConfig,
  remote: ExamPlanConfig
): ExamPlanConfig {
  return examPlanTimestamp(local) > examPlanTimestamp(remote) ? local : remote;
}

function mergeSharedCloudData(remote: Partial<CloudSyncPayload>): void {
  if (Array.isArray(remote.teamMembers)) {
    saveTeamMembers(mergeTeamMembers(getTeamMembers(), remote.teamMembers));
  }
  if (Array.isArray(remote.announcements)) {
    saveAnnouncements(mergeAnnouncements(getAnnouncements(), remote.announcements));
  }
}

function applySharedCloudSnapshot(remote: CloudSharedPayload): void {
  const previousMembers = getTeamMembers();
  const mutations = mergeTeamMemberMutations(
    getTeamMemberMutations(),
    remote.memberMutations || {}
  );
  const resolvedMembers = applyTeamMemberMutations(remote.teamMembers, mutations);
  saveTeamMembers(resolvedMembers);
  saveTeamMemberMutations(mutations);
  // Announcements have no delete/edit operation or tombstone. Replacing the
  // local list here would permanently erase a notice created while offline
  // before its queued upload can run. A union is therefore the authoritative
  // conflict policy for this append-only collection.
  saveAnnouncements(mergeAnnouncements(getAnnouncements(), remote.announcements));

  // The shared file is authoritative. Purge every locally cached account that
  // disappeared, not only the account currently signed in, so a later username
  // reuse cannot inherit the previous person's password or study history.
  const activeUsernames = new Set(
    resolvedMembers.map(member => member.username.toLowerCase())
  );
  const resolvedByUsername = new Map(
    resolvedMembers.map(member => [member.username.toLowerCase(), member])
  );
  previousMembers.forEach(member => {
    const username = member.username.toLowerCase();
    const replacement = resolvedByUsername.get(username);
    const identityChanged = Boolean(
      replacement
      && (member.account_id || replacement.account_id)
      && member.account_id !== replacement.account_id
    );
    if (!activeUsernames.has(username) || identityChanged) {
      purgeUserData(member.username);
    }
  });
  Object.entries(mutations).forEach(([username, mutation]) => {
    if (mutation.operation === 'delete') purgeUserData(username);
  });
}

function hasNewerLocalMemberMutation(
  local: Record<string, TeamMemberMutation>,
  remote: Record<string, TeamMemberMutation>
): boolean {
  return Object.entries(local).some(([rawUsername, localMutation]) => {
    const remoteMutation = remote[rawUsername] || remote[rawUsername.toLowerCase()];
    if (!remoteMutation) return true;
    return memberMutationTimestamp(localMutation) > memberMutationTimestamp(remoteMutation);
  });
}

function isValidSharedPayload(payload: Partial<CloudSharedPayload>): payload is CloudSharedPayload {
  return payload.schemaVersion === 1
    && Array.isArray(payload.teamMembers)
    && Array.isArray(payload.announcements)
    && (
      payload.memberMutations === undefined
      || (typeof payload.memberMutations === 'object' && !Array.isArray(payload.memberMutations))
    );
}

const sharedPayloadEtags = new WeakMap<CloudSharedPayload, string>();

async function fetchSharedCloudData(config: SyncConfig): Promise<CloudSharedPayload | null> {
  const response = await fetchWithSyncTimeout(getRemoteSharedDataUrl(config), {
    method: 'GET',
    headers: getRequestHeaders(config)
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`共享数据 HTTP ${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json() as Partial<CloudSharedPayload>;
  if (!isValidSharedPayload(payload)) {
    throw new Error('云端团队共享数据格式无效或版本不受支持');
  }
  const etag = response.headers?.get?.('etag');
  if (etag) sharedPayloadEtags.set(payload, etag);
  return payload;
}

async function uploadSharedCloudData(
  config: SyncConfig,
  snapshot?: Pick<CloudSharedPayload, 'teamMembers' | 'announcements' | 'memberMutations'>,
  expectedRemote?: CloudSharedPayload | null,
  retryCount = 0
): Promise<CloudSharedPayload> {
  const payload: CloudSharedPayload = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    teamMembers: snapshot?.teamMembers || getTeamMembers(),
    announcements: snapshot?.announcements || getAnnouncements(),
    memberMutations: snapshot?.memberMutations || getTeamMemberMutations()
  };
  const etag = expectedRemote ? sharedPayloadEtags.get(expectedRemote) : undefined;
  const concurrencyHeaders: Record<string, string> = etag
    ? { 'If-Match': etag }
    : expectedRemote === null
      ? { 'If-None-Match': '*' }
      : {};
  const response = await fetchWithSyncTimeout(getRemoteSharedDataUrl(config), {
    method: 'PUT',
    headers: getRequestHeaders(config, { 'Content-Type': 'application/json', ...concurrencyHeaders }),
    body: JSON.stringify(payload)
  });
  if ((response.status === 409 || response.status === 412) && retryCount < 3) {
    const latest = await fetchSharedCloudData(config);
    const mutations = mergeTeamMemberMutations(payload.memberMutations || {}, latest?.memberMutations || {});
    const members = applyTeamMemberMutations(
      mergeTeamMembers(payload.teamMembers, latest?.teamMembers || []),
      mutations
    );
    const announcements = mergeAnnouncements(payload.announcements, latest?.announcements || []);
    return uploadSharedCloudData(config, {
      teamMembers: members,
      announcements,
      memberMutations: mutations
    }, latest, retryCount + 1);
  }
  if (!response.ok) {
    throw new Error(`共享数据 HTTP ${response.status} ${response.statusText}`.trim());
  }
  saveTeamMembers(payload.teamMembers);
  saveTeamMemberMutations(payload.memberMutations || {});
  saveAnnouncements(payload.announcements);
  return payload;
}

export async function markRemoteUserDataDeleted(
  config: SyncConfig,
  username: string,
  deletedBy: string,
  fetcher: typeof fetch = globalThis.fetch
): Promise<void> {
  const url = getRemoteDataUrl(config, username);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingResponse = await fetchWithSyncTimeout(url, {
      method: 'GET',
      headers: getRequestHeaders(config)
    }, DEFAULT_SYNC_TIMEOUT_MS, fetcher);
    let existing: Partial<CloudSyncPayload> = {};
    if (existingResponse.ok) {
      existing = await existingResponse.json() as Partial<CloudSyncPayload>;
    } else if (existingResponse.status !== 404) {
      throw new Error(`读取账号 ${username} 的云端备份失败：HTTP ${existingResponse.status} ${existingResponse.statusText}`.trim());
    }
    const deletedMember = getTeamMemberMutations()[username.toLowerCase()]?.member;
    const payload: CloudSyncPayload = {
      schemaVersion: 1,
      username: username.toLowerCase(),
      accountId: existing.accountId || deletedMember?.account_id,
      updatedAt: new Date().toISOString(),
      records: existing.records && typeof existing.records === 'object' ? existing.records : {},
      teamMembers: Array.isArray(existing.teamMembers) ? existing.teamMembers : getTeamMembers(),
      announcements: Array.isArray(existing.announcements) ? existing.announcements : getAnnouncements(),
      examPlan: existing.examPlan || getExamPlan(username),
      deletion: {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: deletedBy.toLowerCase(),
        accountId: existing.accountId || deletedMember?.account_id,
        recoverable: true
      }
    };
    const etag = existingResponse.ok ? existingResponse.headers?.get?.('etag') : undefined;
    const concurrencyHeaders: Record<string, string> = etag
      ? { 'If-Match': etag }
      : existingResponse.status === 404
        ? { 'If-None-Match': '*' }
        : {};
    const response = await fetchWithSyncTimeout(url, {
      method: 'PUT',
      headers: getRequestHeaders(config, { 'Content-Type': 'application/json', ...concurrencyHeaders }),
      body: JSON.stringify(payload)
    }, DEFAULT_SYNC_TIMEOUT_MS, fetcher);
    if ((response.status === 409 || response.status === 412) && attempt < 3) continue;
    if (!response.ok) {
      throw new Error(`标记账号 ${username} 的云端备份失败：HTTP ${response.status} ${response.statusText}`.trim());
    }
    return;
  }
}

async function uploadCloudPayload(
  config: SyncConfig,
  username: string,
  records: Record<string, UserRecord>,
  expectedRemote: { exists: boolean; etag?: string },
  retryCount = 0
): Promise<Record<string, UserRecord>> {
  const concurrencyHeaders: Record<string, string> = expectedRemote.etag
    ? { 'If-Match': expectedRemote.etag }
    : expectedRemote.exists
      ? {}
      : { 'If-None-Match': '*' };
  const response = await fetchWithSyncTimeout(getRemoteDataUrl(config, username), {
    method: 'PUT',
    headers: getRequestHeaders(config, { 'Content-Type': 'application/json', ...concurrencyHeaders }),
    body: JSON.stringify(buildCloudPayload(username, records))
  });
  if ((response.status === 409 || response.status === 412) && retryCount < 3) {
    const latestResponse = await fetchWithSyncTimeout(getRemoteDataUrl(config, username), {
      method: 'GET',
      headers: getRequestHeaders(config)
    });
    if (latestResponse.status === 404) {
      return uploadCloudPayload(config, username, records, { exists: false }, retryCount + 1);
    }
    if (!latestResponse.ok) {
      throw new Error(`HTTP ${latestResponse.status} ${latestResponse.statusText}`.trim());
    }
    const latest = await latestResponse.json() as Partial<CloudSyncPayload>;
    if (latest.schemaVersion !== 1 || !latest.records || typeof latest.records !== 'object') {
      throw new Error('云端数据格式无效或版本不受支持');
    }
    const member = getTeamMembers().find(item => item.username.toLowerCase() === username.toLowerCase());
    const mergedRecords = remotePayloadMatchesAccount(latest, member)
      ? mergeUserRecords(records, latest.records)
      : records;
    batchSaveUserRecords(username, Object.values(mergedRecords));
    if (latest.examPlan) {
      storeExamPlanSnapshot(username, mergeExamPlans(getExamPlan(username), latest.examPlan));
    }
    return uploadCloudPayload(config, username, mergedRecords, {
      exists: true,
      etag: latestResponse.headers?.get?.('etag') || undefined
    }, retryCount + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return records;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordTimestamp(record?: UserRecord): number {
  if (!record?.last_attempt_at) return 0;
  const timestamp = new Date(record.last_attempt_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function remotePayloadMatchesAccount(
  remote: Partial<CloudSyncPayload>,
  member?: TeamMember
): boolean {
  return !remote.accountId || !member?.account_id || remote.accountId === member.account_id;
}

export function mergeUserRecords(
  localRecords: Record<string, UserRecord>,
  remoteRecords: Record<string, UserRecord>
): Record<string, UserRecord> {
  const merged = { ...localRecords };

  Object.entries(remoteRecords).forEach(([questionId, remoteRecord]) => {
    const localRecord = merged[questionId];
    if (!localRecord) {
      merged[questionId] = remoteRecord;
      return;
    }

    const newestRecord = recordTimestamp(remoteRecord) > recordTimestamp(localRecord)
      ? remoteRecord
      : localRecord;
    merged[questionId] = {
      ...newestRecord,
      ...mergePracticeCounters(localRecord, remoteRecord),
      review_history: mergeReviewHistory(localRecord.review_history, remoteRecord.review_history)
    };
  });

  return merged;
}

function buildCloudPayload(
  username: string,
  records: Record<string, UserRecord>
): CloudSyncPayload {
  return {
    schemaVersion: 1,
    username: username.toLowerCase(),
    accountId: getTeamMembers().find(member => member.username.toLowerCase() === username.toLowerCase())?.account_id,
    updatedAt: new Date().toISOString(),
    records,
    teamMembers: getTeamMembers(),
    announcements: getAnnouncements(),
    examPlan: getExamPlan(username)
  };
}

/** Perform a live WebDAV connection test and verify write permission. */
export async function testNutstoreConnection(): Promise<{ success: boolean; message: string; timestamp: string }> {
  const config = getSyncConfig();
  const nowStr = new Date().toLocaleTimeString();

  saveSyncStatus({ sync_status: 'syncing', last_error_msg: undefined });

  try {
    const testUrl = `${getRemoteBaseUrl(config)}/sync_test_ping.json`;
    const putRes = await fetchWithSyncTimeout(testUrl, {
      method: 'PUT',
      headers: getRequestHeaders(config, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        client: 'Q3考高斯刷题智能备考系统',
        account: config.webdav_username,
        testedAt: new Date().toISOString(),
        status: 'HEALTHY_VERIFIED'
      })
    });

    if (!putRes.ok) {
      throw new Error(`HTTP ${putRes.status} ${putRes.statusText}`.trim());
    }

    saveSyncStatus({
      sync_status: 'success',
      last_synced_at: nowStr,
      last_error_msg: undefined
    });
    return {
      success: true,
      message: `坚果云 WebDAV 写入正常 (HTTP ${putRes.status})`,
      timestamp: nowStr
    };
  } catch (error) {
    const message = getErrorMessage(error);
    saveSyncStatus({ sync_status: 'error', last_error_msg: message });
    return {
      success: false,
      message: `坚果云连接失败：${message}`,
      timestamp: nowStr
    };
  }
}

let cloudSyncQueue: Promise<unknown> = Promise.resolve();

function enqueueCloudTask<T>(task: () => Promise<T>): Promise<T> {
  const result = cloudSyncQueue.then(task, task);
  cloudSyncQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function performSharedTeamPull(): Promise<{ success: boolean; message: string }> {
  const config = getSyncConfig();
  saveSyncStatus({ sync_status: 'syncing', last_error_msg: undefined });

  try {
    const remote = await fetchSharedCloudData(config);
    if (!remote) {
      saveSyncStatus({ sync_status: 'success', last_synced_at: new Date().toLocaleTimeString() });
      return { success: true, message: '云端暂无团队账号数据' };
    }

    applySharedCloudSnapshot(remote);
    saveSyncStatus({
      sync_status: 'success',
      last_synced_at: new Date().toLocaleTimeString(),
      last_error_msg: undefined
    });
    return { success: true, message: '团队账号已从云端更新' };
  } catch (error) {
    const message = getErrorMessage(error);
    saveSyncStatus({ sync_status: 'error', last_error_msg: message });
    return { success: false, message: `团队账号同步失败：${message}` };
  }
}

/** Refresh the login roster without requiring an already authenticated user. */
export function pullSharedTeamData(): Promise<{ success: boolean; message: string }> {
  return enqueueCloudTask(performSharedTeamPull);
}

export interface CloudPushOptions {
  /**
   * Admin member/announcement edits are intentional authoritative changes.
   * Skipping the shared-data union is required for deletions to reach cloud.
   */
  sharedDataAuthority?: 'merge' | 'local';
}

async function performCloudPush(
  username?: string,
  records?: Record<string, UserRecord>,
  options: CloudPushOptions = {}
): Promise<boolean> {
  if (!username) return false;

  const config = getSyncConfig();
  let mergedRecords = mergeUserRecords(getUserRecords(username), records || {});
  let legacyRemote: Partial<CloudSyncPayload> | null = null;
  let userRemoteVersion: { exists: boolean; etag?: string } = { exists: false };
  const actor = getTeamMembers().find(member => member.username.toLowerCase() === username.toLowerCase());
  const pendingDeletedUsernames = getPendingDeletedUsernames();
  const shouldPublishLocalSharedData = options.sharedDataAuthority === 'local'
    || (actor?.role === 'admin' && pendingDeletedUsernames.length > 0);
  saveSyncStatus({ sync_status: 'syncing', last_error_msg: undefined });

  try {
    // Read-before-write prevents a second device from being overwritten by a
    // stale local snapshot when both clients answer questions between pulls.
    const remoteResponse = await fetchWithSyncTimeout(getRemoteDataUrl(config, username), {
      method: 'GET',
      headers: getRequestHeaders(config)
    });
    if (remoteResponse.ok) {
      userRemoteVersion = {
        exists: true,
        etag: remoteResponse.headers?.get?.('etag') || undefined
      };
      const remote = await remoteResponse.json() as Partial<CloudSyncPayload>;
      if (remote.schemaVersion !== 1 || !remote.records || typeof remote.records !== 'object') {
        throw new Error('云端数据格式无效或版本不受支持');
      }
      legacyRemote = remote;
      if (remotePayloadMatchesAccount(remote, actor)) {
        mergedRecords = mergeUserRecords(mergedRecords, remote.records);
      }
      batchSaveUserRecords(username, Object.values(mergedRecords));
      if (remote.examPlan) {
        storeExamPlanSnapshot(username, mergeExamPlans(getExamPlan(username), remote.examPlan));
      }
    } else if (remoteResponse.status !== 404) {
      throw new Error(`HTTP ${remoteResponse.status} ${remoteResponse.statusText}`.trim());
    }

    const remoteShared = await fetchSharedCloudData(config);
    if (shouldPublishLocalSharedData) {
      const localMutations = getTeamMemberMutations();
      let addedLegacyDeletion = false;
      pendingDeletedUsernames.forEach(deletedUsername => {
        if (!localMutations[deletedUsername]) {
          localMutations[deletedUsername] = {
            operation: 'delete',
            updated_at: new Date().toISOString()
          };
          addedLegacyDeletion = true;
        }
      });
      if (addedLegacyDeletion) saveTeamMemberMutations(localMutations);

      const mergedMutations = mergeTeamMemberMutations(
        localMutations,
        remoteShared?.memberMutations || {}
      );
      const mergedMembers = applyTeamMemberMutations(
        remoteShared
          ? mergeTeamMembers(getTeamMembers(), remoteShared.teamMembers)
          : getTeamMembers(),
        mergedMutations
      );
      const mergedAnnouncements = remoteShared
        ? mergeAnnouncements(getAnnouncements(), remoteShared.announcements)
        : getAnnouncements();

      saveTeamMembers(mergedMembers);
      saveTeamMemberMutations(mergedMutations);
      saveAnnouncements(mergedAnnouncements);

      const accountStillActive = mergedMembers.some(
        member => member.username.toLowerCase() === username.toLowerCase()
      );
      if (!accountStillActive) {
        purgeUserData(username);
        throw new Error('当前账号已被管理员注销，本机学习数据已清理');
      }

      await uploadSharedCloudData(config, {
        teamMembers: mergedMembers,
        announcements: mergedAnnouncements,
        memberMutations: mergedMutations
      }, remoteShared);
    } else if (remoteShared) {
      applySharedCloudSnapshot(remoteShared);
    } else if (legacyRemote) {
      // Compatibility with cloud files written before shared_team.json existed.
      mergeSharedCloudData(legacyRemote);
    }

    if (!shouldPublishLocalSharedData && remoteShared) {
      const accountStillActive = getTeamMembers().some(
        member => member.username.toLowerCase() === username.toLowerCase()
      );
      if (!accountStillActive) {
        purgeUserData(username);
        throw new Error('当前账号已被管理员注销，本机学习数据已清理');
      }
    }

    if (actor?.role === 'admin' && pendingDeletedUsernames.length > 0) {
      const latestMutations = getTeamMemberMutations();
      const activeUsernames = new Set(getTeamMembers().map(member => member.username.toLowerCase()));
      const deletedUsernamesToMark = pendingDeletedUsernames.filter(deletedUsername => (
        latestMutations[deletedUsername]?.operation === 'delete'
        && !activeUsernames.has(deletedUsername)
      ));
      for (const deletedUsername of deletedUsernamesToMark) {
        await markRemoteUserDataDeleted(config, deletedUsername, username);
      }
      // A newer restore/upsert from another administrator supersedes an older
      // pending deletion; clear that stale local queue item without touching
      // the restored account's cloud backup.
      clearPendingDeletedUsernames(pendingDeletedUsernames);
    }

    mergedRecords = await uploadCloudPayload(config, username, mergedRecords, userRemoteVersion);

    saveSyncStatus({
      sync_status: 'success',
      last_synced_at: new Date().toLocaleTimeString(),
      last_error_msg: undefined
    });
    return true;
  } catch (error) {
    saveSyncStatus({
      sync_status: 'error',
      last_error_msg: getErrorMessage(error)
    });
    return false;
  }
}

/**
 * Upload the user's records together with shared team data. Writes are
 * serialized so a slow earlier request cannot overwrite a newer answer.
 */
export function queuePushToCloud(
  username?: string,
  records?: Record<string, UserRecord>,
  options: CloudPushOptions = {}
): Promise<boolean> {
  return enqueueCloudTask(() => performCloudPush(username, records, options));
}

/** Download, validate and merge the latest user/team data, then upload the merged snapshot. */
async function performCloudPull(
  username?: string
): Promise<{ success: boolean; message: string; data?: CloudSyncPayload }> {
  if (!username) {
    return { success: true, message: '未登录，已跳过云同步' };
  }

  const config = getSyncConfig();
  saveSyncStatus({ sync_status: 'syncing', last_error_msg: undefined });

  try {
    const response = await fetchWithSyncTimeout(getRemoteDataUrl(config, username), {
      method: 'GET',
      headers: getRequestHeaders(config)
    });

    if (response.status === 404) {
      const localRecords = getUserRecords(username);
      // We are already inside the shared sync queue; nesting another queued
      // task here would deadlock behind the current pull.
      const hasMemberMutation = Object.keys(getTeamMemberMutations()).length > 0;
      const uploaded = await performCloudPush(
        username,
        localRecords,
        hasMemberMutation ? { sharedDataAuthority: 'local' } : undefined
      );
      return {
        success: uploaded,
        message: uploaded ? '云端暂无记录，已上传本机数据作为初始副本' : '云端暂无记录，但初始化上传失败'
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const remote = await response.json() as Partial<CloudSyncPayload>;
    if (remote.schemaVersion !== 1 || !remote.records || typeof remote.records !== 'object') {
      throw new Error('云端数据格式无效或版本不受支持');
    }

    const localMember = getTeamMembers().find(member => member.username.toLowerCase() === username.toLowerCase());
    const mergedRecords = remotePayloadMatchesAccount(remote, localMember)
      ? mergeUserRecords(getUserRecords(username), remote.records)
      : getUserRecords(username);
    batchSaveUserRecords(username, Object.values(mergedRecords));

    const remoteShared = await fetchSharedCloudData(config);
    if (remoteShared) {
      const localMutations = getTeamMemberMutations();
      const shouldRepublishLocalMutations = hasNewerLocalMemberMutation(
        localMutations,
        remoteShared.memberMutations || {}
      );
      applySharedCloudSnapshot(remoteShared);
      const accountStillActive = getTeamMembers().some(
        member => member.username.toLowerCase() === username.toLowerCase()
      );
      if (!accountStillActive) {
        purgeUserData(username);
        throw new Error('当前账号已被管理员注销，本机学习数据已清理');
      }
      if (shouldRepublishLocalMutations) {
        await uploadSharedCloudData(config, {
          teamMembers: getTeamMembers(),
          announcements: getAnnouncements(),
          memberMutations: getTeamMemberMutations()
        }, remoteShared);
      }
    } else {
      // One-time compatibility path for older per-user payloads.
      mergeSharedCloudData(remote);
    }
    if (remote.examPlan) {
      storeExamPlanSnapshot(username, mergeExamPlans(getExamPlan(username), remote.examPlan));
    }

    let uploadedRecords = mergedRecords;
    let uploaded = true;
    try {
      uploadedRecords = await uploadCloudPayload(config, username, mergedRecords, {
        exists: true,
        etag: response.headers?.get?.('etag') || undefined
      });
      saveSyncStatus({
        sync_status: 'success',
        last_synced_at: new Date().toLocaleTimeString(),
        last_error_msg: undefined
      });
    } catch (uploadError) {
      uploaded = false;
      saveSyncStatus({ sync_status: 'error', last_error_msg: getErrorMessage(uploadError) });
    }
    return {
      success: uploaded,
      message: uploaded
        ? `同步完成：已合并 ${Object.keys(uploadedRecords).length} 道本地与云端记录`
        : '云端数据已下载到本机，但合并结果回传失败，请检查网络',
      data: buildCloudPayload(username, uploadedRecords)
    };
  } catch (error) {
    const message = getErrorMessage(error);
    saveSyncStatus({ sync_status: 'error', last_error_msg: message });
    return { success: false, message: `坚果云同步失败：${message}` };
  }
}

export function pullCloudData(
  username?: string
): Promise<{ success: boolean; message: string; data?: CloudSyncPayload }> {
  return enqueueCloudTask(() => performCloudPull(username));
}


