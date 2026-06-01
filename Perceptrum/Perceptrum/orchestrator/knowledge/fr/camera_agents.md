# Agents de Camera

Quand un utilisateur demande comment creer un agent, la bonne reponse depend du workflow recherche. Aujourd'hui, il existe deux endroits ou la logique de l'agent peut vivre.

## Les deux endroits ou un agent peut etre cree

1. **AI Agents** : l'agent s'execute directement sur une camera. C'est le bon endroit pour une surveillance continue par camera, sans schedules ni orchestration d'output entre cameras.
2. **Jobs / Steps** : l'agent s'execute dans un step apres qu'une camera a ete ajoutee comme target. C'est le bon endroit lorsque l'agent doit faire partie d'un schedule, d'un workflow multi-etapes ou d'une chaine d'output entre cameras.

## Lequel choisir

- Utilisez **AI Agents** lorsqu'une camera doit surveiller en continu.
- Utilisez **Jobs / Steps** lorsque vous avez besoin de schedules, de dependances, de plusieurs cameras ou d'une coordination d'output entre etapes.
- Dans les deux cas, l'idee de base est la meme : definir ce que l'agent doit reconnaitre, quand il doit alerter et ce qu'il doit ignorer.

## Champs minimum obligatoires

- **Name** : un nom clair pour l'agent.
- **Prompt core** : expliquez ce que l'agent doit reconnaitre et dans quelles circonstances.
- **Alert condition** : definissez la condition exacte qui doit declencher une alerte.

## Guidage et filtres optionnels

- **Targets** : vous pouvez definir des targets specifiques pour l'analyse.
- **Face targets** : vous pouvez ajouter des photos de visage lorsque le scenario depend de la reconnaissance d'une personne precise.
- **Negative condition** : decrit ce qui ne doit pas declencher d'alerte.
- **Negative reference images** : ajoute des references negatives quand le modele a besoin d'exemples plus clairs de ce qu'il doit ignorer.

## Enhance Prompt with AI

- Dans l'editeur d'agent de camera, il existe un bouton appele **Enhance Prompt with AI**.
- Il analyse le prompt actuel de l'utilisateur avec la preview la plus recente ou le snapshot diffuse depuis cette camera.
- L'objectif est de construire une suggestion de prompt plus complete et detaillee, qui renforce mieux l'intention de l'utilisateur et reduit les faux positifs.
- Le bouton ameliore la suggestion de texte, mais l'utilisateur doit quand meme verifier le resultat avant de l'appliquer.

## Modele et cadence d'alerte

- **Ultra** : latence plus faible et possibilite d'emettre des alertes toutes les 10 secondes.
- **Core** : niveau gratuit, latence plus elevee et cadence fixe de 60 secondes.
- Choisissez **Ultra** quand le cas d'usage exige une reaction plus rapide.
- Choisissez **Core** quand une cadence de 60 secondes est acceptable et que le cout plus faible compte davantage.

## Video packaging

- **High resolution** : envoie les frames a leur taille d'origine.
- **Standard resolution** : envoie l'image environ 4x plus petite.
- **Compact resolution** : envoie l'image environ 6x plus petite.
- Les resolutions plus petites reduisent l'usage des input tokens, mais peuvent aussi reduire la qualite de l'analyse.
- Les petits objets analyses en **Compact resolution** peuvent provoquer plus de faux positifs ou de faux negatifs.

## Input type

- **Video** : envoie une sequence de frames. Utilisez-le lorsque le modele doit comprendre des actions courtes, des mouvements rapides ou un bref contexte temporel.
- **Image** : envoie des snapshots. Avec une cadence de 10 secondes, il envoie un snapshot toutes les 10 secondes ; avec 60 secondes, un snapshot toutes les 60 secondes.
- **Image + 10s** est souvent un bon choix lorsque l'analyse temporelle courte n'est pas necessaire, car cela coute generalement moins de tokens que la video tout en gardant une bonne couverture.
- Regle pratique : utilisez **Video** pour les mouvements courts et les actions rapides ; utilisez **Image** lorsque des snapshots periodiques suffisent.

## Polygones et regions declenchees par le mouvement

- Dans le coin superieur gauche de l'editeur, l'utilisateur peut creer des polygones nommes.
- Le programme n'envoie une inference que lorsqu'un mouvement se produit a l'interieur d'un de ces polygones.
- Cela permet d'analyser uniquement des quadrants ou des regions specifiques de la scene au lieu du frame complet en permanence.

## Flux typique dans AI Agents

1. Ouvrez **AI Agents**.
2. Choisissez la camera.
3. Ouvrez la page **Configure AI Agents / Algorithms** de cette camera.
4. Cliquez sur **Create Custom AI Agent**.
5. Renseignez **Name**, **Prompt core** et **Alert condition**.
6. Si besoin, ajoutez des targets, des photos de visage, des conditions negatives et des images de reference negatives.
7. Choisissez le modele, la cadence, l'input type et le mode de **Video packaging**.
8. Creez des polygones si l'analyse doit surveiller uniquement certaines regions.
9. Enregistrez puis activez l'agent.

## Flux typique dans Jobs / Steps

1. Ouvrez **Jobs**.
2. Creez ou modifiez le job.
3. Creez un **step**.
4. Ajoutez la camera comme target dans ce step.
5. Ouvrez l'editeur d'agent du step.
6. Configurez **Name**, **Prompt core**, **Alert condition** et les memes options visuelles et d'execution que celles des agents de camera.
7. Utilisez ce chemin lorsque l'agent appartient a un schedule ou a un workflow qui coordonne plusieurs cameras ou plusieurs etapes.

## Note sur l'Etape 3 du tutoriel

- Le tutoriel guide utilise le chemin continu par camera de **AI Agents**.
- L'Etape 2 cree la camera du tutoriel depuis la page **Cameras**, mais les memes points d'entree d'enregistrement existent aussi dans **AI Agents**.
- Une fois la camera du tutoriel creee, l'Etape 3 ouvre la page **Algorithms** de cette camera et y cree un custom AI agent.
- L'agent d'exemple s'appelle **thumbs up detector**. Dans la copy de l'interface portugaise, le meme exemple apparait comme **detector de afirmativo**.
- Le preset du tutoriel utilise :
  - **Prompt core** : reconnaitre toute personne faisant un geste de pouce leve ou un geste affirmatif avec la main.
  - **Alert condition** : alerter si une personne fait un geste de pouce leve ou un geste affirmatif avec la main.
- Si **OpenAI** est disponible, le tutoriel prefere **Ultra**, **Video**, **High resolution**, **10-second cadence** et **1 FPS**.
- Si seul **Z.ai** est configure, le tutoriel utilise **Core**. **High resolution** reste selectionne, mais l'application conserve la **60-second cadence** fixe de Core.
- Le tutoriel explique d'abord le selecteur de **model**, puis juste apres le selecteur de **input type** comme deux etapes mises en avant separees.
- Apres avoir enregistre l'agent, le tutoriel revient sur la page **Algorithms** de la camera pour expliquer le toggle qui permet d'activer ou de mettre en pause cet agent sur cette camera.
- La derniere action guidee revient dans **AI Agents** et demarre le service de la camera du tutoriel afin que l'utilisateur puisse tester immediatement le detecteur de geste affirmatif.

## Regle pratique

- Choisissez **AI Agents** pour une surveillance continue et directe sur une seule camera.
- Choisissez **Jobs / Steps** lorsque l'agent doit etre planifie ou integre avec d'autres cameras, steps ou outputs.
