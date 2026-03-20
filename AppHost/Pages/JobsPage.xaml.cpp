#include "pch.h"
#include "JobsPage.xaml.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <sstream>
#include <unordered_map>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;

namespace
{
    constexpr int32_t JobsPollIntervalSeconds = 10;
    constexpr int32_t HttpUnauthorized = 401;
    constexpr int32_t HttpForbidden = 403;

    Brush LookupBrush(hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Brush>();
    }

    Style LookupStyle(hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Style>();
    }

    bool RequiresInteractiveLogin(winrt::DrakonDesktop::services::ServiceValueResponse<winrt::DrakonDesktop::services::AuthState> const& auth)
    {
        return auth.statusCode == HttpUnauthorized ||
            auth.statusCode == HttpForbidden ||
            (auth.success && !auth.value.isAuthenticated);
    }

    std::string TrimAsciiJobs(std::string value)
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

    std::string LowerAsciiJobs(std::string value)
    {
        std::transform(
            value.begin(),
            value.end(),
            value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    std::vector<std::string> SplitList(std::string value, char separator)
    {
        std::vector<std::string> parts;
        std::stringstream stream(value);
        std::string token;
        while (std::getline(stream, token, separator))
        {
            token = TrimAsciiJobs(token);
            if (!token.empty())
            {
                parts.push_back(token);
            }
        }
        return parts;
    }

    std::string FormatDateTimeShort(std::string value)
    {
        if (value.empty())
        {
            return "--";
        }
        std::replace(value.begin(), value.end(), 'T', ' ');
        if (value.size() >= 16)
        {
            return value.substr(0, 16);
        }
        return value;
    }

    std::string JobStatusLabel(std::string status)
    {
        auto normalized = LowerAsciiJobs(std::move(status));
        if (normalized == "draft") return "Draft";
        if (normalized == "scheduled") return "Scheduled";
        if (normalized == "active") return "Active";
        if (normalized == "paused") return "Paused";
        if (normalized == "failed") return "Failed";
        if (normalized == "completed") return "Completed";
        if (normalized.empty()) return "Unknown";
        return normalized;
    }

    std::string RuntimeStatusLabel(std::string status)
    {
        auto normalized = LowerAsciiJobs(std::move(status));
        if (normalized == "running") return "Running";
        if (normalized == "stopping") return "Stopping";
        if (normalized == "stopped") return "Stopped";
        if (normalized == "failed") return "Failed";
        if (normalized == "completed") return "Completed";
        if (normalized == "staled") return "Staled";
        return normalized.empty() ? std::string("idle") : normalized;
    }

    Brush StatusBrushForJob(std::string const& status, std::string const& runtimeStatus)
    {
        auto runtime = LowerAsciiJobs(runtimeStatus);
        if (runtime == "running")
        {
            return LookupBrush(L"DrakonAccentBrush");
        }
        if (runtime == "stopping")
        {
            return LookupBrush(L"DrakonWarningBrush");
        }
        if (runtime == "failed")
        {
            return LookupBrush(L"DrakonDangerBrush");
        }

        auto normalized = LowerAsciiJobs(status);
        if (normalized == "scheduled" || normalized == "active")
        {
            return LookupBrush(L"DrakonSuccessBrush");
        }
        if (normalized == "failed")
        {
            return LookupBrush(L"DrakonDangerBrush");
        }
        return LookupBrush(L"DrakonMutedBrush");
    }

    std::string FormatTimeoutHuman(int32_t seconds)
    {
        if (seconds <= 0) return "--";
        if (seconds % 3600 == 0) return std::to_string(seconds / 3600) + " h";
        if (seconds % 60 == 0) return std::to_string(seconds / 60) + " min";
        return std::to_string(seconds) + " s";
    }

    std::optional<int32_t> ParsePositiveInt(std::string const& value)
    {
        try
        {
            auto parsed = std::stoi(value);
            if (parsed > 0)
            {
                return parsed;
            }
        }
        catch (...)
        {
        }
        return std::nullopt;
    }

    bool TryParseTimeWindow(
        std::string const& token,
        winrt::DrakonDesktop::services::JobScheduleWindow& window,
        std::string& error)
    {
        auto trimmed = TrimAsciiJobs(token);
        auto dash = trimmed.find('-');
        if (dash == std::string::npos)
        {
            error = "Each schedule window must use HH:MM-HH:MM format.";
            return false;
        }

        auto start = TrimAsciiJobs(trimmed.substr(0, dash));
        auto end = TrimAsciiJobs(trimmed.substr(dash + 1));
        auto isTime = [](std::string const& value)
        {
            return value.size() == 5 &&
                std::isdigit(static_cast<unsigned char>(value[0])) &&
                std::isdigit(static_cast<unsigned char>(value[1])) &&
                value[2] == ':' &&
                std::isdigit(static_cast<unsigned char>(value[3])) &&
                std::isdigit(static_cast<unsigned char>(value[4]));
        };

        if (!isTime(start) || !isTime(end) || start >= end)
        {
            error = "Invalid schedule window. Use HH:MM-HH:MM with start before end.";
            return false;
        }

        window.startTime = start;
        window.endTime = end;
        return true;
    }

    bool TryMapWeekday(std::string const& token, int32_t& dayOfWeek, std::string& dayName)
    {
        static const std::vector<std::pair<std::string, std::pair<int32_t, std::string>>> kDays = {
            { "sunday", { 0, "Sunday" } },
            { "monday", { 1, "Monday" } },
            { "tuesday", { 2, "Tuesday" } },
            { "wednesday", { 3, "Wednesday" } },
            { "thursday", { 4, "Thursday" } },
            { "friday", { 5, "Friday" } },
            { "saturday", { 6, "Saturday" } },
        };

        auto normalized = LowerAsciiJobs(token);
        for (auto const& [key, value] : kDays)
        {
            if (normalized == key)
            {
                dayOfWeek = value.first;
                dayName = value.second;
                return true;
            }
        }
        return false;
    }

    int32_t ReadTaggedInt32(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }
        return 0;
    }

    std::vector<winrt::DrakonDesktop::services::JobStepRecord> BuildFallbackSteps(int32_t jobId)
    {
        using winrt::DrakonDesktop::services::JobStepRecord;

        if (jobId == 501)
        {
            JobStepRecord first;
            first.id = 7001;
            first.jobId = jobId;
            first.stepOrder = 1;
            first.name = "Observe terminal cameras";
            first.timeoutSeconds = 1800;
            first.status = "draft";

            JobStepRecord second;
            second.id = 7002;
            second.jobId = jobId;
            second.stepOrder = 2;
            second.name = "Dispatch alert summary";
            second.timeoutSeconds = 600;
            second.status = "draft";
            second.hasInputFromStepId = true;
            second.inputFromStepId = 7001;

            return { first, second };
        }

        JobStepRecord first;
        first.id = 7101;
        first.jobId = jobId;
        first.stepOrder = 1;
        first.name = "Check parking occupancy";
        first.timeoutSeconds = 900;
        first.status = "scheduled";
        return { first };
    }

    bool TryParseScheduleText(
        std::string const& mode,
        std::string text,
        std::vector<winrt::DrakonDesktop::services::JobScheduleDay>& days,
        std::string& error)
    {
        using winrt::DrakonDesktop::services::JobScheduleDay;
        using winrt::DrakonDesktop::services::JobScheduleWindow;

        for (auto& ch : text)
        {
            if (ch == '\r' || ch == '\n')
            {
                ch = ';';
            }
        }

        auto entries = SplitList(text, ';');
        if (entries.empty())
        {
            error = "Schedule text is required.";
            return false;
        }

        auto normalizedMode = LowerAsciiJobs(mode);
        for (auto const& entry : entries)
        {
            auto firstSpace = entry.find(' ');
            if (firstSpace == std::string::npos)
            {
                error = "Each schedule line must contain a key and at least one time window.";
                return false;
            }

            auto head = TrimAsciiJobs(entry.substr(0, firstSpace));
            auto windowsPart = TrimAsciiJobs(entry.substr(firstSpace + 1));
            auto windowTokens = SplitList(windowsPart, ',');
            if (windowTokens.empty())
            {
                error = "Each schedule line must include at least one HH:MM-HH:MM window.";
                return false;
            }

            JobScheduleDay day;
            if (normalizedMode == "weekly")
            {
                if (!TryMapWeekday(head, day.dayOfWeek, day.dayName))
                {
                    error = "Weekly schedule must start with weekday names like Monday or Friday.";
                    return false;
                }
            }
            else if (normalizedMode == "monthly")
            {
                auto dayOfMonth = ParsePositiveInt(head);
                if (!dayOfMonth.has_value() || *dayOfMonth > 31)
                {
                    error = "Monthly schedule must use a day of month between 1 and 31.";
                    return false;
                }
                day.dayOfMonth = *dayOfMonth;
                day.dayName = "Day " + std::to_string(*dayOfMonth);
            }
            else
            {
                auto divider = head.find('/');
                if (divider == std::string::npos)
                {
                    divider = head.find('-');
                }
                if (divider == std::string::npos)
                {
                    error = "Yearly schedule must use MM/DD or MM-DD.";
                    return false;
                }

                auto month = ParsePositiveInt(head.substr(0, divider));
                auto dayOfMonth = ParsePositiveInt(head.substr(divider + 1));
                if (!month.has_value() || !dayOfMonth.has_value() || *month > 12 || *dayOfMonth > 31)
                {
                    error = "Yearly schedule must use valid month/day values.";
                    return false;
                }
                day.monthOfYear = *month;
                day.dayOfMonth = *dayOfMonth;
                day.dayName = head;
            }

            for (auto const& windowToken : windowTokens)
            {
                JobScheduleWindow window;
                if (!TryParseTimeWindow(windowToken, window, error))
                {
                    return false;
                }
                day.windows.push_back(window);
            }

            days.push_back(day);
        }

        return !days.empty();
    }

    std::string BuildScheduleEditorText(winrt::DrakonDesktop::services::JobRecord const& job)
    {
        std::ostringstream stream;
        bool firstLine = true;
        for (auto const& day : job.scheduleDays)
        {
            if (!firstLine)
            {
                stream << "; ";
            }
            firstLine = false;

            auto mode = LowerAsciiJobs(job.scheduleMode);
            if (mode == "weekly")
            {
                stream << (day.dayName.empty() ? "Monday" : day.dayName);
            }
            else if (mode == "monthly")
            {
                stream << (day.dayOfMonth > 0 ? std::to_string(day.dayOfMonth) : "1");
            }
            else
            {
                auto month = day.monthOfYear > 0 ? day.monthOfYear : 1;
                auto dayOfMonth = day.dayOfMonth > 0 ? day.dayOfMonth : 1;
                stream << month << "/" << dayOfMonth;
            }

            stream << ' ';
            for (size_t index = 0; index < day.windows.size(); ++index)
            {
                if (index > 0)
                {
                    stream << ", ";
                }
                stream << day.windows[index].startTime << "-" << day.windows[index].endTime;
            }
        }
        return stream.str();
    }
}

namespace winrt::DrakonDesktop::implementation
{
    JobsPage::JobsPage()
    {
        InitializeComponent();
        PopulateSelectors();
        InitializeFallbackData();
        WireUpActions();
        UpdateMetrics();
        RenderJobs();
        RenderSelectedJob();
        RenderSteps();
        SizeChanged({ this, &JobsPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());

        m_pollTimer = DispatcherTimer();
        m_pollTimer.Interval(std::chrono::seconds(JobsPollIntervalSeconds));
        m_pollTimer.Tick({ this, &JobsPage::OnPollTimerTick });
        m_pollTimer.Start();

        RefreshJobsAsync(false);
    }

    void JobsPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/JobsPage.xaml" });

        m_initialized = true;
    }

    void JobsPage::PopulateSelectors()
    {
        auto populate = [&](ComboBox const& combo)
        {
            combo.Items().Clear();
            for (auto const& [label, tag] : {
                     std::pair{ L"Weekly", L"weekly" },
                     std::pair{ L"Monthly", L"monthly" },
                     std::pair{ L"Yearly", L"yearly" } })
            {
                ComboBoxItem item;
                item.Content(box_value(label));
                item.Tag(box_value(tag));
                combo.Items().Append(item);
            }
            combo.SelectedIndex(0);
        };

        populate(FindName(L"CreateScheduleModeComboBox").as<ComboBox>());
        populate(FindName(L"EditScheduleModeComboBox").as<ComboBox>());
    }

    void JobsPage::InitializeFallbackData()
    {
        m_jobs.clear();
        m_cameras.clear();
        m_steps.clear();

        CameraRecord cameraA;
        cameraA.id = 91;
        cameraA.name = L"Manaus Terminal";
        m_cameras.push_back(cameraA);

        CameraRecord cameraB;
        cameraB.id = 92;
        cameraB.name = L"Belem Logistics";
        m_cameras.push_back(cameraB);

        services::JobRecord first;
        first.id = 501;
        first.name = "Terminal safety watch";
        first.description = "Monitor public terminal cameras and produce alert summary.";
        first.status = "scheduled";
        first.scheduleMode = "weekly";
        first.timezone = "America/Manaus";
        first.activeFrom = "2026-03-18";
        first.scheduleSummary = "Weekly: Monday 08:00-18:00; Tuesday 08:00-18:00";
        first.runtimeStatus = "running";
        first.runtimeUpdatedAt = "2026-03-18T15:00:00Z";
        first.scheduleDays = {
            services::JobScheduleDay{ "Monday", 1, -1, -1, { { "08:00", "18:00" } } },
            services::JobScheduleDay{ "Tuesday", 2, -1, -1, { { "08:00", "18:00" } } },
        };
        m_jobs.push_back(first);

        services::JobRecord second;
        second.id = 502;
        second.name = "Parking occupancy";
        second.description = "Run occupancy check and summarize movement bursts.";
        second.status = "draft";
        second.scheduleMode = "monthly";
        second.timezone = "America/Manaus";
        second.activeFrom = "2026-03-18";
        second.scheduleSummary = "Monthly: Day 15 09:00-11:00";
        second.runtimeStatus = "stopped";
        second.scheduleDays = {
            services::JobScheduleDay{ "Day 15", -1, 15, -1, { { "09:00", "11:00" } } },
        };
        m_jobs.push_back(second);

        m_selectedJobId = first.id;
        m_steps = BuildFallbackSteps(first.id);
        m_globalTimezone = "America/Manaus";
        SyncEditorFromSelectedJob();
    }

    void JobsPage::WireUpActions()
    {
        FindName(L"JobsRefreshButton").as<Button>().Click({ this, &JobsPage::OnRefreshClick });
        FindName(L"CreateJobButton").as<Button>().Click({ this, &JobsPage::OnCreateJobClick });
        FindName(L"SaveSelectedJobButton").as<Button>().Click({ this, &JobsPage::OnSaveSelectedJobClick });
        FindName(L"CreateStepButton").as<Button>().Click({ this, &JobsPage::OnCreateStepClick });
        FindName(L"StartSelectedJobButton").as<Button>().Click({ this, &JobsPage::OnStartJobClick });
        FindName(L"StopSelectedJobButton").as<Button>().Click({ this, &JobsPage::OnStopJobClick });
        FindName(L"DeleteSelectedJobButton").as<Button>().Click({ this, &JobsPage::OnDeleteJobClick });
    }

    void JobsPage::SetText(hstring const& elementName, hstring const& value)
    {
        if (auto text = FindName(elementName).try_as<TextBlock>())
        {
            text.Text(value);
        }
    }

    void JobsPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"JobsInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    std::optional<size_t> JobsPage::FindJobIndex(int32_t jobId) const
    {
        auto it = std::find_if(
            m_jobs.begin(),
            m_jobs.end(),
            [&](services::JobRecord const& item) { return item.id == jobId; });
        if (it == m_jobs.end())
        {
            return std::nullopt;
        }
        return static_cast<size_t>(std::distance(m_jobs.begin(), it));
    }

    services::JobRecord const* JobsPage::SelectedJob() const
    {
        if (!m_selectedJobId.has_value())
        {
            return nullptr;
        }

        auto index = FindJobIndex(*m_selectedJobId);
        if (!index.has_value())
        {
            return nullptr;
        }

        return &m_jobs[*index];
    }

    int32_t JobsPage::ActiveJobsCount() const
    {
        return static_cast<int32_t>(std::count_if(
            m_jobs.begin(),
            m_jobs.end(),
            [](services::JobRecord const& job)
            {
                auto status = LowerAsciiJobs(job.status);
                return status == "draft" || status == "scheduled" || status == "active";
            }));
    }

    int32_t JobsPage::RuntimeBusyJobsCount() const
    {
        return static_cast<int32_t>(std::count_if(
            m_jobs.begin(),
            m_jobs.end(),
            [](services::JobRecord const& job)
            {
                auto runtime = LowerAsciiJobs(job.runtimeStatus);
                return runtime == "running" || runtime == "stopping" || runtime == "failed";
            }));
    }

    void JobsPage::UpdateMetrics()
    {
        SetText(L"TotalJobsMetricValueText", to_hstring(m_jobs.size()));
        SetText(L"ActiveJobsMetricValueText", to_hstring(ActiveJobsCount()));
        SetText(L"RuntimeJobsMetricValueText", to_hstring(RuntimeBusyJobsCount()));
        SetText(L"CamerasMetricValueText", to_hstring(m_cameras.size()));
        SetText(
            L"JobsCatalogSummaryText",
            to_hstring(std::to_string(m_jobs.size()) + " job(s) carregados."));
        SetText(
            L"StepsSummaryText",
            m_selectedJobId.has_value()
                ? to_hstring(std::to_string(m_steps.size()) + " step(s) neste job.")
                : hstring(L"Selecione um job para ver os steps."));
        SetText(L"JobsTimezoneText", to_hstring("Timezone global: " + m_globalTimezone));
    }

    void JobsPage::SyncEditorFromSelectedJob()
    {
        auto job = SelectedJob();
        auto editName = FindName(L"EditJobNameTextBox").as<TextBox>();
        auto editDescription = FindName(L"EditJobDescriptionTextBox").as<TextBox>();
        auto editSchedule = FindName(L"EditScheduleTextBox").as<TextBox>();
        auto editActiveFrom = FindName(L"EditActiveFromTextBox").as<TextBox>();
        auto editActiveUntil = FindName(L"EditActiveUntilTextBox").as<TextBox>();
        auto editMode = FindName(L"EditScheduleModeComboBox").as<ComboBox>();

        if (!job)
        {
            editName.Text(L"");
            editDescription.Text(L"");
            editSchedule.Text(L"");
            editActiveFrom.Text(L"");
            editActiveUntil.Text(L"");
            editMode.SelectedIndex(0);
            return;
        }

        editName.Text(to_hstring(job->name));
        editDescription.Text(to_hstring(job->description));
        editSchedule.Text(to_hstring(BuildScheduleEditorText(*job)));
        editActiveFrom.Text(to_hstring(job->activeFrom));
        editActiveUntil.Text(to_hstring(job->activeUntil));

        auto normalized = LowerAsciiJobs(job->scheduleMode);
        editMode.SelectedIndex(normalized == "monthly" ? 1 : normalized == "yearly" ? 2 : 0);
    }

    UIElement JobsPage::CreateJobCard(services::JobRecord const& job) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(16));
        border.BorderBrush(job.id == m_selectedJobId.value_or(0)
            ? LookupBrush(L"DrakonAccentBrush")
            : LookupBrush(L"DrakonPanelBorderBrush"));
        border.BorderThickness(ThicknessHelper::FromUniformLength(1));

        auto root = StackPanel();
        root.Spacing(10);

        auto header = Grid();
        header.ColumnDefinitions().Append(ColumnDefinition{});
        auto badgeColumn = ColumnDefinition();
        badgeColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Auto));
        header.ColumnDefinitions().Append(badgeColumn);

        auto titleButton = Button();
        titleButton.Tag(box_value(job.id));
        titleButton.Padding(ThicknessHelper::FromUniformLength(0));
        titleButton.HorizontalAlignment(HorizontalAlignment::Stretch);
        titleButton.Click({ const_cast<JobsPage*>(this), &JobsPage::OnSelectJobClick });

        auto titleStack = StackPanel();
        titleStack.Spacing(4);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));
        title.Text(to_hstring(job.name));
        title.TextWrapping(TextWrapping::WrapWholeWords);
        titleStack.Children().Append(title);

        auto meta = TextBlock();
        meta.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        meta.Text(to_hstring(JobStatusLabel(job.status) + " • runtime " + RuntimeStatusLabel(job.runtimeStatus)));
        meta.TextWrapping(TextWrapping::WrapWholeWords);
        titleStack.Children().Append(meta);

        titleButton.Content(titleStack);
        header.Children().Append(titleButton);

        auto badge = Border();
        badge.Background(StatusBrushForJob(job.status, job.runtimeStatus));
        badge.CornerRadius(CornerRadiusHelper::FromUniformRadius(999));
        badge.Padding(ThicknessHelper::FromLengths(10, 4, 10, 4));

        auto badgeText = TextBlock();
        badgeText.Text(to_hstring(RuntimeStatusLabel(job.runtimeStatus)));
        badgeText.Foreground(LookupBrush(L"DrakonStrongTextBrush"));
        badge.Child(badgeText);
        Grid::SetColumn(badge, 1);
        header.Children().Append(badge);

        root.Children().Append(header);

        auto description = TextBlock();
        description.Style(LookupStyle(L"DrakonBodyTextStyle"));
        description.Text(to_hstring(job.description.empty() ? std::string("Sem descricao.") : job.description));
        description.TextWrapping(TextWrapping::WrapWholeWords);
        root.Children().Append(description);

        auto schedule = TextBlock();
        schedule.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        schedule.Text(to_hstring(
            (job.scheduleSummary.empty() ? std::string("Sem resumo de schedule.") : job.scheduleSummary) +
            " • updated " + FormatDateTimeShort(job.runtimeUpdatedAt)));
        schedule.TextWrapping(TextWrapping::WrapWholeWords);
        root.Children().Append(schedule);

        auto actions = StackPanel();
        actions.Orientation(Orientation::Horizontal);
        actions.Spacing(8);

        auto startButton = Button();
        startButton.Tag(box_value(job.id));
        startButton.Content(box_value(L"Start"));
        startButton.Click({ const_cast<JobsPage*>(this), &JobsPage::OnStartJobClick });
        actions.Children().Append(startButton);

        auto stopButton = Button();
        stopButton.Tag(box_value(job.id));
        stopButton.Content(box_value(L"Stop"));
        stopButton.Click({ const_cast<JobsPage*>(this), &JobsPage::OnStopJobClick });
        actions.Children().Append(stopButton);

        auto deleteButton = Button();
        deleteButton.Tag(box_value(job.id));
        deleteButton.Content(box_value(L"Excluir"));
        deleteButton.Click({ const_cast<JobsPage*>(this), &JobsPage::OnDeleteJobClick });
        actions.Children().Append(deleteButton);

        root.Children().Append(actions);
        border.Child(root);
        return border;
    }

    UIElement JobsPage::CreateStepCard(services::JobStepRecord const& step) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(14));

        auto grid = Grid();
        grid.ColumnDefinitions().Append(ColumnDefinition{});
        auto actionColumn = ColumnDefinition();
        actionColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Auto));
        grid.ColumnDefinitions().Append(actionColumn);

        auto stack = StackPanel();
        stack.Spacing(4);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonBodyTextStyle"));
        title.Text(to_hstring("#" + std::to_string(step.stepOrder) + " • " + step.name));
        title.TextWrapping(TextWrapping::WrapWholeWords);
        stack.Children().Append(title);

        auto meta = TextBlock();
        meta.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        meta.Text(to_hstring(
            "timeout " + FormatTimeoutHuman(step.timeoutSeconds) +
            " • status " + JobStatusLabel(step.status) +
            (step.hasInputFromStepId ? " • input from step " + std::to_string(step.inputFromStepId) : std::string())));
        meta.TextWrapping(TextWrapping::WrapWholeWords);
        stack.Children().Append(meta);

        grid.Children().Append(stack);

        auto deleteButton = Button();
        deleteButton.Tag(box_value(step.id));
        deleteButton.Content(box_value(L"Excluir"));
        deleteButton.Click({ const_cast<JobsPage*>(this), &JobsPage::OnDeleteStepClick });
        Grid::SetColumn(deleteButton, 1);
        grid.Children().Append(deleteButton);

        border.Child(grid);
        return border;
    }

    void JobsPage::RenderJobs()
    {
        auto host = FindName(L"JobsCatalogItemsHost").as<StackPanel>();
        host.Children().Clear();
        for (auto const& job : m_jobs)
        {
            host.Children().Append(CreateJobCard(job));
        }
    }

    void JobsPage::RenderSelectedJob()
    {
        auto job = SelectedJob();
        if (!job)
        {
            SetText(L"SelectedJobTitleText", L"Nenhum job selecionado");
            SetText(L"SelectedJobStatusText", L"Abra um job para editar schedule e operacao.");
            SetText(L"SelectedJobScheduleText", L"Sem agenda carregada.");
            SyncEditorFromSelectedJob();
            return;
        }

        SetText(L"SelectedJobTitleText", to_hstring(job->name));
        SetText(
            L"SelectedJobStatusText",
            to_hstring(
                "status " + JobStatusLabel(job->status) +
                " • runtime " + RuntimeStatusLabel(job->runtimeStatus) +
                " • updated " + FormatDateTimeShort(job->runtimeUpdatedAt)));
        SetText(
            L"SelectedJobScheduleText",
            to_hstring(job->scheduleSummary.empty() ? std::string("Sem resumo de schedule.") : job->scheduleSummary));
        SyncEditorFromSelectedJob();
    }

    void JobsPage::RenderSteps()
    {
        auto host = FindName(L"StepsItemsHost").as<StackPanel>();
        host.Children().Clear();
        for (auto const& step : m_steps)
        {
            host.Children().Append(CreateStepCard(step));
        }
        UpdateMetrics();
    }

    void JobsPage::UpdateResponsiveState(double width)
    {
        auto metricsFirstColumn = FindName(L"JobsMetricsFirstColumn").as<ColumnDefinition>();
        auto metricsSecondColumn = FindName(L"JobsMetricsSecondColumn").as<ColumnDefinition>();
        auto metricsThirdColumn = FindName(L"JobsMetricsThirdColumn").as<ColumnDefinition>();
        auto metricsFourthColumn = FindName(L"JobsMetricsFourthColumn").as<ColumnDefinition>();
        auto metricsSecondRow = FindName(L"JobsMetricsSecondRow").as<RowDefinition>();
        auto totalBorder = FindName(L"TotalJobsMetricBorder").as<Border>();
        auto activeBorder = FindName(L"ActiveJobsMetricBorder").as<Border>();
        auto runtimeBorder = FindName(L"RuntimeJobsMetricBorder").as<Border>();
        auto camerasBorder = FindName(L"CamerasMetricBorder").as<Border>();

        auto compactMetrics = width > 0 && width < 1100;
        metricsFirstColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        metricsSecondColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        metricsThirdColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        metricsFourthColumn.Width(compactMetrics
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        metricsSecondRow.Height(compactMetrics
            ? GridLengthHelper::FromValueAndType(1, GridUnitType::Auto)
            : GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel));

        Grid::SetRow(totalBorder, 0);
        Grid::SetColumn(totalBorder, 0);
        Grid::SetRow(activeBorder, 0);
        Grid::SetColumn(activeBorder, 1);
        Grid::SetRow(runtimeBorder, compactMetrics ? 1 : 0);
        Grid::SetColumn(runtimeBorder, compactMetrics ? 0 : 2);
        Grid::SetRow(camerasBorder, compactMetrics ? 1 : 0);
        Grid::SetColumn(camerasBorder, compactMetrics ? 1 : 3);

        auto topFirstColumn = FindName(L"JobsTopFirstColumn").as<ColumnDefinition>();
        auto topSecondColumn = FindName(L"JobsTopSecondColumn").as<ColumnDefinition>();
        auto createBorder = FindName(L"CreateJobBorder").as<Border>();
        auto catalogBorder = FindName(L"CatalogJobsBorder").as<Border>();

        auto bottomFirstColumn = FindName(L"JobsBottomFirstColumn").as<ColumnDefinition>();
        auto bottomSecondColumn = FindName(L"JobsBottomSecondColumn").as<ColumnDefinition>();
        auto selectedBorder = FindName(L"SelectedJobBorder").as<Border>();
        auto stepsBorder = FindName(L"StepsBorder").as<Border>();

        auto singleColumn = width > 0 && width < 1260;
        topFirstColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        topSecondColumn.Width(singleColumn
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        Grid::SetColumn(createBorder, 0);
        Grid::SetRow(createBorder, 0);
        Grid::SetColumn(catalogBorder, singleColumn ? 0 : 1);
        Grid::SetRow(catalogBorder, singleColumn ? 1 : 0);

        bottomFirstColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        bottomSecondColumn.Width(singleColumn
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        Grid::SetColumn(selectedBorder, 0);
        Grid::SetRow(selectedBorder, 0);
        Grid::SetColumn(stepsBorder, singleColumn ? 0 : 1);
        Grid::SetRow(stepsBorder, singleColumn ? 1 : 0);
    }

    IAsyncAction JobsPage::RefreshJobsAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing jobs, cameras and runtime state...", InfoBarSeverity::Informational);
        }

        auto currentSelectedJobId = m_selectedJobId;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetJobs()) jobs{};
        decltype(services::DrakonApiClient::Instance().GetCameras()) cameras{};
        decltype(services::DrakonApiClient::Instance().GetPairingStatus()) pairing{};

        if (auth.success && auth.value.isAuthenticated)
        {
            jobs = services::DrakonApiClient::Instance().GetJobs();
            cameras = services::DrakonApiClient::Instance().GetCameras();
            pairing = services::DrakonApiClient::Instance().GetPairingStatus();
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            m_loadedRemoteData = false;
            m_usingLocalFallback = false;
            m_jobs.clear();
            m_cameras.clear();
            m_steps.clear();
            m_selectedJobId.reset();
            UpdateMetrics();
            RenderJobs();
            RenderSelectedJob();
            RenderSteps();
            if (announceResult || auth.statusCode == HttpUnauthorized || auth.statusCode == HttpForbidden)
            {
                ShowStatus(L"Log in again to load Jobs from the authenticated backend session.", InfoBarSeverity::Warning);
            }
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated && jobs.success)
        {
            m_jobs = std::move(jobs.value);
            m_loadedRemoteData = true;
            m_usingLocalFallback = false;
            if (cameras.success)
            {
                m_cameras = std::move(cameras.value);
            }
            if (pairing.success && !pairing.value.timezoneIana.empty())
            {
                m_globalTimezone = pairing.value.timezoneIana;
            }

            if (currentSelectedJobId.has_value() && FindJobIndex(*currentSelectedJobId).has_value())
            {
                m_selectedJobId = currentSelectedJobId;
            }
            else if (!m_jobs.empty())
            {
                m_selectedJobId = m_jobs.front().id;
            }
            else
            {
                m_selectedJobId.reset();
            }

            UpdateMetrics();
            RenderJobs();
            RenderSelectedJob();
            if (m_selectedJobId.has_value())
            {
                co_await LoadStepsAsync(*m_selectedJobId, false);
            }
            else
            {
                m_steps.clear();
                RenderSteps();
            }

            if (announceResult)
            {
                ShowStatus(
                    to_hstring("Jobs synchronized from backend. " + std::to_string(m_jobs.size()) + " item(s) loaded."),
                    InfoBarSeverity::Success);
            }
            co_return;
        }

        m_usingLocalFallback = true;
        if (m_selectedJobId.has_value())
        {
            m_steps = BuildFallbackSteps(*m_selectedJobId);
        }
        UpdateMetrics();
        RenderJobs();
        RenderSelectedJob();
        RenderSteps();

        if (announceResult)
        {
            ShowStatus(
                L"Backend unavailable or not authenticated. Keeping fallback jobs preview active.",
                InfoBarSeverity::Warning);
        }
    }

    IAsyncAction JobsPage::LoadStepsAsync(int32_t jobId, bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Loading job steps...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetJobSteps(jobId)) steps{};
        if (auth.success && auth.value.isAuthenticated)
        {
            steps = services::DrakonApiClient::Instance().GetJobSteps(jobId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            m_steps.clear();
            RenderSteps();
            if (announceResult || auth.statusCode == HttpUnauthorized || auth.statusCode == HttpForbidden)
            {
                ShowStatus(L"Log in again to load steps from the authenticated backend session.", InfoBarSeverity::Warning);
            }
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated && steps.success)
        {
            m_steps = std::move(steps.value);
            RenderSteps();
            if (announceResult)
            {
                ShowStatus(L"Steps loaded from backend.", InfoBarSeverity::Success);
            }
            co_return;
        }

        m_steps = BuildFallbackSteps(jobId);
        RenderSteps();
        if (announceResult)
        {
            ShowStatus(L"Using fallback steps because backend steps are unavailable.", InfoBarSeverity::Warning);
        }
    }

    fire_and_forget JobsPage::CreateJobAsync()
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        auto name = TrimAsciiJobs(to_string(FindName(L"CreateJobNameTextBox").as<TextBox>().Text()));
        auto description = TrimAsciiJobs(to_string(FindName(L"CreateJobDescriptionTextBox").as<TextBox>().Text()));
        auto scheduleText = TrimAsciiJobs(to_string(FindName(L"CreateScheduleTextBox").as<TextBox>().Text()));
        auto activeFrom = TrimAsciiJobs(to_string(FindName(L"CreateActiveFromTextBox").as<TextBox>().Text()));
        auto activeUntil = TrimAsciiJobs(to_string(FindName(L"CreateActiveUntilTextBox").as<TextBox>().Text()));
        auto scheduleModeCombo = FindName(L"CreateScheduleModeComboBox").as<ComboBox>();

        std::string scheduleMode = "weekly";
        if (auto selected = scheduleModeCombo.SelectedItem().try_as<ComboBoxItem>())
        {
            scheduleMode = to_string(unbox_value_or<hstring>(selected.Tag(), L"weekly"));
        }

        if (name.empty())
        {
            ShowStatus(L"Job name is required.", InfoBarSeverity::Warning);
            co_return;
        }

        services::JobMutationRequest request;
        request.name = name;
        request.description = description;
        request.scheduleMode = scheduleMode;
        request.activeFrom = activeFrom.empty() ? std::optional<std::string>{} : std::optional<std::string>{ activeFrom };
        request.activeUntil = activeUntil.empty() ? std::optional<std::string>{ std::string{} } : std::optional<std::string>{ activeUntil };

        std::string scheduleError;
        if (!TryParseScheduleText(scheduleMode, scheduleText, request.scheduleDays, scheduleError))
        {
            ShowStatus(to_hstring(scheduleError), InfoBarSeverity::Warning);
            co_return;
        }

        ShowStatus(L"Creating job...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().CreateJob(request)) create{};
        if (auth.success && auth.value.isAuthenticated)
        {
            create = services::DrakonApiClient::Instance().CreateJob(request);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before creating jobs in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!create.success)
            {
                ShowStatus(to_hstring(create.error.empty() ? std::string("Failed to create job.") : create.error), InfoBarSeverity::Error);
                co_return;
            }

            FindName(L"CreateJobNameTextBox").as<TextBox>().Text(L"");
            FindName(L"CreateJobDescriptionTextBox").as<TextBox>().Text(L"");
            FindName(L"CreateScheduleTextBox").as<TextBox>().Text(L"");
            FindName(L"CreateActiveFromTextBox").as<TextBox>().Text(L"");
            FindName(L"CreateActiveUntilTextBox").as<TextBox>().Text(L"");
            m_selectedJobId = create.value.id;
            co_await RefreshJobsAsync(false);
            ShowStatus(L"Job created and synchronized from backend.", InfoBarSeverity::Success);
            co_return;
        }

        services::JobRecord local;
        local.id = m_jobs.empty() ? 1 : (m_jobs.front().id + 1);
        local.name = request.name;
        local.description = request.description;
        local.status = "draft";
        local.scheduleMode = request.scheduleMode;
        local.activeFrom = request.activeFrom.value_or("2026-03-18");
        local.activeUntil = request.activeUntil.value_or("");
        local.scheduleDays = request.scheduleDays;
        local.scheduleSummary = BuildScheduleEditorText(local);
        m_jobs.insert(m_jobs.begin(), local);
        m_selectedJobId = local.id;
        m_steps.clear();
        UpdateMetrics();
        RenderJobs();
        RenderSelectedJob();
        RenderSteps();
        ShowStatus(L"Job created in fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget JobsPage::SaveSelectedJobAsync()
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (!m_selectedJobId.has_value())
        {
            ShowStatus(L"Select a job before saving.", InfoBarSeverity::Warning);
            co_return;
        }

        services::JobMutationRequest request;
        request.name = TrimAsciiJobs(to_string(FindName(L"EditJobNameTextBox").as<TextBox>().Text()));
        request.description = TrimAsciiJobs(to_string(FindName(L"EditJobDescriptionTextBox").as<TextBox>().Text()));
        request.activeFrom = TrimAsciiJobs(to_string(FindName(L"EditActiveFromTextBox").as<TextBox>().Text()));
        request.activeUntil = TrimAsciiJobs(to_string(FindName(L"EditActiveUntilTextBox").as<TextBox>().Text()));

        auto scheduleText = TrimAsciiJobs(to_string(FindName(L"EditScheduleTextBox").as<TextBox>().Text()));
        auto scheduleModeCombo = FindName(L"EditScheduleModeComboBox").as<ComboBox>();
        request.scheduleMode = "weekly";
        if (auto selected = scheduleModeCombo.SelectedItem().try_as<ComboBoxItem>())
        {
            request.scheduleMode = to_string(unbox_value_or<hstring>(selected.Tag(), L"weekly"));
        }

        std::string scheduleError;
        if (!TryParseScheduleText(request.scheduleMode, scheduleText, request.scheduleDays, scheduleError))
        {
            ShowStatus(to_hstring(scheduleError), InfoBarSeverity::Warning);
            co_return;
        }

        auto selectedId = *m_selectedJobId;
        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().UpdateJob(selectedId, request)) update{};
        if (auth.success && auth.value.isAuthenticated)
        {
            update = services::DrakonApiClient::Instance().UpdateJob(selectedId, request);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before saving jobs in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!update.success)
            {
                ShowStatus(to_hstring(update.error.empty() ? std::string("Failed to save job.") : update.error), InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshJobsAsync(false);
            ShowStatus(L"Selected job synchronized from backend.", InfoBarSeverity::Success);
            co_return;
        }

        if (auto index = FindJobIndex(selectedId); index.has_value())
        {
            auto& job = m_jobs[*index];
            job.name = request.name;
            job.description = request.description;
            job.scheduleMode = request.scheduleMode;
            job.activeFrom = request.activeFrom.value_or("");
            job.activeUntil = request.activeUntil.value_or("");
            job.scheduleDays = request.scheduleDays;
            job.scheduleSummary = BuildScheduleEditorText(job);
            RenderJobs();
            RenderSelectedJob();
            ShowStatus(L"Selected job updated in fallback mode.", InfoBarSeverity::Success);
        }
    }

    fire_and_forget JobsPage::DeleteJobAsync(int32_t jobId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().DeleteJob(jobId)) remove{};
        if (auth.success && auth.value.isAuthenticated)
        {
            remove = services::DrakonApiClient::Instance().DeleteJob(jobId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before deleting jobs in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated && !remove.success)
        {
            ShowStatus(to_hstring(remove.error.empty() ? std::string("Failed to delete job.") : remove.error), InfoBarSeverity::Error);
            co_return;
        }

        m_jobs.erase(
            std::remove_if(
                m_jobs.begin(),
                m_jobs.end(),
                [&](services::JobRecord const& job) { return job.id == jobId; }),
            m_jobs.end());

        if (m_selectedJobId == jobId)
        {
            m_selectedJobId = m_jobs.empty() ? std::optional<int32_t>{} : std::optional<int32_t>{ m_jobs.front().id };
            m_steps = m_selectedJobId.has_value() ? BuildFallbackSteps(*m_selectedJobId) : std::vector<services::JobStepRecord>{};
        }

        UpdateMetrics();
        RenderJobs();
        RenderSelectedJob();
        RenderSteps();
        ShowStatus(auth.success && auth.value.isAuthenticated ? L"Job removed from backend." : L"Job removed from fallback preview.", InfoBarSeverity::Success);
    }

    fire_and_forget JobsPage::StartJobAsync(int32_t jobId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().StartJob(jobId)) start{};
        if (auth.success && auth.value.isAuthenticated)
        {
            start = services::DrakonApiClient::Instance().StartJob(jobId);
        }

        co_await uiThread;
        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before starting jobs in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!start.success)
            {
                ShowStatus(to_hstring(start.error.empty() ? std::string("Failed to start job.") : start.error), InfoBarSeverity::Error);
                co_return;
            }
            co_await RefreshJobsAsync(false);
            ShowStatus(L"Start command sent to backend.", InfoBarSeverity::Success);
            co_return;
        }

        if (auto index = FindJobIndex(jobId); index.has_value())
        {
            m_jobs[*index].runtimeStatus = "running";
            m_jobs[*index].status = "scheduled";
        }
        UpdateMetrics();
        RenderJobs();
        RenderSelectedJob();
        ShowStatus(L"Job started in fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget JobsPage::StopJobAsync(int32_t jobId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().StopJob(jobId)) stop{};
        if (auth.success && auth.value.isAuthenticated)
        {
            stop = services::DrakonApiClient::Instance().StopJob(jobId);
        }

        co_await uiThread;
        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before stopping jobs in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!stop.success)
            {
                ShowStatus(to_hstring(stop.error.empty() ? std::string("Failed to stop job.") : stop.error), InfoBarSeverity::Error);
                co_return;
            }
            co_await RefreshJobsAsync(false);
            ShowStatus(L"Stop command sent to backend.", InfoBarSeverity::Success);
            co_return;
        }

        if (auto index = FindJobIndex(jobId); index.has_value())
        {
            m_jobs[*index].runtimeStatus = "stopping";
        }
        UpdateMetrics();
        RenderJobs();
        RenderSelectedJob();
        ShowStatus(L"Job stop requested in fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget JobsPage::CreateStepAsync()
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (!m_selectedJobId.has_value())
        {
            ShowStatus(L"Select a job before adding steps.", InfoBarSeverity::Warning);
            co_return;
        }

        auto name = TrimAsciiJobs(to_string(FindName(L"CreateStepNameTextBox").as<TextBox>().Text()));
        auto orderValue = ParsePositiveInt(TrimAsciiJobs(to_string(FindName(L"CreateStepOrderTextBox").as<TextBox>().Text())));
        auto timeoutValue = ParsePositiveInt(TrimAsciiJobs(to_string(FindName(L"CreateStepTimeoutTextBox").as<TextBox>().Text())));

        if (name.empty() || !orderValue.has_value() || !timeoutValue.has_value())
        {
            ShowStatus(L"Step name, order and timeout are required.", InfoBarSeverity::Warning);
            co_return;
        }

        services::JobStepMutationRequest request;
        request.name = name;
        request.stepOrder = *orderValue;
        request.timeoutSeconds = *timeoutValue;

        auto selectedId = *m_selectedJobId;
        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().CreateJobStep(selectedId, request)) create{};
        if (auth.success && auth.value.isAuthenticated)
        {
            create = services::DrakonApiClient::Instance().CreateJobStep(selectedId, request);
        }

        co_await uiThread;
        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before creating steps in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!create.success)
            {
                ShowStatus(to_hstring(create.error.empty() ? std::string("Failed to create step.") : create.error), InfoBarSeverity::Error);
                co_return;
            }

            FindName(L"CreateStepNameTextBox").as<TextBox>().Text(L"");
            FindName(L"CreateStepOrderTextBox").as<TextBox>().Text(L"");
            FindName(L"CreateStepTimeoutTextBox").as<TextBox>().Text(L"");
            co_await LoadStepsAsync(selectedId, false);
            ShowStatus(L"Step created and loaded from backend.", InfoBarSeverity::Success);
            co_return;
        }

        services::JobStepRecord local;
        local.id = m_steps.empty() ? 1 : (m_steps.front().id + 1);
        local.jobId = selectedId;
        local.stepOrder = request.stepOrder;
        local.name = request.name;
        local.timeoutSeconds = request.timeoutSeconds;
        local.status = "draft";
        m_steps.push_back(local);
        std::sort(
            m_steps.begin(),
            m_steps.end(),
            [](services::JobStepRecord const& left, services::JobStepRecord const& right)
            {
                return left.stepOrder < right.stepOrder;
            });
        RenderSteps();
        ShowStatus(L"Step created in fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget JobsPage::DeleteStepAsync(int32_t stepId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().DeleteJobStep(stepId)) remove{};
        if (auth.success && auth.value.isAuthenticated)
        {
            remove = services::DrakonApiClient::Instance().DeleteJobStep(stepId);
        }

        co_await uiThread;
        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (RequiresInteractiveLogin(auth))
        {
            ShowStatus(L"Log in before deleting steps in the operational backend.", InfoBarSeverity::Warning);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated && !remove.success)
        {
            ShowStatus(to_hstring(remove.error.empty() ? std::string("Failed to delete step.") : remove.error), InfoBarSeverity::Error);
            co_return;
        }

        m_steps.erase(
            std::remove_if(
                m_steps.begin(),
                m_steps.end(),
                [&](services::JobStepRecord const& step) { return step.id == stepId; }),
            m_steps.end());
        RenderSteps();
        ShowStatus(auth.success && auth.value.isAuthenticated ? L"Step removed from backend." : L"Step removed from fallback preview.", InfoBarSeverity::Success);
    }

    void JobsPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        RefreshJobsAsync(true);
    }

    void JobsPage::OnCreateJobClick(IInspectable const&, RoutedEventArgs const&)
    {
        CreateJobAsync();
    }

    void JobsPage::OnSaveSelectedJobClick(IInspectable const&, RoutedEventArgs const&)
    {
        SaveSelectedJobAsync();
    }

    void JobsPage::OnCreateStepClick(IInspectable const&, RoutedEventArgs const&)
    {
        CreateStepAsync();
    }

    void JobsPage::OnSelectJobClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto jobId = ReadTaggedInt32(sender);
        if (jobId <= 0)
        {
            return;
        }

        m_selectedJobId = jobId;
        RenderJobs();
        RenderSelectedJob();
        if (m_loadedRemoteData && !m_usingLocalFallback)
        {
            LoadStepsAsync(jobId, false);
        }
        else
        {
            m_steps = BuildFallbackSteps(jobId);
            RenderSteps();
        }
    }

    void JobsPage::OnDeleteJobClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto jobId = ReadTaggedInt32(sender);
        if (jobId <= 0 && m_selectedJobId.has_value())
        {
            jobId = *m_selectedJobId;
        }
        if (jobId > 0)
        {
            DeleteJobAsync(jobId);
        }
    }

    void JobsPage::OnStartJobClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto jobId = ReadTaggedInt32(sender);
        if (jobId <= 0 && m_selectedJobId.has_value())
        {
            jobId = *m_selectedJobId;
        }
        if (jobId > 0)
        {
            StartJobAsync(jobId);
        }
    }

    void JobsPage::OnStopJobClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto jobId = ReadTaggedInt32(sender);
        if (jobId <= 0 && m_selectedJobId.has_value())
        {
            jobId = *m_selectedJobId;
        }
        if (jobId > 0)
        {
            StopJobAsync(jobId);
        }
    }

    void JobsPage::OnDeleteStepClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto stepId = ReadTaggedInt32(sender);
        if (stepId > 0)
        {
            DeleteStepAsync(stepId);
        }
    }

    void JobsPage::OnPageSizeChanged(IInspectable const&, SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }

    void JobsPage::OnPollTimerTick(IInspectable const&, IInspectable const&)
    {
        RefreshJobsAsync(false);
    }
}
