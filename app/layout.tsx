import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../src/index.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sentinel API - Structured Intelligence Gateway",
  description: "API-first AI intelligence platform translating unstructured public sources into validated JSON schemas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-[#07070a] text-gray-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}
