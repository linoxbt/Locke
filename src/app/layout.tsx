import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
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
  title: "Locke — Protection plans on Strike",
  description: "Protect what your business holds. Manage what it needs to buy. Hedges on Strike, sized and watched for you.",
  openGraph: { title: "Locke", description: "Protect what your business holds. Manage what it needs to buy." },
};

export const viewport: Viewport = { themeColor: "#f2f1ee", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await optionalSession();
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${jetbrains.variable}`}>
      <head>
        <noscript>
          {/* Without JavaScript nothing waits to animate in. */}
          <style>{`[data-drop] > * { opacity: 1 !important; } .replay-clip { transform: none !important; }`}</style>
        </noscript>
      </head>
      <body className="min-h-dvh">
        <WalletProvider initialAddress={session?.addr ?? null}>
          <Header />
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
