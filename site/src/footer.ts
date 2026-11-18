// Shared footer: required attribution (AGENTS.md rule 5) + the single MareSpot
// credit line (AGENTS.md rule 7 — exact text, exactly once, text link).
const FOOTER_HTML = `
  <footer class="site-footer">
    <span class="attr">
      Data: <a href="https://aisdata.ais.dk" rel="noopener">Danish Maritime Authority</a>
      <span aria-hidden="true">·</span> Land: <a href="https://www.naturalearthdata.com" rel="noopener">Natural Earth</a>
      <span aria-hidden="true">·</span> Map: <a href="https://maplibre.org" rel="noopener">MapLibre GL JS</a> +
      <a href="https://deck.gl" rel="noopener">deck.gl</a>
    </span>
    <a class="marespot" href="https://marespot.com" rel="noopener">A MareSpot experiment — live Adriatic wind, shelter &amp; sea temperature at marespot.com</a>
  </footer>`;

export function renderFooter(): void {
  document.querySelectorAll('[data-footer]').forEach((el) => {
    el.innerHTML = FOOTER_HTML;
  });
}
