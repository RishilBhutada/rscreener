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

/** `icon` is SVG path data on a 24-unit grid, drawn as a 1.75 stroke. */
export const DESTINATIONS: { key: string; label: string; href: string; icon: string }[] = [
  { key: "home", label: "Home", href: "/",
    icon: "M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" },
  { key: "watchlists", label: "Lists", href: "/watchlists",
    icon: "M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" },
  { key: "screens", label: "Screener", href: "/screens",
    icon: "M4.5 5.5h15l-5.8 7v5.3l-3.4 1.7v-7z" },
  { key: "portfolio", label: "Portfolio", href: "/portfolio",
    icon: "M11 4.6A7.6 7.6 0 1 0 19.4 13H11zM14 3.9A7.4 7.4 0 0 1 20.1 10H14z" },
  // IPOs, important outside data and celebrity-investor portfolios: links to
  // other sites, kept together and apart from this app's own checked data.
  { key: "others", label: "Others", href: "/others",
    icon: "M7 4.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5zM17 4.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5zM7 14.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5zM17 14.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z" },
  { key: "sectors", label: "Sectors", href: "/sectors",
    icon: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" },
  { key: "calendar", label: "Calendar", href: "/calendar",
    icon: "M5.5 6h13A1.5 1.5 0 0 1 20 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6zM4 10.5h16M8.5 4v4M15.5 4v4" },
  { key: "status", label: "Data", href: "/status",
    icon: "M3 12.5h4l2.5-6 5 11 2.5-5H21" },
];
