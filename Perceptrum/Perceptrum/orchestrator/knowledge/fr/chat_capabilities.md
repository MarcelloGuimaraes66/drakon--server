# Capacités du Chat

Le chat est l'endroit le plus rapide pour comprendre le produit, consulter l'état actuel du compte, rechercher dans la vidéo et lancer des actions guidées sans devoir naviguer entre plusieurs pages.

## À quoi sert le chat

- Expliquer comment le produit fonctionne, sur quelle page se trouve une fonctionnalité et quel flux il vaut mieux utiliser.
- Continuer un travail sur plusieurs échanges sans obliger l'utilisateur à recommencer depuis le début.
- Réunir l'aide produit, la lecture d'état en direct et les actions guidées dans un seul endroit.

## Chemins spécialisés de capacité

Derrière le comportement conversationnel, le chat route la demande vers des capacités spécialisées. L'utilisateur n'a pas besoin de mémoriser les noms internes, mais le comportement change réellement selon le type de demande.

- Aide produit et onboarding : expliquer pairing, API keys, billing, enregistrement des caméras, AI Agents, Jobs, Steps, orchestration, vue d'ensemble de l'application et le chat lui-même.
- Lecture de l'état actuel : lister les caméras, jobs, agents, soldes, configurations, exécutions récentes, historique opérationnel et identity cards persistées lorsque ces données existent.
- Inspection vidéo et image : rechercher sur une ou plusieurs caméras, analyser une image ou une vidéo envoyée et répondre sur les enregistrements, événements ou détections via la pipeline existante de recherche vidéo.
- Découverte sur le réseau local : lancer Scan Network depuis le chat pour trouver des caméras, DVRs et NVRs, puis résumer le résultat.
- Opérations sur les caméras : enregistrer une caméra, préparer un enregistrement en lot, modifier une caméra, appliquer la même modification à plusieurs caméras et démarrer ou arrêter le runtime d'une caméra existante.
- Opérations sur les jobs : créer des jobs planifiés et des workflows à plusieurs steps, modifier un job existant et démarrer, arrêter, mettre en pause ou reprendre le runtime d'un job.
- Opérations sur les agents : créer ou modifier des agents sur une caméra ou à l'intérieur d'un step de job, y compris la destination, la cadence, les changements de prompt, l'activation ou la désactivation, les negative conditions et les flux avec région visuelle quand c'est nécessaire.
- Rapports : générer des documents téléchargeables sur l'état actuel, l'historique, les détections, les alertes, les jobs, les agents, les logs, les comparaisons et le contexte pertinent du chat.
- Réponse directe : lorsqu'aucune capacité spécialisée n'est meilleure, le chat peut toujours répondre normalement.

## Comment le chat gère le travail sur plusieurs échanges

- Il peut garder une tâche active sur plusieurs messages au lieu de traiter chaque message comme une nouvelle demande.
- Il demande les champs manquants quand la demande est actionnable mais encore incomplète.
- Il préfère confirmer plutôt que deviner quand la cible est ambiguë.
- Il comprend des suites comme `utilise la meme chose pour les 5`, `cette camera`, `la meme adresse` ou `fais maintenant la version du step`.
- Pour le travail en lot sur les caméras, il peut continuer à collecter des lignes, des valeurs partagées et des règles d'édition au fil de la conversation.

## Mémoire et cohérence

- Le chat utilise deux formes principales de mémoire conversationnelle :
  1. des turns récents pour la continuité immédiate.
  2. un contexte compact pour l'information plus ancienne et durable.
- La mémoire compacte conserve des faits durables comme le résumé, les objectifs utilisateur, les contraintes, les préférences, les entités sélectionnées, les décisions et les points ouverts.
- Elle conserve aussi une mémoire de tâche pour l'opération en cours, y compris la tâche active, la phase, l'objectif, les champs collectés, les champs manquants et les tâches récentes terminées.
- Elle garde également des entités de session importantes, comme le dernier nom ou id pertinent, afin d'aider pour les follow-ups courts.
- Quand la conversation devient trop longue, les anciens messages sont compactés et seuls les turns les plus récents restent littéraux.
- Si le message actuel change clairement de sujet, le message actuel l'emporte sur le contexte plus ancien.
- La mémoire compacte ne doit pas stocker de secrets comme des mots de passe, API keys, tokens, RTSP URLs ou autres identifiants privés.

## Comportement linguistique

- Le chat est structuré pour les langues d'UI prises en charge : English, Portuguese, Spanish, French, Chinese et Arabic.
- Il essaie de répondre dans la langue de l'utilisateur.
- Si la langue de l'utilisateur n'est pas prise en charge, il bascule vers English au lieu de deviner une langue proche.
- Le knowledge peut retomber en interne sur English, mais la réponse finale peut quand même être réécrite dans la langue de réponse de l'utilisateur.

## Garde-fous et limites importantes

- Le chat ne doit pas inventer un état en direct. Si la réponse dépend d'une inspection, il doit d'abord consulter l'état réel.
- Le chat ne doit pas inventer des identifiants, IP, ports, noms d'utilisateur, mots de passe ou adresses de caméra que l'utilisateur n'a pas fournis.
- Certaines actions dépendent du runtime local connecté, d'une session de chat valide, de données présentes dans le compte et des permissions actives du produit.
- Les explications produit doivent s'appuyer sur les documents locaux de knowledge lorsque c'est la voie la plus sûre.
- Les réponses finales sont polies pour rester concises, centrées sur le produit et sans détails d'implémentation.

## Bons exemples de question

- `que peut faire le chat ?`
- `de quoi es-tu capable ici ?`
- `liste les types de choses que le chat peut faire pour moi`
- `peux-tu inspecter mes cameras et mes jobs depuis ici ?`
- `peux-tu creer ou modifier des cameras, des agents et des jobs ?`
- `comment gardes-tu le contexte entre les messages ?`
- `quelles sont tes limites ?`

## Règle pratique

- Utilisez le chat quand l'utilisateur veut l'une de ces trois choses :
  1. une explication fiable du produit.
  2. une lecture ou une recherche sur l'état actuel, l'historique ou la vidéo.
  3. une action guidée qui peut continuer sur plusieurs messages jusqu'à confirmation ou achèvement.
