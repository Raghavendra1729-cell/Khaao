/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0f5132',
          dark: '#0b3d26',
          light: '#e7f4ec',
        },
        turmeric: {
          DEFAULT: '#e9a03b',
          deep: '#b77714',
          pale: '#fbf0dc',
        },
        cream: '#fbf9f4',
        sage: '#dfeae4',
        ink: '#12291f',
      },
      fontFamily: {
        display: [
          '"Bricolage Grotesque Variable"',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 81, 50, 0.08)',
        ticket: '0 4px 16px rgba(15, 81, 50, 0.12)',
        bar: '0 -4px 16px rgba(15, 81, 50, 0.10)',
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
      },
      animation: {
        'tick-pop': 'tick-pop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.4) both',
        'slide-up': 'slide-up 0.25s ease-out both',
      },
    },
  },
  plugins: [],
};
