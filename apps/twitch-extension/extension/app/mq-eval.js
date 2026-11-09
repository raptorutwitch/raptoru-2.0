// Evaluates the legacy viewport media conditions (app/mq.js) on the composition box. Supported features: the ones
// the generator converts — (min-|max-)width, (min-|max-)height, (min-|max-)aspect-ratio, orientation — joined by
// `and`, alternatives by `,`. Anything else makes the alternative false (and is refused at generation).

function feature(f, w, h) {
  const m = /^\(\s*(min-|max-)?(width|height|aspect-ratio|orientation)\s*:\s*([^)]+)\)$/.exec(f.trim());
  if (!m) return false;
  const [, bound, name, raw] = m;
  if (name === 'orientation') return raw.trim() === (h >= w ? 'portrait' : 'landscape');
  let v;
  let actual;
  if (name === 'aspect-ratio') {
    const [a, b = '1'] = raw.split('/').map((x) => Number(x.trim()));
    v = a / Number(b);
    actual = w / h;
  } else {
    v = Number.parseFloat(raw);
    actual = name === 'width' ? w : h;
  }
  if (bound === 'min-') return actual >= v;
  if (bound === 'max-') return actual <= v;
  return actual === v;
}

/** True when `condition` ("(max-width: 390px), (max-height: 320px)") matches a w×h box. */
export function matchBox(condition, w, h) {
  return condition.split(',').some((alt) => alt.split(/\s+and\s+/i).every((f) => feature(f, w, h)));
}

/** Tokens of MEDIA ([[token, condition]…]) matching the box, space separated (the data-mq attribute). */
export function boxTokens(media, w, h) {
  return media.filter(([, cond]) => matchBox(cond, w, h)).map(([token]) => token).join(' ');
}
