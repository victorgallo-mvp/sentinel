// PRNG determinístico (mulberry32) — mesmos parâmetros de entrada sempre geram
// os mesmos números. Usado para os dados fictícios do modo demonstração não
// "piscarem" a cada refresh automático (mesma conta + mesmo período = mesmo resultado).

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function criarRng(seedStr) {
  const seedFn = hashString(String(seedStr));
  let a = seedFn();
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Número aleatório determinístico entre min e max (inclusive). */
export function faixa(rng, min, max) {
  return min + rng() * (max - min);
}
