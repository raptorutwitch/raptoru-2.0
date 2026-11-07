// Les surfaces de l'extension, telles que Twitch les montre : dimensions réelles, pour le Laboratoire et l'Extension Lab.

export type SurfaceId =
  'panel' | 'window' | 'mobile' | 'video' | 'config' | 'live_config';

export const SURFACES: Record<
  SurfaceId,
  {
    label: string;
    hint: string;
    page: string;
    params: Record<string, string>;
    /** Silhouette : largeur et hauteur réelles. */
    size: [number, number];
  }
> = {
  panel: {
    label: 'Panel viewer',
    hint: 'Sous le player, largeur 318 px, hauteur 496 px',
    page: 'panel.html',
    params: { anchor: 'panel', mode: 'viewer', platform: 'web' },
    size: [318, 496],
  },
  window: {
    label: 'Moderator Window',
    hint: 'Panel Twitch → Pop-out (fenêtre 1100 × 720) : console de modération D4',
    page: 'panel.html',
    params: {
      anchor: 'panel',
      mode: 'viewer',
      platform: 'web',
      popout: 'true',
    },
    size: [1100, 720],
  },
  mobile: {
    label: 'Mobile viewer',
    hint: 'App Twitch mobile, onglet sous le player',
    page: 'mobile.html',
    params: { anchor: 'panel', mode: 'viewer', platform: 'mobile' },
    size: [390, 844],
  },
  video: {
    label: 'Video component',
    hint: 'Twitch réel : viewport 565×376 (65 % · 3:2 · auto OFF)',
    page: 'video_component.html',
    params: { anchor: 'component', mode: 'viewer', platform: 'web' },
    size: [565, 376],
  },
  config: {
    label: 'Config',
    hint: 'Gestionnaire d’extensions (broadcaster)',
    page: 'config.html',
    params: { mode: 'config', platform: 'web' },
    size: [860, 720],
  },
  live_config: {
    label: 'Live config',
    hint: 'Gestionnaire de stream, panneau latéral',
    page: 'config.html',
    params: { mode: 'dashboard', platform: 'web' },
    size: [340, 640],
  },
};

/** La silhouette d'une surface, à l'échelle de sa vraie taille. */
export const silhouette = (id: SurfaceId, h = 34, maxW = 52) => {
  const [w, hh] = SURFACES[id].size;
  const k = Math.min(h / hh, maxW / w);
  return `<i class="lb-sil" style="width:${Math.round(w * k)}px;height:${Math.round(hh * k)}px"></i>`;
};
