import type { Config } from "tailwindcss";

// Tema Weevo (cores tiradas da tela app.weevoedu.com/suporte)
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c1212", card: "#151b1e", line: "#2b3433", track: "#1d2527",
        ink: "#f0faf7", mute: "#9ba5a4", brand: "#6dcfc0", ok: "#5fd39a", warn: "#e5a85f", bad: "#ff7b6b",
        side: { top: "#1c4746", mid: "#0c3537", bottom: "#09282c", item: "#133a3b", active: "#073537", edge: "#2f5151", text: "#b7e7e7" },
      },
      fontFamily: { sans: ["'Inter Variable'", "Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
