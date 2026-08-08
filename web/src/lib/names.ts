/** How company names are written on screen.
 *
 *  The source is NSE's registered legal name, and it arrives in three shapes:
 *  ordinary title case, SHOUTED ("TAKE LIMITED"), and lower case ("63 moons
 *  technologies limited"). Six of 2,354 are wrong today - few, but they are the
 *  ones that look broken, and the fix has to be careful rather than blunt.
 *
 *  A plain title-case pass is the blunt version and it damages more than it
 *  repairs: it turns eClerx into Eclerx, ICICI into Icici, and L&T into L&t.
 *  So a word is only rewritten when it is uniformly one case - which is the
 *  only case where the original carries no information worth keeping.
 */

/** Words that are genuinely upper case, not shouting. */
const ACRONYMS = new Set([
  "HDFC", "ICICI", "TCS", "ITC", "NTPC", "ONGC", "GAIL", "BPCL", "HPCL", "IOC",
  "SBI", "IDFC", "IDBI", "LIC", "NMDC", "SAIL", "BHEL", "BEL", "HAL", "IRCTC",
  "RITES", "NBCC", "MTNL", "BSNL", "PNB", "IOB", "UCO", "RBL", "AU", "DCB",
  "CESC", "KEC", "NCC", "IFB", "TVS", "MRF", "CEAT", "JK", "DLF", "GMR", "GVK",
  "PVR", "TTK", "VIP", "KPIT", "LTI", "HCL", "IBM", "3M", "ABB", "BASF", "AIA",
  "PI", "UPL", "SRF", "EID", "KRBL", "LT", "AGI", "APL", "BF", "CG", "EIH",
  "GE", "GTL", "HEG", "IG", "IL&FS", "IRB", "ITD", "IVP", "JBM", "JSW", "KCP",
  "KSB", "MOIL", "NDTV", "NHPC", "NLC", "NRB", "OCCL", "PC", "PSP", "PTC",
  "RPG", "RSWM", "SBFC", "SIS", "SJVN", "SKF", "SMS", "SPML", "TCI", "TD",
  "TNPL", "UFO", "VST", "WABAG", "ZF", "USA", "UK", "UAE", "IT", "BSE", "NSE",
]);

/** Joining words that stay lower case unless they open the name. */
const SMALL = new Set(["of", "and", "the", "for", "in", "on", "at", "to", "de", "da", "van", "von"]);

function fixWord(w: string, first: boolean, shouted: boolean): string {
  if (!w) return w;
  const bare = w.replace(/[^A-Za-z&]/g, "");
  if (!bare) return w;                                   // "63", "(I)", "-"
  if (ACRONYMS.has(w.toUpperCase().replace(/[^A-Z&]/g, ""))) return w.toUpperCase();
  const letters = [...w].filter((c) => /[A-Za-z]/.test(c));
  const allUpper = letters.every((c) => c === c.toUpperCase());
  const allLower = letters.every((c) => c === c.toLowerCase());
  // Mixed case is deliberate - eClerx, McDowell, JSW - and is left untouched.
  if (!allUpper && !allLower) return w;
  // A short all-caps run inside an OTHERWISE NORMAL name is nearly always an
  // initialism - the MRF in "MRF Limited", the GMR in "GMR Airports" - so it
  // stays. That protection has to lift when the whole name is shouted, or the
  // short words survive the pass and the result is worse than either input:
  // "THE INDIA CEMENTS LIMITED" came out as "THE India Cements Limited".
  if (allUpper && !shouted && bare.length <= 4) return w;
  const lower = w.toLowerCase();
  if (!first && SMALL.has(lower)) return lower;
  return lower.replace(/^([a-z])/, (m) => m.toUpperCase());
}

/** Title case that only touches words carrying no case information of their own. */
export function titleCase(name: string): string {
  if (!name) return "";
  const letters = [...name].filter((c) => /[A-Za-z]/.test(c));
  // "Shouted" means every letter in the name is upper case, so no word in it
  // can be distinguished as a deliberate initialism.
  const shouted = letters.length > 0 && letters.every((c) => c === c.toUpperCase());
  return name
    .split(/(\s+)/)
    .map((tok, i) => (/^\s+$/.test(tok) ? tok : fixWord(tok, i === 0, shouted)))
    .join("");
}

/** "Sun Pharmaceutical Industries Limited" is a legal name, not a company name.
 *
 *  Twelve of them wrap into a grey wall that is hard to scan; the short form is
 *  what a person would actually say out loud. Lived in app/page.tsx alone, so
 *  the home page said "Sun Pharmaceutical" while every other page said "Sun
 *  Pharmaceutical Industries Limited" about the same company.
 */
export function shortName(name: string, symbol = ""): string {
  const s = titleCase(name)
    .replace(/\s*\(Formerly[^)]*\)\s*/gi, " ")
    // "India" is NOT a suffix to strip: State Bank of India, Coal India and Bank
    // of India all carry it in the actual name, and dropping it produced the
    // headline "State Bank of".
    .replace(/\b(Limited|Ltd\.?|Corporation|Corp\.?|Company|Industries|Enterprises)\b/gi, " ")
    .replace(/[.,]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A name left dangling on a joining word means the trim cut into it
  const dangling = /\b(of|and|the|&|for|de)$/i.test(s);
  return s.length >= 3 && !dangling ? s : (titleCase(name) || symbol);
}

/** The full registered name, cleaned but not shortened - for page headings. */
export function fullName(name: string, symbol = ""): string {
  return titleCase(name || "") || symbol;
}
