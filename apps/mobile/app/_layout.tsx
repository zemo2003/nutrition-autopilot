import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#245d37" },
        headerTintColor: "#ffffff",
        contentStyle: { backgroundColor: "#f4f8f1" }
      }}
    />
  );
}
