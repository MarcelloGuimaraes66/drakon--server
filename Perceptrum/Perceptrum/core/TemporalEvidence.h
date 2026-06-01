#pragma once

#include <string>

struct TemporalEvidenceCandidate {
    std::string evidenceKey;
    std::string eventName;
    std::string entityId;
    std::string zone;
    int frameIndex = -1;
    std::string frameTimestampInSegment;
    std::string timestampName;
    std::string timestampUtcIso;
    std::string timestampLocalIso;
    std::string reason;
    std::string imageJpegBase64;
};
