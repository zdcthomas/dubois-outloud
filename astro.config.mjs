import { defineConfig } from 'astro/config';
import { manifestGate } from './src/manifest-gate.ts';

export default defineConfig({
  site: 'https://dubois-outloud.fly.dev',
  // The spec requires zero client JS beyond one inline script. Astro ships
  // none by default; this keeps it that way if a component is ever added.
  build: { inlineStylesheets: 'always' },
  // The manifest gate must be an integration, not a collection loader parser.
  // See src/manifest-gate.ts for why: the file() loader swallows parser errors
  // and finishes the build with exit 0.
  integrations: [manifestGate(process.env.DUBOIS_DATA_DIR ?? 'src/data')],
});
