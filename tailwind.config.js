/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
    "./test-page.html"
  ],
  theme: {
    extend: {
      colors: {
        runbi: {
          jade: {
            DEFAULT: '#00BFA5',
            50: '#E0F7F4',
            100: '#B2EBF2',
            200: '#80DEEA',
            300: '#4DD0E1',
            400: '#26C6DA',
            500: '#00BFA5',
            600: '#00897B',
            700: '#00695C',
            800: '#004D40',
            900: '#00332C'
          },
          gold: {
            DEFAULT: '#D4AF37',
            50: '#FDFBF7',
            100: '#F9F4E8',
            200: '#F2E4C2',
            300: '#EAD49C',
            400: '#DFBE6B',
            500: '#D4AF37',
            600: '#B89324',
            700: '#8F7217',
            800: '#66510F',
            900: '#3D3008'
          },
          surface: {
            DEFAULT: '#1E293B',
            glass: 'rgba(255, 255, 255, 0.85)',
            'glass-dark': 'rgba(15, 23, 42, 0.85)',
            border: 'rgba(226, 232, 240, 0.8)'
          }
        }
      },
      boxShadow: {
        'capsule': '0 4px 14px 0 rgba(0, 191, 165, 0.35), 0 0 1px 1px rgba(0, 191, 165, 0.2)',
        'capsule-hover': '0 6px 20px 0 rgba(0, 191, 165, 0.5), 0 0 2px 2px rgba(0, 191, 165, 0.3)',
        'panel': '0 20px 40px -15px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        'panel-dark': '0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)'
      },
      borderRadius: {
        'panel': '16px'
      }
    },
  },
  plugins: [],
}
