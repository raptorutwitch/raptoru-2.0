// Blackjack Raptoru — le hasard du PROTOTYPE : sfc32 avec graine (rejouable dans le Lab et les tests).
// Le Core utilisera crypto.randomInt (comme apps/core-api/src/casino/rng.ts) : jamais de graine prévisible, jamais
// envoyée au client.
export function seeded(seed = Date.now()) {
  let a = 0x9e3779b9 ^ seed, b = 0x243f6a88 ^ (seed * 7), c = 0xb7e15162 ^ (seed * 13), d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return { next, int: (n) => Math.floor(next() * n) };
}
