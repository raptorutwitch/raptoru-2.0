# Banc mobile Twitch : tester l'extension dans la vraie application Twitch

Le banc sert l'extension depuis le PC à l'application Twitch d'un vrai téléphone, via une version **Local Test** de la
console Twitch. Il n'y a pas de ZIP à faire : on modifie un fichier dans `apps/twitch-extension/extension/`, on rouvre
l'extension sur le téléphone, et c'est la nouvelle version qui s'affiche.

## Ce qui tourne (tout sur le PC)

| Pièce                | Rôle                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base du banc         | Conteneur Docker `raptoru-mobile-lab-pg` (127.0.0.1:55640), base `raptoru_mobile_lab`. Données fictives uniquement.                                                                                                  |
| Core Lab             | Le vrai Core en `CORE_ENVIRONMENT=lab` (127.0.0.1:4531) : chaîne fictive 900100, Jetons fictifs, aucun accès Twitch. Ses gardes refusent de démarrer s'il voit une base distante, la vraie chaîne ou une app Twitch. |
| Serveur du banc      | 127.0.0.1:4530. Il sert les fichiers de l'extension avec le diagnostic actif, le badge « BANC-MOBILE · test » et le relais `/ext-lab/api` vers le Core Lab. Il reçoit aussi le journal du téléphone.                 |
| Tunnel `cloudflared` | Il donne au serveur une adresse HTTPS publique et temporaire, en `https://….trycloudflare.com/`.                                                                                                                     |

Le jeton Twitch donné par l'application est seulement lu : rôle, chaîne et identité. Le banc le remplace par celui du
compte fictif de même rôle (spectateur 900101 avec 12 000 Jetons fictifs, streamer 900100, modérateur 900102). Aucune
donnée réelle n'entre dans le banc et aucun Jeton réel ne bouge. Le Core de Production, Studio, le bot et OBS ne sont
jamais contactés.

## Une seule fois

1. **Installer le tunnel :** `winget install --id Cloudflare.cloudflared`, puis rouvrir le terminal.
2. **Docker Desktop** doit être lancé.
3. **Une chaîne Twitch de test**, sur un deuxième compte. N'utilisez jamais la chaîne Raptoru : y installer une version
   de test retirerait l'extension aux viewers.
4. **Dans la console Twitch, créez une nouvelle version de l'extension.** La version publiée reste intacte.
   - Partez de la version actuelle (« Create New Version ») avec un numéro distinct, par exemple `0.0.900`. La version
     reste en **Local Test**.
   - Asset Hosting :
     - **Testing Base URI** : l'adresse affichée par le banc, avec le `/` final ;
     - **Mobile path** : `mobile.html` ;
     - les autres chemins comme dans la version actuelle (`panel.html`, `video_component.html`, `config.html`).
   - Access, **Testing Account Allowlist** : ajoutez le compte de la chaîne de test **et** le compte connecté sur le
     téléphone.
5. **Avec le compte de test, sur twitch.tv :** Gestionnaire d'extensions, installez cette version (visible car le
   compte est sur la liste), puis activez-la comme sur la chaîne Raptoru.

## À chaque session

1. Double-cliquez sur `apps/twitch-extension/Banc mobile Twitch.cmd`, ou lancez `node scripts/mobile-lab.mjs`.
   - `--reset` remet les Jetons fictifs à zéro.
   - `--root <dossier>` sert un ZIP extrait à la place des sources.
   - `--garder-tunnel` relance tout sauf le tunnel en cours : même adresse, rien à changer dans la console. Le build
     affiché (badge, rapport Diag) est relu à chaque ouverture de l'extension : un commit n'exige pas de relance.
2. Le banc affiche la **Testing Base URI**.
   - Elle change à chaque lancement du tunnel : collez-la dans la console (version de test, Asset Hosting), puis
     enregistrez.
   - Le banc vérifie lui-même que l'adresse répond depuis Internet.
3. Sur le téléphone :
   - fermez complètement l'application Twitch et rouvrez-la ;
   - ouvrez la chaîne de test, puis l'icône des extensions ;
   - le badge orange **BANC-MOBILE · test** confirme que c'est bien le banc.
4. Le terminal affiche en direct :
   - chaque fichier demandé par le téléphone ;
   - le jeton reçu (chaîne, rôle, identité) ;
   - les étapes du diagnostic, les erreurs JavaScript, les réseaux en échec, les attentes bloquées et les écrans cachés.

   Le rapport complet du panneau Diag est enregistré automatiquement après 5 s, après 15 s, à chaque alerte et quand
   l'extension passe en arrière-plan. Les fichiers vont dans `%LOCALAPPDATA%\raptoru-mobile-lab\` : `journal-<date>.log`
   et `rapport-*.txt`.

5. Pour arrêter, faites Ctrl+C ou fermez la fenêtre. Si quelque chose reste lancé : `node scripts/mobile-lab.mjs stop`.

## Si l'icône des extensions n'apparaît pas

- Vérifiez trois choses : le compte du téléphone est sur l'allowlist, la version **de test** est installée et activée
  sur la chaîne de test, et l'application a bien été fermée complètement.
- Si le terminal n'affiche aucune ligne `GET /mobile.html`, l'application n'a rien demandé. Le problème vient alors de
  la console ou de l'affichage hors live, pas de l'extension.
- Rien n'établit que les extensions mobiles s'affichent sur une chaîne hors ligne. Si l'icône manque, lancez un live
  technique sur la **chaîne de test**, qui n'a pas d'abonnés à notifier. Un écran noir suffit.

## Limites

- Le Core Lab est fictif : ce sont les vraies règles et le vrai code du Core, mais pas les données de Production.
- Le banc garde toujours le Casino ouvert et un live simulé. Le message « hors live » ne s'y voit pas.
- Le relais ne vérifie pas la signature Twitch, car le secret de l'extension reste dans la console. Toute personne qui
  connaît l'adresse aléatoire du tunnel peut jouer avec les Jetons fictifs, mais seulement pendant la session.
- L'adresse `trycloudflare.com` change à chaque lancement. Pour une adresse fixe, il faudrait un tunnel nommé, ce qui
  demande un compte Cloudflare et un domaine.
- L'application Twitch ouvre `mobile.html?platform=mobile&anchor=component&mode=viewer` quand l'extension est activée
  en composant vidéo sur la chaîne : un essai depuis le PC doit utiliser cette adresse, pas `anchor=panel`
  (le 24/11, `anchor=component` faisait passer la page en surface « video » et le Casino à 0 px de haut).
- Un essai réussi depuis le PC (navigateur automatisé, faux helper Twitch) prouve seulement que le banc fonctionne. Ce
  n'est jamais une validation sur téléphone.
