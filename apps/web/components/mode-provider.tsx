"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

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

const STORAGE_KEY = "numen:mode";

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "kitchen" || stored === "science") {
      setModeState(stored);
    }
    setIsLoaded(true);
  }, []);

  const setMode = useCallback((m: AppMode) => {
    localStorage.setItem(STORAGE_KEY, m);
    setModeState(m);
  }, []);

  const clearMode = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
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
