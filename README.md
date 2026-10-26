# Fnac Pulse

**Chaque service compte.** Une PWA adaptée au mobile et à la tablette pour déclarer les services vendus, suivre les résultats d'une équipe et recevoir des notifications.

## Version GitHub Pages + Firebase + Cloudflare

La version cloud est préparée pour fonctionner **sans serveur Node.js permanent et sans Firebase Blaze** :

- **GitHub Pages** héberge l'interface statique.
- **Firebase Authentication** et **Firestore** fournissent les sessions vendeurs et la synchronisation en temps réel.
- Un **Cloudflare Worker** gratuit contrôle les PIN et les écritures ; **Cloudflare Queues** et **Firebase Cloud Messaging** acheminent les notifications.
- Les vendeurs se connectent en choisissant magasin et nom, puis avec un **PIN personnel à 8 chiffres**. Aucun PIN par défaut n'est créé.

La configuration Firebase Web publique du projet `fnac-pulse` est incluse. **Le Worker, Firebase et Pages doivent encore être configurés et vérifiés sur les comptes réels avant toute utilisation en équipe.** Aucun secret n'est dans le dépôt. Les tests locaux et les émulateurs ne remplacent pas un test de bout en bout avec FCM, ni un audit de sécurité.

➡️ [Guide de déploiement pas à pas](GUIDE_DEPLOIEMENT.md)

## Utilisation

1. Sélectionner un magasin et son profil, puis saisir son PIN. La géolocalisation, facultative, propose un magasin proche et reste dans le navigateur. La liste initiale, issue d'OpenStreetMap, est indicative et peut être incomplète.
2. Appuyer sur **+** pour ajouter un service. **−** retire sa dernière vente du jour pour ce service ; le message de confirmation permet aussi d'annuler.
3. Les totaux, l'activité et le top 3 se mettent à jour pour les vendeurs du même magasin. Les bilans couvrent le jour, la semaine depuis lundi et le mois, au fuseau `Europe/Paris`.
4. Chaque personne active les notifications sur chaque appareil. Sur iPhone/iPad, il faut d'abord ajouter l'application à l'écran d'accueil depuis Safari, puis autoriser les notifications (iOS/iPadOS 16.4+). HTTPS et un navigateur compatible sont nécessaires.
5. L'administration permet de gérer vendeurs, services, magasins, PIN et ventes du jour. Les corrections ne créent pas de notification de vente.

La dernière vue chargée peut rester disponible hors ligne, mais **aucune vente n'est mise en attente hors connexion**. Si une réponse est perdue, vérifier le bilan avant de ressaisir. Les animations propres à chaque vendeur et à chaque service restent à concevoir.

## Sécurité et limites

- Le Worker vérifie chaque vente et limite les tentatives de PIN ; les règles Firestore isolent les magasins et interdisent les écritures directes des vendeurs. Un changement de PIN invalide les anciennes sessions. Il s'agit d'une première version non auditée : éviter toute donnée sensible et prévoir un audit avant une utilisation importante.
- Une notification est **tentée**, sans garantie de délai ni de réception ; des doublons restent possibles après une panne. Le canal est soumis à la connexion, aux permissions, à FCM et aux quotas. Les notifications trop anciennes sont abandonnées.
- Spark inclut notamment **50 000 lectures, 20 000 écritures/jour et 1 Gio** Firestore Standard ; Workers Free inclut **100 000 requêtes/jour**, Queues Free **10 000 opérations/jour**. Chaque appareil et notification consomment plusieurs opérations : surveiller la consommation réelle. Les limites peuvent changer ; un dépassement peut interrompre le service.
- Les corrections portent sur le jour courant. L'administration fixe un total de 0 à 100 par vendeur/service ; au-delà de 2 000 opérations enregistrées dans un magasin sur un jour, la correction est bloquée plutôt que de travailler sur une liste tronquée. Aucun nettoyage automatique ni sauvegarde n'est prévu : définir une politique de conservation et de sauvegarde avant usage réel.

## Développement et vérifications

Node.js 20+ est nécessaire pour compiler et tester, mais **pas pour héberger l'application Pages**.

```bash
npm ci
npm test             # tests isolés ; l'intégration émulateur est ignorée si absent
npm run build:pages  # build cloud sous /FNAC-Pulse/
```

Les tests Firebase Emulator utilisent uniquement un projet fictif `demo-fnac` ; voir le guide. Le Worker peut être vérifié sans déploiement avec `npx --yes wrangler@4.45.0 deploy --dry-run`.

### Ancien mode de développement local

`npm run build && npm start` démarre l'ancien serveur Express/SQLite à des fins de développement. **Ce mode local n'utilise pas les PIN cloud et ne convient pas à GitHub Pages ni à une production ouverte.** Les données SQLite sont placées dans `data/` ; au premier démarrage, le mot de passe administrateur local initial est généré dans `data/ADMIN-INITIAL.txt` si `ADMIN_PASSWORD` n'est pas défini.

## Sources et marques

- Magasins : © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), données ODbL via la BAse Nationale des Commerces Ouverte ; liste non officielle et non synchronisée.
- Identité visuelle inspirée de la Fnac ; logo issu de [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fnac_Logo.svg). Marques et logos appartiennent à leurs propriétaires : vérifier les autorisations avant diffusion.
- Dépôt : <https://github.com/hypernovax31/FNAC-Pulse>. Site prévu : <https://hypernovax31.github.io/FNAC-Pulse/>.
