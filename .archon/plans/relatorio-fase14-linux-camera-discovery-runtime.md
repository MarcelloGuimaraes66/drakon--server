# Relatorio fase 14 - Linux camera discovery runtime

Data: 2026-05-24

## Escopo entregue

- `DrakonSite/server` agora atende `POST /api/runtime/camera-discovery` no runtime Node local.
- O discovery local usa WS-Discovery/ONVIF via UDP multicast `239.255.255.250:3702` e probe TCP limitado para portas RTSP comuns (`554`, `8554`, `10554`) nas sub-redes IPv4 locais.
- A resposta usa o contrato existente de `CameraDiscoveryResponse`, incluindo `devices`, `elapsed_ms`, `timeout_ms` e `summary`.
- `DrakonSite/src/worker` tem um fallback explicito para `POST /api/runtime/camera-discovery` retornando `501`, indicando que discovery de LAN exige o runtime Node local.
- A UI comum de Cameras continua usando `scanNetworkForCameras()` contra `/api/runtime/camera-discovery`, entao o modal de discovery abre e recebe uma resposta local sem depender de APIs de AppHost.

## O que funciona sem RTSP/captura

- Abrir o modal "Scan network for cameras" na UI Cameras.
- Solicitar discovery ao backend local Node.
- Retornar JSON mesmo quando nenhuma camera responde na LAN.
- Detectar candidatos por WS-Discovery/ONVIF quando multicast e respostas UDP estao liberados.
- Detectar candidatos por porta RTSP aberta como sugestao de cadastro, sem abrir stream, sem capturar frames e sem iniciar sessao de camera.
- Montar grupos/sumario no formato compartilhado usado pela UI.
- Importar cameras descobertas continua sendo apenas criacao de registros via `/api/cameras`; nao inicia runtime de captura.

## Permissao e rede no Ubuntu

- Discovery WS-Discovery/ONVIF precisa que a maquina Linux esteja na mesma LAN/VLAN das cameras e que a rede permita multicast UDP.
- Liberar saida UDP para `239.255.255.250:3702` e entrada das respostas UDP dos dispositivos.
- Firewalls locais como `ufw` podem bloquear respostas. Em ambiente restrito, validar regras para UDP 3702 e trafego de retorno na interface LAN.
- Cameras em VLAN isolada, Wi-Fi client isolation, sub-redes roteadas sem multicast, VPNs e Docker/namespace de rede podem impedir WS-Discovery.
- O probe RTSP desta fase so testa conexao TCP em portas comuns. Ele nao autentica, nao abre RTSP e nao valida codec.

## Gates mantidos para fase 15

- AgentCore completo permanece desativado.
- `CameraSession`, `FrameDiskWriter` e `JobRuntime` nao foram ativados.
- Captura RTSP, thumbnails reais, gravacao em disco e inferencia por camera continuam fora desta fase.
- Validacao de credenciais RTSP/ONVIF e enumeracao real de canais por login ficam para a fase 15.
- Tratamento avancado de DVR/NVR por protocolo autenticado fica para a fase 15.

## Validacao executada

```bash
cd DrakonSite
npm run build
npm run test:platform-boundaries

cd ../Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado:

- `npm run build`: passou.
- `npm run test:platform-boundaries`: passou.
- `cmake -S ...`: passou.
- `cmake --build ...`: passou.
- `ctest ...`: passou, 50/50 testes.

Checagem adicional:

```bash
node --import tsx --eval "const { runLocalCameraDiscovery } = await import('./server/camera-discovery.ts'); const r = await runLocalCameraDiscovery(1000); console.log(JSON.stringify({elapsed_ms:r.elapsed_ms, timeout_ms:r.timeout_ms, device_count:r.devices.length, has_summary:!!r.summary}));"
```

Resultado local: retornou JSON com `has_summary: true` e `device_count: 0` nesta rede de teste, sem erro.
