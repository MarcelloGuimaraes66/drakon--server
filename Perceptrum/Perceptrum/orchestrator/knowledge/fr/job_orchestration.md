# Orchestration de Jobs

Utilisez ce guide lorsque l'utilisateur ne demande pas seulement "comment creer un job ?", mais comment concevoir un workflow avec plusieurs steps, plusieurs cameras, du timing, de la validation et la reutilisation de reponses precedentes.

Ce sujet doit aider un autre chat a proposer plusieurs conceptions valides de job au lieu de tout reduire a un seul exemple de comptage.

## Ce que le produit peut faire

Les jobs du produit ne se limitent pas a une analyse isolee par camera.

Le produit peut :

- planifier des workflows recurrents ;
- diviser l'analyse en plusieurs steps ;
- attacher une ou plusieurs cameras a chaque step ;
- demarrer des steps par sequence, heure absolue, delai relatif ou resultat d'un step precedent ;
- injecter des reponses precedentes dans des steps suivants via pipeline ;
- consolider des preuves de plusieurs cameras dans un step validateur ;
- declencher des alertes seulement apres evaluation d'une regle metier finale.

## Regle maitresse pour repondre

Ne sautez pas directement vers une seule forme de workflow.

Quand quelqu'un demande de l'aide pour un job complexe :

1. identifiez l'objectif metier reel ;
2. decidez si le cas releve de `AI Agents` continus ou de `Jobs / Steps` planifies ;
3. choisissez la topologie du workflow ;
4. separez les steps collecteurs des steps de decision ;
5. definissez un contrat de reponse stable pour la reutilisation dans le pipeline ;
6. placez l'alerte finale sur le step qui porte la decision finale.

Quand plusieurs topologies sont valides, proposez des alternatives et expliquez le compromis entre simplicite, robustesse et cout.

## Composants qui forment l'orchestration

### Camera

Ressource enregistree puis reutilisee par les jobs. Un job consomme des cameras existantes au lieu d'en creer a la volee.

### Job

Conteneur du workflow planifie. Il definit le planning et la periode active.

Champs importants :

- `name`
- `description`
- `schedule_mode`
- `schedule_days`
- `active_from`
- `active_until`

### Step

Une etape logique a l'interieur du workflow.

Champs importants :

- `step_order`
- `name`
- `timeout_seconds`

Note importante du runtime :

- le timeout minimum effectif est `120` secondes.

### Target

La camera attachee a un step.

Ordre pratique :

1. creez le step ;
2. ajoutez la camera comme target ;
3. configurez l'agent de ce target.

### Agent

La configuration d'inference pour un target dans un step.

Champs importants :

- `agent_key`
- `prompt_template`
- `alert_condition`
- `negative_condition`
- `input_type`
- `video_packaging_mode`
- `inference_model`
- `run_every`
- `only_capture_on_motion`
- `use_temporal_context`
- `analysis_regions`

### Start Condition

Controle quand un step peut demarrer.

Modes importants dans le projet :

- `sequential`
- `time`
- `elapsed`
- `positive`
- `negative`
- `custom`

### Pipeline

Definit comment les reponses precedentes sont injectees dans les steps suivants.

Le pipeline est configure sur le step de destination, pas sur le step source.

### Alert

Regle de livraison de la decision finale. En general, l'alerte doit etre attachee au step qui porte la decision metier finale.

### Inference Groups

Utiles lorsque plusieurs targets du meme step partagent la meme regle et le meme timing, sans pipeline entre steps.

## Comment choisir la bonne topologie

Avant de remplir les formulaires, repondez a ces questions :

1. S'agit-il d'un monitoring continu sur une seule camera, ou d'un workflow planifie ?
2. Combien de points de preuve sont impliques ?
3. Toutes les cameras regardent-elles la meme fenetre temporelle ou des fenetres differentes ?
4. La reponse finale depend-elle d'une comparaison, d'une sequence ou d'une condition ?
5. Le resultat d'un step doit-il devenir l'entree d'un autre ?
6. L'alerte doit-elle partir au premier signal ou seulement apres consolidation finale ?

Si le cas correspond a un monitoring continu sur une seule camera, preferez `AI Agents`.

Si le cas exige coordination entre cameras, timing, validation ou reutilisation de reponse, preferez `Jobs / Steps`.

## Modeles recommandes

### Audit simple sur une seule camera

Utilisez-le quand :

- il n'y a qu'une camera ;
- le but est de tourner selon un planning ;
- il n'y a pas de dependance entre etapes.

Forme typique :

- un job ;
- un step ;
- un ou plusieurs targets dans ce meme step ;
- alerte sur ce meme step.

### Collecteurs paralleles plus validateur final

Utilisez-le lorsque plusieurs cameras observent la meme fenetre temporelle et que la reponse finale depend de la comparaison de leurs resultats.

Forme typique :

- step collecteur pour la camera A ;
- step collecteur pour la camera B ;
- step validateur final qui demarre apres la fenetre de collecte.

### Chaine sequentielle

Utilisez-la lorsqu'une etape ne doit tourner qu'apres une autre, ou lorsque le processus represente un trajet ou une sequence ordonnee.

### Investigation conditionnelle

Utilisez-la lorsqu'un step ulterieur ne doit s'executer que si un step precedent trouve un signal specifique.

### Consolidation de plusieurs vers un

Utilisez-la lorsque plusieurs steps alimentent des preuves vers un validateur final unique.

### Groupement multi-target dans le meme step

Utilisez un seul step avec plusieurs targets ou inference groups lorsque plusieurs cameras partagent la meme regle et le meme timing, sans besoin de pipeline entre steps.

## Guide Start Condition

Utilisation typique :

- `time` pour des collecteurs paralleles ou pour un validateur qui commence a `T + fenetre` ;
- `positive`, `negative` ou `custom` quand le step suivant depend d'une cle de reponse precedente ;
- `elapsed` pour une logique de delai relatif ;
- `sequential` quand l'ordre naturel suffit.

## Guide Pipeline

Chaque ligne de pipeline relie :

- le step source ;
- le target ou la cle source ;
- le target de destination.

Comportement important du runtime :

- le runtime injecte principalement le `answer` precedent ;
- les steps downstream doivent donc attendre des sorties upstream stables et faciles a parser ;
- la logique metier finale reste dans le prompt downstream.

## Regle de contrat de prompt

Les steps collecteurs doivent produire des sorties courtes et deterministes, par exemple :

```text
STEP_RESULT step_role=<collector> camera=<name> status=<fixed_value> value=<short_value> evidence=<short_text>
```

Les steps validateurs doivent partir de `PIPELINE_INPUTS` et renvoyer une decision finale, par exemple :

```text
VALIDATION_RESULT status=<OK_or_ALERT> reason=<short_text> action=<short_text>
```

Si un autre step doit reutiliser la sortie, evitez les reponses narratives longues et preferez une structure stable avec un vocabulaire controle.

## Contraintes reelles du projet

- le premier step commence en general avec le job ;
- le timeout minimum effectif du step est `120` secondes ;
- la creation de jobs dans l'UI repose sur un planning recurrent ;
- les alertes dependent de `alert_condition=true` dans la sortie d'inference ;
- `Ultra` est plus sur pour les workflows complexes et la faible latence ;
- `Core` est plus limite et plus lent.

## Carte des references du code

UI et formulaires :

- `DrakonSite/src/react-app/pages/Jobs.tsx`

Routes backend :

- `DrakonSite/src/worker/index.ts`

Scheduler et preparation du payload :

- `DrakonSite/src/worker/jobScheduler.ts`

Parsing du payload :

- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`

Comportement runtime :

- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

Routage du sujet dans le chat :

- `Perceptrum/Perceptrum/orchestrator/skills/ExplainAppSkill.cpp`
- `Perceptrum/Perceptrum/orchestrator/KnowledgeBase.cpp`

## Comment un autre chat doit repondre

Pour des demandes de workflows complexes, le chat doit :

1. proposer la bonne topologie avant de remplir les formulaires ;
2. offrir plusieurs alternatives lorsqu'il y a plus d'une conception viable ;
3. expliquer cameras, steps, start conditions, pipelines, validateurs et alertes comme une architecture reliee ;
4. eviter de reduire le produit a un seul exemple de comptage lorsque la demande est plus large.
