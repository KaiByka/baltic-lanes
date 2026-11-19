// URL-hash state: every view (month, group, scene) serializes to #... so a
// pasted link restores the exact same view (docs/frontend.md "Deep links").

export const FIRST_YEAR = 2006;
export const LAST_YEAR = 2026;
export const MONTHS = (LAST_YEAR - FIRST_YEAR + 1) * 12; // 252, Jan 2006 = 0

export const GROUPS = ['all', 'tanker', 'cargo', 'ferry', 'fishing', 'pleasure'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
  all: 'All',
  tanker: 'Tankers',
  cargo: 'Cargo',
  ferry: 'Ferries/Cruise',
  fishing: 'Fishing',
  pleasure: 'Pleasure craft',
};

export interface State {
  month: number; // 0..MONTHS-1
  group: Group;
  scene: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(month: number): string {
  const y = FIRST_YEAR + Math.floor(month / 12);
  return `${MONTH_NAMES[month % 12]} ${y}`;
}

export function monthKey(month: number): string {
  const y = FIRST_YEAR + Math.floor(month / 12);
  return `${y}-${String(month % 12 + 1).padStart(2, '0')}`;
}

export function monthIndexOf(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return (y - FIRST_YEAR) * 12 + (m - 1);
}

export function parseHash(hash: string = window.location.hash): State {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const m = Number(p.get('m'));
  const g = p.get('g') ?? 'all';
  return {
    month: Number.isInteger(m) && m >= 0 && m < MONTHS ? m : 0,
    group: (GROUPS as readonly string[]).includes(g) ? (g as Group) : 'all',
    scene: p.get('scene'),
  };
}

export function toHash(s: State): string {
  const p = new URLSearchParams();
  p.set('m', String(s.month));
  if (s.group !== 'all') p.set('g', s.group);
  if (s.scene) p.set('scene', s.scene);
  const str = p.toString();
  return str ? `#${str}` : '';
}

export function writeHash(s: State): void {
  window.history.replaceState(null, '', toHash(s));
}
