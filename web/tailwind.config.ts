import type { Config } from "tailwindcss";

// Tema Weevo (cores tiradas da tela app.weevoedu.com/suporte); a Carbone troca as variaveis de cor
const cor = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c1212", card: "#151b1e", line: "#2b3433", track: "#1d2527",
        ink: "#f0faf7", mute: "#9ba5a4", ok: "#5fd39a", warn: "#e5a85f", bad: "#ff7b6b",
        // cor de destaque e menu lateral mudam com a empresa aberta (variaveis em globals.css, por data-org)
        brand: cor("brand"),
        side: { top: cor("side-top"), mid: cor("side-mid"), bottom: cor("side-bottom"), item: cor("side-item"), active: cor("side-active"), edge: cor("side-edge"), text: cor("side-text") },
      },
      fontFamily: { sans: ["'Inter Variable'", "Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
