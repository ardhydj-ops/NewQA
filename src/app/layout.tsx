import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Resource Manager",
  description: "Capacity and allocation tracking for QA teams",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
