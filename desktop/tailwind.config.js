/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/components/**/*.{js,ts,jsx,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* 黑白灰主题:teal-* 全档位重映射到灰阶,品牌青彻底退场(组件零改动)。 */
        teal: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
          950: '#030712'
        },
        jade: {
          DEFAULT: '#00BFA5',
          hover: '#00A892',
          active: '#008F7C',
          glow: 'rgba(0, 191, 165, 0.35)',
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
        acrylic: {
          bg: 'rgba(18, 26, 28, 0.82)',
          surface: 'rgba(26, 38, 41, 0.70)',
          card: 'rgba(32, 46, 50, 0.65)',
          border: 'rgba(255, 255, 255, 0.12)',
          borderHover: 'rgba(0, 191, 165, 0.40)',
          subtle: 'rgba(255, 255, 255, 0.06)'
        },
        runbi: {
          jade: {
            DEFAULT: '#00BFA5',
            50: '#E0F7F4',
            500: '#00BFA5',
            600: '#00897B',
            700: '#00695C'
          },
          gold: {
            DEFAULT: '#D4AF37',
            500: '#D4AF37',
            600: '#B89324'
          }
        }
      },
      backdropBlur: {
        'acrylic': '24px',
        'xl': '32px'
      },
      boxShadow: {
        'floating': '0 25px 50px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
        'glow-jade': '0 0 20px rgba(209, 213, 219, 0.25), 0 0 40px rgba(209, 213, 219, 0.10)',
        'glow-subtle': '0 0 12px rgba(209, 213, 219, 0.20)',
        'panel-dark': '0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)'
      },
      borderRadius: {
        'window': '18px',
        'panel': '16px'
      },
      animation: {
        'raycast-in': 'raycastIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite'
      },
      keyframes: {
        raycastIn: {
          '0%': { opacity: '0', transform: 'scale(0.97) translateY(-6px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' }
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.85' }
        }
      }
    }
  },
  plugins: []
}
