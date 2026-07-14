/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary action color — a deep, oxidized canteen-awning moss, not a
        // generic SaaS green.
        brand: {
          DEFAULT: '#3F5D48',
          dark: '#2C4434',
          light: '#E4E9DE',
        },
        // Rubber ink-stamp red. Reserved for status stamps and the rare
        // critical alert — never a decorative wash.
        stamp: {
          DEFAULT: '#AE3327',
          dark: '#8A281F',
          light: '#F4DAD3',
        },
        turmeric: {
          DEFAULT: '#D9941C',
          deep: '#A66B0F',
          pale: '#F7E7C4',
        },
        // Page wash — a cool, institutional steel-counter tone.
        steel: {
          DEFAULT: '#DCE4DE',
          dark: '#4B5D57',
        },
        // Kraft-paper card surface — every ticket, ledger row, and dialog
        // sits on this instead of plain white.
        paper: '#EEDFBB',
        // Hairline/divider tone — a soft kraft-edge, not a green tint.
        edge: '#D8CBA3',
        ink: '#211F1A',
      },
      fontFamily: {
        // Mono carries the display + data voice: token numbers, prices,
        // stamps, labels. Sans carries everything else.
        display: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans: ['"IBM Plex Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(33, 31, 26, 0.12)',
        ticket: '0 6px 20px rgba(33, 31, 26, 0.16)',
        bar: '0 -4px 16px rgba(33, 31, 26, 0.12)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        'tick-pop': {
          '0%': { transform: 'scale(0.4)', opacity: '0' },
          '60%': { transform: 'scale(1.25)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          from: { transform: 'translateY(16px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        stamp: {
          '0%': { transform: 'scale(2.2) rotate(var(--stamp-rot, -6deg))', opacity: '0' },
          '35%': { transform: 'scale(0.92) rotate(var(--stamp-rot, -6deg))', opacity: '1' },
          '55%': { transform: 'scale(1.06) rotate(var(--stamp-rot, -6deg))' },
          '100%': { transform: 'scale(1) rotate(var(--stamp-rot, -6deg))', opacity: '1' },
        },
        // Student order-status motion. The "ready" moment slams in like a
        // hand-pressed rubber stamp; ordinary state changes just settle in.
        'ready-pop': {
          '0%': { transform: 'scale(0.72) rotate(-2deg)', opacity: '0' },
          '55%': { transform: 'scale(1.05) rotate(0.5deg)', opacity: '1' },
          '75%': { transform: 'scale(0.98)' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'ready-glow': {
          '0%, 100%': { boxShadow: '0 6px 20px rgba(174, 51, 39, 0.22)' },
          '50%': { boxShadow: '0 8px 30px rgba(174, 51, 39, 0.5)' },
        },
        'status-in': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        // Menu entrance: trending chits and category cards rise into place.
        'rail-in': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'tick-pop': 'tick-pop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.4) both',
        'slide-up': 'slide-up 0.25s ease-out both',
        stamp: 'stamp 0.4s cubic-bezier(0.3, 0.9, 0.4, 1) both',
        'ready-pop': 'ready-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.4) both',
        'ready-glow': 'ready-glow 2s ease-in-out infinite',
        'status-in': 'status-in 0.3s ease-out both',
        'rail-in': 'rail-in 0.35s ease-out both',
      },
    },
  },
  plugins: [],
};
