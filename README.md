# Fnac Pulse

**Chaque service compte.** Une PWA adaptée au mobile et à la tablette pour déclarer les services vendus, suivre les résultats d'une équipe et recevoir des notifications.

## Version GitHub Pages + Firebase + Cloudflare

La version cloud est préparée pour fonctionner **sans serveur Node.js permanent et sans Firebase Blaze** :

- **GitHub Pages** héberge l'interface statique.
- **Firebase Authentication** et **Firestore** fournissent les sessions vendeurs et la synchronisation en temps réel.
- Un **Cloudflare Worker** gratuit contrôle les PIN et les écritures ; **Cloudflare Queues** et **Firebase Cloud Messaging** acheminent les notifications.
- Les vendeurs se connectent en choisissant magasin et nom, puis avec un **PIN personnel à 8 chiffres**. Aucun PIN par défaut n'est créé.

La configuration Firebase Web publique du projet `fnac-pulse` est incluse. Le site est publié sur GitHub Pages et une notification système a été reçue sur un iPhone réel. La synchronisation simultanée sur deux appareils physiques distincts reste à valider. Aucun secret n'est dans le dépôt. Les tests locaux et les émulateurs ne remplacent pas une recette sur les appareils ni un audit de sécurité.

➡️ [Guide de déploiement pas à pas](GUIDE_DEPLOIEMENT.md)

## Utilisation

1. Sélectionner un magasin et son profil, puis saisir son PIN. Les vendeurs sont propres à chaque magasin et affichés par ordre alphabétique. La géolocalisation, facultative, propose un magasin proche et reste dans le navigateur. La liste initiale, issue d'OpenStreetMap, est indicative et peut être incomplète.
2. Appuyer sur **+** pour ajouter un service. **−** retire sa dernière vente du jour pour ce service ; le message de confirmation permet aussi d'annuler.
3. Dans **Mes objectifs → Gérer**, choisir un service, une période de référence (**jour travaillé**, **semaine** ou **mois**) et une seule cible entière de 1 à 9 999. Les deux autres cibles sont calculées automatiquement à partir des jours travaillés du vendeur. La référence se répète ; les valeurs calculées s'adaptent au calendrier. Le bouton **Supprimer l’objectif de ce service** retire les trois cibles ensemble.
4. Les barres personnelles avancent automatiquement avec les ventes du vendeur connecté, pour le service et la période correspondants ; elles diminuent en cas de correction. Les ventes des collègues ne les alimentent pas. L'administration peut définir les mêmes cibles dans **Objectifs**, après avoir choisi un magasin et un vendeur. Le vendeur ne voit que ses propres objectifs, et l'administrateur peut les gérer pour les vendeurs du magasin sélectionné.
5. Les totaux, l'activité et le top 3 se mettent à jour pour les vendeurs du même magasin. À total égal, le classement privilégie le nombre de DMax, puis de FVD, puis le prénom par ordre alphabétique. Les bilans et les objectifs couvrent le jour, la semaine du lundi au dimanche et le mois, au fuseau `Europe/Paris`.
6. Chaque personne active les notifications sur chaque appareil. Sur iPhone/iPad, il faut d'abord ajouter l'application à l'écran d'accueil depuis Safari, puis autoriser les notifications (iOS/iPadOS 16.4+). HTTPS et un navigateur compatible sont nécessaires.
7. L'administration permet de gérer vendeurs, services, magasins, PIN et ventes du jour. Le magasin à gérer se choisit uniquement dans l'onglet **Magasins** ; il reste sélectionné dans les autres onglets. Les vendeurs et l'ordre des services lui sont propres. Les intitulés et l'activation des services restent communs. Les corrections ne créent pas de notification de vente.
8. Le bouton **Apparence** choisit le thème clair, sombre ou automatique selon l'appareil. Le choix est mémorisé localement sur chaque appareil.

La répartition utilise les **jours habituels propres à chaque vendeur**, à choisir du lundi au dimanche dans **Administration → Objectifs** après avoir sélectionné le magasin dans **Magasins**. On peut enregistrer de **un à sept jours**, dimanche compris. L'onglet Objectifs comporte deux blocs distincts : **Jours travaillés** et **Services**. En l'absence de réglage, le lundi au vendredi sert de base **par défaut, à vérifier**. Les jours fériés qui tombent sur les jours choisis sont inclus. Ce choix se répète chaque semaine : il ne suit pas les congés, absences ou changements ponctuels de planning.

Les objectifs sont répartis en nombres entiers ; pour une petite cible mensuelle, certains jours ou certaines semaines peuvent être à zéro. Une semaine à cheval sur deux mois additionne les quotas quotidiens des deux mois. Toutes les ventes restent comptées dans les bilans, y compris les jours hors planning. Exemple avec lundi–vendredi : une référence de 5 par jour travaillé donne 25 par semaine et 110 en octobre 2026, qui compte 22 jours de lundi à vendredi ; une référence de 10 par mois reste exactement 10 sur le mois. Modifier les jours habituels recalcule immédiatement les valeurs dérivées sans modifier la cible de référence ni les ventes.

Pour les anciens objectifs à plusieurs valeurs indépendantes, le **mensuel** sert de référence s'il existe, sinon l'hebdomadaire puis le quotidien. Les anciennes données ne sont pas réécrites automatiquement ; un enregistrement ultérieur conserve uniquement la nouvelle référence. La nouvelle répartition remplace immédiatement l'affichage des anciennes cibles, y compris dans la période en cours.

La dernière vue et les derniers objectifs chargés peuvent rester disponibles hors ligne, mais **aucune vente ni modification d'objectif n'est mise en attente hors connexion**. Si une réponse est perdue, vérifier le bilan ou les cibles avant de ressaisir. Les animations propres à chaque vendeur et à chaque service restent à concevoir.

## Sécurité et limites

- Le Worker vérifie chaque vente et limite les tentatives de PIN ; les règles Firestore isolent les magasins et interdisent les écritures directes des vendeurs. Les objectifs sont accessibles uniquement par l'API au vendeur authentifié concerné et à l'administrateur, jamais par lecture directe de `pulseGoals`. Un changement de PIN invalide les anciennes sessions. Il s'agit d'une première version non auditée : éviter toute donnée sensible et prévoir un audit avant une utilisation importante.
- Des données de la dernière session, dont les objectifs, peuvent être mémorisées dans le navigateur pour l'affichage hors ligne. La déconnexion depuis l'application efface ce cache local ; sur un appareil partagé ou compromis, la mémoire du navigateur ne constitue pas une protection des données. Utiliser un appareil de confiance et effacer les données du site au besoin.
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
- Identité visuelle inspirée de la Fnac ; logo issu de [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fnac_Logo.svg). Marques et logos appartiennent à leurs propriétaires : vérifier les autorisations avant diffusion.
- Dépôt : <https://github.com/hypernovax31/FNAC-Pulse>. Site publié : <https://hypernovax31.github.io/FNAC-Pulse/>.
