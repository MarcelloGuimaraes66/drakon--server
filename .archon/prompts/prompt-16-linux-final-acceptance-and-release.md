# Prompt 16 - Aceite final Linux e release local

Objetivo:
Executar a validacao final de aceitacao Linux, fechar o pacote local e produzir um runbook de instalacao/execucao/desinstalacao.

Escopo:
- Validar build web.
- Validar build C++ Debug e Release.
- Validar CTest completo.
- Validar bateria visual claro/escuro.
- Validar pacote `.deb`.
- Validar install/remove em ambiente local quando seguro.
- Validar que AppHost, `.vcxproj` e `.sln` nao foram alterados.
- Validar que tokens nao aparecem em logs/data/state.

Restricoes:
- Nao fazer commit/push.
- Nao rodar comandos destrutivos.
- Nao apagar dados de usuario sem confirmacao explicita.
- Se precisar de `sudo apt install`, parar e informar o comando antes.

Checklist de aceite:

1. App abre pelo launcher.
2. Janela WebKitGTK carrega `/dashboard`.
3. Backend local responde `/__perceptrum/health`.
4. UI renderiza em dark/light sem layout quebrado.
5. Pareamento/provisionamento funciona.
6. Agente status/health funciona.
7. Camera discovery funciona.
8. RTSP/thumbnail funciona se a fase 15 ja estiver concluida.
9. Jobs/chat funcionam se gates correspondentes ja estiverem concluidos.
10. Remove/purge documentados.

Relatorio:
Criar `.archon/plans/relatorio-fase16-linux-final-acceptance-and-release.md` e um `RUNBOOK-LINUX.md` no local apropriado.
