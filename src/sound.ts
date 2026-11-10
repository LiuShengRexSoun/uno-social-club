let context: AudioContext | null = null;
export function sound(
  kind: "card" | "draw" | "uno" | "win" | "click",
  enabled: boolean,
) {
  if (!enabled) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const ctx = context;
    const notes =
      kind === "win"
        ? [523, 659, 784, 1047]
        : kind === "uno"
          ? [440, 660, 880]
          : kind === "card"
            ? [280, 420]
            : kind === "draw"
              ? [380, 260]
              : [640];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = kind === "draw" ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.075);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.075);
      gain.gain.linearRampToValueAtTime(
        0.045,
        ctx.currentTime + i * 0.075 + 0.012,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + i * 0.075 + 0.14,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.075);
      osc.stop(ctx.currentTime + i * 0.075 + 0.15);
    });
  } catch {
    /* Audio is optional. */
  }
}
