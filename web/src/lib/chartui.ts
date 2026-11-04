/** The company chart's control layouts, chosen in Settings > Company page >
 *  Chart controls and synced across devices (lib/sync.ts, rs_chart_ui).
 *  a = options sheet (default), b = chip strip, c = controls under the chart,
 *  classic = every row stacked above it, as before 27-Oct-2026. */
export type ChartUi = "a" | "b" | "c" | "classic";

export function loadChartUi(): ChartUi {
  try {
    const v = localStorage.getItem("rs_chart_ui");
    return v === "b" || v === "c" || v === "classic" ? v : "a";
  } catch {
    return "a";
  }
}
