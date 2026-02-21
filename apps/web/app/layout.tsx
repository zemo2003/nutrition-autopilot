import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Nutrition Autopilot",
  description: "Database-first nutrition operations"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
