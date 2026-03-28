#include "ExplainAppSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <vector>

#include "../KnowledgeBase.h"
#include "../ProgressUtils.h"
#include "../PromptBuilder.h"

namespace chatv2 {

namespace {

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool containsAny_(const std::string& haystack, const std::vector<std::string>& needles)
{
    for (const auto& needle : needles) {
        if (!needle.empty() && haystack.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

bool hasCameraCreationVerb_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "create", "criar", "add", "adicionar", "register", "registrar",
        "cadastrar", "setup", "configurar", "new camera", "nova camera"
    });
}

bool hasCameraReference_(const std::string& normalized)
{
    return containsAny_(normalized, { "camera", "cameras" });
}

std::string progressLanguage_(const SkillSelection& selection, const nlohmann::json& payload)
{
    if (!selection.replyLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.replyLanguage);
    }
    if (payload.is_object() && payload.contains("app_language") && payload["app_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["app_language"].get<std::string>());
    }
    return "en";
}

std::string knowledgeLanguage_(const SkillSelection& selection)
{
    if (!selection.knowledgeLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.knowledgeLanguage);
    }
    return "en";
}

const KnowledgeBase& knowledgeBase_()
{
    static const KnowledgeBase base;
    return base;
}

std::string chooseTopic_(
    const std::string& query,
    const std::vector<KnowledgeSnippet>& snippets)
{
    const std::string normalized = lowerAsciiCopy_(query);
    if (containsAny_(normalized, {
            "billing", "payment", "payments", "subscription", "tokens",
            "pagamento", "assinatura", "cartao"
        })) {
        return "billing";
    }
    if (containsAny_(normalized, {
            "pair", "pairing", "parear", "emparelhar", "codigo", "exe"
        })) {
        return "pairing";
    }
    if (containsAny_(normalized, {
            "api key", "api keys", "openai", "z.ai", "glm", "chave", "chaves", "settings"
        })) {
        return "api_keys";
    }
    if ((hasCameraCreationVerb_(normalized) && hasCameraReference_(normalized)) ||
        containsAny_(normalized, {
            "create camera", "add camera", "new camera", "register camera", "camera setup",
            "criar camera", "adicionar camera", "nova camera", "cadastrar camera", "configurar camera"
        })) {
        return "camera_creation";
    }
    if (containsAny_(normalized, {
            "camera agent", "camera agents", "agent on camera", "create agent", "custom agent",
            "agente na camera", "agentes na camera", "criar agente", "agente custom"
        })) {
        return "camera_agents";
    }
    if (containsAny_(normalized, {
            "step", "steps", "job step", "workflow step", "step agent",
            "etapa", "etapas", "passo do job", "step do job", "agente do step"
        })) {
        return "job_steps";
    }
    if (containsAny_(normalized, {
            "job", "jobs", "task", "tasks", "tarefa", "tarefas",
            "create job", "job creation", "workflow", "schedule", "scheduled workflow",
            "criar job", "criar tarefa", "agendamento"
        })) {
        return "jobs";
    }
    if (containsAny_(normalized, {
            "tutorial", "how to", "how do i", "como usar", "primeiros passos"
        })) {
        return "tutorial";
    }
    if (!snippets.empty()) {
        return snippets.front().topic;
    }
    return "app_overview";
}

std::string firstNonEmptyExcerpt_(const std::vector<KnowledgeSnippet>& snippets)
{
    for (const auto& snippet : snippets) {
        if (!snippet.excerpt.empty()) {
            return snippet.excerpt;
        }
    }
    return "";
}

std::string fallbackDocumentAnswer_(
    const std::string& topic,
    const std::vector<KnowledgeSnippet>& snippets)
{
    const std::string excerpt = firstNonEmptyExcerpt_(snippets);
    std::ostringstream out;

    if (topic == "billing") {
        out
            << "## Billing\n\n"
            << "- Buy chat tokens.\n"
            << "- Start or manage recurring camera subscriptions.\n"
            << "- Manage saved cards and payment history.\n\n"
            << "### Chat access\n\n"
            << "- Chat and video search are available when the account has an active subscription, token balance, or an active payment method.";
    }
    else if (topic == "pairing") {
        out
            << "## Pairing\n\n"
            << "- Generate a pairing code in Settings.\n"
            << "- The code expires after 10 minutes.\n"
            << "- Use it in the EXE to connect your local machine to the account.\n"
            << "- Settings can show the current pairing status and disconnect the EXE.";
    }
    else if (topic == "api_keys") {
        out
            << "## API Keys\n\n"
            << "- The OpenAI key enables advanced AI features such as chat, agents, and jobs.\n"
            << "- The Z.ai key enables Core mode.\n"
            << "- Both keys are managed in Settings.\n"
            << "- The app should only report whether a key is configured, never the raw secret.";
    }
    else if (topic == "camera_creation") {
        out
            << "## Camera creation\n\n"
            << "- Add the camera in Cameras.\n"
            << "- Fill in the connection details and save.\n"
            << "- Validate the stream and start the local service.\n\n"
            << "### Practical example\n\n"
            << "1. Create a camera named `Front entrance`.\n"
            << "2. Fill in IP, port, username, and password.\n"
            << "3. Save the camera.\n"
            << "4. Start the service so capture, thumbnails, and analysis can run.";
    }
    else if (topic == "camera_agents") {
        out
            << "## Camera agents\n\n"
            << "- A camera agent runs continuously on one specific camera.\n"
            << "- It uses a prompt, alert rules, and capture settings.\n"
            << "- Use it for always-on monitoring outside the chat flow.\n\n"
            << "### Practical example\n\n"
            << "- Create an intrusion agent for the `Parking lot` camera.\n"
            << "- Set an alert condition for people detected after business hours.\n"
            << "- Keep the agent enabled for continuous monitoring.";
    }
    else if (topic == "jobs") {
        out
            << "## Jobs\n\n"
            << "- Jobs are for scheduled or on-demand workflows.\n"
            << "- A job can define schedule, targets, steps, and per-step agents.\n"
            << "- Use jobs when you want repeatable orchestration across one or more cameras.\n\n"
            << "### Practical example\n\n"
            << "- A daily 10:00 PM job can review entry cameras.\n"
            << "- Another hourly job can search for queues, masks, or intrusions.";
    }
    else if (topic == "job_steps") {
        out
            << "## Job steps\n\n"
            << "- Each step is one stage inside the workflow.\n"
            << "- A step defines targets, time window, agents, and alert behavior.\n"
            << "- A simple job may use one step, while a larger workflow may use several.\n\n"
            << "### Practical example\n\n"
            << "1. Step 1 checks the `Entrance`.\n"
            << "2. Step 2 checks the `Parking lot`.\n"
            << "3. Each step gets its own agent, prompt, and alert rule.";
    }
    else if (topic == "tutorial") {
        out
            << "## Quick start\n\n"
            << "1. Generate a pairing code in Settings.\n"
            << "2. Pair the EXE.\n"
            << "3. Add cameras.\n"
            << "4. Configure API keys.\n"
            << "5. Start camera services.\n"
            << "6. Create agents, jobs, or use chat.\n\n"
            << "### Where each area fits\n\n"
            << "- Chat: video search and product help.\n"
            << "- AI Agents: continuous per-camera analysis.\n"
            << "- Jobs: scheduled workflows.";
    }
    else {
        out
            << "## How the app works\n\n"
            << "- The app connects the local EXE to the web dashboard.\n"
            << "- Cameras handle capture and local runtime.\n"
            << "- AI Agents handle continuous analysis.\n"
            << "- Jobs handle scheduled workflows.\n"
            << "- Chat can search video or explain the app.";
    }

    if (!excerpt.empty()) {
        out << "\n\n> " << excerpt;
    }

    return out.str();
}

} // namespace

SkillDefinition ExplainAppSkill::definition() const
{
    return SkillDefinition{
        "explain_app",
        "Explains tutorials, billing, pairing, API keys, and app behavior.",
        true,
    };
}

SkillRunResult ExplainAppSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "explain_app";

    const std::string query =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string progressLanguage = progressLanguage_(selection, payload);
    const std::string knowledgeLanguage = knowledgeLanguage_(selection);

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "explain_app", "loading_knowledge", 2, 2, 4));
    pauseForProgressVisibility();

    const auto& knowledge = knowledgeBase_();
    const auto snippets = knowledge.search(query, knowledgeLanguage, 3);

    std::string topic;
    if (selection.arguments.is_object() &&
        selection.arguments.contains("topic") &&
        selection.arguments["topic"].is_string()) {
        topic = selection.arguments["topic"].get<std::string>();
    }
    if (topic.empty()) {
        topic = chooseTopic_(query, snippets);
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "explain_app", "drafting", 3, 3, 4));
    pauseForProgressVisibility();

    const KnowledgeSnippet document = knowledge.topicDocument(topic, knowledgeLanguage);
    if (!document.content.empty()) {
        result.answer = document.content;
    }
    else {
        result.answer = fallbackDocumentAnswer_(topic, snippets);
    }

    result.metadata["topic"] = topic;
    result.metadata["reply_language"] = selection.replyLanguage.empty()
        ? nlohmann::json(nullptr)
        : nlohmann::json(selection.replyLanguage);
    result.metadata["answer_language"] = document.content.empty()
        ? std::string("en")
        : document.locale;
    result.metadata["knowledge_language"] = document.locale.empty()
        ? knowledgeLanguage
        : document.locale;
    result.metadata["knowledge_language_fallback"] = document.content.empty()
        ? (knowledgeLanguage != "en")
        : document.localeFallback;
    result.metadata["skip_polish"] = !selection.replyLanguage.empty() &&
        !document.content.empty() &&
        document.locale == selection.replyLanguage;
    result.metadata["knowledge_matches"] = nlohmann::json::array();
    for (const auto& snippet : snippets) {
        result.metadata["knowledge_matches"].push_back({
            { "topic", snippet.topic },
            { "title", snippet.title },
            { "excerpt", snippet.excerpt },
            { "locale", snippet.locale },
            { "locale_fallback", snippet.localeFallback },
            { "score", snippet.score },
            { "source_path", snippet.sourcePath.string() },
        });
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "explain_app", "finalizing", 4, 4, 4));
    return result;
}

} // namespace chatv2
