# Creation de Camera

Les utilisateurs peuvent enregistrer des cameras depuis **Cameras** ou depuis **AI Agents**.

Pour les explications et pour le tutoriel guide, utilisez **Cameras** comme page d'exemple principale, mais precisez que les memes options de decouverte, d'import et d'enregistrement manuel existent aussi dans **AI Agents**.

## Ou les cameras peuvent etre enregistrees

- **Cameras**
- **AI Agents**

Les deux pages exposent les memes trois points d'entree :

1. **Scan Network**
2. **Import Cameras**
3. **Register Camera** manuellement

## Moyens les plus rapides d'ajouter des cameras

### Scan Network

- **Scan Network** recherche les cameras et les equipements **NVR/DVR** sur le reseau local.
- C'est generalement l'option la plus simple lorsque les appareils sont deja accessibles sur le meme reseau.
- Si l'utilisateur demande le chemin le plus facile, recommandez celui-ci en premier.

### Import Cameras

- **Import Cameras** accepte **Excel**, **CSV**, **JSON**, **TSV** et **plain text**.
- L'IA locale lit les colonnes ou les champs libres et enregistre les cameras automatiquement.
- Recommandez cette option lorsque l'utilisateur dispose deja d'un inventaire exporte, d'un tableur, d'un transfert d'installateur ou d'une liste de cameras venant d'un autre systeme.

## Enregistrement manuel d'une camera

Si l'utilisateur veut un controle complet, il peut cliquer sur le bouton d'enregistrement manuel dans **Cameras** ou dans **AI Agents**.

Le formulaire manuel permet de choisir entre :

1. **IP / RTSP camera**
2. **Webcam**

## Flux de camera IP / RTSP

Utilisez ce flux pour des cameras comme **Hikvision**, **Dahua** et **Intelbras**.

Le formulaire couvre :

- **Camera name**
- **IP address**
- **RTSP port**
- **Manufacturer**
- **Connection method** comme RTSP, HTTP ou ONVIF
- **Username**
- **Password**
- **Channel**
- **Subtype**

Remarques importantes par fabricant :

- Pour **Hikvision**, changez **Channel** pour atteindre d'autres canaux.
- Pour **Intelbras**, utilisez **Subtype** pour atteindre d'autres canaux.

## Section adresse

Apres les champs de connexion, le formulaire continue avec l'adresse de la camera.

- Le flux d'adresse commence par **ZIP code / CEP**.
- Apres la saisie du CEP, l'application peut remplir automatiquement **street**, **city** et **state**.
- Le champ qui demande le plus souvent une confirmation manuelle reste le **street number**.

## Retention

- **Retention** definit combien de temps les frames generees par cette camera restent stockees sur disque.
- Cela determine la quantite d'historique disponible pour les revisions et les recherches ulterieures.

## Partage avec des collaborateurs

- **Partage avec des collaborateurs** permet de partager la camera avec des utilisateurs Perceptrum precis invites par `@handle` ou e-mail afin qu ils puissent utiliser la camera dans Drakon Find.
- Expliquez cela comme un partage intentionnel avec des collaborateurs, pas comme une exposition publique.

## Flux webcam

**Webcam** est le chemin manuel le plus simple.

La webcam utilise quand meme les champs operationnels partages :

- **Camera name**
- **Address**
- **Retention**
- **Partage avec des collaborateurs**

Le principal champ specifique a la webcam est :

- **Webcam index**, qui vaut generalement `0`

Contrairement aux cameras IP / RTSP, les webcams n'ont pas besoin de :

- IP address
- port
- manufacturer
- username
- password
- channel
- subtype

## Ce que partagent les deux flux manuels

Les flux **IP / RTSP** et **Webcam** partagent :

- camera name
- address
- retention
- partage avec des collaborateurs

La difference est que **IP / RTSP** a besoin des champs de transport et du fournisseur, alors que **Webcam** n'a generalement besoin que de l'index de webcam.

## Comportement du tutoriel guide pour l'enregistrement d'une camera

Quand l'utilisateur pose une question sur l'etape camera du tutoriel guide :

- Expliquez-la en utilisant la page **Cameras** comme exemple visuel.
- Mentionnez aussi que les memes actions existent dans **AI Agents**.
- Le tutoriel commence par mettre en avant les raccourcis du haut :
  - **Scan Network**
  - **Import Cameras**
  - **Register Camera**
- Ensuite il ouvre le formulaire manuel et explique clairement l'onglet **IP / RTSP** :
  - camera name
  - IP address
  - port
  - manufacturer
  - username
  - password
  - channel
  - subtype
  - address
  - retention
  - partage avec des collaborateurs
- Apres l'explication RTSP/IP, le tutoriel bascule automatiquement vers **Webcam**.
- Dans ce flux d'exemple, le tutoriel remplit :
  - webcam index `0`
  - camera name `tutorial webcam`
- Ensuite il enregistre cet exemple de webcam et passe a l'etape suivante du tutoriel.

## Recommandation pratique

Recommandez les chemins dans cet ordre :

1. **Scan Network** lorsque les appareils sont deja sur le reseau
2. **Import Cameras** lorsque l'utilisateur a deja un fichier
3. **Manual registration** lorsque l'utilisateur veut un controle champ par champ
