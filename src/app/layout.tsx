import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { CookieConsent } from "@/components/CookieConsent";
import { Header } from "@/components/Header";
import { WalletProvider } from "@/components/WalletProvider";
import { optionalSession } from "@/lib/server/pageAuth";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-inter-tight" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  // Netlify sets URL at build time; social images need an absolute base.
  metadataBase: new URL(process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Locke — Protection plans on Strike and Base",
  description: "Protect what your business holds. Manage what it buys. Hedges on Strike (Cardano) and Base, sized and watched for you.",
  openGraph: { title: "Locke", description: "Protect what your business holds. Manage what it needs to buy." },
};

export const viewport: Viewport = { themeColor: "#f2f1ee", width: "device-width", initialScale: 1 };

// Netlify's CDN inserts "\n<!-- This site is hosted on Netlify ... -->" after <meta charset>. React
// renders no comments or whitespace in <head>, so those nodes break hydration of the whole page
// (React error #418). This runs while <head> is parsed, before the webpack runtime at the end of
// <body> can start React, and removes comment and blank text nodes that aren't React's.
const STRIP_INJECTED_HEAD_NODES = `(function(){var h=document.head,n=h.firstChild,x;while(n){x=n.nextSibling;if(n.nodeType===8||(n.nodeType===3&&!/\\S/.test(n.nodeValue)))h.removeChild(n);n=x}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await optionalSession();
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_INJECTED_HEAD_NODES }} />
        <noscript>
          {/* Without JavaScript nothing waits to animate in. */}
          <style>{`[data-drop] > *, [data-fall] .fall { opacity: 1 !important; } .replay-clip { transform: none !important; }`}</style>
        </noscript>
      </head>
      <body className="min-h-dvh">
        <WalletProvider initialAddress={session?.addr ?? null}>
          <Header />
          <main>{children}</main>
          <CookieConsent />
        </WalletProvider>
      </body>
    </html>
  );
}
