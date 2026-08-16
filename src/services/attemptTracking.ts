import type { UserRecord } from '../types';

const DEVICE_ID_STORAGE_KEY = 'strj_device_id';
const LEGACY_COUNTER_KEY = 'legacy';

let runtimeDeviceId: string | undefined;
let runtimeSequence = 0;

function randomToken(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  runtimeSequence += 1;
  return `${Date.now().toString(36)}-${runtimeSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Return an installation-local id. It is deliberately never uploaded alone. */
export function getPracticeDeviceId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;

    const created = `device-${randomToken()}`;
    globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, created);
    if (globalThis.localStorage) return created;
  } catch {
    // Storage can be unavailable in privacy mode. The runtime id still keeps
    // repeated attempts in this tab internally consistent.
  }

  runtimeDeviceId ||= `runtime-${randomToken()}`;
  return runtimeDeviceId;
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function sumCounters(counters: Record<string, number>): number {
  return Object.values(counters).reduce((sum, value) => sum + safeCount(value), 0);
}

function normalizeCounters(
  counters: Record<string, number> | undefined,
  legacyTotal: number
): Record<string, number> {
  const normalized: Record<string, number> = {};
  Object.entries(counters || {}).forEach(([deviceId, value]) => {
    const count = safeCount(value);
    if (deviceId && count > 0) normalized[deviceId] = count;
  });

  // Old clients may update the scalar total while preserving unknown fields.
  // Put only the missing difference into the legacy bucket so it is counted
  // once, rather than duplicating all device counters.
  const missingLegacyAttempts = Math.max(0, safeCount(legacyTotal) - sumCounters(normalized));
  if (missingLegacyAttempts > 0) {
    normalized[LEGACY_COUNTER_KEY] = (normalized[LEGACY_COUNTER_KEY] || 0) + missingLegacyAttempts;
  }
  return normalized;
}

function inferredWrongCount(record: UserRecord): number {
  const historyFailures = (record.review_history || []).filter(entry => !entry.passed).length;
  const legacyWrong = record.status === 'wrong' && record.attempt_count > 0 ? 1 : 0;
  return Math.max(safeCount(record.wrong_count), historyFailures, legacyWrong);
}

function mergeCounterMaps(
  local: Record<string, number>,
  remote: Record<string, number>
): Record<string, number> {
  const merged = { ...local };
  Object.entries(remote).forEach(([deviceId, count]) => {
    merged[deviceId] = Math.max(merged[deviceId] || 0, count);
  });
  return merged;
}

export function incrementPracticeCounters(
  record: UserRecord,
  passed: boolean
): Pick<UserRecord, 'attempt_count' | 'wrong_count' | 'attempt_counts_by_device' | 'wrong_counts_by_device'> {
  const deviceId = getPracticeDeviceId();
  const attempts = normalizeCounters(record.attempt_counts_by_device, record.attempt_count);
  const wrongs = normalizeCounters(record.wrong_counts_by_device, inferredWrongCount(record));

  attempts[deviceId] = (attempts[deviceId] || 0) + 1;
  if (!passed) wrongs[deviceId] = (wrongs[deviceId] || 0) + 1;

  return {
    attempt_count: sumCounters(attempts),
    wrong_count: sumCounters(wrongs),
    attempt_counts_by_device: attempts,
    wrong_counts_by_device: wrongs
  };
}

export function mergePracticeCounters(
  local: UserRecord,
  remote: UserRecord
): Pick<UserRecord, 'attempt_count' | 'wrong_count' | 'attempt_counts_by_device' | 'wrong_counts_by_device'> {
  const attempts = mergeCounterMaps(
    normalizeCounters(local.attempt_counts_by_device, local.attempt_count),
    normalizeCounters(remote.attempt_counts_by_device, remote.attempt_count)
  );
  const wrongs = mergeCounterMaps(
    normalizeCounters(local.wrong_counts_by_device, inferredWrongCount(local)),
    normalizeCounters(remote.wrong_counts_by_device, inferredWrongCount(remote))
  );

  return {
    attempt_count: sumCounters(attempts),
    wrong_count: sumCounters(wrongs),
    attempt_counts_by_device: attempts,
    wrong_counts_by_device: wrongs
  };
}

export function createReviewHistoryEntry(
  reviewedAt: string,
  passed: boolean
): NonNullable<UserRecord['review_history']>[number] {
  return {
    id: `${getPracticeDeviceId()}-${randomToken()}`,
    reviewed_at: reviewedAt,
    passed
  };
}

export function mergeReviewHistory(
  local: UserRecord['review_history'],
  remote: UserRecord['review_history']
): UserRecord['review_history'] {
  if (!local && !remote) return undefined;

  const entries = new Map<string, NonNullable<UserRecord['review_history']>[number]>();
  [...(local || []), ...(remote || [])].forEach(entry => {
    const key = entry.id || `legacy:${entry.reviewed_at}:${entry.passed ? '1' : '0'}`;
    if (!entries.has(key)) entries.set(key, entry);
  });

  return [...entries.values()].sort((a, b) => {
    const timestampOrder = a.reviewed_at.localeCompare(b.reviewed_at);
    if (timestampOrder !== 0) return timestampOrder;
    return (a.id || '').localeCompare(b.id || '');
  });
}
