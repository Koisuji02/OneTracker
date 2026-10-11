import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Safari (the web version on an iPhone) ignores `user-scalable=no`; its
// non-standard gesture events are the only way to keep a pinch from zooming.
// The installed app doesn't need it — Capacitor's WKWebView never zooms.
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
