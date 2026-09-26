import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const interSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rscreener — NSE & BSE stock screener",
  description: "Personal zero-cost fundamentals screener for NSE-listed companies",
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/manifest.json`,
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon-192.png` },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

const themeInit = `(function(){try{var t=localStorage.getItem("rs_theme")||"system";var d=document.documentElement;var dark=t==="dark"||t==="black"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=dark?"dark":"light";if(t==="black")d.dataset.shade="black";var tc=t==="black"?"#000000":dark?"#0b1017":"#f5f6f8";document.addEventListener("DOMContentLoaded",function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",tc);});d.dataset.accent=localStorage.getItem("rs_accent")||"indigo";}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-accent="indigo"
      className={`${interSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
