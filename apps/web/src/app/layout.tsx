import type { Metadata } from "next";
import { Web3Provider } from "@/providers/Web3Provider";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "ChainQuant",
  description: "Web3 Quant Trading Decision Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="bg-oo-bg">
      <body className="min-h-screen bg-oo-bg font-sans text-oo-text antialiased">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
