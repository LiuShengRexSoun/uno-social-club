import { normalizeRules, type Rules } from "../shared/engine.ts";

export interface LocalProfile {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface MatchSummary {
  id: string;
  profileId: string;
  mode: "ai" | "online";
  won: boolean;
  winnerName: string;
  finishedAt: number;
  turns: number;
  rules: Rules;
  players: { name: string; cardCount: number }[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = "uno-local-v1";
export const MAX_PROFILES = 8;
export const MAX_MATCHES = 50;
export const MATCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 256_000;

interface Document {
  version: 1;
  activeProfileId: string | null;
  profiles: LocalProfile[];
  matches: MatchSummary[];
}

function empty(): Document {
  return { version: 1, activeProfileId: null, profiles: [], matches: [] };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validTime(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= now + 5 * 60_000
  );
}

function name(value: unknown, minimum = 1): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value))
    return null;
  const result = value.trim().replace(/\s+/gu, " ");
  return [...result].length >= minimum && [...result].length <= 24
    ? result
    : null;
}

function match(value: unknown, now: number): MatchSummary | null {
  const raw = object(value);
  if (
    !raw ||
    !validId(raw.id) ||
    !validId(raw.profileId) ||
    !["ai", "online"].includes(raw.mode as string) ||
    typeof raw.won !== "boolean" ||
    !name(raw.winnerName) ||
    !validTime(raw.finishedAt, now) ||
    !Number.isInteger(raw.turns) ||
    (raw.turns as number) < 1 ||
    (raw.turns as number) > 100_000 ||
    !Array.isArray(raw.players) ||
    raw.players.length < 2 ||
    raw.players.length > 4
  )
    return null;
  const players: MatchSummary["players"] = [];
  for (const value of raw.players) {
    const player = object(value);
    const displayName = name(player?.name);
    if (
      !player ||
      !displayName ||
      !Number.isInteger(player.cardCount) ||
      (player.cardCount as number) < 0 ||
      (player.cardCount as number) > 108
    )
      return null;
    players.push({ name: displayName, cardCount: player.cardCount as number });
  }
  return {
    id: raw.id,
    profileId: raw.profileId,
    mode: raw.mode as MatchSummary["mode"],
    won: raw.won,
    winnerName: name(raw.winnerName)!,
    finishedAt: raw.finishedAt,
    turns: raw.turns as number,
    rules: normalizeRules(object(raw.rules) as Partial<Rules> | null),
    players,
  };
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Browser-only demo data, kept in one atomic document. This is not remote authentication. */
export function createLocalStore(
  storage: StorageLike,
  now: () => number = Date.now,
  id: () => string = randomId,
) {
  function sanitize(raw: unknown): Document {
    const doc = empty();
    const input = object(raw);
    if (!input || input.version !== 1) return doc;
    const timestamp = now();
    const ids = new Set<string>();
    if (Array.isArray(input.profiles)) {
      for (const candidate of input.profiles.slice(0, 64)) {
        const profile = object(candidate);
        const displayName = name(profile?.name, 2);
        if (
          !profile ||
          !validId(profile.id) ||
          ids.has(profile.id) ||
          !displayName ||
          !validTime(profile.createdAt, timestamp) ||
          !validTime(profile.lastUsedAt, timestamp)
        )
          continue;
        ids.add(profile.id);
        doc.profiles.push({
          id: profile.id,
          name: displayName,
          createdAt: profile.createdAt,
          lastUsedAt: profile.lastUsedAt,
        });
      }
    }
    doc.activeProfileId =
      validId(input.activeProfileId) && ids.has(input.activeProfileId)
        ? input.activeProfileId
        : null;
    doc.profiles.sort(
      (a, b) =>
        Number(b.id === doc.activeProfileId) -
          Number(a.id === doc.activeProfileId) ||
        b.lastUsedAt - a.lastUsedAt ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    );
    doc.profiles = doc.profiles.slice(0, MAX_PROFILES);
    const retained = new Set(doc.profiles.map((profile) => profile.id));
    const matchIds = new Set<string>();
    if (Array.isArray(input.matches)) {
      for (const candidate of input.matches.slice(0, 1000)) {
        const summary = match(candidate, timestamp);
        if (
          summary &&
          retained.has(summary.profileId) &&
          !matchIds.has(summary.id) &&
          summary.finishedAt >= timestamp - MATCH_MAX_AGE_MS
        ) {
          matchIds.add(summary.id);
          doc.matches.push(summary);
        }
      }
    }
    doc.matches.sort(
      (a, b) => b.finishedAt - a.finishedAt || a.id.localeCompare(b.id),
    );
    doc.matches = doc.matches.slice(0, MAX_MATCHES);
    return doc;
  }

  function persist(doc: Document) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(sanitize(doc)));
    } catch {
      throw new Error(
        "浏览器无法保存本地档案，请允许站点存储或清理空间后重试。",
      );
    }
  }

  function read(): Document {
    try {
      const serialized = storage.getItem(STORAGE_KEY);
      if (serialized === null) return empty();
      if (serialized.length > MAX_DOCUMENT_BYTES) return empty();
      const cleaned = sanitize(JSON.parse(serialized));
      // Reads also retire expired history, while blocked writes must not break viewing.
      if (JSON.stringify(cleaned) !== serialized) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        } catch {
          /* The pruned view remains usable when storage is read-only. */
        }
      }
      return cleaned;
    } catch {
      return empty();
    }
  }

  function listProfiles(): LocalProfile[] {
    return read().profiles.sort(
      (a, b) => b.lastUsedAt - a.lastUsedAt || a.id.localeCompare(b.id),
    );
  }

  function getActiveProfile(): LocalProfile | null {
    const doc = read();
    return (
      doc.profiles.find((profile) => profile.id === doc.activeProfileId) ?? null
    );
  }

  function createProfile(input: string): LocalProfile {
    const displayName = name(input, 2);
    if (!displayName)
      throw new Error("玩家昵称需为 2–24 个字符，不能包含控制字符。");
    const doc = read();
    if (doc.profiles.some((profile) => profile.name === displayName))
      throw new Error("本机已有这个玩家，请直接选择该档案。");
    const generatedId = id();
    if (
      !validId(generatedId) ||
      doc.profiles.some((profile) => profile.id === generatedId)
    )
      throw new Error("无法生成新的玩家标识，请重试。");
    if (doc.profiles.length >= MAX_PROFILES) {
      const oldestInactive = doc.profiles
        .filter((profile) => profile.id !== doc.activeProfileId)
        .sort(
          (a, b) => a.lastUsedAt - b.lastUsedAt || a.createdAt - b.createdAt,
        )[0];
      if (oldestInactive) {
        doc.profiles = doc.profiles.filter(
          (profile) => profile.id !== oldestInactive.id,
        );
        doc.matches = doc.matches.filter(
          (summary) => summary.profileId !== oldestInactive.id,
        );
      }
    }
    const profile = {
      id: generatedId,
      name: displayName,
      createdAt: now(),
      lastUsedAt: now(),
    };
    doc.profiles.push(profile);
    doc.activeProfileId = profile.id;
    persist(doc);
    return { ...profile };
  }

  function selectProfile(profileId: string): LocalProfile {
    const doc = read();
    const profile = doc.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    if (!profile) throw new Error("这个本地档案已不存在，请重新选择。");
    profile.lastUsedAt = now();
    doc.activeProfileId = profile.id;
    persist(doc);
    return { ...profile };
  }

  function logoutProfile(): void {
    const doc = read();
    doc.activeProfileId = null;
    persist(doc);
  }

  function deleteProfile(profileId: string): void {
    const doc = read();
    doc.profiles = doc.profiles.filter((profile) => profile.id !== profileId);
    doc.matches = doc.matches.filter(
      (summary) => summary.profileId !== profileId,
    );
    if (doc.activeProfileId === profileId) doc.activeProfileId = null;
    persist(doc);
  }

  function saveMatch(input: MatchSummary): void {
    const summary = match(input, now());
    if (!summary) throw new Error("对局记录格式不正确，无法保存。");
    const doc = read();
    if (!doc.profiles.some((profile) => profile.id === summary.profileId))
      throw new Error("请先创建或选择本地玩家档案。");
    if (doc.matches.some((previous) => previous.id === summary.id)) return;
    doc.matches.push(summary);
    persist(doc);
  }

  function listMatches(profileId?: string): MatchSummary[] {
    return read().matches.filter(
      (summary) => !profileId || summary.profileId === profileId,
    );
  }

  function getStats(profileId?: string): { games: number; wins: number } {
    const matches = listMatches(profileId);
    return {
      games: matches.length,
      wins: matches.filter((summary) => summary.won).length,
    };
  }

  return {
    listProfiles,
    getActiveProfile,
    createProfile,
    selectProfile,
    logoutProfile,
    deleteProfile,
    saveMatch,
    listMatches,
    getStats,
  };
}

function browserStore() {
  // Accessing localStorage itself may throw in restricted browsers. Keep it lazy.
  return createLocalStore({
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  });
}

export const listProfiles = () => browserStore().listProfiles();
export const getActiveProfile = () => browserStore().getActiveProfile();
export const createProfile = (value: string) =>
  browserStore().createProfile(value);
export const selectProfile = (id: string) => browserStore().selectProfile(id);
export const logoutProfile = () => browserStore().logoutProfile();
export const deleteProfile = (id: string) => browserStore().deleteProfile(id);
export const saveMatch = (summary: MatchSummary) =>
  browserStore().saveMatch(summary);
export const listMatches = (profileId?: string) =>
  browserStore().listMatches(profileId);
export const getStats = (profileId?: string) =>
  browserStore().getStats(profileId);
