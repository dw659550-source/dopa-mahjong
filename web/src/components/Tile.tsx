"use client";

import { isRed, kindName, kindOf, type Tile as TileId } from "@dopa/shared";
import { PinFace, SouFace } from "./TileFace";

const NUM_KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONOR = ["東", "南", "西", "北", "白", "發", "中"];

export type TileSize = "xs" | "sm" | "md" | "lg";

interface Props {
  tile: TileId | null; // null = 裏向き
  aka?: boolean;
  size?: TileSize;
  sideways?: boolean;
  highlight?: "callable" | "win" | "riichi" | "selected" | "dim" | "drawn" | null;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export default function Tile({ tile, aka = true, size = "md", sideways, highlight, onClick, disabled, className }: Props) {
  const classes = ["tile", `tile-${size}`];
  if (sideways) classes.push("tile-side");
  if (highlight) classes.push(`tile-hl-${highlight}`);
  if (onClick && !disabled) classes.push("tile-clickable");
  if (disabled) classes.push("tile-disabled");
  if (className) classes.push(className);

  if (tile === null) {
    classes.push("tile-back");
    return <div className={classes.join(" ")} aria-label="裏向きの牌" />;
  }

  const kind = kindOf(tile);
  const red = isRed(tile, aka);
  let content: React.ReactNode;
  if (kind >= 27) {
    const h = HONOR[kind - 27];
    const color = kind === 32 ? "t-green" : kind === 33 ? "t-red" : kind === 31 ? "t-haku" : "t-navy";
    content = <span className={`tile-honor ${color}`}>{kind === 31 ? "" : h}</span>;
  } else if (kind >= 9) {
    // 筒子・索子は実物と同じ図柄
    const n = (kind % 9) + 1;
    content = kind < 18 ? <PinFace n={n} red={red} /> : <SouFace n={n} red={red} />;
  } else {
    const suit = Math.floor(kind / 9);
    const n = kind % 9;
    const top = suit === 0 ? NUM_KANJI[n] : String(n + 1);
    const bottom = ["萬", "筒", "索"][suit];
    const topColor = red ? "t-red" : suit === 0 ? "t-navy" : suit === 1 ? "t-blue" : "t-green";
    const bottomColor = red ? "t-red" : suit === 0 ? "t-red" : suit === 1 ? "t-blue" : "t-green";
    content = (
      <>
        <span className={`tile-num ${topColor}`}>{top}</span>
        <span className={`tile-suit ${bottomColor}`}>{bottom}</span>
      </>
    );
  }
  if (red) classes.push("tile-aka");

  const label = `${kindName(kind)}${red ? "（赤）" : ""}`;
  if (onClick) {
    return (
      <button
        type="button"
        className={classes.join(" ")}
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        data-tile={tile}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={classes.join(" ")} title={label} aria-label={label} data-tile={tile}>
      {content}
    </div>
  );
}
