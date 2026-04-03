# Etapes de Job

Un step est l'endroit ou un job devient operationnel. Si un utilisateur demande comment creer un agent dans un workflow planifie, la bonne reponse est : creer d'abord le step, ajouter la camera comme target, puis configurer l'agent dans ce step.

## Quand utiliser un agent de step au lieu de AI Agents

- Utilisez un agent de step quand l'analyse doit suivre un planning.
- Utilisez un agent de step quand plusieurs cameras ou plusieurs etapes doivent travailler ensemble.
- Utilisez un agent de step quand une etape depend d'une autre etape, d'un timeout ou d'un output partage.
- Utilisez **AI Agents** lorsqu'une seule camera a seulement besoin d'un observateur continu hors workflow.

## Champs minimum obligatoires dans l'editeur d'agent du step

- **Name** : un nom clair pour l'agent du step.
- **Prompt core** : expliquez ce que l'agent du step doit reconnaitre et dans quelles circonstances.
- **Alert condition** : definissez la condition qui doit declencher l'alerte pour cette etape.

## Options avancees partagees avec les agents de camera

- **Targets** : le step doit deja contenir des cameras target, et l'agent peut utiliser une logique specifique par target.
- **Face targets** : des photos de visage peuvent guider la reconnaissance lorsqu'une personne specifique compte.
- **Negative condition** : definit ce qui ne doit pas declencher l'alerte.
- **Negative reference images** : donnent au modele des exemples visuels plus clairs de ce qu'il faut ignorer.
- **Model** : **Ultra** permet une latence plus faible et des alertes toutes les 10 secondes ; **Core** est plus lent et fixe a 60 secondes.
- **Video packaging** : **High resolution**, **Standard resolution** et **Compact resolution** echangent l'usage de tokens contre la qualite d'analyse.
- **Input type** : **Video** est meilleur pour les actions courtes et le mouvement ; **Image** est meilleur pour des snapshots periodiques.
- **Polygons** : des polygones nommes peuvent limiter l'inference au mouvement dans des regions specifiques.

## Flux typique

1. Ouvrez **Jobs**.
2. Creez ou modifiez le job.
3. Creez le **step**.
4. Ajoutez une ou plusieurs cameras comme targets dans le step.
5. Ouvrez l'editeur d'agent du step pour ce target ou cette etape.
6. Remplissez **Name**, **Prompt core** et **Alert condition**.
7. Configurez les guides visuels, le modele, la cadence, **Video packaging**, **Input type** et les polygons si besoin.
8. Enregistrez le step et activez le job.

## Regle pratique

- Utilisez un agent de step lorsque l'agent appartient a un planning, une sequence ou un workflow multi-camera.
- Utilisez un agent dans **AI Agents** lorsque la meme logique doit tourner en continu toute seule sur une seule camera.
