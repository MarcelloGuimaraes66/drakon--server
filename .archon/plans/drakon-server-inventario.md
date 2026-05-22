# Inventario do repositorio drakon-server

Data da leitura: 2026-05-21

## Identificacao

- Diretorio local: `/home/marcello-guimaraes/dev/drakon-server`
- Repositorio remoto esperado: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
- `origin` configurado: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
- Branch ativa no repositorio raiz: `main`
- Estado Git no repositorio raiz: `No commits yet on main`
- Arquivos/diretorios nao rastreados no repositorio raiz:
  - `.archon/`
  - `.gitignore`
  - `CMakeLists.txt`
  - `README.md`
  - `drakon-server/`

## Observacao sobre conexao Git

O repositorio raiz esta inicializado e possui `origin` apontando para o URL informado. O comando `git ls-remote origin` nao retornou refs, indicando que o remoto esta acessivel mas sem branches/tags publicados ou sem refs visiveis neste momento.

Existe tambem um diretorio aninhado `drakon-server/` contendo outro `.git`. Esse repositorio aninhado esta na branch `main`, sem commits, com `origin` igual ao mesmo URL e status `origin/main [gone]`. Ele nao contem arquivos de projeto alem do proprio `.git`.

## Arvore principal

```text
.
|-- .archon/
|   |-- plans/
|   `-- prompts/
|       `-- prompt-0-ler-e-conectar-drakon-server.txt
|-- .gitignore
|-- CMakeLists.txt
|-- README.md
|-- config/
|-- data/
|   |-- alerts/
|   |-- events/
|   |-- frames/
|   |-- indexes/
|   |-- inference/
|   `-- logs/
|-- docs/
|-- drakon-server/
|   `-- .git/
|-- include/
|   `-- drakon/
|-- runtime/
|-- scripts/
|-- src/
`-- tests/
```

## Linguagem, build system e dependencias

- Linguagem configurada: C++.
- Padrao configurado: C++23.
- Build system: CMake, versao minima `3.22`.
- Target configurado: executavel `drakon-server`.
- Arquivo de entrada configurado: `src/main.cpp`.
- Includes configurados: `include/`.
- Flags de compilacao: `-Wall`, `-Wextra`, `-Wpedantic`.
- Test runner previsto: CTest via `enable_testing()` e `add_test`.
- Dependencias externas declaradas no CMake atual: nenhuma.
- Dependencias esperadas pelo produto, ainda nao declaradas: FFmpeg/libav, OpenCV, SQLite, PostgreSQL/libpqxx ou libpq, JSON, RTSP/ONVIF, systemd packaging.

## Presenca dos diretorios esperados

- `CMakeLists.txt`: existe.
- `src/`: existe, mas esta vazio.
- `include/`: existe.
- `include/drakon/`: existe, mas esta vazio.
- `config/`: existe, mas esta vazio.
- `scripts/`: existe, mas esta vazio.
- `docs/`: existe, mas esta vazio.
- `tests/`: existe, mas esta vazio.
- `data/`: existe com subdiretorios de runtime vazios.
- `runtime/`: existe, mas esta vazio.

## Comandos existentes de build e teste

O `CMakeLists.txt` sugere estes comandos:

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

Testes CTest registrados:

- `drakon_server_help`: executa `drakon-server --help`.
- `drakon_server_version`: executa `drakon-server version`.
- `drakon_server_validate_config`: executa `drakon-server validate-config --config config/cameras.example.json`.

Esses comandos ainda nao devem passar porque `src/main.cpp` e `config/cameras.example.json` nao existem.

## Implementado hoje

- Identidade inicial do projeto em `README.md`.
- Estrutura de diretorios prevista para saida em `data/`.
- Esqueleto de build CMake.
- Esqueleto de testes CTest.
- `.gitignore` com exclusoes para build, runtime data, configs locais e secrets.

## Placeholders e lacunas

- CLI ainda nao implementada.
- `src/main.cpp` ausente, apesar de ser referenciado pelo CMake.
- Headers publicos ou internos ausentes em `include/drakon/`.
- Config exemplo `config/cameras.example.json` ausente, apesar de ser usado por teste.
- Nenhum parser JSON configurado.
- Nenhum modulo de config, storage, captura RTSP, inferencia, alertas ou JSONL implementado.
- Nenhum script operacional.
- Nenhuma documentacao tecnica em `docs/`.
- Nenhum teste unitario ou de integracao real em `tests/`.
- Empacotamento `.deb` e servico `systemd` ausentes.
- Diretorio `drakon-server/` aninhado contem outro repositorio Git vazio e deve ser tratado antes do primeiro commit para evitar confusao ou submodule acidental.
