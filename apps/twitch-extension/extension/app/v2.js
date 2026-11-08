// Shell v2 entry (loaded by app/boot.js once its sheets are in): the single layout measurement, then the page's
// viewer logic. Step by step the historical entries (overlay.js / mobile.js) are replaced by app/ modules.
import { startLayout } from './layout.js';

const layout = startLayout();
if (layout.surface === 'video') await import('../overlay.js');
else await import('../mobile.js');
