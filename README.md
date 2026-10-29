# Fnac Pulse

**Chaque service compte.** Une PWA adaptée au mobile et à la tablette pour déclarer les services vendus, suivre les résultats d'une équipe et recevoir des notifications.

## Version GitHub Pages + Firebase + Cloudflare

La version cloud est préparée pour fonctionner **sans serveur Node.js permanent et sans Firebase Blaze** :

- **GitHub Pages** héberge l'interface statique.
- **Firebase Authentication** et **Firestore** fournissent les sessions vendeurs et la synchronisation en temps réel.
- Un **Cloudflare Worker** gratuit contrôle les PIN et les écritures ; **Cloudflare Queues** et **Firebase Cloud Messaging** acheminent les notifications.
- Les vendeurs se connectent en choisissant magasin, département et nom, puis avec un **PIN personnel à 8 chiffres qu'ils choisissent eux-mêmes**. Aucun PIN par défaut n'est créé ; l'interface administrateur ne demande ni ne montre le PIN personnel.

La configuration Firebase Web publique du projet `fnac-pulse` est incluse. Le site est publié sur GitHub Pages et une notification système a été reçue sur un iPhone réel. La synchronisation simultanée sur deux appareils physiques distincts reste à valider. Aucun secret n'est dans le dépôt. Les tests locaux et les émulateurs ne remplacent pas une recette sur les appareils ni un audit de sécurité.

➡️ [Guide de déploiement pas à pas](GUIDE_DEPLOIEMENT.md)

## Utilisation

1. Sélectionner un magasin, un département et son profil, puis saisir son PIN. Les vendeurs sont propres à chaque magasin et affichés par ordre alphabétique. La géolocalisation, facultative, propose un magasin proche et reste dans le navigateur. La liste initiale, issue d'OpenStreetMap, est indicative et peut être incomplète.
2. Appuyer sur **+** pour ajouter un service. **−** retire sa dernière vente du jour pour ce service ; le message de confirmation permet aussi d'annuler.
3. Dans **Mes objectifs**, choisir **Aujourd’hui**, **Semaine** ou **Mois** pour comparer ses ventes à sa cible pour chaque service. **Ajouter** permet de définir une cible ; toucher le nom ou le crayon d’un service permet de la modifier. Choisir une période de référence (**jour travaillé**, **semaine** ou **mois**) et une seule cible entière de 0 à 9 999. Les autres cibles sont calculées à partir des jours travaillés. Changer la période conserve le nombre saisi ; vérifier l’aperçu avant d’enregistrer. La référence se répète ; les valeurs calculées s'adaptent au calendrier. **Supprimer l’objectif de ce service** retire les trois cibles ensemble.
4. Les barres personnelles avancent automatiquement avec toutes les ventes du vendeur connecté, y compris avant un éventuel changement de département, pour le service et la période correspondants ; elles diminuent en cas de correction. Les ventes des collègues ne les alimentent pas. L'administration peut définir les mêmes cibles dans **Objectifs**, après avoir choisi un magasin et un vendeur. Le vendeur ne voit que ses propres objectifs, et l'administrateur peut les gérer pour les vendeurs du magasin sélectionné.
5. Les compteurs, l'activité et le top 3 concernent les ventes du même département et du même magasin. À total égal, le classement privilégie le nombre de DMax, puis de FVD, puis le prénom par ordre alphabétique. Les bilans et les objectifs couvrent le jour, la semaine du lundi au dimanche et le mois, au fuseau `Europe/Paris`.
6. Chaque personne active les notifications sur chaque appareil. Si l'autorisation n'a pas encore été demandée, l'application propose de l'activer à l'ouverture ; un appui est nécessaire pour afficher la demande du système. La cloche barrée signale que les notifications ne sont pas actives. Seules les ventes du même département et du même magasin sont annoncées, sous la forme « 1 DMax fait par Morgan 👍 » : le premier mot du nom du vendeur sert de prénom. Sur iPhone/iPad, il faut d'abord ajouter l'application à l'écran d'accueil depuis Safari, puis autoriser les notifications (iOS/iPadOS 16.4+). HTTPS et un navigateur compatible sont nécessaires.
7. L'administration permet de gérer départements, vendeurs, services, magasins, PIN et ventes du jour. Le magasin à gérer se choisit uniquement dans l'onglet **Magasins** ; il reste sélectionné dans les autres onglets. Les départements, leurs vendeurs et l'ordre des services lui sont propres. Les intitulés et l'activation des services restent communs. Les corrections ne créent pas de notification de vente.
8. Le bouton **Apparence** choisit le thème clair, sombre ou automatique. L'icône de haut-parleur en haut de l'écran active ou coupe le son des ventes sur cet appareil. Le raccourci **Objectifs** fait défiler l'écran jusqu'aux objectifs ; l'activité affiche les quatre dernières ventes et son menu permet de voir le reste de la journée.

### Première connexion et PIN personnel

- Sur un téléphone qui ne possède pas encore de profil, sélectionner le magasin, le département et son propre nom. Si le profil n'a pas de PIN, l'application propose automatiquement de choisir et confirmer un **PIN personnel de 8 chiffres**. Aucun code d'activation préalable n'est nécessaire.
- Le téléphone mémorise le magasin et le profil, mais pas le PIN en clair. La session reste ouverte quand on ferme l'application : il n'y a rien à ressaisir à la réouverture. Après **Mon profil → Se déconnecter**, seul le profil mémorisé est proposé et son PIN est nécessaire pour revenir. Sur cet écran déconnecté, **Changer de profil sur cet appareil** permet de le confier volontairement à une autre personne.
- Lors de la mise à jour vers ce système, **tous les anciens PIN et toutes les sessions vendeurs sont réinitialisés une seule fois**. Chacun crée son nouveau PIN sans l'ancien code. Les vendeurs, ventes, objectifs et plannings sont conservés. La réinitialisation est reprenable et ne se répète pas lors des ouvertures suivantes.
- En cas d'oubli, un administrateur choisit le magasin dans **Magasins**, puis le vendeur dans **Codes PIN**, et utilise **Réinitialiser l'accès**. L'ancien PIN et les sessions du vendeur sont alors invalidés immédiatement ; il choisit ensuite un nouveau PIN. L'interface administrateur ne le lit ni ne le demande.
- **Risque accepté : sans vérification à la première connexion, la première personne qui sélectionne un profil sans PIN peut créer son code à la place du vendeur.** Prévenir l'équipe afin que chacun initialise rapidement son propre profil ; après une réinitialisation, avertir le vendeur immédiatement. Les essais de PIN sont limités et cinq échecs rapprochés entraînent un blocage temporaire.

### Signature sonore

Le fichier `public/FNAC - SIGNATURE.mp3` n'est plus joué au démarrage. Lorsque l'application est ouverte et visible, il accompagne une vente enregistrée par soi-même ou un membre du même département, sous réserve que le navigateur autorise la lecture audio et que l'appareil ne soit pas en mode silencieux. Le bouton de haut-parleur active ou coupe ce son ; il est activé par défaut et mémorisé sur chaque appareil. Les corrections, l'historique initial et les ventes anciennes retrouvées après une déconnexion ne le déclenchent pas. Aucun son bloqué n'est rejoué plus tard. Un premier geste peut être nécessaire pour autoriser les sons ultérieurs.

Ce réglage concerne l'application ouverte. Une PWA ne peut pas imposer ce MP3 aux notifications système lorsque l'application est fermée ou en arrière-plan : leur son éventuel et la mention de leur application émettrice dépendent du système et du navigateur.

### Départements et récapitulatif des services

Chaque magasin commence avec **Produits Techniques**, **Produits Éditoriaux**, **Caisse/Adhésion** et **SAV/Logistique**. Dans **Administration → Magasins**, choisir le magasin ; l’onglet **Départements** permet ensuite d’ajouter, renommer, archiver ou restaurer ses départements. Dans **Vendeurs**, affecter chaque personne à un département actif. Tous les vendeurs historiques sont implicitement rattachés à Produits Techniques dans leur magasin existant, sans modifier leurs ventes. Une vente reste rattachée au département où elle a été enregistrée, même si le vendeur est réaffecté ensuite.

Dans **Le récap’ des services**, choisir **Tout le magasin** ou un département, puis jour, semaine ou mois. Les barres affichent **ventes / objectif**, et non une comparaison avec le service le plus vendu. Pour chaque service et périmètre, les cibles mensuelles connues sont additionnées, puis réparties en entiers entre les jours du mois au prorata du nombre de vendeurs habituellement prévus ce jour-là ; les vendeurs sans cible contribuent à ce nombre de présences, mais pas à la somme des objectifs. Les semaines additionnent les objectifs quotidiens, y compris à cheval sur deux mois, et les fériés sont inclus. Une cible non renseignée apparaît « — » ; une cible calculée ou saisie à zéro reste distincte d’une cible absente.

Le Worker ne renvoie pour ce récapitulatif que des agrégats par service et par périmètre, jamais les documents ou plannings personnels. **Un objectif individuel peut néanmoins être déduit** lorsqu’un groupe est très petit ou par comparaison des agrégats : leur affichage reste volontairement autorisé. Les départements filtrent les vues et les notifications, mais ne constituent pas une frontière de confidentialité des ventes à l’intérieur du magasin : le récapitulatif du magasin entier nécessite l’accès aux ventes du magasin.

### Jours travaillés et objectifs personnels

La répartition utilise les **jours habituels propres à chaque vendeur**, à choisir du lundi au dimanche dans **Administration → Objectifs** après avoir sélectionné le magasin dans **Magasins**. On peut enregistrer de **un à sept jours**, dimanche compris. L'onglet Objectifs comporte deux blocs distincts : **Jours travaillés** et **Services**. En l'absence de réglage, le lundi au vendredi sert de base **par défaut, à vérifier**. Les jours fériés qui tombent sur les jours choisis sont inclus. Ce choix se répète chaque semaine : il ne suit pas les congés, absences ou changements ponctuels de planning.

Les objectifs sont répartis en nombres entiers ; pour une petite cible mensuelle, certains jours ou certaines semaines peuvent être à zéro. Une semaine à cheval sur deux mois additionne les quotas quotidiens des deux mois. Toutes les ventes restent comptées dans les bilans, y compris les jours hors planning. Exemple avec lundi–vendredi : une référence de 5 par jour travaillé donne 25 par semaine et 110 en octobre 2026, qui compte 22 jours de lundi à vendredi ; une référence de 10 par mois reste exactement 10 sur le mois. Modifier les jours habituels recalcule immédiatement les valeurs dérivées sans modifier la cible de référence ni les ventes.

Pour les anciens objectifs à plusieurs valeurs indépendantes, le **mensuel** sert de référence s'il existe, sinon l'hebdomadaire puis le quotidien. Les anciennes données ne sont pas réécrites automatiquement ; un enregistrement ultérieur conserve uniquement la nouvelle référence. La nouvelle répartition remplace immédiatement l'affichage des anciennes cibles, y compris dans la période en cours.

La dernière vue et les derniers objectifs chargés peuvent rester disponibles hors ligne, mais **aucune vente ni modification d'objectif n'est mise en attente hors connexion**. Si une réponse est perdue, vérifier le bilan ou les cibles avant de ressaisir. Les animations propres à chaque vendeur et à chaque service restent à concevoir.

## Sécurité et limites

- Le Worker vérifie chaque vente et limite les tentatives de PIN ; les règles Firestore isolent les magasins et interdisent les écritures directes des vendeurs. Les objectifs sont accessibles uniquement par l'API au vendeur authentifié concerné et à l'administrateur, jamais par lecture directe de `pulseGoals`. Un changement de PIN invalide les anciennes sessions. Il s'agit d'une première version non auditée : éviter toute donnée sensible et prévoir un audit avant une utilisation importante.
- La session peut rester ouverte sur l'appareil après fermeture : toute personne ayant accès à cette session peut agir sous ce profil sans ressaisir le PIN. **Sur un appareil partagé, se déconnecter avant de le transmettre.** Des données de la dernière session, dont les objectifs, peuvent être mémorisées dans le navigateur pour l'affichage hors ligne. La déconnexion depuis l'application efface ce cache local ; sur un appareil partagé ou compromis, la mémoire du navigateur ne constitue pas une protection des données. Utiliser un appareil de confiance et effacer les données du site au besoin.
- Une notification est **tentée**, sans garantie de délai ni de réception ; des doublons restent possibles après une panne. Le canal est soumis à la connexion, aux permissions, à FCM et aux quotas. Les notifications trop anciennes sont abandonnées.
- Spark inclut notamment **50 000 lectures, 20 000 écritures/jour et 1 Gio** Firestore Standard ; Workers Free inclut **100 000 requêtes/jour**, Queues Free **10 000 opérations/jour**. Chaque appareil et notification consomment plusieurs opérations : surveiller la consommation réelle. Les limites peuvent changer ; un dépassement peut interrompre le service.
- Les corrections portent sur le jour courant. L'administration fixe un total de 0 à 100 par vendeur/service ; au-delà de 2 000 opérations enregistrées dans un magasin sur un jour, la correction est bloquée plutôt que de travailler sur une liste tronquée. Aucun nettoyage ni sauvegarde complète automatique n'est prévu : définir une politique de conservation et de sauvegarde. La migration initiale conserve seulement une copie du catalogue avant rattachement des vendeurs aux magasins.

## Développement et vérifications

Node.js 20+ est nécessaire pour compiler et tester, mais **pas pour héberger l'application Pages**.

```bash
npm ci
npm test             # tests isolés ; l'intégration émulateur est ignorée si absent
npm run build:pages  # build cloud sous /FNAC-Pulse/
```

Les tests Firebase Emulator utilisent uniquement un projet fictif `demo-fnac` ; voir le guide. Le Worker peut être vérifié sans déploiement avec `npx --yes wrangler@4.45.0 deploy --dry-run`.

### Ancien mode de développement local

`npm run build && npm start` démarre l'ancien serveur Express/SQLite à des fins de développement. **Ce mode local n'utilise pas les PIN cloud, ne garantit pas la confidentialité des objectifs et ne convient pas à GitHub Pages ni à une production ouverte.** Les données SQLite sont placées dans `data/` ; au premier démarrage, le mot de passe administrateur local initial est généré dans `data/ADMIN-INITIAL.txt` si `ADMIN_PASSWORD` n'est pas défini.

## Sources et marques

- Magasins : © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), données ODbL via la BAse Nationale des Commerces Ouverte ; liste non officielle et non synchronisée.
- Le visuel de l'icône PWA fourni et approuvé par l'équipe est conservé dans `artwork/fnac-pulse-approved.png` ; `node scripts/generate-icons.mjs` régénère ses formats (ImageMagick requis). Les anciennes URL d'icônes restent disponibles.
- Identité visuelle inspirée de la Fnac ; logo issu de [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fnac_Logo.svg). Marques et logos appartiennent à leurs propriétaires : vérifier les autorisations avant diffusion.
- Dépôt : <https://github.com/hypernovax31/FNAC-Pulse>. Site publié : <https://hypernovax31.github.io/FNAC-Pulse/>.
