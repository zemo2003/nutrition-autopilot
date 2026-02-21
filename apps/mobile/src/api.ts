import Constants from "expo-constants";

export function getApiBase(): string {
  const publicEnv = process.env.EXPO_PUBLIC_API_BASE;
  if (publicEnv && publicEnv.length > 0) return publicEnv;

  const fromExtra = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase;
  if (fromExtra && fromExtra.length > 0) return fromExtra;

  return "http://localhost:4000";
}

export async function fetchJson(path: string): Promise<any> {
  const base = getApiBase();
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return response.json();
}
