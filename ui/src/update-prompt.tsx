// "A new version is ready" (#267): a new build's service worker is waiting. The player restarts when it suits them,
// not in the middle of a game; their saves are kept.

export function UpdatePrompt({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="update-prompt" role="status">
      <span>A new version is ready.</span>
      <button type="button" onClick={onRestart}>
        Restart
      </button>
    </div>
  );
}
