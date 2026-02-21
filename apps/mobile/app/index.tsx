import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { fetchJson, getApiBase } from "../src/api";

type SystemState = {
  hasCommittedSot: boolean;
  counts: {
    activeSkus: number;
    activeIngredients: number;
    lotsOnHand: number;
    schedules: number;
    servedMeals: number;
    labels: number;
    openVerificationTasks: number;
  };
};

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SystemState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = (await fetchJson("/v1/system/state")) as SystemState;
      setState(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Text style={{ fontSize: 28, fontWeight: "700", color: "#122013" }}>Nutrition Autopilot</Text>
      <Text style={{ color: "#23452d" }}>Mobile ops app for SOT-driven nutrition service.</Text>
      <Text style={{ color: "#4c6d56", fontSize: 12 }}>API: {getApiBase()}</Text>

      <View style={{ backgroundColor: "#ffffff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#c8d8c5" }}>
        {loading ? <ActivityIndicator color="#245d37" /> : null}
        {error ? <Text style={{ color: "#a0472f" }}>{error}</Text> : null}
        {!loading && !error ? (
          state?.hasCommittedSot ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "600", color: "#122013" }}>System Active</Text>
              <Text>SKUs: {state.counts.activeSkus}</Text>
              <Text>Ingredients: {state.counts.activeIngredients}</Text>
              <Text>Lots On Hand: {state.counts.lotsOnHand}</Text>
              <Text>Open Verification: {state.counts.openVerificationTasks}</Text>
            </View>
          ) : (
            <Text style={{ color: "#122013" }}>Empty state: upload SOT from web app first.</Text>
          )
        ) : null}
      </View>

      <Link href="/verification" asChild>
        <Pressable style={{ backgroundColor: "#245d37", padding: 12, borderRadius: 12 }}>
          <Text style={{ color: "white", textAlign: "center", fontWeight: "600" }}>Open Verification Tasks</Text>
        </Pressable>
      </Link>

      <Pressable onPress={() => void load()} style={{ backgroundColor: "#d6ead9", padding: 12, borderRadius: 12 }}>
        <Text style={{ color: "#245d37", textAlign: "center", fontWeight: "600" }}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}
