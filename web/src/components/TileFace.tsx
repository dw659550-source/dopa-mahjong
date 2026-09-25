// 筒子・索子の図柄（実物の麻雀牌と同じ並び方をSVGで描く）
// 座標は幅30×高さ42の枠を基準にしている。

const W = 30;
const H = 42;

const BLUE = "#1f4fa8";
const GREEN = "#12804a";
const RED = "#d3262e";

type Dot = [x: number, y: number, color: string];

// ---------------------------------------------------------------- 筒子

function pinLayout(n: number): { r: number; dots: Dot[] } {
  const B = BLUE;
  const G = GREEN;
  const R = RED;
  switch (n) {
    case 1:
      return { r: 12, dots: [[15, 21, "multi"]] };
    case 2:
      return { r: 7.2, dots: [[15, 11, G], [15, 31, B]] };
    case 3:
      return { r: 6, dots: [[7.5, 8.5, B], [15, 21, R], [22.5, 33.5, G]] };
    case 4:
      return { r: 6.2, dots: [[8.5, 11, B], [21.5, 11, G], [8.5, 31, G], [21.5, 31, B]] };
    case 5:
      return { r: 5.2, dots: [[7.5, 8.5, B], [22.5, 8.5, G], [15, 21, R], [7.5, 33.5, G], [22.5, 33.5, B]] };
    case 6:
      return {
        r: 4.6,
        dots: [[9, 7, G], [21, 7, G], [9, 21, R], [21, 21, R], [9, 33.5, R], [21, 33.5, R]],
      };
    case 7:
      return {
        r: 4,
        dots: [[6.5, 5.5, G], [15, 9.5, G], [23.5, 13.5, G], [9, 25, R], [21, 25, R], [9, 35.5, R], [21, 35.5, R]],
      };
    case 8:
      return {
        r: 4,
        dots: [5.5, 15.5, 26.5, 36.5].flatMap((y) => [[9, y, B] as Dot, [21, y, B] as Dot]),
      };
    default:
      return {
        r: 4,
        dots: [7.5, 21, 34.5].flatMap((y, row) =>
          [6, 15, 24].map((x) => [x, y, row === 1 ? R : B] as Dot),
        ),
      };
  }
}

function PinDot({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  if (color === "multi") {
    // 一筒は大きな飾り丸
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill="none" stroke={GREEN} strokeWidth={2.2} />
        <circle cx={x} cy={y} r={r * 0.72} fill="none" stroke={BLUE} strokeWidth={1.6} strokeDasharray="2 1.6" />
        <circle cx={x} cy={y} r={r * 0.45} fill={RED} />
        <circle cx={x} cy={y} r={r * 0.18} fill="#fffdf6" />
      </g>
    );
  }
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={Math.max(1.1, r * 0.3)} />
      <circle cx={x} cy={y} r={r * 0.38} fill={color} />
    </g>
  );
}

export function PinFace({ n, red }: { n: number; red: boolean }) {
  const { r, dots } = pinLayout(n);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tile-svg" aria-hidden>
      {dots.map(([x, y, c], i) => (
        <PinDot key={i} x={x} y={y} r={r} color={red && c !== "multi" ? RED : c} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- 索子

type Stick = [x: number, y: number, color: string, angle?: number];

const SH = 11; // 竹1本の長さ
const SW = 4.2; // 竹1本の太さ

function souLayout(n: number): Stick[] {
  const G = GREEN;
  const R = RED;
  const top = 9;
  const bottom = 30;
  const mid = 21;
  switch (n) {
    case 2:
      return [[15, 13, G], [15, 29, G]];
    case 3:
      return [[15, 12, G], [9.5, 30, G], [20.5, 30, G]];
    case 4:
      return [[9.5, 12, G], [20.5, 12, G], [9.5, 30, G], [20.5, 30, G]];
    case 5:
      return [[7, 10, G], [23, 10, G], [15, mid, R], [7, 32, G], [23, 32, G]];
    case 6:
      return [6.5, 15, 23.5].flatMap((x) => [[x, 12, G] as Stick, [x, 30, G] as Stick]);
    case 7:
      return [[15, 7, R], ...[6.5, 15, 23.5].flatMap((x) => [[x, 21, G] as Stick, [x, 34, G] as Stick])];
    case 8:
      // M字とW字の並び
      return [
        [5, top + 3, G],
        [11.5, top + 3, G, 28],
        [18.5, top + 3, G, -28],
        [25, top + 3, G],
        [5, bottom, G],
        [11.5, bottom, G, -28],
        [18.5, bottom, G, 28],
        [25, bottom, G],
      ];
    default:
      return [7, 21, 35].flatMap((y) => [6, 15, 24].map((x, col) => [x, y, col === 1 ? R : G] as Stick));
  }
}

function StickShape({ x, y, color, angle = 0, len }: { x: number; y: number; color: string; angle?: number; len: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <rect x={-SW / 2} y={-len / 2} width={SW} height={len} rx={SW / 2} fill={color} />
      <line x1={-SW / 2} x2={SW / 2} y1={0} y2={0} stroke="#fffdf6" strokeWidth={0.8} />
      <line x1={0} x2={0} y1={-len / 2 + 1.2} y2={len / 2 - 1.2} stroke="#fffdf6" strokeWidth={0.55} opacity={0.7} />
    </g>
  );
}

/** 一索は鳥（孔雀）の図柄 */
function Bird({ red }: { red: boolean }) {
  const body = red ? RED : GREEN;
  return (
    <g>
      {/* 尾羽 */}
      <path d="M15 24 C 7 30, 5 36, 7 40 C 11 36, 13 32, 15 28 C 17 32, 19 36, 23 40 C 25 36, 23 30, 15 24 Z" fill={body} />
      <circle cx={10} cy={36} r={1.4} fill={RED} />
      <circle cx={20} cy={36} r={1.4} fill={RED} />
      {/* 胴体 */}
      <ellipse cx={15} cy={19} rx={6.5} ry={7.5} fill={body} />
      <path d="M11 17 C 13 22, 17 22, 19 17" stroke={BLUE} strokeWidth={1.3} fill="none" />
      {/* 首と頭 */}
      <path d="M13 13 C 12 8, 14 4.5, 17 4.5 C 19.5 4.5, 20 7, 18.5 8.5 C 17 10, 16.5 11, 17 13 Z" fill={body} />
      <circle cx={17.6} cy={6.6} r={0.9} fill="#fffdf6" />
      <path d="M19.8 6.8 L 23 7.8 L 19.6 8.4 Z" fill={RED} />
      <path d="M16 4.6 C 15.5 2.5, 17 1.8, 17.5 3.2" stroke={RED} strokeWidth={1} fill="none" />
    </g>
  );
}

export function SouFace({ n, red }: { n: number; red: boolean }) {
  if (n === 1) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="tile-svg" aria-hidden>
        <Bird red={red} />
      </svg>
    );
  }
  const sticks = souLayout(n);
  const len = n >= 7 ? SH * 0.95 : n >= 5 ? SH * 1.15 : SH * 1.35;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tile-svg" aria-hidden>
      {sticks.map(([x, y, c, a], i) => (
        <StickShape key={i} x={x} y={y} color={red ? RED : c} angle={a} len={len} />
      ))}
    </svg>
  );
}
