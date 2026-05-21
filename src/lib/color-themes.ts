export const colorThemes = [
  { id: "orange", label: "Laranja", colors: ["#ea580c", "#fb923c", "#fff7ed"] },
  { id: "teal", label: "Teal", colors: ["#0f7f8a", "#22c4c8", "#e6f4f5"] },
  { id: "blue", label: "Azul", colors: ["#2563eb", "#38bdf8", "#eff6ff"] },
  { id: "emerald", label: "Esmeralda", colors: ["#059669", "#34d399", "#ecfdf5"] },
  { id: "violet", label: "Violeta", colors: ["#7c3aed", "#a78bfa", "#f5f3ff"] },
  { id: "rose", label: "Rosa", colors: ["#e11d48", "#fb7185", "#fff1f2"] },
] as const

export type ColorThemeName = (typeof colorThemes)[number]["id"]

export const colorThemeNames = colorThemes.map((theme) => theme.id)

export function normalizeColorTheme(value: unknown): ColorThemeName | undefined {
  return typeof value === "string" && colorThemeNames.includes(value as ColorThemeName)
    ? value as ColorThemeName
    : undefined
}
