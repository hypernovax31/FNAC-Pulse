# Fnac Pulse

Projet initialement nommé **Services-FNAC-Live**.

**Chaque service compte.** Un tableau de bord PWA pour déclarer les services vendus par une équipe, suivre son activité et recevoir les nouvelles ventes en temps réel.

## Utiliser l’application

1. Sélectionner un magasin puis un vendeur. Le bouton de géolocalisation propose le magasin référencé le plus proche ; la position est traitée **dans le navigateur** et n’est pas enregistrée par le serveur. La liste initiale est issue d’OpenStreetMap, peut être incomplète et doit être vérifiée. Un administrateur peut ajouter un magasin.
2. Appuyer sur **+** à côté d’un service. La vente est attribuée au vendeur et au magasin sélectionnés. Le bouton **−** retire la dernière vente du jour pour ce vendeur et ce service. Juste après l’ajout, le message de confirmation propose aussi **Annuler**.
3. Le classement du jour, les totaux et l’activité se mettent à jour automatiquement sur les appareils connectés au même magasin. Les récapitulatifs portent sur le jour, la semaine (depuis lundi) et le mois en cours, selon le fuseau `Europe/Paris`.
4. Chaque personne active les notifications **sur chacun de ses appareils** à l’aide de la cloche ou du bouton « Activer ». Une notification Web Push est envoyée pour chaque nouvelle vente du magasin sélectionné, y compris si la page n’est plus ouverte, tant que le navigateur et son service de notifications la prennent en charge. Une correction ou un ajustement administrateur n’envoie pas de nouvelle notification.
5. Sur iPhone/iPad, ouvrir le site dans Safari, l’ajouter à l’écran d’accueil, puis autoriser les notifications depuis l’application installée (iOS/iPadOS 16.4 ou ultérieur). Sur Android et ordinateur, utiliser un navigateur compatible. HTTPS est nécessaire, sauf pour le développement sur `localhost`. Si les autorisations sont bloquées dans un aperçu intégré, ouvrir le site directement dans un onglet du navigateur.

L’application peut afficher la dernière vue déjà chargée hors ligne. **La saisie est suspendue hors connexion** : aucune vente n’est mise en attente ni prétendument enregistrée. Les animations propres aux vendeurs et aux services ne sont pas encore réalisées.

## Administration

La rubrique **Administration** est protégée par mot de passe. Elle permet de :

- corriger les totaux du jour pour un vendeur et un service, magasin par magasin ;
- ajouter, renommer, archiver ou restaurer des vendeurs et des services ;
- ajouter un magasin, avec coordonnées GPS facultatives ;
- changer le mot de passe administrateur.

L’archivage conserve l’historique. Les noms et la liste de services sont partagés par l’installation ; les ventes, classements et notifications sont séparés par magasin. Le classement journalier départage les égalités par ordre alphabétique. Les compteurs initiaux sont vides : aucune vente d’exemple n’est injectée.

Au premier démarrage, si la variable `ADMIN_PASSWORD` n’a pas été définie, un mot de passe aléatoire est généré dans `data/ADMIN-INITIAL.txt` (ou dans `DATA_DIR`). Le lire pour se connecter, puis le changer dans **Administration → Sécurité**. Le fichier initial est supprimé lors du changement. Le mot de passe n’est pas exposé par l’API.

## Installation et exécution

Préconditions : Node.js 20 ou plus, npm, système capable d’installer `better-sqlite3`.

```bash
npm ci
npm run build
# La valeur ADMIN_PASSWORD n'est utilisée que pour initialiser une base vierge.
ADMIN_PASSWORD='un-mot-de-passe-long-et-unique' \
VAPID_SUBJECT='mailto:adresse-technique@example.com' \
PORT=4173 npm start
```

Ouvrir `http://localhost:4173`. Pour une utilisation sur d’autres appareils et pour les notifications, placer le serveur derrière une adresse **HTTPS** accessible par l’équipe. Le serveur écoute sur `0.0.0.0` et fournit l’interface et l’API sur la même origine. Installer la PWA à la racine du domaine, pas dans un sous-répertoire.

La base SQLite et les clés VAPID sont créées dans `data/`, ou dans le répertoire précisé par `DATA_DIR`. Ce répertoire doit être **persistant**, protégé et sauvegardé avec un outil de sauvegarde SQLite compatible avec le journal WAL. Conserver les clés VAPID avec la base : les changer invalide les abonnements push existants.

```bash
npm test            # tests API et persistance, base de test isolée
```

## Fonctionnement technique

- React et Vite pour l’interface adaptative ; manifest et service worker pour l’installation et les notifications.
- Express, SQLite et Server-Sent Events pour les données et la synchronisation ; Web Push/VAPID pour les notifications hors page.
- Écritures enregistrées côté serveur, identifiants de requête évitant les doublons sur une même requête, suppressions logiques pour les corrections.
- Un seul processus applicatif assure le direct. Pour plusieurs instances, remplacer la diffusion SSE en mémoire par un système de diffusion partagé et employer un stockage adapté. Ne pas mettre les flux SSE en tampon dans le proxy inverse.

## À prévoir avant un déploiement réel

Il s’agit d’une **première version fonctionnelle**, pas d’un service de production durci. La sélection d’un vendeur est déclarative : elle ne constitue pas une authentification personnelle et ne protège pas contre l’usurpation d’un nom. Avant utilisation avec de vraies données, mettre en place une authentification individuelle, une gestion des rôles et des accès par magasin, HTTPS, des sauvegardes, une supervision, une limitation des requêtes au niveau du proxy, ainsi qu’une politique de conservation et d’accès aux données adaptée. L’aperçu temporaire n’est pas un hébergement de production.

## Sources et marques

- Liste initiale des magasins : données © les contributeurs d’[OpenStreetMap](https://www.openstreetmap.org/copyright), sous licence ODbL, via la BAse Nationale des Commerces Ouverte. La liste est indicative et n’est pas synchronisée en temps réel avec l’annuaire officiel de la Fnac.
- Identité visuelle inspirée de la Fnac. Le logo provient de [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fnac_Logo.svg). Les marques et logos appartiennent à leurs propriétaires ; vérifier les autorisations nécessaires avant une diffusion publique.
