import {
  esc,
  fld,
  fmt,
  grp,
  hhmm,
  ic,
  numrow,
  row,
  seg,
  stateChip,
  sw,
} from '../ds/ds.js';
import {
  HINT_COLORS,
  HINT_EMOJIS,
  HINT_FONTS,
  HINT_HIGHLIGHTS,
  PRESETS,
  type CmdList,
  type Config,
  type Status,
} from './tombola-model.js';
import { bandProblems, MAX_BANDS, type BandsDraft } from '../tombola-bands.js';
import { schedBtn, schedLine, sparkHtml } from './tombola-ticket.js';

// Le panneau : tous les réglages de la Tombola, à la demande, avec recherche. Rien ne se lance d'ici : la scène et le ticket
// montrent le résultat. Chaque `data-*` est lu par les écouteurs de la page.

export interface PanelUi {
  draft: BandsDraft;
  /** Vrai dès qu'une tranche a bougé : Enregistrer / Annuler apparaissent. */
  bandsDirty: boolean;
  editing: { list: CmdList; i: number } | null;
  cmdErr: Record<CmdList, string>;
  playing: string | null;
  moduleState: 'active' | 'paused' | 'disabled';
}

function bandsGroup(ui: PanelUi) {
  const { draft, bandsDirty } = ui;
  const under = draft.bands
    .filter((b) => b.to <= 20_000)
    .reduce((a, b) => a + (b.pct || 0), 0);
  const problems = bandsDirty ? bandProblems(draft) : [];
  return grp(
    'Tranches aléatoires',
    'dice',
    `<div class="tb-bandh" data-k="tranche montant aléatoire"><span>De</span><span>À</span><span>Part</span><span></span></div>
    ${draft.bands
      .map(
        (b, i) =>
          `<div class="tb-band" data-k="tranche montant aléatoire">${fld(`data-band="${i}.from" min="0" aria-label="Tranche ${i + 1}, début"`, b.from)}${fld(`data-band="${i}.to" min="1" aria-label="Tranche ${i + 1}, fin"`, b.to)}${fld(`data-band="${i}.pct" min="0" max="100" step="any" aria-label="Tranche ${i + 1}, part des tombolas"`, b.pct, '%')}${draft.bands.length > 1 ? `<button type="button" class="d-ib" data-band-del="${i}" aria-label="Supprimer la tranche ${i + 1}">${ic('trash')}</button>` : '<span></span>'}</div>`,
      )
      .join('')}
    ${draft.bands.length < MAX_BANDS ? `<div class="d-row" data-k="tranche ajouter"><button type="button" class="d-btn ghost sm" data-band-add>${ic('plus')}Ajouter une tranche</button></div>` : ''}
    ${numrow('Arrondi au pas de', fld('data-draft="step" min="1" max="100000"', draft.step), 'pas tranche montant')}
    <div class="d-row col" data-k="tranche répartition">${bandsDirty ? '' : sparkHtml({ random: draft } as Config)}<small>≈ ${Math.round(under)} % des tombolas sous 20 000. Plus le montant monte, plus il est rare, y compris dans chaque tranche.</small></div>
    ${
      bandsDirty
        ? `<div class="d-row col" data-k="tranche enregistrer">${
            problems.length
              ? `<ul class="tb-probs">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
              : '<small>Prêt à enregistrer.</small>'
          }<span class="tb-line"><button type="button" class="d-btn pri sm" data-bands="save" ${problems.length ? 'disabled' : ''}>Enregistrer</button><button type="button" class="d-btn ghost sm" data-bands="cancel">Annuler</button></span></div>`
        : ''
    }`,
    'récompense tranches',
  );
}

function cmdEditor(c: Config, list: CmdList, ui: PanelUi, label: string) {
  const items = c[list];
  const item = (cmd: string, i: number) =>
    ui.editing?.list === list && ui.editing.i === i
      ? `<div class="tb-cmd"><label class="d-fld"><input type="text" data-cmd-edit-in="${list}:${i}" value="${esc(cmd)}" maxlength="25" aria-label="Modifier ${esc(cmd)}"></label><button type="button" class="d-ib" data-cmd-save="${list}:${i}" aria-label="Valider">${ic('check')}</button><button type="button" class="d-ib" data-cmd-cancel aria-label="Annuler">${ic('x')}</button></div>`
      : `<div class="tb-cmd"><span class="d-tag ${i === 0 ? 'ok' : ''}">${esc(cmd)}</span><small>${i === 0 ? 'principale' : 'alias'}</small><span class="d-sp"></span>${i > 0 ? `<button type="button" class="d-ib" data-cmd-main="${list}:${i}" aria-label="Faire de ${esc(cmd)} la commande principale" title="Faire la commande principale">${ic('star')}</button>` : ''}<button type="button" class="d-ib" data-cmd-edit="${list}:${i}" aria-label="Modifier ${esc(cmd)}">${ic('note')}</button>${items.length > 1 ? `<button type="button" class="d-ib" data-cmd-del="${list}:${i}" aria-label="Supprimer ${esc(cmd)}">${ic('trash')}</button>` : ''}</div>`;
  return `<div class="d-row col" data-k="${esc(label.toLowerCase())} commande alias chat"><span>${esc(label)}</span>
    ${items.map(item).join('')}
    ${
      items.length < 12
        ? `<form class="tb-cmdadd" data-cmd-form="${list}"><label class="d-fld"><input type="text" data-cmd-add-in="${list}" placeholder="${list === 'join_commands' ? '!alias' : '!commande'}" maxlength="25" aria-label="Nouvelle commande"></label><button class="d-ib" aria-label="Ajouter la commande">${ic('plus')}</button></form>`
        : '<small>12 commandes maximum.</small>'
    }
    <small class="tb-err" data-cmd-err="${list}" ${ui.cmdErr[list] ? '' : 'hidden'}>${esc(ui.cmdErr[list])}</small></div>`;
}

function hintGroup(c: Config) {
  const h = c.overlay_hint;
  const st = h.style;
  const swatch = (
    k: 'color' | 'highlight',
    v: string | null,
    label: string,
    look: string,
  ) =>
    `<button type="button" class="tb-sw ${st[k] === v ? 'on' : ''}" data-hstyle="${k}:${v ?? ''}" aria-label="${esc(label)}" title="${esc(label)}" style="${look}"></button>`;
  const custom =
    h.mode === 'custom'
      ? `<div class="d-row col" data-k="message personnalisé texte overlay"><label class="d-fld"><input type="text" data-hint-in maxlength="60" placeholder="Texte affiché sur l’overlay" value="${esc(h.text)}" aria-label="Message affiché sur l’overlay"><span data-hint-count>${h.text.length}/60</span></label><div class="tb-emojis">${HINT_EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-label="Insérer ${e}">${e}</button>`).join('')}</div><small data-hint-lines>Vide : aucune instruction à l’écran.</small></div>
      <div class="d-row col" data-k="police message overlay"><span>Police</span>${seg(
        'data-hfont',
        (
          [
            ['segoe', 'Standard'],
            ['bahnschrift', 'Condensée'],
            ['trebuchet', 'Arrondie'],
            ['georgia', 'Serif'],
          ] as const
        ).map(([k, l]) => [
          k,
          `<span style="font-family:${HINT_FONTS[k]}">${l}</span>`,
        ]),
        st.font,
        'block',
      )}</div>
      <div class="d-row" data-k="couleur gras italique message overlay"><span>Couleur</span><span class="tb-swatches">${HINT_COLORS.map(([v, l]) => swatch('color', v, l, `background:${v ?? 'var(--ink3)'}`)).join('')}<input type="color" class="tb-pick" data-hcolor value="${st.color ?? '#93a0b2'}" aria-label="Autre couleur" title="Autre couleur"></span></div>
      <div class="d-row" data-k="gras italique message overlay"><span>Style</span><span class="tb-swatches"><button type="button" class="d-tag ${st.bold ? 'ok' : 'off'}" data-hstyle="bold" aria-pressed="${st.bold}"><b>Gras</b></button><button type="button" class="d-tag ${st.italic ? 'ok' : 'off'}" data-hstyle="italic" aria-pressed="${st.italic}"><i>Italique</i></button></span></div>
      <div class="d-row" data-k="surlignage message overlay"><span>Surlignage</span><span class="tb-swatches">${HINT_HIGHLIGHTS.map(([v, l]) => swatch('highlight', v, l, v ? `background:${v}` : '')).join('')}</span></div>`
      : '';
  return grp(
    'Instruction à l’écran',
    'eye',
    `<div class="d-row col" data-k="instruction overlay texte message"><span>Sous le bloc de la Tombola</span>${seg(
      'data-hint',
      [
        ['none', 'Masquée'],
        ['join', esc(c.join_commands[0]!)],
        ['custom', 'Message'],
      ],
      h.mode,
      'block',
    )}<small>Affichage seulement : les commandes du chat ne changent pas.</small></div>${custom}`,
    'overlay instruction',
  );
}

function namesGroup(c: Config, s: Status) {
  const l = c.labels;
  const kind = c.amount_mode === 'giveaway' ? 'giveaway' : 'normal';
  const title = (k: 'open' | 'paused' | 'ended' | 'cancelled') =>
    (s.titles?.[kind]?.[k] ?? []).join(' ').trim();
  const quick: [string | null, string, 'f' | 'm'][] = [
    [null, 'Automatique', 'f'],
    ['Tombola', 'Tombola', 'f'],
    ['Giveaway', 'Giveaway', 'm'],
    ['Tirage', 'Tirage', 'm'],
    ['Concours', 'Concours', 'm'],
  ];
  return grp(
    'Nom et textes',
    'note',
    `<div class="d-row" data-k="nom affiché overlay"><span>Nom affiché</span><label class="d-fld tb-wide"><input type="text" data-label="event_name" maxlength="16" placeholder="${kind === 'giveaway' ? 'Giveaway' : 'Tombola'}" value="${esc(l.event_name ?? '')}" aria-label="Nom affiché"></label></div>
    <div class="d-row col" data-k="nom affiché overlay"><span class="d-tags">${quick.map(([v, t, g]) => `<button type="button" class="d-tag ${(l.event_name ?? null) === v ? 'ok' : 'off'}" data-lname="${v ?? ''}" data-lgender-set="${g}">${t}</button>`).join('')}</span></div>
    ${
      l.event_name
        ? `<div class="d-row col" data-k="accord masculin féminin nom"><span>Accord</span>${seg(
            'data-lgender',
            [
              ['f', 'Féminin, terminée'],
              ['m', 'Masculin, terminé'],
            ],
            l.event_gender,
            'block',
          )}</div>`
        : ''
    }
    <div class="d-row col" data-k="nom affiché titres overlay extension"><small>Sur l’overlay : ${esc(title('open'))} · ${esc(title('paused'))} · ${esc(title('ended'))} · ${esc(title('cancelled'))}. Extension au repos : ${esc(s.titles?.idle ?? '')}.</small></div>
    <div class="d-row col" data-k="titre aucun participant"><span>Titre sans participant</span><label class="d-fld"><input type="text" data-label="empty_title" maxlength="28" placeholder="${esc(title('ended'))}" value="${esc(l.empty_title ?? '')}" aria-label="Titre si aucun participant"></label></div>
    <div class="d-row col" data-k="message aucun participant"><span>Message sans participant</span><label class="d-fld"><input type="text" data-label="empty_message" maxlength="40" value="${esc(l.empty_message)}" aria-label="Message si aucun participant"></label></div>`,
    'affichage nom libellés textes',
  );
}

function durationsGroup(c: Config) {
  const d = c.display;
  const f = (
    k: keyof Config['display'],
    label: string,
    min: number,
    max: number,
  ) =>
    numrow(
      label,
      fld(`data-display="${k}" min="${min}" max="${max}"`, d[k], 's'),
      'durée affichage overlay',
    );
  return `${grp(
    'Durées sur l’overlay',
    'clock',
    `${f('intro_s', 'Annonce d’ouverture', 0, 15)}${f('drawing_s', 'Tirage en cours', 1, 15)}
    ${numrow('Inscription confirmée', fld(`data-display="join_feedback_ms" min="0.6" max="5" step="0.1"`, (d.join_feedback_ms / 1000).toFixed(1), 's'), 'feedback durée')}
    ${f('result_normal_s', 'Résultat', 5, 120)}${f('result_super_s', 'Résultat Super', 5, 120)}${f('result_full_s', 'Résultat Full oseille', 5, 120)}${f('result_giveaway_s', 'Résultat Giveaway', 5, 120)}
    ${f('cancelled_s', 'Tombola annulée', 2, 30)}${f('empty_s', 'Aucun participant', 2, 30)}`,
    'affichage durées',
  )}
  ${grp(
    'Résultat dans l’extension',
    'ext',
    `${f('stream_margin_s', 'Décalage après le stream', 0, 60)}${f('extension_idle_return_s', 'Retour à l’accueil', 3, 300)}
    <div class="d-row col" data-k="décalage anti spoil extension"><small>Le stream a du retard sur la réalité : l’extension attend la fin de l’animation, plus ce décalage, jamais avant. Commun à tous les viewers, appliqué aux prochaines manches.</small></div>
    <div class="d-row" data-k="comparer extension overlay"><span>Comparer avec l’overlay</span><button type="button" class="d-btn sm" data-compare>${ic('ext')}Ouvrir</button></div>`,
    'extension anti spoil',
  )}`;
}

function surprisesGroups(c: Config, s: Status) {
  return `${grp(
    'Super Tombola',
    'star',
    `${row('Activée', sw(c.super.enabled, 'data-sw="super.enabled"', 'Super Tombola', { gold: true }), 'super')}
    ${numrow('Jackpot', fld('data-cfg="super.jackpot" min="1" max="10000000" step="10000"', c.super.jackpot), 'super montant')}
    ${numrow('Chance, 1 sur', fld('data-cfg="super.one_in" min="2" max="1000000" step="10"', c.super.one_in), 'super probabilité')}
    ${row(
      'Monnaie',
      `<label class="d-fld"><select data-cfg="super.currency_id" aria-label="Monnaie du jackpot">${s.currencies
        .filter((k) => k.available)
        .map(
          (k) =>
            `<option value="${esc(k.id)}" ${k.id === c.super.currency_id ? 'selected' : ''}>${esc(k.label)}</option>`,
        )
        .join('')}</select></label>`,
      'super',
    )}`,
    'super',
  )}
  ${grp(
    'Full oseille',
    'crown',
    `${row('Activée', sw(c.full.enabled, 'data-sw="full.enabled"', 'Full oseille', { gold: true }), 'full')}
    ${numrow('Chance à chaque manche', fld('data-cfg="full.chance_pct" min="0" max="100" step="0.5"', c.full.chance_pct, '%'), 'full probabilité')}
    <div class="d-row col" data-k="full"><small>Un seul gagnant rafle toute la cagnotte. Jamais annoncée à l’ouverture.</small></div>`,
    'full',
  )}`;
}

function autoGroup(c: Config, s: Status) {
  const a = c.scheduler;
  const t = s.scheduler.timing;
  const custom = a.preset === 'custom';
  const mins = (k: string, v: number, label: string, min: number) =>
    numrow(
      label,
      fld(
        `data-sched-min="${k}" min="${min}" max="360"`,
        Math.round(v / 60),
        'min',
      ),
      'automatique délai intervalle',
    );
  return grp(
    'Automatique',
    'bolt',
    `${row('Pendant le stream', sw(a.enabled, 'data-sw="scheduler.enabled"', 'Tombola automatique'), 'automatique')}
    <div class="d-row" data-k="fréquence automatique"><span>Fréquence</span><label class="d-fld tb-wide"><select data-preset aria-label="Fréquence">${PRESETS.map(([k, l]) => `<option value="${k}" ${a.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${
      custom
        ? `${mins('first_delay_s', a.first_delay_s, 'Premier délai', 0)}
        <div class="d-row col" data-k="intervalle fixe aléatoire"><span>Intervalle</span>${seg(
          'data-sched-mode',
          [
            ['fixed', 'Fixe'],
            ['random', 'Aléatoire'],
          ],
          a.mode,
          'block',
        )}</div>
        ${a.mode === 'fixed' ? mins('interval_s', a.interval_s, 'Toutes les', 1) : `${mins('interval_min_s', a.interval_min_s, 'Entre', 1)}${mins('interval_max_s', a.interval_max_s, 'Et', 1)}`}`
        : `<div class="d-row col" data-k="automatique délai"><small>Premier lancement après ${Math.round(t.first_delay_s / 60)} min, puis toutes les ${Math.round(t.min_s / 60)} à ${Math.round(t.max_s / 60)} min, comptées depuis la fin de la manche précédente.</small></div>`
    }
    <div class="d-row col" data-k="automatique état prochaine pause reprise"><small data-z="sched2">${schedLine(s)}</small><span>${schedBtn(s)}</span></div>
    <div class="d-row col" data-k="automatique"><small>Une seule manche à la fois. Liée au stream : elle démarre avec lui.</small></div>`,
    'automatique',
  );
}

function soundsGroup(c: Config, ui: PanelUi) {
  const slot = (
    k: 'normal' | 'super' | 'giveaway',
    label: string,
    fallback: string,
  ) => {
    const s = c.launch_sounds[k];
    const on = ui.playing === k;
    return `<div class="tb-slot" data-k="son ouverture ${label.toLowerCase()}">
      <button type="button" class="d-ib" data-sound-play="${k}" aria-label="${on ? 'Arrêter' : 'Écouter'} ${esc(label)}" ${s ? '' : 'disabled'}>${ic(on ? 'stop' : 'play')}</button>
      <p><b>${esc(label)}</b><small>${s ? `${esc(s.name)} · ${s.format.toUpperCase()} · ${fmt(Math.round(s.size_bytes / 1024))} Ko` : esc(fallback)}</small></p>
      <button type="button" class="d-btn ghost sm" data-sound-pick="${k}">${s ? 'Remplacer' : 'Importer'}</button>
      <input type="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" data-sound-file="${k}" hidden>
      ${s ? `<button type="button" class="d-ib" data-sound-del="${k}" aria-label="Supprimer le son ${esc(label)}">${ic('trash')}</button><label class="tb-vol">${ic('vol')}<input type="range" class="d-range" min="0" max="100" value="${s.volume}" data-sound-vol="${k}" aria-label="Volume ${esc(label)}"><span>${s.volume}</span></label>` : ''}
    </div>`;
  };
  return grp(
    'Sons d’ouverture',
    'vol',
    `${slot('normal', 'Tombola', 'Aucun son')}${slot('super', 'Super', 'Son de la Tombola')}${slot('giveaway', 'Giveaway', 'Son de la Tombola')}
    <div class="d-row col" data-k="son ouverture"><small>MP3, WAV ou OGG, 5 Mo maximum. Joué une seule fois par la source OBS, jamais par Studio : l’aperçu reste muet. Full oseille n’a pas de son, elle reste une surprise.</small></div>`,
    'sons',
  );
}

function streamGroup(s: Status) {
  const st = s.stream;
  const state = !st
    ? stateChip('off', 'Hors ligne')
    : stateChip('live', st.source === 'twitch' ? 'En direct' : 'Live simulé');
  const btn = !st
    ? s.simulated_stream === false
      ? ''
      : '<button type="button" class="d-btn sm" data-stream="start">Simuler le début</button>'
    : st.source === 'twitch'
      ? ''
      : '<button type="button" class="d-btn sm" data-stream="end">Simuler la fin</button>';
  return grp(
    'Stream',
    'live',
    `<div class="d-row" data-k="stream live simulation en direct">${state}${btn}</div>
    <div class="d-row col" data-k="stream live simulation"><small>${
      st
        ? `Depuis ${hhmm(st.started_at)}. ${st.source === 'twitch' ? 'La fin vient de Twitch.' : ''}`
        : s.simulated_stream === false
          ? 'Le début vient de Twitch.'
          : 'Le chat simulé et le vrai chat Twitch se règlent dans Simulation.'
    }</small></div>`,
    'stream simulation',
  );
}

export function panelHtml(c: Config, s: Status, ui: PanelUi) {
  return `${bandsGroup(ui)}
  ${grp(
    'Participation',
    'chat',
    `${cmdEditor(c, 'join_commands', ui, 'Commandes d’inscription')}
    ${row('Bouton dans l’extension', sw(c.extension_button, 'data-sw="extension_button"', 'Bouton dans l’extension'), 'extension participation')}
    ${cmdEditor(c, 'cancel_commands', ui, 'Annulation par un modérateur')}
    <div class="d-row col" data-k="inscription participation"><small>Une seule inscription par viewer, quelle que soit la source. Le rôle est vérifié : un viewer ne peut jamais annuler.</small></div>`,
    'participation',
  )}
  ${surprisesGroups(c, s)}
  ${autoGroup(c, s)}
  ${soundsGroup(c, ui)}
  ${hintGroup(c)}
  ${namesGroup(c, s)}
  ${durationsGroup(c)}
  ${streamGroup(s)}
  ${grp(
    'Source OBS',
    'eye',
    `<div class="d-row col" data-k="adresse url source navigateur obs"><label class="d-fld"><input type="text" readonly value="${esc(s.overlay_url)}" aria-label="Adresse de la source OBS"></label><button type="button" class="d-btn sm" data-copy>${ic('copy')}Copier l’adresse</button><small>Navigateur 1920 × 1080, fond transparent.</small></div>`,
    'source',
  )}
  ${grp(
    'Accès des viewers',
    'users',
    `<div class="d-row col" data-k="ouvert pause fermé module désactiver">${seg(
      'data-state',
      [
        ['active', 'Ouvert'],
        ['paused', 'Pause'],
        ['disabled', 'Fermé'],
      ],
      ui.moduleState,
      'block',
    )}<small>Fermé : plus aucune manche ne peut se lancer.</small></div>`,
    'accès module',
  )}`;
}
