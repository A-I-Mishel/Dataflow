import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the exact bug that shipped: tailwind.config.js used hyphenated keys
// (accent-btn) while every call site spelled them unhyphenated (accentbtn),
// so Tailwind generated classes nobody used and all accent fills/text were
// silently transparent. Tailwind resolves utilities verbatim from these keys.

const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL("../../tailwind.config.js", import.meta.url));

// Class fragments that must resolve to a custom token (not the default
// palette): captured suffix must equal a tailwind `colors` key.
const CUSTOM_STEMS = [
  "accent",
  "cat-",
  "warn",
  "ok",
  "danger",
  "line",
  "ink",
  "elevated",
  "canvas",
  "panel",
  "card",
  "btn",
  "muted",
  "grid",
  "wire",
];

function configKeys(): Set<string> {
  const text = readFileSync(CONFIG_PATH, "utf8");
  const keys = new Set<string>();
  for (const match of text.matchAll(/["']?([a-z][a-z0-9-]*)["']?\s*:\s*["']rgb\(var\(--/g)) {
    keys.add(match[1]);
  }
  return keys;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("tailwind custom tokens", () => {
  it("defines the tokens components rely on", () => {
    const keys = configKeys();
    expect(keys.size).toBeGreaterThan(10);
    for (const token of [
      "accentbtn",
      "accenttext",
      "accentsoft",
      "accentbtnhover",
      "accentbtnpressed",
      "warn-soft",
      "line-strong",
      "cat-cleaning",
      "cat-transform",
      "cat-encode",
    ]) {
      expect(keys, `missing tailwind colors key "${token}"`).toContain(token);
    }
  });

  it("every custom-looking class in src resolves to a config key", () => {
    const keys = configKeys();
    const missing: string[] = [];
    const pattern =
      /(?:bg|text|border|ring|from|via|to|divide|outline|decoration|placeholder|fill|stroke|caret)-([a-z0-9-]+)/g;
    for (const file of sourceFiles(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        const token = match[1];
        if (!CUSTOM_STEMS.some((stem) => token.startsWith(stem))) continue;
        // Exact match only: a "base-name" fallback would bless the original
        // accent-btn/accentbtn mismatch this test exists to catch.
        if (!keys.has(token)) {
          missing.push(`${file.split("src")[1]}: ${match[0]}`);
        }
      }
    }
    expect(missing, `unresolved custom classes:\n${missing.join("\n")}`).toEqual([]);
  });
});
