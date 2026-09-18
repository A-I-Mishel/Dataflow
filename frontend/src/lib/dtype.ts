import type { Theme } from "../stores/pipelineStore";

export function dtypeBadgeClass(dtype: string, theme: Theme): string {
  const dark = theme !== "light";
  const lower = dtype.toLowerCase();
  if (
    lower.includes("int64") ||
    lower.includes("float64") ||
    lower.includes("int") ||
    lower.includes("float")
  ) {
    return dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-500/15 text-blue-700";
  }
  if (lower.includes("object")) {
    return dark ? "bg-green-500/20 text-green-300" : "bg-green-500/15 text-green-700";
  }
  if (lower.includes("datetime64") || lower.includes("date") || lower.includes("time")) {
    return dark ? "bg-accentsoft text-accenttext" : "bg-accentsoft text-accenttext";
  }
  return dark ? "bg-slate-500/20 text-slate-300" : "bg-slate-500/15 text-slate-600";
}
