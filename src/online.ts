import { io } from "socket.io-client";
import type { Action, GameView, Rules } from "../shared/engine";

export type AuthUser = { id: string; name: string };
export type AuthResult = { token: string; user: AuthUser };
export type Lobby = {
  code: string;
  hostId: string;
  status: "waiting" | "playing" | "finished";
  rules: Rules;
  players: (AuthUser & { connected: boolean })[];
};
type Callbacks = {
  onState: (state: GameView) => void;
  onLobby: (lobby: Lobby | null) => void;
  onQueue: (state: { queued: boolean }) => void;
  onStatus: (status: "connecting" | "connected" | "disconnected") => void;
  onError: (error: string) => void;
};

export function normalizeServerUrl(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("请输入有效的服务器地址，例如 https://uno.example.com");
  if (
    typeof location !== "undefined" &&
    location.protocol === "https:" &&
    url.protocol !== "https:"
  )
    throw new Error("HTTPS 网页需要 HTTPS 联机服务");
  return url.origin;
}

export async function authRequest(
  url: string,
  mode: "login" | "register",
  username: string,
  password: string,
): Promise<AuthResult> {
  const response = await fetch(`${normalizeServerUrl(url)}/api/auth/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "登录失败");
  return data as AuthResult;
}

export function createOnlineClient(
  url: string,
  token: string,
  callbacks: Callbacks,
) {
  callbacks.onStatus("connecting");
  const socket = io(normalizeServerUrl(url), {
    auth: { token },
    timeout: 10_000,
    reconnectionAttempts: 8,
    transports: ["websocket", "polling"],
  });
  socket.on("connect", () => callbacks.onStatus("connected"));
  socket.on("disconnect", () => callbacks.onStatus("disconnected"));
  socket.on("connect_error", (error) => {
    callbacks.onStatus("disconnected");
    callbacks.onError(
      error.message === "websocket error"
        ? "无法连接联机服务，请检查地址与服务器来源配置"
        : error.message,
    );
  });
  socket.on("state", callbacks.onState);
  socket.on("lobby", callbacks.onLobby);
  socket.on("queue", callbacks.onQueue);
  socket.on("server_error", callbacks.onError);
  const send = (event: string, payload: unknown = null) =>
    new Promise<void>((resolve, reject) => {
      if (!socket.connected) {
        const error = new Error("尚未连接联机服务");
        callbacks.onError(error.message);
        reject(error);
        return;
      }
      socket
        .timeout(8_000)
        .emit(
          event,
          payload,
          (error: Error | null, result: { ok: boolean; error?: string }) => {
            if (error || !result?.ok) {
              const failure = new Error(
                error ? "网络超时，请重试" : result?.error || "操作失败",
              );
              callbacks.onError(failure.message);
              reject(failure);
            } else resolve();
          },
        );
    });
  return {
    queue: () => send("queue:join"),
    cancelQueue: () => send("queue:cancel"),
    createRoom: (rules?: Partial<Rules>) => send("room:create", rules ?? null),
    joinRoom: (code: string) => send("room:join", code),
    updateRules: (rules: Partial<Rules>) => send("room:rules", rules),
    startRoom: () => send("room:start"),
    leave: () => send("room:leave"),
    action: (action: Action) => send("game:action", action),
    disconnect: () => {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
export type OnlineClient = ReturnType<typeof createOnlineClient>;
