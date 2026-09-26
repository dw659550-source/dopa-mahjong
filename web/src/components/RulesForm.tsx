"use client";

import { GAME_LENGTH_LABEL, type CpuLevel, type Rules } from "@dopa/shared";

export const CPU_LEVEL_LABEL: Record<CpuLevel, string> = { weak: "弱い", normal: "普通", strong: "強い" };

function Toggle<T extends string | boolean | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={value === o.v ? "chip-on" : "chip-off"}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function RulesForm({
  rules,
  onChange,
  disabled,
  showCpu = true,
}: {
  rules: Rules;
  onChange: (r: Rules) => void;
  disabled?: boolean;
  showCpu?: boolean;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center text-sm">
      <span className="text-dp-muted">人数</span>
      <Toggle
        value={rules.players === 3 ? 3 : 4}
        disabled={disabled}
        options={[
          { v: 4, label: "四人麻雀" },
          { v: 3, label: "三人麻雀" },
        ]}
        onChange={(v) => onChange({ ...rules, players: v as 3 | 4 })}
      />
      <span className="text-dp-muted">対局</span>
      <Toggle
        value={rules.length}
        disabled={disabled}
        options={(["tonpu", "hanchan", "issou"] as const).map((v) => ({ v, label: GAME_LENGTH_LABEL[v] }))}
        onChange={(v) => onChange({ ...rules, length: v })}
      />
      <span className="text-dp-muted">喰い断</span>
      <Toggle
        value={rules.kuitan}
        disabled={disabled}
        options={[
          { v: true, label: "あり" },
          { v: false, label: "なし" },
        ]}
        onChange={(v) => onChange({ ...rules, kuitan: v })}
      />
      <span className="text-dp-muted">赤ドラ</span>
      <Toggle
        value={rules.aka}
        disabled={disabled}
        options={[
          { v: true, label: "あり" },
          { v: false, label: "なし" },
        ]}
        onChange={(v) => onChange({ ...rules, aka: v })}
      />
      {showCpu && (
        <>
          <span className="text-dp-muted">CPUの強さ</span>
          <Toggle
            value={rules.cpuLevel}
            disabled={disabled}
            options={(["weak", "normal", "strong"] as const).map((v) => ({ v, label: CPU_LEVEL_LABEL[v] }))}
            onChange={(v) => onChange({ ...rules, cpuLevel: v })}
          />
        </>
      )}
    </div>
  );
}

export function rulesText(r: Rules): string {
  return [
    ...(r.players === 3 ? ["三人麻雀"] : []),
    GAME_LENGTH_LABEL[r.length] ?? r.length,
    `喰い断${r.kuitan ? "あり" : "なし"}`,
    `赤ドラ${r.aka ? "あり" : "なし"}`,
  ].join("・");
}
