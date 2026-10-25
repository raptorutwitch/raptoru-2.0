// Manual local validation of the auto-update pipeline, without any GitHub Release: points
// electron-updater at a local "generic" feed (a plain latest.yml + installer file, e.g. served by
// a static file server) and reports what happened. Never touches GitHub, never installs anything
// (quitAndInstall is never called and install-on-quit is off).
//
// Must be run with Electron itself, not plain Node (this needs the `app` module):
//   node -e "process.stdout.write(require('electron'))"   # -> path to electron.exe
//   <that path> apps/studio/desktop/scripts/test-update-feed.mjs
//
// Env vars:
//   UPDATE_TEST_FEED_URL          (required) the feed's BASE URL (a directory, not the yml file
//                                 itself — the generic provider appends /latest.yml on its own),
//                                 e.g. http://127.0.0.1:PORT
//   UPDATE_TEST_DOWNLOAD=1        also downloads the update once detected
//   UPDATE_TEST_SKIP_SIGNATURE=1  skips Authenticode verification (only for an unsigned fixture
//                                 installer; never set this against a real update)
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { app } from 'electron';
import electronUpdaterPkg from 'electron-updater';
const { autoUpdater } = electronUpdaterPkg;

const feedUrl = process.env.UPDATE_TEST_FEED_URL;
if (!feedUrl) {
  console.error(
    'set UPDATE_TEST_FEED_URL to a local feed base URL (a directory)',
  );
  app.exit(2);
}

// NOTE: top-level `await app.whenReady()` deadlocks when this file is loaded as Electron's main
// script directly by path (observed on Electron 44) — use `.then()` instead.
void app.whenReady().then(async () => {
  console.log(
    `[test] app version: ${app.getVersion()} (packaged: ${app.isPackaged})`,
  );
  autoUpdater.forceDevUpdateConfig = true; // this script always runs unpackaged
  autoUpdater.autoDownload = false;
  // Never install anything: electron-updater's default installs a downloaded update when the app quits — the installer
  // then replaces the Studio installed on this PC and closes it (happened on 25/10 with UPDATE_TEST_DOWNLOAD=1).
  autoUpdater.autoInstallOnAppQuit = false;
  if (process.env.UPDATE_TEST_SKIP_SIGNATURE === '1') {
    autoUpdater.verifyUpdateCodeSignature = false;
  }
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: feedUrl,
    channel: 'latest',
  });
  autoUpdater.logger = {
    info: (m) => console.log('[updater:info]', m),
    warn: (m) => console.log('[updater:warn]', m),
    error: (m) => console.log('[updater:error]', m),
    debug: () => {},
  };

  for (const event of [
    'checking-for-update',
    'update-available',
    'update-not-available',
    'download-progress',
    'update-downloaded',
    'error',
  ]) {
    autoUpdater.on(event, (payload) =>
      console.log(`[event] ${event}`, payload ? JSON.stringify(payload) : ''),
    );
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    console.log(
      '[test] checkForUpdates resolved:',
      JSON.stringify(result?.updateInfo ?? null),
    );
    if (process.env.UPDATE_TEST_DOWNLOAD === '1' && result) {
      const downloaded = await autoUpdater.downloadUpdate();
      console.log(
        '[test] downloadUpdate resolved:',
        JSON.stringify(downloaded),
      );
    }
  } catch (error) {
    console.log('[test] checkForUpdates threw:', error.message);
  }

  // Let any trailing async event handlers flush before exiting.
  await new Promise((r) => setTimeout(r, 300));
  app.exit(0);
});

setTimeout(() => {
  console.log('[test] SAFETY TIMEOUT (20s) — exiting');
  app.exit(9);
}, 20000);
