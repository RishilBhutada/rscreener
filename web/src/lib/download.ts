/** Saving a file the page made - the CSV exports - wherever the page is running.
 *
 *  Both exports used to build a blob link and click it. A browser downloads
 *  that; the Android app does not. It is a Capacitor shell around the live
 *  site, and Android's WebView ignores a download it has no handler for - the
 *  button did nothing at all. The app now carries a small native plugin
 *  ("RsDownloads", android/app/.../DownloadsPlugin.java) that writes the file
 *  to the phone's Downloads folder, and this asks it first.
 *
 *  An iPhone home-screen app has no download manager either: it gets the share
 *  sheet, which has "Save to Files". Everywhere else, the link - now attached
 *  to the page while it is clicked and released a minute later, not at once:
 *  some browsers read the file after click() has returned, and revoking it
 *  straight away cancelled their download. */

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options: object) => Promise<unknown>;
};

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A line at the foot of the screen for three seconds. */
function note(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.setAttribute("role", "status");
  el.style.cssText = "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;max-width:calc(100% - 32px);"
    + "padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.35;background:var(--ink);color:var(--bg);"
    + "box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:center";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export async function saveFile(name: string, text: string, mime = "text/csv;charset=utf-8"): Promise<void> {
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  if (cap?.isNativePlatform?.() && cap.nativePromise) {
    try {
      await cap.nativePromise("RsDownloads", "save", { name, mime: mime.split(";")[0], data: base64(text) });
      note(`Saved to Downloads: ${name}`);
    } catch {
      // An app installed before the plugin existed: nothing on this side can
      // make its WebView download, so say what will.
      note("This version of the app cannot save files. Install the latest app, or open Rscreener in your browser.");
    }
    return;
  }
  const file = new File([text], name, { type: mime });
  const nav = navigator as Navigator & { standalone?: boolean };
  const homeScreen = window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
  if (homeScreen && /iPhone|iPad|iPod/.test(nav.userAgent) && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file] }); } catch { /* the sheet was closed */ }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
