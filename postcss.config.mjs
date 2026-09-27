// Plain CSS + CSS Modules, no Tailwind: Next's built-in CSS pipeline needs
// no postcss plugins, so this only stops a parent directory's config from
// being picked up.
const config = {
  plugins: {},
};

export default config;
