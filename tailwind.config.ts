import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#8b5cf6",
          hover: "#7c3aed",
          muted: "#a78bfa",
        },
      },
      fontFamily: {
        heading: ['"Space Mono"', "monospace"],
        sans: ['"Outfit"', "sans-serif"],
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
} as Config;