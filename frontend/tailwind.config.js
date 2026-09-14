/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        btn: 'rgb(var(--btn) / <alpha-value>)',
        btnhover: 'rgb(var(--btnhover) / <alpha-value>)',
        btnink: 'rgb(var(--btnink) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        linesoft: 'rgb(var(--linesoft) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        ink2: 'rgb(var(--ink2) / <alpha-value>)',
        ink3: 'rgb(var(--ink3) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accent2: 'rgb(var(--accent-2) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 0 14px rgba(92,92,180,0.22)',
        'glow-lg': '0 0 20px rgba(92,92,180,0.28)',
        card: '0 4px 20px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};
