import {
  GROUPS,
  MONTHS,
  monthIndexOf,
  monthLabel,
  parseHash,
  writeHash,
  type State,
} from './state';
import type { Manifest } from './data';

// Bottom bar + chips + actions. Enabled state comes from the data manifest:
// only groups/months that exist are interactive.
// Returns the effective state after clamping to the months present in the
// manifest (a hash without m= defaults to the latest available month).
export function initChrome(manifest: Manifest | null, onStateChange: (s: State) => void): State {
  const state = parseHash();

  // --- vessel-group chips (top-left; static markup in index.html, wired here) ---
  const available = manifest ? Object.keys(manifest.groups) : [];
  for (const g of GROUPS) {
    const b = document.querySelector<HTMLButtonElement>(`.chip[data-group="${g}"]`);
    if (!b) continue;
    // 'all' is available when any group is; single groups only if their file exists
    b.disabled = g === 'all' ? available.length === 0 : !available.includes(g);
    b.title = b.disabled ? 'No data for this group yet' : '';
    b.setAttribute('aria-pressed', String(state.group === g));
    b.addEventListener('click', () => {
      state.group = g;
      writeHash(state);
      markChips(state);
      onStateChange(state);
    });
  }
  if (state.group !== 'all' && !available.includes(state.group)) state.group = 'all';
  markChips(state);

  // --- time slider + play/pause + speed (bottom bar) ---
  const slider = document.getElementById('slider') as HTMLInputElement;
  const label = document.getElementById('month-label')!;
  const play = document.getElementById('btn-play') as HTMLButtonElement;
  const speed = document.getElementById('speed') as HTMLSelectElement;
  slider.max = String(MONTHS - 1);

  let minMonth = 0;
  let maxMonth = MONTHS - 1;
  if (manifest && manifest.months.length) {
    minMonth = Math.min(...manifest.months.map(monthIndexOf));
    maxMonth = Math.max(...manifest.months.map(monthIndexOf));
    slider.min = String(minMonth);
    slider.max = String(maxMonth);
  }
  if (state.month < minMonth || state.month > maxMonth) state.month = maxMonth;
  slider.value = String(state.month);
  label.textContent = monthLabel(state.month);
  slider.disabled = !manifest;
  play.disabled = !manifest;
  speed.disabled = !manifest;
  play.title = manifest ? 'Play' : 'Playback starts once data is loaded';

  slider.addEventListener('input', () => {
    state.month = Number(slider.value);
    label.textContent = monthLabel(state.month);
    writeHash(state);
    onStateChange(state);
  });

  let playing = false;
  let timer: number | null = null;
  const tickMs = () => 1000 / Number(speed.value);
  const stop = () => {
    playing = false;
    play.setAttribute('aria-label', 'Play');
    play.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
  play.addEventListener('click', () => {
    if (playing) {
      stop();
      return;
    }
    playing = true;
    play.setAttribute('aria-label', 'Pause');
    play.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>';
    timer = window.setInterval(() => {
      if (state.month >= maxMonth) {
        stop();
        return;
      }
      state.month += 1;
      slider.value = String(state.month);
      label.textContent = monthLabel(state.month);
      writeHash(state);
      onStateChange(state);
    }, tickMs());
  });
  speed.addEventListener('change', () => {
    if (timer !== null) {
      stop();
      play.click();
    }
  });

  // --- share (top-right): copies the current deep link ---
  const share = document.getElementById('btn-share') as HTMLButtonElement;
  share.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      flash(share, 'Copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  });
  return state;
}

function markChips(state: State): void {
  document.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.group === state.group));
  });
}

function flash(btn: HTMLButtonElement, text: string): void {
  const original = btn.textContent ?? '';
  btn.textContent = text;
  window.setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}
