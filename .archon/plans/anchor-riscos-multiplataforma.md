# Anchor - Riscos Multiplataforma Perceptrum Desktop

Data: 2026-05-03  
Escopo: riscos tecnicos, operacionais e de seguranca para migracao Linux/Ubuntu.

## Riscos criticos

### R1 - Build Linux nao reprodutivel

Evidencia:

- `Perceptrum/out/build/linux-debug/CMakeCache.txt` referencia `PerceptrumLinux`, CMake/Ninja e fonte `Perceptrum`.
- `CPackConfig.cmake` referencia `Perceptrum/linux/debian/*`.
- No checkout atual nao existem `Perceptrum/CMakeLists.txt` nem `Perceptrum/linux/`.

Impacto:

- Nao ha caminho confiavel para reconstruir o `.deb` existente.
- CI Linux nao pode ser criado sem restaurar ou recriar a base.

Mitigacao:

- Priorizar restauracao/versionamento dos arquivos Linux.
- Tratar `Perceptrum/out` como evidencia, nao como fonte de verdade.

### R2 - AppHost acoplado a Windows

Evidencia:

- WinUI 3, C++/WinRT, Microsoft.UI.Xaml, WebView2, Windows App SDK.
- Uso de WinHTTP, Job Objects, ShellNotifyIcon, DPAPI, PowerShell, `LOCALAPPDATA`.

Impacto:

- Portar AppHost diretamente para Linux e inviavel.
- Tentar manter uma base unica para host nativo pode atrasar a migracao.

Mitigacao:

- Criar `LinuxHost` separado, com contrato funcional igual ao AppHost.
- Compartilhar apenas logica comum em bibliotecas pequenas quando fizer sentido.

### R3 - Segredos em Linux ficam em texto normal

Evidencia:

- `platform_secure_store.cpp` usa DPAPI em Windows.
- No caminho nao Windows, `ReadProtectedLocalText` e `WriteProtectedLocalText` leem/gravam texto normal.

Impacto:

- Tokens locais e chave SQLite podem ficar expostos no filesystem do usuario.
- Regressao de seguranca frente ao Windows.

Mitigacao:

- Implementar Secret Service/libsecret.
- Garantir permissoes 0700/0600.
- Migrar/quarentenar plaintext.
- Documentar fallback se keyring indisponivel.

### R4 - Chamadas Win32 espalhadas no runtime comum

Evidencia:

- `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp`, `JobRuntime.cpp` contem chamadas `CreateProcessW` e includes Windows.
- `CameraSession.cpp` inclui `windows.h`, `Psapi.h`, `Iphlpapi.h`, `Netioapi.h`, `Pdh.h`, `TlHelp32.h`.

Impacto:

- Build Linux pode quebrar ou exigir exclusao de funcionalidades.
- Funcoes de FFmpeg, metricas e captura podem divergir entre OS.

Mitigacao:

- Substituir invocacoes de processo por `platform_process`.
- Isolar metricas Windows e criar implementacoes POSIX.
- Configurar CMake para compilar somente caminhos portaveis ate completar refactor.

### R5 - SQLite criptografado depende de modulo nativo Node

Evidencia:

- `better-sqlite3-multiple-ciphers` e copiado no runtime Windows.
- Linux precisa ABI compativel com Node empacotado ou do sistema.

Impacto:

- Backend local pode falhar antes do healthcheck.
- Banco pode ficar ilegivel se key/cipher/legacy divergirem.

Mitigacao:

- Fixar Node runtime Linux ou rebuildar native module no pacote.
- Testar `APP_SQLITE_ENCRYPTION=required` em Ubuntu limpo.
- Validar header plaintext/encrypted e migracao em CI.

## Riscos altos

### R6 - Lifecycle do agente no Linux

Impacto:

- Processo pode sobreviver a UI, morrer sem restart ou rodar com usuario errado.

Mitigacao:

- Decidir entre processo filho, systemd user ou systemd system.
- Para desktop MVP, preferir processo filho ou systemd user.
- Garantir shutdown por SIGTERM e cleanup no uninstall.

### R7 - Tray Linux nao universal

Impacto:

- GNOME/Ubuntu pode nao exibir tray sem extensoes/AppIndicator.

Mitigacao:

- Implementar AppIndicator quando disponivel.
- Fornecer fallback com janela normal, menu e notificacoes desktop.
- Nao bloquear MVP por tray se runtime funcionar.

### R8 - OAuth/cookies/WebView divergentes

Impacto:

- Login Google pode falhar por redirect URI, cookie policy ou interceptacao diferente no WebKitGTK.

Mitigacao:

- Replicar contrato WebView2: origem local, callback rewrite, user data folder persistente.
- Validar `DESKTOP_GOOGLE_OAUTH_REDIRECT_URI`.
- Testar login em pacote instalado e em dev.

### R9 - Paths de dados conflitantes

Evidencia:

- `brand.config.json` define `dataRootLinux=~/.local/share/PerceptrumData`.
- Artefato Linux instala config em `/etc/perceptrum` e app em `/opt/perceptrum`.
- Windows AppHost usa `%LOCALAPPDATA%/DrakonPerceptrumDesktop/<brand>`.

Impacto:

- Mistura de dados do usuario, config de sistema e storage do agente.

Mitigacao:

- Definir layout Linux:
  - app: `/opt/perceptrum`;
  - config sistema: `/etc/perceptrum`;
  - dados usuario: `${XDG_DATA_HOME:-~/.local/share}/PerceptrumData`;
  - estado/logs: `${XDG_STATE_HOME:-~/.local/state}/perceptrum`;
  - cache WebKit: `${XDG_CACHE_HOME:-~/.cache}/perceptrum`.

### R10 - FFmpeg e OpenCV diferem entre Windows e Ubuntu

Impacto:

- Codec, RTSP timeout, transcode, concat e frame extraction podem ter resultados diferentes.

Mitigacao:

- Usar FFmpeg do sistema apenas se versao minima definida.
- Testar RTSP TCP/UDP, cortes, concat, thumbnails e MP4 web-compatible.
- Registrar comandos e stderr em logs.

### R11 - Camera discovery depende de rede local

Impacto:

- Multicast WS-Discovery pode ser bloqueado por firewall, VPN, interface errada ou sandbox.

Mitigacao:

- Expor diagnostico de interfaces.
- Permitir scan por range manual.
- Documentar portas UDP/TCP.

### R12 - Empacotamento e uninstall podem destruir dados

Impacto:

- Scripts Debian mal definidos podem remover storage do usuario ou deixar servicos ativos.

Mitigacao:

- `remove` para binarios/servicos; `purge` para `/etc`.
- Nunca apagar dados usuario sem confirmacao explicita.
- Testar install/upgrade/remove/purge.

## Riscos medios

### R13 - Dependencias Ubuntu variam por versao

Impacto:

- `libwebkit2gtk-4.1-0` e GTK3 podem nao estar iguais em todas as releases.

Mitigacao:

- Fixar Ubuntu alvo.
- Criar matriz CI/container para dependencias.

### R14 - Billing/Stripe em origem local

Impacto:

- Redirects e webhooks nao se comportam igual em desktop local.

Mitigacao:

- Validar fluxo billing com `APP_ALLOWED_ORIGINS` e browser externo quando necessario.

### R15 - Local LLM e modelos grandes

Impacto:

- Pacote pode crescer demais; download pode falhar; CPU-only pode ser lento.

Mitigacao:

- Separar runtime LLM/modelos como componente opcional.
- Suportar endpoint configurado.

### R16 - Logs e privacidade

Impacto:

- Logs podem conter tokens, prompts, cameras, paths e erros de API.

Mitigacao:

- Sanitizar logs.
- Permissoes restritas.
- Separar logs de usuario e systemd.

## Riscos de qualidade de codigo

### R17 - Duplicacao/erro aparente em AppHost

Evidencia:

- `AppHost/App.xaml.cpp` mostra duplicacao textual em `ScheduleLocalAppDataCleanupAfterAccountDeletionFromWeb`: uma linha `if (!LaunchAccountDeletionCleanupProcess(` aparece duplicada.

Impacto:

- Pode quebrar build Windows atual ou indicar conflito/edicao incompleta.

Mitigacao:

- Revisar em tarefa separada, pois este estudo nao altera codigo.

### R18 - Arquivos `_old.cpp` no runtime

Impacto:

- Pode confundir CMake e revisoes, ou ser incluido por acidente.

Mitigacao:

- Lista fonte explicita em CMake.
- Excluir arquivos antigos de builds novos.

## Riscos externos

### R19 - APIs externas e allowlist

Evidencia:

- `ACESSOS_EXTERNOS_CYBER.md` lista Google, OpenAI/Gemini, Stripe, Telegram, R2/media e cameras locais.

Impacto:

- Ambientes corporativos podem bloquear login, IA, billing ou camera discovery.

Mitigacao:

- Manter documento de allowlist atualizado.
- Health diagnostics por destino.

### R20 - Licencas/distribuicao

Impacto:

- Empacotar Node, FFmpeg, OpenCV, WebKitGTK ou modelos LLM pode exigir revisao de licenca.

Mitigacao:

- Inventariar licencas no pacote final.
- Preferir dependencias do sistema quando aceitavel.

## Matriz de severidade

| Risco | Severidade | Probabilidade | Prioridade |
|---|---:|---:|---:|
| R1 Build Linux nao reprodutivel | Critica | Alta | P0 |
| R2 AppHost Windows-only | Critica | Alta | P0 |
| R3 Segredos plaintext | Critica | Media | P0 |
| R4 Win32 no runtime | Critica | Alta | P0 |
| R5 Native SQLite cipher | Critica | Media | P0 |
| R6 Lifecycle agente | Alta | Media | P1 |
| R8 OAuth/WebView | Alta | Media | P1 |
| R9 Paths Linux | Alta | Alta | P1 |
| R10 FFmpeg/OpenCV | Alta | Media | P1 |
| R12 Packaging uninstall | Alta | Media | P1 |

## Recomendacao de mitigacao inicial

Antes de implementar novas features, executar uma trilha curta P0:

1. Restaurar/criar CMake e arquivos Linux versionados.
2. Criar build Linux limpo do agente minimo.
3. Criar LinuxHost minimo com WebKitGTK e healthcheck.
4. Implementar keystore Linux ou decisao formal de fallback.
5. Validar SQLite criptografado e native module no Ubuntu alvo.
