"use client";

import { useState } from "react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-bold text-dp-accent">{title}</h3>
      <div className="text-sm leading-relaxed flex flex-col gap-1">{children}</div>
    </section>
  );
}

/** 基本の遊び方（ロビーに常に表示する部分） */
export function HowToPlayBasics() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed">
        <span className="font-bold">手番のないリアルタイム麻雀</span>
        です。4人が同時にツモ・打牌を進め、鳴きと和了は<span className="font-bold">早い者勝ち</span>
        で決まります。
      </p>
      <ol className="text-sm leading-relaxed list-decimal list-inside flex flex-col gap-1">
        <li>牌をタップして捨てると、すぐに次の牌をツモります。山は4人で共有しています。</li>
        <li>ツモから10秒以内に捨てないと、自動でツモ切りになります（残り時間は手牌の上のバーで表示）。</li>
        <li>
          鳴けるのは、各プレイヤーの<span className="font-bold">最新の捨て牌1枚</span>
          だけ（光っている牌）。その人が次の牌を捨てると鳴けなくなります。ポン・カンは誰からでも、チーは上家からのみ。
        </li>
        <li>ロン・ポン・チーに優先順位はありません。ボタンを先に押した人が成立します。</li>
        <li>役は1飜縛り。点数計算やルールは天鳳の段位戦（4人打ち）とほぼ同じです。</li>
      </ol>
    </div>
  );
}

/** くわしいルール */
export function HowToPlayDetails() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="ツモと打牌">
        <p>・配牌後、全員が同時に第1ツモを受け取ってスタート。親・席順は点数計算・連荘・チーの上家判定に使います。</p>
        <p>・ツモは早い者勝ちで山から配られます。打牌が速い人ほど多くツモれます。</p>
        <p>・立直後は、ツモから1.5秒で自動ツモ切り（その間にツモ和了・暗槓ができます）。</p>
      </Section>
      <Section title="鳴き">
        <p>・鳴くと、手元にある未使用のツモ牌は山の先頭に戻ります。そこから1枚捨てると、すぐ次のツモが来ます。</p>
        <p>・喰い替えはできません。暗槓・加槓は自分のツモ後に行い、嶺上牌をツモってから捨てます。</p>
        <p>・加槓した牌は、加槓した人が嶺上ツモの後に捨てるまで槍槓できます。</p>
      </Section>
      <Section title="和了（ロン・ツモ）">
        <p>・ロン：他家の最新の捨て牌（または加槓牌）に対して、その人が次に捨てるまで宣言できます。</p>
        <p>・ツモ：ツモ直後、捨てる前に宣言します。</p>
        <p>
          ・<span className="font-bold">自動和了</span>
          （初期設定はON）では、和了できる形になった瞬間に自動で和了します。同時に2人が自動和了するとダブロン、3人なら三家和（流局）です。
        </p>
        <p>・ダブロンの積み棒・供託は、放銃者の下家から数えて先に来る人が受け取ります。</p>
      </Section>
      <Section title="フリテン">
        <p>・自分の河（鳴かれた牌も含む）に当たり牌があるとロンできません。</p>
        <p>・当たり牌を見逃すと、捨てた人が次の牌を捨てた時点でフリテンになり、自分がツモした後の打牌で解消します。</p>
        <p>・立直後の見逃しは、その局の終わりまでフリテンです。</p>
      </Section>
      <Section title="山がなくなったら">
        <p>・山が尽きると鳴きはできません。まだ捨てていない人は最後の1枚を捨て（ツモ和了も可）、全員が捨て終わって3秒後に流局します。</p>
        <p>・河底撈魚は、その局の最後の打牌へのロン。海底摸月は山の最後の1枚でのツモ和了です。</p>
      </Section>
      <Section title="巡目に関係する役">
        <p>・一発：立直の宣言後、次にツモした牌を捨てるまでに和了すれば成立。その間に誰かが鳴くと消えます。</p>
        <p>・両立直・天和・地和・九種九牌：各プレイヤーの第1ツモが対象です。</p>
        <p>・四風連打：4人の第1打牌がすべて同じ風牌。四家立直：4人目の立直宣言牌が通過した時点で流局。</p>
      </Section>
      <Section title="補助ボタン">
        <p>・自動和了（初期設定はON）：和了できる形になったら、ほかのどの操作よりも優先して自動で和了します（接続が切れている間も働きます）。見逃したいときはOFFにしてください。</p>
        <p>・鳴かない：ポン・チー・カンのボタンを出しません。局が始まるたびに自動で解除されます。</p>
        <p>・ツモ切り：ツモから1.5秒で自動ツモ切り。ツモ和了・ロン・暗槓・加槓・立直はできます。</p>
      </Section>
      <Section title="点数・終了">
        <p>・25000点持ち30000点返し、ウマ10-20、オカはトップ。最終得点は小数のまま（四捨五入しない）。</p>
        <p>・東風戦は南入あり、東南戦は西入あり。延長戦は誰かが30000点以上で終了（上限は東風戦が南4局、東南戦が西4局）。</p>
        <p>・オーラスで親がトップかつ30000点以上なら和了止め・聴牌止め。持ち点がマイナスになったら飛び終了。</p>
        <p>・赤ドラ・喰い断は、ルーム作成時に「あり／なし」を選べます（初期値はどちらもあり）。</p>
      </Section>
      <Section title="切断したとき">
        <p>・切断中は自動ツモ切りで対局が続きます。同じ名前で入り直せば、何度でも再入場できます。</p>
      </Section>
    </div>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="card w-full max-w-lg max-h-[88vh] overflow-y-auto p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">遊び方</h2>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="w-8 h-8 rounded-full bg-dp-panel2 flex items-center justify-center text-dp-muted"
          >
            ✕
          </button>
        </div>
        <HowToPlayBasics />
        <hr className="border-dp-muted/20" />
        <HowToPlayDetails />
      </div>
    </div>
  );
}

export default function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="遊び方を見る"
        className="fixed bottom-3 right-16 z-40 w-11 h-11 rounded-full bg-dp-accent text-black font-black text-lg shadow-lg flex items-center justify-center active:scale-95 transition"
      >
        ？
      </button>
      {open && <HelpModal onClose={() => setOpen(false)} />}
    </>
  );
}
