"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

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

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/schedule", label: "Schedule" },
  { href: "/calendar", label: "Calendar" },
  { href: "/verification", label: "Verification" },
  { href: "/upload", label: "Import" },
] as const;

export function NavBar() {
  const pathname = usePathname();
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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);

  const dotColor = health === "connected" ? "green" : health === "degraded" ? "amber" : "red";
  const statusLabel =
    health === "connected" ? "API Connected" : health === "degraded" ? "API Degraded" : "API Offline";
  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/schedule" && pathname?.startsWith("/schedule")) return true;
    if (href === "/calendar" && pathname?.startsWith("/clients/")) return true;
    if (href === "/verification" && pathname?.startsWith("/verification")) return true;
    return false;
  };

  return (
    <>
      <nav className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="topnav-brand">
            <span>Numen</span>
          </Link>

          <div className="topnav-links">
            {NAV_LINKS.map((link) => (
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
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href as any}
            data-active={isActive(link.href) ? "true" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </>
  );
}
