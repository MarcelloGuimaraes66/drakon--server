#include "HeadlessService.h"

#include <chrono>
#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <thread>

#include <curl/curl.h>

#ifdef _WIN32
#include <windows.h>
#endif

#include "../platform/platform_shutdown.h"

#ifndef PERCEPTRUM_LINUX_BUILD
#include "../comm/BackendConfig.h"
#include "../comm/PairingClient.h"
#include "../core/AgentCore.h"
#include "../logging/Logging.h"
#endif

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

class NullRuntimeLogger final : public perceptrum::runtime::IRuntimeLogger {
public:
    void debug(std::string_view component, std::string_view message) noexcept override
    {
        write("DEBUG", component, message);
    }

    void info(std::string_view component, std::string_view message) noexcept override
    {
        write("INFO", component, message);
    }

    void warn(std::string_view component, std::string_view message) noexcept override
    {
        write("WARN", component, message);
    }

    void error(std::string_view component, std::string_view message) noexcept override
    {
        write("ERROR", component, message);
    }

private:
    static void write(std::string_view level, std::string_view component, std::string_view message) noexcept
    {
        try {
            std::cerr << "[HeadlessService][" << level << "][" << component << "] " << message << '\n';
        } catch (...) {
        }
    }
};

int RunInjectedHeadlessService(
    const PerceptrumCore::HeadlessServiceOptions& options,
    PerceptrumCore::HeadlessServiceDependencies& dependencies)
{
    curl_global_init(CURL_GLOBAL_DEFAULT);

    NullRuntimeLogger fallbackLogger;
    auto& runtime = dependencies.runtime;
    perceptrum::runtime::IRuntimeLogger& logger =
        runtime.logger != nullptr ? *runtime.logger : static_cast<perceptrum::runtime::IRuntimeLogger&>(fallbackLogger);

    logger.info("agent", "HeadlessService: starting portable injected runtime");

    perceptrum::platform::ShutdownSignal shutdownSignal(options.shutdownEventName);
    auto waitForShutdown = [&](std::chrono::milliseconds timeout) {
        if (runtime.waitForShutdown) {
            return runtime.waitForShutdown(timeout);
        }
        return shutdownSignal.WaitFor(timeout);
    };

    std::unique_ptr<perceptrum::runtime::IAgentRuntime> agent;
    std::string currentBaseUrl;
    std::string currentTokenFingerprint;
    std::string currentClientId;
    bool waitingLogged = false;

    while (true) {
        if (waitForShutdown(std::chrono::milliseconds(1000))) {
            break;
        }

        if (runtime.tokenStore == nullptr || runtime.agentFactory == nullptr ||
            !runtime.baseUrlProvider || !runtime.clientIdProvider) {
            logger.warn(
                "agent",
                "HeadlessService: portable dependencies incomplete; AgentCore/camera/jobs remain disabled");
            break;
        }

        const auto token = runtime.tokenStore->readToken();
        const std::string baseUrl = runtime.baseUrlProvider();
        const std::string clientId = runtime.clientIdProvider();
        if (!token.has_value() || token->empty() || baseUrl.empty() || clientId.empty()) {
            if (!waitingLogged) {
                logger.debug("agent", "HeadlessService: waiting for pairing/config via portable interfaces");
                waitingLogged = true;
            }
            continue;
        }

        waitingLogged = false;
        const std::string tokenFingerprint = std::to_string(token->size());
        const bool needsRestart =
            agent == nullptr ||
            baseUrl != currentBaseUrl ||
            tokenFingerprint != currentTokenFingerprint ||
            clientId != currentClientId;

        if (!needsRestart) {
            continue;
        }

        if (agent) {
            logger.debug("agent", "HeadlessService: stopping previous injected runtime");
            agent->stop();
            agent.reset();
        }

        currentBaseUrl = baseUrl;
        currentTokenFingerprint = tokenFingerprint;
        currentClientId = clientId;

        logger.info(
            "agent",
            "HeadlessService: starting injected AgentRuntime for client_id=" + currentClientId +
                " baseUrl=" + currentBaseUrl);

        agent = runtime.agentFactory->create(currentBaseUrl, *token, currentClientId);
        if (agent && agent->start() && runtime.statusCallback) {
            runtime.statusCallback(agent->status());
        }
    }

    if (agent) {
        logger.debug("agent", "HeadlessService: stopping injected runtime");
        agent->stop();
        if (runtime.statusCallback) {
            runtime.statusCallback(agent->status());
        }
    }

    logger.info("agent", "HeadlessService: stopped portable injected runtime");
    curl_global_cleanup();
    return 0;
}
}

namespace PerceptrumCore {

int RunHeadlessService(const HeadlessServiceOptions& options, HeadlessServiceDependencies& dependencies) {
    return RunInjectedHeadlessService(options, dependencies);
}

int RunHeadlessService(const HeadlessServiceOptions& options) {
#ifdef PERCEPTRUM_LINUX_BUILD
    (void)options;
    std::cerr << "HeadlessService requires injected portable dependencies on Linux; "
              << "real AgentCore/camera/jobs are disabled.\n";
    return 78;
#else
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
#endif
}
}
