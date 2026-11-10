import test from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { createUnoServer } from "../server/app.js";
import { DEFAULT_RULES, type GameView, type Rules } from "../shared/engine.js";

type Account = { token: string; user: { id: string; name: string } };
const next = <T>(socket: Socket, event: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 3000);
    const listener = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(event, listener);
  });
const command = (socket: Socket, event: string, payload: unknown = null) =>
  new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
    socket
      .timeout(3000)
      .emit(
        event,
        payload,
        (error: Error | null, response: { ok: boolean; error?: string }) =>
          error ? reject(error) : resolve(response),
      );
  });

test("online auth, matchmaking, private hands, authoritative actions, reconnect and private rooms", async () => {
  const app = createUnoServer({
    dbPath: ":memory:",
    allowedOrigins: ["http://localhost:10888"],
  });
  const url = await app.listen(0, "127.0.0.1");
  const sockets: Socket[] = [];
  const register = async (username: string) => {
    const response = await fetch(`${url}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "SafePassword123" }),
    });
    assert.equal(response.status, 201);
    const data = (await response.json()) as Account;
    assert.equal(Object.hasOwn(data.user, "hash"), false);
    assert.equal(Object.hasOwn(data.user, "salt"), false);
    return data;
  };
  const connect = async (account: Account) => {
    const socket = io(url, {
      auth: { token: account.token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    await next(socket, "connect");
    return socket;
  };
  try {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ALICE", password: "SafePassword123" }),
    });
    assert.equal(loginResponse.status, 200);
    assert.equal(
      ((await loginResponse.json()) as Account).user.id,
      alice.user.id,
    );
    const badLogin = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Alice", password: "WrongPassword123" }),
    });
    assert.equal(badLogin.status, 401);
    const forbidden = await fetch(`${url}/health`, {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(forbidden.status, 403);
    const me = await fetch(`${url}/api/me`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert.equal(
      ((await me.json()) as { user: Account["user"] }).user.id,
      alice.user.id,
    );
    const invalid = io(url, {
      auth: { token: "bad" },
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(invalid);
    await next(invalid, "connect_error");

    const a = await connect(alice),
      b = await connect(bob);
    const aState = next<GameView>(a, "state"),
      bState = next<GameView>(b, "state");
    assert.equal((await command(a, "queue:join")).ok, true);
    assert.equal((await command(b, "queue:join")).ok, true);
    const [viewA, viewB] = await Promise.all([aState, bState]);
    assert.equal(viewA.hand.length, 7);
    assert.equal(viewB.hand.length, 7);
    assert.equal(viewA.topCard.id, viewB.topCard.id);
    assert.deepEqual(
      viewA.players.map((p) => p.id),
      viewB.players.map((p) => p.id),
    );
    assert.equal(
      viewA.hand.some((c) => viewB.hand.some((d) => d.id === c.id)),
      false,
    );
    assert.equal(
      viewA.players.some((p) => Object.hasOwn(p, "hand")),
      false,
    );
    assert.equal(Object.hasOwn(viewA, "deck"), false);
    assert.deepEqual(viewA.rules, DEFAULT_RULES);
    const current = viewA.currentPlayerId === alice.user.id ? a : b;
    const waiting = current === a ? b : a;
    const illegal = await command(waiting, "game:action", { type: "draw" });
    assert.equal(illegal.ok, false);
    const forged = await command(current, "game:action", {
      type: "play",
      cardId: "forged-card-id",
    });
    assert.equal(forged.ok, false);
    const drawn = next<GameView>(current, "state");
    assert.equal(
      (await command(current, "game:action", { type: "draw" })).ok,
      true,
    );
    assert.equal((await drawn).hand.length, 8);
    const passed = next<GameView>(current, "state");
    assert.equal(
      (await command(current, "game:action", { type: "pass" })).ok,
      true,
    );
    const afterPass = await passed;
    assert.notEqual(afterPass.currentPlayerId, viewA.currentPlayerId);

    // Reconnect preserves membership and personalized state instead of joining twice.
    a.disconnect();
    const reconnected = io(url, {
      auth: { token: alice.token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(reconnected);
    const restored = await next<GameView>(reconnected, "state");
    assert.equal(restored.players.length, 2);
    assert.equal(restored.currentPlayerId, afterPass.currentPlayerId);
    assert.equal((await command(reconnected, "room:leave")).ok, true);
    assert.equal((await command(b, "room:leave")).ok, true);

    const created = next<{
      code: string;
      hostId: string;
      players: unknown[];
      rules: Rules;
    }>(reconnected, "lobby");
    assert.equal((await command(reconnected, "room:create")).ok, true);
    const room = await created;
    assert.match(room.code, /^[A-Z2-9]{6}$/);
    assert.equal(room.hostId, alice.user.id);
    assert.equal((await command(reconnected, "room:start")).ok, false);
    assert.equal(
      (await command(b, "room:join", room.code.toLowerCase())).ok,
      true,
    );
    assert.equal((await command(b, "room:start")).ok, false);
    assert.equal(
      (await command(b, "room:rules", { startingCards: 10 })).ok,
      false,
    );
    assert.equal(
      (await command(reconnected, "room:rules", { startingCards: 999 })).ok,
      false,
    );
    assert.equal(
      (await command(reconnected, "room:rules", { startingCards: 2 })).ok,
      false,
    );
    assert.equal(
      (await command(reconnected, "room:rules", { startingCards: 16 })).ok,
      false,
    );
    assert.equal(
      (await command(reconnected, "room:rules", { inventedRule: true })).ok,
      false,
    );
    const changed = next<{ rules: Rules }>(b, "lobby");
    assert.equal(
      (
        await command(reconnected, "room:rules", {
          startingCards: 10,
          sevenZero: true,
        })
      ).ok,
      true,
    );
    assert.equal((await changed).rules.startingCards, 10);
    const startA = next<GameView>(reconnected, "state"),
      startB = next<GameView>(b, "state");
    assert.equal((await command(reconnected, "room:start")).ok, true);
    const views = await Promise.all([startA, startB]);
    assert.equal(views[0].players.length, 2);
    assert.equal(views[1].status, "playing");
    assert.equal(views[0].hand.length, 10);
    assert.equal(views[1].hand.length, 10);
    assert.equal(views[0].rules.sevenZero, true);
    assert.equal(
      (await command(reconnected, "room:rules", { startingCards: 5 })).ok,
      false,
    );
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await app.close();
  }
});
