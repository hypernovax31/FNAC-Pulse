# Déployer Fnac Pulse gratuitement

Ce guide configure **GitHub Pages + Firebase Spark + Cloudflare Workers/Queues Free**. Il ne crée aucune ressource automatiquement et ne nécessite ni domaine personnalisé, ni serveur Node.js permanent, ni Firebase Blaze. Les intitulés des consoles peuvent évoluer.

> **Important** — La configuration réelle est publiée et une notification iPhone a été reçue. La synchronisation sur deux appareils physiques distincts et les limites en charge restent à vérifier. Les tests et émulateurs ne constituent pas un audit de sécurité.
>
> Ne partagez jamais ici ou dans Git de mot de passe, PIN, fichier JSON de compte de service, clé privée VAPID, `PIN_PEPPER` ou jeton d'accès. La configuration Web Firebase, l'URL Worker et la **clé VAPID publique** ne sont pas des secrets. Les règles Firestore et les contrôles du Worker, et non la confidentialité de la configuration Web, protègent les données.

## Mise à jour : profil et administration au lancement

Cette modification concerne **Pages uniquement** : publier le workflow manuel, puis fermer et rouvrir la PWA en ligne pour charger le cache v53. Le Worker, les règles Firebase, les comptes, les ventes, les objectifs et les sessions ne sont pas modifiés par ce déploiement.

À chaque ouverture, l’écran de lancement propose le choix ou la création du profil vendeur, ou affiche la session existante sans la fermer. **Plus tard · Accéder aux services** permet d’entrer sans profil. **Administration** ouvre directement le panneau ou sa connexion, sans passer par l’accueil ; il devient disponible après chargement du catalogue des magasins. Une invitation directe continue d’ouvrir l’administration. Le premier geste sonore de la PWA installée et l’étape facultative des notifications et de la géolocalisation sont conservés.

## Historique : panneau administrateur épuré

Cette modification concerne **Pages uniquement** : elle retire deux encarts de l’interface sans supprimer les anciennes demandes, comptes ou droits. Le Worker existant et la configuration Firebase restent inchangés. Publier Pages par son workflow manuel, puis fermer et rouvrir la PWA en ligne pour charger le cache v51.

## Invitations administrateur par e-mail et journée unique

Déployer d’abord le **Worker** complet, sans modifier ses secrets, sa Queue ni les règles Firebase, puis publier Pages par son workflow manuel. Fermer puis rouvrir la PWA en ligne pour charger le cache courant. Le déploiement ne crée ni ne supprime de compte et ne modifie aucune vente, aucun objectif ou session existante. Les anciennes demandes et invitations restent compatibles.

Dans **Administration → Ventes**, choisir un vendeur et **une seule journée** : les actions **Ajouter** ou **Retirer** portent sur cette date et demandent confirmation. Les nouveaux ajouts ou retraits sur une semaine ou un mois sont refusés côté serveur ; les lectures et les rejouements déjà enregistrés restent compatibles. Le reset global est distinct. Les objectifs, le catalogue, les autres ventes et magasins sont conservés.

Dans **Administration → Administrateur**, saisir l’adresse, toucher **Continuer**, vérifier qu’elle est exacte et confirmer les droits sur tous les magasins. L’application demande le mot de passe administrateur uniquement si la connexion doit être renouvelée. Firebase envoie son **message standard de connexion par lien** ; la bienvenue est affichée par la page Fnac Pulse, pas garantie dans l’e-mail. Le destinataire confirme son adresse puis choisit son mot de passe personnel ; un ancien compte vérifié peut utiliser son mot de passe habituel. L’accès est activé après vérification, sans seconde approbation. Les invitations en attente peuvent être renvoyées ou annulées ; elles expirent après sept jours, et les liens Firebase peuvent expirer plus tôt. Une annulation ne supprime pas le compte et n’invalide pas nécessairement un lien Firebase déjà envoyé. Voir [le README](README.md#comptes-administrateurs).

L’URL d’action Firebase enregistrée est `https://hypernovax31.github.io/FNAC-Pulse/`. Le titulaire d’une adresse autorisée a confirmé la réception du message, l’activation et l’accès à plusieurs magasins avec un nouveau compte ; chaque magasin n’a pas été testé individuellement. La demande d’envoi ne garantit pas la réception : vérifier les indésirables et les quotas Firebase. La connexion par lien peut fermer d’autres sessions d’un compte existant et supprimer l’ancien mot de passe d’un compte non vérifié. Les tests automatisés et émulateurs utilisent des données fictives.

Les encarts des anciennes demandes sans e-mail et du compte de test ne sont plus affichés. Leurs données et les routes compatibles restent conservées ; aucune suppression n’est lancée. Les demandes manuelles en attente ne peuvent plus être approuvées depuis le panneau actuel : une nouvelle invitation e-mail peut être envoyée à la personne concernée. Un éventuel nettoyage du seul compte de test exige une identification certaine de l’adresse et de l’UID et un retrait ciblé des droits ; la suppression Auth et le retrait des droits ne sont pas atomiques.

## Historique : code administrateur à transmettre en privé

Cette mise à jour doit être publiée uniquement après accord explicite. Déployer d’abord le **Worker**, puis Pages, en conservant les secrets, la Queue et les règles Firestore existants. La nouvelle interface dépend des nouvelles routes Worker ; les anciennes routes restent compatibles. Aucun utilisateur, droit, donnée ou session n’est migré par le déploiement. Fermer puis rouvrir la PWA en ligne pour obtenir le cache v46.

Dans **Administration → Administrateur**, un administrateur connecté confirme les droits et génère un code sans ressaisir son mot de passe. Il le transmet par un moyen privé. Le destinataire utilise **Créer mon accès avec un code** sur son appareil, saisit une nouvelle adresse contrôlée et un mot de passe provisoire de 1 à 6 caractères, puis choisit un mot de passe personnel d’au moins 12 caractères avant tout accès. Aucun e-mail n’est envoyé. Un code permet de démarrer une seule création pendant 24 heures ; si elle est interrompue, reprendre dans les sept jours avec le même code, la même adresse et le même provisoire. Une autre adresse exige un nouveau code. Le code ne peut être annulé depuis l’écran que tant qu’il y est encore affiché et que la création n’a pas abouti.

Cette option acceptée ne vérifie pas l’adresse par e-mail et ne la marque pas comme vérifiée dans Firebase. Une personne contrôlant la boîte pourrait récupérer le compte si la réinitialisation fonctionne. Le serveur conserve seulement le hash du code, lie celui-ci à une adresse et vérifie que le compte Firebase est né après réservation. Il n’attribue aucun droit à un compte préexistant, à un profil vendeur ou si `accounts:lookup` est inaccessible. Les six caractères ne sont jamais transmis au Worker : Firebase reçoit une clé provisoire longue calculée localement à partir du code secret, de l’adresse et du mot de passe choisi. La session ouverte d’un administrateur suffit pour générer des codes : si elle est volée, un tiers pourrait en générer. Protéger également le code transmis.

Les vérifications utilisent uniquement émulateurs et données fictives ; aucun compte, e-mail ou test de production n’a été utilisé pour ce parcours. Le comportement réel de `accounts:lookup` et la récupération des mots de passe par e-mail restent incertains. Ne pas déclencher de test réel sans accord distinct.

## Historique : création directe des administrateurs

L’ancienne interface demandait au créateur l’adresse du destinataire, un mot de passe provisoire d’au moins 12 caractères et son propre mot de passe. Elle n’est plus proposée dans la nouvelle interface, mais les routes et les comptes déjà créés restent compatibles. Aucun e-mail n’était envoyé et la première connexion imposait déjà un mot de passe personnel.

## Historique : page sécurisée pour les liens administrateur

1. Publier Pages puis vérifier que [la page de secours](https://hypernovax31.github.io/FNAC-Pulse/?aide-invitation=1) s’affiche. Aucun Worker, secret, compte, droit ou règle Firestore ne doit être modifié. Tester avec les émulateurs et des adresses fictives, sans invitation de production.
2. Pour que **les prochains e-mails Firebase** ouvrent directement Fnac Pulse au lieu du gestionnaire standard, se connecter à la [console Firebase du projet](https://console.firebase.google.com/project/fnac-pulse/authentication/emails), ouvrir **Authentication → Modèles**, modifier un modèle par l’icône crayon, choisir **Personnaliser l’URL d’action** et enregistrer exactement `https://hypernovax31.github.io/FNAC-Pulse/` (sans paramètre). La modification est **globale à tous les modèles du projet** : les actions mot de passe, vérification, changement et récupération d’adresse sont prises en charge et demandent confirmation ; un type inconnu propose le gestionnaire Firebase par défaut. Le domaine `hypernovax31.github.io` doit rester autorisé dans Authentication → Paramètres → Domaines autorisés. Si la Console refuse l’enregistrement, les nouveaux e-mails continuent d’ouvrir le gestionnaire Firebase : utiliser la page de secours et demander l’aide du [support Firebase](https://firebase.google.com/support/troubleshooter/contact), sans transmettre de lien, code ou mot de passe.
3. Les e-mails déjà envoyés conservent leur ancienne URL et leurs délais de validité. Si leur page bloque et que le lien n’a pas expiré, le destinataire peut copier le lien dans sa messagerie, ouvrir la page de secours ci-dessus et le coller **sans le partager**. Sinon, demander un nouveau lien ou une nouvelle invitation. Après choix du mot de passe, ouvrir l’administration et se connecter avec son e-mail et son mot de passe ; depuis la mise à jour actuelle, l’acceptation est automatique. L’envoi et la réception d’un e-mail réel ne sont pas garantis par les tests.
4. Si nécessaire, revenir à l’URL d’action par défaut proposée par la Console (gestionnaire Firebase standard) ; ce changement est lui aussi global. Ne jamais transmettre un lien, un code, un mot de passe ou un jeton dans une assistance ou un journal.

## Historique : administrateur simplifié et choix du département

Cette mise à jour concerne Pages uniquement : elle ne modifie ni le Worker, ni les règles Firestore, ni les comptes, données ou sessions. Dans **Administrateur**, saisir l’adresse de la personne à inviter puis appuyer sur **Continuer** ; la confirmation avec son propre mot de passe reste nécessaire avant l’envoi. L’invité choisit lui-même son mot de passe et accepte l’invitation. L’onglet conserve la modification de son propre mot de passe, mais ne propose plus de modifier son adresse e-mail. L’indication « Choisir un département » est grisée tant qu’aucun département n’est choisi. Fermer puis rouvrir la PWA en ligne pour actualiser son cache.

## Historique : invitations et navigation administrateur

1. Déployer d’abord le Worker sans modifier ses secrets, sa Queue ou les règles Firestore, puis publier Pages. Les anciennes routes restent disponibles pour les versions précédentes ; aucun profil, magasin, PIN, vente, objectif ou session n’est migré ou supprimé. Fermer puis rouvrir la PWA en ligne pour actualiser son cache. L’écran de bienvenue redessiné conserve son apparition au premier lancement installé uniquement, l’icône d’origine, le son facultatif et le geste d’accès.
2. Les magasins historiques non confirmés sont retirés des sélecteurs, même s’ils ont une équipe. Les données et sessions restent en base ; un profil déjà mémorisé peut encore être retrouvé sur son appareil, mais un nouveau choix de magasin historique n’est plus possible tant qu’il n’est pas confirmé. Les ajouts admin et copies non vérifiées restent sélectionnables. Dans **Magasins**, le magasin choisi est mémorisé dans l’onglet pendant la session administrateur, même si l’espace Administration est fermé puis rouvert ou que la page est rechargée. Il est effacé à la déconnexion, sans modifier le profil vendeur ; la fermeture définitive de l’onglet ou du navigateur peut terminer la session.
3. Dans **Administrateur**, inviter par adresse et mot de passe administrateur actuel. Prévenir l’invité séparément : Firebase lui envoie normalement un lien de réinitialisation pour qu’il choisisse son mot de passe ; il se connecte ensuite dans **Administration** ; depuis la mise à jour actuelle, l’acceptation est automatique. Cette invitation expire après sept jours ; le lien Firebase peut expirer plus tôt. Une adresse existante n’est jamais promue sans acceptation et peut conserver son mot de passe. Tous les administrateurs ont les mêmes droits globaux. L’administrateur historique conserve son accès.
4. Si le lien bloque, depuis l’écran de connexion ouvrir **Mot de passe oublié ou lien bloqué ?**, coller le lien complet de réinitialisation ou de confirmation d’adresse, vérifier l’adresse puis choisir le mot de passe ou confirmer l’adresse. Ne jamais partager ce lien. L’application vérifie l’action et le projet et communique directement avec Firebase, sans envoyer le lien ou le mot de passe au Worker. Si le courriel n’arrive pas, vérifier les indésirables et redemander le lien ; les quotas Firebase ou un compte sans fournisseur mot de passe peuvent empêcher l’envoi. Les tests utilisent uniquement des comptes fictifs et ne garantissent pas la réception d’un véritable e-mail.

## Historique : messages visibles, liste copiée et confirmation d’e-mail

1. Publier Pages, puis déployer le Worker avec ses secrets et sa Queue existants : la nouvelle interface est ainsi disponible avant les espaces régionaux. Les règles Firestore ne changent pas. Au premier accès, une migration atomique ajoute uniquement les deux choix régionaux absents après sauvegarde `pulseBackups/catalog-before-fnac-regional-choices-v1`. Elle ne réapplique pas l’ancien instantané des 189 fiches ; aucun magasin, profil, PIN, session, vente ou objectif n’est supprimé. Les homonymes ou identifiants conflictuels sont signalés plutôt que fusionnés.
2. La liste communiquée contient 191 noms : 189 fiches déjà présentes et deux mentions régionales sans fiche précise. Guadeloupe et La Réunion deviennent des espaces génériques explicitement signalés ; les bilans y sont communs et les notifications regroupent les vendeurs d’un même département. Une confirmation est demandée uniquement lors de la création d’un profil régional ; le Worker bloque cette création depuis une ancienne interface qui ne transmet pas l’accord, sans bloquer les profils existants. Ajouter des magasins précis pour ne pas mélanger des points de vente. L’actualisation automatique reste bloquée par Fnac et la date de vérification automatique n’est pas avancée.
3. L’ancienne interface proposait un contournement pour les liens de changement d’e-mail bloqués. Cette action et son contournement ne sont plus affichés dans l’onglet, conformément à la simplification décrite en tête du guide. Les adresses et droits existants restent inchangés ; le code compatible avec les anciennes versions reste disponible. Les essais automatisés utilisaient des comptes fictifs et ne prouvent pas le fonctionnement d’un message réellement reçu.
4. Les messages du bas apparaissent avec un contraste renforcé, une animation discrète (désactivée si l’utilisateur réduit les animations) et un délai de lecture plus long. Les actions tactiles et la possibilité de fermer restent disponibles. Fermer puis rouvrir la PWA en ligne sans la désinstaller pour prendre la version v40.

## Historique : administrateurs, profil au démarrage et annuaire

1. Déployer d’abord le **Worker** avec les secrets `ADMIN_UID`, `PIN_PEPPER`, `GOOGLE_SERVICE_ACCOUNT`, les variables et la Queue existants ; vérifier `/api/health` et `/api/bootstrap`, puis publier Pages avec le workflow manuel. Les règles Firestore restent inchangées. Ne lancer aucun reset ni migration de PIN ou de session. L’administrateur historique reste reconnu par le même `ADMIN_UID` ; il ne faut pas modifier ce secret pour ajouter un autre administrateur.
2. La PWA conserve le premier accueil tactile et les sessions déjà ouvertes. Sur **Bien démarrer**, une personne sans session peut choisir ou créer son profil, ou appuyer sur **Plus tard**. L’association des notifications autorisées est tentée après la connexion ; elle n’est pas présentée comme confirmée avant la réponse du serveur. Les deux phrases de la cloche et l’ordre des onglets sont définis dans le README et l’interface.
3. L’ancien parcours de création, où l’administrateur choisissait un mot de passe initial, est remplacé par l’invitation décrite en tête du guide. Les comptes et droits déjà attribués restent valables ; les sessions du créateur et du vendeur ne sont pas fermées.
4. Chaque administrateur peut toujours changer son propre mot de passe ; la modification de son adresse e-mail n’est plus proposée dans l’onglet. Une reconnexion du compte modifié peut être nécessaire. Tester uniquement avec les émulateurs et des adresses fictives, pas avec des comptes réels de production.
5. **Vérifier maintenant** tente un accès au site Fnac mais celui-ci renvoie 403 ou un CAPTCHA aux serveurs testés, y compris Browser Run. L’automatisation mensuelle demandée **ne fonctionne pas actuellement** : la liste conservée peut être ancienne. Une source officielle accessible et autorisée reste nécessaire. Le repli **Importer manuellement une copie Fnac** accepte, si compatible, la copie complète ou le fichier HTML, donne un aperçu et demande confirmation ; son origine et sa fraîcheur ne sont pas certifiées. Les modifications manuelles sont signalées, les magasins absents et données sont conservés, et les noms remplacés restent recherchables. Aucun import ni changement de magasin réel ne doit être effectué pour un smoke test.

## Historique : accueil, son et notifications

1. Déployer le Worker en conservant ses secrets et sa Queue, puis publier GitHub Pages avec le workflow manuel. Le seul changement de charge utile est le motif de vibration demandé aux notifications ; les destinataires, les règles Firestore et les données ne changent pas. Fermer puis rouvrir la PWA en ligne pour recevoir l’interface actualisée.
2. Le nouvel accueil minimaliste apparaît uniquement lors du premier lancement installé, sans modifier l’icône approuvée, le MP3 ni la préférence sonore. Les installations ayant déjà terminé cet accueil ne le revoient pas ; aucune session n’est réinitialisée. Le haut-parleur permet de choisir **SON activée** ou **SON désactivé** avant l’appui sur **Accéder aux services**.
3. Autoriser les notifications sur l’écran de démarrage donne l’accord du système, mais n’associe pas encore l’appareil à un vendeur. La carte ne redemande plus l’activation pendant le choix du profil ; la cloche explique l’attente. Si la préparation échoue, une carte **Activation à finaliser** donne accès à l’explication et l’association est retentée après connexion. Une erreur après connexion reste vérifiable et réessayable. Une désactivation volontaire reste respectée.
4. Les notifications demandent trois impulsions de 70 ms, séparées de 70 ms. C’est une option Web Push facultative, non disponible sur iPhone/iPad et ignorée par Chrome sur Android 8 ou plus : l’appareil peut appliquer son propre réglage ou ne pas vibrer. Ne pas promettre le motif ni confondre le test de charge utile avec une vibration réelle. La livraison et le son système dépendent aussi du navigateur, du réseau et du téléphone.

## Historique : détails des ventes et localisation

Cette mise à jour concernait uniquement GitHub Pages ; le Worker et les règles Firestore ne changeaient pas. Aucune vente, session, préférence ou donnée n’a été effacée. Les détails **Ma journée** et **Ventes de l’équipe** conservent leurs quantités par service sans le compteur de types.

Sur iPhone, tester **Activer** puis **Vérifier** après un refus : chaque geste doit produire un résultat visible, sans dépendre de l’inscription réseau des notifications. Le diagnostic iPhone est accessible sous le bouton. Les réglages système, Safari et ceux du site ou de la PWA peuvent être distincts ; voir [l’aide de localisation du README](README.md#si-la-localisation-est-refusée-sur-iphone). iOS peut refuser immédiatement et l’application ne peut pas imposer une nouvelle invite. Tester sur l’appareil réel ; **Continuer** reste disponible et permet le choix manuel du magasin.

## Historique : accueil tactile

Cette mise à jour de l’interface ne modifiait ni le Worker, ni les règles Firestore, ni les ventes, objectifs, PIN ou sessions. L’écran de bienvenue attend un appui : l’appel au lecteur audio se fait directement dans ce geste, sans tentative automatique préalable. Le parcours a été présenté une fois même aux installations qui avaient déjà traité l’ancienne invitation sonore, puis mémorisé localement ; la mise à jour actuelle ne le réaffiche pas si ce parcours est terminé. Un onglet normal ne l’affiche pas. Le bouton est accessible au clavier ; le réglage sonore existant est conservé et peut être modifié sur l’écran. Si la lecture échoue ou prend trop de temps, un nouveau geste permet de réessayer ou de continuer sans son. Le volume, le mode silencieux et les politiques du système peuvent encore empêcher d’entendre le MP3 ; tester sur un iPhone réel. Effacer le stockage ou réinstaller peut faire réapparaître l’écran.

## Historique : son de bienvenue et alertes de l'équipe

1. Déployer d’abord le Worker avec sa Queue et ses secrets existants, puis publier Pages. Les règles Firestore ne changent pas et aucun vendeur, PIN, objectif, vente ou session n'est réinitialisé. Fermer et rouvrir la PWA en ligne pour charger la nouvelle interface ; une ancienne interface peut continuer de jouer l'ancien son jusqu'à sa mise à jour.
2. Le son MP3 est proposé une seule fois au premier lancement visible de la PWA, pas dans un onglet. Le stockage et la préférence sonore sont locaux ; une suppression du stockage peut recommencer ce parcours. L’accueil tactile décrit plus haut remplace l’ancienne invitation facultative et ne tente aucune lecture automatique.
3. Le Worker exclut tous les abonnements du vendeur auteur avant la mise en file et revérifie cette exclusion juste avant l'envoi, y compris pour les messages déjà en file. Il conserve les filtres magasin et département ; les autres vendeurs de l'équipe restent destinataires. Lorsque son empreinte est disponible et vérifiée, l'abonnement du téléphone qui a saisi la vente reste exclu même si ce téléphone change ensuite de profil. Une notification déjà transmise au système ne peut pas être rappelée ; les anciens clients ou un stockage local indisponible ne fournissent pas toujours cette empreinte, mais l'exclusion par vendeur reste appliquée.
4. La confirmation locale « Vente enregistrée » conserve le bouton Annuler, sans être une notification d'équipe. Cette ancienne version ne jouait pas le son Fnac pour les alertes ; la version actuelle le tente pour les alertes d’équipe au premier plan. En arrière-plan, le son éventuel reste régi par l’appareil. Tester uniquement avec des profils et ventes fictifs dans l'émulateur, puis faire une recette volontaire sur deux appareils réels si nécessaire ; une notification peut être retardée ou perdue.

## Mise à jour : vendeurs, PIN et suppression ciblée

1. Déployer d’abord le Worker avec ses secrets et sa Queue existants, puis publier Pages. Les règles Firestore restent inchangées. **Le déploiement ne supprime aucun vendeur et ne réinitialise aucun PIN, objectif ou vente.** Faire rouvrir l’application en ligne pour charger l’interface.
2. Le champ de magasin est recherchable ; la géolocalisation reste facultative. **Aujourd’hui** présente le total personnel, puis celui de l’équipe. L’administration regroupe les profils et la réinitialisation des PIN dans **Vendeurs** ; un vendeur choisit toujours lui-même son PIN.
3. Pour une suppression intentionnelle seulement : choisir le magasin dans **Magasins**, puis **Vendeurs → Supprimer définitivement un vendeur**. Vérifier le nom, le département et le magasin, lire l’avertissement, saisir **SUPPRIMER** et confirmer. Si le profil ou le magasin a été renommé, ou si le vendeur a changé de département entre-temps, la confirmation est refusée. Le profil, l’accès et le PIN, les ventes de toutes dates, objectifs et jours travaillés sont supprimés ; les bilans historiques changent. Les autres vendeurs et leurs données ne changent pas. L’archivage reste possible séparément et conserve l’historique.
4. Le lancement révoque l’accès dans la même transaction que le verrou de traitement. La Queue et le cron reprennent la purge par lots des ventes, jetons et demandes d’inscription ainsi que l’épuration ciblée des copies de catalogue de l’application. Un reset ou une autre suppression du même magasin attend la fin ; l’identifiant de demande empêche un second effacement en cas de réponse perdue. Les quotas gratuits peuvent retarder la fin. Les tests destructifs doivent être faits uniquement sur l’émulateur `demo-fnac`, jamais sur un vendeur réel.
5. Les copies hors ligne, les sauvegardes externes et les notifications déjà transmises ne peuvent pas être retirées à distance. Des marqueurs techniques sans nom ni PIN restent pour interdire les rejeux ; Firebase Authentication peut conserver un identifiant technique de compte, mais les contrôles Worker et les règles Firestore lui refusent désormais tout accès vendeur. La notification en cours d’envoi peut encore arriver.

## Mise à jour : reset des objectifs d’un département

1. Déployer le Worker avec les secrets et la Queue existants, puis publier Pages. Les règles Firestore restent inchangées. **Le déploiement ne lance aucun reset.** Faire rouvrir la PWA en ligne pour mettre l’interface à jour.
2. Dans **Administration → Magasins**, choisir le magasin ; dans **Objectifs → Reset global des objectifs**, choisir un département, lire l’avertissement, saisir **SUPPRIMER** et confirmer. Les objectifs de tous les vendeurs rattachés à ce département au moment de la confirmation, vendeurs et services archivés compris, deviennent non renseignés pour les trois périodes. Aucune sauvegarde automatique n’est créée. Ventes, plannings, PIN, autres départements et autres magasins sont conservés.
3. Le Worker conserve un travail privé et traite les vendeurs par lots. Leur statut individuel et le marqueur anonyme du récapitulatif signalent les changements ; la Queue et le cron reprennent les interruptions. Les vendeurs dont le lot n’est pas encore traité doivent attendre avant de modifier leurs cibles. Une cible créée après leur traitement est conservée. Les quotas gratuits peuvent retarder l’opération. Le suivi permet de reprendre une réponse perdue sans réexécuter un ancien reset ; les caches hors ligne et sauvegardes externes ne sont pas effacés.

## Mise à jour : reset global des ventes d’un magasin

1. Déployer le Worker avec la Queue et les secrets existants, puis publier l’interface Pages. Les règles Firestore restent inchangées. **Le déploiement ne lance aucun reset.** Faire fermer et rouvrir Fnac Pulse en ligne sur les appareils de l’équipe.
2. Dans **Administration → Magasins**, sélectionner le magasin, puis ouvrir **Ventes → Reset global**. Lire l’avertissement, saisir **SUPPRIMER** et confirmer seulement si l’historique entier de ce magasin doit être détruit. Tous les vendeurs et départements et toutes les dates sont concernés, y compris les ventes annulées. Aucun autre magasin, objectif, service, vendeur, planning, PIN ou session n’est supprimé. Si une restauration est nécessaire, réaliser une sauvegarde indépendante avant la confirmation : aucun retour arrière n’est prévu.
3. Le marqueur `pulseStores/{storeId}/sales/~sales-reset~` change de génération dans la même transaction que le suivi privé. Les clients à jour excluent immédiatement les ventes antérieures ; les ventes enregistrées après le démarrage sont conservées. La Queue supprime les anciens documents et assainit les anciennes notifications par lots ; le cron toutes les deux minutes reprend un travail interrompu. Le suivi indique la progression. Les quotas gratuits Firestore et Cloudflare peuvent retarder la suppression physique. Une notification déjà transmise au système peut encore arriver. Des identifiants techniques anonymisés restent pour empêcher la réapparition de demandes anciennes ; les caches hors ligne et sauvegardes externes ne sont pas effacés par le bouton.

## Mise à jour : cartes des objectifs personnels

Publier l’interface GitHub Pages : aucune modification du Worker, des règles Firestore, des objectifs enregistrés, des ventes, des PIN ou des sessions n’est nécessaire. Dans **Mes objectifs**, les vues jour, semaine et mois ne montrent que les services ayant une cible calculée d’au moins 1 pour la période, même si elle est atteinte. Les cibles à 0 et les services sans cible sont masqués sans effacer les objectifs ou les ventes ; le bouton Ajouter ou Gérer permet toujours de modifier les objectifs. Les ventes personnelles, la cible de la période et le reste à faire sont identifiés séparément. Les objectifs hebdomadaires et mensuels couvrent la période entière ; les ventes affichées sont cumulées jusqu’à aujourd’hui. La fenêtre de saisie distingue aussi la cible de référence des trois cibles calculées. Aucun rappel de notification supplémentaire n’est créé.

## Mise à jour : installation et notifications au démarrage

Publier l’interface GitHub Pages : cette mise à jour ne change ni le Worker ni les règles Firestore, et ne réinitialise aucun PIN ou session. À l’ouverture dans un navigateur, une fenêtre propose l’installation ; si la PWA est déjà ouverte en mode autonome, elle ne s’affiche pas. Si l’icône existe déjà, l’ouvrir directement : un simple onglet ne peut pas toujours détecter cette installation.

Sur iPhone et iPad, toucher **Partager → Sur l’écran d’accueil → Ajouter**, puis ouvrir l’icône. Sur Android, le navigateur peut proposer un bouton d’installation ; sinon utiliser son menu. La permission de notification est lue dès l’ouverture et l’abonnement est vérifié après connexion du profil ; si les notifications ne sont pas actives, une fenêtre propose l’action appropriée. La demande système ne peut s’ouvrir qu’après un appui. En cas de blocage, autoriser les notifications dans les réglages ; en cas d’échec réseau, réessayer la vérification. Les permissions et les abonnements sont propres à chaque appareil et peuvent différer entre le navigateur et la PWA installée.

## Mise à jour : annuaire des magasins

1. Déployer le Worker et son `wrangler.toml` avec les secrets et la Queue existants, puis publier l’interface Pages. Les règles Firestore ne changent pas. Au premier accès au catalogue, une fusion atomique crée `pulseBackups/catalog-before-fnac-directory-v1` et conserve les clés des magasins, les profils, PIN, sessions, ventes, objectifs, plannings et ajouts administrateur. Cette copie ne remplace pas une sauvegarde complète.
2. Le catalogue reprend les noms de [l’annuaire Fnac](https://www.fnac.com/localiser-magasin-fnac/w-4) vérifié le 29 octobre 2026 (189 fiches). À l’époque, les deux mentions régionales sans fiche n’étaient pas sélectionnables ; elles le sont désormais comme espaces génériques, avec avertissement (voir la mise à jour en tête du guide). Les coordonnées historiques OpenStreetMap restent indicatives. Les fiches sans coordonnées ne sont pas géolocalisables. Depuis la mise à jour décrite en tête du guide, les anciens magasins non confirmés sont masqués des sélecteurs même lorsqu’une équipe y est rattachée ; leurs données restent conservées.
3. Un déclencheur mensuel `0 6 1 * *` tente de récupérer et valider l’annuaire le 1er de chaque mois à 06:00 UTC. En cas d’échec ou de liste incomplète, aucune liste n’est remplacée ; les fermetures ne suppriment ni ne désactivent les magasins et les homonymes sont signalés pour vérification. Un instantané avant une synchronisation réussie est gardé au plus une fois par mois dans `pulseBackups/catalog-before-fnac-sync-AAAA-MM`.
4. **Limite constatée le 29 octobre 2026 : fnac.com a renvoyé 403 aux tests automatisés depuis Cloudflare et GitHub. Les mises à jour mensuelles ne sont pas garanties et ne fonctionneront pas tant que cet accès est bloqué ou le format incompatible.** Le parseur n’a pas pu être validé sur le HTML réel ; un test synthétique sur Cloudflare a dépassé la limite nominale de 10 ms CPU du plan gratuit. Même si l’accès est rétabli, une validation du format et du quota sera nécessaire. Dans **Administration → Magasins**, vérifier l’état et utiliser **Vérifier maintenant**. Une source Fnac structurée, autorisée et accessible est préférable pour rendre l’automatisation fiable.

## Historique : écran et objectifs personnels

Pour une installation déjà passée au parcours sans code préalable, l’ancienne mise à jour d’écran seule ne demandait que la publication de GitHub Pages. **La nouvelle mise à jour de l’annuaire ci-dessus nécessite aussi le Worker.** Aucune de ces étapes ne réinitialise les PIN ou sessions ni ne modifie les objectifs ou ventes existants. Fermer puis rouvrir la PWA en ligne pour actualiser l'interface.

Le raccourci **Objectifs** ouvre le bloc personnel : les services restent présentés deux par ligne ; **Aujourd’hui**, **Semaine** ou **Mois** affiche une période à la fois. Le nom ou le crayon ouvre directement la modification, et **Ajouter** propose un service encore sans objectif. L'activité montre quatre ventes récentes et un menu pliant pour le reste de la journée. Le son de bienvenue est déclenché au premier lancement de la PWA après un geste ; la version actuelle le tente aussi pour les alertes d’équipe au premier plan. Les navigateurs peuvent limiter la lecture audio et imposent un geste pour demander les notifications. L'ancien reset historique ci-dessous est terminé et ne doit pas être relancé.

## Mise à jour : inscription autonome et PIN à 4 chiffres

1. Déployer **d’abord le Worker**, en conservant les secrets et la Queue ; vérifier `/api/health` et `/api/bootstrap`. Publier ensuite Pages avec le workflow manuel. Les règles Firestore ne changent pas. Une interface ancienne doit être fermée puis rouverte en ligne avant d’utiliser un profil passé à 4 chiffres.
2. Un vendeur sélectionne magasin → département → prénom. Si le prénom n’existe pas dans le magasin, il crée son profil et choisit/confirme lui-même son PIN à 4 chiffres ; si le profil existe déjà, son PIN est exigé, ou il peut être créé si le profil n’en a pas. Les homonymes dans un même magasin nécessitent l’aide du responsable. L’inscription et la première revendication sont libres, sans preuve d’identité.
3. Ne lancer **aucune réinitialisation globale** et ne pas supprimer le marqueur historique `pulseMigrations/open-pin-reset-2026-10-29`. La migration 8 → 4 intervient individuellement après déconnexion : l’ancien PIN est demandé, puis le nouveau est choisi. Les autres sessions ouvertes, les ventes, objectifs et plannings restent intacts. En revanche, une réinitialisation ponctuelle par l’administrateur révoque les sessions du vendeur.
4. Tester l’inscription et les cas d’homonymes dans un environnement de test, puis les anciennes sessions et la reprise après perte de réponse. Ne pas créer de vendeur fictif dans la base de production. Cinq tentatives rapprochées entraînent un blocage temporaire ; le PIN court et l’inscription libre comportent des risques d’usurpation et de devinette, même avec cette limitation.

## Migration historique déjà effectuée : première connexion sans code préalable

Cette ancienne migration a déjà été exécutée : elle a réinitialisé une fois les PIN et sessions de l’époque sans toucher aux vendeurs, ventes, objectifs ni plannings. Le Worker actuel ne relance plus cette migration, même si son marqueur manque. **Conserver le marqueur `pulseMigrations/open-pin-reset-2026-10-29`**, notamment en cas de retour à une ancienne version du Worker. Le parcours actuel à 4 chiffres utilise uniquement la transition individuelle décrite plus haut.

## Mise à jour : départements et jauges de récapitulatif

1. Déployer le Worker mis à jour en conservant ses secrets et sa Queue, puis publier la nouvelle interface Pages. Les règles Firestore existantes restent inchangées : le marqueur de rafraîchissement ne contient qu’une révision et utilise la collection de ventes déjà lisible, sans être inclus dans les requêtes de ventes.
2. Les vendeurs déjà inscrits restent dans leur magasin et sont automatiquement considérés comme membres de **Produits Techniques**. Cette ancienne étape de départements ne réécrivait ni PIN, ni objectif, ni vente historique ; la remise à zéro des PIN décrite plus haut est une étape distincte. Dans **Administration → Magasins**, choisir le magasin ; dans **Départements**, adapter si nécessaire les quatre départements ; puis affecter les vendeurs dans **Vendeurs**. Une réaffectation ne déplace pas les ventes passées.
3. À la connexion, choisir magasin → département → vendeur → PIN. Sur deux appareils, vérifier qu’une vente apparaît dans les compteurs, l’activité et les notifications du même département, mais pas dans ceux d’un autre département ; puis contrôler le récapitulatif **Tout le magasin** et chaque département. Les notifications sont tentées, jamais garanties.
4. Les objectifs du récapitulatif sont des sommes mensuelles réparties en entiers au prorata des vendeurs prévus chaque jour, y compris les fériés ; les semaines traversant deux mois additionnent les jours des deux mois. Les objectifs non renseignés ne contribuent pas aux sommes. Les agrégats des petits groupes peuvent permettre une déduction individuelle ; aucun document d’objectif personnel n’est directement exposé aux autres vendeurs.

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
4. En ligne, ajouter une cible dans **Mes objectifs**, puis utiliser **Aujourd’hui**, **Semaine** et **Mois** pour consulter une période à la fois. Toucher le nom d’un service ou son crayon pour modifier sa cible. Enregistrer une vente puis la corriger : les trois périodes concernées doivent se mettre à jour. Avec un second vendeur, vérifier qu'il ne voit pas les objectifs du premier. Dans **Administration → Objectifs**, choisir le magasin et le vendeur et modifier une cible ; vérifier sa mise à jour sur l'appareil du vendeur.
5. La modification est immédiate et durable pour la période courante et les suivantes ; le bouton de suppression retire les trois cibles du service. Si une autre personne modifie le même service au même moment, recharger les valeurs avant de recommencer. Hors ligne, la dernière vue peut rester visible, mais aucune vente ni modification d'objectif n'est enregistrée en attente. L'appareil peut garder des données en cache : se déconnecter et, si nécessaire, effacer les données du site sur un appareil partagé.

### Historique : migration des vendeurs par magasin

Pour une installation plus ancienne qui n'a pas encore été migrée, cette version rattache les vendeurs historiques à **Fnac Labège** (`osm-way-386504727`), avec les mêmes identifiants. Les autres magasins démarrent sans vendeurs ; les documents des ventes et les PIN ne sont ni supprimés ni modifiés. Un même prénom peut ensuite être ajouté dans plusieurs magasins, avec un PIN distinct.

1. Déployer d'abord le **nouveau Worker** sur Cloudflare, sans modifier les trois secrets existants. Le premier accès à `/api/bootstrap` effectue la migration du catalogue avec précondition de concurrence et crée une copie de son état précédent dans `pulseBackups/catalog-before-store-scoping-v1`. La sauvegarde et la migration du catalogue sont atomiques. Cette copie ne remplace **pas** une sauvegarde complète de Firestore.
2. Vérifier que `/api/bootstrap` répond et que les vendeurs historiques portent `storeId: osm-way-386504727`. Dans Firestore, vérifier que `pulse/catalog` contient `catalogVersion: 2` et `sellerStores` **avant** de modifier les règles : sinon les vendeurs risquent de perdre temporairement l'accès en lecture.
3. Publier l'interface GitHub Pages via le workflow manuel, puis remplacer les règles dans **Firebase → Firestore Database → Règles** par le contenu de [`firestore.rules`](firestore.rules) et appuyer sur **Publier**. Les nouvelles règles vérifient l'appartenance du vendeur à son magasin. Cette ancienne étape conservait les PIN de Labège ; la remise à zéro décrite plus haut les invalide désormais.
4. Fermer et rouvrir l'application sur chaque appareil pour charger la nouvelle version. Dans **Administration**, choisir le magasin avant d'y ajouter des vendeurs ou de réordonner les services. Chaque nouveau vendeur choisit son propre PIN directement sur son téléphone. Tester la vente, le classement, l'ordre et les notifications sur les appareils de l'équipe.

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

1. Pour gérer l'équipe, ouvrir **Administration**, se connecter avec le compte Firebase créé à l'étape 1 et choisir le magasin dans **Magasins**. Aucun réglage administrateur n'est nécessaire pour créer le premier PIN.
2. Chaque vendeur saisit son prénom et choisit lui-même son PIN secret de 4 chiffres, sans code d'activation, ou utilise son profil et son PIN existants. Toute personne pourrait initialiser un profil encore sans PIN : coordonner cette première connexion. Cinq échecs rapprochés entraînent un blocage temporaire ; l'administrateur peut réinitialiser un accès, pas lire son PIN.
3. Sur deux appareils, se connecter avec deux vendeurs du même magasin. Ajouter une vente sur l'un : vérifier sa présence dans le bilan et sur l'autre appareil. Vérifier une correction et le classement. Tester un second magasin pour vérifier l'isolation.
4. Sur chaque appareil, ouvrir la PWA et activer dès le démarrage les notifications et la géolocalisation à l’aide des deux boutons, puis accepter chaque demande du système. Si le profil n’est pas encore choisi, vérifier l’activation des notifications après connexion. Tester l'envoi avec l'application ouverte puis fermée ; sur iPhone/iPad, installer d'abord la PWA depuis Safari. Les navigateurs, les réglages système et les politiques d'économie d'énergie peuvent empêcher la réception.
5. Vérifier que la migration individuelle 8 → 4 conserve les sessions déjà ouvertes et les données, puis qu’une réinitialisation ciblée par l’administrateur révoque les sessions de ce vendeur. Vérifier également les permissions Firestore et la protection de l’accès administrateur.
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

Pour vérifier aussi la compatibilité de la lecture d’un compte invité avec le runtime Cloudflare réel, sans toucher aux comptes Firebase ni à la base :

```bash
npx --yes --package=node@22 --package=wrangler@4.119.0 -c 'FNAC_MINIFLARE_PATH="$(dirname "$(dirname "$(command -v wrangler)")")/miniflare" node qa/workerd-activation.mjs'
```

Le test utilise uniquement des identités fictives et intercepte toutes les requêtes sortantes. Il vérifie notamment que les redirections ne sont pas suivies. Le runtime Workers refuse `redirect: 'error'` ; la lecture Firebase utilise donc `manual` et rejette toute réponse non réussie.

## Références

- [Tarifs Firebase](https://firebase.google.com/pricing/) et [quotas Firestore](https://firebase.google.com/docs/firestore/quotas)
- [Limites Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/) et [tarifs Queues](https://developers.cloudflare.com/queues/platform/pricing/)
- [FCM sur le Web](https://firebase.google.com/docs/cloud-messaging/web/get-started)
- [GitHub Pages avec GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
