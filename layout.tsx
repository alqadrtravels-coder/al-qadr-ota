import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Al-Qadr OTA | Operations Console",
  description: "Al-Qadr Travels & Tours online travel agency management platform.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
