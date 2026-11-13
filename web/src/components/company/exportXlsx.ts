/** The company page's "Export to Excel": one workbook, a sheet per table. */

import { saveFile } from "@/lib/download";
import { buildXlsx, Cell, XLSX_MIME } from "@/lib/xlsx";
import { Stmt, Company } from "@/components/company/types";
import { trendToStmt, STMT_TITLES } from "@/components/company/format";

export function exportCompanyXlsx(symbol: string, company: Company) {
  // One workbook, a sheet per table - screener.in's "Export to Excel".
  const sheets: { name: string; rows: Cell[][] }[] = [];
  const sheetOf = (name: string, stmt: Stmt) => sheets.push({
    name,
    rows: [["", ...stmt.periods], ...stmt.items.map((it) => [it.parent ? `  ${it.label}` : it.label, ...it.values] as Cell[])],
  });
  sheets.push({ name: "Summary", rows: [[`${symbol} - Rscreener export`, company.generated_at], [], ...Object.entries(company.snapshot).map(([k, v]) => [k, typeof v === "number" ? v : v === null || v === undefined ? "" : String(v)] as Cell[])] });
  for (const [key, title] of Object.entries(STMT_TITLES)) {
    if (company.statements[key]) sheetOf(title, company.statements[key]);
  }
  if (company.trend?.annual) sheetOf("Track record annual", trendToStmt(company.trend.annual));
  if (company.trend?.quarterly) sheetOf("Track record quarterly", trendToStmt(company.trend.quarterly));
  if (company.shareholding && company.shareholding.dates.length > 0) {
    sheetOf("Shareholding", {
      periods: company.shareholding.dates,
      items: [
        { label: "Promoters %", values: company.shareholding.promoter },
        ...(company.shareholding.fii ? [{ label: "FIIs %", values: company.shareholding.fii }] : []),
        ...(company.shareholding.dii ? [{ label: "DIIs %", values: company.shareholding.dii }] : []),
        ...(company.shareholding.mf ? [{ label: "Mutual funds %", values: company.shareholding.mf }] : []),
        { label: "Public %", values: company.shareholding.public },
        { label: "Employee trusts %", values: company.shareholding.employee },
      ],
    });
  }
  sheets.push({ name: "Notes", rows: [["Figures from free sources (NSE / BSE filings, Yahoo); unverified until checked against the company's filing."], ["Rscreener screens; it never recommends."]] });
  void saveFile(`${symbol}_rscreener.xlsx`, buildXlsx(sheets), XLSX_MIME);
}
