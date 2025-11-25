/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./popup.html",
    "./gallery.html",
    "./settings.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      letterSpacing: {
        tighter: '-0.02em',
        tight: '-0.01em',
      },
      colors: {
        primary: {
          50: '#f0f5ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5b8fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        secondary: {
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
        }
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-secondary': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
