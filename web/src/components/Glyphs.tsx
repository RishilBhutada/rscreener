/** Small drawn icons for places that used text characters (★ ✓ ▾ ▸ ↗ ×).
 *  A character renders in whatever font the phone has - the star came out as
 *  an emoji on some, a thin outline on others - and sits off the text
 *  baseline. These are the same size and weight everywhere. */

type P = { className?: string; size?: number };

const base = (size: number, className: string) => ({
  viewBox: "0 0 24 24", width: size, height: size, className: `inline-block align-[-0.15em] ${className}`,
  fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function StarGlyph({ filled = false, size = 16, className = "" }: P & { filled?: boolean }) {
  return (
    <svg {...base(size, className)} fill={filled ? "currentColor" : "none"}>
      <path d="M12 3.6l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
    </svg>
  );
}

export function CheckGlyph({ size = 12, className = "" }: P) {
  return <svg {...base(size, className)} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7" /></svg>;
}

export function ChevronGlyph({ dir = "down", size = 12, className = "" }: P & { dir?: "down" | "right" }) {
  return <svg {...base(size, className)} strokeWidth={2.4}><path d={dir === "down" ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} /></svg>;
}

export function ExternalGlyph({ size = 12, className = "" }: P) {
  return <svg {...base(size, className)}><path d="M14 5h5v5M19 5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></svg>;
}

export function CloseGlyph({ size = 14, className = "" }: P) {
  return <svg {...base(size, className)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
}
