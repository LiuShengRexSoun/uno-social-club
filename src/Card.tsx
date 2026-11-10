import { useId, type CSSProperties } from "react";
import type { Card as UnoCard } from "../shared/engine";

export const colorHex: Record<string, string> = {
  red: "#ed543d",
  blue: "#3c8ed3",
  green: "#3baf78",
  yellow: "#f1bb3a",
  wild: "#253d39",
};
export const colorName: Record<string, string> = {
  red: "红色",
  blue: "蓝色",
  green: "绿色",
  yellow: "黄色",
  wild: "万能",
};
export function cardLabel(card: UnoCard) {
  return `${colorName[card.color]} ${({ skip: "跳过", reverse: "反转", draw2: "加二", wild: "变色", wild4: "加四" } as Record<string, string>)[card.value] ?? card.value}`;
}
function Symbol({
  value,
  x,
  y,
  size = 60,
}: {
  value: string;
  x: number;
  y: number;
  size?: number;
}) {
  if (value === "skip")
    return (
      <g
        transform={`translate(${x} ${y})`}
        fill="none"
        stroke="currentColor"
        strokeWidth={size * 0.09}
      >
        <circle r={size * 0.34} />
        <path
          d={`M ${-size * 0.24} ${size * 0.24} L ${size * 0.24} ${-size * 0.24}`}
        />
      </g>
    );
  if (value === "reverse")
    return (
      <g
        transform={`translate(${x} ${y}) scale(${size / 70})`}
        fill="currentColor"
      >
        <path d="M-23 14V-10Q-23-23-9-23H8V-34L28-15 8 4V-7H-6Q-10-7-10-2V14Z" />
        <path d="M23-14V10Q23 23 9 23H-8V34L-28 15-8-4V7H6Q10 7 10 2V-14Z" />
      </g>
    );
  if (value === "wild" || value === "wild4")
    return (
      <g transform={`translate(${x} ${y}) rotate(-24)`}>
        {["red", "blue", "yellow", "green"].map((c, i) => (
          <path
            key={c}
            d={`M0 0 L0 ${-size * 0.43} A${size * 0.43} ${size * 0.43} 0 0 1 ${size * 0.43} 0 Z`}
            fill={colorHex[c]}
            stroke="#fff7df"
            strokeWidth="2"
            transform={`rotate(${i * 90})`}
          />
        ))}
        {value === "wild4" && (
          <text
            transform="rotate(24)"
            y={size * 0.2}
            fontSize={size * 0.63}
            textAnchor="middle"
            fill="#fff9ea"
            stroke="#203831"
            strokeWidth="1.2"
            paintOrder="stroke"
            fontWeight="900"
          >
            +4
          </text>
        )}
      </g>
    );
  return (
    <text
      fill="currentColor"
      x={x}
      y={y + size * 0.35}
      textAnchor="middle"
      fontSize={value === "draw2" ? size * 0.9 : size * 1.2}
      fontFamily="Arial Black,Arial,sans-serif"
      fontWeight="900"
      letterSpacing="-5"
    >
      {value === "draw2" ? "+2" : value}
    </text>
  );
}
export function CardFace({
  card,
  back = false,
}: {
  card?: UnoCard;
  back?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const hex = colorHex[card?.color ?? "wild"];
  return (
    <svg viewBox="0 0 130 190" className="card-art" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-paint`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={back ? "#243d35" : hex} />
          <stop offset="1" stopColor={back ? "#10271f" : hex} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".12" />
        </linearGradient>
        <pattern
          id={`${id}-grain`}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".45" fill="#fff" opacity=".12" />
        </pattern>
        <filter id={`${id}-shadow`}>
          <feDropShadow
            dx="1.5"
            dy="2"
            stdDeviation="0"
            floodColor="#172e26"
            floodOpacity=".65"
          />
        </filter>
      </defs>
      <rect x="1" y="1" width="128" height="188" rx="12" fill="#c7c4b2" />
      <rect x="1" y="0" width="128" height="186" rx="12" fill="#fff9e9" />
      <rect
        x="6"
        y="5"
        width="118"
        height="176"
        rx="8"
        fill={`url(#${id}-paint)`}
      />
      <rect
        x="9"
        y="8"
        width="112"
        height="170"
        rx="6"
        fill="none"
        stroke="#fff9e9"
        strokeOpacity=".2"
      />
      <rect
        x="6"
        y="5"
        width="118"
        height="176"
        rx="8"
        fill={`url(#${id}-grain)`}
      />
      {back ? (
        <>
          <ellipse
            cx="65"
            cy="94"
            rx="48"
            ry="65"
            transform="rotate(28 65 94)"
            fill="#eb5b3c"
            stroke="#f9d270"
            strokeWidth="2.5"
          />
          <ellipse
            cx="65"
            cy="94"
            rx="40"
            ry="57"
            transform="rotate(28 65 94)"
            fill="none"
            stroke="#ffbd70"
            strokeWidth=".6"
          />
          <text
            x="60"
            y="109"
            transform="rotate(-18 65 94)"
            fill="#ffeb9e"
            stroke="#163c2d"
            strokeWidth="5"
            paintOrder="stroke"
            fontFamily="Arial Black,Arial"
            fontWeight="900"
            fontSize="44"
            fontStyle="italic"
            textAnchor="middle"
            letterSpacing="-5"
          >
            UNO
          </text>
          <text
            x="65"
            y="152"
            fontSize="6"
            fill="#e3d5ad"
            textAnchor="middle"
            letterSpacing="2"
          >
            SOCIAL CLUB
          </text>
          <path
            d="M20 25h20M20 25v20M110 161H90M110 161v-20"
            fill="none"
            stroke="#9ba88b"
            strokeWidth="1"
          />
        </>
      ) : (
        card && (
          <>
            <ellipse
              cx="65"
              cy="94"
              rx="43"
              ry="73"
              transform="rotate(29 65 94)"
              fill="#fff8e8"
            />
            <ellipse
              cx="65"
              cy="94"
              rx="38"
              ry="68"
              transform="rotate(29 65 94)"
              fill={hex}
            />
            <g color="#fff8e8" filter={`url(#${id}-shadow)`}>
              <Symbol value={card.value} x={63} y={94} size={78} />
            </g>
            <g color="#fff9ed">
              <Symbol value={card.value} x={23} y={25} size={24} />
            </g>
            <g color="#fff9ed" transform="rotate(180 65 94)">
              <Symbol value={card.value} x={23} y={25} size={24} />
            </g>
            <text
              x="65"
              y="169"
              textAnchor="middle"
              fill="#fff9ed"
              opacity=".65"
              fontSize="4.7"
              letterSpacing="1.5"
            >
              UNO · SOCIAL CLUB
            </text>
          </>
        )
      )}
      <rect
        x="6"
        y="5"
        width="118"
        height="176"
        rx="8"
        fill={`url(#${id}-shine)`}
      />
      <path
        d="M13 2H116Q127 2 127 13"
        fill="none"
        stroke="#fff"
        strokeOpacity=".8"
        strokeWidth="1.5"
      />
    </svg>
  );
}
export function PlayingCard({
  card,
  playable,
  selected,
  onClick,
  index,
  count,
}: {
  card: UnoCard;
  playable: boolean;
  selected: boolean;
  onClick: (el: HTMLButtonElement) => void;
  index: number;
  count: number;
}) {
  const angle =
    (index - (count - 1) / 2) * Math.min(5.5, 35 / Math.max(count, 1));
  const lift =
    Math.abs(index - (count - 1) / 2) * Math.min(3.2, 22 / Math.max(count, 1));
  return (
    <div
      className={`hand-slot ${selected ? "selected" : ""} ${playable ? "playable" : "unplayable"}`}
      style={
        {
          "--angle": `${angle}deg`,
          "--lift": `${lift}px`,
          "--i": index,
        } as CSSProperties
      }
    >
      <button
        className="playing-card"
        data-card-id={card.id}
        aria-label={`${cardLabel(card)}${playable ? "，可出牌" : ""}`}
        aria-pressed={selected}
        onClick={(e) => onClick(e.currentTarget)}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty(
            "--tilt-x",
            `${-(e.clientY - r.top - r.height / 2) / 12}deg`,
          );
          e.currentTarget.style.setProperty(
            "--tilt-y",
            `${(e.clientX - r.left - r.width / 2) / 9}deg`,
          );
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.setProperty("--tilt-x", "0deg");
          e.currentTarget.style.setProperty("--tilt-y", "0deg");
        }}
      >
        <CardFace card={card} />
        <span className="card-gloss" />
        {playable && <span className="play-dot" />}
      </button>
    </div>
  );
}
