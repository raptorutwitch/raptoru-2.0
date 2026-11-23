import { SOUND_FILE_RULES } from '@raptoru/schemas';
import { confirmBox, errText, fld, ic } from '../ds/ds.js';
import { ApiError, esc, postJson } from '../http.js';
import {
  CUT,
  clampCut,
  encodeWav,
  fadeEdges,
  nameFromFile,
  sameChannels,
  soundIdFor,
} from './soundboard-cut.js';
import { mediaUrl, peaksOf, wavePath } from './soundboard-wave.js';

// « Ajouter un son » et « Modifier l'extrait » (docs/SOUNDBOARD.md § Ajouter un son). Un fichier local, sa forme d'onde,
// deux poignées pour le début et la fin, l'écoute exacte du passage choisi, le nom et le prix. À la publication, Studio
// découpe vraiment l'extrait (le fichier publié commence au point choisi), l'envoie au Core qui le vérifie et le garde,
// puis crée ou met à jour le son : il est aussitôt dans la Soundboard des viewers. L'original reste sur ce PC pour
// recouper le son plus tard.

export interface EditableSound {
  id: string;
  label: string;
  default_label: string;
  source?: 'bank' | 'studio';
  file_id?: string | null;
  token_cost: number;
  credit_cost: number;
  volume: number;
  preview_url: string | null;
}

const SOURCE_MAX_BYTES = 50 * 1024 * 1024;
const SOURCE_MAX_S = 15 * 60;
const POINTS = 600;
const ACCEPT =
  'audio/*,.mp3,.wav,.ogg,.oga,.opus,.flac,.m4a,.aac,.webm,.weba,.mp4';
const REFUS: Record<string, string> = {
  not_wav: 'Le fichier découpé a été refusé par le Core : réessaie.',
  unsupported_wav: 'Le fichier découpé a été refusé par le Core : réessaie.',
  incomplete_file:
    'Le fichier est arrivé incomplet au Core : rien n’a été publié, réessaie.',
  duration_out_of_bounds: 'Un extrait dure entre 0,1 s et 20 s.',
  file_too_large: 'Extrait trop lourd (4 Mo au plus) : raccourcis-le.',
  sound_exists: 'Un son porte déjà cet identifiant : réessaie.',
  label_required: 'Donne un nom au son.',
  file_not_found: 'Le Core ne trouve pas le fichier : publie à nouveau.',
  sound_not_found: 'Ce son n’existe plus.',
  core_unavailable: 'Core injoignable : rien n’a été publié.',
  core_unreachable: 'Core injoignable : rien n’a été publié.',
  invalid_request: 'Valeur refusée : hors des limites.',
};
const secs = (s: number) =>
  s.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
/** Une graduation lisible quelle que soit la durée du fichier. */
const stepOf = (s: number) =>
  [0.25, 0.5, 1, 2, 5, 10, 30, 60].find((x) => s / x <= 24) ?? 120;

async function decode(bytes: ArrayBuffer) {
  // decodeAudioData garde les canaux du fichier, rééchantillonnés à 44,1 kHz : la découpe et l'écoute partent de là.
  return new OfflineAudioContext(1, 1, CUT.rate).decodeAudioData(
    bytes.slice(0),
  );
}

async function uploadFile(bytes: Uint8Array) {
  const r = await fetch('/api/sound-lab/files', {
    method: 'POST',
    headers: {
      'x-raptoru-studio': '1',
      'content-type': 'application/octet-stream',
    },
    body: bytes as BodyInit,
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok)
    throw new ApiError(
      r.status,
      String(body.error ?? `HTTP ${r.status}`),
      body,
    );
  return body as { file_id: string; duration_ms: number };
}

export function openSoundEditor(o: {
  /** Un son existant (modifier l'extrait, le nom, le prix ; supprimer), sinon un nouveau son. */
  sound?: EditableSound | null;
  onSaved: (s: EditableSound) => void;
  onDeleted?: (id: string) => void;
}) {
  const editing = o.sound ?? null;
  const d = document.createElement('dialog');
  d.className = 'd-dlg sbe';
  d.dataset.mod = 'soundboard';
  d.innerHTML = `<div class="sbe-h"><h2>${editing ? `Modifier « ${esc(editing.label)} »` : 'Ajouter un son'}</h2><button type="button" class="d-ib" data-x aria-label="Fermer">${ic('x')}</button></div>
    <div class="sbe-b">
      <label class="sbe-drop" data-drop>${ic('upload')}<b data-dropt>Choisis un fichier audio, ou dépose-le ici</b><small>MP3, WAV, OGG, FLAC, M4A… · l’extrait publié dure 20 s au plus</small><input type="file" accept="${ACCEPT}" data-file></label>
      <div class="sbe-ed" data-ed hidden>
        <div class="sbe-src"><span data-srcname></span><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-other>${ic('upload')}Autre fichier</button></div>
        <div class="sbe-wave" data-wave>
          <svg class="sbe-w0" data-w0 preserveAspectRatio="none" aria-hidden="true"><path/></svg>
          <svg class="sbe-w1" data-w1 preserveAspectRatio="none" aria-hidden="true"><path/></svg>
          <i class="sbe-sel"></i>
          <button type="button" class="sbe-hd" data-h="start" role="slider" aria-label="Début de l’extrait"></button>
          <button type="button" class="sbe-hd" data-h="end" role="slider" aria-label="Fin de l’extrait"></button>
          <i class="sbe-head" data-head hidden></i>
        </div>
        <div class="sbe-ruler" data-ruler></div>
        <div class="sbe-ctl">
          <button type="button" class="d-play go" data-listen aria-label="Écouter l’extrait">${ic('play')}</button>
          <label class="sbe-t"><span class="d-lb">Début</span><input type="number" step="0.01" min="0" data-t="start" aria-label="Début en secondes"><span>s</span></label>
          <label class="sbe-t"><span class="d-lb">Fin</span><input type="number" step="0.01" min="0" data-t="end" aria-label="Fin en secondes"><span>s</span></label>
          <span class="sbe-len" data-len></span>
        </div>
      </div>
      <p class="sbe-hint" data-hint role="status"></p>
      <div class="sbe-meta">
        <label class="sbe-name"><span class="d-lb">Nom affiché aux viewers</span><span class="d-fld"><input type="text" maxlength="40" data-name placeholder="Nom du son" autocomplete="off"></span></label>
        <div class="sb-num"><span class="d-lb">Jetons</span>${fld('data-price="token_cost" step="50" min="0" max="1000000" aria-label="Prix en Jetons"', editing?.token_cost ?? SOUND_FILE_RULES.defaultTokenCost, 'J')}</div>
        <div class="sb-num"><span class="d-lb">Crédits</span>${fld('data-price="credit_cost" min="0" max="100" aria-label="Prix en crédits"', editing?.credit_cost ?? SOUND_FILE_RULES.defaultCreditCost, 'cr')}</div>
      </div>
    </div>
    <div class="sbe-a">
      ${editing ? `<button type="button" class="d-btn ghost sbe-del" data-del>${ic('trash')}Supprimer</button>` : ''}
      ${editing?.source === 'bank' && editing.file_id ? `<button type="button" class="d-btn ghost" data-orig>${ic('hist')}Fichier d’origine</button>` : ''}
      <span class="d-sp"></span>
      <button type="button" class="d-btn ghost" data-x>Annuler</button>
      <button type="button" class="d-btn pri" data-save>${editing ? 'Enregistrer' : 'Publier le son'}</button>
    </div>`;
  document.body.append(d);
  d.showModal();
  const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
    d.querySelector<T>(s)!;
  const nameIn = $<HTMLInputElement>('[data-name]');
  const fileIn = $<HTMLInputElement>('[data-file]');
  const wave = $('[data-wave]');
  nameIn.value = editing?.label ?? '';

  let buffer: AudioBuffer | null = null;
  /** Les octets du fichier choisi (gardés sur ce PC pour recouper plus tard) ; null : l'extrait déjà publié. */
  let original: { bytes: ArrayBuffer; name: string } | null = null;
  let start = 0;
  let end = 0;
  /** La découpe telle qu'ouverte : sans changement, l'extrait n'est pas republié. */
  let opened = { start: 0, end: 0, fresh: false };
  let nameTouched = !!editing;
  let newId: string | null = null;
  let busy = false;
  let drag: 'start' | 'end' | null = null;
  let ctx: AudioContext | null = null;
  let playing: {
    node: AudioBufferSourceNode;
    t0: number;
    from: number;
  } | null = null;
  let raf = 0;

  const hint = (text: string, bad = false) => {
    const el = $('[data-hint]');
    el.textContent = text;
    el.classList.toggle('bad', bad);
  };
  const duration = () => buffer?.duration ?? 0;

  // --- Le fichier --------------------------------------------------------------------------------------------------------
  async function load(
    bytes: ArrayBuffer,
    name: string,
    cut: { start: number; end: number } | null,
    keep: boolean,
  ) {
    stopListen();
    hint('Lecture du fichier…');
    let decoded: AudioBuffer;
    try {
      decoded = await decode(bytes);
    } catch {
      hint(
        'Ce fichier n’est pas un son lisible (MP3, WAV, OGG, FLAC, M4A…).',
        true,
      );
      return;
    }
    if (decoded.duration > SOURCE_MAX_S)
      return hint('Fichier trop long : 15 minutes au plus.', true);
    if (decoded.duration < CUT.minS)
      return hint('Son trop court : 0,1 s au moins.', true);
    buffer = decoded;
    original = keep ? { bytes, name } : null;
    ({ start, end } = cut
      ? clampCut(cut.start, cut.end, decoded.duration)
      : clampCut(0, Math.min(decoded.duration, CUT.maxS), decoded.duration));
    opened = { start, end, fresh: keep && !cut };
    if (!nameTouched) nameIn.value = nameFromFile(name);
    $('[data-srcname]').textContent =
      `${name} · ${secs(decoded.duration)} s${decoded.numberOfChannels > 1 ? ' · stéréo' : ''}`;
    $('[data-drop]').hidden = true;
    $('[data-ed]').hidden = false;
    drawWave();
    paint();
    hint(
      decoded.duration > CUT.maxS
        ? 'Fichier de plus de 20 s : place les poignées sur le passage à garder.'
        : 'Déplace les poignées pour choisir le début et la fin, puis écoute.',
    );
  }
  async function pickFile(file: File) {
    if (file.size > SOURCE_MAX_BYTES)
      return hint('Fichier trop lourd : 50 Mo au plus.', true);
    await load(await file.arrayBuffer(), file.name, null, true);
  }
  /** Un son existant : son original gardé sur ce PC s'il existe, sinon le fichier qu'il joue aujourd'hui. */
  async function openExisting(s: EditableSound) {
    if (!s.preview_url) {
      $('[data-drop]').hidden = true;
      return hint('Ce son tire un son au hasard : il n’a pas de fichier.');
    }
    hint('Lecture du fichier…');
    if (s.file_id) {
      const r = await fetch(`/api/sound-lab/sources/${s.file_id}`, {
        headers: { 'x-raptoru-studio': '1' },
      }).catch(() => null);
      if (r?.ok) {
        const cut = JSON.parse(
          decodeURIComponent(r.headers.get('x-raptoru-cut') ?? '{}'),
        ) as { name?: string; start_ms?: number; end_ms?: number };
        return load(
          await r.arrayBuffer(),
          cut.name || s.label,
          { start: (cut.start_ms ?? 0) / 1000, end: (cut.end_ms ?? 0) / 1000 },
          true,
        );
      }
    }
    const r = await fetch(mediaUrl(s.preview_url)).catch(() => null);
    if (!r?.ok)
      return hint(
        'Fichier actuel illisible : choisis un fichier pour le remplacer.',
        true,
      );
    await load(
      await r.arrayBuffer(),
      s.preview_url.split('/').pop() ?? s.label,
      null,
      false,
    );
    $('[data-drop]').hidden = true;
  }

  // --- Dessin -------------------------------------------------------------------------------------------------------------
  function drawWave() {
    if (!buffer) return;
    const all = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      peaksOf(buffer!.getChannelData(c), POINTS),
    );
    const peaks = all[0]!.map((_, i) => Math.max(...all.map((p) => p[i]!)));
    const top = Math.max(0.05, ...peaks);
    const path = wavePath(
      peaks.map((p) => p / top),
      60,
    );
    for (const svg of d.querySelectorAll('.sbe-wave svg')) {
      svg.setAttribute('viewBox', `0 0 ${POINTS} 60`);
      svg.querySelector('path')!.setAttribute('d', path);
    }
    const s = buffer.duration;
    const step = stepOf(s);
    let ruler = '';
    for (let t = 0; t <= s + 1e-9; t += step)
      ruler += `<i style="left:${(t / s) * 100}%"><b>${t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : t.toLocaleString('fr-FR')}</b></i>`;
    $('[data-ruler]').innerHTML = ruler;
  }
  function paint() {
    const s = duration() || 1;
    wave.style.setProperty('--s', `${(start / s) * 100}%`);
    wave.style.setProperty('--e', `${(end / s) * 100}%`);
    for (const [k, v] of [
      ['start', start],
      ['end', end],
    ] as const) {
      const h = $(`[data-h="${k}"]`);
      h.setAttribute('aria-valuemin', '0');
      h.setAttribute('aria-valuemax', String(duration()));
      h.setAttribute('aria-valuenow', String(v));
      h.setAttribute('aria-valuetext', `${secs(v)} secondes`);
      const input = $<HTMLInputElement>(`[data-t="${k}"]`);
      if (document.activeElement !== input) input.value = v.toFixed(2);
      input.max = String(duration());
    }
    $('[data-len]').innerHTML =
      `Extrait <b>${secs(end - start)} s</b> <span class="d-faint">/ 20 s max</span>`;
  }
  function set(which: 'start' | 'end', t: number) {
    const next = clampCut(
      which === 'start' ? t : start,
      which === 'end' ? t : end,
      duration(),
      which,
    );
    if (next.start === start && next.end === end) return;
    ({ start, end } = next);
    stopListen();
    paint();
  }
  const timeAt = (x: number) => {
    const r = wave.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * duration();
  };

  // --- Écoute exacte du passage choisi -------------------------------------------------------------------------------------
  function stopListen() {
    const was = playing;
    playing = null;
    try {
      was?.node.stop();
    } catch {
      /* déjà fini */
    }
    cancelAnimationFrame(raf);
    $('[data-head]').hidden = true;
    const b = $('[data-listen]');
    b.innerHTML = ic('play');
    b.setAttribute('aria-label', 'Écouter l’extrait');
  }
  function listen() {
    if (playing) return stopListen();
    if (!buffer) return;
    ctx ??= new AudioContext();
    void ctx.resume();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = (editing?.volume ?? 100) / 100;
    node.connect(gain).connect(ctx.destination);
    node.start(0, start, end - start);
    playing = { node, t0: ctx.currentTime, from: start };
    node.onended = () => {
      if (playing?.node === node) stopListen();
    };
    const b = $('[data-listen]');
    b.innerHTML = ic('stop');
    b.setAttribute('aria-label', 'Arrêter l’écoute');
    const head = $('[data-head]');
    head.hidden = false;
    const follow = () => {
      if (!playing || !ctx) return;
      const t = playing.from + (ctx.currentTime - playing.t0);
      head.style.left = `${(Math.min(t, end) / duration()) * 100}%`;
      raf = requestAnimationFrame(follow);
    };
    follow();
  }

  // --- Découpe et publication ------------------------------------------------------------------------------------------------
  /** L'extrait réel : les échantillons du passage choisi, mono si les deux canaux sont identiques, en WAV 16 bits. */
  async function render() {
    const b = buffer!;
    const from = Math.round(start * b.sampleRate);
    const to = Math.round(end * b.sampleRate);
    const parts = Array.from(
      { length: Math.min(2, b.numberOfChannels) },
      (_, c) => b.getChannelData(c).subarray(from, to),
    );
    const k = sameChannels(parts) ? 1 : 2;
    const frames = Math.max(1, Math.round((end - start) * CUT.rate));
    const off = new OfflineAudioContext(k, frames, CUT.rate);
    const node = off.createBufferSource();
    node.buffer = b;
    node.connect(off.destination);
    node.start(0, start, end - start);
    const out = await off.startRendering();
    const channels = Array.from({ length: k }, (_, c) =>
      out.getChannelData(c).slice(),
    );
    fadeEdges(channels, CUT.rate);
    return encodeWav(channels, CUT.rate);
  }
  function cutChanged() {
    return (
      !!buffer && (opened.fresh || start !== opened.start || end !== opened.end)
    );
  }
  async function save() {
    if (busy) return;
    const label = nameIn.value.trim();
    if (!label) {
      nameIn.focus();
      return hint('Donne un nom au son.', true);
    }
    const price = (k: string) =>
      Math.round(Number($<HTMLInputElement>(`[data-price="${k}"]`).value));
    const token_cost = price('token_cost');
    const credit_cost = price('credit_cost');
    if (!Number.isFinite(token_cost) || !Number.isFinite(credit_cost))
      return hint('Prix invalide.', true);
    if (!editing && !buffer) return hint('Choisis d’abord un fichier.', true);
    busy = true;
    const btn = $('[data-save]');
    btn.classList.add('is-busy');
    stopListen();
    try {
      let file: { file_id: string } | null = null;
      if (cutChanged()) {
        hint('Découpe de l’extrait…');
        const wav = await render();
        hint('Publication au Core…');
        file = await uploadFile(wav);
      }
      let saved: EditableSound;
      if (!editing) {
        newId ??= soundIdFor(label);
        saved = await postJson<EditableSound>('/api/sound-lab/sounds', {
          id: newId,
          label,
          file_id: file!.file_id,
          token_cost,
          credit_cost,
        });
      } else {
        const patch: Record<string, unknown> = {};
        if (label !== editing.label) patch.label = label;
        if (token_cost !== editing.token_cost) patch.token_cost = token_cost;
        if (credit_cost !== editing.credit_cost)
          patch.credit_cost = credit_cost;
        if (file && file.file_id !== editing.file_id)
          patch.file_id = file.file_id;
        saved = Object.keys(patch).length
          ? await postJson<EditableSound>(
              `/api/sound-lab/sounds/${encodeURIComponent(editing.id)}`,
              patch,
            )
          : editing;
      }
      // L'original et sa découpe restent sur ce PC (pour recouper plus tard) ; un échec ici ne défait rien.
      if (file && original)
        void fetch(
          `/api/sound-lab/sources?${new URLSearchParams({
            file_id: file.file_id,
            name: original.name,
            start_ms: String(Math.round(start * 1000)),
            end_ms: String(Math.round(end * 1000)),
          })}`,
          {
            method: 'POST',
            headers: { 'x-raptoru-studio': '1' },
            body: original.bytes,
          },
        ).catch(() => {});
      close();
      o.onSaved(saved);
    } catch (e) {
      const x = e as ApiError;
      hint(
        x.code === 'duplicate_file'
          ? `Cet extrait est déjà publié : « ${String(x.details?.label ?? x.details?.sound_id ?? '?')} ».`
          : errText(e, REFUS),
        true,
      );
    } finally {
      busy = false;
      btn.classList.remove('is-busy');
    }
  }
  async function remove() {
    if (!editing || busy) return;
    const ok = await confirmBox({
      title: `Supprimer « ${editing.label} » ?`,
      body:
        editing.source === 'bank'
          ? 'Il disparaît de la Soundboard des viewers (achats et aléatoire). C’est un son d’origine : il ne pourra pas être rétabli depuis Studio. Pour le retirer un temps, coupe-le plutôt.'
          : 'Il disparaît de la Soundboard des viewers (achats et aléatoire). Un achat déjà accepté est quand même joué ; l’historique est gardé.',
      yes: 'Supprimer',
    });
    if (!ok) return;
    busy = true;
    try {
      await postJson(
        `/api/sound-lab/sounds/${encodeURIComponent(editing.id)}/delete`,
        {},
      );
      close();
      o.onDeleted?.(editing.id);
    } catch (e) {
      hint(errText(e, REFUS), true);
    } finally {
      busy = false;
    }
  }
  async function backToOriginal() {
    if (!editing || busy) return;
    busy = true;
    try {
      const saved = await postJson<EditableSound>(
        `/api/sound-lab/sounds/${encodeURIComponent(editing.id)}`,
        { file_id: null },
      );
      close();
      o.onSaved(saved);
    } catch (e) {
      hint(errText(e, REFUS), true);
    } finally {
      busy = false;
    }
  }
  function close() {
    stopListen();
    void ctx?.close().catch(() => {});
    ctx = null;
    d.close();
    setTimeout(() => d.remove(), 240);
  }

  // --- Interaction ---------------------------------------------------------------------------------------------------------
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!busy) close();
  });
  d.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.matches('[data-x]')) return void (busy || close());
    if (b.matches('[data-save]')) return void save();
    if (b.matches('[data-listen]')) return listen();
    if (b.matches('[data-other]')) return fileIn.click();
    if (b.matches('[data-del]')) return void remove();
    if (b.matches('[data-orig]')) return void backToOriginal();
  });
  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (f) void pickFile(f);
  });
  d.addEventListener('dragover', (e) => {
    e.preventDefault();
    $('[data-drop]').classList.add('is-over');
  });
  d.addEventListener('dragleave', () =>
    $('[data-drop]').classList.remove('is-over'),
  );
  d.addEventListener('drop', (e) => {
    e.preventDefault();
    $('[data-drop]').classList.remove('is-over');
    const f = e.dataTransfer?.files[0];
    if (f) void pickFile(f);
  });
  nameIn.addEventListener('input', () => (nameTouched = true));
  d.addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement;
    const k = i.dataset.t as 'start' | 'end' | undefined;
    if (k && i.value.trim() !== '') set(k, Number(i.value));
    if (k) paint();
  });
  wave.addEventListener('pointerdown', (e) => {
    if (!buffer || e.button !== 0) return;
    const t = timeAt(e.clientX);
    drag =
      ((e.target as HTMLElement).closest<HTMLElement>('[data-h]')?.dataset.h as
        'start' | 'end' | undefined) ??
      (Math.abs(t - start) <= Math.abs(t - end) ? 'start' : 'end');
    wave.setPointerCapture(e.pointerId);
    $(`[data-h="${drag}"]`).focus();
    set(drag, t);
    e.preventDefault();
  });
  wave.addEventListener('pointermove', (e) => {
    if (drag) set(drag, timeAt(e.clientX));
  });
  const release = () => (drag = null);
  wave.addEventListener('pointerup', release);
  wave.addEventListener('pointercancel', release);
  // Au clavier : flèches = 10 ms (Maj : 100 ms), Début / Fin du fichier.
  wave.addEventListener('keydown', (e) => {
    const k = (e.target as HTMLElement).dataset.h as
      'start' | 'end' | undefined;
    if (!k) return;
    const now = k === 'start' ? start : end;
    const step = e.shiftKey ? 0.1 : 0.01;
    const to =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? now - step
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? now + step
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? duration()
              : null;
    if (to === null) return;
    e.preventDefault();
    set(k, to);
  });

  if (editing) void openExisting(editing);
  else nameIn.value = '';
  return { close };
}
