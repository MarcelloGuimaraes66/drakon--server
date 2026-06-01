# ChatV2 Local LLM Runtime

`chatv2` can now start a local OpenAI-compatible runtime for the orchestrator model.

## Recommended local layout

For local development in this repository:

```text
C:\dev\Workspace\Perceptrum\.local\llm\
  bin\
    llama-server.exe
  models\
    chatv2\
      <your-qwen-gguf-file>.gguf
```

For an installed app, the runtime can also live beside the EXE under:

```text
<exe-folder>\llm\
  bin\llama-server.exe
  models\chatv2\<your-qwen-gguf-file>.gguf
```

## Files to download

1. `llama-server.exe`
   - Source: official `llama.cpp` Windows release.
   - Place it in:
     - `C:\dev\Workspace\Perceptrum\.local\llm\bin\llama-server.exe`

2. One compatible Qwen3 4B GGUF model for CPU inference
   - Preferred target for chatv2: `Qwen3-4B-Instruct-2507` in `Q4_K_M` if you have that GGUF.
   - Compatible fallback: `Qwen3-4B` GGUF in `Q4_K_M`.
   - Place the `.gguf` file in:
     - `C:\dev\Workspace\Perceptrum\.local\llm\models\chatv2\`

The runtime auto-detects the first `.gguf` file in `models\chatv2` when
`chatv2_llm_model_path.txt` is not provided.

## Optional config files

These files can be placed in the solution root `C:\dev\Workspace\Perceptrum\`
or beside the EXE. Each file contains a single line.

- `chatv2_llm_server_path.txt`
  - Absolute path to `llama-server.exe`
- `chatv2_llm_model_path.txt`
  - Absolute path to the GGUF model file
- `chatv2_llm_base_url.txt`
  - External OpenAI-compatible endpoint, for example `http://127.0.0.1:11435`
- `chatv2_llm_port.txt`
  - Port for the managed local runtime. Default: `11435`
- `chatv2_llm_threads.txt`
  - CPU thread count for `llama-server`
- `chatv2_llm_ctx_size.txt`
  - Context size. Default: `4096`
- `chatv2_llm_startup_timeout_ms.txt`
  - Startup healthcheck timeout. Default: `30000`
- `chatv2_llm_autostart.txt`
  - `true` or `false`. Default: `true`
- `chatv2_llm_require.txt`
  - `true` forces chatv2 to require the local model instead of falling back to heuristics
- `chatv2_llm_model.txt`
  - Model identifier sent to the OpenAI-compatible endpoint. Default: `Qwen3-4B-Instruct-2507`
- `chatv2_shadow_enabled.txt`
  - `true` or `false`. Default: `true`. When enabled, legacy `chat_query` still uses the current pipeline, but chatv2 also routes the same request in shadow mode and stores telemetry.

## Knowledge files

`explain_app` loads local markdown files from `orchestrator\knowledge\`.

- `app_overview.md`
- `tutorial.md`
- `billing.md`
- `pairing.md`
- `api_keys.md`

## Current behavior

- If a healthy local runtime is available, chatv2 asks the model to pick the skill.
- If `chatv2_llm_require.txt` is `true` and the runtime is unavailable, chatv2 returns a clear error message.
- If `chatv2_llm_require.txt` is `false`, chatv2 can still fall back to heuristics for phase 1 compatibility.
- `read_state` now reads live aggregated state from the worker.
- `explain_app` now answers from the local `knowledge` folder.
- Shadow routing telemetry is stored in `chat_v2_routing_events`.
