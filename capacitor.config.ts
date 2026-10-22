import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.onetracker.app',
  appName: 'OneTracker',
  // The Cloudflare Vite plugin splits the build in two since wrangler.jsonc got
  // a `main` (site/worker.js): the web app lands in dist/client and the worker
  // in dist/onetracker. Pointing at plain `dist` shipped whatever stale
  // index.html an older build had left at its root.
  webDir: 'dist/client',
  ios: {
    // Edge swipe = back. The app is a HashRouter SPA, so WKWebView's history
    // IS the in-app history; without this iOS has no back gesture at all
    // (Android gets the system button, handled in App.tsx).
    allowsBackForwardNavigationGestures: true,
  },
  plugins: {
    // Google sign-in is the only provider used. Left on, the plugin bundles
    // Facebook's SDK, which adds the advertising-ID permission (Play's AD_ID
    // declaration) to the Android app. Read by the plugin's hook on `cap sync`;
    // iOS links it through SPM regardless.
    SocialLogin: { providers: { facebook: false } },
  },
};

export default config;
