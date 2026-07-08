export type ThemeColors = {
  bg: string;
  card: string;
  text: string;
  textSub: string;
  border: string;
  inputBg: string;
  sheetBg: string;
  modalBg: string;
  modalText: string;
  modalTextSub: string;
  modalBorder: string;
  placeholder: string;
  iconDefault: string;
  danger: string;
};

const light: ThemeColors = {
  bg: "#f4f4f4",
  card: "#fff",
  text: "#212121",
  textSub: "#999",
  border: "#eee",
  inputBg: "#f0f0f0",
  sheetBg: "#fff",
  modalBg: "#fff",
  modalText: "#212121",
  modalTextSub: "#555",
  modalBorder: "#eee",
  placeholder: "#ddd",
  iconDefault: "#999",
  danger: "#ff4757",
};

const dark: ThemeColors = {
  bg: "#0b0b0b",
  card: "#171717",
  text: "#ededed",
  textSub: "#a2a2a2",
  border: "#2f2f2f",
  inputBg: "#242424",
  sheetBg: "#171717",
  modalBg: "#171717",
  modalText: "#ededed",
  modalTextSub: "#a2a2a2",
  modalBorder: "#2f2f2f",
  placeholder: "#222222",
  iconDefault: "#a2a2a2",
  danger: "#ff6b81",
};

export function getThemeColors(darkMode: boolean): ThemeColors {
  return darkMode ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const radius = { sm: 6, md: 8, lg: 12, pill: 999 } as const;

// Neutral silver tokens matching the embedded gsav-hosting player.
export const GSAV_ACCENT = "#bdbdbd";
export const GSAV_ACCENT_TINT = "rgba(189, 189, 189, 0.12)";
export const GSAV_ACCENT_CONTRAST = "#050505";
