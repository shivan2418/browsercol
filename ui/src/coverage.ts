// Counting which dialogs a real game reaches, for docs/parity/dialog-coverage.md. The browser scripts install
// window.fcCoverageHit (scripts/common.ts, coverageTracking); with no hook, as for a player, nothing here runs.
import { useEffect } from 'react';

declare global {
  interface Window {
    /** Installed by the browser scripts: records that the named dialog was reached. Absent for a player. */
    fcCoverageHit?: (name: string) => void;
  }
}

/** Counts a dialog the Browser UI shows by itself, with no WebGUI method behind it (the Swing method it stands for). */
export function coverageHit(name: string): void {
  window.fcCoverageHit?.(`ui:${name}`);
}

/** Counts the dialog each time it opens: put in the component the dialog is. */
export function useCoverage(name: string): void {
  useEffect(() => coverageHit(name), [name]);
}
