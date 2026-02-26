"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
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
  { href: "/", label: "Today" },
  { href: "/prep-plan", label: "Prep Plan" },
  { href: "/pantry", label: "Pantry" },
  { href: "/kitchen-clients", label: "Clients" },
] as const;

const SCIENCE_NAV = [
  { href: "/", label: "Data Quality" },
  { href: "/clients-health", label: "Clients" },
  { href: "/audit-labels", label: "Audit" },
  { href: "/ops", label: "Ops Tower" },
] as const;

export function NavBar() {
  const pathname = usePathname();
  const { mode, isLoaded, setMode } = useMode();
  const [health, setHealth] = useState<HealthStatus>("offline");
  const [mobileOpen, setMobileOpen] = useState(false);

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

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);

  const dotColor = health === "connected" ? "green" : health === "degraded" ? "amber" : "red";
  const statusLabel =
    health === "connected" ? "API Connected" : health === "degraded" ? "API Degraded" : "API Offline";

  // Don't render nav until mode is loaded from localStorage
  if (!isLoaded) return null;
  // Don't render nav when no mode selected (mode picker screen)
  if (!mode) return null;

  const navLinks = mode === "kitchen" ? KITCHEN_NAV : SCIENCE_NAV;

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
            <button
              className="mobile-menu-btn"
              onClick={toggleMobile}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? "\u2715" : "\u2630"}
            </button>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 98 }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={`mobile-menu ${mobileOpen ? "open" : ""}`}>
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href as any}
            data-active={isActive(link.href) ? "true" : undefined}
          >
            {link.label}
          </Link>
        ))}
        <hr style={{ border: "none", borderTop: "1px solid var(--c-border)", margin: "var(--sp-2) 0" }} />
        <Link href={"/upload" as any}>Import Data</Link>
      </div>
    </>
  );
}
