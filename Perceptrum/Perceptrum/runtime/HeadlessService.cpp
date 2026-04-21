#include "HeadlessService.h"

#include <chrono>
#include <cstdio>
#include <memory>
#include <optional>
#include <string>
#include <thread>

#include <curl/curl.h>

#ifdef _WIN32
#include <windows.h>
#endif

#include "../comm/BackendConfig.h"
#include "../comm/PairingClient.h"
#include "../core/AgentCore.h"
#include "../logging/Logging.h"
#include "../platform/platform_shutdown.h"

namespace {
#ifdef _WIN32
LONG WINAPI TopLevelExceptionFilter(EXCEPTION_POINTERS* exceptionInfo) {
    const DWORD code = exceptionInfo->ExceptionRecord->ExceptionCode;
    Logger::instance().logDebug(
        "agent",
        std::string("HeadlessService: unhandled SEH exception, code=0x") +
        [] (DWORD value) {
            char buffer[16];
            sprintf_s(buffer, "%08X", value);
            return std::string(buffer);
        }(code));
    return EXCEPTION_CONTINUE_SEARCH;
}
#endif
}

namespace PerceptrumCore {
int RunHeadlessService(const HeadlessServiceOptions& options) {
#ifdef _WIN32
    SetUnhandledExceptionFilter(TopLevelExceptionFilter);
#endif
    curl_global_init(CURL_GLOBAL_DEFAULT);

    Logger::instance().logDebug("agent", "HeadlessService: starting");

    perceptrum::platform::ShutdownSignal shutdownSignal(options.shutdownEventName);

    std::unique_ptr<AgentCore> agent;
    std::string currentBaseUrl;
    std::string currentExeToken;
    std::string currentClientId;
    bool waitingForPairingLogged = false;

    while (true) {
        if (shutdownSignal.WaitFor(std::chrono::milliseconds(1000))) {
            break;
        }

        const std::string baseUrl = GetPerceptrumBaseUrl();
        PairingClient pairing(baseUrl);

        std::string exeToken;
        std::string clientId;
        if (!pairing.loadSavedToken(exeToken, clientId)) {
            if (!waitingForPairingLogged) {
                Logger::instance().logDebug("agent", "HeadlessService: waiting for local pairing/session files");
                waitingForPairingLogged = true;
            }
            continue;
        }

        waitingForPairingLogged = false;
        const bool needsRestart =
            agent == nullptr ||
            baseUrl != currentBaseUrl ||
            exeToken != currentExeToken ||
            clientId != currentClientId;

        if (!needsRestart) {
            continue;
        }

        if (agent) {
            Logger::instance().logDebug("agent", "HeadlessService: stopping previous AgentCore instance");
            agent->stop();
            agent.reset();
        }

        currentBaseUrl = baseUrl;
        currentExeToken = exeToken;
        currentClientId = clientId;

        Logger::instance().logDebug(
            "agent",
            "HeadlessService: starting AgentCore for client_id=" + currentClientId +
                " baseUrl=" + currentBaseUrl);

        agent = std::make_unique<AgentCore>(currentBaseUrl, currentExeToken, currentClientId);
        agent->initTimeSync();
        agent->bootstrapCameras_();
        agent->start();
    }

    if (agent) {
        Logger::instance().logDebug("agent", "HeadlessService: stopping AgentCore");
        agent->stop();
    }

    Logger::instance().shutdown();
    curl_global_cleanup();
    return 0;
}
}
