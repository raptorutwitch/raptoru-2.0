// Shell v2 entry (loaded by app/boot.js once its first sheets are in): the single layout measurement, then the one
// viewer entry of every surface (app/main.js, which replaces overlay.js / mobile.js in this shell).
import { startLayout } from './layout.js';
import { startViewer } from './main.js';

const layout = startLayout();
startViewer({ surface: layout.surface });
