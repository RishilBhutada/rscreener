"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import FullChart from "@/components/FullChart";

function Inner() {
  const symbol = (useSearchParams().get("s") ?? "").toUpperCase();
  return <FullChart symbol={symbol} />;
}

/** /chart?s=SYMBOL - the full-screen chart. No header and no bottom bar: the
 *  chart has the whole screen, with its own back arrow. */
export default function ChartPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[var(--bg)]" />}>
      <Inner />
    </Suspense>
  );
}
