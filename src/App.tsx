import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crown,
  DoorOpen,
  Globe2,
  Home,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import {
  applyAction,
  canPlayCard,
  chooseBotAction,
  createGame,
  DEFAULT_RULES,
  getView,
  normalizeRules,
  RULE_PRESETS,
  type Action,
  type Card,
  type Color,
  type GameState,
  type GameView,
  type Rules,
} from "../shared/engine";
import TableScene from "./TableScene";
import { CardFace, PlayingCard, cardLabel, colorHex, colorName } from "./Card";
import type { OnlineClient } from "./online";
import {
  createProfile,
  deleteProfile,
  getActiveProfile,
  getStats,
  listMatches,
  listProfiles,
  logoutProfile,
  saveMatch,
  selectProfile,
  type LocalProfile,
} from "./storage";
import { sound } from "./sound";

type Modal = "menu" | "rules" | "settings" | "profile" | "win" | "about" | null;
type Difficulty = "easy" | "normal" | "hard";
const bots = [
  { id: "milo", name: "Milo", bot: true },
  { id: "luna", name: "Luna", bot: true },
  { id: "bean", name: "豆豆", bot: true },
];
const ruleLabels: Record<string, string> = {
  startingCards: "起始手牌",
  stacking: "罚牌叠加",
  drawMode: "摸牌方式",
  forcePlayDrawn: "摸到能出的牌必须出",
  sevenZero: "7 换手 · 0 轮转",
  jumpIn: "同牌抢出",
  strictWild4: "+4 严格限制",
  unoPenalty: "漏喊 UNO 罚牌",
  allowActionFinish: "功能牌可以收尾",
};
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage is optional. */
  }
}
function Avatar({
  name,
  index = 0,
  active = false,
  small = false,
}: {
  name: string;
  index?: number;
  active?: boolean;
  small?: boolean;
}) {
  const icons = ["✦", "🐻", "🐱", "🐸"];
  return (
    <span
      className={`avatar avatar-${index % 4} ${active ? "active" : ""} ${small ? "small" : ""}`}
      aria-label={name}
    >
      {icons[index % 4]}
      {active && <i />}
    </span>
  );
}
function ModalFrame({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const node = ref.current!;
    node.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const els = Array.from(
          node.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,a[href],[tabindex="0"]',
          ),
        );
        if (!els.length) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === els[0] || document.activeElement === node)
        ) {
          e.preventDefault();
          els.at(-1)!.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <button
          className="modal-close icon-btn"
          aria-label="关闭弹窗"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function RuleEditor({
  rules,
  onChange,
  disabled = false,
}: {
  rules: Rules;
  onChange: (r: Rules) => void;
  disabled?: boolean;
}) {
  const change = (key: keyof Rules, value: unknown) =>
    onChange(normalizeRules({ ...rules, [key]: value }));
  return (
    <div className="rule-editor">
      <div className="preset-row">
        {(["classic", "casual", "chaos"] as const).map((key, i) => (
          <button
            disabled={disabled}
            key={key}
            onClick={() => onChange({ ...RULE_PRESETS[key] })}
            className={
              JSON.stringify(rules) === JSON.stringify(RULE_PRESETS[key])
                ? "chosen"
                : ""
            }
          >
            {["经典规则", "休闲派对", "欢乐混战"][i]}
          </button>
        ))}
      </div>
      <p className="form-note">开局后锁定规则。好友房内所有玩家都可以查看。</p>
      <div className="rule-line">
        <div>
          <b>起始手牌</b>
          <small>每人发 3–15 张牌</small>
        </div>
        <div className="stepper">
          <button
            aria-label="减少起始手牌"
            disabled={disabled || rules.startingCards <= 3}
            onClick={() => change("startingCards", rules.startingCards - 1)}
          >
            <Minus size={14} />
          </button>
          <b>{rules.startingCards}</b>
          <button
            aria-label="增加起始手牌"
            disabled={disabled || rules.startingCards >= 15}
            onClick={() => change("startingCards", rules.startingCards + 1)}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="rule-line">
        <div>
          <b>罚牌叠加</b>
          <small>让下一位接住越来越多的快乐</small>
        </div>
        <select
          aria-label="罚牌叠加"
          disabled={disabled}
          value={rules.stacking}
          onChange={(e) => change("stacking", e.target.value)}
        >
          <option value="none">不叠加</option>
          <option value="same">同类叠加 +2 / +4</option>
          <option value="any">+2 和 +4 混叠</option>
        </select>
      </div>
      <div className="rule-line">
        <div>
          <b>摸牌方式</b>
          <small>轮到你时没有合适的牌</small>
        </div>
        <select
          aria-label="摸牌方式"
          disabled={disabled}
          value={rules.drawMode}
          onChange={(e) => change("drawMode", e.target.value)}
        >
          <option value="one">只摸一张</option>
          <option value="until-playable">摸到能出为止</option>
        </select>
      </div>
      <div className="rule-line">
        <div>
          <b>漏喊 UNO 罚牌</b>
          <small>出到剩一张前，先按 UNO</small>
        </div>
        <select
          aria-label="漏喊 UNO 罚牌"
          disabled={disabled}
          value={rules.unoPenalty}
          onChange={(e) => change("unoPenalty", Number(e.target.value))}
        >
          <option value="0">不处罚</option>
          <option value="2">罚摸 2 张</option>
          <option value="4">罚摸 4 张</option>
        </select>
      </div>
      {(
        [
          { key: "forcePlayDrawn", hint: "摸到可出的牌后，不能跳过" },
          { key: "sevenZero", hint: "出 7 与指定玩家换手；出 0 全员轮换" },
          { key: "jumpIn", hint: "任何时候都能抢出颜色、点数完全相同的牌" },
          { key: "strictWild4", hint: "手里有当前颜色时，不能出 +4" },
          { key: "allowActionFinish", hint: "关闭后，最后一张必须是数字牌" },
        ] as const
      ).map(({ key, hint }) => (
        <div className="rule-line" key={key}>
          <div>
            <b>{ruleLabels[key]}</b>
            <small>{hint}</small>
          </div>
          <button
            role="switch"
            aria-checked={rules[key]}
            aria-label={ruleLabels[key]}
            disabled={disabled}
            className={`toggle ${rules[key] ? "on" : ""}`}
            onClick={() => change(key, !rules[key])}
          >
            <span />
          </button>
        </div>
      ))}
    </div>
  );
}
function Flight({
  card,
  rect,
  target,
  onDone,
  reduced,
}: {
  card: Card;
  rect: DOMRect;
  target: DOMRect;
  onDone: () => void;
  reduced: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const a = ref.current?.animate(
      [
        { transform: "translate(0,0) rotate(-12deg) scale(1)", opacity: 1 },
        {
          transform: `translate(${(target.x - rect.x) * 0.5}px,${target.y - rect.y - 80}px) rotate(35deg) scale(1.2)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(${target.x - rect.x}px,${target.y - rect.y}px) rotate(7deg) scale(${target.width / rect.width})`,
          opacity: 1,
        },
      ],
      {
        duration: reduced ? 1 : 620,
        easing: "cubic-bezier(.25,.6,.3,1)",
        fill: "forwards",
      },
    );
    if (a) a.onfinish = onDone;
    else onDone();
    return () => a?.cancel();
  }, []);
  return (
    <div
      className="flying-card"
      ref={ref}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <CardFace card={card} />
    </div>
  );
}
export default function App() {
  const [rules, setRules] = useState<Rules>(() =>
    normalizeRules(read("uno-rules", DEFAULT_RULES)),
  );
  const [local, setLocal] = useState<GameState>(() =>
    createGame([{ id: "you", name: "你" }, ...bots], Math.random, rules),
  );
  const [mode, setMode] = useState<"ai" | "online">("ai");
  const [remote, setRemote] = useState<GameView | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [wild, setWild] = useState<Card | null>(null);
  const [swap, setSwap] = useState<Card | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>(() =>
    read("uno-difficulty", "normal"),
  );
  const [audio, setAudio] = useState(() => read("uno-audio", true));
  const [reduced, setReduced] = useState(() =>
    read("uno-motion", matchMedia("(prefers-reduced-motion: reduce)").matches),
  );
  const [impact, setImpact] = useState<{
    id: number;
    label: string;
    color: string;
  } | null>(null);
  const [toast, setToast] = useState("");
  const [confetti, setConfetti] = useState(false);
  const [flights, setFlights] = useState<
    { id: number; card: Card; rect: DOMRect; target: DOMRect }[]
  >([]);
  const [auth, setAuth] = useState<{ user: LocalProfile } | null>(() => {
    const user = getActiveProfile();
    return user ? { user } : null;
  });
  const [profiles, setProfiles] = useState(listProfiles);
  const [history, setHistory] = useState(() =>
    listMatches(getActiveProfile()?.id),
  );
  const [profileError, setProfileError] = useState("");
  const [stats, setStats] = useState(() =>
    getActiveProfile()
      ? getStats(getActiveProfile()!.id)
      : read("uno-stats", { games: 0, wins: 0 }),
  );
  const gameId = useRef(
    `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [sort, setSort] = useState(false);
  const client = useRef<OnlineClient | null>(null);
  const discard = useRef<HTMLDivElement>(null);
  const lastTop = useRef("");
  const previousActor = useRef("you");
  const ownFlight = useRef("");
  const lastWinner = useRef("");
  const self = mode === "online" && auth ? auth.user.id : "you";
  const view = mode === "online" && remote ? remote : getView(local, "you");
  const myTurn = view.currentPlayerId === self && view.status === "playing";
  const current = view.players.find((p) => p.id === view.currentPlayerId);
  const me = view.players.find((p) => p.id === self);
  const opponents = view.players.filter((p) => p.id !== self);
  const playable = (card: Card) =>
    view.status === "playing" &&
    (myTurn || view.rules.jumpIn) &&
    canPlayCard(card, view, myTurn) &&
    (myTurn ||
      (card.color !== "wild" &&
        card.color === view.topCard.color &&
        card.value === view.topCard.value));
  const hand = sort
    ? [...view.hand].sort(
        (a, b) =>
          a.color.localeCompare(b.color) || a.value.localeCompare(b.value),
      )
    : view.hand;
  const notify = (text: string) => setToast(text);
  const invoke = (p: Promise<void> | undefined) => {
    void p?.catch(() => {});
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    save("uno-rules", rules);
  }, [rules]);
  useEffect(() => {
    save("uno-audio", audio);
    save("uno-motion", reduced);
    save("uno-difficulty", difficulty);
  }, [audio, reduced, difficulty]);
  useEffect(() => {
    if (
      mode !== "ai" ||
      local.status !== "playing" ||
      local.currentPlayerId === "you" ||
      modal ||
      wild ||
      swap
    )
      return;
    const t = setTimeout(
      () => {
        try {
          setLocal(
            applyAction(
              local,
              local.currentPlayerId,
              chooseBotAction(local, local.currentPlayerId, difficulty),
            ),
          );
        } catch (e) {
          notify((e as Error).message);
        }
      },
      reduced ? 500 : 1200 + Math.random() * 500,
    );
    return () => clearTimeout(t);
  }, [mode, local, modal, wild, swap, difficulty, reduced]);
  useEffect(() => {
    setSelected(null);
    if (lastTop.current && lastTop.current !== view.topCard.id) {
      sound("card", audio);
      setImpact({
        id: Date.now(),
        label:
          (
            {
              reverse: "REVERSE",
              skip: "SKIP",
              draw2: "+2",
              wild: "WILD",
              wild4: "+4",
            } as Record<string, string>
          )[view.topCard.value] ?? "",
        color: colorHex[view.activeColor],
      });
      const el = document.querySelector(
        `[data-player="${previousActor.current}"]`,
      );
      if (ownFlight.current !== view.topCard.id && discard.current && el) {
        const rect = el.getBoundingClientRect(),
          target = discard.current.getBoundingClientRect();
        setFlights((f) => [
          ...f,
          {
            id: Date.now() + Math.random(),
            card: view.topCard,
            rect: new DOMRect(rect.x + rect.width / 2, rect.y, 65, 95),
            target,
          },
        ]);
      }
    }
    lastTop.current = view.topCard.id;
  }, [view.topCard.id]);
  useEffect(() => {
    previousActor.current = view.currentPlayerId;
  }, [view.currentPlayerId]);
  useEffect(() => {
    if (view.status !== "finished") return;
    const key = `${mode}-${view.winnerId}-${view.turn}`;
    if (lastWinner.current === key) return;
    lastWinner.current = key;
    setModal("win");
    if (view.winnerId === self) {
      sound("win", audio);
      setConfetti(true);
      setTimeout(() => setConfetti(false), 4500);
    }
    if (mode === "ai") {
      if (auth) {
        try {
          saveMatch({
            id: gameId.current,
            profileId: auth.user.id,
            mode: "ai",
            won: view.winnerId === self,
            winnerName:
              view.winnerId === self
                ? auth.user.name
                : (view.players.find((p) => p.id === view.winnerId)?.name ??
                  "对手"),
            finishedAt: Date.now(),
            turns: view.turn,
            rules: view.rules,
            players: view.players.map((p) => ({
              name: p.id === self ? auth.user.name : p.name,
              cardCount: p.cardCount,
            })),
          });
          setStats(getStats(auth.user.id));
          setHistory(listMatches(auth.user.id));
        } catch (e) {
          notify((e as Error).message);
        }
      } else {
        setStats((s) => {
          const next = {
            games: s.games + 1,
            wins: s.wins + (view.winnerId === self ? 1 : 0),
          };
          save("uno-stats", next);
          return next;
        });
      }
    }
  }, [view.status, view.winnerId]);
  function action(a: Action) {
    if (mode === "online") {
      invoke(client.current?.action(a));
      return;
    }
    try {
      setLocal(applyAction(local, "you", a));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function play(
    card: Card,
    extra: { color?: Color; targetPlayerId?: string } = {},
  ) {
    if (!playable(card))
      return notify("这张牌暂时不能出，试试相同颜色、点数或万能牌。");
    if (card.color === "wild" && !extra.color) {
      setWild(card);
      return;
    }
    if (
      view.rules.sevenZero &&
      card.value === "7" &&
      !extra.targetPlayerId &&
      view.players.length > 2 &&
      view.hand.length > 1
    ) {
      setSwap(card);
      return;
    }
    const source = document.querySelector(`[data-card-id="${card.id}"]`);
    if (source && discard.current) {
      ownFlight.current = card.id;
      setFlights((f) => [
        ...f,
        {
          id: Date.now() + Math.random(),
          card,
          rect: source.getBoundingClientRect(),
          target: discard.current!.getBoundingClientRect(),
        },
      ]);
    }
    setSelected(null);
    setWild(null);
    setSwap(null);
    action({ type: "play", cardId: card.id, ...extra });
    if (navigator.vibrate) navigator.vibrate(22);
  }
  function newGame() {
    gameId.current = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    lastWinner.current = "";
    lastTop.current = "";
    ownFlight.current = "";
    setImpact(null);
    if (mode === "online") invoke(client.current?.leave());
    setMode("ai");
    setRemote(null);
    setLocal(
      createGame([{ id: "you", name: "你" }, ...bots], Math.random, rules),
    );
    setSelected(null);
    setModal(null);
    sound("draw", audio);
  }
  function draw() {
    if (!myTurn) return;
    action({ type: "draw" });
    sound("draw", audio);
  }
  function uno() {
    action({ type: "uno" });
    setImpact({ id: Date.now(), label: "UNO!", color: "#f1c46f" });
    sound("uno", audio);
    notify("UNO! 就差最后一张！");
  }
  function refreshProfile(user: LocalProfile | null) {
    setAuth(user ? { user } : null);
    setProfiles(listProfiles());
    setHistory(listMatches(user?.id));
    setStats(
      user ? getStats(user.id) : read("uno-stats", { games: 0, wins: 0 }),
    );
    setProfileError("");
  }
  function createLocalPlayer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const user = createProfile(
        String(new FormData(e.currentTarget).get("nickname") ?? ""),
      );
      refreshProfile(user);
      e.currentTarget.reset();
      newGame();
      setModal("profile");
      notify(`欢迎入座，${user.name}！`);
    } catch (e) {
      setProfileError((e as Error).message);
    }
  }
  function chooseProfile(id: string) {
    try {
      refreshProfile(selectProfile(id));
      newGame();
      setModal("profile");
    } catch (e) {
      setProfileError((e as Error).message);
    }
  }
  function removeProfile(id: string) {
    try {
      const wasActive = auth?.user.id === id;
      deleteProfile(id);
      refreshProfile(getActiveProfile());
      if (wasActive) {
        newGame();
        setModal("profile");
      }
    } catch (e) {
      setProfileError((e as Error).message);
    }
  }
  function leaveRoom() {
    setRemote(null);
    setMode("ai");
  }
  function logout() {
    logoutProfile();
    refreshProfile(null);
    newGame();
    setModal("profile");
  }
  const activeRules = view.rules;
  const selectedCard = hand.find((c) => c.id === selected);
  return (
    <main className={`game-app ${reduced ? "reduce-motion" : ""}`}>
      <div
        className="game-stage"
        style={
          { "--active-color": colorHex[view.activeColor] } as CSSProperties
        }
        aria-label="UNO 牌桌"
      >
        <TableScene activeColor={view.activeColor} reducedMotion={reduced} />
        <div className="game-watermark" aria-hidden="true">
          UNO<span>SOCIAL CLUB</span>
        </div>
        <div
          className={`direction-ring ${view.direction === -1 ? "reversed" : ""}`}
          aria-label={view.direction === 1 ? "顺时针出牌" : "逆时针出牌"}
        >
          <span>↻</span>
          <span>↻</span>
        </div>
        {opponents.map((p, i) => (
          <div
            key={p.id}
            data-player={p.id}
            className={`game-opponent ${["seat-left", "seat-top", "seat-right"][i]} ${p.id === view.currentPlayerId ? "is-turn" : ""}`}
          >
            <div className="seat-identity">
              <Avatar
                name={p.name}
                index={i + 1}
                active={p.id === view.currentPlayerId}
              />
              <div>
                <b>
                  {p.name}
                  <span>AI</span>
                </b>
                <small>
                  {p.uno
                    ? "UNO!"
                    : p.id === view.currentPlayerId
                      ? "正在思考…"
                      : `${p.cardCount} 张手牌`}
                </small>
              </div>
              <span className="seat-count">{p.cardCount}</span>
            </div>
            <div className="seat-cards">
              {Array.from({ length: Math.min(p.cardCount, 9) }, (_, j) => (
                <div
                  key={j}
                  style={
                    {
                      "--back-i": j,
                      "--back-count": Math.min(p.cardCount, 9),
                    } as CSSProperties
                  }
                >
                  <CardFace back />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="game-piles">
          <div className="pile-group">
            <button
              className={`draw-pile ${!myTurn || view.drawnCardId ? "unavailable" : ""}`}
              aria-label="从牌堆摸牌"
              disabled={!myTurn || !!view.drawnCardId}
              onClick={draw}
            >
              <i />
              <i />
              <CardFace back />
              <span className="draw-plus">
                <Plus size={25} />
              </span>
            </button>
            <span className="pile-caption">
              牌堆 <b>{view.deckCount}</b>
            </span>
          </div>
          <div className="pile-group">
            <div
              className={`discard-pile ${view.pendingDraw ? "penalty" : ""}`}
              ref={discard}
            >
              <div className="old-discard">
                <CardFace card={{ ...view.topCard, id: "ghost" }} />
              </div>
              <div key={view.topCard.id} className="top-discard">
                <CardFace card={view.topCard} />
              </div>
              {view.pendingDraw > 0 && (
                <span className="pending-draw">+{view.pendingDraw}</span>
              )}
            </div>
            <span className="pile-caption">
              <i style={{ background: colorHex[view.activeColor] }} />
              {colorName[view.activeColor]}
            </span>
          </div>
        </div>
        <div
          className={`game-turn-status ${myTurn ? "your-turn" : ""}`}
          aria-live="polite"
        >
          <div>
            <span className="status-dot" />
            {view.status === "finished"
              ? "本局结束"
              : myTurn
                ? view.pendingDraw
                  ? `接招！罚摸 ${view.pendingDraw} 张`
                  : "轮到你了"
                : `${current?.name} 的回合`}
          </div>
          <small>{view.lastAction}</small>
        </div>
        {impact && (
          <div
            key={impact.id}
            className="card-impact"
            style={{ "--burst-color": impact.color } as CSSProperties}
            aria-hidden="true"
          >
            <i />
            <i />
            {Array.from({ length: 18 }, (_, i) => (
              <span
                key={i}
                style={
                  {
                    "--ray": `${i * 20}deg`,
                    "--travel": `${65 + (i % 4) * 14}px`,
                  } as CSSProperties
                }
              />
            ))}
            {impact.label && <b>{impact.label}</b>}
          </div>
        )}
      </div>
      <div className="game-hud">
        <div className="hud-brand">
          UNO<span>3D</span>
        </div>
        <button
          className="hud-mode"
          onClick={() => setModal("rules")}
          aria-label="查看本局规则"
        >
          <span className="status-dot" />
          人机 · {{ easy: "休闲", normal: "标准", hard: "高手" }[difficulty]}
          <i />
          {JSON.stringify(activeRules) === JSON.stringify(DEFAULT_RULES)
            ? "经典规则"
            : "自定义村规"}
        </button>
        <div className="hud-actions">
          <button
            className="icon-btn"
            aria-label={audio ? "关闭音效" : "开启音效"}
            onClick={() => setAudio(!audio)}
          >
            {audio ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button
            className="icon-btn menu-trigger"
            aria-label="打开菜单"
            onClick={() => setModal("menu")}
          >
            <Menu size={22} />
            <span>菜单</span>
          </button>
        </div>
      </div>
      <section className="game-hand" aria-label="你的手牌">
        <div className="game-hand-inner">
          <div className="hand-hud">
            <div className="you-profile">
              <Avatar name={auth?.user.name ?? "你"} active={myTurn} small />
              <b>
                {auth?.user.name ?? "你"}
                <span>YOU</span>
              </b>
              <span className="hand-count">{view.hand.length} 张牌</span>
            </div>
            <div className="hand-actions">
              <button
                className={`sort-btn ${sort ? "on" : ""}`}
                aria-label="整理手牌"
                onClick={() => setSort(!sort)}
              >
                <Shuffle size={15} />
                <span>整理</span>
              </button>
              <button
                className={`uno-button ${me?.uno ? "declared" : ""}`}
                disabled={
                  view.hand.length !== 2 ||
                  !(myTurn || (view.rules.jumpIn && hand.some(playable))) ||
                  me?.uno
                }
                onClick={uno}
              >
                UNO!<span>剩 2 张时宣告</span>
              </button>
            </div>
          </div>
          <div
            className={`hand-scroll ${hand.length > 10 ? "many-cards" : ""}`}
          >
            <div
              className="hand-fan"
              style={{ "--card-count": hand.length } as CSSProperties}
            >
              {hand.map((card, i) => (
                <PlayingCard
                  key={card.id}
                  card={card}
                  playable={playable(card)}
                  selected={selected === card.id}
                  index={i}
                  count={hand.length}
                  onClick={() => {
                    sound("click", audio);
                    if (selected === card.id) play(card);
                    else setSelected(card.id);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="hand-bottom">
            <p>
              <span className="glow-dot" />
              {selectedCard
                ? cardLabel(selectedCard)
                : myTurn
                  ? "选一张好牌"
                  : "等待下一手"}
              <small>
                {selectedCard ? "再次点击或按出牌" : "点击选牌 · 再次点击出牌"}
              </small>
            </p>
            <div className="play-actions">
              {view.drawnCardId && myTurn ? (
                <button
                  className="pass-btn"
                  disabled={view.rules.forcePlayDrawn && hand.some(playable)}
                  onClick={() => action({ type: "pass" })}
                >
                  跳过
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button className="pass-btn" disabled={!myTurn} onClick={draw}>
                  摸牌
                  <Plus size={16} />
                </button>
              )}
              <button
                className="play-btn"
                disabled={!selectedCard || !playable(selectedCard)}
                onClick={() => selectedCard && play(selectedCard)}
              >
                出牌
                <ArrowUpRightIcon />
              </button>
            </div>
          </div>
        </div>
      </section>
      {modal === "menu" && (
        <ModalFrame
          title="休息一下，再战一局。"
          eyebrow="GAME MENU"
          onClose={() => setModal(null)}
        >
          <div className="game-menu-grid">
            <button className="menu-tile" onClick={newGame}>
              <RotateCcw size={22} />
              <b>开始新一局</b>
              <small>重新发牌，快乐继续</small>
            </button>
            <button className="menu-tile" onClick={() => setModal("rules")}>
              <SlidersHorizontal size={22} />
              <b>自定义村规</b>
              <small>你的牌桌，你的规矩</small>
            </button>
            <button className="menu-tile" onClick={() => setModal("profile")}>
              <Users size={22} />
              <b>玩家与战绩</b>
              <small>{auth?.user.name ?? "访客玩家"} · 本地保存</small>
            </button>
            <button className="menu-tile" onClick={() => setModal("about")}>
              <CircleHelp size={22} />
              <b>玩法指南</b>
              <small>颜色、点数，还有 UNO!</small>
            </button>
          </div>
          <div className="menu-section">
            <div className="section-label">
              AI 难度<span>立即生效</span>
            </div>
            <div className="menu-difficulty">
              {(["easy", "normal", "hard"] as const).map((d, i) => (
                <button
                  key={d}
                  className={difficulty === d ? "chosen" : ""}
                  onClick={() => setDifficulty(d)}
                >
                  {["休闲", "标准", "高手"][i]}
                  {difficulty === d && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
          <div className="menu-footer-prefs">
            <button onClick={() => setModal("settings")}>
              <Settings2 size={17} />
              音效与画面
            </button>
            <button
              onClick={() => {
                if (!document.fullscreenElement)
                  void document.documentElement
                    .requestFullscreen?.()
                    .catch(() => notify("当前浏览器不支持全屏"));
                else void document.exitFullscreen?.();
              }}
            >
              <Maximize2 size={17} />
              切换全屏
            </button>
          </div>
          <p className="game-menu-description">
            {stats.games} 局 · {stats.wins} 胜。实时联机暂未开放，先与三位 AI
            牌友过过招。
          </p>
          <button
            className="primary-btn menu-resume"
            onClick={() => setModal(null)}
          >
            继续游戏
            <ArrowRight size={17} />
          </button>
        </ModalFrame>
      )}
      {toast && (
        <div className="toast" role="status">
          <Sparkles size={17} />
          {toast}
        </div>
      )}
      {flights.map((f) => (
        <Flight
          key={f.id}
          {...f}
          reduced={reduced}
          onDone={() => setFlights((fs) => fs.filter((v) => v.id !== f.id))}
        />
      ))}
      {confetti && !reduced && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 55 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  left: `${(i * 31) % 100}%`,
                  background: Object.values(colorHex)[i % 5],
                  animationDelay: `${(i % 12) * 0.09}s`,
                  "--drift": `${((i % 7) - 3) * 60}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      {wild && (
        <ModalFrame
          title="接下来，什么颜色？"
          eyebrow="WILD CARD"
          onClose={() => setWild(null)}
        >
          <p>挑一个颜色，把节奏握在手里。</p>
          <div className="color-picker">
            {(["red", "yellow", "green", "blue"] as Color[]).map((c) => (
              <button
                key={c}
                style={{ background: colorHex[c] }}
                onClick={() => play(wild, { color: c })}
              >
                <span /> {colorName[c]}
              </button>
            ))}
          </div>
        </ModalFrame>
      )}
      {swap && (
        <ModalFrame
          title="和谁交换手牌？"
          eyebrow="SEVEN · HAND SWAP"
          onClose={() => setSwap(null)}
        >
          <p>打出 7，选择一位玩家交换全部手牌。</p>
          <div className="swap-players">
            {opponents.map((p, i) => (
              <button
                key={p.id}
                onClick={() => play(swap, { targetPlayerId: p.id })}
              >
                <Avatar name={p.name} index={i + 1} />
                <b>{p.name}</b>
                <span>{p.cardCount} 张牌</span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        </ModalFrame>
      )}
      {modal === "rules" && (
        <ModalFrame
          title="你的牌桌，你的规矩。"
          eyebrow="HOUSE RULES"
          wide
          onClose={() => setModal(null)}
        >
          <p>每个村都有自己的 UNO。在这里，都能玩。</p>
          <RuleEditor
            rules={mode === "online" ? view.rules : rules}
            disabled={mode === "online"}
            onChange={setRules}
          />
          <div className="modal-action">
            <span>
              {mode === "online"
                ? "本局规则已锁定；好友房可在开局前设置。"
                : "设置将在新一局人机对战中生效。"}
            </span>
            <button
              className="primary-btn"
              onClick={() => (mode === "online" ? setModal(null) : newGame())}
            >
              {mode === "online" ? "知道了" : "按这个规则开一局"}
              <ArrowRight size={16} />
            </button>
          </div>
        </ModalFrame>
      )}
      {modal === "settings" && (
        <ModalFrame
          title="让快乐，刚刚好。"
          eyebrow="PREFERENCES"
          onClose={() => setModal(null)}
        >
          <div className="rule-line">
            <div>
              <b>游戏音效</b>
              <small>轻巧的电子音与胜利旋律</small>
            </div>
            <button
              className={`toggle ${audio ? "on" : ""}`}
              role="switch"
              aria-checked={audio}
              onClick={() => setAudio(!audio)}
              aria-label="游戏音效"
            >
              <span />
            </button>
          </div>
          <div className="rule-line">
            <div>
              <b>减少动态效果</b>
              <small>保留牌桌细节，减少飞牌和粒子</small>
            </div>
            <button
              className={`toggle ${reduced ? "on" : ""}`}
              role="switch"
              aria-checked={reduced}
              onClick={() => setReduced(!reduced)}
              aria-label="减少动态效果"
            >
              <span />
            </button>
          </div>
          <p className="form-note">
            偏好保存在当前浏览器。手机支持触摸选牌和轻触反馈。
          </p>
        </ModalFrame>
      )}
      {modal === "about" && (
        <ModalFrame
          title="一张牌，就能加入。"
          eyebrow="WELCOME TO THE CLUB"
          wide
          onClose={() => setModal(null)}
        >
          <div className="guide-grid">
            <div>
              <span>01</span>
              <h3>跟上颜色或点数</h3>
              <p>
                打出与桌面同色、同点数或同功能的牌。万能牌可以选择下一种颜色。
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>只差一张？UNO!</h3>
              <p>还剩两张时，先按 UNO 再出牌。漏喊会按本桌村规立即罚摸。</p>
            </div>
            <div>
              <span>03</span>
              <h3>功能牌，扭转局面</h3>
              <p>跳过、反转、+2 和 +4 改变局势。先出完手牌的人获胜。</p>
            </div>
            <div>
              <span>04</span>
              <h3>先说好，怎么玩</h3>
              <p>
                在菜单里选择「自定义村规」，开局前说好玩法。默认不叠罚牌，不抢出，无
                +4 质疑流程。实时联机暂未开放。
              </p>
            </div>
          </div>
          <p className="guide-note">
            点击卡牌选中，再点一次或按「出牌」。摸一张后可出该牌或跳过；「摸后必出」开启时不能跳过可出的牌。最后一张为
            7/0 时先判胜，不再交换；交换得到单张牌会自动宣告 UNO。AI
            练习无需登录；玩家档案与最近对局保存在当前浏览器。实时联机暂未开放。
          </p>
          <div className="about-legal">
            Uno Social Club · 非官方爱好者项目，与 Mattel 无关联。UNO
            为其权利人的商标。
          </div>
        </ModalFrame>
      )}
      {modal === "win" && (
        <ModalFrame
          title={
            view.winnerId === self
              ? "好牌！这一局是你的。"
              : `${view.players.find((p) => p.id === view.winnerId)?.name} 赢下了这局。`
          }
          eyebrow="THAT WAS A GOOD GAME"
          onClose={() => setModal(null)}
        >
          <div className="winner-cup">
            <Trophy size={70} />
            <span>✦</span>
          </div>
          <p className="win-description">
            {view.winnerId === self
              ? "漂亮的判断，加上一点点好运。"
              : "每一局，都是下一张好牌的开始。"}
          </p>
          <div className="results-list">
            {[...view.players]
              .sort((a, b) => a.cardCount - b.cardCount)
              .map((p, i) => (
                <div key={p.id}>
                  <span>{i + 1}</span>
                  <b>{p.id === self ? (auth?.user.name ?? "你") : p.name}</b>
                  <small>{p.cardCount} 张剩余</small>
                  {p.id === view.winnerId && <Crown size={17} />}
                </div>
              ))}
          </div>
          <button
            className="primary-btn"
            onClick={() =>
              mode === "online" ? (leaveRoom(), setModal("profile")) : newGame()
            }
          >
            {mode === "online" ? "返回联机大厅" : "再来一局"}
            <ArrowRight size={18} />
          </button>
        </ModalFrame>
      )}
      {modal === "profile" && (
        <ModalFrame
          title="坐下来，打个招呼。"
          eyebrow="YOUR LOCAL CLUB"
          wide
          onClose={() => setModal(null)}
        >
          <p>创建本地玩家，保存你的村规战绩。无需密码，打开即玩。</p>
          {auth && (
            <div className="online-identity">
              <Avatar name={auth.user.name} />
              <div>
                <b>{auth.user.name}</b>
                <span>
                  当前本地玩家 · {stats.wins} 胜 / {stats.games} 局
                </span>
              </div>
              <button className="text-btn" onClick={logout}>
                切换为访客
              </button>
            </div>
          )}
          <form
            onSubmit={createLocalPlayer}
            className="auth-form local-profile-form"
          >
            <label>
              玩家昵称
              <input
                name="nickname"
                autoComplete="nickname"
                placeholder="今天，谁来打这手好牌？"
                minLength={2}
                maxLength={24}
                required
              />
            </label>
            <button className="primary-btn">
              <Plus size={17} />
              创建本地玩家
            </button>
          </form>
          {profileError && (
            <p className="inline-error" role="alert">
              {profileError}
            </p>
          )}
          {profiles.length > 0 && (
            <div className="saved-profiles">
              <div className="section-label">
                本机玩家 <span>{profiles.length} / 8</span>
              </div>
              {profiles.map((p, i) => (
                <div
                  key={p.id}
                  className={auth?.user.id === p.id ? "current-profile" : ""}
                >
                  <button onClick={() => chooseProfile(p.id)}>
                    <Avatar name={p.name} index={i} small />
                    <b>{p.name}</b>
                    <span>
                      {auth?.user.id === p.id ? "正在使用" : "选择入座"}
                    </span>
                    {auth?.user.id === p.id && <Check size={16} />}
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`删除玩家 ${p.name}`}
                    onClick={() => removeProfile(p.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="form-note">
            档案仅保存在此浏览器，换设备不会同步。最多 8
            位玩家；新增超限时会淘汰最久未使用的非当前档案。清除浏览器数据会删除存档。
          </p>
          <div className="coming-soon">
            <Globe2 size={27} />
            <div>
              <b>线上相聚，稍后开启。</b>
              <p>
                实时匹配与好友房暂未开放。现在先和三位 AI
                牌友过过招，九项村规照样随你定。
              </p>
            </div>
            <span>COMING SOON</span>
          </div>
          {auth && (
            <div className="recent-history">
              <div className="section-label">
                最近对局 <span>最多 50 局 · 30 天</span>
              </div>
              {history.length ? (
                history.slice(0, 10).map((m) => (
                  <div key={m.id}>
                    <span className={`history-result ${m.won ? "won" : ""}`}>
                      {m.won ? "获胜" : "惜败"}
                    </span>
                    <div>
                      <b>{m.won ? "漂亮的一局" : `${m.winnerName} 获胜`}</b>
                      <span>
                        {new Date(m.finishedAt).toLocaleDateString("zh-CN")} ·{" "}
                        {m.turns} 回合
                      </span>
                    </div>
                    <span>
                      {JSON.stringify(m.rules) === JSON.stringify(DEFAULT_RULES)
                        ? "经典玩法"
                        : "村规对局"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="history-empty">
                  你的下一局，就从这里开始。打完后自动记录。
                </p>
              )}
            </div>
          )}
        </ModalFrame>
      )}
    </main>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 18 18 6M6 6h12v12" />
    </svg>
  );
}
