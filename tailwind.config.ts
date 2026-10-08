import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mist: "#f6f8fb",
        line: "#d7dee8",
        teal: "#0f766e",
        amber: "#b45309",
        rose: "#be123c",
        indigo: "#4f46e5",
        sky: "#0369a1"
      },
      boxShadow: {
        soft: "0 12px 30px rgba(23, 32, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
