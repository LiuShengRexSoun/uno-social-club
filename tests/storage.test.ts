import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES } from "../shared/engine.ts";
import {
  createLocalStore,
  MATCH_MAX_AGE_MS,
  STORAGE_KEY,
  type MatchSummary,
  type StorageLike,
} from "../src/storage.ts";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function setup() {
  const storage = new MemoryStorage();
  let timestamp = 1_800_000_000_000;
  let sequence = 0;
  const store = createLocalStore(
    storage,
    () => timestamp,
    () => `profile-${++sequence}`,
  );
  return {
    storage,
    store,
    now: () => timestamp,
    advance: (delta: number) => {
      timestamp += delta;
    },
  };
}

function game(
  profileId: string,
  id: string,
  finishedAt: number,
  won = true,
): MatchSummary {
  return {
    id,
    profileId,
    finishedAt,
    won,
    mode: "ai",
    winnerName: "你",
    turns: 24,
    rules: { ...DEFAULT_RULES },
    players: [
      { name: "你", cardCount: won ? 0 : 2 },
      { name: "Milo", cardCount: won ? 3 : 0 },
    ],
  };
}

test("local profiles normalize names, persist selection and support independent browser-store instances", () => {
  const { store, storage, advance, now } = setup();
  const one = store.createProfile("  白焰   少主  ");
  assert.equal(one.name, "白焰 少主");
  assert.deepEqual(store.getActiveProfile(), one);
  advance(10);
  const two = store.createProfile("Milo");
  assert.equal(store.getActiveProfile()!.id, two.id);
  advance(10);
  const selected = store.selectProfile(one.id);
  assert.ok(selected.lastUsedAt > one.lastUsedAt);
  assert.equal(createLocalStore(storage, now).getActiveProfile()?.id, one.id);
  store.logoutProfile();
  assert.equal(store.getActiveProfile(), null);
  assert.equal(store.listProfiles().length, 2);
});

test("invalid names, duplicate local names, duplicate generated IDs and unknown selections fail clearly", () => {
  const { store, storage, now } = setup();
  for (const name of ["", "a", "  ", "a\nname", "x".repeat(25)])
    assert.throws(() => store.createProfile(name), /2–24/);
  const one = store.createProfile("Alphy");
  assert.throws(() => store.createProfile(" Alphy "), /已有/);
  assert.throws(() => store.selectProfile("unknown"), /已不存在/);
  assert.throws(
    () => createLocalStore(storage, now, () => one.id).createProfile("Luna"),
    /玩家标识/,
  );
});

test("profile capacity evicts the oldest inactive profile and its history, preserving the active profile", () => {
  const { store, now, advance } = setup();
  const first = store.createProfile("first");
  advance(1);
  const second = store.createProfile("second");
  store.saveMatch(game(second.id, "old", now()));
  for (let i = 0; i < 6; i++) {
    advance(1);
    store.createProfile(`player-${i}`);
  }
  store.selectProfile(first.id);
  advance(1);
  const ninth = store.createProfile("ninth");
  assert.equal(store.listProfiles().length, 8);
  assert.equal(store.getActiveProfile()?.id, ninth.id);
  assert.ok(store.listProfiles().some((p) => p.id === first.id));
  assert.ok(!store.listProfiles().some((p) => p.id === second.id));
  assert.equal(store.listMatches().length, 0);
});

test("history is bounded to the newest fifty completed games across all profiles", () => {
  const { store, now, advance } = setup();
  const a = store.createProfile("alpha"),
    b = store.createProfile("bravo");
  for (let i = 0; i < 60; i++) {
    advance(1);
    store.saveMatch(
      game(i % 2 ? a.id : b.id, `match-${i}`, now(), i % 2 === 0),
    );
  }
  const matches = store.listMatches();
  assert.equal(matches.length, 50);
  assert.equal(matches[0].id, "match-59");
  assert.equal(matches.at(-1)?.id, "match-10");
  assert.deepEqual(store.getStats(a.id), { games: 25, wins: 0 });
  assert.deepEqual(store.getStats(b.id), { games: 25, wins: 25 });
});

test("the thirty-day window is pruned on reads and persisted without accumulating old entries", () => {
  const { store, storage, now, advance } = setup();
  const p = store.createProfile("player");
  store.saveMatch(game(p.id, "at-boundary", now()));
  advance(MATCH_MAX_AGE_MS);
  assert.equal(store.listMatches().length, 1);
  advance(1);
  assert.equal(store.listMatches().length, 0);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)!).matches.length, 0);
  store.saveMatch(game(p.id, "already-expired", now() - MATCH_MAX_AGE_MS - 1));
  assert.equal(store.listMatches().length, 0);
});

test("match IDs are idempotent, and both saved input and returned records are detached copies", () => {
  const { store, now } = setup();
  const p = store.createProfile("player");
  const input = game(p.id, "same", now());
  store.saveMatch(input);
  input.players[0].name = "changed";
  input.rules.sevenZero = true;
  const copy = store.listMatches()[0];
  assert.equal(copy.players[0].name, "你");
  assert.equal(copy.rules.sevenZero, false);
  copy.players[0].name = "changed";
  copy.rules.sevenZero = true;
  store.saveMatch({ ...game(p.id, "same", now()), won: false });
  assert.deepEqual(store.getStats(), { games: 1, wins: 1 });
  assert.equal(store.listMatches()[0].players[0].name, "你");
  const profile = store.listProfiles()[0];
  profile.name = "changed";
  assert.equal(store.listProfiles()[0].name, "player");
});

test("deleting a profile removes its games and active selection without touching other players", () => {
  const { store, now } = setup();
  const a = store.createProfile("alpha"),
    b = store.createProfile("bravo");
  store.saveMatch(game(a.id, "a", now()));
  store.saveMatch(game(b.id, "b", now()));
  store.deleteProfile(b.id);
  assert.equal(store.getActiveProfile(), null);
  assert.deepEqual(
    store.listMatches().map((m) => m.id),
    ["a"],
  );
  assert.equal(store.listProfiles()[0].id, a.id);
});

test("corrupted, oversized or unsupported documents read as empty and can be replaced on creation", () => {
  const { store, storage } = setup();
  for (const raw of [
    "{broken",
    "null",
    "[]",
    '{"version":99}',
    " ".repeat(256_001),
  ]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.deepEqual(store.listProfiles(), []);
    assert.equal(store.getActiveProfile(), null);
    assert.deepEqual(store.getStats(), { games: 0, wins: 0 });
  }
  store.createProfile("recovered");
  assert.equal(store.listProfiles()[0].name, "recovered");
});

test("read sanitization drops invalid entries, deduplicates identities and ignores extraneous object keys", () => {
  const { store, storage, now } = setup();
  const p = store.createProfile("player");
  const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
  raw.profiles.push(
    { ...p, name: "duplicate" },
    { id: "bad", name: "bad", createdAt: Infinity, lastUsedAt: now() },
  );
  raw.matches = [
    game(p.id, "good", now()),
    game(p.id, "good", now()),
    game("missing", "orphan", now()),
    { ...game(p.id, "bad-date", now()), finishedAt: now() + 1e9 },
    {
      ...game(p.id, "bad-count", now()),
      players: [
        { name: "a", cardCount: 999 },
        { name: "b", cardCount: 0 },
      ],
    },
  ];
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...raw, __proto__: { polluted: true }, other: "ignored" }),
  );
  assert.equal(store.listProfiles().length, 1);
  assert.deepEqual(
    store.listMatches().map((m) => m.id),
    ["good"],
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("blocked storage fails safely for reads and reports failed writes without inventing a saved profile", () => {
  const blocked = createLocalStore({
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  assert.deepEqual(blocked.listProfiles(), []);
  assert.deepEqual(blocked.listMatches(), []);
  assert.throws(() => blocked.createProfile("player"), /浏览器无法保存/);
  assert.equal(blocked.getActiveProfile(), null);
  const { storage, store, now } = setup();
  const p = store.createProfile("player");
  const noWrites = createLocalStore(
    {
      getItem: (key) => storage.getItem(key),
      setItem() {
        throw new Error("quota");
      },
    },
    now,
  );
  assert.equal(noWrites.getActiveProfile()?.id, p.id);
  assert.throws(() => noWrites.logoutProfile(), /浏览器无法保存/);
  assert.equal(store.getActiveProfile()?.id, p.id);
});

test("invalid completed summaries are rejected rather than persisting unbounded fields", () => {
  const { store, now } = setup();
  const p = store.createProfile("player");
  for (const patch of [
    { turns: NaN },
    { turns: 0 },
    { winnerName: "x".repeat(25) },
    { mode: "other" },
    { players: [] },
    { finishedAt: -1 },
    { won: "yes" },
  ]) {
    assert.throws(
      () =>
        store.saveMatch({
          ...game(p.id, "invalid", now()),
          ...patch,
        } as MatchSummary),
      /格式/,
    );
  }
  assert.throws(
    () => store.saveMatch(game("missing", "orphan", now())),
    /先创建/,
  );
  assert.equal(store.listMatches().length, 0);
});
