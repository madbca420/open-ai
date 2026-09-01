/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        theme: {
          bg: 'var(--color-bg)',
          card: 'var(--color-card)',
          cardHover: 'var(--color-card-hover)',
          border: 'var(--color-border)',
          primary: 'var(--color-primary)',
          primaryGlow: 'var(--color-primary-glow)',
          secondary: 'var(--color-secondary)',
          text: 'var(--color-text)',
          muted: 'var(--color-muted)',
          accent: 'var(--color-accent)',
          danger: 'var(--color-danger)',
          success: 'var(--color-success)',
        },
      },
      fontFamily: {
        mono: ['"Fira Code"', '"JetBrains Mono"', 'Consolas', 'monospace'],
        sans: ['Inter', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 20px var(--color-primary-glow)',
        glowSm: '0 0 10px var(--color-primary-glow)',
        glowDanger: '0 0 15px rgba(244, 63, 94, 0.4)',
      },
      animation: {
        pulseGlow: 'pulseGlow 2.5s infinite ease-in-out',
        spinSlow: 'spin 12s linear infinite',
        radarSweep: 'radar 4s linear infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.4', filter: 'drop-shadow(0 0 8px var(--color-primary))' },
          '50%': { opacity: '1', filter: 'drop-shadow(0 0 22px var(--color-primary))' },
        },
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
    },
  },
  plugins: [],
};
