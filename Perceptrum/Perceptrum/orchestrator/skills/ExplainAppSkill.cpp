#include "ExplainAppSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <unordered_set>
#include <vector>

#include "../../core/AgentCore.h"
#include "../../generated/Branding.h"
#include "../ChatModelConfig.h"
#include "../HttpUtils.h"
#include "../KnowledgeBase.h"
#include "../OperationTaskState.h"
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

nlohmann::json defaultTaskState_()
{
    return defaultOperationTaskState();
}

std::string activeBrandName_()
{
    return AppBrand::kDisplayName;
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
        "create", "criar", "crio", "add", "adicionar", "adiciono",
        "register", "registrar", "cadastrar", "setup", "configurar",
        "configuro", "new camera", "nova camera"
    });
}

bool hasCameraReference_(const std::string& normalized)
{
    return containsAny_(normalized, { "camera", "cameras" });
}

bool hasCameraOnboardingCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "scan network", "nvr", "dvr", "webcam", "rtsp", "camera import",
        "import camera", "import cameras", "camera csv", "camera json",
        "camera tsv", "camera excel", "camera plain text", "import csv",
        "import json", "import tsv", "import excel", "import plain text",
        "manufacturer", "fabricante", "channel", "subtype", "retention",
        "retencao", "retenção", "collaborator", "collaborators",
        "share with collaborators", "collaborator sharing", "invite collaborator",
        "invite collaborators", "colaborador", "colaboradores", "collaborateurs",
        "compartilhar com colaboradores", "compartilhamento com colaboradores",
        "compartir con colaboradores", "uso compartido con colaboradores",
        "partage avec des collaborateurs", "partager avec des collaborateurs",
        "cep", "zip code", "postal code"
    });
}

bool hasAgentCreationVerb_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "create", "criar", "crio", "add", "adicionar", "adiciono",
        "setup", "configurar", "configuro", "new agent", "novo agente",
        "new ai agent", "novo ai agent"
    });
}

bool hasAgentReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "agent", "agents", "agente", "agentes", "camera agent",
        "camera agents", "ai agent", "ai agents", "custom agent",
        "custom agents", "agente custom", "agent editor"
    });
}

bool hasStepReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "step", "steps", "job step", "workflow step", "step agent",
        "agent in step", "etapa", "etapas", "agente do step",
        "agente na etapa", "agente na tarefa"
    });
}

bool hasJobReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "job", "jobs", "workflow", "workflows", "task", "tasks",
        "tarefa", "tarefas", "fluxo", "fluxos"
    });
}

bool hasAgentConfigurationCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "prompt core", "alert condition", "video packaging", "input type",
        "snapshot", "snapshots", "polygon", "polygons", "poligono",
        "poligonos", "target", "targets", "face target", "face targets",
        "negative condition", "negative conditions", "negative reference",
        "negative image", "negative images"
    });
}

bool hasJobOrchestrationCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "pipeline", "pipelines", "start condition", "start conditions",
        "start_condition", "elapsed", "validator", "validators",
        "validation step", "step validator", "final step", "step final",
        "workflow orchestration", "job orchestration", "orchestration",
        "multi-step", "multistep", "multi camera", "multicamera",
        "cross camera", "shared output", "shared context",
        "previous step", "previous steps", "conditional branch",
        "branching", "route validation", "cross-check", "correlation",
        "reconciliation", "pipeline_inputs", "on missing input",
        "orquestracao", "orquestracao de jobs", "steps encadeados",
        "validador", "validador final", "multicamera",
        "passar resposta", "resposta de um step no outro",
        "conectar steps", "ligar steps", "encadear", "encadeado",
        "reconciliacao", "correlacao"
    });
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

nlohmann::json loadConversationContext_(
    AgentCore& agent,
    const nlohmann::json& payload)
{
    nlohmann::json fallback = {
        { "compact_context", nlohmann::json::object() },
        { "task_state", defaultTaskState_() },
        { "recent_turns", nlohmann::json::array() },
    };

    if (!payload.is_object()) {
        return fallback;
    }

    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) {
        return fallback;
    }

    const int beforeMessageId = payload.value("context_before_message_id", 0);
    std::ostringstream url;
    url
        << agent.getBackendBaseUrl()
        << "/api/agent/chat-context?client_id=" << agent.getClientId()
        << "&chat_session_id=" << chatSessionId;
    if (beforeMessageId > 0) {
        url << "&before_message_id=" << beforeMessageId;
    }

    const HttpResponse response = getUrl(
        url.str(),
        agent.getExeToken(),
        {},
        3500);
    if (!response.ok()) {
        return fallback;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        return fallback;
    }
    return parsed;
}

void configureExplainModelClient_(LocalLlmClient& llm, const nlohmann::json& payload)
{
    const LocalLlmClient::Config config = buildChatModelClientConfigFromPayload(payload, false);
    if (config.enabled) {
        llm.setRequestOverride(config);
    }
}

std::string extractJsonObject_(const std::string& content)
{
    const std::size_t firstBrace = content.find('{');
    const std::size_t lastBrace = content.rfind('}');
    if (firstBrace == std::string::npos || lastBrace == std::string::npos || lastBrace < firstBrace) {
        return "";
    }
    return content.substr(firstBrace, lastBrace - firstBrace + 1);
}

const std::vector<std::string>& supportedKnowledgeTopics_()
{
    static const std::vector<std::string> topics = {
        "app_overview",
        "tutorial",
        "billing",
        "pairing",
        "api_keys",
        "camera_creation",
        "camera_agents",
        "jobs",
        "job_steps",
        "job_orchestration",
    };
    return topics;
}

std::string sanitizeKnowledgeTopic_(std::string topic)
{
    topic = lowerAsciiCopy_(trimCopy_(std::move(topic)));
    const auto& topics = supportedKnowledgeTopics_();
    return std::find(topics.begin(), topics.end(), topic) != topics.end()
        ? topic
        : std::string();
}

void appendTopicHint_(std::vector<std::string>& topics, const std::string& topic)
{
    const std::string sanitized = sanitizeKnowledgeTopic_(topic);
    if (sanitized.empty()) {
        return;
    }
    if (std::find(topics.begin(), topics.end(), sanitized) != topics.end()) {
        return;
    }
    topics.push_back(sanitized);
}

std::vector<std::string> collectSelectionTopicHints_(const SkillSelection& selection)
{
    std::vector<std::string> topics;
    if (selection.arguments.is_object() &&
        selection.arguments.contains("topic") &&
        selection.arguments["topic"].is_string()) {
        appendTopicHint_(topics, selection.arguments["topic"].get<std::string>());
    }
    for (const auto& topic : selection.supportingTopics) {
        appendTopicHint_(topics, topic);
    }
    if (selection.arguments.is_object() &&
        selection.arguments.contains("supporting_topics") &&
        selection.arguments["supporting_topics"].is_array()) {
        for (const auto& topic : selection.arguments["supporting_topics"]) {
            if (!topic.is_string()) {
                continue;
            }
            appendTopicHint_(topics, topic.get<std::string>());
        }
    }
    return topics;
}

nlohmann::json buildKnowledgePlan_(
    const LocalLlmClient& llm,
    const std::string& query,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection,
    const std::vector<KnowledgeSnippet>& searchMatches)
{
    const std::vector<std::string> topicHints = collectSelectionTopicHints_(selection);
    std::string fallbackPrimary =
        !topicHints.empty()
            ? topicHints.front()
            : (!searchMatches.empty()
                ? sanitizeKnowledgeTopic_(searchMatches.front().topic)
                : std::string("app_overview"));
    if (fallbackPrimary.empty()) {
        fallbackPrimary = "app_overview";
    }

    nlohmann::json fallback = nlohmann::json::object({
        { "primary_topic", fallbackPrimary },
        { "supporting_topics", nlohmann::json::array() },
    });
    for (std::size_t index = 1; index < topicHints.size(); ++index) {
        fallback["supporting_topics"].push_back(topicHints[index]);
    }

    if (!llm.isConfigured()) {
        return fallback;
    }

    nlohmann::json searchPayload = nlohmann::json::array();
    for (const auto& match : searchMatches) {
        searchPayload.push_back({
            { "topic", match.topic },
            { "title", match.title },
            { "locale", match.locale },
            { "excerpt", match.excerpt },
            { "score", match.score },
        });
    }

    nlohmann::json promptPayload = {
        { "user_message", query },
        { "router_mode", selection.mode },
        { "router_entity", selection.entity },
        { "router_intent", selection.intent },
        { "router_topic_hints", topicHints },
        { "conversation_compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultTaskState_()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "search_matches", searchPayload },
        { "available_topics", supportedKnowledgeTopics_() },
    };

    const std::string brandName = activeBrandName_();
    const std::string systemPrompt =
        std::string("/no_think\n")
        + "You choose grounded knowledge topics for the " + brandName + " assistant.\n"
        + "Use meaning, not keywords, to pick the best knowledge topics.\n"
        + "Return JSON only.\n"
        + "Pick exactly one primary_topic from available_topics.\n"
        + "supporting_topics may include up to 3 additional topics from available_topics.\n"
        + "Prefer router_topic_hints when they already fit the user's goal.\n"
        + "Use conversation context only to resolve follow-up references.\n"
        + "If the user is asking for practical product help, keep the plan grounded in the app docs.\n"
        + "Return this schema: {\"primary_topic\":\"camera_creation\",\"supporting_topics\":[\"camera_agents\"]}";

    const auto outcome = llm.completeText(
        "planExplainKnowledge",
        systemPrompt,
        promptPayload.dump(2),
        0.1,
        320,
        16000,
        1,
        true);
    if (!outcome.ok) {
        return fallback;
    }

    const std::string jsonObject = extractJsonObject_(trimCopy_(outcome.content));
    const nlohmann::json parsed = nlohmann::json::parse(
        jsonObject.empty() ? outcome.content : jsonObject,
        nullptr,
        false);
    if (!parsed.is_object()) {
        return fallback;
    }

    nlohmann::json plan = fallback;
    if (parsed.contains("primary_topic") && parsed["primary_topic"].is_string()) {
        const std::string topic = sanitizeKnowledgeTopic_(parsed["primary_topic"].get<std::string>());
        if (!topic.empty()) {
            plan["primary_topic"] = topic;
        }
    }

    if (parsed.contains("supporting_topics") && parsed["supporting_topics"].is_array()) {
        std::vector<std::string> supportingTopics;
        for (const auto& item : parsed["supporting_topics"]) {
            if (!item.is_string()) {
                continue;
            }
            appendTopicHint_(supportingTopics, item.get<std::string>());
            if (supportingTopics.size() >= 3) {
                break;
            }
        }
        plan["supporting_topics"] = supportingTopics;
    }

    return plan;
}

std::vector<KnowledgeSnippet> collectGroundedDocumentsForPlan_(
    const std::string& query,
    const std::string& primaryTopic,
    const std::vector<std::string>& supportingTopics,
    const std::vector<KnowledgeSnippet>& searchMatches,
    const std::string& knowledgeLanguage)
{
    const auto& knowledge = knowledgeBase_();
    std::vector<KnowledgeSnippet> documents;
    std::unordered_set<std::string> seenTopics;

    auto appendDocument = [&](KnowledgeSnippet snippet) {
        if (snippet.topic.empty() || snippet.content.empty()) {
            return;
        }
        if (!seenTopics.insert(snippet.topic).second) {
            return;
        }
        documents.push_back(std::move(snippet));
    };

    if (!primaryTopic.empty()) {
        appendDocument(knowledge.topicDocument(primaryTopic, knowledgeLanguage));
    }

    for (const auto& topic : supportingTopics) {
        appendDocument(knowledge.topicDocument(topic, knowledgeLanguage));
        if (documents.size() >= 5) {
            return documents;
        }
    }

    const auto fallbackMatches =
        searchMatches.empty()
            ? knowledge.search(query, knowledgeLanguage, 6)
            : searchMatches;
    for (const auto& match : fallbackMatches) {
        KnowledgeSnippet document = knowledge.topicDocument(match.topic, knowledgeLanguage);
        if (document.content.empty()) {
            document = match;
        }
        appendDocument(std::move(document));
        if (documents.size() >= 5) {
            break;
        }
    }

    return documents;
}

std::string buildGroundedAnswer_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection,
    const std::string& topic,
    const std::vector<std::string>& supportingTopics,
    const std::vector<KnowledgeSnippet>& documents)
{
    if (!llm.isConfigured() || documents.empty()) {
        return "";
    }

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string replyLanguage = normalizeAssistantLanguageTag(
        selection.replyLanguage.empty()
            ? (payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en"))
            : selection.replyLanguage);
    const std::string appLanguage =
        payload.is_object() ? normalizeAssistantLanguageTag(payload.value("app_language", std::string("en"))) : "en";

    const std::string brandName = activeBrandName_();
    const std::string systemPrompt =
        std::string("/no_think\n")
        + "You are the grounded product assistant for " + brandName + ".\n"
        + "Answer the user using only the provided knowledge_documents and the chat-session context.\n"
        + "Synthesize multiple documents when useful instead of copying a single source.\n"
        + "Use recent_turns, compact_context, and conversation_task_state only to resolve references or follow-up context.\n"
        + "If the user asks how to do something, give practical steps in the app.\n"
        + "If there are multiple valid paths in the docs, compare them briefly and recommend the most likely path.\n"
        + "If the docs do not fully answer the question, say what is clear and then ask one short clarifying question only if it is truly needed.\n"
        + "If you need to name the product, use \"" + brandName + "\" only.\n"
        + "Never mention other product or brand names.\n"
        + "Do not invent UI labels, buttons, flows, settings, or capabilities that are not supported by the knowledge_documents.\n"
        + "Do not mention source files, internal tools, payloads, or implementation details.\n"
        + "Write the final answer directly in reply_language.\n"
        + "Output only the final Markdown answer.\n";

    nlohmann::json docsPayload = nlohmann::json::array();
    for (const auto& document : documents) {
        docsPayload.push_back({
            { "topic", document.topic },
            { "title", document.title },
            { "locale", document.locale },
            { "locale_fallback", document.localeFallback },
            { "source_path", document.sourcePath.string() },
            { "content", document.content },
        });
    }

    nlohmann::json promptPayload = {
        { "user_message", userMessage },
        { "selected_topic", topic },
        { "supporting_topics", supportingTopics },
        { "reply_language", replyLanguage },
        { "knowledge_language", knowledgeLanguage_(selection) },
        { "app_language", appLanguage },
        { "conversation_compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultTaskState_()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "knowledge_documents", docsPayload },
    };

    const auto outcome = llm.completeText(
        "groundedExplainApp",
        systemPrompt,
        promptPayload.dump(2),
        0.2,
        1400,
        20000,
        1,
        false);
    if (!outcome.ok) {
        return "";
    }

    return trimCopy_(outcome.content);
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
            << "- Cameras can be registered from AI Agents or Cameras.\n"
            << "- The easiest paths are Scan Network, file import, or manual registration.\n"
            << "- File import supports Excel, CSV, JSON, TSV, and plain text.\n"
            << "- Manual registration lets the user choose RTSP/IP camera or Webcam.\n"
            << "- RTSP/IP uses fields such as name, IP, port, manufacturer, username, password, channel, and subtype.\n"
            << "- Webcam usually only needs name and webcam index, plus the shared fields.\n"
            << "- Both flows include address, retention, and collaborator sharing.\n\n"
            << "### Practical example\n\n"
            << "1. Open AI Agents or Cameras.\n"
            << "2. Use Scan Network if the device is already on the network.\n"
            << "3. If needed, register manually as RTSP/IP camera or Webcam.\n"
            << "4. Save the camera and start the service so capture, thumbnails, and analysis can run.";
    }
    else if (topic == "camera_agents") {
        out
            << "## Camera agents\n\n"
            << "- There are two places to create agent logic: AI Agents and Jobs / Steps.\n"
            << "- AI Agents are for continuous monitoring on one camera.\n"
            << "- Jobs / Steps are for scheduled or multi-camera workflows.\n"
            << "- The minimum fields are Name, Prompt core, and Alert condition.\n"
            << "- Advanced options include targets, face targets, negative conditions, negative reference images, model choice, video packaging, input type, and polygons.\n\n"
            << "### Practical example\n\n"
            << "- Create an intrusion watcher in AI Agents for the `Parking lot` camera when the goal is continuous monitoring.\n"
            << "- Create the same logic inside a job step when the agent must follow a schedule or coordinate with other cameras.";
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
    else if (topic == "job_orchestration") {
        out
            << "## Job orchestration\n\n"
            << "- Use Jobs / Steps when the workflow must coordinate multiple cameras, multiple stages, timing rules, or final validation.\n"
            << "- Separate collector steps from decision steps.\n"
            << "- Use Start Condition to control when each step begins.\n"
            << "- Use Pipeline to inject previous answers into later steps.\n"
            << "- Keep upstream answers deterministic so downstream validators can parse them.\n"
            << "- Place the final alert on the step that owns the final business rule.\n\n"
            << "### Typical patterns\n\n"
            << "- Parallel collectors plus final validator.\n"
            << "- Sequential route validation.\n"
            << "- Conditional investigation triggered by a previous step.\n"
            << "- Many-to-one consolidation from multiple steps into one final decision.";
    }
    else if (topic == "job_steps") {
        out
            << "## Job steps\n\n"
            << "- Each step is one stage inside the workflow.\n"
            << "- To create an agent in a workflow, create the step first and add the camera as a target.\n"
            << "- The step agent uses the same core fields as AI Agents: Name, Prompt core, and Alert condition.\n"
            << "- It can also use targets, face targets, negative guidance, model choice, video packaging, input type, and polygons.\n\n"
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
    const std::string replyLanguage = normalizeAssistantLanguageTag(
        selection.replyLanguage.empty()
            ? (payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en"))
            : selection.replyLanguage);
    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    LocalLlmClient llm;
    configureExplainModelClient_(llm, payload);

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "explain_app", "loading_knowledge", 2, 2, 4));
    pauseForProgressVisibility();

    const auto& knowledge = knowledgeBase_();
    const auto searchMatches = knowledge.search(query, knowledgeLanguage, 6);
    const nlohmann::json knowledgePlan = buildKnowledgePlan_(
        llm,
        query,
        conversationContext,
        selection,
        searchMatches);
    std::string topic =
        knowledgePlan.contains("primary_topic") && knowledgePlan["primary_topic"].is_string()
            ? sanitizeKnowledgeTopic_(knowledgePlan["primary_topic"].get<std::string>())
            : std::string();
    if (topic.empty()) {
        topic = "app_overview";
    }
    std::vector<std::string> supportingTopics;
    if (knowledgePlan.contains("supporting_topics") &&
        knowledgePlan["supporting_topics"].is_array()) {
        for (const auto& item : knowledgePlan["supporting_topics"]) {
            if (!item.is_string()) {
                continue;
            }
            appendTopicHint_(supportingTopics, item.get<std::string>());
            if (supportingTopics.size() >= 3) {
                break;
            }
        }
    }
    const std::vector<KnowledgeSnippet> documents = collectGroundedDocumentsForPlan_(
        query,
        topic,
        supportingTopics,
        searchMatches,
        knowledgeLanguage);

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "explain_app", "drafting", 3, 3, 4));
    pauseForProgressVisibility();

    const KnowledgeSnippet primaryDocument = knowledge.topicDocument(topic, knowledgeLanguage);
    const KnowledgeSnippet resolvedDocument =
        !primaryDocument.content.empty()
            ? primaryDocument
            : (!documents.empty() ? documents.front() : KnowledgeSnippet{});
    bool usedGroundedAnswer = false;
    result.answer = buildGroundedAnswer_(
        llm,
        payload,
        conversationContext,
        selection,
        topic,
        supportingTopics,
        documents);
    if (!result.answer.empty()) {
        usedGroundedAnswer = true;
        result.metadata["skip_polish"] = true;
        result.metadata["grounded"] = true;
    }
    else if (!primaryDocument.content.empty()) {
        result.answer = primaryDocument.content;
        result.metadata["grounded"] = true;
    }
    else if (!documents.empty()) {
        result.answer = documents.front().content;
        result.metadata["grounded"] = true;
    }
    else {
        result.answer = fallbackDocumentAnswer_(topic, searchMatches);
        result.metadata["grounded"] = false;
    }

    result.metadata["topic"] = topic;
    result.metadata["supporting_topics"] = supportingTopics;
    result.metadata["reply_language"] = replyLanguage;
    result.metadata["answer_language"] = usedGroundedAnswer
        ? replyLanguage
        : (resolvedDocument.content.empty() ? std::string("en") : resolvedDocument.locale);
    result.metadata["knowledge_language"] = resolvedDocument.locale.empty()
        ? knowledgeLanguage
        : resolvedDocument.locale;
    result.metadata["knowledge_language_fallback"] = resolvedDocument.content.empty()
        ? (knowledgeLanguage != "en")
        : resolvedDocument.localeFallback;
    if (!result.metadata.contains("skip_polish")) {
        result.metadata["skip_polish"] = !selection.replyLanguage.empty() &&
            !resolvedDocument.content.empty() &&
            resolvedDocument.locale == selection.replyLanguage;
    }
    result.metadata["knowledge_matches"] = nlohmann::json::array();
    const auto appendKnowledgeMatch = [&](const KnowledgeSnippet& snippet) {
        result.metadata["knowledge_matches"].push_back({
            { "topic", snippet.topic },
            { "title", snippet.title },
            { "excerpt", snippet.excerpt },
            { "locale", snippet.locale },
            { "locale_fallback", snippet.localeFallback },
            { "score", snippet.score },
            { "source_path", snippet.sourcePath.string() },
        });
    };
    if (!documents.empty()) {
        for (const auto& snippet : documents) {
            appendKnowledgeMatch(snippet);
        }
    }
    else {
        for (const auto& snippet : searchMatches) {
            appendKnowledgeMatch(snippet);
        }
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "explain_app", "finalizing", 4, 4, 4));
    return result;
}

} // namespace chatv2
