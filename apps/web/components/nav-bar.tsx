"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useMode } from "./mode-provider";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("onrender.com")) {
      return `${window.location.protocol}//${host.replace("-web", "-api")}`;
    }
    return `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
}

type HealthStatus = "connected" | "degraded" | "offline";

const KITCHEN_NAV = [
  { href: "/", label: "Today", icon: "calendar" },
  { href: "/prep-plan", label: "Prep Plan", icon: "clipboard" },
  { href: "/pantry", label: "Pantry", icon: "box" },
  { href: "/kitchen-clients", label: "Clients", icon: "person" },
] as const;

const SCIENCE_NAV = [
  { href: "/", label: "Dashboard", icon: "chart" },
  { href: "/clients-health", label: "Profile", icon: "person" },
  { href: "/audit-labels", label: "Audit", icon: "shield" },
  { href: "/ops", label: "Ops Tower", icon: "gauge" },
] as const;

const DELIVERY_NAV = [
  { href: "/", label: "Today", icon: "truck" },
  { href: "/packing", label: "Packing", icon: "package" },
  { href: "/routes", label: "Routes", icon: "route" },
  { href: "/delivery-clients", label: "Clients", icon: "person" },
] as const;

type IconName = "calendar" | "clipboard" | "box" | "person" | "chart" | "shield" | "gauge" | "truck" | "package" | "route";

function TabIcon({ name }: { name: IconName }) {
  const props = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (name) {
    case "calendar":
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "clipboard":
      return <svg {...props}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>;
    case "box":
      return <svg {...props}><path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
    case "person":
      return <svg {...props}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case "chart":
      return <svg {...props}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
    case "shield":
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case "gauge":
      return <svg {...props}><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 6v6l4 2"/></svg>;
    case "truck":
      return <svg {...props}><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3a1 1 0 01-1 1h-1"/><path d="M16 17h-8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
    case "package":
      return <svg {...props}><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
    case "route":
      return <svg {...props}><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 000-7h-11a3.5 3.5 0 010-7H15"/><circle cx="18" cy="5" r="3"/></svg>;
  }
}

export function NavBar() {
  const pathname = usePathname();
  const { mode, isLoaded, setMode } = useMode();
  const [health, setHealth] = useState<HealthStatus>("offline");

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${resolveApiBase()}/v1/health`, { cache: "no-store" });
        setHealth(res.ok ? "connected" : "degraded");
      } catch {
        setHealth("offline");
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const dotColor = health === "connected" ? "green" : health === "degraded" ? "amber" : "red";
  const statusLabel =
    health === "connected" ? "API Connected" : health === "degraded" ? "API Degraded" : "API Offline";

  // Don't render nav until mode is loaded from localStorage
  if (!isLoaded) return null;
  // Don't render nav when no mode selected (mode picker screen)
  if (!mode) return null;

  const navLinks = mode === "kitchen" ? KITCHEN_NAV : mode === "delivery" ? DELIVERY_NAV : SCIENCE_NAV;

  const isActive = (href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  return (
    <>
      <nav className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="topnav-brand">
            <span>Numen</span>
          </Link>

          {/* Mode pill */}
          <div className="mode-pill">
            <button
              className={`mode-pill-option ${mode === "kitchen" ? "active kitchen" : ""}`}
              onClick={() => setMode("kitchen")}
            >
              Kitchen
            </button>
            <button
              className={`mode-pill-option ${mode === "science" ? "active science" : ""}`}
              onClick={() => setMode("science")}
            >
              Science
            </button>
            <button
              className={`mode-pill-option ${mode === "delivery" ? "active delivery" : ""}`}
              onClick={() => setMode("delivery")}
            >
              Delivery
            </button>
          </div>

          <div className="topnav-links">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href as any}
                className="topnav-link"
                data-active={isActive(link.href) ? "true" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="topnav-right">
            <Link href={"/upload" as any} className="topnav-link topnav-import" title="Import Data">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v8m0 0L5 7m3 3l3-3" />
                <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
              </svg>
            </Link>
            <div className="topnav-status">
              <span className={`status-dot ${dotColor}`} />
              <span className="status-text">{statusLabel}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Bottom tab bar — visible on mobile only via CSS */}
      <nav className="bottom-tabs" data-mode={mode}>
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href as any}
            className="bottom-tab"
            data-active={isActive(link.href) ? "true" : undefined}
          >
            <TabIcon name={link.icon} />
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
