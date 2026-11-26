# PRIVATE BROWSER

Navigateur Chromium distant avec page d'accueil Google, interface en français et sessions temporaires.

**Optimisé pour** : Claude, Grok, ChatGPT, Gemini, Discord, Poki, Crazy Games et la plupart des sites modernes.

## Déploiement sur Render

1. Crée un dépôt GitHub nommé `private-browser`.
2. Envoie **tout le contenu de ce dossier** dans le dépôt (Dockerfile à la racine).
3. Dans Render, choisis **New + → Web Service** puis connecte le dépôt.
4. Render détecte le Dockerfile. Choisis un plan compatible avec Chromium (idéalement **Standard** ou supérieur pour plus de RAM/CPU).
5. Dans **Environment**, ajoute `PRIVATE_BROWSER_PASSWORD` avec un mot de passe long et unique.
6. Déploie. Ouvre l'URL `https://...onrender.com`.

Le fichier `render.yaml` peut aussi servir de configuration Blueprint.

## Améliorations de compatibilité

- User-Agent Chrome réel + en-têtes `sec-ch-ua`
- Masquage de `navigator.webdriver` et signaux d'automatisation
- Spoof WebGL / WebGL2 / plugins / hardwareConcurrency (meilleur pour les jeux navigateur)
- Service Workers autorisés
- Permissions micro + caméra (utile pour Discord)
- Support media / WebRTC + autoplay
- Locale française + fuseau Europe/Paris
- Qualité screenshot un peu plus élevée + polling plus rapide

## Sites ciblés

| Site            | Niveau attendu      | Remarque |
|-----------------|---------------------|----------|
| Claude          | Bon                 | Moins de détection bot |
| ChatGPT         | Bon                 | Idem |
| Grok            | Bon                 | Idem |
| Gemini          | Bon                 | Fonctionne bien avec le fingerprint actuel |
| Discord         | Correct (texte)     | Chat texte OK. Vocal/vidéo très limité (latence) |
| Poki            | Correct             | Jeux casual / idle OK. Jeux rapides = lag |
| Crazy Games     | Correct             | Idem |
| GeForce Now     | Mauvais             | Architecture screenshot incompatible avec le cloud gaming |

## Fonctionnement et limites

- Chaque session possède son propre contexte Chromium en mémoire.
- Les cookies et le stockage de session ne sont pas persistés sur disque.
- Les sessions inactives sont fermées après 30 minutes.
- Le trafic sort de l'IP du serveur Render (contourne donc la plupart des filtres réseau locaux).
- Les sites peuvent toujours voir l'IP de sortie et appliquer leurs règles.
- Le service bloque les adresses locales/privées.
- **Jeux** : le système repose sur des captures d'écran (~750 ms). Les jeux très rapides restent laggy. Les jeux au tour par tour, idle ou casual passent mieux.
- **Discord vocal** : techniquement possible côté serveur, mais la latence le rend peu utilisable.
- Pas de téléchargements, pas d'extensions.
- Ne publie pas ce service sans mot de passe.

## Sécurité

Ce projet est un prototype. Un service public de navigation distante doit être surveillé et protégé contre l'abus. N'utilise pas ce service pour contourner les règles d'un réseau ou d'un administrateur.
