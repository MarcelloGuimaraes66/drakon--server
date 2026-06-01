/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/react-app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // Dark palette tuned for a neutral, modern UI (ChatGPT/VS Code style).
    // Legacy Perceptrum palette is kept documented in src/react-app/index.css.
    extend: {
      colors: {
        gray: {
          50: "#F7F7F8",
          100: "#ECECEC",
          200: "#D4D4D4",
          300: "#B4B4B4",
          400: "#8D8D8D",
          500: "#6B6B6B",
          600: "#4B4B4B",
          700: "#343434",
          750: "#2C2C2C",
          800: "#242424",
          900: "#1A1A1A",
          950: "#111111",
        },
        blue: {
          50: "#EDF4FF",
          100: "#DCEAFF",
          200: "#BFD8FF",
          300: "#9CC4FF",
          400: "#67ADFF",
          500: "#4A95FF",
          600: "#357FE8",
          700: "#2D69C2",
          800: "#25549B",
          900: "#1D3D6F",
        },
        cyan: {
          50: "#ECF6F8",
          100: "#D7ECF0",
          200: "#B8D8E0",
          300: "#95C2CC",
          400: "#6EAAB6",
          500: "#4F8F9D",
          600: "#3F7380",
          700: "#345C66",
          800: "#2B4A52",
          900: "#1F343A",
        },
        purple: {
          100: "#D7DCE8",
          200: "#BCC6DB",
          300: "#9CAAC7",
          400: "#7F90B3",
          500: "#6479A0",
          600: "#51648A",
          700: "#445473",
          800: "#354158",
          900: "#242C3D",
        },
        pink: {
          500: "#7C849B",
          600: "#6A7288",
          900: "#2B3140",
        },
      },
    },
  },
  plugins: [],
};
