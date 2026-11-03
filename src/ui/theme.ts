/**
 * Vela design tokens — warm paper, ink text, amber accent, hairline borders,
 * quiet shadows and an ink sidebar. Two palettes; `T` is mutated in place by
 * setThemeMode() so every render reads the active one (Tarve re-runs the view).
 */
import { createTheme, darkTheme, lightTheme, type SvgNode, type ThemeDefinition } from "@tarve/core";
import type { ServiceName } from "../core/manifest";
import { readUserDword } from "../core/win";

const LIGHT = {
  paper: "#faf9f5",
  paperAlt: "#f4f2ec",
  card: "#ffffff",
  ink: "#16150f",
  inkSoft: "#55534a",
  inkFaint: "#8c8a80",
  line: "#e6e3d9",
  lineStrong: "#cfcbbd",
  accent: "#b45309",
  accentSoft: "#f59e0b",
  accentBg: "#fdf3e3",
  green: "#15803d",
  greenDot: "#22c55e",
  greenBg: "#ecfdf3",
  greenLine: "#bfe5cc",
  greenLineHover: "#9fd8b3",
  red: "#b91c1c",
  redBg: "#fef2f2",
  redLine: "#fecaca",
  blue: "#1d4ed8",
  blueBg: "#eef2ff",
  blueDot: "#60a5fa",
  amberBg: "#fffbeb",
  amberLine: "#fde68a",
  // light chrome: warm off-white rail instead of the ink block, so light mode reads as light
  side: "#f1efe8",
  sideAlt: "#e7e4da",
  sideLine: "#dedad0",
  sideText: "#16150f",
  sideMuted: "#6f6c62",
  sideHint: "#a29f94",
  code: "#1c1b17",
  codeBar: "#211f1a",
  codeLine: "#2c2a23",
  codeInput: "#16150f",
  codeInputLine: "#3a382f",
  codeText: "#e8e4d8",
  codeMuted: "#7d796c",
  onPrimary: "#ffffff",
  shadowSm: "#16150f0d",
  shadowLg: "#16150f08",
  shadowHoverSm: "#16150f10",
  shadowHoverLg: "#16150f16",
  overlay: "#16150f66",
  mono: "Cascadia Mono, Consolas, monospace",
};

type Palette = typeof LIGHT;

const DARK: Palette = {
  ...LIGHT,
  paper: "#131210",
  paperAlt: "#1f1e19",
  card: "#1a1915",
  ink: "#ece8dc",
  inkSoft: "#b6b1a3",
  inkFaint: "#7f7b6f",
  line: "#2a2922",
  lineStrong: "#3e3c33",
  accent: "#f5a524",
  accentSoft: "#fbbf24",
  accentBg: "#2d2213",
  green: "#4ade80",
  greenBg: "#13281b",
  greenLine: "#1f4a30",
  greenLineHover: "#2b6843",
  red: "#fca5a5",
  redBg: "#2b1515",
  redLine: "#5a2626",
  blue: "#93c5fd",
  blueBg: "#152036",
  amberBg: "#272012",
  amberLine: "#57421a",
  side: "#0d0c0a",
  sideAlt: "#1b1a16",
  sideLine: "#27251f",
  sideText: "#ece8dc",
  sideMuted: "#8f8b7e",
  sideHint: "#5c594f",
  code: "#0e0d0b",
  codeBar: "#141310",
  codeLine: "#24221c",
  codeInput: "#0a0908",
  codeInputLine: "#2f2d26",
  onPrimary: "#16150f",
  shadowSm: "#00000040",
  shadowLg: "#00000033",
  shadowHoverSm: "#00000055",
  shadowHoverLg: "#00000055",
  overlay: "#000000a0",
};

export const T: Palette = { ...LIGHT };

const SERVICE_LIGHT: Record<ServiceName, { fg: string; bg: string; mono: string }> = {
  nginx: { fg: "#0f7a3a", bg: "#e7f5ec", mono: "Nx" },
  php: { fg: "#5b5fa8", bg: "#eeeefa", mono: "php" },
  mariadb: { fg: "#9a5b3f", bg: "#f8ede7", mono: "Ma" },
  redis: { fg: "#c2321f", bg: "#fdece9", mono: "Rd" },
};
const SERVICE_DARK: typeof SERVICE_LIGHT = {
  nginx: { fg: "#4ade80", bg: "#12291b", mono: "Nx" },
  php: { fg: "#a5a8f0", bg: "#1d1e36", mono: "php" },
  mariadb: { fg: "#e3a587", bg: "#2e1d15", mono: "Ma" },
  redis: { fg: "#f87171", bg: "#301614", mono: "Rd" },
};
export const SERVICE_COLOR = { ...SERVICE_LIGHT };

export type ThemeMode = "light" | "dark" | "system";

const TARVE_LIGHT = createTheme(
  {
    colors: {
      background: LIGHT.paper, card: LIGHT.card, foreground: LIGHT.ink, muted: LIGHT.paperAlt, mutedForeground: LIGHT.inkFaint,
      border: "#d9d5c9", input: "#ffffff", primary: "#16150f", primaryForeground: "#ffffff", primaryHover: "#2c2a23", primaryActive: "#000000",
      secondary: "#ece9e1", secondaryForeground: LIGHT.ink, secondaryHover: "#e3dfd5", secondaryActive: "#d9d5c9", ring: LIGHT.accentSoft,
      disabled: "#ecebe6", disabledForeground: "#a8a59b", placeholder: "#a8a59b", overlay: "#16150f55", selection: "#fde68a99",
    },
  },
  lightTheme,
);
const TARVE_DARK = createTheme(
  {
    colors: {
      background: DARK.paper, card: DARK.card, foreground: DARK.ink, muted: DARK.paperAlt, mutedForeground: DARK.inkFaint,
      border: DARK.line, input: DARK.lineStrong, primary: "#ece8dc", primaryForeground: "#16150f", primaryHover: "#ffffff", primaryActive: "#d6d1c3",
      secondary: DARK.paperAlt, secondaryForeground: DARK.ink, ring: DARK.accentSoft, overlay: DARK.overlay,
    },
  },
  darkTheme,
);

let dark = false;
export const isDark = () => dark;
/** Theme for <Window>: Tarve's own controls (Button, Input, Select, Modal…). */
export const windowTheme = (): ThemeDefinition => (dark ? TARVE_DARK : TARVE_LIGHT);

/** Apply a palette; true when it changed. */
export function applyDark(next: boolean): boolean {
  if (next === dark) return false;
  dark = next;
  Object.assign(T, next ? DARK : LIGHT);
  Object.assign(SERVICE_COLOR, next ? SERVICE_DARK : SERVICE_LIGHT);
  return true;
}

/** Windows "apps use dark mode" setting (HKCU …\Personalize AppsUseLightTheme = 0). */
export async function systemPrefersDark(): Promise<boolean> {
  // registry read in-process (was reg.exe on every 3 s refresh)
  return readUserDword("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme") === 0;
}

/** Style factories read T at call time, so they follow the active palette. */
export const S = {
  get card() {
    return {
      background: T.card,
      borderColor: T.line,
      borderWidth: 1,
      radius: 12,
      boxShadow: [
        { y: 1, blur: 2, color: T.shadowSm },
        { y: 8, blur: 24, color: T.shadowLg },
      ],
    };
  },
  pill: (bg: string) => ({
    background: bg,
    radius: 999,
    padding: { top: 3, bottom: 3, left: 9, right: 9 },
    gap: 6,
    align: "center" as const,
    direction: "row" as const,
  }),
  get chip() {
    return { background: T.paperAlt, radius: 6, padding: { top: 2, bottom: 2, left: 7, right: 7 } };
  },
};

/** Lucide-style icons not in the built-in IconName set. */
export const ICONS: Record<string, readonly SvgNode[]> = {
  server: [
    ["rect", { x: 2, y: 2, width: 20, height: 8, rx: 2 }],
    ["rect", { x: 2, y: 14, width: 20, height: 8, rx: 2 }],
    ["line", { x1: 6, y1: 6, x2: 6.01, y2: 6 }],
    ["line", { x1: 6, y1: 18, x2: 6.01, y2: 18 }],
  ],
  logs: [
    ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
    ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
    ["path", { d: "M16 13H8" }],
    ["path", { d: "M16 17H8" }],
    ["path", { d: "M10 9H8" }],
  ],
  globe: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
    ["path", { d: "M2 12h20" }],
  ],
  refresh: [
    ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
    ["path", { d: "M21 3v5h-5" }],
    ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
    ["path", { d: "M8 16H3v5" }],
  ],
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ["path", { d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" }],
  ],
  moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }]],
  monitor: [
    ["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2 }],
    ["path", { d: "M8 21h8M12 17v4" }],
  ],
  gear: [
    ["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }],
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  file: [
    ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
    ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
  ],
  eye: [
    ["path", { d: "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" }],
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  eyeOff: [
    ["path", { d: "M10.73 5.08A10.43 10.43 0 0 1 12 5c4.97 0 8.5 3.5 9.94 6.65a1 1 0 0 1 0 .7 10.8 10.8 0 0 1-1.67 2.68" }],
    ["path", { d: "M14.08 14.16a3 3 0 0 1-4.24-4.24" }],
    ["path", { d: "M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14" }],
    ["path", { d: "m2 2 20 20" }],
  ],
  code: [
    ["path", { d: "m16 18 6-6-6-6" }],
    ["path", { d: "m8 6-6 6 6 6" }],
  ],
  lock: [
    ["rect", { x: 4, y: 11, width: 16, height: 10, rx: 2 }],
    ["path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }],
  ],
  database: [
    ["ellipse", { cx: 12, cy: 5, rx: 8, ry: 3 }],
    ["path", { d: "M4 5v14a8 3 0 0 0 16 0V5" }],
    ["path", { d: "M4 12a8 3 0 0 0 16 0" }],
  ],
  folderPlus: [
    ["path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }],
    ["path", { d: "M12 10v6M9 13h6" }],
  ],
  square: [["rect", { x: 5, y: 5, width: 14, height: 14, rx: 2 }]],
  terminal: [
    ["path", { d: "m4 17 6-6-6-6" }],
    ["path", { d: "M12 19h8" }],
  ],
  external: [
    ["path", { d: "M15 3h6v6" }],
    ["path", { d: "M10 14 21 3" }],
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
  ],
  sites: [
    ["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M9 21V9" }],
  ],
  keyboard: [
    ["rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }],
    ["path", { d: "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" }],
  ],
  alert: [
    ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
    ["path", { d: "M12 9v4" }],
    ["path", { d: "M12 17h.01" }],
  ],
};

export function fmtUptime(ms?: number): string | null {
  if (ms === undefined) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** The Vela mark: a sail (filled, 24×24). Used by the title bar and scripts/icon-view.tsx. */
export const SAIL: readonly SvgNode[] = [
  ["path", { d: "M11.2 2.5 L11.2 16.2 L3.6 16.2 Z", fill: "#ffffff" }],
  ["path", { d: "M12.8 5.5 L12.8 16.2 L19.6 16.2 Z", fill: "#ffffffcc" }],
  ["path", { d: "M2.6 18 H21.4 L19 21.4 H5 Z", fill: "#ffffff" }],
];
