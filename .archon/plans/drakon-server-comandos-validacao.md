# Comandos de validacao do drakon-server

## Comandos executados nesta leitura

```bash
git branch --show-current
git remote -v
git status --short --branch
git config --get remote.origin.url
git rev-parse --show-toplevel
git rev-parse --is-inside-work-tree
git ls-remote origin
git log --oneline --decorate --all --max-count=20
rg --files -g '!.git' -g '!drakon-server/.git'
find . -path './.git' -prune -o -path './drakon-server/.git' -prune -o -type d -print | sort
find . -path './.git' -prune -o -path './drakon-server/.git' -prune -o -type f -print | sort
find src include config scripts docs tests -maxdepth 3 -type f | sort
git -C drakon-server status --short --branch
git -C drakon-server remote -v
git -C drakon-server branch --show-current
git -C drakon-server log --oneline --decorate --all --max-count=20
```

## Resultado resumido

- Branch ativa no repositorio raiz: `main`.
- Remote origin no repositorio raiz: `https://github.com/MarcelloGuimaraes66/drakon--server.git`.
- Git status raiz: `No commits yet on main`, com arquivos nao rastreados.
- `git ls-remote origin`: nao retornou refs.
- Repositorio aninhado: `drakon-server/.git`, branch `main`, sem commits, `origin/main [gone]`.
- Build ainda nao validado porque o projeto referencia arquivos ausentes.

## Comandos de build previstos

Rodar depois que `src/main.cpp` e `config/cameras.example.json` existirem:

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

## Comandos de CLI previstos

Rodar depois da Fase 1:

```bash
./build/drakon-server --help
./build/drakon-server version
./build/drakon-server validate-config --config config/cameras.example.json
./build/drakon-server list-cameras --config config/cameras.example.json
```

## Comandos de verificacao Git antes do primeiro commit

```bash
git status --short --branch
git remote -v
git ls-remote origin
find drakon-server -maxdepth 2 -print
```

## Comandos para validacao de runtime futuro

Depois das fases de runtime e captura:

```bash
./build/drakon-server validate-config --config config/cameras.example.json
./build/drakon-server run --config config/cameras.example.json --dry-run
./build/drakon-server capture --config config/cameras.example.json --camera CAMERA_ID --frames 3
find data -maxdepth 6 -type f | sort
test -f data/indexes/frames.jsonl
test -f data/indexes/events.jsonl
test -f data/indexes/alerts.jsonl
```

## Pacotes apt possivelmente necessarios no futuro

Nenhum pacote apt foi instalado nesta leitura. Quando chegar a fase de dependencias nativas, os comandos deverao ser revisados antes de executar. Candidatos provaveis:

```bash
sudo apt update
sudo apt install -y build-essential cmake pkg-config
sudo apt install -y libsqlite3-dev
sudo apt install -y libavcodec-dev libavformat-dev libavutil-dev libswscale-dev
sudo apt install -y libopencv-dev
sudo apt install -y libpq-dev
```

Conforme a regra do prompt, qualquer instalacao apt deve parar antes da execucao e informar exatamente o comando.
