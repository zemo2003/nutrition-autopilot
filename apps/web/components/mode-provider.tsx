"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type AppMode = "kitchen" | "science";

interface ModeContextValue {
  mode: AppMode | null;
  isLoaded: boolean;
  setMode: (m: AppMode) => void;
  clearMode: () => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: null,
  isLoaded: false,
  setMode: () => {},
  clearMode: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  // Always start with no mode — show landing page on every load
  const [mode, setModeState] = useState<AppMode | null>(null);
  const isLoaded = true; // No async localStorage to wait for

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
  }, []);

  const clearMode = useCallback(() => {
    setModeState(null);
  }, []);

  return (
    <ModeContext.Provider value={{ mode, isLoaded, setMode, clearMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
