/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /** Brand — pink / orange accent */
        brand: {
          accent: "#f97316",
          "accent-hover": "#ea580c",
          ink: "#0f172a",
          /** Warm shell — pink/orange/beige dashboard */
          shell: "#fdf6f0",
        },
        /** @deprecated use brand.accent */
        "solar-orange": "#f97316",
        "cart-purple": "#0f172a",
      },
    },
  },
  plugins: [],
}