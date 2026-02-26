"use client";

import { useMode, type AppMode } from "./mode-provider";

export function ModePicker() {
  const { setMode } = useMode();

  const pick = (m: AppMode) => () => setMode(m);

  return (
    <div className="mode-picker-backdrop">
      <div className="mode-picker">
        <div className="mode-picker-header">
          <h1 className="mode-picker-title">Numen</h1>
          <p className="mode-picker-subtitle">Choose your workspace</p>
        </div>

        <div className="mode-picker-cards">
          <button className="mode-card mode-card-kitchen" onClick={pick("kitchen")}>
            <div className="mode-card-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6v14c0 3.3 2.7 6 6 6h0c3.3 0 6-2.7 6-6V6" />
                <line x1="18" y1="6" x2="18" y2="20" />
                <path d="M30 6v8c0 4.4 2.7 8 6 8h0V6" />
                <line x1="12" y1="42" x2="12" y2="26" />
                <line x1="36" y1="42" x2="36" y2="22" />
              </svg>
            </div>
            <h2 className="mode-card-title">Kitchen Mode</h2>
            <p className="mode-card-desc">Prep. Cook. Serve.</p>
            <span className="mode-card-cta">Enter Kitchen &rarr;</span>
          </button>

          <button className="mode-card mode-card-science" onClick={pick("science")}>
            <div className="mode-card-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6v16l-8 14a2 2 0 001.7 3h24.6a2 2 0 001.7-3l-8-14V6" />
                <line x1="16" y1="6" x2="32" y2="6" />
                <path d="M14 32c4-2 8-2 12-2s8 2 12 2" />
                <circle cx="22" cy="28" r="1.5" fill="currentColor" />
                <circle cx="28" cy="32" r="1" fill="currentColor" />
              </svg>
            </div>
            <h2 className="mode-card-title">Science Mode</h2>
            <p className="mode-card-desc">Verify. Audit. Analyze.</p>
            <span className="mode-card-cta">Enter Lab &rarr;</span>
          </button>
        </div>
      </div>
    </div>
  );
}
