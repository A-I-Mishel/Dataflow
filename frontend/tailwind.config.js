/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        btn: "rgb(var(--btn) / <alpha-value>)",
        btnhover: "rgb(var(--btnhover) / <alpha-value>)",
        btnink: "rgb(var(--btnink) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        linesoft: "rgb(var(--linesoft) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        ink2: "rgb(var(--ink2) / <alpha-value>)",
        ink3: "rgb(var(--ink3) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        accent2: "rgb(var(--accent-2) / <alpha-value>)",
        // NOTE: keys are intentionally unhyphenated (accentbtn, not
        // accent-btn) — every call site spells them that way, and Tailwind
        // generates utilities verbatim from these keys. A hyphenated key
        // silently produces a class nobody uses (this exact bug shipped:
        // all accent fills/text were transparent in both themes).
        accenttext: "rgb(var(--accent-text) / <alpha-value>)",
        accentbtn: "rgb(var(--accent-btn) / <alpha-value>)",
        accentbtnhover: "rgb(var(--accent-btnhover) / <alpha-value>)",
        accentbtnpressed: "rgb(var(--accent-btnpressed) / <alpha-value>)",
        accentsoft: "rgb(var(--accent-soft) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",
        "ok-text": "rgb(var(--ok-text) / <alpha-value>)",
        "warn-soft": "rgb(var(--warn-soft) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        "cat-cleaning": "rgb(var(--cat-cleaning) / <alpha-value>)",
        "cat-transform": "rgb(var(--cat-transform) / <alpha-value>)",
        "cat-encode": "rgb(var(--cat-encode) / <alpha-value>)",
        "cat-input": "rgb(var(--cat-input) / <alpha-value>)",
      },
      boxShadow: {
        glow: "0 0 14px rgb(var(--accent) / 0.22)",
        "glow-lg": "0 0 20px rgb(var(--accent) / 0.28)",
        card: "var(--shadow)",
      },
    },
  },
  plugins: [],
};
