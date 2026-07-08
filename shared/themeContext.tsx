import React, { createContext, useContext } from "react";

import { getThemeColors, type ThemeColors } from "./theme";

const ThemeContext = createContext<ThemeColors>(getThemeColors(true));

export function ThemeProvider({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  return <ThemeContext.Provider value={colors}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
