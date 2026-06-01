#include "RoutingLexicon.h"

#include <algorithm>
#include <cctype>
#include <utility>

namespace chatv2 {

namespace {

using json = nlohmann::json;

const json& lexicon_()
{
    static const json kLexicon = json::parse(R"json(
{
  "semantic_rules": {
    "task_alias_maps_to_entity": "job",
    "workflow_alias_maps_to_entity": "job",
    "pause_alias_maps_to_runtime_action": "stop",
    "agent_plus_step_alias_prefers": "camera_agent"
  },
  "entities": {
    "camera": [
      "camera", "cameras", "camara", "camaras", "telecamera", "telecameras",
      "telecamara", "telecamaras", "\u6443\u50cf\u5934", "\u76f8\u673a",
      "\u76d1\u63a7", "\u0643\u0627\u0645\u064a\u0631\u0627", "\u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627"
    ],
    "job": [
      "job", "jobs", "task", "tasks", "workflow", "workflows", "routine",
      "routines", "flow", "flows", "tarefa", "tarefas", "rotina", "rotinas",
      "fluxo", "fluxos", "tarea", "tareas", "trabajo", "trabajos",
      "flujo de trabajo", "tache", "taches", "flux de travail",
      "\u4efb\u52a1", "\u5de5\u4f5c\u6d41", "\u5de5\u5355",
      "\u0645\u0647\u0645\u0629", "\u0645\u0647\u0627\u0645",
      "\u0648\u0638\u064a\u0641\u0629", "\u0648\u0638\u0627\u0626\u0641", "\u0633\u064a\u0631 \u0639\u0645\u0644"
    ],
    "camera_agent": [
      "agent", "agents", "ai agent", "ai agents", "camera agent",
      "camera agents", "agente", "agentes", "agente ai", "agente de camera",
      "agente da camera", "agente de camara", "agente ia", "agente de ia",
      "agente intelligent", "\u667a\u80fd\u4f53", "\u4ee3\u7406",
      "\u4ee3\u7406\u4f53", "\u0648\u0643\u064a\u0644", "\u0648\u0643\u0644\u0627\u0621",
      "\u0648\u0643\u064a\u0644 \u0630\u0643\u064a"
    ],
    "step": [
      "step", "steps", "job step", "workflow step", "etapa", "etapas",
      "paso", "pasos", "etape", "etapes", "\u6b65\u9aa4", "\u9636\u6bb5",
      "\u0645\u0631\u062d\u0644\u0629", "\u062e\u0637\u0648\u0629"
    ]
  },
  "actions": {
    "create": [
      "create", "add", "setup", "build", "schedule", "register", "criar",
      "adicionar", "configurar", "montar", "agendar", "programar", "crear",
      "agregar", "programa", "configurer", "ajouter", "planifier",
      "\u521b\u5efa", "\u65b0\u5efa", "\u5efa\u7acb", "\u5b89\u6392",
      "\u0623\u0646\u0634\u0626", "\u0627\u0646\u0634\u0626",
      "\u0623\u0636\u0641", "\u0627\u0636\u0641", "\u062c\u062f\u0648\u0644"
    ],
    "edit": [
      "edit", "update", "change", "rename", "modify", "adjust", "editar",
      "alterar", "atualizar", "trocar", "renomear", "mudar", "actualizar",
      "cambiar", "modificar", "renombrar", "modifier", "mettre a jour",
      "changer", "renommer", "\u7f16\u8f91", "\u4fee\u6539",
      "\u66f4\u65b0", "\u91cd\u547d\u540d", "\u062d\u0631\u0631",
      "\u0639\u062f\u0644", "\u0639\u062f\u0651\u0644",
      "\u063a\u064a\u0631", "\u063a\u064a\u0651\u0631", "\u062d\u062f\u062b",
      "\u0623\u0639\u062f \u062a\u0633\u0645\u064a\u0629", "\u0627\u0639\u062f \u062a\u0633\u0645\u064a\u0629"
    ],
    "start": [
      "start", "run", "begin", "launch", "resume", "enable", "iniciar",
      "inicia", "inicie", "comecar", "comece", "rodar", "rode", "ligar",
      "ligue", "startar", "empezar", "ejecutar", "ejecuta", "arrancar",
      "demarrer", "demarre", "lancer", "reprendre", "\u542f\u52a8",
      "\u5f00\u59cb", "\u8fd0\u884c", "\u5f00\u542f", "\u0627\u0628\u062f\u0623",
      "\u0623\u0628\u062f\u0623", "\u0634\u063a\u0644", "\u0634\u063a\u0651\u0644",
      "\u062a\u0634\u063a\u064a\u0644"
    ],
    "stop": [
      "stop", "pause", "halt", "disable", "end", "finish", "parar", "pare",
      "pausar", "pausa", "desligar", "desligue", "stopar", "detener",
      "deten", "apagar", "arreter", "stopper", "\u6682\u505c",
      "\u505c\u6b62", "\u5173\u95ed", "\u0623\u0648\u0642\u0641",
      "\u0627\u0648\u0642\u0641", "\u0625\u064a\u0642\u0627\u0641",
      "\u062a\u0648\u0642\u064a\u0641", "\u0623\u0648\u0642\u0641 \u0627\u0644\u062a\u0634\u063a\u064a\u0644",
      "\u0627\u0648\u0642\u0641 \u0627\u0644\u062a\u0634\u063a\u064a\u0644"
    ],
    "read": [
      "show", "list", "see", "view", "mostrar", "listar", "ver", "mostra",
      "lister", "voir", "\u67e5\u770b", "\u5217\u51fa", "\u663e\u793a",
      "\u0627\u0639\u0631\u0636", "\u0623\u0638\u0647\u0631", "\u0642\u0627\u0626\u0645\u0629"
    ]
  }
}
)json");
    return kLexicon;
}

std::string trimCopy_(std::string value)
{
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

std::string normalizeInlineWhitespace_(std::string value)
{
    std::string normalized;
    normalized.reserve(value.size());

    bool lastWasSpace = false;
    for (unsigned char ch : value) {
        if (std::isspace(ch) != 0) {
            if (!normalized.empty() && !lastWasSpace) {
                normalized.push_back(' ');
            }
            lastWasSpace = true;
            continue;
        }
        normalized.push_back(static_cast<char>(ch));
        lastWasSpace = false;
    }
    return trimCopy_(std::move(normalized));
}

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool isAsciiOnly_(const std::string& value)
{
    return std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return ch <= 0x7f;
    });
}

bool isBoundaryChar_(char ch)
{
    return std::isalnum(static_cast<unsigned char>(ch)) == 0;
}

bool containsWholePhrase_(const std::string& haystack, const std::string& needle)
{
    if (needle.empty()) {
        return false;
    }

    std::size_t pos = haystack.find(needle);
    while (pos != std::string::npos) {
        const std::size_t endPos = pos + needle.size();
        const bool startOk = pos == 0 || isBoundaryChar_(haystack[pos - 1]);
        const bool endOk = endPos >= haystack.size() || isBoundaryChar_(haystack[endPos]);
        if (startOk && endOk) {
            return true;
        }
        pos = haystack.find(needle, pos + 1);
    }
    return false;
}

bool containsAlias_(
    const std::string& rawNormalized,
    const std::string& asciiNormalized,
    const std::string& alias)
{
    const std::string normalizedAlias = normalizeInlineWhitespace_(trimCopy_(alias));
    if (normalizedAlias.empty()) {
        return false;
    }

    if (isAsciiOnly_(normalizedAlias)) {
        return containsWholePhrase_(asciiNormalized, lowerAsciiCopy_(normalizedAlias));
    }
    return rawNormalized.find(normalizedAlias) != std::string::npos;
}

void markEntitySignal_(RoutingLexiconSignals& signals, const std::string& entity)
{
    if (entity == "camera") {
        signals.mentionsCamera = true;
    }
    else if (entity == "job") {
        signals.mentionsJob = true;
    }
    else if (entity == "camera_agent") {
        signals.mentionsCameraAgent = true;
    }
    else if (entity == "step") {
        signals.mentionsStep = true;
    }
}

void markActionSignal_(RoutingLexiconSignals& signals, const std::string& action)
{
    if (action == "create") {
        signals.wantsCreate = true;
    }
    else if (action == "edit") {
        signals.wantsEdit = true;
    }
    else if (action == "start") {
        signals.wantsStart = true;
    }
    else if (action == "stop") {
        signals.wantsStop = true;
    }
    else if (action == "read") {
        signals.wantsRead = true;
    }
}

void scanGroups_(
    RoutingLexiconSignals& signals,
    const std::string& rawNormalized,
    const std::string& asciiNormalized,
    const json& groups,
    bool entityGroups)
{
    if (!groups.is_object()) {
        return;
    }

    for (auto it = groups.begin(); it != groups.end(); ++it) {
        if (!it.value().is_array()) {
            continue;
        }
        for (const auto& aliasNode : it.value()) {
            if (!aliasNode.is_string()) {
                continue;
            }
            if (!containsAlias_(rawNormalized, asciiNormalized, aliasNode.get<std::string>())) {
                continue;
            }
            if (entityGroups) {
                markEntitySignal_(signals, it.key());
            }
            else {
                markActionSignal_(signals, it.key());
            }
            break;
        }
    }
}

} // namespace

const json& routingLexicon()
{
    return lexicon_();
}

RoutingLexiconSignals detectRoutingLexiconSignals(const std::string& userMessage)
{
    const std::string rawNormalized = normalizeInlineWhitespace_(trimCopy_(userMessage));
    const std::string asciiNormalized = lowerAsciiCopy_(rawNormalized);

    RoutingLexiconSignals signals;
    const json& lexicon = lexicon_();
    scanGroups_(signals, rawNormalized, asciiNormalized, lexicon.value("entities", json::object()), true);
    scanGroups_(signals, rawNormalized, asciiNormalized, lexicon.value("actions", json::object()), false);
    return signals;
}

std::string runtimeActionFromRoutingSignals(const RoutingLexiconSignals& signals)
{
    if (signals.wantsStart == signals.wantsStop) {
        return "";
    }
    return signals.wantsStart ? "start" : "stop";
}

} // namespace chatv2
