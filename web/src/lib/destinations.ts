/** Every destination the phone nav can reach, in its default order.
 *
 *  One list, not a "primary" four and a "secondary" four, because the split
 *  between them is now the reader's to make: the first BAR_SLOTS entries after
 *  their chosen order sit in the bottom bar and the rest fall into More. The
 *  old split was a guess about which four somebody goes to mid-task, and it was
 *  a reasonable guess that was wrong for anybody who never opens a portfolio
 *  and checks the results calendar every morning.
 *
 *  Exported so Settings can offer the same list in the same order without
 *  keeping its own copy to fall out of step.
 */
export const BAR_SLOTS = 4;   // plus More, making five cells on a 375px screen

export const DESTINATIONS: { key: string; label: string; href: string; icon: string }[] = [
  { key: "home", label: "Home", href: "/", icon: "⌂" },
  { key: "watchlists", label: "Lists", href: "/watchlists", icon: "★" },
  { key: "screens", label: "Screener", href: "/screens", icon: "≡" },
  { key: "portfolio", label: "Portfolio", href: "/portfolio", icon: "◑" },
  { key: "sectors", label: "Sectors", href: "/sectors", icon: "◧" },
  { key: "calendar", label: "Calendar", href: "/calendar", icon: "▤" },
  { key: "ipo", label: "IPO", href: "/ipo", icon: "◆" },
  { key: "status", label: "Data", href: "/status", icon: "◍" },
];
