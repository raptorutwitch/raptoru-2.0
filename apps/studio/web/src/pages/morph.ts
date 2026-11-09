// Mise à jour en place d'un bloc d'interface : le HTML neuf est comparé nœud à nœud à l'existant, seules les différences
// sont appliquées. Les éléments restent les mêmes, donc une section <details> ouverte reste ouverte, le champ en cours
// garde le focus (et sa valeur), un curseur tenu ou un sélecteur de couleur ouvert n'est pas interrompu, le défilement
// ne bouge pas. Un élément portant `data-k` est reconnu par cette clé (un bloc ajouté ou retiré avant lui ne le
// confond pas avec son voisin). Pour un panneau de réglages réécrit à chaque changement (Overlay musique).

export function morph(el: HTMLElement, html: string) {
  if (el.dataset.sig === html) return;
  el.dataset.sig = html;
  const t = document.createElement('template');
  t.innerHTML = html;
  sync(el, t.content);
}

const key = (n: Node | null | undefined) =>
  n instanceof Element ? n.getAttribute('data-k') : null;

function sync(cur: Node, next: Node) {
  const keyed = new Map<string, Element>();
  for (const c of [...cur.childNodes]) {
    const k = key(c);
    if (k) keyed.set(k, c as Element);
  }
  const kept = new Set([...next.childNodes].map(key).filter(Boolean));
  let i = 0;
  for (const n of [...next.childNodes]) {
    const k = key(n);
    const m = k ? keyed.get(k) : undefined;
    if (m) {
      // Old nodes without a key before it are gone; the keyed one itself is never recreated.
      for (
        let o = cur.childNodes[i];
        o && o !== m && !kept.has(key(o));
        o = cur.childNodes[i]
      )
        o.remove();
      if (cur.childNodes[i] !== m)
        cur.insertBefore(m, cur.childNodes[i] ?? null);
      update(m, n as Element);
    } else {
      const o = cur.childNodes[i];
      if (!o || k || key(o)) cur.insertBefore(n, o ?? null);
      else if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName)
        cur.replaceChild(n, o);
      else if (o instanceof Element) update(o, n as Element);
      else if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
    }
    i++;
  }
  while (cur.childNodes.length > i) cur.lastChild!.remove();
}

function update(o: Element, n: Element) {
  attrs(o, n);
  sync(o, n);
  if (o !== document.activeElement) live(o, n);
}

function attrs(o: Element, n: Element) {
  for (const { name, value } of [...n.attributes])
    if (o.getAttribute(name) !== value) o.setAttribute(name, value);
  for (const { name } of [...o.attributes])
    // The streamer's open / closed sections are theirs: the new HTML never says.
    if (
      !n.hasAttribute(name) &&
      !(name === 'open' && o.localName === 'details')
    )
      o.removeAttribute(name);
}

/** A form control's live value follows the new HTML (its attribute alone would not, once touched). */
function live(o: Element, n: Element) {
  if (o instanceof HTMLInputElement) {
    if (o.type === 'checkbox' || o.type === 'radio')
      o.checked = n.hasAttribute('checked');
    else o.value = n.getAttribute('value') ?? '';
  } else if (o instanceof HTMLSelectElement) {
    const v = n.querySelector('option[selected]')?.getAttribute('value');
    if (v != null) o.value = v;
  }
}
