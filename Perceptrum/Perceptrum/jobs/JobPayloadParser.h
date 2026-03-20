// JobPayloadParser.h
#pragma once
#include "JobTypes.h"

class JobPayloadParser {
public:
    static JobStartPayload parseJobStartPayloadOrThrow(const json& cmd);
};
