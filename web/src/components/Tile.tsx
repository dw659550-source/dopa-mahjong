"use client";

import { isRed, kindName, kindOf, type Kind, type Tile as TileId } from "@dopa/shared";

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

/**
 * 牌画像のパス（web/public/tiles/）。
 * m=萬子 p=筒子 s=索子（1〜9、e=赤5）、j=字牌（1東 2南 3西 4北 5白 6發 7中）。
 * 先頭に「2」が付いたものは横向き（鳴いた牌・立直宣言牌）。
 */
export function tileImageSrc(kind: Kind, red: boolean, sideways: boolean): string {
  const name = kind >= 27 ? `j${kind - 26}` : `${"mps"[Math.floor(kind / 9)]}${red ? "e" : (kind % 9) + 1}`;
  return `/tiles/${sideways ? "2" : ""}${name}.png`;
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
  classes.push("tile-img");
  const label = `${kindName(kind)}${red ? "（赤）" : ""}`;
  // eslint-disable-next-line @next/next/no-img-element
  const content = <img src={tileImageSrc(kind, red, !!sideways)} alt={label} draggable={false} className="tile-img-el" />;

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
