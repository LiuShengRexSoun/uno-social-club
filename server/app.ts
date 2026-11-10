import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Server, type Socket } from "socket.io";
import {
  applyAction,
  createGame,
  getView,
  chooseBotAction,
  normalizeRules,
  DEFAULT_RULES,
  type Action,
  type GameState,
  type Rules,
} from "../shared/engine.js";

type User = { id: string; name: string };
type DbUser = { id: string; name: string; salt: string; hash: string };
type Room = {
  code: string;
  hostId: string;
  players: User[];
  game: GameState | null;
  rules: Rules;
  turnTimer?: ReturnType<typeof setTimeout>;
};
export type UnoServerOptions = {
  dbPath?: string;
  allowedOrigins?: string[];
  turnMs?: number;
  disconnectGraceMs?: number;
};

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const passwordHash = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, hash) =>
      error ? reject(error) : resolve(hash),
    );
  });

function validateRules(payload: unknown): Partial<Rules> {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== "object" || Array.isArray(payload))
    throw new Error("无效的房规设置");
  for (const [key, value] of Object.entries(payload)) {
    if (!Object.hasOwn(DEFAULT_RULES, key)) throw new Error("未知的房规设置");
    if (key === "startingCards") {
      if (!Number.isInteger(value) || Number(value) < 3 || Number(value) > 15)
        throw new Error("起手牌数需为 3–15");
    } else if (key === "stacking") {
      if (!["none", "same", "any"].includes(String(value)))
        throw new Error("无效的叠加规则");
    } else if (key === "drawMode") {
      if (!["one", "until-playable"].includes(String(value)))
        throw new Error("无效的摸牌规则");
    } else if (key === "unoPenalty") {
      if (![0, 2, 4].includes(Number(value)) || typeof value !== "number")
        throw new Error("无效的 UNO 罚牌规则");
    } else if (typeof value !== "boolean")
      throw new Error("房规开关需要布尔值");
  }
  return payload as Partial<Rules>;
}

/** One authoritative process. Accounts persist; rooms deliberately remain ephemeral. */
export function createUnoServer(options: UnoServerOptions = {}) {
  const dbPath =
    options.dbPath ??
    (process.env.UNO_DATA_DIR
      ? `${process.env.UNO_DATA_DIR}/uno.sqlite`
      : "runs/server/uno.sqlite");
  if (dbPath !== ":memory:")
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);`);
  db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  const allowedOrigins = new Set(
    options.allowedOrigins ??
      (
        process.env.ALLOWED_ORIGINS ||
        "http://localhost:10888,http://127.0.0.1:10888"
      )
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
  );
  const turnMs = Math.max(30_000, options.turnMs ?? 45_000);
  const disconnectGraceMs = options.disconnectGraceMs ?? 60_000;
  const authLimits = new Map<string, { count: number; reset: number }>();
  const sockets = new Map<string, Socket>();
  const rooms = new Map<string, Room>();
  const membership = new Map<string, string>();
  const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queue: User[] = [];
  let closed = false;

  function findUser(token: unknown): User | null {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db
      .prepare(
        "SELECT users.id, users.name FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?",
      )
      .get(hashToken(token), Date.now());
    return row ? { id: String(row.id), name: String(row.name) } : null;
  }
  const issueToken = (user: User) => {
    const token = randomBytes(32).toString("hex");
    db.prepare(
      "INSERT INTO sessions (hash,user_id,expires) VALUES (?,?,?)",
    ).run(hashToken(token), user.id, Date.now() + 7 * 24 * 60 * 60 * 1000);
    return { token, user };
  };
  function json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  }
  async function readBody(req: IncomingMessage) {
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 4096) throw new Error("请求过大");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error("无效的 JSON 请求");
    }
  }
  const httpServer = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin))
      return json(res, 403, {
        error: "不允许的网页来源，请检查服务器 ALLOWED_ORIGINS",
      });
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = req.url?.split("?")[0];
    if (req.method === "GET" && path === "/health")
      return json(res, 200, { ok: true, players: sockets.size });
    if (req.method === "GET" && path === "/api/me") {
      const user = findUser(req.headers.authorization?.replace(/^Bearer /, ""));
      return json(
        res,
        user ? 200 : 401,
        user ? { user } : { error: "登录已过期，请重新登录" },
      );
    }
    if (
      req.method !== "POST" ||
      !["/api/auth/login", "/api/auth/register"].includes(path ?? "")
    )
      return json(res, 404, { error: "接口不存在" });
    const ip = req.socket.remoteAddress ?? "unknown";
    let limit = authLimits.get(ip);
    if (!limit || limit.reset < Date.now()) {
      limit = { count: 0, reset: Date.now() + 15 * 60_000 };
      authLimits.set(ip, limit);
    }
    if (++limit.count > 20)
      return json(res, 429, { error: "尝试次数过多，请稍后再试" });
    if (authLimits.size > 10_000)
      for (const [key, value] of authLimits)
        if (value.reset < Date.now()) authLimits.delete(key);
    try {
      const body = await readBody(req);
      const name =
        typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (
        !/^[\p{L}\p{N}_-]{2,20}$/u.test(name) ||
        password.length < 8 ||
        password.length > 128
      )
        return json(res, 400, {
          error:
            "用户名需为 2–20 位中英文字母、数字或下划线；密码需为 8–128 位",
        });
      const username = name.toLocaleLowerCase("en-US");
      if (path === "/api/auth/register") {
        if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
          return json(res, 409, { error: "这个用户名已经被使用了" });
        const salt = randomBytes(16).toString("hex");
        const hash = (await passwordHash(password, salt)).toString("hex");
        if (closed)
          return json(res, 503, { error: "服务正在关闭，请稍后再试" });
        const user = { id: randomUUID(), name };
        try {
          db.prepare(
            "INSERT INTO users (id,name,username,salt,hash) VALUES (?,?,?,?,?)",
          ).run(user.id, name, username, salt, hash);
        } catch {
          return json(res, 409, { error: "这个用户名已经被使用了" });
        }
        return json(res, 201, issueToken(user));
      }
      const user = db
        .prepare("SELECT id,name,salt,hash FROM users WHERE username=?")
        .get(username) as DbUser | undefined;
      // Run scrypt for unknown users too; never return account password material.
      const hash = await passwordHash(
        password,
        user?.salt ?? "00000000000000000000000000000000",
      );
      if (closed) return json(res, 503, { error: "服务正在关闭，请稍后再试" });
      if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, "hex")))
        return json(res, 401, { error: "用户名或密码不正确" });
      return json(res, 200, issueToken({ id: user.id, name: user.name }));
    } catch {
      return json(res, 400, { error: "请求格式不正确" });
    }
  });
  httpServer.requestTimeout = 10_000;
  httpServer.headersTimeout = 10_000;
  const io = new Server(httpServer, {
    cors: { origin: [...allowedOrigins], methods: ["GET", "POST"] },
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin || allowedOrigins.has(req.headers.origin),
      ),
    maxHttpBufferSize: 8192,
    serveClient: false,
  });
  io.use((socket, next) => {
    const user = findUser(socket.handshake.auth?.token);
    if (!user) return next(new Error("登录已过期，请重新登录"));
    socket.data.user = user;
    next();
  });

  function lobby(room: Room) {
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.game?.status ?? "waiting",
      rules: room.rules,
      players: room.players.map((p) => ({
        ...p,
        connected: sockets.has(p.id),
      })),
    };
  }
  function broadcast(room: Room) {
    for (const user of room.players) {
      const socket = sockets.get(user.id);
      socket?.emit("lobby", lobby(room));
      if (room.game) socket?.emit("state", getView(room.game, user.id));
    }
  }
  function scheduleTurn(room: Room) {
    clearTimeout(room.turnTimer);
    if (!room.game || room.game.status !== "playing") return;
    room.turnTimer = setTimeout(() => {
      if (!room.game || room.game.status !== "playing") return;
      const id = room.game.currentPlayerId;
      try {
        if (!room.game.drawnCardId)
          room.game = applyAction(room.game, id, { type: "draw" });
        if (
          room.game.currentPlayerId === id &&
          room.game.status === "playing"
        ) {
          const action: Action = room.game.rules.forcePlayDrawn
            ? chooseBotAction(room.game, id)
            : { type: "pass" };
          room.game = applyAction(room.game, id, action);
        }
        broadcast(room);
      } catch {
        /* An empty deck may already advance the turn. */
      }
      scheduleTurn(room);
    }, turnMs);
    room.turnTimer.unref();
  }
  function removeQueue(id: string) {
    const index = queue.findIndex((p) => p.id === id);
    if (index !== -1) queue.splice(index, 1);
    sockets.get(id)?.emit("queue", { queued: false });
  }
  function leaveRoom(id: string) {
    removeQueue(id);
    const room = rooms.get(membership.get(id) ?? "");
    membership.delete(id);
    sockets.get(id)?.emit("lobby", null);
    if (!room) return;
    const name = room.players.find((p) => p.id === id)?.name ?? "玩家";
    room.players = room.players.filter((p) => p.id !== id);
    if (!room.players.length) {
      clearTimeout(room.turnTimer);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === id) room.hostId = room.players[0]!.id;
    if (room.game?.status === "playing") {
      const game = room.game;
      const previousIndex = game.players.findIndex((p) => p.id === id);
      const leaver = game.players[previousIndex];
      const next =
        game.players[
          (previousIndex + game.direction + game.players.length) %
            game.players.length
        ]!;
      room.game = {
        ...game,
        players: game.players.filter((p) => p.id !== id),
        deck: [...game.deck, ...(leaver?.hand ?? [])],
        currentPlayerId:
          game.currentPlayerId === id ? next.id : game.currentPlayerId,
        drawnCardId: game.currentPlayerId === id ? null : game.drawnCardId,
        turn: game.turn + 1,
        lastAction: `${name} 已离开牌桌`,
      };
      if (room.players.length === 1)
        room.game = {
          ...room.game,
          status: "finished",
          winnerId: room.players[0]!.id,
          lastAction: `${name} 离开，${room.players[0]!.name} 获胜`,
        };
      scheduleTurn(room);
    }
    broadcast(room);
  }
  function makeRoom(users: User[], rules: Partial<Rules> = {}) {
    let code: string;
    do {
      code = Array.from(
        { length: 6 },
        () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
      ).join("");
    } while (rooms.has(code));
    const room: Room = {
      code,
      hostId: users[0]!.id,
      players: users,
      game: null,
      rules: normalizeRules(rules),
    };
    rooms.set(code, room);
    for (const user of users) membership.set(user.id, code);
    return room;
  }
  function startRoom(room: Room) {
    if (room.players.length < 2) throw new Error("至少需要两位玩家");
    room.game = createGame(
      room.players.map((p) => ({ ...p, bot: false })),
      undefined,
      room.rules,
    );
    broadcast(room);
    scheduleTurn(room);
  }
  io.on("connection", (socket) => {
    const user = socket.data.user as User;
    const previous = sockets.get(user.id);
    sockets.set(user.id, socket);
    if (previous && previous.id !== socket.id) {
      previous.emit("server_error", "账号已在其他窗口连接");
      previous.disconnect(true);
    }
    clearTimeout(disconnectTimers.get(user.id));
    disconnectTimers.delete(user.id);
    const room = rooms.get(membership.get(user.id) ?? "");
    if (room) broadcast(room);
    let messages = 0,
      windowStart = Date.now();
    function handle(event: string, handler: (payload: unknown) => void) {
      socket.on(
        event,
        (
          payload: unknown,
          ack?: (result: { ok: boolean; error?: string }) => void,
        ) => {
          if (Date.now() - windowStart > 10_000) {
            messages = 0;
            windowStart = Date.now();
          }
          try {
            if (++messages > 50) throw new Error("操作太快，请稍后再试");
            if (sockets.get(user.id)?.id !== socket.id)
              throw new Error("连接已被替换");
            handler(payload);
            if (typeof ack === "function") ack({ ok: true });
          } catch (error) {
            const message = error instanceof Error ? error.message : "操作失败";
            if (typeof ack === "function") ack({ ok: false, error: message });
            else socket.emit("server_error", message);
          }
        },
      );
    }
    function requireFree() {
      if (membership.has(user.id)) throw new Error("请先离开当前房间");
    }
    handle("queue:join", () => {
      requireFree();
      if (!queue.some((p) => p.id === user.id)) queue.push(user);
      socket.emit("queue", { queued: true });
      while (queue.length >= 2) {
        const players = queue.splice(0, 2);
        players.forEach((p) =>
          sockets.get(p.id)?.emit("queue", { queued: false }),
        );
        startRoom(makeRoom(players));
      }
    });
    handle("queue:cancel", () => removeQueue(user.id));
    handle("room:create", (payload) => {
      requireFree();
      const rules = validateRules(payload);
      removeQueue(user.id);
      broadcast(makeRoom([user], rules));
    });
    handle("room:join", (payload) => {
      requireFree();
      const code =
        typeof payload === "string" ? payload.trim().toUpperCase() : "";
      const room = rooms.get(code);
      if (!room) throw new Error("没有找到这个房间");
      if (room.game) throw new Error("这个房间已经开始游戏");
      if (room.players.length >= 4) throw new Error("房间已满");
      removeQueue(user.id);
      room.players.push(user);
      membership.set(user.id, code);
      broadcast(room);
    });
    handle("room:start", () => {
      const room = rooms.get(membership.get(user.id) ?? "");
      if (!room || room.hostId !== user.id)
        throw new Error("只有房主可以开始游戏");
      if (room.game?.status === "playing") throw new Error("游戏已经开始");
      startRoom(room);
    });
    handle("room:rules", (payload) => {
      const room = rooms.get(membership.get(user.id) ?? "");
      if (!room || room.hostId !== user.id)
        throw new Error("只有房主可以修改房规");
      if (room.game) throw new Error("对局开始后不能修改房规");
      room.rules = normalizeRules({ ...room.rules, ...validateRules(payload) });
      broadcast(room);
    });
    handle("room:leave", () => leaveRoom(user.id));
    handle("game:action", (payload) => {
      const room = rooms.get(membership.get(user.id) ?? "");
      if (!room?.game) throw new Error("对局尚未开始");
      if (!payload || typeof payload !== "object") throw new Error("无效操作");
      const action = payload as Record<string, unknown>;
      if (!["play", "draw", "pass", "uno"].includes(String(action.type)))
        throw new Error("无效操作");
      if (
        action.type === "play" &&
        (typeof action.cardId !== "string" ||
          action.cardId.length > 100 ||
          (action.color !== undefined &&
            !["red", "blue", "green", "yellow"].includes(
              String(action.color),
            )) ||
          (action.uno !== undefined && typeof action.uno !== "boolean") ||
          (action.targetPlayerId !== undefined &&
            (typeof action.targetPlayerId !== "string" ||
              action.targetPlayerId.length > 100)))
      )
        throw new Error("无效卡牌");
      const current = room.game.currentPlayerId,
        turn = room.game.turn;
      room.game = applyAction(room.game, user.id, action as Action);
      broadcast(room);
      // UNO declarations cannot extend a turn indefinitely.
      if (current !== room.game.currentPlayerId || turn !== room.game.turn)
        scheduleTurn(room);
    });
    socket.on("disconnect", () => {
      if (sockets.get(user.id)?.id !== socket.id) return;
      sockets.delete(user.id);
      removeQueue(user.id);
      if (closed) return;
      const room = rooms.get(membership.get(user.id) ?? "");
      if (!room) return;
      broadcast(room);
      const timer = setTimeout(() => {
        disconnectTimers.delete(user.id);
        if (!sockets.has(user.id)) leaveRoom(user.id);
      }, disconnectGraceMs);
      timer.unref();
      disconnectTimers.set(user.id, timer);
    });
  });
  return {
    httpServer,
    io,
    listen: (port = 10889, host = "0.0.0.0") =>
      new Promise<string>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          const address = httpServer.address();
          resolve(
            `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${typeof address === "object" && address ? address.port : port}`,
          );
        });
      }),
    close: async () => {
      closed = true;
      for (const room of rooms.values()) clearTimeout(room.turnTimer);
      for (const timer of disconnectTimers.values()) clearTimeout(timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      db.close();
    },
  };
}
