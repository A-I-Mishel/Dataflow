/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        btn: 'rgb(var(--btn) / <alpha-value>)',
        btnhover: 'rgb(var(--btnhover) / <alpha-value>)',
        btnink: 'rgb(var(--btnink) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        linesoft: 'rgb(var(--linesoft) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        ink2: 'rgb(var(--ink2) / <alpha-value>)',
        ink3: 'rgb(var(--ink3) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
