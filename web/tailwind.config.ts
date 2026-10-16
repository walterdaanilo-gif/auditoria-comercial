import type { Config } from "tailwindcss";

// Tema: troque as cores aqui para seguir o visual da Weevo
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e1626", card: "#16223a", line: "#26365a", track: "#22325a",
        ink: "#eaf0fb", mute: "#9fb0cc", brand: "#5aa2e6", ok: "#38c783", warn: "#f0b955", bad: "#ff7b6b",
      },
    },
  },
  plugins: [],
};
export default config;
