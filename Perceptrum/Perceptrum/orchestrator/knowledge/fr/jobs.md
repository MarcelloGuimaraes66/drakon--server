# Jobs

Utilisez **Jobs** lorsque vous avez besoin d'un workflow planifie ou repetable au lieu d'une simple demande ponctuelle dans le chat.

## Qu'est-ce qu'un job

Un job est le conteneur principal du workflow. Il definit quand le flux doit s'executer, pendant combien de temps le planning reste actif et comment le travail est divise en steps.

Un job ne realise pas a lui seul l'analyse detaillee des cameras. Dans le modele actuel du produit, l'execution reelle se fait dans les steps. Les cameras sont ajoutees aux steps comme targets, et la logique de l'agent est configuree dans le contexte de chaque step.

## A quoi servent les jobs

- Revues nocturnes ou horaires de zones selectionnees.
- Controles de securite repetitifs qui doivent s'executer automatiquement.
- Workflows avec plusieurs cameras et plusieurs etapes.
- Automatisations structurees qui ne dependent pas d'une personne qui ecrit dans le chat.
- Flux supervises de reception, transfert, stockage, production et expedition.
- Verification qu'un objet, un vehicule ou une equipe est passe par les etapes attendues dans le bon ordre.
- Workflows de controle operationnel comme la conformite d'itineraire, la confirmation de livraison, le controle des files, la validation de destination, le temps d'execution et la revue des exceptions.
- Cas ou le resultat important n'est pas seulement la detection, mais aussi la confirmation de sequence, de destination, de retard ou d'echec de handoff.

## Parties principales d'un job

- **Name** : identifie clairement le workflow.
- **Description** : explique l'objectif operationnel ou metier.
- **Schedule** : controle quand le workflow s'execute. Dans le flux actuel du produit, les jobs recurrents utilisent des modes comme `weekly`, `monthly` ou `yearly`, avec des fenetres horaires.
- **Active range** : controle a partir de quelle date le planning recurrent est valable et jusqu'a quand il reste actif.
- **Steps** : definissent les vraies etapes de travail a l'interieur du job.
- **Step targets** : definissent quelles cameras ou quelles sources sont inspectees dans chaque step.
- **Step agents and alerts** : definissent comment chaque step analyse la preuve et ce qui doit se passer lorsqu'une condition est remplie.

## Flux typique

1. Ouvrez **Jobs**.
2. Creez un nouveau job.
3. Donnez-lui un nom clair et, si besoin, une courte description.
4. Configurez le schedule mode, les jours, les fenetres horaires et la plage active.
5. Creez un ou plusieurs steps.
6. Pour chaque step, definissez l'ordre et le timeout.
7. Pour chaque step, ajoutez les cameras target.
8. Pour chaque step ou target, attachez l'agent ou le comportement de prompt approprie.
9. Si besoin, ajoutez des start conditions, des pipeline inputs, une logique groupee multi-camera ou des alerts.
10. Enregistrez et activez le job.

## Exemples pratiques

Exemple 1 : revue nocturne du perimetre.

- Nom du job : `Revue nocturne du perimetre`
- Planning : tous les jours a 23h00, dans les fenetres recurrentes configurees
- Steps : revue de l'entree du perimetre, balayage du parking, revue de l'acces arriere
- Objectif : verifier la presence de personnes ou de vehicules hors horaires et ne declencher une alerte que lorsque la condition configuree est satisfaite

Exemple 2 : controle horaire de la reception.

- Nom du job : `Controle d'occupation de la reception`
- Planning : toutes les heures pendant les fenetres de supervision metier
- Steps : revue d'occupation, revue de gravite de file, suivi d'acces bloque
- Objectif : identifier les files, la saturation ou un acces bloque et produire une preuve operationnelle repetable

Exemple 3 : verification supervisee d'un trajet de charge.

- Nom du job : `Verification de la reception jusqu'a la destination`
- Planning : a chaque debut de fenetre de reception, ou a intervalles fixes de supervision
- Steps : confirmation de reception, revue du trajet de transfert, confirmation de destination, revue des exceptions
- Targets : `Quai de Reception`, `Couloir Interne`, `Zone de Stockage B`
- Objectif : confirmer qu'une charge recue a ete dechargee, a suivi le trajet attendu et est arrivee a la bonne destination

Exemple 4 : supervision d'un handoff operationnel.

- Nom du job : `Revue de passage de quart`
- Planning : a la fin de chaque quart
- Steps : cloture de l'equipe sortante, revue de la zone de handoff, prise en charge de l'equipe entrante, revue des exceptions
- Targets : `Entree de Production`, `Zone d'Emballage`, `Zone d'Expedition`
- Objectif : verifier si les etapes attendues du passage de quart ont ete completees dans l'ordre et si un retard, un mauvais routage ou un materiel sans suivi doit etre revise

## Quand choisir un job au lieu d'un camera agent

Choisissez un job lorsque :

- vous avez besoin d'un planning strict
- vous voulez plusieurs steps
- vous avez besoin de logiques differentes sur plusieurs cameras
- vous voulez un workflow structure plutot qu'un observateur continu
- vous avez besoin d'ordre, de temps, de dependances ou de validation de destination
- vous voulez superviser un processus operationnel ou metier, et pas seulement detecter un evenement isole
- vous voulez confirmer que quelque chose a commence a un point et s'est termine a la bonne destination
- vous avez besoin d'une preuve visuelle pour la conformite, la qualite d'execution ou le traitement d'exceptions dans un workflow repetable
- vous voulez qu'une etape depende d'une autre, par sequence, start condition ou resultat partage
