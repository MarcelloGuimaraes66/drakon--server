# Documento para Cyber - Acessos Externos do Perceptrum Desktop

Data: 2026-04-07

Projeto avaliado: `C:\dev\Workspace\perceptrum_desktop_aspp`

## Objetivo

Este documento consolida os destinos externos que devem ser considerados para allowlist de rede do aplicativo Perceptrum Desktop / DrakonSite, com foco em funcionamento operacional, autenticação, IA, notificações, billing, armazenamento de mídia e integrações opcionais.

Regra geral recomendada: liberar saida HTTPS/TCP 443 para os dominios listados, salvo quando uma porta diferente estiver indicada.

## Dominios Principais

| Dominio | Finalidade | Obrigatoriedade |
|---|---|---|
| `api.openai.com` | Chamadas de IA via OpenAI | Necessario para modelos OpenAI |
| `*.oaiusercontent.com` | Conteudo/arquivos associados a OpenAI | Manter por compatibilidade |
| `platform.openai.com` | Abertura da pagina de API keys OpenAI | Opcional, usado pela tela de configuracao |
| `api.z.ai` | Chamadas de IA do modo Core / GLM | Necessario para modelo Core |
| `z.ai` | Abertura da pagina de API keys Z.ai | Opcional, usado pela tela de configuracao |
| `api.telegram.org` | Notificacoes via Telegram | Necessario se Telegram estiver habilitado |
| `https://aiquimist.ai` | Acesso previamente solicitado | Manter por compatibilidade |
| `*.googleapis.com` | APIs Google, incluindo geocoding | Necessario se recursos Google estiverem habilitados |
| `accounts.google.com` | Login/OAuth Google e descoberta OIDC | Necessario se login Google estiver habilitado |
| `fonts.googleapis.com` | Fonte web importada pela UI | Opcional, usado pela UI web |
| `fonts.gstatic.com` | Arquivos de fonte servidos pelo Google Fonts | Opcional, usado pela UI web |
| `*.assemblyai.com` | Acesso previamente solicitado | Manter por compatibilidade |
| `drakon-solution.com` | Dominio publico Drakon | Necessario conforme ambiente Drakon |
| `www.drakon-solution.com` | Dominio publico Drakon | Necessario conforme ambiente Drakon |
| `perceptrum.ai` | Dominio publico Perceptrum | Necessario conforme ambiente Perceptrum |
| `www.perceptrum.ai` | Dominio publico Perceptrum | Necessario conforme ambiente Perceptrum |
| `auth.perceptrum.ai` | Autenticacao central, se configurada | Necessario se `CENTRAL_AUTH_BASE_URL` usar este host |
| `app.perceptrum.ai` | Origem/app web Perceptrum, se configurado | Opcional conforme ambiente |
| `outlook.com` | Acesso previamente solicitado | Manter por compatibilidade |
| `outlook.live.com` | Acesso previamente solicitado | Manter por compatibilidade |

## Consultas de Endereco e Localizacao

| Dominio | Finalidade | Observacao |
|---|---|---|
| `viacep.com.br` | Consulta de CEP no Brasil | Usado pelo backend para preenchimento de endereco |
| `maps.googleapis.com` | Google Geocoding API | Coberto por `*.googleapis.com`, mas listado explicitamente por clareza |
| `secure.geonames.org` | Consulta postal internacional | Aparece no `origin/main` ja baixado, ainda nao aplicado localmente |

## Billing / Stripe

O aplicativo usa Stripe para checkout, confirmacao de sessao, assinaturas, cartoes e webhooks. Recomenda-se liberar os dominios oficiais da Stripe abaixo.

| Dominio | Finalidade |
|---|---|
| `api.stripe.com` | API Stripe via SDK |
| `checkout.stripe.com` | Checkout hospedado |
| `stripe.com` | Paginas e recursos Stripe |
| `js.stripe.com` | Stripe.js |
| `q.stripe.com` | Telemetria/recursos auxiliares Stripe |
| `m.stripe.com` | Recursos auxiliares Stripe |
| `m.stripe.network` | Recursos auxiliares Stripe |
| `pay.stripe.com` | Pagamentos Stripe |
| `billing.stripe.com` | Billing Stripe |
| `dashboard.stripe.com` | Dashboard Stripe |
| `files.stripe.com` | Arquivos Stripe |
| `*.stripecdn.com` | CDN Stripe |
| `hcaptcha.com` | Verificacao usada por fluxos Stripe |

Recomendacao: se a politica do setor permitir, usar a lista oficial de dominios da Stripe, pois o Checkout hospedado pode carregar recursos auxiliares mantidos pela propria Stripe.

## Recursos de Instalacao, Branding e Ambiente Web

| Dominio | Finalidade | Obrigatoriedade |
|---|---|---|
| `drive.google.com` | Script de download do runtime local de IA | Apenas instalacao/empacotamento, nao fluxo comum do app |
| `getmocha.com` | Origem web/Mocha herdada do projeto | Opcional conforme ambiente web |
| `*.mocha.app` | Origem web/Mocha herdada do projeto | Opcional conforme ambiente web |
| `mocha-cdn.com` | Imagem de metadados/branding web | Opcional conforme ambiente web |

## Rede Local, Cameras e DVRs/NVRs

O aplicativo tambem acessa dispositivos de video em rede local. Estes acessos dependem da configuracao do cliente.

| Destino | Porta/Protocolo | Finalidade |
|---|---|---|
| `127.0.0.1` / `localhost` | TCP 4000 | Backend/UI local |
| IPs/sub-redes das cameras e DVRs/NVRs | TCP/UDP conforme dispositivo | Captura e descoberta |
| IPs/sub-redes das cameras e DVRs/NVRs | RTSP TCP/UDP 554, ou porta RTSP configurada | Video ao vivo |
| IPs/sub-redes das cameras e DVRs/NVRs | HTTP/HTTPS TCP 80/443/8080/8000, conforme dispositivo | ONVIF/ISAPI/probes HTTP |
| `239.255.255.250` | UDP 3702 | WS-Discovery / ONVIF |

## Variaveis e Endpoints Configuraveis

Os seguintes valores podem apontar para dominios externos diferentes conforme ambiente. Se forem usados, o dominio configurado tambem deve ser liberado.

| Configuracao | Finalidade |
|---|---|
| `DRAKON_BASE_URL` | Backend Drakon externo |
| `PERCEPTRUM_BASE_URL` | Backend Perceptrum externo |
| `CENTRAL_AUTH_BASE_URL` | Servico de autenticacao central |
| `R2_PUBLIC_BASE_URL` | URL publica de midia/armazenamento |
| `PGHOST` | Banco PostgreSQL externo, normalmente TCP 5432 |
| `CHATV2_LLM_BASE_URL` | Endpoint LLM local/privado compativel com OpenAI |

## Observacoes de Auditoria

- Nao foram encontradas referencias ativas no codigo local para `aiquimist.ai`, `assemblyai.com`, `oaiusercontent.com`, `outlook.com` ou `outlook.live.com`, mas eles foram mantidos porque constavam na lista anterior solicitada.
- O `perceptrum_desktop_aspp` estava com atualizacoes remotas buscadas no `origin/main`, mas nao aplicadas por conflito com alteracoes locais. A analise considerou o codigo local atual e tambem sinalizou `secure.geonames.org` por aparecer no `origin/main`.
- O aplicativo tambem pode acessar endpoints definidos pelo usuario, como URLs de cameras RTSP/ONVIF, webhooks configurados em jobs e endpoints LLM privados.
