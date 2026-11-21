/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: '#F8F8F6',
        sidebar: '#F5F5F3',
        card: '#FFFFFF',
        primary: '#181818',
        secondary: '#777777',
        border: '#E5E5E5',
        risk: '#C92A2A',
      },
    },
  },
  plugins: [],
}
