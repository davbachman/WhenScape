// A developer readout over the scene: camera, ground and tile figures that are
// otherwise invisible. Off unless the app's "Show scene diagnostics" setting
// is on. It reads values through a callback and changes nothing in the scene.

/** Formats a readout as aligned "name  value" lines. */
export function formatDiagnostics(rows) {
  const entries = Object.entries(rows).filter(([, value]) => value !== undefined && value !== null && value !== '');
  const width = Math.max(0, ...entries.map(([name]) => name.length));
  return entries.map(([name, value]) => `${name.padEnd(width)}  ${value}`).join('\n');
}

export function createDiagnostics(parent, sample) {
  const panel = document.createElement('pre');
  panel.className = 'diagnostics glass';
  panel.setAttribute('aria-hidden', 'true');
  panel.hidden = true;
  parent.append(panel);
  let timer;
  const refresh = () => { panel.textContent = formatDiagnostics(sample()); };
  return {
    setEnabled(enabled) {
      if (enabled === !panel.hidden) return;
      panel.hidden = !enabled;
      clearInterval(timer);
      timer = undefined;
      if (enabled) { refresh(); timer = setInterval(refresh, 250); }
    },
  };
}
