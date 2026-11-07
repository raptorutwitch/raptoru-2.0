// Les icônes du shell : la famille unique du design system, sous les noms du registre.
import { ic } from '../ds/icons.js';
import type { IconName } from './registry.js';

export const icon = (n: IconName, cls = 'rs-ic') => ic(n, cls);
