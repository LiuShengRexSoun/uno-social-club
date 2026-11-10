import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  canPlay,
  canPlayCard,
  chooseBotAction,
  createDeck,
  createGame,
  getView,
  DEFAULT_RULES,
  normalizeRules,
  RULE_PRESETS,
  type Card,
  type Color,
  type GameState,
} from "../shared/engine.ts";

let serial = 0;
const c = (color: Color | "wild", value: string): Card => ({
  id: `test-${serial++}`,
  color,
  value,
});
function fixture(hands: Card[][], top = c("red", "5")): GameState {
  return {
    players: hands.map((hand, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      bot: true,
      hand,
      uno: false,
    })),
    currentPlayerId: "p0",
    direction: 1,
    activeColor: top.color === "wild" ? "red" : top.color,
    deck: Array.from({ length: 20 }, (_, i) => c("yellow", String(i % 10))),
    discard: [top],
    status: "playing",
    winnerId: null,
    turn: 1,
    drawnCardId: null,
    lastAction: "",
    rules: { ...DEFAULT_RULES },
    pendingDraw: 0,
    pendingDrawValue: null,
  };
}
function seeded(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("108 unique cards have the standard color/action distribution", () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((card) => card.id)).size, 108);
  for (const color of ["red", "yellow", "green", "blue"])
    assert.equal(deck.filter((card) => card.color === color).length, 25);
  assert.equal(deck.filter((card) => card.value === "wild4").length, 4);
  assert.equal(deck.filter((card) => card.value === "wild").length, 4);
});

test("dealing conserves every card, starts on a number and can be reproduced", () => {
  const players = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
  const game = createGame(players, seeded(11));
  assert.deepEqual(game, createGame(players, seeded(11)));
  assert.ok(game.players.every((p) => p.hand.length === 7));
  assert.match(game.discard[0].value, /^\d$/);
  assert.equal(
    game.deck.length +
      game.discard.length +
      game.players.flatMap((p) => p.hand).length,
    108,
  );
  assert.throws(() => createGame(players.slice(0, 1)));
  assert.throws(() => createGame([players[0], players[0]]));
});

test("color or face matches, wild matches, but unrelated cards do not", () => {
  const hand = [
    c("red", "1"),
    c("blue", "5"),
    c("blue", "8"),
    c("wild", "wild"),
  ];
  const game = fixture([hand, [c("blue", "2")], [c("green", "3")]]);
  assert.deepEqual(
    hand.map((card) => canPlay(card, game, "p0")),
    [true, true, false, true],
  );
  assert.equal(canPlay(hand[0], game, "p1"), false);
  assert.equal(canPlay(c("red", "1"), game, "p0"), false);
});

test("play is immutable and rejects out of turn, absent and illegal cards", () => {
  const hand = [c("red", "1"), c("blue", "8"), c("green", "2")];
  const game = fixture([hand, [c("blue", "2")], [c("green", "3")]]);
  const snapshot = structuredClone(game);
  assert.throws(() => applyAction(game, "p1", { type: "draw" }));
  assert.throws(() =>
    applyAction(game, "p0", { type: "play", cardId: "missing" }),
  );
  assert.throws(() =>
    applyAction(game, "p0", { type: "play", cardId: hand[1].id }),
  );
  const next = applyAction(game, "p0", { type: "play", cardId: hand[0].id });
  assert.equal(next.currentPlayerId, "p1");
  assert.equal(next.players[0].hand.length, 2);
  assert.equal(next.discard.at(-1)?.id, hand[0].id);
  assert.deepEqual(game, snapshot);
});

test("skip and reverse obey three-player direction and turn order", () => {
  const skip = c("red", "skip");
  const s = applyAction(
    fixture([
      [skip, c("green", "1"), c("blue", "2")],
      [c("green", "1")],
      [c("blue", "2")],
    ]),
    "p0",
    { type: "play", cardId: skip.id },
  );
  assert.equal(s.currentPlayerId, "p2");
  const reverse = c("red", "reverse");
  const r = applyAction(
    fixture([
      [reverse, c("green", "1"), c("blue", "2")],
      [c("green", "1")],
      [c("blue", "2")],
    ]),
    "p0",
    { type: "play", cardId: reverse.id },
  );
  assert.equal(r.currentPlayerId, "p2");
  assert.equal(r.direction, -1);
});

test("two-player reverse grants the same player another turn", () => {
  const reverse = c("red", "reverse");
  const state = fixture([[reverse, c("green", "1")], [c("blue", "2")]]);
  const next = applyAction(state, "p0", {
    type: "play",
    cardId: reverse.id,
    uno: true,
  });
  assert.equal(next.currentPlayerId, "p0");
  assert.equal(next.direction, -1);
  assert.equal(next.players[0].hand.length, 1);
});

test("+2 automatically draws for the next player and skips, without stacking", () => {
  const draw2 = c("red", "draw2");
  const next = applyAction(
    fixture([
      [draw2, c("green", "1"), c("blue", "2")],
      [c("red", "draw2")],
      [c("green", "2")],
    ]),
    "p0",
    { type: "play", cardId: draw2.id },
  );
  assert.equal(next.players[1].hand.length, 3);
  assert.equal(next.currentPlayerId, "p2");
  assert.equal(next.drawnCardId, null);
});

test("+4 requires absence of the active color, even if another face match exists", () => {
  const wild4 = c("wild", "wild4");
  let state = fixture([[wild4, c("red", "9")], [c("blue", "2")]]);
  assert.equal(canPlay(wild4, state, "p0"), false);
  assert.throws(() =>
    applyAction(state, "p0", { type: "play", cardId: wild4.id, color: "blue" }),
  );
  state = fixture([
    [wild4, c("blue", "5")],
    [c("blue", "2")],
    [c("green", "1")],
  ]);
  assert.equal(canPlay(wild4, state, "p0"), true);
  const next = applyAction(state, "p0", {
    type: "play",
    cardId: wild4.id,
    color: "blue",
    uno: true,
  });
  assert.equal(next.activeColor, "blue");
  assert.equal(next.players[1].hand.length, 5);
  assert.equal(next.currentPlayerId, "p2");
});

test("wild requires a real color and sets it explicitly", () => {
  const wild = c("wild", "wild");
  const state = fixture([[wild, c("green", "1")], [c("blue", "2")]]);
  assert.throws(() =>
    applyAction(state, "p0", { type: "play", cardId: wild.id }),
  );
  assert.throws(() =>
    applyAction(state, "p0", {
      type: "play",
      cardId: wild.id,
      color: "purple" as Color,
    }),
  );
  assert.equal(
    applyAction(state, "p0", {
      type: "play",
      cardId: wild.id,
      color: "green",
      uno: true,
    }).activeColor,
    "green",
  );
});

test("draw once, then play only the drawn card or pass", () => {
  const existing = c("red", "1");
  const state = fixture([[existing, c("green", "2")], [c("blue", "2")]]);
  const drawn = c("red", "9");
  state.deck.push(drawn);
  const next = applyAction(state, "p0", { type: "draw" });
  assert.equal(next.currentPlayerId, "p0");
  assert.equal(next.drawnCardId, drawn.id);
  assert.equal(canPlay(existing, next, "p0"), false);
  assert.equal(canPlay(drawn, next, "p0"), true);
  assert.throws(() => applyAction(next, "p0", { type: "draw" }));
  assert.throws(() =>
    applyAction(next, "p0", { type: "play", cardId: existing.id }),
  );
  assert.throws(() => applyAction(state, "p0", { type: "pass" }));
  assert.equal(applyAction(next, "p0", { type: "pass" }).currentPlayerId, "p1");
  assert.equal(
    applyAction(next, "p0", { type: "play", cardId: drawn.id }).currentPlayerId,
    "p1",
  );
});

test("declaring UNO before a two-card play prevents the immediate two-card penalty", () => {
  const play = c("red", "1");
  const state = fixture([[play, c("green", "2")], [c("blue", "2")]]);
  const missed = applyAction(state, "p0", { type: "play", cardId: play.id });
  assert.equal(missed.players[0].hand.length, 3);
  assert.match(missed.lastAction, /忘喊 UNO/);
  const declared = applyAction(state, "p0", { type: "uno" });
  assert.equal(declared.turn, state.turn);
  assert.equal(declared.players[0].uno, true);
  const next = applyAction(declared, "p0", { type: "play", cardId: play.id });
  assert.equal(next.players[0].hand.length, 1);
  assert.equal(next.players[0].uno, true);
  assert.throws(() => applyAction(declared, "p0", { type: "uno" }));
  assert.equal(
    applyAction(state, "p0", { type: "play", cardId: play.id, uno: true })
      .players[0].hand.length,
    1,
  );
});

test("winning with a draw card still applies the opponent penalty", () => {
  const play = c("red", "draw2");
  const state = fixture([[play], [c("blue", "2")]]);
  const next = applyAction(state, "p0", { type: "play", cardId: play.id });
  assert.equal(next.status, "finished");
  assert.equal(next.winnerId, "p0");
  assert.equal(next.players[1].hand.length, 3);
  assert.throws(() => applyAction(next, "p0", { type: "draw" }));
});

test("discard recycling preserves top card, uniqueness and count", () => {
  const state = fixture([[c("blue", "1")], [c("green", "2")]]);
  const top = state.discard[0];
  const recycle = c("yellow", "8");
  state.discard.unshift(recycle);
  state.deck = [];
  const next = applyAction(state, "p0", { type: "draw" });
  assert.equal(next.discard.length, 1);
  assert.deepEqual(next.discard[0], top);
  assert.equal(next.players[0].hand.at(-1)?.id, recycle.id);
  assert.equal(state.discard.length, 2);
});

test("no drawable cards advances turn rather than trapping the game", () => {
  const state = fixture([[c("blue", "1")], [c("green", "2")]]);
  state.deck = [];
  assert.equal(
    applyAction(state, "p0", { type: "draw" }).currentPlayerId,
    "p1",
  );
});

test("public views never contain opponent hands, deck contents or their drawn identity", () => {
  const state = createGame(
    [
      { id: "p0", name: "a" },
      { id: "p1", name: "b" },
    ],
    seeded(32),
  );
  const drawn = applyAction(state, "p0", { type: "draw" });
  const view = getView(drawn, "p1");
  assert.equal(view.drawnCardId, null);
  assert.equal(view.hand.length, 7);
  assert.ok(view.players.every((p) => !("hand" in p)));
  assert.equal("deck" in view, false);
  assert.equal("discard" in view, false);
  view.hand[0].value = "tampered";
  assert.notEqual(drawn.players[1].hand[0].value, "tampered");
  assert.throws(() => getView(state, "outsider"));
});

test("public legality helper matches authoritative play decisions", () => {
  const state = createGame(
    [
      { id: "p0", name: "a" },
      { id: "p1", name: "b" },
    ],
    seeded(99),
  );
  const view = getView(state, "p0");
  for (const card of view.hand)
    assert.equal(canPlayCard(card, view), canPlay(card, state, "p0"));
});

test("bounded bot simulations finish and conserve all 108 cards every action", () => {
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      let state = createGame(
        Array.from({ length: (seed % 3) + 2 }, (_, i) => ({
          id: `p${i}`,
          name: `Bot ${i}`,
          bot: true,
        })),
        seeded(seed),
      );
      let moves = 0;
      while (state.status === "playing" && moves++ < 2500) {
        const action = chooseBotAction(
          state,
          state.currentPlayerId,
          difficulty,
        );
        state = applyAction(state, state.currentPlayerId, action);
        const cards = [
          ...state.deck,
          ...state.discard,
          ...state.players.flatMap((p) => p.hand),
        ];
        assert.equal(cards.length, 108);
        assert.equal(new Set(cards.map((card) => card.id)).size, 108);
      }
      assert.equal(
        state.status,
        "finished",
        `${difficulty}, seed ${seed} did not finish in ${moves} actions`,
      );
      assert.equal(
        state.players.find((p) => p.id === state.winnerId)?.hand.length,
        0,
      );
    }
  }
});

test("rules normalize only supported types and clamp finite starting-card numbers", () => {
  assert.deepEqual(normalizeRules(), DEFAULT_RULES);
  assert.deepEqual(normalizeRules(null), DEFAULT_RULES);
  assert.equal(normalizeRules({ startingCards: 100 }).startingCards, 15);
  assert.equal(normalizeRules({ startingCards: -3 }).startingCards, 3);
  assert.equal(normalizeRules({ startingCards: 10.7 }).startingCards, 10);
  assert.equal(normalizeRules({ startingCards: Infinity }).startingCards, 7);
  const invalid = {
    stacking: "unlimited",
    drawMode: "forever",
    jumpIn: "yes",
    unoPenalty: 3,
    strictWild4: 0,
  } as never;
  assert.deepEqual(normalizeRules(invalid), DEFAULT_RULES);
  assert.deepEqual(
    normalizeRules({ jumpIn: true, unoPenalty: 0, strictWild4: false }),
    {
      ...DEFAULT_RULES,
      jumpIn: true,
      unoPenalty: 0,
      strictWild4: false,
    },
  );
  const result = normalizeRules();
  result.startingCards = 10;
  assert.equal(DEFAULT_RULES.startingCards, 7);
});

test("custom starting hand size is respected and exposed without aliasing", () => {
  for (const count of [3, 10, 15]) {
    const state = createGame(
      Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      seeded(9),
      { startingCards: count },
    );
    assert.ok(state.players.every((p) => p.hand.length === count));
    assert.equal(state.deck.length + state.discard.length + count * 4, 108);
    assert.equal(state.rules.startingCards, count);
    const view = getView(state, "p0");
    assert.equal(view.rules.startingCards, count);
    view.rules.startingCards = 5;
    assert.equal(state.rules.startingCards, count);
  }
});

test("same-kind stacking accumulates across colors and penalty draw consumes turn", () => {
  const first = c("red", "draw2"),
    second = c("blue", "draw2");
  let state = fixture([
    [first, c("blue", "1"), c("green", "2")],
    [second, c("red", "6"), c("wild", "wild4")],
    [c("yellow", "8")],
  ]);
  state.rules.stacking = "same";
  state = applyAction(state, "p0", { type: "play", cardId: first.id });
  assert.equal(state.pendingDraw, 2);
  assert.equal(state.currentPlayerId, "p1");
  assert.equal(canPlay(second, state, "p1"), true);
  assert.equal(canPlay(state.players[1].hand[1], state, "p1"), false);
  assert.equal(canPlay(state.players[1].hand[2], state, "p1"), false);
  state = applyAction(state, "p1", { type: "play", cardId: second.id });
  assert.equal(state.pendingDraw, 4);
  assert.equal(state.pendingDrawValue, "draw2");
  assert.equal(state.activeColor, "blue");
  assert.equal(getView(state, "p2").pendingDraw, 4);
  assert.throws(() => applyAction(state, "p2", { type: "pass" }));
  state = applyAction(state, "p2", { type: "draw" });
  assert.equal(state.players[2].hand.length, 5);
  assert.equal(state.pendingDraw, 0);
  assert.equal(state.pendingDrawValue, null);
  assert.equal(state.currentPlayerId, "p0");
  assert.equal(state.drawnCardId, null);
});

test("any-kind stacking accepts both penalty kinds and keeps strict +4 restriction", () => {
  const first = c("red", "draw2"),
    second = c("wild", "wild4"),
    third = c("yellow", "draw2");
  let state = fixture([
    [first, c("green", "1"), c("blue", "2")],
    [second, c("red", "1"), c("green", "1")],
    [third, c("green", "2"), c("blue", "1")],
  ]);
  state.rules.stacking = "any";
  state = applyAction(state, "p0", { type: "play", cardId: first.id });
  assert.equal(canPlay(second, state, "p1"), false);
  state.rules.strictWild4 = false;
  state = applyAction(state, "p1", {
    type: "play",
    cardId: second.id,
    color: "blue",
  });
  assert.equal(state.pendingDraw, 6);
  assert.equal(canPlay(third, state, "p2"), true);
  state = applyAction(state, "p2", { type: "play", cardId: third.id });
  assert.equal(state.pendingDraw, 8);
  const before = state.players[0].hand.length;
  state = applyAction(state, "p0", { type: "draw" });
  assert.equal(state.players[0].hand.length, before + 8);
});

test("a final stacking penalty resolves the full accumulated total before victory", () => {
  const first = c("red", "draw2"),
    final = c("blue", "draw2");
  let state = fixture([
    [first, c("green", "1"), c("blue", "2")],
    [final],
    [c("yellow", "2")],
  ]);
  state.rules.stacking = "same";
  state = applyAction(state, "p0", { type: "play", cardId: first.id });
  state = applyAction(state, "p1", { type: "play", cardId: final.id });
  assert.equal(state.status, "finished");
  assert.equal(state.winnerId, "p1");
  assert.equal(state.players[2].hand.length, 5);
  assert.equal(state.pendingDraw, 0);
});

test("draw-until-playable stops at the first legal new card and permits only it", () => {
  const first = c("blue", "1"),
    second = c("green", "2"),
    playable = c("red", "9");
  const original = c("red", "1");
  const state = fixture([[original, c("yellow", "2")], [c("yellow", "8")]]);
  state.rules.drawMode = "until-playable";
  state.deck = [c("blue", "3"), playable, second, first];
  const next = applyAction(state, "p0", { type: "draw" });
  assert.equal(next.players[0].hand.length, 5);
  assert.equal(next.drawnCardId, playable.id);
  assert.equal(next.deck.length, 1);
  assert.equal(canPlay(original, next, "p0"), false);
  assert.equal(canPlay(playable, next, "p0"), true);
  assert.equal(next.currentPlayerId, "p0");
});

test("draw-until-playable terminates and advances if all drawable cards are unusable", () => {
  const state = fixture([[c("blue", "1")], [c("green", "2")]]);
  state.rules.drawMode = "until-playable";
  state.deck = [c("blue", "8"), c("green", "9")];
  state.discard.unshift(c("yellow", "7"));
  const next = applyAction(state, "p0", { type: "draw" });
  assert.equal(next.players[0].hand.length, 4);
  assert.equal(next.currentPlayerId, "p1");
  assert.equal(next.drawnCardId, null);
  assert.equal(next.deck.length, 0);
  assert.equal(next.discard.length, 1);
});

test("forced drawn-card play rejects pass only while that card is actually legal", () => {
  for (const isLegal of [true, false]) {
    const state = fixture([[c("blue", "1")], [c("green", "2")]]);
    state.rules.forcePlayDrawn = true;
    state.deck.push(c(isLegal ? "red" : "blue", "8"));
    const next = applyAction(state, "p0", { type: "draw" });
    if (isLegal) {
      assert.throws(
        () => applyAction(next, "p0", { type: "pass" }),
        /要求打出/,
      );
      const card = next.players[0].hand.find((c) => c.id === next.drawnCardId)!;
      assert.doesNotThrow(() =>
        applyAction(next, "p0", { type: "play", cardId: card.id, uno: true }),
      );
    } else
      assert.equal(
        applyAction(next, "p0", { type: "pass" }).currentPlayerId,
        "p1",
      );
  }
});

test("seven swaps entire post-play hands with a validated target, with no card loss", () => {
  const seven = c("red", "7"),
    other = c("blue", "3");
  const state = fixture([
    [seven, c("blue", "1"), c("green", "2")],
    [other],
    [c("yellow", "1")],
  ]);
  state.rules.sevenZero = true;
  assert.throws(
    () => applyAction(state, "p0", { type: "play", cardId: seven.id }),
    /请选择/,
  );
  assert.throws(
    () =>
      applyAction(state, "p0", {
        type: "play",
        cardId: seven.id,
        targetPlayerId: "p0",
      }),
    /请选择/,
  );
  assert.throws(
    () =>
      applyAction(state, "p0", {
        type: "play",
        cardId: seven.id,
        targetPlayerId: "missing",
      }),
    /请选择/,
  );
  const next = applyAction(state, "p0", {
    type: "play",
    cardId: seven.id,
    targetPlayerId: "p1",
  });
  assert.deepEqual(next.players[0].hand, [other]);
  assert.deepEqual(next.players[1].hand, state.players[0].hand.slice(1));
  assert.equal(next.players[0].uno, true);
  assert.equal(next.currentPlayerId, "p1");
  assert.equal(
    next.players.flatMap((p) => p.hand).length,
    state.players.flatMap((p) => p.hand).length - 1,
  );
  assert.equal(state.players[0].hand.length, 3);
});

test("seven automatically selects the only other player in a two-player game", () => {
  const seven = c("red", "7");
  const state = fixture([
    [seven, c("blue", "2")],
    [c("green", "1"), c("green", "3"), c("green", "4")],
  ]);
  state.rules.sevenZero = true;
  const next = applyAction(state, "p0", { type: "play", cardId: seven.id });
  assert.equal(next.players[0].hand.length, 3);
  assert.equal(next.players[1].hand.length, 1);
  assert.equal(next.players[1].uno, true);
});

test("zero rotates all remaining hands in the current direction", () => {
  for (const direction of [1, -1] as const) {
    const zero = c("red", "0");
    const state = fixture([
      [zero, c("blue", "1")],
      [c("green", "2"), c("green", "3"), c("green", "4")],
      [c("yellow", "4")],
    ]);
    state.rules.sevenZero = true;
    state.direction = direction;
    const hands = state.players.map((p, i) =>
      i === 0 ? p.hand.slice(1) : p.hand,
    );
    const next = applyAction(state, "p0", { type: "play", cardId: zero.id });
    hands.forEach((hand, i) =>
      assert.deepEqual(next.players[(i + direction + 3) % 3].hand, hand),
    );
    assert.ok(
      next.players.filter((p) => p.hand.length === 1).every((p) => p.uno),
    );
    assert.equal(next.currentPlayerId, direction === 1 ? "p1" : "p2");
  }
});

test("a last seven or zero wins without transferring the empty hand", () => {
  for (const value of ["7", "0"]) {
    const card = c("red", value);
    const state = fixture([[card], [c("green", "1")], [c("blue", "2")]]);
    state.rules.sevenZero = true;
    const next = applyAction(state, "p0", { type: "play", cardId: card.id });
    assert.equal(next.status, "finished");
    assert.equal(next.winnerId, "p0");
    assert.equal(next.players[0].hand.length, 0);
    assert.equal(next.players[1].hand[0].id, state.players[1].hand[0].id);
  }
});

test("jump-in accepts exact nonwild matches out of turn and resumes after jumper", () => {
  const exact = c("red", "5"),
    mismatch = c("blue", "5"),
    wild = c("wild", "wild");
  const state = fixture([
    [c("blue", "1")],
    [c("yellow", "2")],
    [exact, mismatch, wild],
  ]);
  state.rules.jumpIn = true;
  assert.equal(canPlay(exact, state, "p2"), true);
  assert.equal(canPlay(mismatch, state, "p2"), false);
  assert.equal(canPlay(wild, state, "p2"), false);
  assert.equal(canPlayCard(exact, getView(state, "p2"), false), true);
  assert.equal(canPlayCard(mismatch, getView(state, "p2"), false), false);
  assert.throws(() => applyAction(state, "p2", { type: "draw" }));
  const next = applyAction(state, "p2", { type: "play", cardId: exact.id });
  assert.equal(next.currentPlayerId, "p0");
  assert.equal(next.turn, 2);
  state.rules.jumpIn = false;
  assert.equal(canPlay(exact, state, "p2"), false);
  assert.throws(() =>
    applyAction(state, "p2", { type: "play", cardId: exact.id }),
  );
});

test("jump-in can interrupt a drawn turn but not an outstanding stacking penalty", () => {
  const exact = c("red", "5");
  let state = fixture([
    [c("blue", "1")],
    [c("yellow", "2")],
    [exact, c("green", "1")],
  ]);
  state.rules.jumpIn = true;
  state = applyAction(state, "p0", { type: "draw" });
  assert.ok(state.drawnCardId);
  state = applyAction(state, "p2", {
    type: "play",
    cardId: exact.id,
    uno: true,
  });
  assert.equal(state.drawnCardId, null);
  assert.equal(state.currentPlayerId, "p0");
  state.pendingDraw = 4;
  state.pendingDrawValue = "draw2";
  state.players[1].hand.push(c("red", "5"));
  assert.equal(canPlay(state.players[1].hand.at(-1)!, state, "p1"), false);
});

test("jumping with an action card applies its effect relative to the jumper", () => {
  const exact = c("red", "reverse");
  const state = fixture(
    [[c("blue", "1")], [c("yellow", "2")], [exact, c("green", "1")]],
    c("red", "reverse"),
  );
  state.rules.jumpIn = true;
  const next = applyAction(state, "p2", {
    type: "play",
    cardId: exact.id,
    uno: true,
  });
  assert.equal(next.direction, -1);
  assert.equal(next.currentPlayerId, "p1");
});

test("relaxed wild-four legality allows a +4 while holding the active color", () => {
  const wild4 = c("wild", "wild4");
  const state = fixture([
    [wild4, c("red", "1"), c("green", "2")],
    [c("blue", "2")],
  ]);
  state.rules.strictWild4 = false;
  assert.equal(canPlay(wild4, state, "p0"), true);
  assert.doesNotThrow(() =>
    applyAction(state, "p0", {
      type: "play",
      cardId: wild4.id,
      color: "green",
    }),
  );
});

test("UNO penalties support off, two and four without changing card conservation", () => {
  for (const unoPenalty of [0, 2, 4] as const) {
    const card = c("red", "1");
    const state = fixture([[card, c("green", "2")], [c("blue", "2")]]);
    state.rules.unoPenalty = unoPenalty;
    const next = applyAction(state, "p0", { type: "play", cardId: card.id });
    assert.equal(next.players[0].hand.length, 1 + unoPenalty);
    assert.equal(next.deck.length, state.deck.length - unoPenalty);
  }
});

test("no action-card finish blocks every action/wild but still allows drawing and numeric wins", () => {
  for (const value of ["skip", "reverse", "draw2", "wild", "wild4", "9"]) {
    const card = c(value.startsWith("wild") ? "wild" : "red", value);
    const state = fixture([[card], [c("blue", "2")]]);
    state.rules.allowActionFinish = false;
    if (value === "9") {
      assert.equal(canPlay(card, state, "p0"), true);
      assert.equal(
        applyAction(state, "p0", { type: "play", cardId: card.id }).status,
        "finished",
      );
    } else {
      assert.equal(canPlay(card, state, "p0"), false);
      assert.throws(() =>
        applyAction(state, "p0", {
          type: "play",
          cardId: card.id,
          color: "blue",
        }),
      );
      assert.doesNotThrow(() => applyAction(state, "p0", { type: "draw" }));
    }
  }
});

test("all rule presets support bounded complete bot games with conserved card identities", () => {
  for (const [preset, rules] of Object.entries(RULE_PRESETS)) {
    for (let seed = 1; seed <= 6; seed++) {
      let state = createGame(
        Array.from({ length: (seed % 3) + 2 }, (_, i) => ({
          id: `p${i}`,
          name: `Bot ${i}`,
          bot: true,
        })),
        seeded(seed),
        rules,
      );
      let moves = 0;
      while (state.status === "playing" && moves++ < 4000) {
        const actor = state.currentPlayerId;
        state = applyAction(
          state,
          actor,
          chooseBotAction(state, actor, "hard"),
        );
        const cards = [
          ...state.deck,
          ...state.discard,
          ...state.players.flatMap((p) => p.hand),
        ];
        assert.equal(cards.length, 108);
        assert.equal(new Set(cards.map((card) => card.id)).size, 108);
      }
      assert.equal(
        state.status,
        "finished",
        `${preset} seed ${seed} exceeded bounded move limit`,
      );
    }
  }
});
