import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Locke — Protection plans on Strike",
  description: "Protect what your business holds. Manage what it needs to buy.",
};

export const viewport: Viewport = { themeColor: "#07090a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">
        <WalletProvider>
          <Header />
          <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
