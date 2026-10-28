# Déployer Fnac Pulse gratuitement

Ce guide configure **GitHub Pages + Firebase Spark + Cloudflare Workers/Queues Free**. Il ne crée aucune ressource automatiquement et ne nécessite ni domaine personnalisé, ni serveur Node.js permanent, ni Firebase Blaze. Les intitulés des consoles peuvent évoluer.

> **Important** — La configuration réelle est publiée et une notification iPhone a été reçue. La synchronisation sur deux appareils physiques distincts et les limites en charge restent à vérifier. Les tests et émulateurs ne constituent pas un audit de sécurité.
>
> Ne partagez jamais ici ou dans Git de mot de passe, PIN, fichier JSON de compte de service, clé privée VAPID, `PIN_PEPPER` ou jeton d'accès. La configuration Web Firebase, l'URL Worker et la **clé VAPID publique** ne sont pas des secrets. Les règles Firestore et les contrôles du Worker, et non la confidentialité de la configuration Web, protègent les données.

## Mise à jour d'une installation existante : jours travaillés par vendeur

Dans **Administration → Magasins**, choisir le magasin à gérer. Dans **Objectifs**, l'administrateur sélectionne ensuite chaque vendeur et règle ses **jours travaillés du lundi au dimanche**, de un à sept jours. Les blocs **Jours travaillés** et **Services** sont distincts. Tant que ce choix n'a pas été enregistré, le lundi au vendredi est utilisé **par défaut et doit être vérifié** ; les plannings déjà enregistrés sont conservés. Les jours fériés sont inclus s'ils tombent sur un jour choisi. Il s'agit d'un planning hebdomadaire récurrent, sans suivi des absences ou rotations ponctuelles. La modification s'applique immédiatement à la période courante et aux suivantes, sans modifier les ventes ni la cible choisie.

Les cibles jour, semaine et mois sont calculées à partir d'une seule référence par service et réparties en nombres entiers : certains jours ou certaines semaines peuvent être à zéro. Une semaine qui traverse un changement de mois additionne les quotas quotidiens des deux mois ; toutes les ventes restent comptabilisées, même hors planning. Pour les anciens objectifs à plusieurs cibles, le mensuel reste prioritaire, puis l'hebdomadaire et le quotidien.

1. Déployer d'abord le **nouveau Worker Cloudflare** en préservant ses secrets et sa Queue. Le planning est stocké dans le document privé `pulseGoals` existant ; seules les routes réservées à l'administrateur peuvent le modifier. Les règles Firestore existantes restent inchangées.
2. Pousser le code et lancer le workflow GitHub Pages manuel, puis fermer et rouvrir la PWA en ligne. Choisir le magasin dans **Magasins**, puis sélectionner chaque vendeur dans **Objectifs**, vérifier ses jours et les enregistrer. La période de référence jour/semaine/mois reste réglable pour chaque service.
3. Tester un vendeur avec le dimanche inclus, une autre personne avec le dimanche exclu, une vente et sa correction, puis la synchronisation sur leurs appareils. Pour supprimer les trois cibles d'un service, utiliser le bouton dédié. Les PIN, les cibles de référence et les ventes existants ne sont pas effacés.

### Première installation des objectifs personnels

Les objectifs sont séparés par vendeur et par service. Le vendeur et l'administrateur peuvent choisir une référence récurrente ; les ventes et corrections déjà enregistrées alimentent automatiquement les barres. Aucun objectif n'est créé par défaut, et les PIN et les ventes existants ne sont pas modifiés.

1. Vérifier que les règles Firestore publiées correspondent à [`firestore.rules`](firestore.rules), notamment que la règle de refus par défaut interdit toute lecture et écriture directes de `pulseGoals`. Les cibles sont lues et modifiées par le Worker après contrôle du vendeur ou de l'administrateur. Ne pas ajouter de règle autorisant directement cette collection, même au propriétaire. Si les règles en place sont déjà identiques, aucune nouvelle publication des règles n'est nécessaire.
2. Déployer d'abord le **nouveau Worker Cloudflare**, en conservant les trois secrets et la Queue existants ; vérifier `/api/health` et `/api/bootstrap`. La collection d'objectifs se crée automatiquement lors du premier enregistrement : aucune migration des ventes ou création manuelle n'est nécessaire.
3. Pousser le code, puis exécuter le workflow **Déployer Fnac Pulse sur GitHub Pages**. Il est manuel et ne se lance pas au seul push. Sur chaque appareil, fermer puis rouvrir l'application pour actualiser son cache.
4. En ligne, régler une cible dans **Mes objectifs → Gérer**, enregistrer une vente puis la corriger : les trois périodes concernées doivent se mettre à jour. Avec un second vendeur, vérifier qu'il ne voit pas les objectifs du premier. Dans **Administration → Objectifs**, choisir le magasin et le vendeur et modifier une cible ; vérifier sa mise à jour sur l'appareil du vendeur.
5. La modification est immédiate et durable pour la période courante et les suivantes ; le bouton de suppression retire les trois cibles du service. Si une autre personne modifie le même service au même moment, recharger les valeurs avant de recommencer. Hors ligne, la dernière vue peut rester visible, mais aucune vente ni modification d'objectif n'est enregistrée en attente. L'appareil peut garder des données en cache : se déconnecter et, si nécessaire, effacer les données du site sur un appareil partagé.

### Historique : migration des vendeurs par magasin

Pour une installation plus ancienne qui n'a pas encore été migrée, cette version rattache les vendeurs historiques à **Fnac Labège** (`osm-way-386504727`), avec les mêmes identifiants. Les autres magasins démarrent sans vendeurs ; les documents des ventes et les PIN ne sont ni supprimés ni modifiés. Un même prénom peut ensuite être ajouté dans plusieurs magasins, avec un PIN distinct.

1. Déployer d'abord le **nouveau Worker** sur Cloudflare, sans modifier les trois secrets existants. Le premier accès à `/api/bootstrap` effectue la migration du catalogue avec précondition de concurrence et crée une copie de son état précédent dans `pulseBackups/catalog-before-store-scoping-v1`. La sauvegarde et la migration du catalogue sont atomiques. Cette copie ne remplace **pas** une sauvegarde complète de Firestore.
2. Vérifier que `/api/bootstrap` répond et que les vendeurs historiques portent `storeId: osm-way-386504727`. Dans Firestore, vérifier que `pulse/catalog` contient `catalogVersion: 2` et `sellerStores` **avant** de modifier les règles : sinon les vendeurs risquent de perdre temporairement l'accès en lecture.
3. Publier l'interface GitHub Pages via le workflow manuel, puis remplacer les règles dans **Firebase → Firestore Database → Règles** par le contenu de [`firestore.rules`](firestore.rules) et appuyer sur **Publier**. Les nouvelles règles vérifient l'appartenance du vendeur à son magasin. Les anciennes sessions restées ouvertes sur le mauvais magasin sont refusées ; celles de Labège gardent leur PIN.
4. Fermer et rouvrir l'application sur chaque appareil pour charger la nouvelle version. Dans **Administration**, choisir le magasin avant d'y ajouter des vendeurs ou de réordonner les services. Définir un PIN pour chaque nouveau vendeur. Tester la vente, le classement, l'ordre et les notifications sur les appareils de l'équipe.

Noms et activation des services sont communs à tous les magasins ; seul leur **ordre** est propre à chaque magasin. Les priorités de classement DMax et FVD correspondent aux services historiques (identifiants 1 et 5), même si leur intitulé est modifié.

## 1. Préparer le projet Firebase

Dans la [console Firebase](https://console.firebase.google.com/), ouvrir le projet dédié **`fnac-pulse`** et vérifier qu'il est bien sur l'offre **Spark**. La configuration Web déjà fournie se trouve dans `src/firebase-config.js`.

### Firestore

1. Ouvrir **Firestore Database** / **Firestore**, puis créer une base **Standard**, identifiant **`(default)`**. Choisir une région adaptée ; `europe-west9` (Paris) est une option si elle convient à votre politique de données. **Le choix de la région est difficilement réversible** : vérifier avant de valider. Ne pas choisir Enterprise ni Datastore mode pour ce projet.
2. Sélectionner le mode de production fermé si proposé. Dans l'onglet **Règles**, remplacer les règles par le contenu exact de [`firestore.rules`](firestore.rules), puis **Publier**. Ne pas laisser des règles de test ouvertes.
3. Il n'est pas nécessaire de créer les collections manuellement. Le catalogue est initialisé au premier accès réussi au Worker. Les comptes de service agissent via IAM et ne sont pas limités par les règles client.

Alternative depuis un ordinateur disposant de Node.js 20 et d'un compte Google autorisé :

```bash
npx --yes firebase-tools@13.35.1 login
npx --yes firebase-tools@13.35.1 deploy --only firestore:rules --project fnac-pulse
```

### Authentication

1. Dans **Authentication → Sign-in method**, activer **E-mail/Mot de passe** pour l'administrateur.
2. Dans **Users / Utilisateurs**, ajouter un compte administrateur dédié avec un mot de passe long et unique. Copier son **UID** pour le renseigner plus tard dans Cloudflare ; ne pas le confondre avec le project ID.
3. Dans **Settings → Authorized domains**, ajouter `hypernovax31.github.io` si nécessaire. Les vendeurs n'ont pas de compte e-mail : leur connexion utilise des jetons personnalisés émis par le Worker.
4. Surveiller les comptes créés et protéger l'accès à Firebase. L'activation du fournisseur e-mail peut permettre des inscriptions via les API Firebase ; les comptes non autorisés n'obtiennent pas pour autant les droits administrateur ni l'accès aux données dans les règles fournies.

### Cloud Messaging

1. Dans **Paramètres du projet → Cloud Messaging**, vérifier que **Firebase Cloud Messaging API (V1)** est activée ; suivre le lien vers Google Cloud si nécessaire, sans activer de facturation.
2. Dans **Web configuration / Certificats Web Push**, générer une paire de clés si elle n'existe pas. Copier **uniquement la clé publique** pour GitHub Actions. La clé privée reste dans Firebase et ne doit pas être partagée.

## 2. Créer un compte de service pour le Worker

Dans [Google Cloud Console](https://console.cloud.google.com/), sélectionner le **même projet `fnac-pulse`** :

1. Dans **IAM et administration → Comptes de service**, créer un compte dédié à Fnac Pulse.
2. Lui attribuer les rôles **Cloud Datastore User** (`roles/datastore.user`) et **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`). Éviter `Owner` et les rôles d'agent de service.
3. Dans l'onglet **Clés** du compte, créer une clé **JSON**. Ce fichier contient une clé privée : il ne doit jamais être ajouté au dépôt ni envoyé dans une conversation. Le conserver uniquement selon votre politique de sécurité ou supprimer la copie locale après import sécurisé.

Ce compte a accès aux données Firestore via IAM : toute personne qui détient sa clé peut agir avec ses permissions. En cas de fuite, révoquer la clé dans Google Cloud, en créer une nouvelle et remplacer le secret Cloudflare.

## 3. Déployer le Worker Cloudflare

Sur votre ordinateur, installer Node.js 20+ et Git, puis récupérer ce dépôt et se placer dans son dossier :

```bash
git clone https://github.com/hypernovax31/FNAC-Pulse.git
cd FNAC-Pulse
npm ci
npx --yes wrangler@4.45.0 login
npx --yes wrangler@4.45.0 queues create fnac-pulse-notifications
npx --yes wrangler@4.45.0 deploy
```

La commande précédente crée la Queue ; le premier déploiement crée le Worker puis affiche une adresse `https://…workers.dev`. Il ne pourra pas accéder à Firebase tant que ses secrets ne sont pas configurés. Si une queue du même nom existe déjà dans votre compte, réutilisez-la après vérification. Le domaine personnel n'est pas modifié.

Ajouter ensuite les **trois secrets** :

```bash
# À l'invite, saisir l'UID de l'administrateur Firebase, pas son mot de passe.
npx --yes wrangler@4.45.0 secret put ADMIN_UID

# Génère un secret aléatoire de 32 octets directement dans Cloudflare,
# sans l'imprimer dans le terminal ni l'enregistrer dans l'historique.
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx --yes wrangler@4.45.0 secret put PIN_PEPPER
```

Pour `GOOGLE_SERVICE_ACCOUNT`, utiliser le contenu du fichier JSON privé dans le secret Cloudflare. Sous macOS/Linux, adapter uniquement le chemin ci-dessous et l'exécuter **sur votre ordinateur** :

```bash
cat "$HOME/Downloads/mon-compte-de-service.json" | npx --yes wrangler@4.45.0 secret put GOOGLE_SERVICE_ACCOUNT
```

Sous PowerShell :

```powershell
Get-Content -Raw "$HOME\Downloads\mon-compte-de-service.json" | npx --yes wrangler@4.45.0 secret put GOOGLE_SERVICE_ACCOUNT
```

Sinon, ajouter les secrets dans **Cloudflare → Workers & Pages → fnac-pulse-api → Settings → Variables and Secrets**, en sélectionnant le type **Secret**. Ne jamais coller le JSON dans un fichier suivi par Git. Cloudflare ne permet pas de relire un secret après enregistrement ; si `PIN_PEPPER` est remplacé, il faudra redéfinir les PIN vendeurs.

`wrangler.toml` fixe l'origine autorisée à `https://hypernovax31.github.io` et l'adresse de l'application à `https://hypernovax31.github.io/FNAC-Pulse/`. Ne les changer que si l'adresse réelle change, puis redéployer. Vérifier dans Cloudflare que la Queue est liée au Worker en producteur **et** consommateur et que le déclencheur périodique est présent. En cas de problème, consulter les journaux :

```bash
npx --yes wrangler@4.45.0 tail
```

L'adresse publique `https://ADRESSE-DU-WORKER/api/health` doit répondre `{"ok":true}`. `https://ADRESSE-DU-WORKER/api/bootstrap` doit retourner le catalogue après configuration Firebase ; le test de santé seul ne valide pas l'accès à Firebase ni les notifications.

## 4. Configurer GitHub Pages

Sur le dépôt GitHub **Settings → Pages**, choisir **GitHub Actions** comme source de publication. Puis, dans **Settings → Secrets and variables → Actions → Variables**, créer les deux variables de dépôt suivantes :

| Nom | Valeur publique |
| --- | --- |
| `PULSE_WORKER_URL` | Adresse HTTPS du Worker `https://…workers.dev`, sans `/api` |
| `FIREBASE_VAPID_PUBLIC_KEY` | Clé Web Push **publique** copiée dans Firebase |

Dans l'onglet **Actions**, choisir **Déployer Fnac Pulse sur GitHub Pages**, puis **Run workflow** sur `main`. Le workflow est volontairement **manuel** : il ne publie pas automatiquement après un push. Il vérifie les variables, exécute les tests, compile pour `/FNAC-Pulse/` et déploie l'artefact Pages.

Ouvrir ensuite <https://hypernovax31.github.io/FNAC-Pulse/> dans un onglet normal. Si le workflow échoue, lire son journal sans y coller de secret. Après une modification du code ou des variables, relancer le workflow manuellement.

## 5. Première mise en service et recette

1. Ouvrir **Administration**, se connecter avec le compte Firebase créé à l'étape 1, puis ouvrir **Codes PIN**.
2. Pour chaque couple **magasin / vendeur**, définir un PIN différent de 8 chiffres. Le générateur intégré est préférable à un code facile à deviner. Le transmettre au vendeur par un canal privé. Cinq échecs successifs entraînent un blocage temporaire ; l'administrateur peut redéfinir le PIN.
3. Sur deux appareils, se connecter avec deux vendeurs du même magasin. Ajouter une vente sur l'un : vérifier sa présence dans le bilan et sur l'autre appareil. Vérifier une correction et le classement. Tester un second magasin pour vérifier l'isolation.
4. Sur chaque appareil, autoriser les notifications. Tester l'envoi avec l'application ouverte puis fermée ; sur iPhone/iPad, installer d'abord la PWA depuis Safari. Les navigateurs, les réglages système et les politiques d'économie d'énergie peuvent empêcher la réception.
5. Vérifier le changement d'un PIN : l'ancienne session ne doit plus pouvoir lire de nouvelles données ni écrire. Vérifier également les permissions Firestore et la protection de l'accès administrateur.
6. Consulter les tableaux de consommation et les journaux Firebase et Cloudflare. Établir une procédure de sauvegarde, une politique de conservation et un responsable d'accès. Les données s'accumulent ; le nettoyage et la sauvegarde complète ne sont pas automatiques.

Une Queue est utilisée pour les tentatives de notification, mais ni une Queue ni FCM ne garantissent que chaque appareil affiche chaque notification exactement une fois. Les pannes, retries, limites et quotas peuvent causer des retards, pertes ou doublons. Les requêtes et le CPU réellement consommés dépendent du nombre d'appareils et doivent être mesurés sur le compte gratuit.

## 6. Tests locaux facultatifs

```bash
npm ci
npm test
npm run build:pages
npx --yes wrangler@4.45.0 deploy --dry-run
```

Pour exécuter aussi l'intégration Firestore/Auth sans accéder au vrai projet, il faut Java 11+ compatible avec l'émulateur utilisé et les ports locaux 8085 et 9099 libres. Dans un premier terminal :

```bash
npx --yes firebase-tools@13.35.1 emulators:start --only firestore,auth --project demo-fnac
```

Dans un second terminal, depuis le dépôt :

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node --test tests/firebase-emulator.test.js
```

Le test **efface les documents du projet fictif `demo-fnac` dans l'émulateur**. Ne modifiez pas cette commande pour viser une base réelle. Les refus `PERMISSION_DENIED` affichés pendant ce test sont attendus : ils vérifient les règles. Le test ne valide ni le vrai compte de service ni FCM.

## Références

- [Tarifs Firebase](https://firebase.google.com/pricing/) et [quotas Firestore](https://firebase.google.com/docs/firestore/quotas)
- [Limites Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/) et [tarifs Queues](https://developers.cloudflare.com/queues/platform/pricing/)
- [FCM sur le Web](https://firebase.google.com/docs/cloud-messaging/web/get-started)
- [GitHub Pages avec GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
