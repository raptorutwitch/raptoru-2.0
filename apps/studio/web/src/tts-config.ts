import { esc } from './http.js';

// TTS prices and limits (Core rules): price tiers, message, queue. Moved from the Moderation view to the TTS page; same
// Core routes, same validation, applied by the Core to the next purchases.

interface ApiFailure {
  body?: { error?: string; message?: string; errors?: string[] };
}
const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/lab${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!res.ok)
    throw Object.assign(new Error(out.error ?? 'error'), { body: out });
  return out;
}
const errorText = (e: unknown) => {
  const b = (e as ApiFailure).body;
  if (b?.errors?.length) return b.errors.join(' ');
  return b?.error === 'invalid_rules'
    ? 'Configuration refusée par Core.'
    : (b?.message ?? b?.error ?? (e as Error).message);
};

export function mountTtsConfig(root: HTMLElement) {
  root.classList.add('mod-tool');
  const toast = (text: string, bad = false) => {
    const m = root.querySelector<HTMLElement>('[data-id="config-errors"]');
    if (m) {
      m.textContent = text;
      m.className = bad ? 'bad' : 'rs-muted';
    }
  };
  type Tier = {
    min: number;
    max: number | null;
    price: number;
    credit_cost: number;
    cooldown_seconds: number;
  };
  type Rules = {
    tiers: Tier[];
    max_chars: number;
    max_waiting_global: number;
    max_waiting_weight_ms: number | null;
    transition_gap_ms: number;
    max_per_viewer: number;
  };
  let draft: Rules | null = null;
  async function renderConfig(reload = true) {
    const center = root;
    let customized = false;
    let moduleState = '';
    if (reload || !draft) {
      const v = await api<{
        rules: Rules;
        customized: boolean;
        module_state: string;
      }>('/tts/rules');
      draft = structuredClone(v.rules);
      customized = v.customized;
      moduleState = v.module_state;
    }
    const d = draft!;
    const num = (field: string, value: number | null, attrs = '') =>
      `<input type="number" data-f="${field}" value="${value ?? ''}" ${attrs}>`;
    center.innerHTML = `<header class="mod-head"><h2>Paliers de prix</h2><span class="muted">${customized ? 'Valeurs personnalisées' : 'Valeurs par défaut (legacy)'} · appliquées par Core dès l’enregistrement${moduleState ? ` · module ${esc(moduleState)}` : ''}</span></header>
      <table class="mod-table mod-tiers"><thead><tr><th>Longueur min</th><th>Longueur max</th><th>Prix jetons</th><th>Crédits</th><th>Cooldown (s)</th><th></th></tr></thead><tbody>
      ${d.tiers
        .map(
          (
            t,
            i,
          ) => `<tr data-tier="${i}"><td>${num('min', t.min, 'min="1"')}</td><td>${num('max', t.max, `min="1" placeholder="${i === d.tiers.length - 1 ? 'ouvert' : ''}"`)}</td>
            <td>${num('price', t.price, 'min="0" step="100"')}</td><td>${num('credit_cost', t.credit_cost, 'min="0"')}</td><td>${num('cooldown_seconds', t.cooldown_seconds, 'min="0"')}</td>
            <td><button type="button" class="ghost" data-tier-del="${i}" ${d.tiers.length < 2 ? 'disabled' : ''}>Retirer</button></td></tr>`,
        )
        .join('')}</tbody></table>
      <p><button type="button" class="ghost" data-tier-add>Ajouter un palier</button> <span class="muted">Dernier palier sans max = ouvert.</span></p>
      <div class="mod-grid">
        <fieldset><legend>Message</legend><label>Longueur max <input type="number" data-g="max_chars" value="${d.max_chars}" min="1"></label></fieldset>
        <fieldset><legend>File</legend>
          <label>Nombre max en attente <input type="number" data-g="max_waiting_global" value="${d.max_waiting_global}" min="1"></label>
          <label>Durée max en attente (s, vide = aucune) <input type="number" data-g="max_waiting_weight_s" value="${d.max_waiting_weight_ms === null ? '' : Math.round(d.max_waiting_weight_ms / 1000)}" min="5"></label>
          <label>Délai entre deux TTS (ms) <input type="number" data-g="transition_gap_ms" value="${d.transition_gap_ms}" min="0" step="100"></label></fieldset>
        <fieldset><legend>Viewer</legend><label>TTS simultanés par viewer <input type="number" data-g="max_per_viewer" value="${d.max_per_viewer}" min="1"></label></fieldset>
      </div>
      <p class="bad" data-id="config-errors"></p>
      <div class="actions"><button type="button" data-config-save>Enregistrer</button><button type="button" class="ghost" data-config-reset>Restaurer les valeurs par défaut</button><button type="button" class="ghost" data-config-reload>Annuler les modifications</button></div>`;
  }
  function readDraft(): Rules {
    const d = structuredClone(draft!);
    const n = (v: string) => (v.trim() === '' ? null : Number(v));
    root.querySelectorAll<HTMLTableRowElement>('[data-tier]').forEach((row) => {
      const t = d.tiers[Number(row.dataset.tier)]!;
      for (const input of row.querySelectorAll<HTMLInputElement>('[data-f]')) {
        const f = input.dataset.f as keyof Tier;
        (t as Record<string, number | null>)[f] =
          f === 'max' ? n(input.value) : Number(input.value);
      }
    });
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-g]')) {
      const g = input.dataset.g!;
      if (g === 'max_waiting_weight_s')
        d.max_waiting_weight_ms =
          n(input.value) === null ? null : Number(input.value) * 1000;
      else (d as unknown as Record<string, number>)[g] = Number(input.value);
    }
    return d;
  }

  root.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-tier-add]') && draft) {
      draft = readDraft();
      const last = draft.tiers.at(-1)!;
      const min = (last.max ?? last.min) + 1;
      if (last.max === null) last.max = last.min;
      draft.tiers.push({
        min: Math.max(min, last.max + 1),
        max: null,
        price: last.price,
        credit_cost: last.credit_cost,
        cooldown_seconds: last.cooldown_seconds,
      });
      return void renderConfig(false);
    }
    const del = t.closest<HTMLElement>('[data-tier-del]');
    if (del && draft) {
      draft = readDraft();
      draft.tiers.splice(Number(del.dataset.tierDel), 1);
      return void renderConfig(false);
    }
    if (t.closest('[data-config-reload]')) return void renderConfig(true);
    if (t.closest('[data-config-save]') && draft) {
      const rules = readDraft();
      try {
        await api('/tts/rules', { rules });
        await renderConfig(true);
        return toast('Enregistré : appliqué aux prochains achats.');
      } catch (e) {
        root.querySelector<HTMLElement>(
          '[data-id="config-errors"]',
        )!.textContent = errorText(e);
        return;
      }
    }
    if (t.closest('[data-config-reset]')) {
      if (!confirm('Restaurer les valeurs TTS par défaut (legacy) ?')) return;
      try {
        await api('/tts/rules/reset', {});
        toast('Valeurs par défaut restaurées');
      } catch (e) {
        toast(errorText(e), true);
      }
      return void renderConfig(true);
    }
  });
  return {
    refresh: () =>
      renderConfig(true).catch((e: unknown) => {
        root.innerHTML = `<p class="bad">${esc(errorText(e))}</p>`;
      }),
  };
}
