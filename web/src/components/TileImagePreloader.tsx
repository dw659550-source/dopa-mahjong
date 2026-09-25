"use client";

import { useEffect } from "react";
import { allTileImageSrcs } from "./Tile";

/** ページを開いた時点で、すべての牌画像を先に読み込んでおく（対局中に牌が出るたびの読み込みを防ぐ） */
const kept: HTMLImageElement[] = [];

export default function TileImagePreloader() {
  useEffect(() => {
    if (kept.length > 0) return;
    for (const src of allTileImageSrcs()) {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      kept.push(img); // 参照を保持して、読み込み済みの画像がすぐ捨てられないようにする
    }
  }, []);
  return null;
}
