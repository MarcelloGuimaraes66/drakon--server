export const tutorialAgentStepTranslations: Record<string, Record<string, string>> = {
  en: {
    "tutorial.settingsCard.description":
      "Walk through API keys, camera registration, and a first AI agent. You can reopen this guided flow here or from the top bar.",
    "tutorial.welcome.stage3.description":
      "We create a first AI agent on the tutorial camera, explain its setup, show how to enable or pause it, and then start the camera feed.",
    "tutorial.complete.title": "Tutorial completed",
    "tutorial.complete.description":
      "Your tutorial camera and the thumbs up detector are now configured and turned on.",
    "tutorial.complete.descriptionWithoutWebcam":
      "Your tutorial camera and agent were created, but inference was not started automatically because you chose to continue without a responding webcam on this machine.",
    "tutorial.complete.bullet1":
      "The custom agent stays available in Algorithms, where you can enable or pause it anytime.",
    "tutorial.complete.bullet2":
      "The camera is also running in AI Agents, so you can test the full flow right away.",
    "tutorial.complete.bullet2WithoutWebcam":
      "When a webcam is connected and responding, use the start button in AI Agents to start the camera manually.",
    "tutorial.complete.visualCaption":
      "Stand in front of the tutorial camera and make a thumbs up gesture to verify the detector.",
    "tutorial.agentIntro.title": "Stage 3: Build an AI agent",
    "tutorial.agentIntro.description":
      "This last stage uses the continuous per-camera AI Agents path. Jobs / Steps remain the right path when you need schedules or multi-camera orchestration.",
    "tutorial.agentIntro.bullet1":
      "AI Agents are best for continuous monitoring on one camera.",
    "tutorial.agentIntro.bullet2":
      "Jobs / Steps are best for schedules, dependencies, or multi-camera workflows.",
    "tutorial.agentIntro.primary": "Continue",
    "tutorial.agentCreate.title": "Open the custom agent editor",
    "tutorial.agentCreate.description":
      "Click the highlighted button to create a custom AI agent for the tutorial webcam you just registered.",
    "tutorial.agentModel.title": "Choose the model",
    "tutorial.agentModel.description":
      "This selector chooses the model based on your saved API keys. If OpenAI is available, the tutorial prefers Ultra. If only Z.ai is configured, it uses Core.",
    "tutorial.agentInputType.title": "Choose the input type",
    "tutorial.agentInputType.description":
      "Input type defines whether the agent reads a short video sequence or single snapshots. For the thumbs up tutorial we keep Video, because the gesture is a short hand action.",
    "tutorial.agentFields.title": "Name, prompt core, and alert condition",
    "tutorial.agentFields.description":
      "We already filled this example with a thumbs up detector so you can see the minimum required fields clearly.",
    "tutorial.agentFields.bullet1": "Agent name: thumbs up detector.",
    "tutorial.agentFields.bullet2":
      "Prompt core and alert condition both look for any person making a thumbs up gesture with their hand.",
    "tutorial.agentEnhance.title": "Enhance Prompt with AI",
    "tutorial.agentEnhance.description":
      "This button analyzes your current prompt together with the latest streamed camera image to build a more detailed prompt suggestion that better matches your intent and helps reduce false positives.",
    "tutorial.agentPolygons.title": "Optional polygons for focused regions",
    "tutorial.agentPolygons.description":
      "You can draw named polygons over the image to split the scene into specific analysis areas. The agent can then watch only those regions instead of the full frame all the time.",
    "tutorial.agentExecution.title": "Run every, resolution, and FPS",
    "tutorial.agentExecution.description":
      "For this tutorial we keep High Resolution and 1 FPS. When Ultra is available, Run every stays at 10 seconds. With only Core, the app keeps Core's fixed 60-second cadence.",
    "tutorial.agentSave.title": "Create the thumbs up detector",
    "tutorial.agentSave.description":
      "Click Apply & Save to attach this custom AI agent to the tutorial webcam and return to its configuration page.",
    "tutorial.agentSave.primary": "Create tutorial agent",
    "tutorial.agentToggle.title": "Enable or pause this agent",
    "tutorial.agentToggle.description":
      "This switch controls whether the custom agent runs on this camera. It is already on for the tutorial, and this same toggle lets you pause or re-enable it later.",
    "tutorial.agentCameraStart.title": "Start the tutorial camera",
    "tutorial.agentCameraStart.description":
      "We are back in AI Agents. This button starts or stops the camera service itself. Start it now so the thumbs up detector can receive frames from the tutorial webcam.",
    "tutorial.agentCameraStart.descriptionWithoutWebcam":
      "We are back in AI Agents. Because you chose to continue without a responding webcam, we will only highlight the start button here. The camera will not be started automatically in this step.",
    "tutorial.agentCameraStart.primary": "Start tutorial camera",
    "tutorial.cameraWebcamProbe.probing":
      "Checking whether a webcam is responding on this machine...",
    "tutorial.cameraWebcamProbe.ready":
      "A responding webcam was found on this machine. The tutorial will use webcam index {{index}}.",
    "tutorial.cameraWebcamProbe.missing":
      "No responding webcam was detected on this machine. Connect one to continue correctly, or continue anyway to reach Stage 3.",
    "tutorial.cameraWebcamProbe.unknown":
      "We could not confirm webcam availability on this machine. If the desktop EXE is offline, you can still continue manually.",
    "tutorial.cameraWebcamProbe.modalTitle": "Connect a webcam now?",
    "tutorial.cameraWebcamProbe.modalDescription":
      "To finish this tutorial step the intended way, connect a webcam and try again. If you prefer, you can continue without a webcam, create the camera anyway, and keep going to agent creation.",
    "tutorial.cameraWebcamProbe.connectAndRetry": "Connect and try again",
    "tutorial.cameraWebcamProbe.continueWithout": "Continue without webcam",
    "tutorial.cameraWebcamProbe.keepEditing": "Keep editing",
    "tutorial.agentPreset.name": "thumbs up detector",
    "tutorial.agentPreset.promptCore":
      "Recognize any person making a thumbs up gesture with their hand.",
    "tutorial.agentPreset.alertCondition":
      "Alert if any person is making a thumbs up gesture with their hand.",
  },
  es: {
    "tutorial.settingsCard.description":
      "Recorre la API key, el registro de camaras y el primer agente de IA. Puedes reabrir este flujo guiado aqui o desde la barra superior.",
    "tutorial.welcome.stage3.description":
      "Creamos un primer agente en la camara del tutorial, explicamos su configuracion, mostramos como activarlo o pausarlo y luego iniciamos la camara.",
    "tutorial.complete.title": "Tutorial completado",
    "tutorial.complete.description":
      "La camara del tutorial y el detector de pulgar arriba ya quedaron configurados y encendidos.",
    "tutorial.complete.descriptionWithoutWebcam":
      "La camara y el agente del tutorial fueron creados, pero la inferencia no se inicio automaticamente porque elegiste continuar sin una webcam que respondiera en esta maquina.",
    "tutorial.complete.bullet1":
      "El custom agent queda disponible en Algorithms, donde puedes activarlo o pausarlo cuando quieras.",
    "tutorial.complete.bullet2":
      "La camara tambien esta corriendo en AI Agents, asi que puedes probar el flujo completo ahora mismo.",
    "tutorial.complete.bullet2WithoutWebcam":
      "Cuando conectes una webcam que responda, puedes usar el boton de inicio en AI Agents para arrancar la camara manualmente.",
    "tutorial.complete.visualCaption":
      "Ponte frente a la camara del tutorial y haz la senal de pulgar arriba para verificar el detector.",
    "tutorial.agentIntro.title": "Etapa 3: Crear un agente de IA",
    "tutorial.agentIntro.description":
      "Esta ultima etapa usa la ruta continua de AI Agents para una sola camara. Jobs / Steps sigue siendo la mejor opcion cuando necesitas schedules u orquestacion entre varias camaras.",
    "tutorial.agentIntro.bullet1":
      "AI Agents es ideal para monitoreo continuo en una sola camara.",
    "tutorial.agentIntro.bullet2":
      "Jobs / Steps es ideal para schedules, dependencias o flujos con varias camaras.",
    "tutorial.agentIntro.primary": "Continuar",
    "tutorial.agentCreate.title": "Abrir el editor de custom agent",
    "tutorial.agentCreate.description":
      "Haz clic en el boton resaltado para crear un custom AI agent para la tutorial webcam que acabas de registrar.",
    "tutorial.agentModel.title": "Elegir el modelo",
    "tutorial.agentModel.description":
      "Este selector elige el modelo usando tus API keys guardadas. Si OpenAI esta disponible, el tutorial prefiere Ultra. Si solo Z.ai esta configurado, usa Core.",
    "tutorial.agentInputType.title": "Elegir el input type",
    "tutorial.agentInputType.description":
      "Input type define si el agente analiza una secuencia corta de video o snapshots individuales. En este tutorial dejamos Video porque la senal de afirmativo es una accion corta de la mano.",
    "tutorial.agentFields.title": "Nombre, prompt core y alert condition",
    "tutorial.agentFields.description":
      "Ya dejamos este ejemplo completo con un detector de pulgar arriba para que veas con claridad los campos minimos obligatorios.",
    "tutorial.agentFields.bullet1": "Nombre del agente: detector de pulgar arriba.",
    "tutorial.agentFields.bullet2":
      "El prompt core y la condicion de alerta buscan a cualquier persona haciendo la senal de pulgar arriba con la mano.",
    "tutorial.agentEnhance.title": "Enhance Prompt with AI",
    "tutorial.agentEnhance.description":
      "Este boton analiza tu prompt actual junto con la ultima imagen transmitida por la camara para construir una sugerencia mas detallada, reforzar tu intencion y reducir falsos positivos.",
    "tutorial.agentPolygons.title": "Poligonos opcionales para regiones enfocadas",
    "tutorial.agentPolygons.description":
      "Puedes dibujar poligonos con nombre sobre la imagen para separar distintas zonas de analisis. Asi el agente puede mirar solo esas regiones y no todo el frame todo el tiempo.",
    "tutorial.agentExecution.title": "Run every, resolution y FPS",
    "tutorial.agentExecution.description":
      "En este tutorial dejamos High Resolution y 1 FPS. Cuando Ultra esta disponible, Run every queda en 10 segundos. Con solo Core, la app mantiene la cadencia fija de 60 segundos de Core.",
    "tutorial.agentSave.title": "Crear el detector de pulgar arriba",
    "tutorial.agentSave.description":
      "Haz clic en Apply & Save para adjuntar este custom AI agent a la tutorial webcam y volver a la pagina de configuracion.",
    "tutorial.agentSave.primary": "Crear agente del tutorial",
    "tutorial.agentToggle.title": "Activar o pausar este agente",
    "tutorial.agentToggle.description":
      "Este switch controla si el custom agent corre en esta camara. En el tutorial ya queda encendido, y el mismo switch te permite pausarlo o volver a activarlo despues.",
    "tutorial.agentCameraStart.title": "Iniciar la camara del tutorial",
    "tutorial.agentCameraStart.description":
      "Ya volvimos a AI Agents. Este boton inicia o detiene el servicio de la camara. Iniciala ahora para que el detector de pulgar arriba reciba frames de la tutorial webcam.",
    "tutorial.agentCameraStart.descriptionWithoutWebcam":
      "Ya volvimos a AI Agents. Como elegiste continuar sin una webcam que responda, aqui solo vamos a resaltar el boton de inicio. La camara no se iniciara automaticamente en este paso.",
    "tutorial.agentCameraStart.primary": "Iniciar camara del tutorial",
    "tutorial.cameraWebcamProbe.probing":
      "Verificando si hay una webcam respondiendo en esta maquina...",
    "tutorial.cameraWebcamProbe.ready":
      "Se encontro una webcam respondiendo en esta maquina. El tutorial usara el indice {{index}}.",
    "tutorial.cameraWebcamProbe.missing":
      "No se detecto ninguna webcam respondiendo en esta maquina. Conecta una para continuar correctamente o sigue de todos modos para llegar a la Etapa 3.",
    "tutorial.cameraWebcamProbe.unknown":
      "No pudimos confirmar la disponibilidad de una webcam en esta maquina. Si el EXE desktop esta offline, aun puedes continuar manualmente.",
    "tutorial.cameraWebcamProbe.modalTitle": "Quieres conectar una webcam ahora?",
    "tutorial.cameraWebcamProbe.modalDescription":
      "Para completar esta etapa del tutorial como fue pensada, conecta una webcam y vuelve a intentarlo. Si prefieres, puedes continuar sin webcam, crear la camara igual y seguir hasta la creacion del agente.",
    "tutorial.cameraWebcamProbe.connectAndRetry": "Conectar y volver a intentar",
    "tutorial.cameraWebcamProbe.continueWithout": "Seguir sin webcam",
    "tutorial.cameraWebcamProbe.keepEditing": "Seguir editando",
    "tutorial.agentPreset.name": "detector de pulgar arriba",
    "tutorial.agentPreset.promptCore":
      "Reconoce a cualquier persona haciendo la senal de pulgar arriba con la mano.",
    "tutorial.agentPreset.alertCondition":
      "Alertar si cualquier persona esta haciendo la senal de pulgar arriba con la mano.",
  },
  pt: {
    "tutorial.settingsCard.description":
      "Passe agora por API key, cadastro de camera e criacao do primeiro agente de IA. Voce pode reabrir esse fluxo aqui ou pela barra superior.",
    "tutorial.welcome.stage3.description":
      "Vamos criar um primeiro agente na camera do tutorial, explicar a configuracao, mostrar como ligar e pausar esse agente, e depois iniciar a camera.",
    "tutorial.complete.title": "Tutorial concluido",
    "tutorial.complete.description":
      "A camera do tutorial e o detector de afirmativo agora estao configurados e ligados.",
    "tutorial.complete.descriptionWithoutWebcam":
      "A camera e o agente do tutorial foram criados, mas a inferencia nao foi iniciada automaticamente porque voce escolheu continuar sem uma webcam respondendo nesta maquina.",
    "tutorial.complete.bullet1":
      "O custom agent continua disponivel em Algorithms, onde voce pode ligar ou pausar esse agente quando quiser.",
    "tutorial.complete.bullet2":
      "A camera tambem esta rodando em AI Agents, entao voce ja pode testar o fluxo completo.",
    "tutorial.complete.bullet2WithoutWebcam":
      "Quando uma webcam estiver conectada e respondendo, voce pode usar o botao de start em AI Agents para iniciar a camera manualmente.",
    "tutorial.complete.visualCaption":
      "Fique na frente da camera do tutorial e faca o sinal de afirmativo com a mao para verificar a deteccao.",
    "tutorial.agentIntro.title": "Etapa 3: Criar um agente de IA",
    "tutorial.agentIntro.description":
      "Esta ultima etapa usa o caminho continuo de AI Agents para uma camera. Jobs / Steps continua sendo o melhor caminho quando voce precisa de schedules ou orquestracao entre varias cameras.",
    "tutorial.agentIntro.bullet1":
      "AI Agents e o melhor caminho para monitoramento continuo em uma camera.",
    "tutorial.agentIntro.bullet2":
      "Jobs / Steps e o melhor caminho para schedules, dependencias ou fluxos com varias cameras.",
    "tutorial.agentIntro.primary": "Continuar",
    "tutorial.agentCreate.title": "Abrir o editor de custom agent",
    "tutorial.agentCreate.description":
      "Clique no botao destacado para criar um custom AI agent para a tutorial webcam que voce acabou de cadastrar.",
    "tutorial.agentModel.title": "Escolher o modelo",
    "tutorial.agentModel.description":
      "Esse seletor define o modelo a partir das API keys salvas. Se OpenAI estiver disponivel, o tutorial prefere Ultra. Se so Z.ai estiver configurado, ele usa Core.",
    "tutorial.agentInputType.title": "Escolher o input type",
    "tutorial.agentInputType.description":
      "Input type define se o agente analisa uma sequencia curta de video ou imagens isoladas. Neste tutorial deixamos Video, porque o sinal de afirmativo e uma acao curta da mao.",
    "tutorial.agentFields.title": "Nome, prompt core e alert condition",
    "tutorial.agentFields.description":
      "Ja deixamos este exemplo preenchido com um detector de afirmativo para voce ver com clareza os campos minimos obrigatorios.",
    "tutorial.agentFields.bullet1": "Nome do agente: detector de afirmativo.",
    "tutorial.agentFields.bullet2":
      "Prompt core e condicao de alerta procuram qualquer pessoa fazendo o sinal de afirmativo com a mao.",
    "tutorial.agentEnhance.title": "Enhance Prompt with AI",
    "tutorial.agentEnhance.description":
      "Esse botao analisa o prompt atual junto com a imagem streamada mais recente da camera para montar uma sugestao mais detalhada, reforcar sua intencao e reduzir falsos positivos.",
    "tutorial.agentPolygons.title": "Poligonos opcionais para areas focadas",
    "tutorial.agentPolygons.description":
      "Voce pode desenhar poligonos nomeados sobre a imagem para separar diferentes areas de analise. Assim o agente pode observar so essas regioes, em vez do frame inteiro o tempo todo.",
    "tutorial.agentExecution.title": "Run every, resolution e FPS",
    "tutorial.agentExecution.description":
      "Neste tutorial deixamos High Resolution e FPS 1. Quando Ultra esta disponivel, Run every fica em 10 segundos. Com apenas Core, o app mantem a cadencia fixa de 60 segundos do Core.",
    "tutorial.agentSave.title": "Criar o detector de afirmativo",
    "tutorial.agentSave.description":
      "Clique em Apply & Save para anexar esse custom AI agent a tutorial webcam e voltar para a pagina de configuracao desse agente.",
    "tutorial.agentSave.primary": "Criar agente do tutorial",
    "tutorial.agentToggle.title": "Ligar ou pausar este agente",
    "tutorial.agentToggle.description":
      "Esse switch controla se o custom agent roda nesta camera. No tutorial ele ja fica ligado, e esse mesmo toggle permite pausar ou religar o agente depois.",
    "tutorial.agentCameraStart.title": "Iniciar a camera do tutorial",
    "tutorial.agentCameraStart.description":
      "Agora estamos de volta em AI Agents. Este botao inicia ou para o servico da camera. Inicie agora para que o detector de afirmativo receba frames da tutorial webcam.",
    "tutorial.agentCameraStart.descriptionWithoutWebcam":
      "Agora estamos de volta em AI Agents. Como voce escolheu continuar sem uma webcam respondendo, vamos apenas destacar o botao de start aqui. A camera nao sera iniciada automaticamente nesta etapa.",
    "tutorial.agentCameraStart.primary": "Iniciar camera do tutorial",
    "tutorial.cameraWebcamProbe.probing":
      "Verificando se existe uma webcam respondendo nesta maquina...",
    "tutorial.cameraWebcamProbe.ready":
      "Encontramos uma webcam respondendo nesta maquina. O tutorial vai usar o indice {{index}}.",
    "tutorial.cameraWebcamProbe.missing":
      "Nenhuma webcam respondeu nesta maquina. Conecte uma webcam para continuar corretamente ou prossiga assim mesmo para seguir ate a Etapa 3.",
    "tutorial.cameraWebcamProbe.unknown":
      "Nao foi possivel confirmar se existe webcam respondendo nesta maquina. Se o EXE desktop estiver offline, voce ainda pode continuar manualmente.",
    "tutorial.cameraWebcamProbe.modalTitle": "Conectar uma webcam agora?",
    "tutorial.cameraWebcamProbe.modalDescription":
      "Para concluir esta etapa do tutorial do jeito correto, conecte uma webcam e tente novamente. Se preferir, voce pode continuar sem webcam, criar a camera mesmo assim e seguir para a criacao dos agentes.",
    "tutorial.cameraWebcamProbe.connectAndRetry": "Conectar e tentar de novo",
    "tutorial.cameraWebcamProbe.continueWithout": "Prosseguir sem webcam",
    "tutorial.cameraWebcamProbe.keepEditing": "Continuar editando",
    "tutorial.agentPreset.name": "detector de afirmativo",
    "tutorial.agentPreset.promptCore":
      "Reconheca qualquer pessoa fazendo o sinal de afirmativo com a mao.",
    "tutorial.agentPreset.alertCondition":
      "Alertar se qualquer pessoa estiver fazendo o sinal de afirmativo com a mao.",
  },
  fr: {
    "tutorial.settingsCard.description":
      "Parcourez maintenant la cle API, l enregistrement de la camera et le premier agent IA. Vous pouvez rouvrir ce flux guide ici ou depuis la barre superieure.",
    "tutorial.welcome.stage3.description":
      "Nous allons creer un premier agent sur la camera du tutoriel, expliquer sa configuration, montrer comment l activer ou le mettre en pause, puis demarrer la camera.",
    "tutorial.complete.title": "Tutoriel termine",
    "tutorial.complete.description":
      "La camera du tutoriel et le detecteur de pouce leve sont maintenant configures et allumes.",
    "tutorial.complete.descriptionWithoutWebcam":
      "La camera et l agent du tutoriel ont ete crees, mais l inference n a pas ete demarree automatiquement car vous avez choisi de continuer sans webcam repondant sur cette machine.",
    "tutorial.complete.bullet1":
      "Le custom agent reste disponible dans Algorithms, ou vous pouvez l activer ou le mettre en pause a tout moment.",
    "tutorial.complete.bullet2":
      "La camera fonctionne aussi dans AI Agents, vous pouvez donc tester tout le flux immediatement.",
    "tutorial.complete.bullet2WithoutWebcam":
      "Quand une webcam sera connectee et repondra, vous pourrez utiliser le bouton de demarrage dans AI Agents pour lancer la camera manuellement.",
    "tutorial.complete.visualCaption":
      "Placez-vous devant la camera du tutoriel et faites un geste de pouce leve pour verifier la detection.",
    "tutorial.agentIntro.title": "Etape 3 : Creer un agent IA",
    "tutorial.agentIntro.description":
      "Cette derniere etape utilise le chemin AI Agents continu pour une seule camera. Jobs / Steps reste le bon choix quand vous avez besoin de schedules ou d orchestration multi-camera.",
    "tutorial.agentIntro.bullet1":
      "AI Agents est ideal pour une surveillance continue sur une seule camera.",
    "tutorial.agentIntro.bullet2":
      "Jobs / Steps est ideal pour les schedules, les dependances ou les flux avec plusieurs cameras.",
    "tutorial.agentIntro.primary": "Continuer",
    "tutorial.agentCreate.title": "Ouvrir l editeur de custom agent",
    "tutorial.agentCreate.description":
      "Cliquez sur le bouton mis en evidence pour creer un custom AI agent pour la tutorial webcam que vous venez d enregistrer.",
    "tutorial.agentModel.title": "Choisir le modele",
    "tutorial.agentModel.description":
      "Ce selecteur choisit le modele a partir de vos API keys enregistrees. Si OpenAI est disponible, le tutoriel prefere Ultra. Si seul Z.ai est configure, il utilise Core.",
    "tutorial.agentInputType.title": "Choisir l input type",
    "tutorial.agentInputType.description":
      "L input type definit si l agent analyse une courte sequence video ou des images isolees. Dans ce tutoriel, nous gardons Video car le geste affirmatif est une action breve de la main.",
    "tutorial.agentFields.title": "Nom, prompt core et alert condition",
    "tutorial.agentFields.description":
      "Nous avons deja rempli cet exemple avec un detecteur de pouce leve pour montrer clairement les champs minimum requis.",
    "tutorial.agentFields.bullet1": "Nom de l agent : detecteur de pouce leve.",
    "tutorial.agentFields.bullet2":
      "Le prompt core et la condition d alerte recherchent toute personne faisant un geste de pouce leve avec la main.",
    "tutorial.agentEnhance.title": "Enhance Prompt with AI",
    "tutorial.agentEnhance.description":
      "Ce bouton analyse votre prompt actuel avec la derniere image transmise par la camera pour produire une suggestion plus detaillee, mieux aligner l intention et reduire les faux positifs.",
    "tutorial.agentPolygons.title": "Polygones optionnels pour des zones ciblees",
    "tutorial.agentPolygons.description":
      "Vous pouvez dessiner des polygones nommes sur l image pour separer differentes zones d analyse. L agent peut ainsi observer uniquement ces regions au lieu de tout le frame en permanence.",
    "tutorial.agentExecution.title": "Run every, resolution et FPS",
    "tutorial.agentExecution.description":
      "Dans ce tutoriel, nous gardons High Resolution et 1 FPS. Quand Ultra est disponible, Run every reste a 10 secondes. Avec seulement Core, l app conserve la cadence fixe de 60 secondes de Core.",
    "tutorial.agentSave.title": "Creer le detecteur de pouce leve",
    "tutorial.agentSave.description":
      "Cliquez sur Apply & Save pour attacher ce custom AI agent a la tutorial webcam et revenir a la page de configuration.",
    "tutorial.agentSave.primary": "Creer l agent du tutoriel",
    "tutorial.agentToggle.title": "Activer ou mettre en pause cet agent",
    "tutorial.agentToggle.description":
      "Ce commutateur controle si le custom agent tourne sur cette camera. Dans le tutoriel il est deja active, et le meme toggle vous permet de le mettre en pause ou de le reactiver plus tard.",
    "tutorial.agentCameraStart.title": "Demarrer la camera du tutoriel",
    "tutorial.agentCameraStart.description":
      "Nous sommes de retour dans AI Agents. Ce bouton demarre ou arrete le service de la camera. Demarrez-la maintenant pour que le detecteur de pouce leve recoive des images de la tutorial webcam.",
    "tutorial.agentCameraStart.descriptionWithoutWebcam":
      "Nous sommes de retour dans AI Agents. Comme vous avez choisi de continuer sans webcam repondant, nous allons seulement mettre en evidence le bouton de demarrage ici. La camera ne sera pas demarree automatiquement a cette etape.",
    "tutorial.agentCameraStart.primary": "Demarrer la camera du tutoriel",
    "tutorial.cameraWebcamProbe.probing":
      "Verification d une webcam qui repond sur cette machine...",
    "tutorial.cameraWebcamProbe.ready":
      "Une webcam repondante a ete trouvee sur cette machine. Le tutoriel utilisera l index {{index}}.",
    "tutorial.cameraWebcamProbe.missing":
      "Aucune webcam repondante n a ete detectee sur cette machine. Connectez-en une pour continuer correctement ou continuez quand meme pour atteindre l Etape 3.",
    "tutorial.cameraWebcamProbe.unknown":
      "Nous n avons pas pu confirmer la disponibilite d une webcam sur cette machine. Si l EXE desktop est hors ligne, vous pouvez quand meme continuer manuellement.",
    "tutorial.cameraWebcamProbe.modalTitle": "Connecter une webcam maintenant ?",
    "tutorial.cameraWebcamProbe.modalDescription":
      "Pour terminer cette etape du tutoriel comme prevu, connectez une webcam et reessayez. Si vous preferez, vous pouvez continuer sans webcam, creer la camera quand meme et poursuivre jusqu a la creation de l agent.",
    "tutorial.cameraWebcamProbe.connectAndRetry": "Connecter et reessayer",
    "tutorial.cameraWebcamProbe.continueWithout": "Continuer sans webcam",
    "tutorial.cameraWebcamProbe.keepEditing": "Continuer a modifier",
    "tutorial.agentPreset.name": "detecteur de pouce leve",
    "tutorial.agentPreset.promptCore":
      "Reconnaissez toute personne faisant un geste de pouce leve avec la main.",
    "tutorial.agentPreset.alertCondition":
      "Alerter si une personne fait un geste de pouce leve avec la main.",
  },
  zh: {
    "tutorial.settingsCard.description":
      "现在可以依次完成 API key、摄像头注册和第一个 AI agent。你可以在这里或顶部栏重新打开这条引导流程。",
    "tutorial.welcome.stage3.description":
      "我们会在教程摄像头上创建第一个 agent，解释它的配置，展示如何启用或暂停它，然后启动摄像头。",
    "tutorial.complete.title": "教程已完成",
    "tutorial.complete.description":
      "教程摄像头和点赞检测 agent 现在都已经配置完成并已开启。",
    "tutorial.complete.bullet1":
      "这个 custom agent 会保留在 Algorithms 页面里，你可以随时启用或暂停它。",
    "tutorial.complete.bullet2":
      "摄像头也已经在 AI Agents 页面启动，所以你现在就可以测试完整流程。",
    "tutorial.complete.visualCaption":
      "站在教程摄像头前，对着镜头做一个点赞手势来验证检测效果。",
    "tutorial.agentIntro.title": "第 3 步：创建 AI agent",
    "tutorial.agentIntro.description":
      "最后这一阶段使用单摄像头持续运行的 AI Agents 路径。需要 schedule 或多摄像头编排时，Jobs / Steps 仍然是正确选择。",
    "tutorial.agentIntro.bullet1": "AI Agents 最适合单摄像头持续监控。",
    "tutorial.agentIntro.bullet2": "Jobs / Steps 最适合 schedule、依赖关系或多摄像头工作流。",
    "tutorial.agentIntro.primary": "继续",
    "tutorial.agentCreate.title": "打开 custom agent 编辑器",
    "tutorial.agentCreate.description":
      "点击高亮按钮，为你刚刚注册的 tutorial webcam 创建一个 custom AI agent。",
    "tutorial.agentModel.title": "选择模型",
    "tutorial.agentModel.description":
      "这个选择器会根据你已保存的 API key 来确定模型。如果 OpenAI 可用，教程优先使用 Ultra；如果只有 Z.ai，则使用 Core。",
    "tutorial.agentInputType.title": "选择输入类型",
    "tutorial.agentInputType.description":
      "输入类型决定 agent 分析短视频序列还是单张快照。这个教程保持为 Video，因为点赞手势是一个很短的手部动作。",
    "tutorial.agentFields.title": "名称、prompt core 和 alert condition",
    "tutorial.agentFields.description":
      "这个示例已经预先填好了点赞检测器，方便你清楚看到最少必填字段。",
    "tutorial.agentFields.bullet1": "Agent 名称：thumbs up detector。",
    "tutorial.agentFields.bullet2":
      "Prompt core 和 alert condition 都会查找任何做出点赞手势的人。",
    "tutorial.agentEnhance.title": "Enhance Prompt with AI",
    "tutorial.agentEnhance.description":
      "这个按钮会分析你当前的 prompt 和摄像头最新传输画面，生成更详细的建议，以更贴近你的意图并减少误报。",
    "tutorial.agentPolygons.title": "可选多边形聚焦区域",
    "tutorial.agentPolygons.description":
      "你可以在图像上绘制带名称的多边形，把画面拆分成不同的分析区域。这样 agent 就可以只关注这些区域，而不必一直分析整个画面。",
    "tutorial.agentExecution.title": "Run every、resolution 和 FPS",
    "tutorial.agentExecution.description":
      "本教程保持 High Resolution 和 1 FPS。Ultra 可用时，Run every 保持 10 秒；如果只有 Core，应用会保持 Core 固定的 60 秒频率。",
    "tutorial.agentSave.title": "创建点赞检测器",
    "tutorial.agentSave.description":
      "点击 Apply & Save，把这个 custom AI agent 绑定到 tutorial webcam，并返回它的配置页面。",
    "tutorial.agentSave.primary": "创建教程 agent",
    "tutorial.agentToggle.title": "启用或暂停这个 agent",
    "tutorial.agentToggle.description":
      "这个开关控制 custom agent 是否在这台摄像头上运行。教程里它已经开启，以后你也可以用同一个开关暂停或重新启用它。",
    "tutorial.agentCameraStart.title": "启动教程摄像头",
    "tutorial.agentCameraStart.description":
      "我们现在回到了 AI Agents。这个按钮控制摄像头服务的启动或停止。现在启动它，这样点赞检测器才能从 tutorial webcam 接收画面。",
    "tutorial.agentCameraStart.primary": "启动教程摄像头",
    "tutorial.agentPreset.name": "thumbs up detector",
    "tutorial.agentPreset.promptCore": "识别任何用手做出点赞手势的人。",
    "tutorial.agentPreset.alertCondition": "如果有人做出点赞手势就触发告警。",
  },
  ar: {
    "tutorial.settingsCard.description":
      "يمكنك الآن المرور على API key وتسجيل الكاميرا وإنشاء أول agent للذكاء الاصطناعي. ويمكنك إعادة فتح هذا المسار الإرشادي من هنا أو من الشريط العلوي.",
    "tutorial.welcome.stage3.description":
      "سننشئ agent أول على كاميرا الدليل، ونشرح إعداداته، ونوضح كيف يتم تشغيله أو إيقافه مؤقتاً، ثم نبدأ الكاميرا.",
    "tutorial.complete.title": "اكتمل الشرح",
    "tutorial.complete.description":
      "كاميرا الدليل ووكيل كشف إشارة الإعجاب أصبحا الآن مضبوطين ويعملان.",
    "tutorial.complete.bullet1":
      "سيبقى هذا الـ custom agent متاحاً داخل Algorithms، ويمكنك تشغيله أو إيقافه مؤقتاً في أي وقت.",
    "tutorial.complete.bullet2":
      "الكاميرا تعمل أيضاً داخل AI Agents، لذلك يمكنك تجربة التدفق الكامل مباشرة.",
    "tutorial.complete.visualCaption":
      "قف أمام كاميرا الدليل وارفع إشارة الإعجاب بيدك للتأكد من أن الكشف يعمل.",
    "tutorial.agentIntro.title": "المرحلة 3: إنشاء agent للذكاء الاصطناعي",
    "tutorial.agentIntro.description":
      "تستخدم هذه المرحلة الأخيرة مسار AI Agents المستمر لكاميرا واحدة. ويبقى Jobs / Steps هو المسار الصحيح عندما تحتاج إلى schedules أو تنسيق بين عدة كاميرات.",
    "tutorial.agentIntro.bullet1":
      "AI Agents هو الأنسب للمراقبة المستمرة على كاميرا واحدة.",
    "tutorial.agentIntro.bullet2":
      "Jobs / Steps هو الأنسب للـ schedules أو الاعتماديات أو تدفقات العمل متعددة الكاميرات.",
    "tutorial.agentIntro.primary": "متابعة",
    "tutorial.agentCreate.title": "فتح محرر custom agent",
    "tutorial.agentCreate.description":
      "اضغط على الزر المميز لإنشاء custom AI agent للـ tutorial webcam التي سجلتها قبل قليل.",
    "tutorial.agentModel.title": "اختيار النموذج",
    "tutorial.agentModel.description":
      "هذا المحدد يختار النموذج اعتماداً على API keys المحفوظة. إذا كان OpenAI متاحاً فسيُفضل Ultra، وإذا كان المتاح فقط هو Z.ai فسيستخدم Core.",
    "tutorial.agentInputType.title": "اختيار نوع الإدخال",
    "tutorial.agentInputType.description":
      "نوع الإدخال يحدد هل سيحلل agent مقطع فيديو قصير أم صوراً مفردة. في هذا الشرح نبقيه على Video لأن إشارة الإعجاب حركة يد قصيرة.",
    "tutorial.agentFields.title": "الاسم و prompt core و alert condition",
    "tutorial.agentFields.description":
      "لقد جهزنا هذا المثال مسبقاً على شكل كاشف لإشارة الإعجاب حتى ترى بوضوح أقل الحقول المطلوبة.",
    "tutorial.agentFields.bullet1": "اسم الـ agent: كاشف إشارة الإعجاب.",
    "tutorial.agentFields.bullet2":
      "كل من prompt core و alert condition يبحثان عن أي شخص يقوم بإشارة الإعجاب بيده.",
    "tutorial.agentEnhance.title": "Enhance Prompt with AI",
    "tutorial.agentEnhance.description":
      "هذا الزر يحلل الـ prompt الحالي مع آخر صورة متدفقة من الكاميرا ليبني اقتراحاً أكثر تفصيلاً، ويعزز نيتك، ويقلل الإيجابيات الكاذبة.",
    "tutorial.agentPolygons.title": "مضلعات اختيارية لمناطق مركزة",
    "tutorial.agentPolygons.description":
      "يمكنك رسم مضلعات مسماة فوق الصورة لتقسيم المشهد إلى مناطق تحليل مختلفة. وهكذا يستطيع الـ agent مراقبة تلك المناطق فقط بدلا من الإطار كله بشكل مستمر.",
    "tutorial.agentExecution.title": "Run every و resolution و FPS",
    "tutorial.agentExecution.description":
      "في هذا الشرح نبقي على High Resolution و 1 FPS. عندما يكون Ultra متاحاً يبقى Run every على 10 ثوانٍ. ومع وجود Core فقط يحافظ التطبيق على cadence الثابتة البالغة 60 ثانية.",
    "tutorial.agentSave.title": "إنشاء كاشف إشارة الإعجاب",
    "tutorial.agentSave.description":
      "اضغط على Apply & Save لإرفاق هذا الـ custom AI agent بالـ tutorial webcam ثم العودة إلى صفحة الإعداد.",
    "tutorial.agentSave.primary": "إنشاء agent الدليل",
    "tutorial.agentToggle.title": "تشغيل هذا agent أو إيقافه مؤقتاً",
    "tutorial.agentToggle.description":
      "هذا المفتاح يتحكم فيما إذا كان الـ custom agent يعمل على هذه الكاميرا. في الشرح يكون مفعلاً بالفعل، ويمكنك استخدام المفتاح نفسه لإيقافه مؤقتاً أو إعادة تشغيله لاحقاً.",
    "tutorial.agentCameraStart.title": "تشغيل كاميرا الدليل",
    "tutorial.agentCameraStart.description":
      "نحن الآن عدنا إلى AI Agents. هذا الزر يبدأ أو يوقف خدمة الكاميرا نفسها. ابدأها الآن حتى يستطيع كاشف إشارة الإعجاب استقبال الإطارات من الـ tutorial webcam.",
    "tutorial.agentCameraStart.primary": "تشغيل كاميرا الدليل",
    "tutorial.agentPreset.name": "كاشف إشارة الإعجاب",
    "tutorial.agentPreset.promptCore": "تعرّف على أي شخص يقوم بإشارة الإعجاب بيده.",
    "tutorial.agentPreset.alertCondition": "أطلق تنبيهاً إذا كان أي شخص يقوم بإشارة الإعجاب بيده.",
  },
};
