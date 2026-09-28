-- Soundboard V2 Lab : séparation du nom par défaut (banque Core, dans le code) et du nom
-- personnalisé (Studio). La colonne `label` devient `custom_label`, facultative.
-- Règle déterministe : une valeur exactement égale à l'ancien nom par défaut de son sound_id
-- redevient « pas de nom personnalisé » (null) ; toute autre valeur est un vrai renommage et
-- reste custom_label. Aucun sound_id, fichier, prix, cooldown, mode, volume ni historique modifié.

alter table sound_lab_sounds rename column label to custom_label;
alter table sound_lab_sounds alter column custom_label drop not null;

update sound_lab_sounds s
   set custom_label = null
  from (values
  ('boop', 'Boop'),
  ('ohlala', 'Ohlala'),
  ('hello', 'Hello'),
  ('random', 'Aléatoire'),
  ('aaaaaaah', 'Aaaaaaah'),
  ('akh', 'AKH'),
  ('anime-wow', 'Anime WOW'),
  ('ballonboyhi', 'BallonBoy Hi'),
  ('boom', 'BOOM'),
  ('bowser-theme', 'Bowser Theme'),
  ('comment-est-ce-possible-sigma', 'Comment est-ce possible Sigma'),
  ('dramatic-sound-effect', 'DRAMATIC sound effect'),
  ('erenscream', 'ErenScream'),
  ('fail-trumpet', 'Fail trumpet'),
  ('garama', 'GARAMA'),
  ('gougougaga', 'Gougougaga'),
  ('hee-hee', 'HEE HEE'),
  ('hegale', 'HEGALE'),
  ('hells-kitchen-violin', 'Hells Kitchen Violin'),
  ('j-comprends-rien', 'J''comprends rien'),
  ('jembienbouaire', 'jembienbouaire'),
  ('kids-yeaaah', 'KIDS Yeaaah'),
  ('maintenant-tais-toi', 'Maintenant tais toi'),
  ('meuh-meuh', 'Meuh meuh'),
  ('mgs-alert', 'MGS Alert'),
  ('nihiiiiil', 'NIHIIIIIL'),
  ('non-mario', 'Non Mario'),
  ('pas-de-panique-juno', 'Pas de panique - Juno'),
  ('prowler', 'PROWLER'),
  ('punch-2', 'Punch 2'),
  ('punch-3', 'Punch 3'),
  ('punch-4', 'Punch 4'),
  ('punch-5', 'Punch 5'),
  ('punch-6', 'Punch 6'),
  ('quoicoubaka-bibou', 'Quoicoubaka bibou'),
  ('rezero-2', 'ReZero 2'),
  ('rezero-choir', 'ReZero choir'),
  ('roblox-oof', 'Roblox OOF'),
  ('shaw', 'SHAW'),
  ('sigma-a-genoux', 'Sigma - A genoux'),
  ('sigma-sniper', 'Sigma - sniper'),
  ('sigma-tu-es-d-un-ennui', 'Sigma - Tu es d''un ennui'),
  ('sigma-freudonne', 'Sigma freudonne'),
  ('the-forest-craft', 'The Forest craft'),
  ('the-rock-meme', 'The Rock meme'),
  ('tiens-bon', 'Tiens bon'),
  ('voldemort', 'Voldemort'),
  ('wii-sport-youdied', 'Wii Sport YouDied'),
  ('wrong', 'Wrong'),
  ('you-are-an-idiot', 'You are an idiot'),
  ('yousuckatthisgame', 'YouSuckAtThisGame'),
  ('fanta-c-est-pas-toi-qui-decide', 'Fanta - C''est pas toi qui décide !'),
  ('lacrimatica', 'Lacrimatica'),
  ('ouais-clark-kent', 'Ouais... Clark Kent'),
  ('rizz', 'RIZZ'),
  ('sarah', 'Sarah'),
  ('sardoche-c-etait-sur', 'Sardoche - C''était sur !'),
  ('spongebob-fail', 'Spongebob Fail'),
  ('on-est-bien-d-accord', 'On est bien d''accord'),
  ('c-est-moi-qui-les-ai-plante', 'C''est moi qui les ai planté'),
  ('onizuka-le-ciel-est-bleu', 'Onizuka - Le ciel est bleu'),
  ('ca-c-est-bien', 'Ça c''est bien'),
  ('ca-c-est-moche', 'Ça c''est moche'),
  ('c-est-quoi-ca-sardoche', 'C''est quoi ça - Sardoche'),
  ('t-es-une-pute', 'T''es une pute'),
  ('vous-etes-sur-discord-monsieur', 'Vous êtes sur Discord monsieur'),
  ('incroyable-joyca', 'INCROYABLE - Joyca'),
  ('en-rigolant-ptitchef', 'En rigolant - Ptitchef'),
  ('sac-a-merde-ptitchef', 'Sac a merde - Ptitchef')
  ) as previous_default(sound_id, label)
 where s.sound_id = previous_default.sound_id
   and s.custom_label = previous_default.label;
