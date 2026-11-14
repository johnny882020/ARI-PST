/** Mobile menu is a <details>. Desktop shows the list through CSS (::details-content);
 *  this is the fallback for browsers without it: keep it open at desktop width. */
const d = document.querySelector<HTMLDetailsElement>('details.menu');
if (d && !CSS.supports('selector(::details-content)')) {
  const mq = matchMedia('(min-width: 90em)');
  const sync = () => { if (mq.matches) d.open = true; };
  sync();
  mq.addEventListener('change', sync);
}
