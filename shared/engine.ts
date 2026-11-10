/** Shared authoritative UNO rules. No network, UI or timer dependencies. */
export const COLORS = ["red", "yellow", "green", "blue"] as const;
export type Color = (typeof COLORS)[number];
export interface Card {
  id: string;
  color: Color | "wild";
  value: string;
}
export interface Player {
  id: string;
  name: string;
  bot: boolean;
  hand: Card[];
  uno: boolean;
}
export interface Rules {
  startingCards: number;
  stacking: "none" | "same" | "any";
  drawMode: "one" | "until-playable";
  forcePlayDrawn: boolean;
  sevenZero: boolean;
  jumpIn: boolean;
  strictWild4: boolean;
  unoPenalty: 0 | 2 | 4;
  allowActionFinish: boolean;
}
export const DEFAULT_RULES: Rules = Object.freeze({
  startingCards: 7,
  stacking: "none",
  drawMode: "one",
  forcePlayDrawn: false,
  sevenZero: false,
  jumpIn: false,
  strictWild4: true,
  unoPenalty: 2,
  allowActionFinish: true,
});
/** Validated complete rules. Invalid types/enums fall back to classic settings. */
export function normalizeRules(input?: Partial<Rules> | null): Rules {
  const raw =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const bool = (key: keyof Rules): boolean =>
    typeof raw[key] === "boolean"
      ? (raw[key] as boolean)
      : (DEFAULT_RULES[key] as boolean);
  return {
    startingCards:
      typeof raw.startingCards === "number" &&
      Number.isFinite(raw.startingCards)
        ? Math.max(3, Math.min(15, Math.floor(raw.startingCards)))
        : DEFAULT_RULES.startingCards,
    stacking: ["none", "same", "any"].includes(raw.stacking ?? "")
      ? raw.stacking!
      : DEFAULT_RULES.stacking,
    drawMode: ["one", "until-playable"].includes(raw.drawMode ?? "")
      ? raw.drawMode!
      : DEFAULT_RULES.drawMode,
    forcePlayDrawn: bool("forcePlayDrawn"),
    sevenZero: bool("sevenZero"),
    jumpIn: bool("jumpIn"),
    strictWild4: bool("strictWild4"),
    unoPenalty: [0, 2, 4].includes(raw.unoPenalty as number)
      ? raw.unoPenalty!
      : DEFAULT_RULES.unoPenalty,
    allowActionFinish: bool("allowActionFinish"),
  };
}
export const RULE_PRESETS: Record<"classic" | "casual" | "chaos", Rules> = {
  classic: { ...DEFAULT_RULES },
  casual: {
    ...DEFAULT_RULES,
    stacking: "same",
    strictWild4: false,
    unoPenalty: 0,
  },
  chaos: {
    ...DEFAULT_RULES,
    stacking: "any",
    drawMode: "until-playable",
    forcePlayDrawn: true,
    sevenZero: true,
    jumpIn: true,
    strictWild4: false,
    unoPenalty: 4,
  },
};
export interface GameState {
  players: Player[];
  currentPlayerId: string;
  direction: 1 | -1;
  activeColor: Color;
  deck: Card[];
  discard: Card[];
  status: "playing" | "finished";
  winnerId: string | null;
  turn: number;
  drawnCardId: string | null;
  lastAction: string;
  rules: Rules;
  pendingDraw: number;
  pendingDrawValue: "draw2" | "wild4" | null;
}
export interface GameView {
  players: {
    id: string;
    name: string;
    bot: boolean;
    cardCount: number;
    uno: boolean;
  }[];
  hand: Card[];
  currentPlayerId: string;
  direction: 1 | -1;
  activeColor: Color;
  topCard: Card;
  deckCount: number;
  status: "playing" | "finished";
  winnerId: string | null;
  turn: number;
  drawnCardId: string | null;
  lastAction: string;
  rules: Rules;
  pendingDraw: number;
  pendingDrawValue: "draw2" | "wild4" | null;
}
export type Action =
  | {
      type: "play";
      cardId: string;
      color?: Color;
      uno?: boolean;
      targetPlayerId?: string;
    }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "uno" };

export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const color of COLORS) {
    cards.push({ id: `${color}-0`, color, value: "0" });
    for (const value of [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "skip",
      "reverse",
      "draw2",
    ]) {
      for (let n = 0; n < 2; n++)
        cards.push({ id: `${color}-${value}-${n}`, color, value });
    }
  }
  for (const value of ["wild", "wild4"]) {
    for (let n = 0; n < 4; n++)
      cards.push({ id: `${value}-${n}`, color: "wild", value });
  }
  return cards;
}

function shuffle(cards: Card[], rng: () => number = Math.random): Card[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createGame(
  players: { id: string; name: string; bot?: boolean }[],
  rng: () => number = Math.random,
  ruleOptions?: Partial<Rules>,
): GameState {
  if (players.length < 2 || players.length > 4)
    throw new Error("需要 2–4 位玩家");
  if (
    new Set(players.map((p) => p.id)).size !== players.length ||
    players.some((p) => !p.id || !p.name)
  ) {
    throw new Error("玩家 ID 必须唯一且姓名不能为空");
  }
  const rules = normalizeRules(ruleOptions);
  const deck = shuffle(createDeck(), rng);
  const dealt = players.map((p) => ({
    ...p,
    bot: p.bot ?? false,
    hand: deck.splice(0, rules.startingCards),
    uno: false,
  }));
  // Start with a number card so the first player is never penalized before play.
  const initialIndex = deck.findIndex((c) => /^\d$/.test(c.value));
  const [initial] = deck.splice(initialIndex, 1);
  return {
    players: dealt,
    currentPlayerId: players[0].id,
    direction: 1,
    activeColor: initial.color as Color,
    deck,
    discard: [initial],
    status: "playing",
    winnerId: null,
    turn: 1,
    drawnCardId: null,
    lastAction: "牌已发好，好戏开场。",
    rules,
    pendingDraw: 0,
    pendingDrawValue: null,
  };
}

/** Pass isCurrentPlayer=false for jump-in legality from a public player view. */
export function canPlayCard(
  card: Card,
  context: {
    activeColor: Color;
    topCard: Card;
    hand: Card[];
    drawnCardId?: string | null;
    rules?: Rules;
    pendingDraw?: number;
    pendingDrawValue?: "draw2" | "wild4" | null;
  },
  isCurrentPlayer = true,
): boolean {
  const rules = context.rules ?? DEFAULT_RULES;
  if (
    !rules.allowActionFinish &&
    context.hand.length === 1 &&
    !/^\d$/.test(card.value)
  )
    return false;
  if (!isCurrentPlayer) {
    return (
      rules.jumpIn &&
      !context.pendingDraw &&
      card.color !== "wild" &&
      card.color === context.topCard.color &&
      card.value === context.topCard.value
    );
  }
  if (context.drawnCardId && context.drawnCardId !== card.id) return false;
  if (context.pendingDraw) {
    if (rules.stacking === "none" || !["draw2", "wild4"].includes(card.value))
      return false;
    if (rules.stacking === "same" && card.value !== context.pendingDrawValue)
      return false;
    return (
      card.value !== "wild4" ||
      !rules.strictWild4 ||
      !context.hand.some((c) => c.color === context.activeColor)
    );
  }
  if (card.value === "wild4")
    return (
      !rules.strictWild4 ||
      !context.hand.some((c) => c.color === context.activeColor)
    );
  return (
    card.color === "wild" ||
    card.color === context.activeColor ||
    card.value === context.topCard.value
  );
}

export function canPlay(
  card: Card,
  state: GameState,
  playerId: string,
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  return (
    !!player &&
    state.status === "playing" &&
    player.hand.some((c) => c.id === card.id) &&
    canPlayCard(
      card,
      {
        activeColor: state.activeColor,
        topCard: state.discard[state.discard.length - 1],
        hand: player.hand,
        drawnCardId: state.drawnCardId,
        rules: state.rules,
        pendingDraw: state.pendingDraw,
        pendingDrawValue: state.pendingDrawValue,
      },
      state.currentPlayerId === playerId,
    )
  );
}

export function getPlayableCards(state: GameState, playerId: string): Card[] {
  return (state.players.find((p) => p.id === playerId)?.hand ?? []).filter(
    (c) => canPlay(c, state, playerId),
  );
}

function clone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    deck: [...state.deck],
    discard: [...state.discard],
    rules: { ...state.rules },
  };
}

function takeCards(state: GameState, player: Player, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (!state.deck.length && state.discard.length > 1) {
      const top = state.discard.pop()!;
      state.deck = shuffle(state.discard);
      state.discard = [top];
    }
    const card = state.deck.pop();
    if (!card) break;
    player.hand.push(card);
    drawn.push(card);
  }
  if (drawn.length) player.uno = false;
  return drawn;
}

function nextIndex(state: GameState, distance = 1): number {
  const index = state.players.findIndex((p) => p.id === state.currentPlayerId);
  const n = state.players.length;
  return (((index + state.direction * distance) % n) + n) % n;
}

function advance(state: GameState, distance = 1): void {
  state.currentPlayerId = state.players[nextIndex(state, distance)].id;
  state.drawnCardId = null;
  state.turn++;
}

/**
 * One shared rules implementation for local and online play. House-rule choices:
 * same-kind stacking ignores color; any-kind stacking accepts either penalty.
 * Strict +4 legality remains in force when stacking. A penalty draw ends a turn.
 * Jump-in needs an exact nonwild match and cannot interrupt a pending penalty.
 * A final 7/0 wins before exchanging hands; exchanges auto-declare single hands.
 * No +4 challenge mechanic. All draws preserve the physical 108-card deck.
 */
export function applyAction(
  previous: GameState,
  playerId: string,
  action: Action,
): GameState {
  if (previous.status !== "playing") throw new Error("本局已经结束");
  if (
    !action ||
    typeof action !== "object" ||
    !["play", "draw", "pass", "uno"].includes(action.type)
  ) {
    throw new Error("无效的游戏操作");
  }
  const state = clone(previous);
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在");
  const ownTurn = state.currentPlayerId === playerId;
  const rules = state.rules;

  if (action.type === "uno") {
    if (!ownTurn && !getPlayableCards(state, playerId).length)
      throw new Error("还没有轮到你");
    if (player.hand.length !== 2) throw new Error("剩两张牌时，在出牌前喊 UNO");
    if (player.uno) throw new Error("你已经喊过 UNO");
    player.uno = true;
    state.lastAction = `${player.name}：UNO！`;
    return state;
  }
  if (!ownTurn && action.type !== "play") throw new Error("还没有轮到你");
  if (action.type === "draw") {
    if (state.pendingDraw > 0) {
      const taken = takeCards(state, player, state.pendingDraw).length;
      state.lastAction = `${player.name} 承受叠加，摸 ${taken} 张并跳过`;
      state.pendingDraw = 0;
      state.pendingDrawValue = null;
      advance(state);
      return state;
    }
    if (state.drawnCardId) throw new Error("已经摸牌，请出刚摸到的牌或跳过");
    let lastDrawn: Card | undefined;
    let count = 0;
    // At most the currently drawable physical cards: never an unbounded loop.
    const limit =
      rules.drawMode === "one"
        ? 1
        : state.deck.length + state.discard.length - 1;
    for (let i = 0; i < limit; i++) {
      const [drawn] = takeCards(state, player, 1);
      if (!drawn) break;
      lastDrawn = drawn;
      count++;
      state.drawnCardId = drawn.id;
      if (rules.drawMode === "one" || canPlay(drawn, state, playerId)) break;
    }
    if (!lastDrawn) {
      state.lastAction = `${player.name} 无牌可摸，跳过回合`;
      advance(state);
    } else {
      state.lastAction = `${player.name} 摸了 ${count} 张牌`;
      if (
        rules.drawMode === "until-playable" &&
        !canPlay(lastDrawn, state, playerId)
      ) {
        state.lastAction += "，仍无可出牌，跳过回合";
        advance(state);
      }
    }
    return state;
  }
  if (action.type === "pass") {
    if (!state.drawnCardId) throw new Error("先摸一张牌，才能跳过");
    const drawn = player.hand.find((c) => c.id === state.drawnCardId);
    if (rules.forcePlayDrawn && drawn && canPlay(drawn, state, playerId))
      throw new Error("本房间要求打出可出的摸牌");
    state.lastAction = `${player.name} 结束了回合`;
    advance(state);
    return state;
  }

  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card || !canPlay(card, state, playerId))
    throw new Error("这张牌现在不能出");
  if (card.color === "wild" && !COLORS.includes(action.color as Color))
    throw new Error("请选择下一种颜色");
  let swapTarget: Player | undefined;
  if (rules.sevenZero && card.value === "7" && player.hand.length > 1) {
    swapTarget = state.players.find(
      (p) => p.id !== playerId && p.id === action.targetPlayerId,
    );
    if (!swapTarget && state.players.length === 2 && !action.targetPlayerId)
      swapTarget = state.players.find((p) => p.id !== playerId);
    if (!swapTarget) throw new Error("请选择一名其他玩家交换手牌");
  }
  // A valid jump-in takes ownership of the turn, then resolves normally.
  state.currentPlayerId = playerId;
  player.hand = player.hand.filter((c) => c.id !== card.id);
  state.discard.push(card);
  state.activeColor = card.color === "wild" ? action.color! : card.color;
  state.drawnCardId = null;
  const valueNames: Record<string, string> = {
    skip: "禁止",
    reverse: "反转",
    draw2: "+2",
    wild: "变色",
    wild4: "+4",
  };
  state.lastAction = `${player.name} 打出了 ${valueNames[card.value] ?? card.value}`;

  let distance = 1;
  if (card.value === "reverse") {
    state.direction = state.direction === 1 ? -1 : 1;
    if (state.players.length === 2) distance = 2;
  } else if (card.value === "skip") {
    distance = 2;
  } else if (card.value === "draw2" || card.value === "wild4") {
    const amount = card.value === "draw2" ? 2 : 4;
    if (rules.stacking !== "none") {
      state.pendingDraw += amount;
      state.pendingDrawValue = card.value;
      state.lastAction += `，待叠加 +${state.pendingDraw}`;
    } else {
      const target = state.players[nextIndex(state)];
      const taken = takeCards(state, target, amount).length;
      state.lastAction += `，${target.name} 摸 ${taken} 张并跳过`;
      distance = 2;
    }
  }

  let exchanged = false;
  if (
    player.hand.length > 0 &&
    rules.sevenZero &&
    card.value === "7" &&
    swapTarget
  ) {
    [player.hand, swapTarget.hand] = [swapTarget.hand, player.hand];
    player.uno = player.hand.length === 1;
    swapTarget.uno = swapTarget.hand.length === 1;
    exchanged = true;
    state.lastAction += `，与 ${swapTarget.name} 交换手牌`;
  } else if (player.hand.length > 0 && rules.sevenZero && card.value === "0") {
    const hands = state.players.map((p) => p.hand);
    const n = state.players.length;
    state.players.forEach((_, i) => {
      const recipient = state.players[(i + state.direction + n) % n];
      recipient.hand = hands[i];
      recipient.uno = recipient.hand.length === 1;
    });
    exchanged = true;
    state.lastAction += "，所有手牌顺出牌方向轮转";
  }

  if (!exchanged && player.hand.length === 1) {
    const declared = player.uno || action.uno === true;
    player.uno = declared;
    if (!declared && rules.unoPenalty > 0) {
      const taken = takeCards(state, player, rules.unoPenalty).length;
      state.lastAction += `；忘喊 UNO，罚摸 ${taken} 张`;
    } else if (declared) state.lastAction += " · UNO！";
  } else if (!exchanged) player.uno = false;

  if (player.hand.length === 0) {
    if (state.pendingDraw) {
      takeCards(state, state.players[nextIndex(state)], state.pendingDraw);
      state.pendingDraw = 0;
      state.pendingDrawValue = null;
    }
    state.status = "finished";
    state.winnerId = playerId;
    state.lastAction = `${player.name} 赢得了这一局！`;
    state.turn++;
    return state;
  }
  advance(state, distance);
  return state;
}

export function getView(state: GameState, playerId: string): GameView {
  const local = state.players.find((p) => p.id === playerId);
  if (!local) throw new Error("玩家不在这场对局中");
  // Do not spread the private state here: opponents' hands and the deck stay secret.
  return {
    players: state.players.map(({ id, name, bot, hand, uno }) => ({
      id,
      name,
      bot,
      cardCount: hand.length,
      uno,
    })),
    hand: local.hand.map((c) => ({ ...c })),
    currentPlayerId: state.currentPlayerId,
    direction: state.direction,
    activeColor: state.activeColor,
    topCard: { ...state.discard[state.discard.length - 1] },
    deckCount: state.deck.length,
    status: state.status,
    winnerId: state.winnerId,
    turn: state.turn,
    drawnCardId: state.currentPlayerId === playerId ? state.drawnCardId : null,
    lastAction: state.lastAction,
    rules: { ...state.rules },
    pendingDraw: state.pendingDraw,
    pendingDrawValue: state.pendingDrawValue,
  };
}

export function chooseBotAction(
  state: GameState,
  playerId: string,
  difficulty: "easy" | "normal" | "hard" = "normal",
): Action {
  const player = state.players.find((p) => p.id === playerId);
  if (
    !player ||
    state.currentPlayerId !== playerId ||
    state.status !== "playing"
  )
    throw new Error("电脑现在无法行动");
  const legal = getPlayableCards(state, playerId);
  if (!legal.length) return { type: state.drawnCardId ? "pass" : "draw" };
  const colorCounts = Object.fromEntries(
    COLORS.map((c) => [
      c,
      player.hand.filter((card) => card.color === c).length,
    ]),
  ) as Record<Color, number>;
  const next = state.players[nextIndex(state)];
  const score = (card: Card) => {
    const colorScore = card.color === "wild" ? -5 : colorCounts[card.color] * 3;
    const actionScore = ["skip", "reverse", "draw2", "wild4"].includes(
      card.value,
    )
      ? 2
      : 0;
    const pressure =
      difficulty === "hard" && next.hand.length <= 2 ? actionScore * 8 : 0;
    return colorScore + actionScore + pressure;
  };
  const card =
    difficulty === "easy"
      ? legal[Math.floor(Math.random() * legal.length)]
      : [...legal].sort((a, b) => score(b) - score(a))[0];
  const color = [...COLORS].sort((a, b) => colorCounts[b] - colorCounts[a])[0];
  const swapTarget =
    state.rules.sevenZero && card.value === "7"
      ? [...state.players]
          .filter((p) => p.id !== playerId)
          .sort((a, b) => a.hand.length - b.hand.length)[0]
      : undefined;
  return {
    type: "play",
    cardId: card.id,
    ...(card.color === "wild" ? { color } : {}),
    ...(swapTarget ? { targetPlayerId: swapTarget.id } : {}),
    uno: player.hand.length === 2,
  };
}
