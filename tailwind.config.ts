import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Evergreen. brand-600 is the primary; keep it in sync with scripts/generate-icons.mjs,
        // themeColor in src/app/layout.tsx and theme_color in public/manifest.json.
        brand: {
          50: "#eef6f2",
          100: "#d9eee3",
          200: "#b3dcc7",
          300: "#84c3a5",
          400: "#4fa580",
          500: "#22865f",
          600: "#0e5e45",
          700: "#0a4a36",
          800: "#083a2b",
          900: "#062b20",
        },
        // Money owed to someone, and money someone owes.
        positive: "#0c7a50",
        negative: "#b8432f",
      },
    },
  },
  plugins: [],
};

export default config;
