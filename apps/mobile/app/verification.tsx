import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { fetchJson } from "../src/api";

type Task = {
  id: string;
  taskType: string;
  severity: string;
  status: string;
  title: string;
  description: string;
};

export default function VerificationScreen() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = (await fetchJson("/v1/verification/tasks")) as { tasks: Task[] };
      setTasks(json.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load verification tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", color: "#122013" }}>Verification Tasks</Text>
      {loading ? <ActivityIndicator color="#245d37" /> : null}
      {error ? <Text style={{ color: "#a0472f" }}>{error}</Text> : null}
      {!loading && !error && tasks.length === 0 ? <Text>No tasks.</Text> : null}
      {!loading && !error
        ? tasks.map((task) => (
            <View key={task.id} style={{ backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#c8d8c5" }}>
              <Text style={{ fontWeight: "700", color: "#122013" }}>{task.title}</Text>
              <Text style={{ color: "#375543" }}>{task.description}</Text>
              <Text style={{ marginTop: 8, fontSize: 12 }}>
                {task.taskType} | {task.severity} | {task.status}
              </Text>
            </View>
          ))
        : null}
    </ScrollView>
  );
}
