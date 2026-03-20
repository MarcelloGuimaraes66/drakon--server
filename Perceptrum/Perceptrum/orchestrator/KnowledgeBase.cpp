#include "KnowledgeBase.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <unordered_set>

#include "ConfigUtils.h"
#include "PromptBuilder.h"

namespace chatv2 {

namespace fs = std::filesystem;

namespace {

struct TopicSeed {
    const char* topic;
    const char* title;
    const char* fileName;
    std::vector<std::string> aliases;
};

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::vector<std::string> tokenize_(const std::string& text)
{
    std::vector<std::string> tokens;
    std::string current;
    std::unordered_set<std::string> seen;

    for (unsigned char ch : text) {
        if (std::isalnum(ch) != 0) {
            current.push_back(static_cast<char>(std::tolower(ch)));
            continue;
        }

        if (current.size() >= 2 && seen.insert(current).second) {
            tokens.push_back(current);
        }
        current.clear();
    }

    if (current.size() >= 2 && seen.insert(current).second) {
        tokens.push_back(current);
    }

    return tokens;
}

double countOccurrences_(const std::string& haystack, const std::string& needle)
{
    if (needle.empty()) return 0.0;

    double count = 0.0;
    std::size_t offset = 0;
    while (offset < haystack.size()) {
        const std::size_t found = haystack.find(needle, offset);
        if (found == std::string::npos) break;
        count += 1.0;
        offset = found + needle.size();
    }
    return count;
}

double scoreText_(const std::string& text, const std::vector<std::string>& tokens)
{
    if (text.empty() || tokens.empty()) return 0.0;

    const std::string normalized = lowerAsciiCopy_(text);
    double score = 0.0;
    for (const auto& token : tokens) {
        if (token.empty()) continue;
        const double occurrences = countOccurrences_(normalized, token);
        score += (std::min)(occurrences, 4.0);
    }
    return score;
}

std::string collapseWhitespace_(const std::string& text)
{
    std::ostringstream out;
    bool previousWasSpace = false;
    for (unsigned char ch : text) {
        if (std::isspace(ch) != 0) {
            if (!previousWasSpace) {
                out << ' ';
            }
            previousWasSpace = true;
            continue;
        }

        out << static_cast<char>(ch);
        previousWasSpace = false;
    }
    return trimCopy(out.str());
}

std::vector<std::string> splitParagraphs_(const std::string& content)
{
    std::vector<std::string> paragraphs;
    std::istringstream input(content);
    std::string line;
    std::ostringstream current;

    while (std::getline(input, line)) {
        if (!line.empty() && line[0] == '#') {
            if (!trimCopy(current.str()).empty()) {
                paragraphs.push_back(trimCopy(current.str()));
                current.str("");
                current.clear();
            }
            continue;
        }

        if (trimCopy(line).empty()) {
            if (!trimCopy(current.str()).empty()) {
                paragraphs.push_back(trimCopy(current.str()));
                current.str("");
                current.clear();
            }
            continue;
        }

        if (current.tellp() > 0) {
            current << '\n';
        }
        current << line;
    }

    if (!trimCopy(current.str()).empty()) {
        paragraphs.push_back(trimCopy(current.str()));
    }

    return paragraphs;
}

std::string truncateWithEllipsis_(const std::string& text, std::size_t maxLength)
{
    if (text.size() <= maxLength) {
        return text;
    }

    if (maxLength <= 3) {
        return text.substr(0, maxLength);
    }

    return trimCopy(text.substr(0, maxLength - 3)) + "...";
}

std::string selectExcerpt_(
    const std::string& content,
    const std::vector<std::string>& tokens)
{
    const auto paragraphs = splitParagraphs_(content);
    if (paragraphs.empty()) {
        return "";
    }

    double bestScore = -1.0;
    std::string bestParagraph;
    for (const auto& paragraph : paragraphs) {
        const double score = scoreText_(paragraph, tokens);
        if (score > bestScore) {
            bestScore = score;
            bestParagraph = paragraph;
        }
    }

    if (bestParagraph.empty()) {
        bestParagraph = paragraphs.front();
    }

    return truncateWithEllipsis_(collapseWhitespace_(bestParagraph), 280);
}

std::vector<fs::path> buildKnowledgeDirectoryCandidates_()
{
    std::vector<fs::path> candidates;
    for (const auto& root : buildConfigSearchRoots()) {
        candidates.push_back(root / "knowledge");
        candidates.push_back(root / "orchestrator" / "knowledge");
    }
    return candidates;
}

std::vector<std::string> buildKnowledgeLocaleCandidates_()
{
    return { "en", "es", "pt", "fr", "zh", "ar" };
}

std::string normalizeKnowledgeLocale_(const std::string& locale)
{
    return normalizeAssistantLanguageTag(locale);
}

fs::path findKnowledgeDocumentPath_(
    const std::vector<fs::path>& directories,
    const std::string& locale,
    const std::string& fileName)
{
    for (const auto& directory : directories) {
        const fs::path nestedCandidate = directory / locale / fileName;
        std::error_code ec;
        if (fs::exists(nestedCandidate, ec) && fs::is_regular_file(nestedCandidate, ec)) {
            return nestedCandidate;
        }

        const fs::path suffixedCandidate = directory / (fs::path(fileName).stem().string() + "." + locale + ".md");
        if (fs::exists(suffixedCandidate, ec) && fs::is_regular_file(suffixedCandidate, ec)) {
            return suffixedCandidate;
        }
    }

    return fs::path();
}

fs::path findLegacyKnowledgeDocumentPath_(
    const std::vector<fs::path>& directories,
    const std::string& fileName)
{
    for (const auto& directory : directories) {
        const fs::path candidate = directory / fileName;
        std::error_code ec;
        if (fs::exists(candidate, ec) && fs::is_regular_file(candidate, ec)) {
            return candidate;
        }
    }
    return fs::path();
}

std::string firstMarkdownHeading_(const std::string& content, const std::string& fallback)
{
    std::istringstream input(content);
    std::string line;
    while (std::getline(input, line)) {
        const std::string trimmed = trimCopy(line);
        if (trimmed.size() > 2 && trimmed[0] == '#') {
            std::size_t offset = 0;
            while (offset < trimmed.size() && trimmed[offset] == '#') {
                ++offset;
            }
            const std::string heading = trimCopy(trimmed.substr(offset));
            if (!heading.empty()) {
                return heading;
            }
        }
    }
    return fallback;
}

std::string readWholeFile_(const fs::path& path)
{
    std::ifstream input(path);
    if (!input.is_open()) {
        return "";
    }

    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

} // namespace

KnowledgeBase::KnowledgeBase()
{
    loadDocuments_();
}

bool KnowledgeBase::empty() const
{
    return documents_.empty();
}

std::vector<KnowledgeSnippet> KnowledgeBase::search(
    const std::string& query,
    const std::string& locale,
    std::size_t maxResults) const
{
    std::vector<KnowledgeSnippet> results;
    if (documents_.empty()) {
        return results;
    }

    const std::string targetLocale = normalizeKnowledgeLocale_(locale);
    std::vector<std::string> tokens = tokenize_(query);
    if (tokens.empty()) {
        tokens = { "app", "overview" };
    }

    auto appendMatches = [&](const std::string& candidateLocale, bool localeFallback) {
        for (const auto& document : documents_) {
            if (document.locale != candidateLocale) {
                continue;
            }

            double score = 0.0;
            score += scoreText_(document.title, tokens) * 2.5;
            score += scoreText_(document.content, tokens);
            for (const auto& alias : document.aliases) {
                score += scoreText_(alias, tokens) * 2.0;
            }

            if (score <= 0.0) {
                continue;
            }

            KnowledgeSnippet snippet;
            snippet.topic = document.topic;
            snippet.title = document.title;
            snippet.content = document.content;
            snippet.excerpt = selectExcerpt_(document.content, tokens);
            snippet.locale = document.locale;
            snippet.localeFallback = localeFallback;
            snippet.sourcePath = document.sourcePath;
            snippet.score = score;
            results.push_back(std::move(snippet));
        }
    };

    appendMatches(targetLocale, false);
    if (results.empty() && targetLocale != "en") {
        appendMatches("en", true);
    }

    std::sort(results.begin(), results.end(), [](const KnowledgeSnippet& left, const KnowledgeSnippet& right) {
        if (left.score == right.score) {
            return left.topic < right.topic;
        }
        return left.score > right.score;
    });

    if (results.size() > maxResults) {
        results.resize(maxResults);
    }

    return results;
}

KnowledgeSnippet KnowledgeBase::topicDocument(
    const std::string& topic,
    const std::string& locale) const
{
    KnowledgeSnippet snippet;
    const std::string targetLocale = normalizeKnowledgeLocale_(locale);
    const Document* document = findDocument_(topic, targetLocale);
    bool localeFallback = false;
    if (!document && targetLocale != "en") {
        document = findDocument_(topic, "en");
        localeFallback = true;
    }
    if (!document) {
        return snippet;
    }

    snippet.topic = document->topic;
    snippet.title = document->title;
    snippet.content = document->content;
    snippet.excerpt = collapseWhitespace_(document->content);
    snippet.locale = document->locale;
    snippet.localeFallback = localeFallback;
    snippet.sourcePath = document->sourcePath;
    snippet.score = 1.0;
    return snippet;
}

const KnowledgeBase::Document* KnowledgeBase::findDocument_(
    const std::string& topic,
    const std::string& locale) const
{
    for (const auto& document : documents_) {
        if (document.topic == topic && document.locale == locale) {
            return &document;
        }
    }
    return nullptr;
}

void KnowledgeBase::loadDocuments_()
{
    const std::vector<TopicSeed> seeds = {
        {
            "app_overview",
            "App Overview",
            "app_overview.md",
            { "overview", "app", "site", "platform", "dashboard", "painel", "aplicativo" },
        },
        {
            "tutorial",
            "Tutorial",
            "tutorial.md",
            { "tutorial", "how to", "how do i", "getting started", "como usar", "primeiros passos" },
        },
        {
            "billing",
            "Billing",
            "billing.md",
            { "billing", "payment", "payments", "subscription", "subscriptions", "token", "tokens", "pagamento", "assinatura", "cartao", "cobranca" },
        },
        {
            "pairing",
            "Pairing",
            "pairing.md",
            { "pairing", "pair", "connect exe", "desktop link", "parear", "emparelhar", "codigo" },
        },
        {
            "api_keys",
            "API Keys",
            "api_keys.md",
            { "api key", "api keys", "openai", "z.ai", "glm", "settings", "chave", "chaves", "configurar chave" },
        },
        {
            "camera_creation",
            "Camera Creation",
            "camera_creation.md",
            { "create camera", "add camera", "new camera", "register camera", "camera setup", "criar camera", "adicionar camera", "cadastrar camera", "configurar camera" },
        },
        {
            "camera_agents",
            "Camera Agents",
            "camera_agents.md",
            { "camera agent", "camera agents", "custom agent", "agent on camera", "agente na camera", "agentes na camera", "agente custom" },
        },
        {
            "jobs",
            "Jobs",
            "jobs.md",
            { "job", "jobs", "workflow", "schedule", "agendamento", "tarefa", "tarefas", "fluxo" },
        },
        {
            "job_steps",
            "Job Steps",
            "job_steps.md",
            { "step", "steps", "job step", "workflow step", "step agent", "etapa", "etapas", "step do job", "passo do workflow" },
        },
    };

    const auto directories = buildKnowledgeDirectoryCandidates_();
    const auto locales = buildKnowledgeLocaleCandidates_();
    for (const auto& seed : seeds) {
        bool loadedEnglishDocument = false;

        for (const auto& locale : locales) {
            const fs::path localizedPath = findKnowledgeDocumentPath_(directories, locale, seed.fileName);
            if (localizedPath.empty()) {
                continue;
            }

            const std::string content = readWholeFile_(localizedPath);
            if (trimCopy(content).empty()) {
                continue;
            }

            Document document;
            document.topic = seed.topic;
            document.title = firstMarkdownHeading_(content, seed.title);
            document.content = content;
            document.locale = locale;
            document.sourcePath = localizedPath;
            document.aliases = seed.aliases;
            documents_.push_back(std::move(document));
            if (locale == "en") {
                loadedEnglishDocument = true;
            }
        }

        if (!loadedEnglishDocument) {
            const fs::path legacyPath = findLegacyKnowledgeDocumentPath_(directories, seed.fileName);
            if (legacyPath.empty()) {
                continue;
            }

            const std::string content = readWholeFile_(legacyPath);
            if (trimCopy(content).empty()) {
                continue;
            }

            Document document;
            document.topic = seed.topic;
            document.title = firstMarkdownHeading_(content, seed.title);
            document.content = content;
            document.locale = "en";
            document.sourcePath = legacyPath;
            document.aliases = seed.aliases;
            documents_.push_back(std::move(document));
        }
    }
}

} // namespace chatv2
