export const tutorialCameraStepTranslations: Record<string, Record<string, string>> = {
  en: {
    "tutorial.common.continue": "Continue",
    "tutorial.welcome.stage2.description":
      "We show Scan Network, Import Cameras, and manual registration, then create a tutorial webcam so the flow can move forward.",
    "tutorial.complete.description":
      "Stages 1 and 2 are now connected end-to-end. Stage 3 stays visible as the next placeholder.",
    "tutorial.complete.bullet1":
      "API keys and camera registration now work inside the guided flow.",
    "tutorial.complete.bullet2":
      "Stage 3 is still visible and ready to be connected next.",
    "tutorial.cameraIntro.title": "Stage 2: Register a camera",
    "tutorial.cameraIntro.description":
      "We will use the Cameras page as the example. The same three entry points also exist in AI Agents.",
    "tutorial.cameraIntro.bullet1":
      "Use Scan Network when devices are already on the local network.",
    "tutorial.cameraIntro.bullet2":
      "Use Import Cameras or manual registration when discovery is not the best fit.",
    "tutorial.cameraScan.title": "Option 1: Scan Network",
    "tutorial.cameraScan.description":
      "Start here when cameras, NVRs, or DVRs are already reachable on the same network. The scan helps you find and register them faster.",
    "tutorial.cameraImport.title": "Option 2: Import Cameras",
    "tutorial.cameraImport.description":
      "Use this when you already have Excel, CSV, JSON, TSV, or plain-text camera data. The local AI reads the fields and registers the cameras automatically.",
    "tutorial.cameraRegister.title": "Option 3: Register a camera manually",
    "tutorial.cameraRegister.description":
      "Use this path when you want full control and need to add one camera at a time. We will use it for the guided example.",
    "tutorial.cameraRtsp.title": "IP / RTSP camera form",
    "tutorial.cameraRtsp.description":
      "For Hikvision, Dahua, Intelbras, and similar cameras, fill the name, IP, port, manufacturer, connection method, username, and password in this section.",
    "tutorial.cameraRtsp.bullet1": "Use Channel to reach other Hikvision channels.",
    "tutorial.cameraRtsp.bullet2": "Use Subtype to reach other Intelbras channels.",
    "tutorial.cameraAddress.title": "Address starts with ZIP code / CEP",
    "tutorial.cameraAddress.description":
      "Enter the ZIP code or CEP first. The app can auto-fill street, city, and state, so the number is usually the main field left to confirm.",
    "tutorial.cameraStorage.title": "Retention and collaborator sharing",
    "tutorial.cameraStorage.description":
      "Retention controls how long captured frames stay on disk. Collaborator sharing lets you invite specific Perceptrum users by @handle or email so they can use this camera in Drakon Find.",
    "tutorial.cameraWebcam.title": "Now switch to Webcam",
    "tutorial.cameraWebcam.description":
      "Webcam shares the same address, retention, and collaborator-sharing settings, but it only needs a camera name and a webcam index. For this example we already filled index 0 and a tutorial webcam name.",
    "tutorial.cameraWebcamSave.title": "Create the tutorial webcam",
    "tutorial.cameraWebcamSave.description":
      "We will save this example webcam now so the tutorial can continue to Stage 3. You can edit or remove it later in Cameras or AI Agents.",
    "tutorial.cameraWebcamSave.primary": "Create tutorial webcam",
  },
  es: {
    "tutorial.common.continue": "Continuar",
    "tutorial.welcome.stage2.description":
      "Mostramos Scan Network, Import Cameras y el registro manual, y luego creamos una webcam de tutorial para que el flujo pueda avanzar.",
    "tutorial.complete.description":
      "Las Etapas 1 y 2 ya estan conectadas de punta a punta. La Etapa 3 sigue visible como el siguiente placeholder.",
    "tutorial.complete.bullet1":
      "Las API keys y el registro de camaras ya funcionan dentro del flujo guiado.",
    "tutorial.complete.bullet2":
      "La Etapa 3 sigue visible y lista para conectarse despues.",
    "tutorial.cameraIntro.title": "Etapa 2: Registrar una camara",
    "tutorial.cameraIntro.description":
      "Usaremos la pagina Cameras como ejemplo. Las mismas tres entradas tambien existen en AI Agents.",
    "tutorial.cameraIntro.bullet1":
      "Usa Scan Network cuando los dispositivos ya esten en la red local.",
    "tutorial.cameraIntro.bullet2":
      "Usa Import Cameras o el registro manual cuando descubrir la red no sea la mejor opcion.",
    "tutorial.cameraScan.title": "Opcion 1: Scan Network",
    "tutorial.cameraScan.description":
      "Empieza aqui cuando las camaras, NVR o DVR ya sean accesibles en la misma red. El escaneo ayuda a encontrarlas y registrarlas mas rapido.",
    "tutorial.cameraImport.title": "Opcion 2: Import Cameras",
    "tutorial.cameraImport.description":
      "Usa esto cuando ya tengas datos de camaras en Excel, CSV, JSON, TSV o texto plano. La IA local lee los campos y registra las camaras automaticamente.",
    "tutorial.cameraRegister.title": "Opcion 3: Registrar una camara manualmente",
    "tutorial.cameraRegister.description":
      "Usa este camino cuando quieras control total y necesites agregar una camara por vez. Lo usaremos en el ejemplo guiado.",
    "tutorial.cameraRtsp.title": "Formulario de camara IP / RTSP",
    "tutorial.cameraRtsp.description":
      "Para Hikvision, Dahua, Intelbras y camaras similares, completa aqui el nombre, IP, puerto, fabricante, metodo de conexion, usuario y contrasena.",
    "tutorial.cameraRtsp.bullet1":
      "Usa Channel para llegar a otros canales de Hikvision.",
    "tutorial.cameraRtsp.bullet2":
      "Usa Subtype para llegar a otros canales de Intelbras.",
    "tutorial.cameraAddress.title": "La direccion empieza con ZIP code / CEP",
    "tutorial.cameraAddress.description":
      "Ingresa primero el ZIP code o CEP. La app puede completar calle, ciudad y estado automaticamente, por lo que el numero suele ser el principal campo que queda por confirmar.",
    "tutorial.cameraStorage.title": "Retencion y uso compartido con colaboradores",
    "tutorial.cameraStorage.description":
      "La retencion controla cuanto tiempo permanecen en disco los frames capturados. Compartir con colaboradores te permite invitar a usuarios especificos de Perceptrum por @handle o email para que usen esta camara en Drakon Find.",
    "tutorial.cameraWebcam.title": "Ahora cambiamos a Webcam",
    "tutorial.cameraWebcam.description":
      "Webcam comparte la misma direccion, la misma retencion y el mismo uso compartido con colaboradores, pero solo necesita un nombre y un webcam index. Para este ejemplo ya completamos el index 0 y un nombre de webcam del tutorial.",
    "tutorial.cameraWebcamSave.title": "Crear la webcam del tutorial",
    "tutorial.cameraWebcamSave.description":
      "Ahora guardaremos esta webcam de ejemplo para que el tutorial pueda continuar a la Etapa 3. Puedes editarla o eliminarla despues desde Cameras o AI Agents.",
    "tutorial.cameraWebcamSave.primary": "Crear webcam del tutorial",
  },
  pt: {
    "tutorial.common.continue": "Continuar",
    "tutorial.welcome.stage2.description":
      "Mostramos Scan Network, Import Cameras e o cadastro manual, depois criamos uma tutorial webcam para que o fluxo possa seguir.",
    "tutorial.complete.description":
      "As Etapas 1 e 2 agora estao conectadas de ponta a ponta. A Etapa 3 continua visivel como o proximo placeholder.",
    "tutorial.complete.bullet1":
      "As etapas de API key e cadastro de camera agora funcionam dentro do fluxo guiado.",
    "tutorial.complete.bullet2":
      "A Etapa 3 continua visivel e pronta para ser conectada depois.",
    "tutorial.cameraIntro.title": "Etapa 2: Registrar uma camera",
    "tutorial.cameraIntro.description":
      "Vamos usar a pagina Cameras como exemplo. Os mesmos tres caminhos tambem existem em AI Agents.",
    "tutorial.cameraIntro.bullet1":
      "Use Scan Network quando os dispositivos ja estiverem na rede local.",
    "tutorial.cameraIntro.bullet2":
      "Use Import Cameras ou o cadastro manual quando a descoberta em rede nao for a melhor opcao.",
    "tutorial.cameraScan.title": "Opcao 1: Scan Network",
    "tutorial.cameraScan.description":
      "Comece por aqui quando cameras, NVRs ou DVRs ja estiverem acessiveis na mesma rede. O scan ajuda voce a encontrar e registrar tudo mais rapido.",
    "tutorial.cameraImport.title": "Opcao 2: Import Cameras",
    "tutorial.cameraImport.description":
      "Use isso quando voce ja tiver dados de cameras em Excel, CSV, JSON, TSV ou plain text. A IA local le os campos e registra as cameras automaticamente.",
    "tutorial.cameraRegister.title": "Opcao 3: Cadastrar uma camera manualmente",
    "tutorial.cameraRegister.description":
      "Use este caminho quando voce quiser controle total e precisar adicionar uma camera por vez. Vamos usar esse fluxo no exemplo guiado.",
    "tutorial.cameraRtsp.title": "Formulario de camera IP / RTSP",
    "tutorial.cameraRtsp.description":
      "Para Hikvision, Dahua, Intelbras e cameras parecidas, preencha aqui o nome, IP, porta, fabricante, metodo de conexao, usuario e senha.",
    "tutorial.cameraRtsp.bullet1":
      "Use Channel para acessar outros canais em Hikvision.",
    "tutorial.cameraRtsp.bullet2":
      "Use Subtype para acessar outros canais em Intelbras.",
    "tutorial.cameraAddress.title": "O endereco comeca pelo ZIP code / CEP",
    "tutorial.cameraAddress.description":
      "Informe primeiro o ZIP code ou CEP. O app pode preencher rua, cidade e estado automaticamente, entao o numero costuma ser o principal campo que sobra para confirmar.",
    "tutorial.cameraStorage.title": "Retencao e compartilhamento com colaboradores",
    "tutorial.cameraStorage.description":
      "Retencao controla por quanto tempo os frames capturados ficam no disco. O compartilhamento com colaboradores permite convidar usuarios especificos do Perceptrum por @handle ou email para usarem essa camera no Drakon Find.",
    "tutorial.cameraWebcam.title": "Agora vamos para Webcam",
    "tutorial.cameraWebcam.description":
      "Webcam usa o mesmo endereco, a mesma retencao e o mesmo compartilhamento com colaboradores, mas precisa apenas do nome da camera e do webcam index. Para este exemplo ja preenchemos o index 0 e um nome de tutorial webcam.",
    "tutorial.cameraWebcamSave.title": "Criar a webcam do tutorial",
    "tutorial.cameraWebcamSave.description":
      "Vamos salvar essa webcam de exemplo agora para que o tutorial possa seguir para a Etapa 3. Voce pode editar ou remover essa camera depois em Cameras ou AI Agents.",
    "tutorial.cameraWebcamSave.primary": "Criar tutorial webcam",
  },
  fr: {
    "tutorial.common.continue": "Continuer",
    "tutorial.welcome.stage2.description":
      "Nous montrons Scan Network, Import Cameras et le mode manuel, puis nous creons une webcam de tutoriel pour que le flux puisse avancer.",
    "tutorial.complete.description":
      "Les Etapes 1 et 2 sont maintenant connectees de bout en bout. L Etape 3 reste visible comme prochain placeholder.",
    "tutorial.complete.bullet1":
      "Les API keys et l enregistrement des cameras fonctionnent maintenant dans le flux guide.",
    "tutorial.complete.bullet2":
      "L Etape 3 reste visible et prete a etre branchee ensuite.",
    "tutorial.cameraIntro.title": "Etape 2 : Enregistrer une camera",
    "tutorial.cameraIntro.description":
      "Nous utilisons la page Cameras comme exemple principal. Les trois memes points d entree existent aussi dans AI Agents.",
    "tutorial.cameraIntro.bullet1":
      "Utilisez Scan Network quand les appareils sont deja sur le reseau local.",
    "tutorial.cameraIntro.bullet2":
      "Utilisez Import Cameras ou le mode manuel quand la decouverte reseau n est pas le meilleur choix.",
    "tutorial.cameraScan.title": "Option 1 : Scan Network",
    "tutorial.cameraScan.description":
      "Commencez ici quand les cameras, NVR ou DVR sont deja accessibles sur le meme reseau. Le scan aide a les trouver et a les enregistrer plus vite.",
    "tutorial.cameraImport.title": "Option 2 : Import Cameras",
    "tutorial.cameraImport.description":
      "Utilisez cette option si vous avez deja des donnees camera en Excel, CSV, JSON, TSV ou texte brut. L IA locale lit les champs et enregistre les cameras automatiquement.",
    "tutorial.cameraRegister.title": "Option 3 : Enregistrer une camera manuellement",
    "tutorial.cameraRegister.description":
      "Utilisez ce chemin si vous voulez un controle total et ajouter une camera a la fois. Nous l utiliserons dans l exemple guide.",
    "tutorial.cameraRtsp.title": "Formulaire de camera IP / RTSP",
    "tutorial.cameraRtsp.description":
      "Pour Hikvision, Dahua, Intelbras et les cameras similaires, remplissez ici le nom, l IP, le port, le fabricant, la methode de connexion, l utilisateur et le mot de passe.",
    "tutorial.cameraRtsp.bullet1":
      "Utilisez Channel pour acceder a d autres canaux Hikvision.",
    "tutorial.cameraRtsp.bullet2":
      "Utilisez Subtype pour acceder a d autres canaux Intelbras.",
    "tutorial.cameraAddress.title": "L adresse commence par ZIP code / CEP",
    "tutorial.cameraAddress.description":
      "Saisissez d abord le ZIP code ou le CEP. L app peut remplir automatiquement la rue, la ville et l etat, donc le numero est souvent le principal champ qu il reste a confirmer.",
    "tutorial.cameraStorage.title": "Retention et partage avec des collaborateurs",
    "tutorial.cameraStorage.description":
      "La retention controle combien de temps les frames capturees restent sur le disque. Le partage avec des collaborateurs vous permet d inviter des utilisateurs Perceptrum precis par @handle ou e-mail afin qu ils puissent utiliser cette camera dans Drakon Find.",
    "tutorial.cameraWebcam.title": "Passons maintenant a Webcam",
    "tutorial.cameraWebcam.description":
      "Webcam partage la meme adresse, la meme retention et le meme partage avec des collaborateurs, mais elle n a besoin que d un nom de camera et d un webcam index. Pour cet exemple, nous avons deja rempli l index 0 et un nom de webcam de tutoriel.",
    "tutorial.cameraWebcamSave.title": "Creer la webcam du tutoriel",
    "tutorial.cameraWebcamSave.description":
      "Nous allons enregistrer cette webcam d exemple pour que le tutoriel puisse continuer vers l Etape 3. Vous pourrez la modifier ou la supprimer plus tard dans Cameras ou AI Agents.",
    "tutorial.cameraWebcamSave.primary": "Creer la webcam du tutoriel",
  },
  zh: {
    "tutorial.common.continue": "继续",
    "tutorial.welcome.stage2.description":
      "我们会展示 Scan Network、Import Cameras 和手动注册，然后创建一个 tutorial webcam，让流程继续前进。",
    "tutorial.complete.description":
      "第 1 步和第 2 步现在已经完整连通。第 3 步仍然作为下一个占位阶段可见。",
    "tutorial.complete.bullet1": "API key 和摄像头注册现在都可以在引导流程中完成。",
    "tutorial.complete.bullet2": "第 3 步仍然可见，并准备在下一轮接入真实流程。",
    "tutorial.cameraIntro.title": "第 2 步：注册摄像头",
    "tutorial.cameraIntro.description":
      "我们会以 Cameras 页面作为示例。相同的三个入口在 AI Agents 页面里也存在。",
    "tutorial.cameraIntro.bullet1": "当设备已经在本地网络中时，优先使用 Scan Network。",
    "tutorial.cameraIntro.bullet2":
      "当网络扫描不是最佳选择时，使用 Import Cameras 或手动注册。",
    "tutorial.cameraScan.title": "选项 1：Scan Network",
    "tutorial.cameraScan.description":
      "当摄像头、NVR 或 DVR 已经在同一网络中可访问时，从这里开始。扫描可以更快地帮你找到并注册它们。",
    "tutorial.cameraImport.title": "选项 2：Import Cameras",
    "tutorial.cameraImport.description":
      "如果你已经有 Excel、CSV、JSON、TSV 或纯文本格式的摄像头数据，就使用这里。本地 AI 会读取字段并自动注册摄像头。",
    "tutorial.cameraRegister.title": "选项 3：手动注册摄像头",
    "tutorial.cameraRegister.description":
      "当你需要完全控制并且要逐个添加摄像头时，使用这个入口。引导示例会使用这条路径。",
    "tutorial.cameraRtsp.title": "IP / RTSP 摄像头表单",
    "tutorial.cameraRtsp.description":
      "对于 Hikvision、Dahua、Intelbras 等摄像头，请在这里填写名称、IP、端口、厂商、连接方式、用户名和密码。",
    "tutorial.cameraRtsp.bullet1": "在 Hikvision 上，使用 Channel 访问其他通道。",
    "tutorial.cameraRtsp.bullet2": "在 Intelbras 上，使用 Subtype 访问其他通道。",
    "tutorial.cameraAddress.title": "地址从 ZIP code / CEP 开始",
    "tutorial.cameraAddress.description":
      "先填写 ZIP code 或 CEP。应用可以自动补全街道、城市和州，所以通常剩下需要确认的主要字段就是门牌号。",
    "tutorial.cameraStorage.title": "保留时长与协作者共享",
    "tutorial.cameraStorage.description":
      "保留时长决定捕获帧在磁盘上保存多久。协作者共享可让你通过 @handle 或邮箱邀请特定的 Perceptrum 用户在 Drakon Find 中使用这台摄像头。",
    "tutorial.cameraWebcam.title": "现在切换到 Webcam",
    "tutorial.cameraWebcam.description":
      "Webcam 共享相同的地址、保留时长与协作者共享设置，但只需要摄像头名称和 webcam index。这个示例里我们已经填好了 index 0 和一个教程 webcam 名称。",
    "tutorial.cameraWebcamSave.title": "创建教程 Webcam",
    "tutorial.cameraWebcamSave.description":
      "现在我们会保存这个示例 Webcam，让教程继续到第 3 步。之后你可以在 Cameras 或 AI Agents 中编辑或删除它。",
    "tutorial.cameraWebcamSave.primary": "创建教程 Webcam",
  },
  ar: {
    "tutorial.common.continue": "متابعة",
    "tutorial.welcome.stage2.description":
      "سنوضح Scan Network و Import Cameras والتسجيل اليدوي، ثم ننشئ tutorial webcam حتى يواصل التدفق تقدمه.",
    "tutorial.complete.description":
      "المرحلتان 1 و2 متصلتان الآن من البداية إلى النهاية. وتبقى المرحلة 3 ظاهرة كمرحلة مؤقتة تالية.",
    "tutorial.complete.bullet1":
      "تعمل مفاتيح API وتسجيل الكاميرات الآن داخل التدفق الارشادي.",
    "tutorial.complete.bullet2":
      "لا تزال المرحلة 3 ظاهرة وجاهزة للربط لاحقا.",
    "tutorial.cameraIntro.title": "المرحلة 2: تسجيل كاميرا",
    "tutorial.cameraIntro.description":
      "سنستخدم صفحة Cameras كمثال رئيسي. والخيارات الثلاثة نفسها موجودة ايضا في AI Agents.",
    "tutorial.cameraIntro.bullet1":
      "استخدم Scan Network عندما تكون الاجهزة موجودة بالفعل على الشبكة المحلية.",
    "tutorial.cameraIntro.bullet2":
      "استخدم Import Cameras او التسجيل اليدوي عندما لا يكون فحص الشبكة هو الخيار الافضل.",
    "tutorial.cameraScan.title": "الخيار 1: Scan Network",
    "tutorial.cameraScan.description":
      "ابدأ من هنا عندما تكون الكاميرات او اجهزة NVR و DVR متاحة بالفعل على الشبكة نفسها. يساعدك الفحص على العثور عليها وتسجيلها بسرعة اكبر.",
    "tutorial.cameraImport.title": "الخيار 2: Import Cameras",
    "tutorial.cameraImport.description":
      "استخدم هذا الخيار عندما تكون لديك بالفعل بيانات كاميرات في Excel او CSV او JSON او TSV او نص عادي. يقوم الذكاء المحلي بقراءة الحقول وتسجيل الكاميرات تلقائيا.",
    "tutorial.cameraRegister.title": "الخيار 3: تسجيل كاميرا يدويا",
    "tutorial.cameraRegister.description":
      "استخدم هذا المسار عندما تريد تحكما كاملا وتحتاج إلى اضافة كاميرا واحدة في كل مرة. سنستخدمه في المثال الارشادي.",
    "tutorial.cameraRtsp.title": "نموذج كاميرا IP / RTSP",
    "tutorial.cameraRtsp.description":
      "بالنسبة لكاميرات Hikvision و Dahua و Intelbras والكاميرات المشابهة، املأ هنا الاسم و IP والمنفذ والشركة المصنعة وطريقة الاتصال واسم المستخدم وكلمة المرور.",
    "tutorial.cameraRtsp.bullet1":
      "استخدم Channel للوصول إلى قنوات Hikvision الاخرى.",
    "tutorial.cameraRtsp.bullet2":
      "استخدم Subtype للوصول إلى قنوات Intelbras الاخرى.",
    "tutorial.cameraAddress.title": "يبدأ العنوان بـ ZIP code / CEP",
    "tutorial.cameraAddress.description":
      "ادخل ZIP code او CEP اولا. يمكن للتطبيق تعبئة الشارع والمدينة والولاية تلقائيا، لذلك يكون رقم العنوان عادة هو الحقل الرئيسي المتبقي للتأكيد.",
    "tutorial.cameraStorage.title": "الاحتفاظ ومشاركة المتعاونين",
    "tutorial.cameraStorage.description":
      "تحدد مدة الاحتفاظ المدة التي تبقى فيها اللقطات المخزنة على القرص. تتيح مشاركة المتعاونين دعوة مستخدمين محددين في Perceptrum بواسطة @handle او البريد الالكتروني ليتمكنوا من استخدام هذه الكاميرا داخل Drakon Find.",
    "tutorial.cameraWebcam.title": "الآن ننتقل إلى Webcam",
    "tutorial.cameraWebcam.description":
      "يشترك Webcam في العنوان والاحتفاظ ومشاركة المتعاونين، لكنه يحتاج فقط إلى اسم الكاميرا و webcam index. في هذا المثال قمنا بالفعل بتعبئة index 0 واسم webcam خاص بالتجربة التعليمية.",
    "tutorial.cameraWebcamSave.title": "إنشاء Webcam التعليمية",
    "tutorial.cameraWebcamSave.description":
      "سنحفظ Webcam المثال الآن حتى يتمكن البرنامج التعليمي من الانتقال إلى المرحلة 3. ويمكنك تعديلها او حذفها لاحقا من Cameras او AI Agents.",
    "tutorial.cameraWebcamSave.primary": "إنشاء Webcam التعليمية",
  },
};
