// The page's entry: load the game only on a browser that can run the Engine, and otherwise say so on the
// loading screen. main.tsx starts everything as it is imported, so it comes in by a dynamic import, after the
// check.
import { supportsWasmGC, UNSUPPORTED_BROWSER } from './browser-support';

if (supportsWasmGC()) {
  void import('./main');
} else {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.dataset.state = 'unsupported';
    loading.removeAttribute('role');
    const label = loading.querySelector('[data-loading-label]');
    if (label) label.textContent = UNSUPPORTED_BROWSER;
  }
}
