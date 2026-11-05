import type { ModuleDefinition } from './kit.js';
import { coffreMystere } from './coffre-mystere.js';
import { objectifSoiree } from './objectif-soiree.js';

// THE list of the modules built on the module host (docs/studio-refonte/architecture/GUIDE_MODULE.md). Adding a module
// = writing its file and adding ONE line here; the main Core and the Lab Core both build their host from this list.
// Historical modules (TTS, Soundboard, Bonk, Tombola…) keep their own wiring until a rework brings them here.

export const MODULES: readonly ModuleDefinition[] = [
  objectifSoiree, // démonstration A (Lab only)
  coffreMystere, // démonstration B (Lab only)
];
