import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        dp: {
          bg: "#0d1f2d",
          felt: "#135b45",
          feltDark: "#0b3a2c",
          panel: "#17222e",
          panel2: "#223244",
          accent: "#f2b134",
          accent2: "#3fc1a5",
          bad: "#e0524f",
          text: "#eef2f5",
          muted: "#9fb0bf",
        },
      },
      fontFamily: {
        sans: ["'Hiragino Sans'", "'Yu Gothic'", "'Noto Sans JP'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
