"use client";

import { Suspense } from "react";
import TopNav from "@/components/TopNav";
import { SettingsScreen } from "@/components/Settings";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="settings" />
      <main className="max-w-xl mx-auto px-4 pt-6 sm:pt-10 pb-12">
        {/* Suspense because the sub-screen is chosen from the query string,
            which opts a component out of static prerendering. */}
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <SettingsScreen />
        </Suspense>
      </main>
    </div>
  );
}
