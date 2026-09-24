import { app, BrowserWindow } from 'electron';

// Placeholder shell: only opens a window on the local Studio web UI. No OBS or Core logic here.
const studioUrl = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173';

void app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800 });
  void win.loadURL(studioUrl);
});

app.on('window-all-closed', () => app.quit());
