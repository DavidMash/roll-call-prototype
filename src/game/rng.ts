import type { RandomSource } from './types';

export function hashSeed(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return value >>> 0;
}

// Mulberry32: one serializable stream for every random decision in a run.
export class SeededRng implements RandomSource {
  constructor(public state: number) {}
  next(): number {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export function randomIndex(rng: RandomSource, size: number): number {
  const value = rng.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('RNG must return a number in [0, 1).');
  return Math.floor(value * size);
}
