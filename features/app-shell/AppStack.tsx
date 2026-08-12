import { Stack } from "expo-router";

const slideFromRight = {
  animation: "slide_from_right" as const,
  gestureEnabled: true,
  gestureDirection: "horizontal" as const,
};

export function AppStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="search"
        options={{
          animation: "slide_from_right",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen name="explore" options={slideFromRight} />
      <Stack.Screen name="settings" options={slideFromRight} />
      <Stack.Screen name="creator" options={slideFromRight} />
      <Stack.Screen name="gsav/[id]" options={slideFromRight} />
      <Stack.Screen name="gsav-diagnostics" options={slideFromRight} />
      <Stack.Screen name="watch/[id]" options={slideFromRight} />
    </Stack>
  );
}
