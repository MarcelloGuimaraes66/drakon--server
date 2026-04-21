#include "pch.h"
#include "DrakonApiClient.h"

#include "../Platform/AppRuntimeConfig.h"
#include "../Platform/SecureLocalStore.h"

#include <Windows.h>
#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <optional>
#include <sstream>
#include <unordered_set>

using json = nlohmann::json;

namespace
{
    std::string TrimAscii(std::string value)
    {
        auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
        while (!value.empty() && isSpace(static_cast<unsigned char>(value.front())))
        {
            value.erase(value.begin());
        }
        while (!value.empty() && isSpace(static_cast<unsigned char>(value.back())))
        {
            value.pop_back();
        }
        return value;
    }

    size_t WriteBodyCallback(void* contents, size_t size, size_t nmemb, void* userp)
    {
        auto* buffer = static_cast<std::string*>(userp);
        buffer->append(static_cast<char*>(contents), size * nmemb);
        return size * nmemb;
    }

    size_t WriteHeaderCallback(char* buffer, size_t size, size_t nitems, void* userdata)
    {
        auto* headers = static_cast<std::vector<std::string>*>(userdata);
        headers->emplace_back(buffer, size * nitems);
        return size * nitems;
    }

    std::filesystem::path ExecutableDirectory()
    {
        std::wstring buffer(MAX_PATH, L'\0');
        auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        buffer.resize(length);
        return std::filesystem::path(buffer).parent_path();
    }

    std::string ReadEnvVar(char const* name)
    {
        char* buffer = nullptr;
        size_t length = 0;
        if (_dupenv_s(&buffer, &length, name) != 0 || !buffer)
        {
            return {};
        }

        std::string value(buffer);
        free(buffer);
        return value;
    }

    std::optional<std::string> ReadFirstLine(std::filesystem::path const& path)
    {
        std::ifstream stream(path);
        if (!stream)
        {
            return std::nullopt;
        }

        std::string line;
        std::getline(stream, line);
        line = TrimAscii(line);
        if (line.empty())
        {
            return std::nullopt;
        }

        return line;
    }

    std::string LowerAscii(std::string value)
    {
        std::transform(
            value.begin(),
            value.end(),
            value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    std::string JsonErrorMessage(std::string const& body, long statusCode, std::string const& fallback)
    {
        try
        {
            auto parsed = json::parse(body);

            if (parsed.contains("error") && parsed["error"].is_string())
            {
                return parsed["error"].get<std::string>();
            }

            if (parsed.contains("message") && parsed["message"].is_string())
            {
                return parsed["message"].get<std::string>();
            }

            if (parsed.contains("details") && parsed["details"].is_array())
            {
                std::ostringstream stream;
                stream << "Validation error: ";
                bool first = true;
                for (auto const& issue : parsed["details"])
                {
                    auto message = issue.contains("message") && issue["message"].is_string()
                        ? issue["message"].get<std::string>()
                        : std::string("invalid field");
                    if (!first)
                    {
                        stream << ", ";
                    }
                    first = false;
                    stream << message;
                }
                return stream.str();
            }
        }
        catch (...)
        {
        }

        auto trimmedBody = TrimAscii(body);
        if (!trimmedBody.empty())
        {
            return "HTTP " + std::to_string(statusCode) + ": " + trimmedBody;
        }

        return fallback;
    }

    std::string ExtractCookiePair(std::vector<std::string> const& headers)
    {
        for (auto const& rawHeader : headers)
        {
            auto lowered = LowerAscii(rawHeader);
            if (!lowered.starts_with("set-cookie:"))
            {
                continue;
            }

            auto cookieValue = TrimAscii(rawHeader.substr(std::string("Set-Cookie:").size()));
            auto separator = cookieValue.find(';');
            if (separator != std::string::npos)
            {
                cookieValue = cookieValue.substr(0, separator);
            }

            cookieValue = TrimAscii(cookieValue);
            if (!cookieValue.empty() && cookieValue.find('=') != std::string::npos)
            {
                return cookieValue;
            }
        }

        return {};
    }

    bool ManufacturerLocksSubtype(std::string const& manufacturer)
    {
        return LowerAscii(TrimAscii(manufacturer)) == "hikvision";
    }

    std::string JsonString(json const& object, char const* key)
    {
        if (!object.contains(key) || object[key].is_null())
        {
            return {};
        }

        if (object[key].is_string())
        {
            return object[key].get<std::string>();
        }

        if (object[key].is_number_integer())
        {
            return std::to_string(object[key].get<int>());
        }

        if (object[key].is_number_float())
        {
            std::ostringstream stream;
            stream << object[key].get<double>();
            return stream.str();
        }

        return {};
    }

    bool JsonBool(json const& object, char const* key)
    {
        if (!object.contains(key) || object[key].is_null())
        {
            return false;
        }

        if (object[key].is_boolean())
        {
            return object[key].get<bool>();
        }

        if (object[key].is_number_integer())
        {
            return object[key].get<int>() != 0;
        }

        return false;
    }

    int32_t JsonInt(json const& object, char const* key, int32_t fallback = 0)
    {
        if (!object.contains(key) || object[key].is_null())
        {
            return fallback;
        }

        if (object[key].is_number_integer())
        {
            return object[key].get<int32_t>();
        }

        if (object[key].is_string())
        {
            try
            {
                return std::stoi(object[key].get<std::string>());
            }
            catch (...)
            {
            }
        }

        return fallback;
    }

    int64_t JsonInt64(json const& object, char const* key, int64_t fallback = 0)
    {
        if (!object.contains(key) || object[key].is_null())
        {
            return fallback;
        }

        if (object[key].is_number_integer())
        {
            return object[key].get<int64_t>();
        }

        if (object[key].is_string())
        {
            try
            {
                return std::stoll(object[key].get<std::string>());
            }
            catch (...)
            {
            }
        }

        return fallback;
    }

    double JsonDouble(json const& object, char const* key, double fallback = 0.0)
    {
        if (!object.contains(key) || object[key].is_null())
        {
            return fallback;
        }

        if (object[key].is_number())
        {
            return object[key].get<double>();
        }

        if (object[key].is_string())
        {
            try
            {
                return std::stod(object[key].get<std::string>());
            }
            catch (...)
            {
            }
        }

        return fallback;
    }

    std::string FormatDecimal(double value, int precision = 1)
    {
        std::ostringstream stream;
        stream << std::fixed << std::setprecision(precision) << value;
        return stream.str();
    }

    std::string CoalesceString(std::initializer_list<std::string> values)
    {
        for (auto const& value : values)
        {
            auto trimmed = TrimAscii(value);
            if (!trimmed.empty())
            {
                return trimmed;
            }
        }

        return {};
    }

    json const* FindObject(json const& object, std::initializer_list<char const*> path)
    {
        json const* current = &object;
        for (auto const* key : path)
        {
            if (!current->is_object() || !current->contains(key))
            {
                return nullptr;
            }
            current = &(*current)[key];
        }

        return current;
    }

    std::vector<std::string> JsonStringArray(json const& object, char const* key)
    {
        std::vector<std::string> values;
        if (!object.contains(key) || !object[key].is_array())
        {
            return values;
        }

        for (auto const& item : object[key])
        {
            if (item.is_string())
            {
                auto value = TrimAscii(item.get<std::string>());
                if (!value.empty())
                {
                    values.push_back(value);
                }
            }
        }

        return values;
    }

    std::vector<int32_t> JsonIntArray(json const& object, char const* key)
    {
        std::vector<int32_t> values;
        if (!object.contains(key) || !object[key].is_array())
        {
            return values;
        }

        for (auto const& item : object[key])
        {
            if (item.is_number_integer())
            {
                values.push_back(item.get<int32_t>());
            }
            else if (item.is_string())
            {
                try
                {
                    values.push_back(std::stoi(item.get<std::string>()));
                }
                catch (...)
                {
                }
            }
        }

        return values;
    }

    winrt::DrakonDesktop::CameraRecord ParseCameraRecord(json const& object)
    {
        winrt::DrakonDesktop::CameraRecord record;
        record.id = JsonInt(object, "id");
        record.name = winrt::to_hstring(JsonString(object, "name"));
        record.ipAddress = winrt::to_hstring(JsonString(object, "ip_address"));
        record.rtspPort = winrt::to_hstring(JsonString(object, "rtsp_port"));
        record.manufacturer = winrt::to_hstring(JsonString(object, "manufacturer"));
        record.description = winrt::to_hstring(JsonString(object, "description"));
        record.username = winrt::to_hstring(JsonString(object, "username"));
        record.password = winrt::to_hstring(JsonString(object, "password"));
        record.channel = winrt::to_hstring(JsonString(object, "channel"));
        record.subtype = winrt::to_hstring(JsonString(object, "subtype"));
        record.connectionMethod = winrt::to_hstring(JsonString(object, "connection_method"));
        record.street = winrt::to_hstring(JsonString(object, "street"));
        record.number = winrt::to_hstring(JsonString(object, "number"));
        record.city = winrt::to_hstring(JsonString(object, "city"));
        record.state = winrt::to_hstring(JsonString(object, "state"));
        record.zipCode = winrt::to_hstring(JsonString(object, "zip_code"));
        record.country = winrt::to_hstring(JsonString(object, "country"));
        record.retentionDays = JsonInt(object, "retention_days", 1);
        record.allowPublicAccess = JsonBool(object, "allowpublicaccess");
        record.isServiceRunning = JsonBool(object, "is_service_running");

        if (object.contains("webcam_index") && !object["webcam_index"].is_null())
        {
            record.webcamIndex = JsonInt(object, "webcam_index", 0);
        }

        return record;
    }

    winrt::DrakonDesktop::services::ApiKeySettings ParseApiKeySettings(json const& object)
    {
        winrt::DrakonDesktop::services::ApiKeySettings settings;
        settings.hasKey = JsonBool(object, "has_key");
        settings.apiKeyPreview = JsonString(object, "api_key_preview");
        return settings;
    }

    winrt::DrakonDesktop::services::TelegramSettings ParseTelegramSettings(json const& object)
    {
        winrt::DrakonDesktop::services::TelegramSettings settings;
        settings.enabled = JsonBool(object, "enabled");
        settings.chatId = JsonString(object, "chat_id");
        settings.botToken = JsonString(object, "bot_token");
        return settings;
    }

    winrt::DrakonDesktop::services::PairingConnection ParsePairingConnection(json const& object)
    {
        winrt::DrakonDesktop::services::PairingConnection connection;
        connection.clientId = JsonString(object, "client_id");
        connection.exeId = JsonString(object, "exe_id");
        connection.pairedAt = JsonString(object, "paired_at");
        connection.lastSeenAt = JsonString(object, "last_seen_at");
        connection.lastSeenAgeSeconds = JsonInt(object, "last_seen_age_seconds", 0);
        connection.isHeartbeatFresh = JsonBool(object, "is_heartbeat_fresh");
        connection.isAvailableForChat = JsonBool(object, "is_available_for_chat");
        connection.status = JsonString(object, "status");
        connection.effectiveStatus = JsonString(object, "effective_status");
        connection.chatEffectiveStatus = JsonString(object, "chat_effective_status");
        return connection;
    }

    winrt::DrakonDesktop::services::PairingStatusSnapshot ParsePairingStatus(json const& object)
    {
        winrt::DrakonDesktop::services::PairingStatusSnapshot snapshot;
        snapshot.status = JsonString(object, "status");
        snapshot.effectiveStatus = JsonString(object, "effective_status");
        snapshot.chatEffectiveStatus = JsonString(object, "chat_effective_status");
        snapshot.isAvailableForChat = JsonBool(object, "is_available_for_chat");
        snapshot.isHeartbeatFresh = JsonBool(object, "is_heartbeat_fresh");
        snapshot.clientId = JsonString(object, "client_id");
        snapshot.exeId = JsonString(object, "exe_id");
        snapshot.pairedAt = JsonString(object, "paired_at");
        snapshot.lastSeenAt = JsonString(object, "last_seen_at");
        snapshot.lastSeenAgeSeconds = JsonInt(object, "last_seen_age_seconds", 0);
        snapshot.timezoneIana = JsonString(object, "timezone_iana");
        snapshot.timezoneSource = JsonString(object, "timezone_source");
        snapshot.timezoneUpdatedAt = JsonString(object, "timezone_updated_at");

        if (object.contains("connections") && object["connections"].is_array())
        {
            for (auto const& item : object["connections"])
            {
                snapshot.connections.push_back(ParsePairingConnection(item));
            }
        }

        return snapshot;
    }

    winrt::DrakonDesktop::services::TokenBalanceSnapshot ParseTokenBalance(json const& object)
    {
        winrt::DrakonDesktop::services::TokenBalanceSnapshot snapshot;
        snapshot.balance = JsonInt64(object, "balance", 0);
        snapshot.inputBalance = JsonInt64(object, "input_balance", 0);
        snapshot.outputBalance = JsonInt64(object, "output_balance", 0);
        snapshot.totalSpent = JsonInt64(object, "total_spent", 0);
        return snapshot;
    }

    winrt::DrakonDesktop::services::MonthlyTokenUsageSummarySnapshot ParseMonthlyTokenUsageSummary(json const& object)
    {
        winrt::DrakonDesktop::services::MonthlyTokenUsageSummarySnapshot snapshot;
        snapshot.inputTokens = JsonInt64(object, "input_tokens", 0);
        snapshot.outputTokens = JsonInt64(object, "output_tokens", 0);
        snapshot.totalTokens = JsonInt64(object, "total_tokens", 0);
        snapshot.localMonth = JsonString(object, "local_month");
        snapshot.timezoneIana = JsonString(object, "timezone_iana");
        return snapshot;
    }

    winrt::DrakonDesktop::services::PaymentRecord ParsePaymentRecord(json const& object)
    {
        winrt::DrakonDesktop::services::PaymentRecord record;
        record.id = JsonInt(object, "id", 0);
        record.amount = JsonInt64(object, "amount", 0);
        record.currency = JsonString(object, "currency");
        record.paymentType = JsonString(object, "payment_type");
        record.status = JsonString(object, "status");
        record.description = JsonString(object, "description");
        record.createdAt = JsonString(object, "created_at");
        return record;
    }

    winrt::DrakonDesktop::services::SubscriptionSnapshot ParseSubscription(json const& object)
    {
        winrt::DrakonDesktop::services::SubscriptionSnapshot snapshot;
        snapshot.exists = true;
        snapshot.id = JsonInt(object, "id", 0);
        snapshot.isActive = JsonBool(object, "is_active");
        snapshot.cameraCount = JsonInt(object, "camera_count", 0);
        snapshot.secondsPerFrame = JsonInt(object, "seconds_per_frame", 0);
        snapshot.modelTier = JsonString(object, "model_tier");
        snapshot.status = JsonString(object, "status");
        snapshot.subscriptionType = JsonString(object, "subscription_type");
        snapshot.startedAt = JsonString(object, "started_at");
        snapshot.accessUntil = JsonString(object, "access_until");
        return snapshot;
    }

    winrt::DrakonDesktop::services::BillingCard ParseBillingCard(json const& object)
    {
        winrt::DrakonDesktop::services::BillingCard card;
        card.id = JsonInt(object, "id", 0);
        card.brand = JsonString(object, "brand");
        card.last4 = JsonString(object, "last4");
        card.expMonth = JsonInt(object, "exp_month", 0);
        card.expYear = JsonInt(object, "exp_year", 0);
        card.isDefault = JsonBool(object, "is_default");
        return card;
    }

    winrt::DrakonDesktop::services::StartCameraResult ParseStartCameraResult(json const& object)
    {
        winrt::DrakonDesktop::services::StartCameraResult result;
        result.agentsDisabledNoSubscription = JsonBool(object, "agents_disabled_no_subscription");
        return result;
    }

    winrt::DrakonDesktop::services::JobScheduleWindow ParseJobScheduleWindow(json const& object)
    {
        winrt::DrakonDesktop::services::JobScheduleWindow window;
        window.startTime = JsonString(object, "start_time");
        window.endTime = JsonString(object, "end_time");
        return window;
    }

    winrt::DrakonDesktop::services::JobScheduleDay ParseJobScheduleDay(json const& object)
    {
        winrt::DrakonDesktop::services::JobScheduleDay day;
        day.dayName = JsonString(object, "day_name");
        day.dayOfWeek = JsonInt(object, "day_of_week", -1);
        day.dayOfMonth = JsonInt(object, "day_of_month", -1);
        day.monthOfYear = JsonInt(object, "month_of_year", -1);

        if (object.contains("windows") && object["windows"].is_array())
        {
            for (auto const& item : object["windows"])
            {
                day.windows.push_back(ParseJobScheduleWindow(item));
            }
        }

        return day;
    }

    winrt::DrakonDesktop::services::JobRecord ParseJobRecord(json const& object)
    {
        winrt::DrakonDesktop::services::JobRecord job;
        job.id = JsonInt(object, "id", 0);
        job.name = JsonString(object, "name");
        job.description = JsonString(object, "description");
        job.startAt = JsonString(object, "start_at");
        job.endAt = JsonString(object, "end_at");
        job.status = JsonString(object, "status");
        job.createdAt = JsonString(object, "created_at");
        job.scheduleMode = JsonString(object, "schedule_mode");
        job.timezone = JsonString(object, "timezone");
        job.activeFrom = JsonString(object, "active_from");
        job.activeUntil = JsonString(object, "active_until");
        job.scheduleSummary = JsonString(object, "schedule_summary");
        job.runtimeStatus = JsonString(object, "runtime_status");
        job.runtimeStartedAtUtc = JsonString(object, "runtime_started_at_utc");
        job.runtimeUpdatedAt = JsonString(object, "runtime_updated_at");

        if (object.contains("schedule_days") && object["schedule_days"].is_array())
        {
            for (auto const& item : object["schedule_days"])
            {
                job.scheduleDays.push_back(ParseJobScheduleDay(item));
            }
        }

        return job;
    }

    winrt::DrakonDesktop::services::JobStepRecord ParseJobStepRecord(json const& object)
    {
        winrt::DrakonDesktop::services::JobStepRecord step;
        step.id = JsonInt(object, "id", 0);
        step.jobId = JsonInt(object, "job_id", 0);
        step.stepOrder = JsonInt(object, "step_order", 0);
        step.name = JsonString(object, "name");
        step.timeoutSeconds = JsonInt(object, "timeout_seconds", 0);
        step.status = JsonString(object, "status");
        if (object.contains("input_from_step_id") && !object["input_from_step_id"].is_null())
        {
            step.hasInputFromStepId = true;
            step.inputFromStepId = JsonInt(object, "input_from_step_id", 0);
        }
        step.inputInjectKey = JsonString(object, "input_inject_key");
        step.onMissingInput = JsonString(object, "on_missing_input");
        step.startCondition = JsonString(object, "start_condition");
        if (object.contains("start_condition_from_step_id") && !object["start_condition_from_step_id"].is_null())
        {
            step.hasStartConditionFromStepId = true;
            step.startConditionFromStepId = JsonInt(object, "start_condition_from_step_id", 0);
        }
        if (object.contains("inference_groups") && !object["inference_groups"].is_null())
        {
            step.inferenceGroupsJson = object["inference_groups"].dump();
        }
        return step;
    }

    json SerializeJobScheduleDays(std::vector<winrt::DrakonDesktop::services::JobScheduleDay> const& days)
    {
        json scheduleDays = json::array();
        for (auto const& day : days)
        {
            json dayObject = {
                { "day_name", day.dayName },
                { "windows", json::array() },
            };

            if (day.dayOfWeek >= 0)
            {
                dayObject["day_of_week"] = day.dayOfWeek;
            }
            if (day.dayOfMonth >= 0)
            {
                dayObject["day_of_month"] = day.dayOfMonth;
            }
            if (day.monthOfYear >= 0)
            {
                dayObject["month_of_year"] = day.monthOfYear;
            }

            for (auto const& window : day.windows)
            {
                dayObject["windows"].push_back({
                    { "start_time", window.startTime },
                    { "end_time", window.endTime },
                });
            }

            scheduleDays.push_back(std::move(dayObject));
        }

        return scheduleDays;
    }

    json BuildJobMutationPayload(winrt::DrakonDesktop::services::JobMutationRequest const& request)
    {
        json payload = json::object();
        if (!request.name.empty())
        {
            payload["name"] = request.name;
        }
        payload["description"] = request.description;

        if (!request.scheduleMode.empty())
        {
            payload["schedule_mode"] = request.scheduleMode;
        }

        if (!request.status.empty())
        {
            payload["status"] = request.status;
        }

        if (request.activeFrom.has_value())
        {
            payload["active_from"] = request.activeFrom.value().empty()
                ? json(nullptr)
                : json(request.activeFrom.value());
        }

        if (request.activeUntil.has_value())
        {
            payload["active_until"] = request.activeUntil.value().empty()
                ? json(nullptr)
                : json(request.activeUntil.value());
        }

        if (request.startAt.has_value())
        {
            payload["start_at"] = request.startAt.value().empty()
                ? json(nullptr)
                : json(request.startAt.value());
        }

        if (request.endAt.has_value())
        {
            payload["end_at"] = request.endAt.value().empty()
                ? json(nullptr)
                : json(request.endAt.value());
        }

        if (!request.scheduleDays.empty())
        {
            payload["schedule_days"] = SerializeJobScheduleDays(request.scheduleDays);
        }

        return payload;
    }

    winrt::DrakonDesktop::services::ChatSessionRecord ParseChatSession(json const& object)
    {
        winrt::DrakonDesktop::services::ChatSessionRecord record;
        record.id = JsonInt(object, "id", 0);
        record.title = JsonString(object, "title");
        record.createdAt = JsonString(object, "created_at");
        record.updatedAt = JsonString(object, "updated_at");
        return record;
    }

    winrt::DrakonDesktop::services::ChatMessageRecord ParseChatMessage(json const& object)
    {
        winrt::DrakonDesktop::services::ChatMessageRecord record;
        record.id = JsonInt(object, "id", 0);
        record.role = JsonString(object, "role");
        record.content = JsonString(object, "content");
        record.createdAt = JsonString(object, "created_at");
        record.updatedAt = JsonString(object, "updated_at");
        record.messageType = JsonString(object, "message_type");
        record.warning = JsonString(object, "warning");
        record.warningCode = JsonString(object, "warning_code");
        record.uploadedImageBase64 = JsonString(object, "uploaded_image_base64");
        record.cameraSelectionJson = JsonString(object, "camera_selection_json");
        record.progressJson = JsonString(object, "progress_json");
        record.isPending = JsonBool(object, "is_pending");
        record.tokensUsed = JsonInt64(object, "tokens_used", 0);
        return record;
    }

    winrt::DrakonDesktop::services::DrakonFindTargetImage ParseDrakonFindTargetImage(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindTargetImage image;
        image.id = JsonInt(object, "id", 0);
        image.targetId = JsonInt(object, "target_id", 0);
        image.imageUrl = JsonString(object, "image_url");
        image.contentType = JsonString(object, "content_type");
        image.createdAt = JsonString(object, "created_at");
        image.updatedAt = JsonString(object, "updated_at");
        return image;
    }

    winrt::DrakonDesktop::services::DrakonFindTarget ParseDrakonFindTarget(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindTarget target;
        target.id = JsonInt(object, "id", 0);
        target.userId = JsonString(object, "user_id");
        target.entityType = JsonString(object, "entity_type");
        target.name = JsonString(object, "name");
        target.description = JsonString(object, "description");
        target.traits = JsonStringArray(object, "traits");
        target.imageCount = JsonInt(object, "image_count", 0);
        target.createdAt = JsonString(object, "created_at");
        target.updatedAt = JsonString(object, "updated_at");
        target.searchCount = JsonInt(object, "search_count", 0);
        target.queuedSearchCount = JsonInt(object, "queued_search_count", 0);
        target.runningSearchCount = JsonInt(object, "running_search_count", 0);
        target.lastSearchAt = JsonString(object, "last_search_at");

        if (object.contains("images") && object["images"].is_array())
        {
            for (auto const& item : object["images"])
            {
                target.images.push_back(ParseDrakonFindTargetImage(item));
            }
        }

        if (target.imageCount < static_cast<int32_t>(target.images.size()))
        {
            target.imageCount = static_cast<int32_t>(target.images.size());
        }

        return target;
    }

    winrt::DrakonDesktop::services::DrakonFindScopeStateSummary ParseDrakonFindScopeStateSummary(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindScopeStateSummary summary;
        summary.stateCode = JsonString(object, "state_code");
        summary.stateName = JsonString(object, "state_name");
        summary.cameraCount = JsonInt(object, "camera_count", 0);
        return summary;
    }

    winrt::DrakonDesktop::services::DrakonFindScopeCameraPreview ParseDrakonFindScopeCameraPreview(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindScopeCameraPreview preview;
        preview.id = JsonInt(object, "id", 0);
        preview.userId = JsonString(object, "user_id");
        preview.name = JsonString(object, "name");
        preview.city = JsonString(object, "city");
        preview.state = JsonString(object, "state");
        preview.stateCode = JsonString(object, "state_code");
        preview.country = JsonString(object, "country");
        preview.countryCode = JsonString(object, "country_code");
        preview.allowPublicAccess = JsonInt(object, "allowpublicaccess", 0);
        return preview;
    }

    winrt::DrakonDesktop::services::DrakonFindScopeResolution ParseDrakonFindScopeResolution(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindScopeResolution scope;
        scope.countryCode = JsonString(object, "country_code");
        scope.selectedStates = JsonStringArray(object, "selected_states");
        scope.eligibleCameraCount = JsonInt(object, "eligible_camera_count", 0);
        scope.eligibleOwnerCount = JsonInt(object, "eligible_owner_count", 0);
        scope.excludedCameraIds = JsonIntArray(object, "excluded_camera_ids");
        scope.previewUpdatedAt = JsonString(object, "preview_updated_at");

        if (object.contains("states") && object["states"].is_array())
        {
            for (auto const& item : object["states"])
            {
                scope.states.push_back(ParseDrakonFindScopeStateSummary(item));
            }
        }

        if (object.contains("cameras") && object["cameras"].is_array())
        {
            for (auto const& item : object["cameras"])
            {
                scope.cameras.push_back(ParseDrakonFindScopeCameraPreview(item));
            }
        }

        return scope;
    }

    winrt::DrakonDesktop::services::DrakonFindSearchClientSummary ParseDrakonFindSearchClientSummary(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindSearchClientSummary summary;
        summary.clientId = JsonString(object, "client_id");
        summary.exeId = JsonString(object, "exe_id");
        summary.cameraCount = JsonInt(object, "camera_count", 0);
        summary.completedCameraCount = JsonInt(object, "completed_camera_count", 0);
        summary.matchedCameraCount = JsonInt(object, "matched_camera_count", 0);
        return summary;
    }

    winrt::DrakonDesktop::services::DrakonFindSearch ParseDrakonFindSearch(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindSearch search;
        search.id = JsonInt(object, "id", 0);
        search.userId = JsonString(object, "user_id");
        search.targetId = JsonInt(object, "target_id", 0);
        search.targetName = JsonString(object, "target_name");
        search.targetEntityType = JsonString(object, "target_entity_type");
        search.targetDescription = JsonString(object, "target_description");
        search.status = JsonString(object, "status");
        search.runtimeMode = JsonString(object, "runtime_mode");
        search.inputType = JsonString(object, "input_type");
        search.windowSeconds = JsonInt(object, "window_seconds", 0);
        search.durationSeconds = JsonInt(object, "duration_seconds", 0);
        search.runUntil = JsonString(object, "run_until");
        search.countryCode = JsonString(object, "country_code");
        search.selectedStates = JsonStringArray(object, "selected_states");
        search.selectedStateCount = JsonInt(object, "selected_state_count", 0);
        search.eligibleCameraCount = JsonInt(object, "eligible_camera_count", 0);
        search.eligibleOwnerCount = JsonInt(object, "eligible_owner_count", 0);
        search.attemptCount = JsonInt(object, "attempt_count", 0);
        search.dispatchedCommandCount = JsonInt(object, "dispatched_command_count", 0);
        search.completedCameraCount = JsonInt(object, "completed_camera_count", 0);
        search.matchedCameraCount = JsonInt(object, "matched_camera_count", 0);
        search.pendingCameraCount = JsonInt(object, "pending_camera_count", 0);
        search.hitCount = JsonInt(object, "hit_count", 0);
        search.activeClientCount = JsonInt(object, "active_client_count", 0);
        search.lastEventAt = JsonString(object, "last_event_at");
        search.lastError = JsonString(object, "last_error");
        search.startedAt = JsonString(object, "started_at");
        search.completedAt = JsonString(object, "completed_at");
        search.createdAt = JsonString(object, "created_at");
        search.updatedAt = JsonString(object, "updated_at");

        if (object.contains("clients") && object["clients"].is_array())
        {
            for (auto const& item : object["clients"])
            {
                search.clients.push_back(ParseDrakonFindSearchClientSummary(item));
            }
        }

        if (object.contains("scope_snapshot") && object["scope_snapshot"].is_object())
        {
            search.scopeSnapshot = ParseDrakonFindScopeResolution(object["scope_snapshot"]);
            search.hasScopeSnapshot = true;
        }

        return search;
    }

    winrt::DrakonDesktop::services::DrakonFindHit ParseDrakonFindHit(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindHit hit;
        hit.id = JsonInt(object, "id", 0);
        hit.searchId = JsonInt(object, "search_id", 0);
        hit.targetId = JsonInt(object, "target_id", 0);
        hit.cameraId = JsonInt(object, "camera_id", 0);
        hit.cameraName = JsonString(object, "camera_name");
        hit.cameraOwnerUserId = JsonString(object, "camera_owner_user_id");
        hit.clientId = JsonString(object, "client_id");
        hit.exeId = JsonString(object, "exe_id");
        hit.cameraCity = JsonString(object, "camera_city");
        hit.cameraStateCode = JsonString(object, "camera_state_code");
        hit.summary = JsonString(object, "summary");
        hit.confidence = JsonDouble(object, "confidence", 0.0);
        hit.imageUrl = JsonString(object, "image_url");
        hit.videoUrl = JsonString(object, "video_url");
        hit.matchedAt = JsonString(object, "matched_at");
        hit.createdAt = JsonString(object, "created_at");
        if (object.contains("details") && !object["details"].is_null())
        {
            hit.detailsJson = object["details"].dump();
        }
        return hit;
    }

    winrt::DrakonDesktop::services::DrakonFindAuditLog ParseDrakonFindAuditLog(json const& object)
    {
        winrt::DrakonDesktop::services::DrakonFindAuditLog audit;
        audit.id = JsonInt(object, "id", 0);
        audit.actorUserId = JsonString(object, "actor_user_id");
        audit.actorEmail = JsonString(object, "actor_email");
        audit.actionType = JsonString(object, "action_type");
        audit.message = JsonString(object, "message");
        audit.createdAt = JsonString(object, "created_at");
        if (object.contains("target_id") && !object["target_id"].is_null())
        {
            audit.hasTargetId = true;
            audit.targetId = JsonInt(object, "target_id", 0);
        }
        if (object.contains("search_id") && !object["search_id"].is_null())
        {
            audit.hasSearchId = true;
            audit.searchId = JsonInt(object, "search_id", 0);
        }
        if (object.contains("metadata") && !object["metadata"].is_null())
        {
            audit.metadataJson = object["metadata"].dump();
        }
        return audit;
    }

    json BuildCameraPayload(winrt::DrakonDesktop::CameraRecord const& record, bool forUpdate)
    {
        auto stringOrEmpty = [](winrt::hstring const& value) { return TrimAscii(winrt::to_string(value)); };

        json payload;
        payload["name"] = stringOrEmpty(record.name);
        payload["retention_days"] = record.retentionDays > 0 ? record.retentionDays : 1;
        payload["allowpublicaccess"] = record.allowPublicAccess;
        payload["street"] = stringOrEmpty(record.street);
        payload["number"] = stringOrEmpty(record.number);
        payload["city"] = stringOrEmpty(record.city);
        payload["state"] = stringOrEmpty(record.state);
        payload["zip_code"] = stringOrEmpty(record.zipCode);
        payload["country"] = stringOrEmpty(record.country);

        if (record.IsWebcam())
        {
            payload["connection_method"] = "WEBCAM";
            payload["webcam_index"] = record.webcamIndex.has_value() ? json(*record.webcamIndex) : json(nullptr);
            if (!forUpdate)
            {
                payload["store_frames"] = true;
            }
        }
        else
        {
            auto const rtspPort = stringOrEmpty(record.rtspPort);
            auto const manufacturer = stringOrEmpty(record.manufacturer);
            auto const username = stringOrEmpty(record.username);
            auto const password = stringOrEmpty(record.password);
            auto const channel = stringOrEmpty(record.channel);
            auto const subtype = stringOrEmpty(record.subtype);
            auto const connectionMethod = stringOrEmpty(record.connectionMethod).empty()
                ? std::string("RTSP")
                : stringOrEmpty(record.connectionMethod);

            payload["ip_address"] = stringOrEmpty(record.ipAddress);
            payload["connection_method"] = connectionMethod;
            if (!forUpdate)
            {
                payload["store_frames"] = true;
            }
            if (!rtspPort.empty())
            {
                payload["rtsp_port"] = rtspPort;
            }
            if (!manufacturer.empty())
            {
                payload["manufacturer"] = manufacturer;
            }
            if (!username.empty())
            {
                payload["username"] = username;
            }
            if (!password.empty())
            {
                payload["password"] = password;
            }
            if (!channel.empty())
            {
                payload["channel"] = channel;
            }
            if (!ManufacturerLocksSubtype(manufacturer) && !subtype.empty())
            {
                payload["subtype"] = subtype;
            }
        }

        if (forUpdate)
        {
            auto const description = stringOrEmpty(record.description);
            payload["description"] = description.empty() ? json(nullptr) : json(description);
        }

        return payload;
    }
}

namespace winrt::DrakonDesktop::services
{
    DrakonApiClient& DrakonApiClient::Instance()
    {
        static DrakonApiClient instance;
        return instance;
    }

    DrakonApiClient::DrakonApiClient()
        : m_baseUrl([]() {
            auto const envCandidates = { "DRAKON_BASE_URL", "PERCEPTRUM_BASE_URL", "APP_BASE_URL" };
            for (auto const* envName : envCandidates)
            {
                auto envValue = NormalizeBaseUrl(ReadEnvVar(envName));
                if (!envValue.empty())
                {
                    return envValue;
                }
            }

            std::vector<std::filesystem::path> candidates;
            auto const exeDir = ExecutableDirectory();
            auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
            if (!runtimeConfig.serviceSessionDirectory.empty())
            {
                candidates.push_back(runtimeConfig.serviceSessionDirectory);
            }
            candidates.push_back(exeDir);
            candidates.push_back(std::filesystem::current_path());
            if (exeDir.has_parent_path()) candidates.push_back(exeDir.parent_path());
            if (exeDir.has_parent_path() && exeDir.parent_path().has_parent_path()) candidates.push_back(exeDir.parent_path().parent_path());
            if (exeDir.has_parent_path() && exeDir.parent_path().has_parent_path() && exeDir.parent_path().parent_path().has_parent_path())
            {
                candidates.push_back(exeDir.parent_path().parent_path().parent_path());
            }

            std::unordered_set<std::wstring> seen;
            auto const fileCandidates = { L"drakon_base_url.txt", L"perceptrum_base_url.txt" };
            for (auto const& directory : candidates)
            {
                if (directory.empty())
                {
                    continue;
                }

                auto key = directory.wstring();
                if (!seen.insert(key).second)
                {
                    continue;
                }

                for (auto const* fileName : fileCandidates)
                {
                    auto path = directory / fileName;
                    auto line = ReadFirstLine(path);
                    if (line.has_value())
                    {
                        auto normalized = NormalizeBaseUrl(*line);
                        if (!normalized.empty())
                        {
                            return normalized;
                        }
                    }
                }
            }

            return NormalizeBaseUrl(winrt::to_string(runtimeConfig.uiBaseUrl));
          }()),
          m_sessionCookiePath([]() {
              auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
              return runtimeConfig.serviceSessionDirectory / "drakon_desktop_session.cookie";
          }())
    {
        std::error_code errorCode;
        std::filesystem::create_directories(m_sessionCookiePath.parent_path(), errorCode);

        auto const legacyCookiePath = ExecutableDirectory() / "drakon_desktop_session.cookie";
        auto cookie = ::DrakonDesktop::platform::ReadProtectedLocalText(m_sessionCookiePath);
        if (!cookie.has_value() && legacyCookiePath != m_sessionCookiePath)
        {
            cookie = ::DrakonDesktop::platform::ReadProtectedLocalText(legacyCookiePath);
        }
        if (cookie.has_value())
        {
            m_sessionCookie = *cookie;
            ::DrakonDesktop::platform::WriteProtectedLocalText(m_sessionCookiePath, m_sessionCookie);
            if (legacyCookiePath != m_sessionCookiePath)
            {
                std::filesystem::remove(legacyCookiePath, errorCode);
            }
        }
    }

    std::string DrakonApiClient::BaseUrl() const
    {
        return m_baseUrl;
    }

    std::string DrakonApiClient::NormalizeBaseUrl(std::string value)
    {
        value = TrimAscii(std::move(value));
        while (!value.empty() && value.back() == '/')
        {
            value.pop_back();
        }
        return value;
    }

    DrakonApiClient::HttpResponse DrakonApiClient::SendRequest(
        std::string const& method,
        std::string const& path,
        std::optional<std::string> const& jsonBody,
        bool includeSessionCookie)
    {
        std::lock_guard<std::mutex> guard(m_mutex);

        HttpResponse response;
        CURL* curl = curl_easy_init();
        if (!curl)
        {
            response.error = "curl_easy_init failed";
            return response;
        }

        auto const url = m_baseUrl + path;
        std::string responseBody;
        std::vector<std::string> responseHeaders;

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteBodyCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseBody);
        curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, WriteHeaderCallback);
        curl_easy_setopt(curl, CURLOPT_HEADERDATA, &responseHeaders);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 20L);

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Accept: application/json");

        if (includeSessionCookie && !m_sessionCookie.empty())
        {
            auto const cookieHeader = "Cookie: " + m_sessionCookie;
            headers = curl_slist_append(headers, cookieHeader.c_str());
        }

        if (jsonBody.has_value())
        {
            headers = curl_slist_append(headers, "Content-Type: application/json");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody->c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(jsonBody->size()));
        }

        if (method == "POST")
        {
            curl_easy_setopt(curl, CURLOPT_POST, 1L);
        }
        else if (method != "GET")
        {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

        auto const result = curl_easy_perform(curl);
        if (result == CURLE_OK)
        {
            response.transportOk = true;
        }
        else
        {
            response.error = curl_easy_strerror(result);
        }

        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.statusCode);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        response.body = std::move(responseBody);
        response.setCookies = std::move(responseHeaders);
        return response;
    }

    ServiceValueResponse<std::string> DrakonApiClient::DetectCountry()
    {
        ServiceValueResponse<std::string> result;
        auto response = SendRequest("GET", "/api/auth/country", std::nullopt, false);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value = JsonString(parsed, "detectedCountryCode");
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid country response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::LocalLogin(std::string const& email, std::string const& password)
    {
        ServiceResponse result;
        json payload = {
            { "email", email },
            { "password", password },
        };

        auto response = SendRequest("POST", "/api/auth/local/login", payload.dump(), false);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Login failed");
            return result;
        }

        auto cookie = ExtractCookiePair(response.setCookies);
        if (cookie.empty())
        {
            result.error = "Session cookie missing in login response";
            return result;
        }

        {
            std::lock_guard<std::mutex> guard(m_mutex);
            m_sessionCookie = cookie;
            ::DrakonDesktop::platform::WriteProtectedLocalText(m_sessionCookiePath, m_sessionCookie);
        }

        result.success = true;
        return result;
    }

    ServiceResponse DrakonApiClient::LocalSignup(
        std::string const& email,
        std::string const& password,
        std::string const& countryCode)
    {
        ServiceResponse result;
        json payload = {
            { "email", email },
            { "password", password },
            { "country_code", countryCode },
        };

        auto response = SendRequest("POST", "/api/auth/local/signup", payload.dump(), false);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Signup failed");
            return result;
        }

        auto cookie = ExtractCookiePair(response.setCookies);
        if (cookie.empty())
        {
            result.error = "Session cookie missing in signup response";
            return result;
        }

        {
            std::lock_guard<std::mutex> guard(m_mutex);
            m_sessionCookie = cookie;
            ::DrakonDesktop::platform::WriteProtectedLocalText(m_sessionCookiePath, m_sessionCookie);
        }

        result.success = true;
        return result;
    }

    ServiceResponse DrakonApiClient::LocalLogout()
    {
        ServiceResponse result;
        auto response = SendRequest("POST", "/api/auth/local/logout", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        {
            std::lock_guard<std::mutex> guard(m_mutex);
            m_sessionCookie.clear();
            ::DrakonDesktop::platform::RemoveProtectedLocalText(m_sessionCookiePath);
            std::error_code errorCode;
            std::filesystem::remove(ExecutableDirectory() / "drakon_desktop_session.cookie", errorCode);
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Logout failed");
        }
        return result;
    }

    ServiceValueResponse<AuthState> DrakonApiClient::GetAuthState()
    {
        ServiceValueResponse<AuthState> result;
        auto response = SendRequest("GET", "/api/auth/me", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value.isAuthenticated = parsed.value("isAuthenticated", false);
            result.value.authProvider = JsonString(parsed, "authProvider");
            if (parsed.contains("user") && parsed["user"].is_object())
            {
                auto const& user = parsed["user"];
                result.value.userId = JsonString(user, "id");
                result.value.email = JsonString(user, "email");
                result.value.countryCode = JsonString(user, "country_code");
                result.value.createdAt = JsonString(user, "created_at");
                if (user.contains("google_user_data") && user["google_user_data"].is_object())
                {
                    result.value.displayName = JsonString(user["google_user_data"], "name");
                }
            }
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid auth state response";
            return result;
        }
    }

    ServiceValueResponse<BillingStatus> DrakonApiClient::GetBillingStatus()
    {
        ServiceValueResponse<BillingStatus> result;
        auto response = SendRequest("GET", "/api/billing/status", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load billing status");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value.hasActiveSubscription = parsed.value("hasActiveSubscription", false);
            result.value.hasActiveCard = parsed.value("hasActiveCard", false);
            result.value.canAddCameras = parsed.value("canAddCameras", false);
            result.value.activeCameras = JsonInt(parsed, "active_cameras", 0);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid billing response";
            return result;
        }
    }

    ServiceValueResponse<ApiKeySettings> DrakonApiClient::GetOpenAiSettings()
    {
        ServiceValueResponse<ApiKeySettings> result;
        auto response = SendRequest("GET", "/api/openai-settings", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load OpenAI settings");
            return result;
        }

        try
        {
            result.value = ParseApiKeySettings(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid OpenAI settings response";
            return result;
        }
    }

    ServiceValueResponse<ApiKeySettings> DrakonApiClient::SaveOpenAiSettings(
        std::optional<std::string> const& apiKey,
        bool clear)
    {
        ServiceValueResponse<ApiKeySettings> result;
        json payload = {
            { "clear", clear },
        };
        if (!clear)
        {
            payload["api_key"] = apiKey.value_or(std::string{});
        }

        auto response = SendRequest("POST", "/api/openai-settings", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to save OpenAI settings");
            return result;
        }

        try
        {
            result.value = ParseApiKeySettings(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid OpenAI settings save response";
            return result;
        }
    }

    ServiceValueResponse<ApiKeySettings> DrakonApiClient::GetZAiSettings()
    {
        ServiceValueResponse<ApiKeySettings> result;
        auto response = SendRequest("GET", "/api/zai-settings", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load Z.ai settings");
            return result;
        }

        try
        {
            result.value = ParseApiKeySettings(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Z.ai settings response";
            return result;
        }
    }

    ServiceValueResponse<ApiKeySettings> DrakonApiClient::SaveZAiSettings(
        std::optional<std::string> const& apiKey,
        bool clear)
    {
        ServiceValueResponse<ApiKeySettings> result;
        json payload = {
            { "clear", clear },
        };
        if (!clear)
        {
            payload["api_key"] = apiKey.value_or(std::string{});
        }

        auto response = SendRequest("POST", "/api/zai-settings", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to save Z.ai settings");
            return result;
        }

        try
        {
            result.value = ParseApiKeySettings(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Z.ai settings save response";
            return result;
        }
    }

    ServiceValueResponse<TelegramSettings> DrakonApiClient::GetTelegramSettings()
    {
        ServiceValueResponse<TelegramSettings> result;
        auto response = SendRequest("GET", "/api/telegram-settings", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load Telegram settings");
            return result;
        }

        try
        {
            result.value = ParseTelegramSettings(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Telegram settings response";
            return result;
        }
    }

    ServiceValueResponse<TelegramSettings> DrakonApiClient::SaveTelegramSettings(TelegramSettings const& settings)
    {
        ServiceValueResponse<TelegramSettings> result;
        json payload = {
            { "enabled", settings.enabled },
            { "chat_id", settings.chatId },
            { "bot_token", settings.botToken },
        };

        auto response = SendRequest("POST", "/api/telegram-settings", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to save Telegram settings");
            return result;
        }

        try
        {
            result.value = ParseTelegramSettings(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Telegram settings save response";
            return result;
        }
    }

    ServiceValueResponse<PairCodeSnapshot> DrakonApiClient::GeneratePairCode()
    {
        ServiceValueResponse<PairCodeSnapshot> result;
        auto response = SendRequest("POST", "/api/pairing/generate", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to generate pair code");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value.pairCode = JsonString(parsed, "pair_code");
            result.value.expiresAt = JsonString(parsed, "expires_at");
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid pair code response";
            return result;
        }
    }

    ServiceValueResponse<PairingStatusSnapshot> DrakonApiClient::GetPairingStatus()
    {
        ServiceValueResponse<PairingStatusSnapshot> result;
        auto response = SendRequest("GET", "/api/pairing/status", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load pairing status");
            return result;
        }

        try
        {
            result.value = ParsePairingStatus(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid pairing status response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::DisconnectPairing()
    {
        ServiceResponse result;
        auto response = SendRequest("POST", "/api/pairing/disconnect", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to disconnect pairing");
        }
        return result;
    }

    ServiceValueResponse<TokenBalanceSnapshot> DrakonApiClient::GetTokenBalance()
    {
        ServiceValueResponse<TokenBalanceSnapshot> result;
        auto response = SendRequest("GET", "/api/token-balance", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load token balance");
            return result;
        }

        try
        {
            result.value = ParseTokenBalance(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid token balance response";
            return result;
        }
    }

    ServiceValueResponse<MonthlyTokenUsageSummarySnapshot> DrakonApiClient::GetMonthlyTokenUsageSummary()
    {
        ServiceValueResponse<MonthlyTokenUsageSummarySnapshot> result;
        auto response = SendRequest("GET", "/api/token-usage-summary", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load monthly token usage");
            return result;
        }

        try
        {
            result.value = ParseMonthlyTokenUsageSummary(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid monthly token usage response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<PaymentRecord>> DrakonApiClient::GetPayments()
    {
        ServiceValueResponse<std::vector<PaymentRecord>> result;
        auto response = SendRequest("GET", "/api/payments", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load payments");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.is_array())
            {
                result.error = "Unexpected payments payload";
                return result;
            }

            for (auto const& item : parsed)
            {
                result.value.push_back(ParsePaymentRecord(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid payments response";
            return result;
        }
    }

    ServiceValueResponse<SubscriptionSnapshot> DrakonApiClient::GetActiveSubscription()
    {
        ServiceValueResponse<SubscriptionSnapshot> result;
        auto response = SendRequest("GET", "/api/subscriptions/me", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load subscription");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (parsed.is_null())
            {
                result.success = true;
                return result;
            }

            if (!parsed.is_object())
            {
                result.error = "Unexpected subscription payload";
                return result;
            }

            result.value = ParseSubscription(parsed);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid subscription response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<BillingCard>> DrakonApiClient::GetBillingCards()
    {
        ServiceValueResponse<std::vector<BillingCard>> result;
        auto response = SendRequest("GET", "/api/billing/cards", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load billing cards");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.is_array())
            {
                result.error = "Unexpected billing cards payload";
                return result;
            }

            for (auto const& item : parsed)
            {
                result.value.push_back(ParseBillingCard(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid billing cards response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::CancelSubscription()
    {
        ServiceResponse result;
        auto response = SendRequest("POST", "/api/billing/cancel-subscription", json::object().dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to cancel subscription");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::RemoveBillingCard(int32_t cardId)
    {
        ServiceResponse result;
        json payload = {
            { "card_id", cardId },
        };

        auto response = SendRequest("POST", "/api/billing/remove-card", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to remove billing card");
        }
        return result;
    }

    ServiceValueResponse<std::string> DrakonApiClient::CreateCreditsCheckoutSession(
        int32_t creditsAmount,
        std::string const& tokenType)
    {
        ServiceValueResponse<std::string> result;
        json payload = {
            { "type", "credits" },
            { "credits_amount", creditsAmount },
            { "token_type", tokenType },
        };

        auto response = SendRequest("POST", "/api/stripe/create-checkout-session", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create credits checkout session");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value = JsonString(parsed, "url");
            result.success = !result.value.empty();
            if (!result.success)
            {
                result.error = "Checkout session did not return a URL";
            }
            return result;
        }
        catch (...)
        {
            result.error = "Invalid credits checkout response";
            return result;
        }
    }

    ServiceValueResponse<std::string> DrakonApiClient::CreateSubscriptionCheckoutSession(
        std::string const& planTier,
        int32_t secondsPerFrame,
        int32_t cameraCount)
    {
        ServiceValueResponse<std::string> result;
        json payload = {
            { "type", "subscription" },
            { "camera_id", 1 },
            { "plan_tier", planTier },
            { "camera_count", cameraCount },
            { "metadata", {
                { "model_tier", planTier },
                { "seconds_per_frame", secondsPerFrame },
                { "camera_count", cameraCount },
            } },
        };

        auto response = SendRequest("POST", "/api/stripe/create-checkout-session", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create subscription checkout session");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value = JsonString(parsed, "url");
            result.success = !result.value.empty();
            if (!result.success)
            {
                result.error = "Checkout session did not return a URL";
            }
            return result;
        }
        catch (...)
        {
            result.error = "Invalid subscription checkout response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<JobRecord>> DrakonApiClient::GetJobs()
    {
        ServiceValueResponse<std::vector<JobRecord>> result;
        auto response = SendRequest("GET", "/api/jobs", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load jobs");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("jobs") || !parsed["jobs"].is_array())
            {
                result.error = "Unexpected jobs payload";
                return result;
            }

            for (auto const& item : parsed["jobs"])
            {
                result.value.push_back(ParseJobRecord(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid jobs response";
            return result;
        }
    }

    ServiceValueResponse<JobRecord> DrakonApiClient::CreateJob(JobMutationRequest const& request)
    {
        ServiceValueResponse<JobRecord> result;
        auto response = SendRequest("POST", "/api/jobs", BuildJobMutationPayload(request).dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create job");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("job") || !parsed["job"].is_object())
            {
                result.error = "Unexpected create job payload";
                return result;
            }

            result.value = ParseJobRecord(parsed["job"]);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid create job response";
            return result;
        }
    }

    ServiceValueResponse<JobRecord> DrakonApiClient::UpdateJob(int32_t jobId, JobMutationRequest const& request)
    {
        ServiceValueResponse<JobRecord> result;
        auto path = "/api/jobs/" + std::to_string(jobId);
        auto response = SendRequest("PUT", path, BuildJobMutationPayload(request).dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to update job");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("job") || !parsed["job"].is_object())
            {
                result.error = "Unexpected update job payload";
                return result;
            }

            result.value = ParseJobRecord(parsed["job"]);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid update job response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::DeleteJob(int32_t jobId)
    {
        ServiceResponse result;
        auto path = "/api/jobs/" + std::to_string(jobId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete job");
            return result;
        }

        result.success = true;
        return result;
    }

    ServiceResponse DrakonApiClient::StartJob(int32_t jobId)
    {
        ServiceResponse result;
        auto path = "/api/jobs/" + std::to_string(jobId) + "/start";
        auto response = SendRequest("POST", path, json::object().dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to start job");
            return result;
        }

        result.success = true;
        return result;
    }

    ServiceResponse DrakonApiClient::StopJob(int32_t jobId)
    {
        ServiceResponse result;
        auto path = "/api/jobs/" + std::to_string(jobId) + "/stop";
        auto response = SendRequest("POST", path, json::object().dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to stop job");
            return result;
        }

        result.success = true;
        return result;
    }

    ServiceValueResponse<std::vector<JobStepRecord>> DrakonApiClient::GetJobSteps(int32_t jobId)
    {
        ServiceValueResponse<std::vector<JobStepRecord>> result;
        auto path = "/api/jobs/" + std::to_string(jobId) + "/steps";
        auto response = SendRequest("GET", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load job steps");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("steps") || !parsed["steps"].is_array())
            {
                result.error = "Unexpected job steps payload";
                return result;
            }

            for (auto const& item : parsed["steps"])
            {
                result.value.push_back(ParseJobStepRecord(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid job steps response";
            return result;
        }
    }

    ServiceValueResponse<JobStepRecord> DrakonApiClient::CreateJobStep(int32_t jobId, JobStepMutationRequest const& request)
    {
        ServiceValueResponse<JobStepRecord> result;
        auto path = "/api/jobs/" + std::to_string(jobId) + "/steps";
        json payload = {
            { "step_order", request.stepOrder },
            { "name", request.name },
            { "timeout_seconds", request.timeoutSeconds },
        };

        auto response = SendRequest("POST", path, payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create job step");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("step") || !parsed["step"].is_object())
            {
                result.error = "Unexpected create step payload";
                return result;
            }

            result.value = ParseJobStepRecord(parsed["step"]);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid create step response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::DeleteJobStep(int32_t stepId)
    {
        ServiceResponse result;
        auto path = "/api/job-steps/" + std::to_string(stepId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete job step");
            return result;
        }

        result.success = true;
        return result;
    }

    ServiceValueResponse<DashboardSnapshot> DrakonApiClient::GetDashboard()
    {
        ServiceValueResponse<DashboardSnapshot> result;
        auto response = SendRequest("GET", "/api/dashboard", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load dashboard");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            auto const* dashboardObject = parsed.contains("dashboard") && parsed["dashboard"].is_object()
                ? &parsed["dashboard"]
                : &parsed;

            if (auto const* stats = FindObject(*dashboardObject, { "stats" }))
            {
                result.value.camerasTotal = JsonInt(*stats, "cameras_total", 0);
                result.value.camerasRunning = JsonInt(*stats, "cameras_running", 0);
                result.value.jobsTotal = JsonInt(*stats, "jobs_total", 0);
                result.value.jobsRunning = JsonInt(*stats, "jobs_running", 0);
                result.value.agentsEnabledTotal = JsonInt(*stats, "agents_enabled_total", 0);
                result.value.unreadAlerts = JsonInt(*stats, "unread_alerts", 0);
                result.value.detections24hTotal = JsonInt(*stats, "detections_24h_total", 0);
                result.value.pendingCommands = JsonInt(*stats, "pending_commands", 0);
                result.value.stepsRunning = JsonInt(*stats, "steps_running", 0);
            }

            result.value.lastUpdatedAt = CoalesceString({
                JsonString(parsed, "lastUpdatedAt"),
                JsonString(*dashboardObject, "lastUpdatedAt"),
            });

            if (auto const* recentAlerts = FindObject(*dashboardObject, { "activity", "recentAlerts" });
                recentAlerts && recentAlerts->is_array())
            {
                for (auto const& item : *recentAlerts)
                {
                    auto id = JsonInt(item, "id", 0);
                    auto title = CoalesceString({
                        id > 0 ? "#" + std::to_string(id) + " • " + JsonString(item, "message") : std::string{},
                        JsonString(item, "message"),
                        JsonString(item, "title"),
                        JsonString(item, "event_type"),
                    });

                    auto cameraName = CoalesceString({
                        JsonString(item, "camera_name"),
                        JsonString(item, "cameraName"),
                    });
                    auto priority = CoalesceString({
                        JsonString(item, "priority"),
                        JsonString(item, "severity"),
                    });
                    auto createdAt = CoalesceString({
                        JsonString(item, "created_at"),
                        JsonString(item, "detected_at"),
                    });

                    std::vector<std::string> subtitleParts;
                    if (!cameraName.empty()) subtitleParts.push_back(cameraName);
                    if (!priority.empty()) subtitleParts.push_back(priority);
                    if (!createdAt.empty()) subtitleParts.push_back(createdAt);

                    std::ostringstream subtitle;
                    for (size_t index = 0; index < subtitleParts.size(); ++index)
                    {
                        if (index > 0)
                        {
                            subtitle << " • ";
                        }
                        subtitle << subtitleParts[index];
                    }

                    result.value.recentAlerts.push_back({
                        title.empty() ? std::string("Recent alert") : title,
                        subtitle.str(),
                    });

                    if (result.value.recentAlerts.size() >= 3)
                    {
                        break;
                    }
                }
            }

            if (auto const* captureThreads = FindObject(*dashboardObject, { "captureThreads" });
                captureThreads && captureThreads->is_array())
            {
                for (auto const& item : *captureThreads)
                {
                    auto title = CoalesceString({
                        JsonString(item, "thread_name"),
                        JsonString(item, "camera_name"),
                    });

                    auto queueDepth = JsonInt(item, "queue_depth", 0);
                    auto cpuPercent = JsonDouble(item, "cpu_percent", 0.0);
                    auto memoryBytes = (std::max)(
                        static_cast<int64_t>(JsonDouble(item, "process_working_set_bytes", 0.0)),
                        static_cast<int64_t>((std::max)(
                            JsonDouble(item, "process_private_bytes", 0.0),
                            JsonDouble(item, "capture_mem_estimated_bytes", 0.0))));
                    auto memoryMb = memoryBytes > 0 ? static_cast<double>(memoryBytes) / (1024.0 * 1024.0) : 0.0;

                    result.value.captureThreads.push_back({
                        title.empty() ? std::string("capture-thread") : title,
                        "queue_depth " + std::to_string(queueDepth) +
                            " • cpu " + FormatDecimal(cpuPercent) + "%" +
                            " • memory " + FormatDecimal(memoryMb, memoryMb >= 100.0 ? 0 : 1) + " MB",
                    });

                    if (result.value.captureThreads.size() >= 2)
                    {
                        break;
                    }
                }
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid dashboard response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<winrt::DrakonDesktop::CameraRecord>> DrakonApiClient::GetCameras()
    {
        ServiceValueResponse<std::vector<winrt::DrakonDesktop::CameraRecord>> result;
        auto response = SendRequest("GET", "/api/cameras", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load cameras");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.is_array())
            {
                result.error = "Unexpected camera list payload";
                return result;
            }

            for (auto const& item : parsed)
            {
                result.value.push_back(ParseCameraRecord(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid cameras response";
            return result;
        }
    }

    ServiceValueResponse<StartCameraResult> DrakonApiClient::StartCamera(int32_t cameraId)
    {
        ServiceValueResponse<StartCameraResult> result;
        auto path = "/api/cameras/" + std::to_string(cameraId) + "/start";
        auto response = SendRequest("POST", path, json::object().dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to start camera");
            return result;
        }

        try
        {
            result.value = ParseStartCameraResult(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid start camera response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::EnqueueCommand(
        std::string const& commandType,
        std::optional<int32_t> cameraId,
        std::string const& payloadJson)
    {
        ServiceResponse result;
        json payload = {
            { "command_type", commandType },
            { "payload", payloadJson },
        };
        if (cameraId.has_value())
        {
            payload["camera_id"] = *cameraId;
        }

        auto response = SendRequest("POST", "/api/commands", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to enqueue command");
        }
        return result;
    }

    ServiceValueResponse<winrt::DrakonDesktop::CameraRecord> DrakonApiClient::CreateCamera(winrt::DrakonDesktop::CameraRecord const& record)
    {
        ServiceValueResponse<winrt::DrakonDesktop::CameraRecord> result;
        auto response = SendRequest("POST", "/api/cameras", BuildCameraPayload(record, false).dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create camera");
            return result;
        }

        try
        {
            result.value = ParseCameraRecord(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid camera create response";
            return result;
        }
    }

    ServiceValueResponse<winrt::DrakonDesktop::CameraRecord> DrakonApiClient::UpdateCamera(winrt::DrakonDesktop::CameraRecord const& record)
    {
        ServiceValueResponse<winrt::DrakonDesktop::CameraRecord> result;
        auto path = "/api/cameras/" + std::to_string(record.id);
        auto response = SendRequest("PATCH", path, BuildCameraPayload(record, true).dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to update camera");
            return result;
        }

        try
        {
            result.value = ParseCameraRecord(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid camera update response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::DeleteCamera(int32_t cameraId)
    {
        ServiceResponse result;
        auto path = "/api/cameras/" + std::to_string(cameraId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete camera");
        }
        return result;
    }

    ServiceValueResponse<std::vector<ChatSessionRecord>> DrakonApiClient::GetChatSessions()
    {
        ServiceValueResponse<std::vector<ChatSessionRecord>> result;
        auto response = SendRequest("GET", "/api/chat/sessions", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load chat sessions");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.is_array())
            {
                result.error = "Unexpected chat sessions payload";
                return result;
            }

            for (auto const& item : parsed)
            {
                result.value.push_back(ParseChatSession(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid chat sessions response";
            return result;
        }
    }

    ServiceValueResponse<ChatSessionRecord> DrakonApiClient::CreateChatSession(std::optional<std::string> const& title)
    {
        ServiceValueResponse<ChatSessionRecord> result;
        json payload = json::object();
        if (title.has_value() && !TrimAscii(*title).empty())
        {
            payload["title"] = TrimAscii(*title);
        }

        auto response = SendRequest("POST", "/api/chat/sessions", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create chat session");
            return result;
        }

        try
        {
            result.value = ParseChatSession(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid create chat session response";
            return result;
        }
    }

    ServiceValueResponse<ChatSessionRecord> DrakonApiClient::RenameChatSession(int32_t sessionId, std::string const& title)
    {
        ServiceValueResponse<ChatSessionRecord> result;
        json payload = {
            { "title", TrimAscii(title) },
        };
        auto path = "/api/chat/sessions/" + std::to_string(sessionId);
        auto response = SendRequest("PATCH", path, payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to rename chat session");
            return result;
        }

        try
        {
            result.value = ParseChatSession(json::parse(response.body));
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid rename chat session response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::DeleteChatSession(int32_t sessionId)
    {
        ServiceResponse result;
        auto path = "/api/chat/sessions/" + std::to_string(sessionId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete chat session");
        }
        return result;
    }

    ServiceValueResponse<std::vector<ChatMessageRecord>> DrakonApiClient::GetChatMessages(int32_t sessionId)
    {
        ServiceValueResponse<std::vector<ChatMessageRecord>> result;
        auto path = "/api/chat/sessions/" + std::to_string(sessionId) + "/messages";
        auto response = SendRequest("GET", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load chat messages");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.is_array())
            {
                result.error = "Unexpected chat messages payload";
                return result;
            }

            for (auto const& item : parsed)
            {
                result.value.push_back(ParseChatMessage(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid chat messages response";
            return result;
        }
    }

    ServiceValueResponse<ChatSendResult> DrakonApiClient::SendChatMessage(int32_t sessionId, ChatSendRequest const& request)
    {
        ServiceValueResponse<ChatSendResult> result;
        json payload = {
            { "content", request.content },
            { "model_tier", request.modelTier },
            { "model_fps", request.modelFps },
        };

        if (request.cameraId.has_value())
        {
            payload["camera_id"] = *request.cameraId;
        }
        if (request.uploadedImageBase64.has_value())
        {
            payload["uploaded_image_base64"] = *request.uploadedImageBase64;
        }
        if (request.uploadedVideoId.has_value())
        {
            payload["uploaded_video_id"] = *request.uploadedVideoId;
        }
        if (request.runningResolution.has_value())
        {
            payload["running_resolution"] = *request.runningResolution;
        }

        auto path = "/api/chat/sessions/" + std::to_string(sessionId) + "/messages";
        auto response = SendRequest("POST", path, payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to send chat message");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            result.value.warning = JsonString(parsed, "warning");
            result.value.warningCode = JsonString(parsed, "warning_code");

            if (!parsed.contains("messages") || !parsed["messages"].is_array())
            {
                result.error = "Unexpected send chat response";
                return result;
            }

            for (auto const& item : parsed["messages"])
            {
                result.value.messages.push_back(ParseChatMessage(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid send chat response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::CancelChatSession(int32_t sessionId, std::string const& reason)
    {
        ServiceResponse result;
        json payload = {
            { "reason", TrimAscii(reason) },
        };
        auto path = "/api/chat/sessions/" + std::to_string(sessionId) + "/cancel";
        auto response = SendRequest("POST", path, payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to cancel chat session");
        }
        return result;
    }

    ServiceValueResponse<std::vector<DrakonFindTarget>> DrakonApiClient::GetDrakonFindTargets()
    {
        ServiceValueResponse<std::vector<DrakonFindTarget>> result;
        auto response = SendRequest("GET", "/api/drakon-find/targets", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load Drakon Find targets");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("targets") || !parsed["targets"].is_array())
            {
                result.error = "Unexpected Drakon Find targets payload";
                return result;
            }

            for (auto const& item : parsed["targets"])
            {
                result.value.push_back(ParseDrakonFindTarget(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Drakon Find targets response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<DrakonFindSearch>> DrakonApiClient::GetDrakonFindSearches()
    {
        ServiceValueResponse<std::vector<DrakonFindSearch>> result;
        auto response = SendRequest("GET", "/api/drakon-find/searches", std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load Drakon Find searches");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("searches") || !parsed["searches"].is_array())
            {
                result.error = "Unexpected Drakon Find searches payload";
                return result;
            }

            for (auto const& item : parsed["searches"])
            {
                result.value.push_back(ParseDrakonFindSearch(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Drakon Find searches response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<DrakonFindAuditLog>> DrakonApiClient::GetDrakonFindAuditLog(int32_t limit)
    {
        ServiceValueResponse<std::vector<DrakonFindAuditLog>> result;
        auto path = "/api/drakon-find/audit?limit=" + std::to_string((std::max)(limit, 1));
        auto response = SendRequest("GET", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load Drakon Find audit");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("audit") || !parsed["audit"].is_array())
            {
                result.error = "Unexpected Drakon Find audit payload";
                return result;
            }

            for (auto const& item : parsed["audit"])
            {
                result.value.push_back(ParseDrakonFindAuditLog(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Drakon Find audit response";
            return result;
        }
    }

    ServiceValueResponse<std::vector<DrakonFindHit>> DrakonApiClient::GetDrakonFindHits(int32_t limit)
    {
        ServiceValueResponse<std::vector<DrakonFindHit>> result;
        auto path = "/api/drakon-find/hits?limit=" + std::to_string((std::max)(limit, 1));
        auto response = SendRequest("GET", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to load Drakon Find hits");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("hits") || !parsed["hits"].is_array())
            {
                result.error = "Unexpected Drakon Find hits payload";
                return result;
            }

            for (auto const& item : parsed["hits"])
            {
                result.value.push_back(ParseDrakonFindHit(item));
            }

            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Drakon Find hits response";
            return result;
        }
    }

    ServiceValueResponse<DrakonFindScopeResolution> DrakonApiClient::ResolveDrakonFindScope(
        std::string const& countryCode,
        std::vector<std::string> const& selectedStates,
        std::vector<int32_t> const& excludedCameraIds)
    {
        ServiceValueResponse<DrakonFindScopeResolution> result;
        json payload = {
            { "country_code", TrimAscii(countryCode).empty() ? "BR" : TrimAscii(countryCode) },
            { "selected_states", selectedStates },
            { "excluded_camera_ids", excludedCameraIds },
        };

        auto response = SendRequest("POST", "/api/drakon-find/scope/resolve", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to resolve Drakon Find scope");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("scope") || !parsed["scope"].is_object())
            {
                result.error = "Unexpected Drakon Find scope payload";
                return result;
            }

            result.value = ParseDrakonFindScopeResolution(parsed["scope"]);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Drakon Find scope response";
            return result;
        }
    }

    ServiceValueResponse<DrakonFindTarget> DrakonApiClient::CreateDrakonFindTarget(DrakonFindCreateTargetRequest const& request)
    {
        ServiceValueResponse<DrakonFindTarget> result;
        json payload = {
            { "entity_type", TrimAscii(request.entityType) },
            { "name", TrimAscii(request.name) },
            { "description", TrimAscii(request.description) },
            { "traits", request.traits },
        };

        auto response = SendRequest("POST", "/api/drakon-find/targets", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        if (response.statusCode < 200 || response.statusCode >= 300)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create Drakon Find target");
            return result;
        }

        try
        {
            auto parsed = json::parse(response.body);
            if (!parsed.contains("target") || !parsed["target"].is_object())
            {
                result.error = "Unexpected Drakon Find target create payload";
                return result;
            }

            result.value = ParseDrakonFindTarget(parsed["target"]);
            result.success = true;
            return result;
        }
        catch (...)
        {
            result.error = "Invalid Drakon Find target create response";
            return result;
        }
    }

    ServiceResponse DrakonApiClient::DeleteDrakonFindTarget(int32_t targetId)
    {
        ServiceResponse result;
        auto path = "/api/drakon-find/targets/" + std::to_string(targetId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete Drakon Find target");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::DeleteDrakonFindTargetImage(int32_t targetId, int32_t imageId)
    {
        ServiceResponse result;
        auto path = "/api/drakon-find/targets/" + std::to_string(targetId) + "/images/" + std::to_string(imageId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete Drakon Find target image");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::CreateDrakonFindSearch(DrakonFindCreateSearchRequest const& request)
    {
        ServiceResponse result;
        json payload = {
            { "target_id", request.targetId },
            { "country_code", TrimAscii(request.countryCode).empty() ? "BR" : TrimAscii(request.countryCode) },
            { "selected_states", request.selectedStates },
            { "duration_seconds", request.durationSeconds > 0 ? request.durationSeconds : 1800 },
            { "excluded_camera_ids", request.excludedCameraIds },
        };

        auto response = SendRequest("POST", "/api/drakon-find/searches", payload.dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to create Drakon Find search");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::CancelDrakonFindSearch(int32_t searchId)
    {
        ServiceResponse result;
        auto path = "/api/drakon-find/searches/" + std::to_string(searchId) + "/cancel";
        auto response = SendRequest("POST", path, json::object().dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to cancel Drakon Find search");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::RetryDrakonFindSearch(int32_t searchId)
    {
        ServiceResponse result;
        auto path = "/api/drakon-find/searches/" + std::to_string(searchId) + "/retry";
        auto response = SendRequest("POST", path, json::object().dump(), true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to retry Drakon Find search");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::DeleteDrakonFindSearch(int32_t searchId)
    {
        ServiceResponse result;
        auto path = "/api/drakon-find/searches/" + std::to_string(searchId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete Drakon Find search");
        }
        return result;
    }

    ServiceResponse DrakonApiClient::DeleteDrakonFindHit(int32_t hitId)
    {
        ServiceResponse result;
        auto path = "/api/drakon-find/hits/" + std::to_string(hitId);
        auto response = SendRequest("DELETE", path, std::nullopt, true);
        result.statusCode = response.statusCode;

        if (!response.transportOk)
        {
            result.error = response.error;
            return result;
        }

        result.success = response.statusCode >= 200 && response.statusCode < 300;
        if (!result.success)
        {
            result.error = JsonErrorMessage(response.body, response.statusCode, "Failed to delete Drakon Find hit");
        }
        return result;
    }
}
