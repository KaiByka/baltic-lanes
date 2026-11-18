import { GROUPS, GROUP_LABELS, MONTHS, monthLabel, parseHash, writeHash, type State } from './state';

// Bottom bar + chips + actions. Playback and group data are disabled until the
// pipeline lands (sprint 2+); Share copies the deep link and works today.
export function initChrome(onStateChange: (s: State) => void): void {
  const state = parseHash();

  // --- vessel-group chips (top-left) ---
  const chips = document.getElementById('chips')!;
  for (const g of GROUPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = GROUP_LABELS[g];
    b.dataset.group = g;
    b.disabled = true; // no data yet — enabled when the group's file loads
    b.title = 'Available once the data is loaded';
    b.setAttribute('aria-pressed', String(state.group === g));
    b.addEventListener('click', () => {
      state.group = g;
      writeHash(state);
      markChips(state);
      onStateChange(state);
    });
    chips.appendChild(b);
  }
  markChips(state);

  // --- time slider + play/pause + speed (bottom bar) ---
  const slider = document.getElementById('slider') as HTMLInputElement;
  const label = document.getElementById('month-label')!;
  slider.max = String(MONTHS - 1);
  slider.value = String(state.month);
  label.textContent = monthLabel(state.month);
  slider.addEventListener('input', () => {
    state.month = Number(slider.value);
    label.textContent = monthLabel(state.month);
    writeHash(state);
    onStateChange(state);
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
