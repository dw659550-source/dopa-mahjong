"use client";

import { useEffect } from "react";
import { CANONICAL_HOST, shouldRedirectHost } from "@/lib/canonicalHost";

/** サーバー側の切り替えをすり抜けた場合に備え、ブラウザ側でも公開用URLへ切り替える */
export default function CanonicalHostRedirect() {
  useEffect(() => {
    const { host, pathname, search, hash } = window.location;
    if (shouldRedirectHost(host)) {
      window.location.replace(`https://${CANONICAL_HOST}${pathname}${search}${hash}`);
    }
  }, []);
  return null;
}
