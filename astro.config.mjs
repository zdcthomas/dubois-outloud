import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://dubois-outloud.fly.dev',
  // The spec requires zero client JS beyond one inline script. Astro ships
  // none by default; this keeps it that way if a component is ever added.
  build: { inlineStylesheets: 'always' },
});
