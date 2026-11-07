import { confirmBox, esc, fld, fmt, toast } from '../ds/ds.js';
import { saveSetting, type SettingView } from '../module-settings.js';

// Un réglage borné du Core dans une page : prix, délais, durées. La valeur vit dans le Core, qui la valide et que chaque exécuteur
// relit. Un changement touche des achats ou des sanctions : il annonce son effet avant de partir, jamais pendant la frappe.

const REFUSED: Record<string, string> = {
  out_of_bounds: 'Valeur hors des bornes.',
  unknown_setting: 'Réglage inconnu sur ce profil.',
};

export const settingRow = (s: SettingView) =>
  `<div class="d-row sr" data-k="${esc(`${s.label} ${s.help ?? ''}`.toLowerCase())}"><span>${esc(s.label)}<small>De ${fmt(s.min)} à ${fmt(s.max)}, ${fmt(s.default)} par défaut${s.value !== s.default ? ' · modifié' : ''}${s.help ? ` · ${esc(s.help)}` : ''}</small></span>${fld(`data-set="${esc(s.key)}" min="${s.min}" max="${s.max}" step="1" aria-label="${esc(s.label)}"`, s.value, s.unit)}</div>`;

/** Écoute les champs `data-set` de `root`. `apply` reçoit les réglages à jour. */
export function bindSettings(
  root: HTMLElement,
  read: () => SettingView[] | null,
  apply: (next: SettingView[]) => void,
) {
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const key = t.dataset.set;
    const s = key ? read()?.find((x) => x.key === key) : null;
    if (!s) return;
    const value = Number(t.value);
    const box = t.closest<HTMLElement>('.d-fld');
    const back = () => {
      t.value = String(s.value);
      box?.classList.remove('is-bad');
    };
    if (value === s.value) return back();
    if (!Number.isInteger(value) || value < s.min || value > s.max) {
      box?.classList.add('is-bad');
      toast(`${s.label} : de ${fmt(s.min)} à ${fmt(s.max)}`, { bad: true });
      return;
    }
    box?.classList.remove('is-bad');
    void confirmBox({
      title: `${s.label} : ${fmt(s.value)} → ${fmt(value)} ${s.unit} ?`,
      body: 'Appliqué aux prochaines demandes. Rien de ce qui est déjà payé ou en cours ne change.',
      yes: 'Appliquer',
      no: 'Annuler',
      danger: false,
    }).then(async (yes) => {
      if (!yes) return back();
      try {
        const next = await saveSetting(s.key, value);
        toast(`${s.label} : ${fmt(value)} ${s.unit}`);
        if (next) apply(next);
      } catch (err) {
        back();
        const code = (err as Error).message;
        toast(REFUSED[code] ?? code, { bad: true });
      }
    });
  });
}

/** Les lignes de `keys`, ou l'état dit clairement quand ce Core n'a pas ces réglages. */
export function settingRows(settings: SettingView[] | null, keys: string[]) {
  if (!settings)
    return '<p class="d-note">Réglages indisponibles sur ce profil.</p>';
  const rows = keys
    .map((k) => settings.find((s) => s.key === k))
    .filter((s): s is SettingView => !!s);
  return rows.length
    ? rows.map(settingRow).join('')
    : '<p class="d-note">Aucun réglage pour ce module sur ce profil.</p>';
}
