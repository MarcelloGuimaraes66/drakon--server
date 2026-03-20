#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace chatv2 {

struct KnowledgeSnippet {
    std::string topic;
    std::string title;
    std::string content;
    std::string excerpt;
    std::string locale;
    bool localeFallback = false;
    std::filesystem::path sourcePath;
    double score = 0.0;
};

class KnowledgeBase {
public:
    KnowledgeBase();

    bool empty() const;
    std::vector<KnowledgeSnippet> search(
        const std::string& query,
        const std::string& locale,
        std::size_t maxResults = 3) const;
    KnowledgeSnippet topicDocument(
        const std::string& topic,
        const std::string& locale) const;

private:
    struct Document {
        std::string topic;
        std::string title;
        std::string content;
        std::string locale;
        std::filesystem::path sourcePath;
        std::vector<std::string> aliases;
    };

    const Document* findDocument_(
        const std::string& topic,
        const std::string& locale) const;
    void loadDocuments_();
    std::vector<Document> documents_;
};

} // namespace chatv2
