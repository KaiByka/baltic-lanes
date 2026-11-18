// Privacy-friendly analytics only (AGENTS.md rule 6): GoatCounter, async+defer,
// no cookies, no fingerprinting, nothing else phones home.
// Register the site at goatcounter.com and paste the site code below before launch.
const GOATCOUNTER_CODE = '';

export function initAnalytics(): void {
  if (!GOATCOUNTER_CODE) return;
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', `https://${GOATCOUNTER_CODE}.goatcounter.com/count`);
  document.head.appendChild(s);
}
