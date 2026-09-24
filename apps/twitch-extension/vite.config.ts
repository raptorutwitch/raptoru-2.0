import { defineConfig } from 'vite';

// Twitch serves extension files from its CDN under a sub-path, so asset URLs must be relative.
export default defineConfig({
  base: './',
});
