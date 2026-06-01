export const tutorialChatStepTranslations: Record<string, Record<string, string>> = {
  en: {
    "tutorial.entry.menu.chat.label": "Tutorial chat",
    "tutorial.entry.menu.chat.description":
      "Learn how chat can answer questions, control the app, and operate on cameras and agents.",
    "tutorial.chatOffer.title": "Continue with the chat tutorial?",
    "tutorial.chatOffer.description":
      "Chat is where you can understand the whole app, ask for explanations, and request creation or edits without memorizing every screen.",
    "tutorial.chatOffer.bullet1":
      "Use it to create or edit agents, cameras, and refined parameters from one place.",
    "tutorial.chatOffer.bullet2":
      "It can also analyze live cameras, review recorded video, scan the network, and answer operational questions.",
    "tutorial.chatOffer.primary": "Continue to chat",
    "tutorial.chatIntro.title": "Stage 4: Control the app from chat",
    "tutorial.chatIntro.description":
      "This workspace is the operational assistant for the whole product. It can explain features, suggest actions, create or edit resources, and help investigate live or recorded video.",
    "tutorial.chatIntro.bullet1": "Ask what something means before changing it.",
    "tutorial.chatIntro.bullet2": "Request concrete actions like creating cameras, jobs, or agents.",
    "tutorial.chatIntro.bullet3":
      "Use the same chat to inspect live cameras, uploaded recordings, and advanced settings.",
    "tutorial.chatIntro.primary": "Show the first prompt",
    "tutorial.chatCompose.title": "Ask about the tutorial camera first",
    "tutorial.chatCompose.descriptionWithCamera":
      "The first prompt checks whether the tutorial camera \"{{cameraName}}\" exists and whether it is active right now. Insert that prompt in the highlighted composer, then send it.",
    "tutorial.chatCompose.descriptionWithoutCamera":
      "The first prompt checks whether the tutorial camera exists and whether it is active right now. Insert that prompt in the highlighted composer, then send it.",
    "tutorial.chatCompose.bullet1":
      "After the assistant replies, we will use that answer to decide which examples to try next.",
    "tutorial.chatCompose.bullet2":
      "You can edit the prompt before sending it, but the suggested version already covers the intended first check.",
    "tutorial.chatCompose.primary": "Insert first prompt",
    "tutorial.chatExamples.title": "What to ask next",
    "tutorial.chatExamples.description":
      "Once chat answers the first check, continue on the same thread with the examples that match the situation.",
    "tutorial.chatExamples.activeBullet": "If the camera is active, try: {{prompt}}",
    "tutorial.chatExamples.recoveryBullet":
      "If the camera is offline or missing, try: {{prompt}}",
    "tutorial.chatExamples.generalBullet":
      "You can also ask chat to scan the network, create or edit cameras and agents, or explain any advanced parameter.",
    "tutorial.chatExamples.primary": "Continue",
    "tutorial.complete.chat.title": "Chat tutorial completed",
    "tutorial.complete.chat.description":
      "You now have a first operational path through chat, starting from the tutorial camera and branching into broader app control.",
    "tutorial.complete.chat.bullet1":
      "Reopen this tutorial anytime from the top bar if you want the same guided entry point again.",
    "tutorial.complete.chat.bullet2":
      "From here, you can keep using chat to manage cameras, agents, jobs, recordings, and app questions.",
    "tutorial.chat.prompt.named":
      "Does the camera \"{{cameraName}}\" exist? If it does, is it active right now?",
    "tutorial.chat.prompt.generic":
      "Is there a tutorial camera configured? If there is, is it active right now?",
    "tutorial.chat.prompt.activeFollowUp.named":
      "What is the camera \"{{cameraName}}\" seeing right now, and which analytics are running on it?",
    "tutorial.chat.prompt.activeFollowUp.generic":
      "If the tutorial camera is active, what is it seeing right now and which analytics are running on it?",
    "tutorial.chat.prompt.recovery.named":
      "If the camera \"{{cameraName}}\" is offline or missing, help me fix it or suggest the next best camera setup step.",
    "tutorial.chat.prompt.recovery.generic":
      "If the tutorial camera is offline or missing, help me fix it or suggest the next best camera setup step.",
  },
  es: {
    "tutorial.entry.menu.chat.label": "Tutorial chat",
    "tutorial.entry.menu.chat.description":
      "Aprende como el chat puede responder dudas, controlar la app y operar sobre camaras y agentes.",
    "tutorial.chatOffer.title": "Quieres seguir con el tutorial de chat?",
    "tutorial.chatOffer.description":
      "El chat es el lugar para entender toda la app, pedir explicaciones y solicitar creacion o edicion sin memorizar cada pantalla.",
    "tutorial.chatOffer.bullet1":
      "Usalo para crear o editar agentes, camaras y parametros refinados desde un solo lugar.",
    "tutorial.chatOffer.bullet2":
      "Tambien puede analizar camaras en vivo, revisar video grabado, escanear la red y responder dudas operativas.",
    "tutorial.chatOffer.primary": "Continuar al chat",
    "tutorial.chatIntro.title": "Etapa 4: Controlar la app desde chat",
    "tutorial.chatIntro.description":
      "Este espacio es el asistente operativo de todo el producto. Puede explicar funciones, sugerir acciones, crear o editar recursos y ayudar a investigar video en vivo o grabado.",
    "tutorial.chatIntro.bullet1": "Pregunta que significa algo antes de cambiarlo.",
    "tutorial.chatIntro.bullet2": "Pide acciones concretas como crear camaras, jobs o agentes.",
    "tutorial.chatIntro.bullet3":
      "Usa el mismo chat para inspeccionar camaras en vivo, grabaciones subidas y parametros avanzados.",
    "tutorial.chatIntro.primary": "Mostrar el primer prompt",
    "tutorial.chatCompose.title": "Primero pregunta por la camara del tutorial",
    "tutorial.chatCompose.descriptionWithCamera":
      "El primer prompt verifica si la camara del tutorial \"{{cameraName}}\" existe y si esta activa ahora. Inserta ese prompt en el composer resaltado y luego envialo.",
    "tutorial.chatCompose.descriptionWithoutCamera":
      "El primer prompt verifica si la camara del tutorial existe y si esta activa ahora. Inserta ese prompt en el composer resaltado y luego envialo.",
    "tutorial.chatCompose.bullet1":
      "Despues de la respuesta usaremos ese resultado para elegir los siguientes ejemplos.",
    "tutorial.chatCompose.bullet2":
      "Puedes editar el prompt antes de enviarlo, pero la version sugerida ya cubre la verificacion inicial.",
    "tutorial.chatCompose.primary": "Insertar primer prompt",
    "tutorial.chatExamples.title": "Que preguntar despues",
    "tutorial.chatExamples.description":
      "Cuando el chat responda la primera verificacion, sigue en la misma conversacion con los ejemplos que mejor encajen.",
    "tutorial.chatExamples.activeBullet": "Si la camara esta activa, prueba con: {{prompt}}",
    "tutorial.chatExamples.recoveryBullet":
      "Si la camara esta offline o no existe, prueba con: {{prompt}}",
    "tutorial.chatExamples.generalBullet":
      "Tambien puedes pedir que escanee la red, cree o edite camaras y agentes, o explique cualquier parametro avanzado.",
    "tutorial.chatExamples.primary": "Continuar",
    "tutorial.complete.chat.title": "Tutorial de chat completado",
    "tutorial.complete.chat.description":
      "Ya tienes un primer recorrido operativo por chat, empezando por la camara del tutorial y siguiendo hacia un control mas amplio de la app.",
    "tutorial.complete.chat.bullet1":
      "Vuelve a abrir este tutorial cuando quieras desde la barra superior.",
    "tutorial.complete.chat.bullet2":
      "Desde aqui puedes seguir usando el chat para gestionar camaras, agentes, jobs, grabaciones y dudas sobre la app.",
    "tutorial.chat.prompt.named":
      "La camara \"{{cameraName}}\" existe? Si existe, esta activa ahora?",
    "tutorial.chat.prompt.generic":
      "Hay una camara del tutorial configurada? Si la hay, esta activa ahora?",
    "tutorial.chat.prompt.activeFollowUp.named":
      "Que esta viendo ahora la camara \"{{cameraName}}\" y que analiticos estan corriendo en ella?",
    "tutorial.chat.prompt.activeFollowUp.generic":
      "Si la camara del tutorial esta activa, que esta viendo ahora y que analiticos estan corriendo en ella?",
    "tutorial.chat.prompt.recovery.named":
      "Si la camara \"{{cameraName}}\" esta offline o no existe, ayudame a corregirlo o sugiere el siguiente mejor paso de configuracion.",
    "tutorial.chat.prompt.recovery.generic":
      "Si la camara del tutorial esta offline o no existe, ayudame a corregirlo o sugiere el siguiente mejor paso de configuracion.",
  },
  pt: {
    "tutorial.entry.menu.chat.label": "Tutorial chat",
    "tutorial.entry.menu.chat.description":
      "Aprenda como o chat pode responder duvidas, controlar o app e operar cameras e agentes.",
    "tutorial.chatOffer.title": "Quer seguir com o tutorial do chat?",
    "tutorial.chatOffer.description":
      "O chat e o lugar para entender todo o aplicativo, pedir explicacoes e solicitar criacao ou edicao sem precisar decorar cada tela.",
    "tutorial.chatOffer.bullet1":
      "Use-o para criar ou editar agentes, cameras e parametros refinados a partir de um so lugar.",
    "tutorial.chatOffer.bullet2":
      "Ele tambem pode analisar cameras ao vivo, revisar video gravado, escanear a rede e responder duvidas operacionais.",
    "tutorial.chatOffer.primary": "Continuar para o chat",
    "tutorial.chatIntro.title": "Etapa 4: Controlar o app pelo chat",
    "tutorial.chatIntro.description":
      "Este espaco e o assistente operacional de todo o produto. Ele pode explicar funcoes, sugerir acoes, criar ou editar recursos e ajudar a investigar video ao vivo ou gravado.",
    "tutorial.chatIntro.bullet1": "Pergunte o que algo significa antes de mudar.",
    "tutorial.chatIntro.bullet2": "Peca acoes concretas como criar cameras, tarefas ou agentes.",
    "tutorial.chatIntro.bullet3":
      "Use o mesmo chat para inspecionar cameras ao vivo, gravacoes enviadas e parametros avancados.",
    "tutorial.chatIntro.primary": "Mostrar o primeiro prompt",
    "tutorial.chatCompose.title": "Comece perguntando sobre a camera do tutorial",
    "tutorial.chatCompose.descriptionWithCamera":
      "O primeiro prompt verifica se a camera do tutorial \"{{cameraName}}\" existe e se ela esta ativa agora. Insira esse prompt no composer destacado e depois envie.",
    "tutorial.chatCompose.descriptionWithoutCamera":
      "O primeiro prompt verifica se a camera do tutorial existe e se ela esta ativa agora. Insira esse prompt no composer destacado e depois envie.",
    "tutorial.chatCompose.bullet1":
      "Depois da resposta vamos usar esse retorno para escolher os proximos exemplos.",
    "tutorial.chatCompose.bullet2":
      "Voce pode editar o prompt antes de enviar, mas a versao sugerida ja cobre a verificacao inicial.",
    "tutorial.chatCompose.primary": "Inserir primeiro prompt",
    "tutorial.chatExamples.title": "O que perguntar em seguida",
    "tutorial.chatExamples.description":
      "Quando o chat responder a primeira verificacao, continue na mesma conversa com os exemplos que melhor combinarem com a situacao.",
    "tutorial.chatExamples.activeBullet": "Se a camera estiver ativa, tente: {{prompt}}",
    "tutorial.chatExamples.recoveryBullet":
      "Se a camera estiver offline ou nao existir, tente: {{prompt}}",
    "tutorial.chatExamples.generalBullet":
      "Voce tambem pode pedir para escanear a rede, criar ou editar cameras e agentes, ou explicar qualquer parametro avancado.",
    "tutorial.chatExamples.primary": "Continuar",
    "tutorial.complete.chat.title": "Tutorial do chat concluido",
    "tutorial.complete.chat.description":
      "Voce agora tem um primeiro caminho operacional pelo chat, comecando pela camera do tutorial e abrindo espaco para um controle mais amplo do app.",
    "tutorial.complete.chat.bullet1":
      "Reabra este tutorial a qualquer momento pela barra superior se quiser repetir essa entrada guiada.",
    "tutorial.complete.chat.bullet2":
      "Daqui em diante, voce pode continuar usando o chat para gerenciar cameras, agentes, tarefas, gravacoes e duvidas sobre o app.",
    "tutorial.chat.prompt.named":
      "A camera \"{{cameraName}}\" existe? Se existir, ela esta ativa agora?",
    "tutorial.chat.prompt.generic":
      "Existe alguma camera do tutorial configurada? Se existir, ela esta ativa agora?",
    "tutorial.chat.prompt.activeFollowUp.named":
      "O que a camera \"{{cameraName}}\" esta vendo agora e quais analiticos estao rodando nela?",
    "tutorial.chat.prompt.activeFollowUp.generic":
      "Se a camera do tutorial estiver ativa, o que ela esta vendo agora e quais analiticos estao rodando nela?",
    "tutorial.chat.prompt.recovery.named":
      "Se a camera \"{{cameraName}}\" estiver offline ou nao existir, me ajude a corrigir isso ou sugira o melhor proximo passo de configuracao.",
    "tutorial.chat.prompt.recovery.generic":
      "Se a camera do tutorial estiver offline ou nao existir, me ajude a corrigir isso ou sugira o melhor proximo passo de configuracao.",
  },
  fr: {
    "tutorial.entry.menu.chat.label": "Tutorial chat",
    "tutorial.entry.menu.chat.description":
      "Apprenez comment le chat peut repondre aux questions, controler l'app et agir sur les cameras et les agents.",
    "tutorial.chatOffer.title": "Voulez-vous continuer avec le tutoriel chat ?",
    "tutorial.chatOffer.description":
      "Le chat est l'endroit pour comprendre toute l'application, demander des explications et demander des creations ou des modifications sans memoriser chaque ecran.",
    "tutorial.chatOffer.bullet1":
      "Utilisez-le pour creer ou modifier des agents, des cameras et des parametres avances depuis un seul endroit.",
    "tutorial.chatOffer.bullet2":
      "Il peut aussi analyser des cameras en direct, revoir des videos enregistrees, scanner le reseau et repondre aux questions operationnelles.",
    "tutorial.chatOffer.primary": "Continuer vers le chat",
    "tutorial.chatIntro.title": "Etape 4 : Controler l'app depuis le chat",
    "tutorial.chatIntro.description":
      "Cet espace est l'assistant operationnel de tout le produit. Il peut expliquer les fonctions, suggerer des actions, creer ou modifier des ressources et aider a enqueter sur de la video en direct ou enregistree.",
    "tutorial.chatIntro.bullet1": "Demandez ce que signifie quelque chose avant de le changer.",
    "tutorial.chatIntro.bullet2": "Demandez des actions concretes comme creer des cameras, des jobs ou des agents.",
    "tutorial.chatIntro.bullet3":
      "Utilisez le meme chat pour inspecter les cameras en direct, les enregistrements envoyes et les parametres avances.",
    "tutorial.chatIntro.primary": "Afficher le premier prompt",
    "tutorial.chatCompose.title": "Commencez par la camera du tutoriel",
    "tutorial.chatCompose.descriptionWithCamera":
      "Le premier prompt verifie si la camera du tutoriel \"{{cameraName}}\" existe et si elle est active maintenant. Inserez ce prompt dans le composeur surligne puis envoyez-le.",
    "tutorial.chatCompose.descriptionWithoutCamera":
      "Le premier prompt verifie si la camera du tutoriel existe et si elle est active maintenant. Inserez ce prompt dans le composeur surligne puis envoyez-le.",
    "tutorial.chatCompose.bullet1":
      "Apres la reponse, nous utiliserons ce resultat pour choisir les exemples suivants.",
    "tutorial.chatCompose.bullet2":
      "Vous pouvez modifier le prompt avant l'envoi, mais la version proposee couvre deja la premiere verification.",
    "tutorial.chatCompose.primary": "Inserer le premier prompt",
    "tutorial.chatExamples.title": "Que demander ensuite",
    "tutorial.chatExamples.description":
      "Quand le chat repond a la premiere verification, poursuivez dans la meme conversation avec les exemples adaptes a la situation.",
    "tutorial.chatExamples.activeBullet": "Si la camera est active, essayez : {{prompt}}",
    "tutorial.chatExamples.recoveryBullet":
      "Si la camera est hors ligne ou absente, essayez : {{prompt}}",
    "tutorial.chatExamples.generalBullet":
      "Vous pouvez aussi demander au chat de scanner le reseau, creer ou modifier des cameras et des agents, ou expliquer n'importe quel parametre avance.",
    "tutorial.chatExamples.primary": "Continuer",
    "tutorial.complete.chat.title": "Tutoriel chat termine",
    "tutorial.complete.chat.description":
      "Vous avez maintenant un premier parcours operationnel dans le chat, en partant de la camera du tutoriel puis en allant vers un controle plus large de l'application.",
    "tutorial.complete.chat.bullet1":
      "Rouvrez ce tutoriel a tout moment depuis la barre du haut si vous voulez retrouver ce point d'entree guide.",
    "tutorial.complete.chat.bullet2":
      "A partir d'ici, vous pouvez continuer a utiliser le chat pour gerer cameras, agents, jobs, enregistrements et questions sur l'app.",
    "tutorial.chat.prompt.named":
      "La camera \"{{cameraName}}\" existe-t-elle ? Si oui, est-elle active maintenant ?",
    "tutorial.chat.prompt.generic":
      "Y a-t-il une camera de tutoriel configuree ? Si oui, est-elle active maintenant ?",
    "tutorial.chat.prompt.activeFollowUp.named":
      "Que voit la camera \"{{cameraName}}\" en ce moment et quelles analyses y tournent ?",
    "tutorial.chat.prompt.activeFollowUp.generic":
      "Si la camera du tutoriel est active, que voit-elle en ce moment et quelles analyses y tournent ?",
    "tutorial.chat.prompt.recovery.named":
      "Si la camera \"{{cameraName}}\" est hors ligne ou absente, aidez-moi a corriger cela ou suggerez la meilleure prochaine etape de configuration.",
    "tutorial.chat.prompt.recovery.generic":
      "Si la camera du tutoriel est hors ligne ou absente, aidez-moi a corriger cela ou suggerez la meilleure prochaine etape de configuration.",
  },
};
