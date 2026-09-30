# Provenance des assets

Copies **non modifiées** (octet pour octet) faites le 29/09/2026 depuis le dossier legacy de
production, qui reste la source et n'a pas été touché :

`C:\Users\Antoni\Videos\Alertes Twitch Pour Claude\TTS Webm\`

Usage : TTS V2 (extension : aperçu, tirage, carte ; lecteur Studio / overlay OBS). Copiés à
l'identique depuis `prototypes/tts-v2-player/assets/legacy/` le 30/09/2026 (mêmes SHA-256).
Extension non publiée sur Twitch : ne pas diffuser avant le feu vert global.

| Fichier | SHA-256 | Format | Cadre | Durée | Rôle |
|---|---|---|---|---|---|
| Mikasa Blabla.webm | ed1d1e03a6c2b16d68fc55bde1e4a6014858cc5ff498a793f28f1fbc3bbe682c | WebM alpha | 1920×1080 | 4 s | Mikasa — base (idle, layered) |
| Mikasa Bouche.webm | ae6ad932e46916e8020bd9b096d5770a336f2e489ff974f22058bf53acee52ff | WebM alpha | 1920×1080 | 5 s | Mikasa — calque bouche |
| C21 Fixe Clean.webm | 7ef4b9dae0a047573f4a1d16127c94bd74188e996c523aa807da8ce8ecb87b28 | WebM alpha | 1920×1080 | 10 s | C21 — idle |
| C21 Blabla clean.webm | 21df221f86b1b00801c5c78c9bb85a2ebd8c45170b66c3ba73519caf4d3f2774 | WebM alpha | 1920×1080 | 0,417 s | C21 — parole (boucle) |
| Zote Fixe.png | 5386a4929cc3afc5c344106f433be148f9b1154b2d23172c8ca14d23be386396 | PNG alpha | 1920×1080 | — | Zote — idle |
| Zote blabla.webm | b50bc9d0f2e4f4c8cf90033f498c01bb2919cfab64b09b8a4743524b717ace30 | WebM alpha | 1920×1080 | 0,2 s | Zote — parole (boucle) |
| andras arato Fixe.png | 85ce092b0617968e73ad224b8c3acca50f494dd406bed4f52dbf76c8764d9b7c | PNG alpha | 1920×1080 | — | Andras — idle |
| Andras Arato Gif.webm | 63c94411c0ccb8874c4ac1de72dad8f9962e985d382977d4df641d40c6d0255e | WebM alpha | 1920×1080 | 0,28 s | Andras — parole (boucle) |
| Golem de neige Fixe.webm | 53e89ddd6a2a9c3527e5af382d793c757c936e5dc91c5eeb093af82d8bc9646b | WebM alpha | 640×360 | 10,375 s | Golem — idle |
| Golem de Neige blabla.webm | f9830ec505284ca33d285dc55d46ec7ef5a34790e6268e41b183cca839b71637 | WebM alpha | 640×360 | 10,375 s | Golem — parole |

Non copiés (non utilisés par le player TTS) : `TTS_System.html`, `Tombola_System.html`,
`Tombola_Join_System.html`, `votekick-overlay.html`, `lancer_tts.bat`, `lancer_serveur.vbs`.

Défaut connu des sources : un pixel parasite semi-opaque vers (116, 184) dans plusieurs exports
1920×1080 (bien visible en rouge sur `Zote Fixe.png`). Non corrigé ici.
