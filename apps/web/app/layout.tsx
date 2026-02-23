import "./globals.css";
import type { ReactNode } from "react";
import { NavBar } from "../components/nav-bar";

export const metadata = {
  title: "Numen",
  description: "Your Health on Autopilot",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#0a0a0b" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
