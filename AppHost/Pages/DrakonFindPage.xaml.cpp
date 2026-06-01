#include "pch.h"
#include "DrakonFindPage.xaml.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <sstream>
#include <unordered_set>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;

namespace
{
    constexpr int32_t PollIntervalSeconds = 5;

    Brush LookupBrush(winrt::hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Brush>();
    }

    Style LookupStyle(winrt::hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Style>();
    }

    int32_t ReadTaggedInt32(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }
        return 0;
    }

    std::optional<std::pair<int32_t, int32_t>> ReadTaggedPair(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            auto raw = unbox_value_or<int64_t>(element.Tag(), 0);
            if (raw <= 0)
            {
                return std::nullopt;
            }

            auto left = static_cast<int32_t>((raw >> 32) & 0x7fffffff);
            auto right = static_cast<int32_t>(raw & 0x7fffffff);
            if (left > 0 && right > 0)
            {
                return std::pair<int32_t, int32_t>{ left, right };
            }
        }
        return std::nullopt;
    }

    int64_t ComposeTaggedPair(int32_t left, int32_t right)
    {
        return (static_cast<int64_t>(left) << 32) | static_cast<uint32_t>(right);
    }

    std::string TrimAsciiFind(std::string value)
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

    std::string LowerAsciiFind(std::string value)
    {
        std::transform(
            value.begin(),
            value.end(),
            value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    bool IsActiveSearchStatus(std::string status)
    {
        status = LowerAsciiFind(std::move(status));
        return status == "queued" || status == "dispatching" || status == "running";
    }

    winrt::hstring StatusLabel(std::string status)
    {
        status = LowerAsciiFind(std::move(status));
        if (status == "queued") return L"Na fila";
        if (status == "dispatching") return L"Despachando";
        if (status == "running") return L"Ao vivo";
        if (status == "completed") return L"Concluída";
        if (status == "cancelled") return L"Cancelada";
        if (status == "failed") return L"Falhou";
        if (status == "paused") return L"Pausada";
        return to_hstring(status.empty() ? std::string("unknown") : status);
    }

    Brush StatusBrush(std::string status)
    {
        status = LowerAsciiFind(std::move(status));
        if (status == "completed") return LookupBrush(L"DrakonSuccessBrush");
        if (status == "failed" || status == "cancelled") return LookupBrush(L"DrakonDangerBrush");
        if (status == "paused") return LookupBrush(L"DrakonWarningBrush");
        if (status == "queued" || status == "dispatching" || status == "running")
        {
            return LookupBrush(L"DrakonAccentBrush");
        }
        return LookupBrush(L"DrakonMutedBrush");
    }

    std::string FormatDateTimeShort(std::string const& value)
    {
        if (value.empty())
        {
            return "--";
        }

        auto compact = value;
        std::replace(compact.begin(), compact.end(), 'T', ' ');
        if (compact.size() >= 16)
        {
            compact = compact.substr(0, 16);
        }
        return compact;
    }

    std::string FormatConfidence(double value)
    {
        auto clamped = (std::max)(0.0, (std::min)(1.0, value));
        return std::to_string(static_cast<int32_t>(clamped * 100.0 + 0.5)) + "%";
    }

    std::string FormatDurationLabel(int32_t seconds)
    {
        if (seconds <= 0) return "--";
        if (seconds == 1800) return "30 min";
        if (seconds == 3600) return "1 h";
        if (seconds == 21600) return "6 h";
        if (seconds == 43200) return "12 h";
        if (seconds == 86400) return "24 h";
        if (seconds == 604800) return "7 dias";
        if (seconds == 2592000) return "30 dias";
        if (seconds % 3600 == 0) return std::to_string(seconds / 3600) + " h";
        return std::to_string(seconds / 60) + " min";
    }

    std::string JoinStrings(std::vector<std::string> const& values, std::string const& separator)
    {
        std::ostringstream stream;
        bool first = true;
        for (auto const& value : values)
        {
            if (value.empty())
            {
                continue;
            }
            if (!first)
            {
                stream << separator;
            }
            first = false;
            stream << value;
        }
        return stream.str();
    }

    std::vector<std::string> ParseStateSelectionText(std::string value)
    {
        for (auto& ch : value)
        {
            if (ch == ';' || ch == '/' || ch == '\n' || ch == '\r' || ch == '\t')
            {
                ch = ',';
            }
        }

        std::vector<std::string> states;
        std::unordered_set<std::string> seen;
        std::stringstream stream(value);
        std::string token;
        while (std::getline(stream, token, ','))
        {
            token = TrimAsciiFind(token);
            if (token.empty())
            {
                continue;
            }

            std::transform(
                token.begin(),
                token.end(),
                token.begin(),
                [](unsigned char ch) { return static_cast<char>(std::toupper(ch)); });

            if (token.size() > 3)
            {
                token = token.substr(0, 3);
            }

            if (seen.insert(token).second)
            {
                states.push_back(token);
            }
        }

        return states;
    }

    std::vector<winrt::DrakonDesktop::services::DrakonFindScopeCameraPreview> FallbackScopeCameras()
    {
        using winrt::DrakonDesktop::services::DrakonFindScopeCameraPreview;

        DrakonFindScopeCameraPreview first;
        first.id = 301;
        first.userId = "owner-am-01";
        first.name = "Manaus Bus Terminal";
        first.city = "Manaus";
        first.state = "Amazonas";
        first.stateCode = "AM";
        first.country = "Brazil";
        first.countryCode = "BR";
        first.allowPublicAccess = 1;

        DrakonFindScopeCameraPreview second;
        second.id = 302;
        second.userId = "owner-pa-02";
        second.name = "Belem Port Entrance";
        second.city = "Belem";
        second.state = "Para";
        second.stateCode = "PA";
        second.country = "Brazil";
        second.countryCode = "BR";
        second.allowPublicAccess = 1;

        DrakonFindScopeCameraPreview third;
        third.id = 303;
        third.userId = "owner-sp-03";
        third.name = "Campinas Logistics Yard";
        third.city = "Campinas";
        third.state = "Sao Paulo";
        third.stateCode = "SP";
        third.country = "Brazil";
        third.countryCode = "BR";
        third.allowPublicAccess = 1;

        return { first, second, third };
    }

    winrt::DrakonDesktop::services::DrakonFindScopeResolution BuildFallbackScope(
        std::vector<std::string> const& selectedStates,
        std::vector<int32_t> const& excludedCameraIds)
    {
        using namespace winrt::DrakonDesktop::services;

        DrakonFindScopeResolution scope;
        scope.countryCode = "BR";
        scope.selectedStates = selectedStates;
        scope.excludedCameraIds = excludedCameraIds;
        scope.previewUpdatedAt = "fallback";

        auto cameras = FallbackScopeCameras();
        std::unordered_set<std::string> selectedSet(selectedStates.begin(), selectedStates.end());
        std::unordered_set<std::string> owners;

        for (auto const& camera : cameras)
        {
            if (!selectedSet.empty() && !selectedSet.contains(camera.stateCode))
            {
                continue;
            }

            scope.cameras.push_back(camera);
            owners.insert(camera.userId);
        }

        scope.eligibleCameraCount = static_cast<int32_t>(scope.cameras.size());
        scope.eligibleOwnerCount = static_cast<int32_t>(owners.size());

        for (auto const& stateCode : selectedStates)
        {
            DrakonFindScopeStateSummary summary;
            summary.stateCode = stateCode;
            summary.stateName = stateCode;
            summary.cameraCount = static_cast<int32_t>(std::count_if(
                scope.cameras.begin(),
                scope.cameras.end(),
                [&](DrakonFindScopeCameraPreview const& item) { return item.stateCode == stateCode; }));
            scope.states.push_back(summary);
        }

        return scope;
    }
}

namespace winrt::DrakonDesktop::implementation
{
    DrakonFindPage::DrakonFindPage()
    {
        InitializeComponent();
        InitializeFallbackData();
        PopulateSelectors();
        WireUpActions();
        UpdateMetrics();
        RenderTargets();
        RenderSelectedTarget();
        RenderScope();
        RenderSearches();
        RenderHits();
        RenderAudit();
        SizeChanged({ this, &DrakonFindPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());

        m_pollTimer = DispatcherTimer();
        m_pollTimer.Interval(std::chrono::seconds(PollIntervalSeconds));
        m_pollTimer.Tick({ this, &DrakonFindPage::OnPollTimerTick });
        m_pollTimer.Start();

        RefreshAllAsync(false);
    }

    void DrakonFindPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/DrakonFindPage.xaml" });

        m_initialized = true;
    }

    void DrakonFindPage::InitializeFallbackData()
    {
        m_targets.clear();
        m_searches.clear();
        m_hits.clear();
        m_audit.clear();
        m_selectedStates = { "AM", "PA" };
        m_excludedCameraIds.clear();

        services::DrakonFindTarget first;
        first.id = 901;
        first.userId = "fallback-user";
        first.entityType = "object";
        first.name = "Moto com capacete branco";
        first.description = "Moto preta com duas pessoas, garupa com mochila escura e condutor usando capacete branco.";
        first.traits = { "capacete branco", "moto preta", "mochila preta" };
        first.imageCount = 2;
        first.searchCount = 1;
        first.runningSearchCount = 1;
        first.lastSearchAt = "2026-03-18 14:10";
        m_targets.push_back(first);

        services::DrakonFindTarget second;
        second.id = 902;
        second.userId = "fallback-user";
        second.entityType = "person";
        second.name = "Pessoa com colete laranja";
        second.description = "Pessoa com colete de segurança laranja, calça escura e boné preto.";
        second.traits = { "colete laranja", "bone preto" };
        second.imageCount = 1;
        second.searchCount = 0;
        m_targets.push_back(second);

        services::DrakonFindSearch search;
        search.id = 1101;
        search.userId = "fallback-user";
        search.targetId = 901;
        search.targetName = first.name;
        search.targetEntityType = first.entityType;
        search.targetDescription = first.description;
        search.status = "running";
        search.runtimeMode = "distributed";
        search.inputType = "video_60s";
        search.windowSeconds = 60;
        search.durationSeconds = 1800;
        search.countryCode = "BR";
        search.selectedStates = m_selectedStates;
        search.selectedStateCount = static_cast<int32_t>(m_selectedStates.size());
        search.eligibleCameraCount = 2;
        search.eligibleOwnerCount = 2;
        search.attemptCount = 1;
        search.dispatchedCommandCount = 2;
        search.completedCameraCount = 1;
        search.matchedCameraCount = 1;
        search.pendingCameraCount = 1;
        search.hitCount = 1;
        search.activeClientCount = 2;
        search.lastEventAt = "2026-03-18 14:12";
        search.lastError = "Uma parte do escopo já está ao vivo.";
        search.createdAt = "2026-03-18 14:10";
        search.updatedAt = "2026-03-18 14:12";
        m_searches.push_back(search);

        services::DrakonFindHit hit;
        hit.id = 1201;
        hit.searchId = 1101;
        hit.targetId = 901;
        hit.cameraId = 301;
        hit.cameraName = "Manaus Bus Terminal";
        hit.cameraOwnerUserId = "owner-am-01";
        hit.cameraCity = "Manaus";
        hit.cameraStateCode = "AM";
        hit.summary = "Moto semelhante ao target detectada próxima ao corredor de embarque.";
        hit.confidence = 0.86;
        hit.matchedAt = "2026-03-18 14:12";
        hit.createdAt = "2026-03-18 14:12";
        m_hits.push_back(hit);

        services::DrakonFindAuditLog audit;
        audit.id = 1301;
        audit.actionType = "search_created";
        audit.message = "Busca distribuída criada para o target 'Moto com capacete branco'.";
        audit.createdAt = "2026-03-18 14:10";
        m_audit.push_back(audit);

        services::DrakonFindAuditLog auditTwo;
        auditTwo.id = 1302;
        auditTwo.actionType = "hit_received";
        auditTwo.message = "Hit recebido da câmera Manaus Bus Terminal.";
        auditTwo.createdAt = "2026-03-18 14:12";
        m_audit.push_back(auditTwo);

        m_scope = BuildFallbackScope(m_selectedStates, m_excludedCameraIds);
        m_selectedTargetId = first.id;
    }

    void DrakonFindPage::PopulateSelectors()
    {
        auto entityCombo = FindName(L"EntityTypeComboBox").as<ComboBox>();
        auto durationCombo = FindName(L"SearchDurationComboBox").as<ComboBox>();

        entityCombo.Items().Clear();
        durationCombo.Items().Clear();

        for (auto const& [label, value] : {
                 std::pair{ L"Pessoa", L"person" },
                 std::pair{ L"Objeto", L"object" },
                 std::pair{ L"Carro", L"car" },
                 std::pair{ L"Moto", L"motorcycle" },
                 std::pair{ L"Animal", L"animal" },
                 std::pair{ L"Outro / custom", L"custom" } })
        {
            ComboBoxItem item;
            item.Content(box_value(label));
            item.Tag(box_value(value));
            entityCombo.Items().Append(item);
        }
        entityCombo.SelectedIndex(1);

        for (auto duration : { 1800, 3600, 21600, 43200, 86400, 604800, 2592000 })
        {
            ComboBoxItem item;
            item.Content(box_value(to_hstring(FormatDurationLabel(duration))));
            item.Tag(box_value(duration));
            durationCombo.Items().Append(item);
        }
        durationCombo.SelectedIndex(0);

        FindName(L"StateSelectionTextBox").as<TextBox>().Text(L"AM,PA");
    }

    void DrakonFindPage::WireUpActions()
    {
        FindName(L"RefreshDrakonFindButton").as<Button>().Click({ this, &DrakonFindPage::OnRefreshClick });
        FindName(L"CreateTargetButton").as<Button>().Click({ this, &DrakonFindPage::OnCreateTargetClick });
        FindName(L"ResolveScopeButton").as<Button>().Click({ this, &DrakonFindPage::OnResolveScopeClick });
        FindName(L"CreateSearchButton").as<Button>().Click({ this, &DrakonFindPage::OnCreateSearchClick });
        FindName(L"StateSelectionTextBox").as<TextBox>().TextChanged({ this, &DrakonFindPage::OnStateSelectionChanged });
        FindName(L"DeleteSelectedTargetButton").as<Button>().Click({ this, &DrakonFindPage::OnDeleteTargetClick });
    }

    void DrakonFindPage::UpdateResponsiveState(double width)
    {
        auto metricsFirstColumn = FindName(L"MetricsFirstColumn").as<ColumnDefinition>();
        auto metricsSecondColumn = FindName(L"MetricsSecondColumn").as<ColumnDefinition>();
        auto metricsThirdColumn = FindName(L"MetricsThirdColumn").as<ColumnDefinition>();
        auto metricsFourthColumn = FindName(L"MetricsFourthColumn").as<ColumnDefinition>();
        auto metricsSecondRow = FindName(L"MetricsSecondRow").as<RowDefinition>();

        auto targetsMetric = FindName(L"TargetsMetricBorder").as<Border>();
        auto activeMetric = FindName(L"ActiveSearchesMetricBorder").as<Border>();
        auto hitsMetric = FindName(L"HitsMetricBorder").as<Border>();
        auto scopeMetric = FindName(L"ScopeMetricBorder").as<Border>();

        auto topFirstColumn = FindName(L"TopPrimaryFirstColumn").as<ColumnDefinition>();
        auto topSecondColumn = FindName(L"TopPrimarySecondColumn").as<ColumnDefinition>();
        auto createTargetBorder = FindName(L"CreateTargetBorder").as<Border>();
        auto catalogBorder = FindName(L"CatalogBorder").as<Border>();

        auto composerFirstColumn = FindName(L"ComposerFirstColumn").as<ColumnDefinition>();
        auto composerSecondColumn = FindName(L"ComposerSecondColumn").as<ColumnDefinition>();
        auto selectedTargetBorder = FindName(L"SelectedTargetBorder").as<Border>();
        auto scopePreviewBorder = FindName(L"ScopePreviewBorder").as<Border>();

        auto resultsFirstColumn = FindName(L"ResultsFirstColumn").as<ColumnDefinition>();
        auto resultsSecondColumn = FindName(L"ResultsSecondColumn").as<ColumnDefinition>();
        auto searchesBorder = FindName(L"SearchesBorder").as<Border>();
        auto hitsBorder = FindName(L"HitsBorder").as<Border>();

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

        Grid::SetRow(targetsMetric, 0);
        Grid::SetColumn(targetsMetric, 0);
        Grid::SetRow(activeMetric, 0);
        Grid::SetColumn(activeMetric, 1);
        Grid::SetRow(hitsMetric, compactMetrics ? 1 : 0);
        Grid::SetColumn(hitsMetric, compactMetrics ? 0 : 2);
        Grid::SetRow(scopeMetric, compactMetrics ? 1 : 0);
        Grid::SetColumn(scopeMetric, compactMetrics ? 1 : 3);

        auto singleColumn = width > 0 && width < 1240;
        topFirstColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        topSecondColumn.Width(singleColumn
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        Grid::SetColumn(createTargetBorder, 0);
        Grid::SetRow(createTargetBorder, 0);
        Grid::SetColumn(catalogBorder, singleColumn ? 0 : 1);
        Grid::SetRow(catalogBorder, singleColumn ? 1 : 0);

        composerFirstColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        composerSecondColumn.Width(singleColumn
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(0.9, GridUnitType::Star));
        Grid::SetColumn(selectedTargetBorder, 0);
        Grid::SetRow(selectedTargetBorder, 0);
        Grid::SetColumn(scopePreviewBorder, singleColumn ? 0 : 1);
        Grid::SetRow(scopePreviewBorder, singleColumn ? 1 : 0);

        resultsFirstColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        resultsSecondColumn.Width(singleColumn
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        Grid::SetColumn(searchesBorder, 0);
        Grid::SetRow(searchesBorder, 0);
        Grid::SetColumn(hitsBorder, singleColumn ? 0 : 1);
        Grid::SetRow(hitsBorder, singleColumn ? 1 : 0);
    }

    void DrakonFindPage::UpdateMetrics()
    {
        FindName(L"TargetsMetricValueText").as<TextBlock>().Text(to_hstring(m_targets.size()));
        FindName(L"ActiveSearchesMetricValueText").as<TextBlock>().Text(to_hstring(ActiveSearchCount()));
        FindName(L"HitsMetricValueText").as<TextBlock>().Text(to_hstring(m_hits.size()));
        FindName(L"ScopeMetricValueText").as<TextBlock>().Text(to_hstring(EffectiveEligibleCameraCount()));

        FindName(L"TargetCatalogSummaryText").as<TextBlock>().Text(
            to_hstring(std::to_string(m_targets.size()) + " target(s) carregados."));
        FindName(L"SearchesSummaryText").as<TextBlock>().Text(
            to_hstring(std::to_string(m_searches.size()) + " busca(s)."));
        FindName(L"HitsSummaryText").as<TextBlock>().Text(
            to_hstring(std::to_string(m_hits.size()) + " hit(s)."));
        FindName(L"AuditSummaryText").as<TextBlock>().Text(
            to_hstring(std::to_string(m_audit.size()) + " evento(s)."));
    }

    std::vector<std::string> DrakonFindPage::ParseSelectedStates() const
    {
        return ParseStateSelectionText(to_string(FindName(L"StateSelectionTextBox").as<TextBox>().Text()));
    }

    void DrakonFindPage::SyncStateSelectionFromInput()
    {
        m_selectedStates = ParseSelectedStates();
        if (m_selectedStates.empty())
        {
            m_excludedCameraIds.clear();
            m_scope.reset();
        }
    }

    std::optional<size_t> DrakonFindPage::FindTargetIndex(int32_t targetId) const
    {
        auto it = std::find_if(
            m_targets.begin(),
            m_targets.end(),
            [&](services::DrakonFindTarget const& target) { return target.id == targetId; });

        if (it == m_targets.end())
        {
            return std::nullopt;
        }
        return static_cast<size_t>(std::distance(m_targets.begin(), it));
    }

    services::DrakonFindTarget const* DrakonFindPage::SelectedTarget() const
    {
        if (!m_selectedTargetId.has_value())
        {
            return nullptr;
        }

        auto index = FindTargetIndex(*m_selectedTargetId);
        if (!index.has_value())
        {
            return nullptr;
        }

        return &m_targets[*index];
    }

    int32_t DrakonFindPage::SelectedDurationSeconds() const
    {
        auto combo = FindName(L"SearchDurationComboBox").as<ComboBox>();
        if (auto selected = combo.SelectedItem().try_as<ComboBoxItem>())
        {
            return unbox_value_or<int32_t>(selected.Tag(), 1800);
        }
        return 1800;
    }

    int32_t DrakonFindPage::ActiveSearchCount() const
    {
        return static_cast<int32_t>(std::count_if(
            m_searches.begin(),
            m_searches.end(),
            [](services::DrakonFindSearch const& search) { return IsActiveSearchStatus(search.status); }));
    }

    int32_t DrakonFindPage::EffectiveEligibleCameraCount() const
    {
        if (!m_scope.has_value())
        {
            return 0;
        }

        std::unordered_set<int32_t> excluded(m_excludedCameraIds.begin(), m_excludedCameraIds.end());
        return static_cast<int32_t>(std::count_if(
            m_scope->cameras.begin(),
            m_scope->cameras.end(),
            [&](services::DrakonFindScopeCameraPreview const& camera)
            {
                return !excluded.contains(camera.id);
            }));
    }

    int32_t DrakonFindPage::IncludedOwnerCount() const
    {
        if (!m_scope.has_value())
        {
            return 0;
        }

        std::unordered_set<int32_t> excluded(m_excludedCameraIds.begin(), m_excludedCameraIds.end());
        std::unordered_set<std::string> owners;
        for (auto const& camera : m_scope->cameras)
        {
            if (!excluded.contains(camera.id))
            {
                owners.insert(camera.userId);
            }
        }
        return static_cast<int32_t>(owners.size());
    }

    UIElement DrakonFindPage::CreateTargetCard(services::DrakonFindTarget const& target) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(16));
        border.BorderBrush(target.id == m_selectedTargetId.value_or(0)
            ? LookupBrush(L"DrakonAccentBrush")
            : LookupBrush(L"DrakonPanelBorderBrush"));
        border.BorderThickness(ThicknessHelper::FromUniformLength(1));

        auto content = StackPanel();
        content.Spacing(10);

        auto header = Grid();
        header.ColumnDefinitions().Append(ColumnDefinition{});
        auto deleteColumn = ColumnDefinition();
        deleteColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Auto));
        header.ColumnDefinitions().Append(deleteColumn);

        auto titleButton = Button();
        titleButton.Tag(box_value(target.id));
        titleButton.Padding(ThicknessHelper::FromUniformLength(0));
        titleButton.HorizontalAlignment(HorizontalAlignment::Stretch);
        titleButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnSelectTargetClick });

        auto titleStack = StackPanel();
        titleStack.Spacing(4);

        auto name = TextBlock();
        name.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));
        name.Text(to_hstring(target.name));
        name.TextWrapping(TextWrapping::WrapWholeWords);
        titleStack.Children().Append(name);

        auto entity = TextBlock();
        entity.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        entity.Text(to_hstring(target.entityType + " • " + std::to_string(target.imageCount) + " imagem(ns)"));
        entity.TextWrapping(TextWrapping::WrapWholeWords);
        titleStack.Children().Append(entity);

        titleButton.Content(titleStack);
        header.Children().Append(titleButton);

        auto deleteButton = Button();
        deleteButton.Tag(box_value(target.id));
        deleteButton.Content(box_value(L"Excluir"));
        deleteButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnDeleteTargetClick });
        deleteButton.IsEnabled(target.searchCount <= 0);
        Grid::SetColumn(deleteButton, 1);
        header.Children().Append(deleteButton);

        content.Children().Append(header);

        auto description = TextBlock();
        description.Style(LookupStyle(L"DrakonBodyTextStyle"));
        description.Text(to_hstring(target.description.empty() ? std::string("Sem descrição.") : target.description));
        description.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(description);

        auto meta = TextBlock();
        meta.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        meta.Text(to_hstring(
            std::to_string(target.searchCount) + " busca(s) vinculada(s) • último uso " +
            (target.lastSearchAt.empty() ? std::string("--") : target.lastSearchAt)));
        meta.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(meta);

        border.Child(content);
        return border;
    }

    UIElement DrakonFindPage::CreateTargetImageCard(services::DrakonFindTargetImage const& image, bool canDelete) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(12));

        auto grid = Grid();
        grid.ColumnDefinitions().Append(ColumnDefinition{});
        auto actionColumn = ColumnDefinition();
        actionColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Auto));
        grid.ColumnDefinitions().Append(actionColumn);

        auto stack = StackPanel();
        stack.Spacing(4);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonBodyTextStyle"));
        title.Text(to_hstring(image.imageUrl.empty() ? std::string("Imagem de referência") : image.imageUrl));
        title.TextWrapping(TextWrapping::WrapWholeWords);
        stack.Children().Append(title);

        auto subtitle = TextBlock();
        subtitle.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        subtitle.Text(to_hstring("Criada em " + FormatDateTimeShort(image.createdAt)));
        stack.Children().Append(subtitle);
        grid.Children().Append(stack);

        auto deleteButton = Button();
        deleteButton.Tag(box_value(ComposeTaggedPair(image.targetId, image.id)));
        deleteButton.Content(box_value(L"Remover"));
        deleteButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnDeleteTargetImageClick });
        deleteButton.IsEnabled(canDelete);
        Grid::SetColumn(deleteButton, 1);
        grid.Children().Append(deleteButton);

        border.Child(grid);
        return border;
    }

    UIElement DrakonFindPage::CreateScopeStateCard(services::DrakonFindScopeStateSummary const& stateSummary) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromLengths(12, 10, 12, 10));

        auto stack = StackPanel();
        stack.Spacing(2);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonBodyTextStyle"));
        title.Text(to_hstring(stateSummary.stateCode));
        stack.Children().Append(title);

        auto subtitle = TextBlock();
        subtitle.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        subtitle.Text(to_hstring(std::to_string(stateSummary.cameraCount) + " câmera(s)"));
        stack.Children().Append(subtitle);

        border.Child(stack);
        return border;
    }

    UIElement DrakonFindPage::CreateScopeCameraCard(services::DrakonFindScopeCameraPreview const& camera) const
    {
        auto button = Button();
        button.Tag(box_value(camera.id));
        button.Padding(ThicknessHelper::FromUniformLength(0));
        button.HorizontalAlignment(HorizontalAlignment::Stretch);
        button.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnToggleScopeCameraClick });

        auto excluded = std::find(m_excludedCameraIds.begin(), m_excludedCameraIds.end(), camera.id) != m_excludedCameraIds.end();

        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(14));
        border.BorderBrush(excluded ? LookupBrush(L"DrakonWarningBrush") : LookupBrush(L"DrakonPanelBorderBrush"));
        border.BorderThickness(ThicknessHelper::FromUniformLength(1));

        auto content = StackPanel();
        content.Spacing(6);

        auto name = TextBlock();
        name.Style(LookupStyle(L"DrakonBodyTextStyle"));
        name.Text(to_hstring(camera.name));
        name.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(name);

        auto meta = TextBlock();
        meta.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        meta.Text(to_hstring(
            (camera.city.empty() ? std::string("Cidade não informada") : camera.city) +
            " • " +
            (camera.stateCode.empty() ? std::string("--") : camera.stateCode) +
            (excluded ? std::string(" • desmarcada") : std::string(" • selecionada"))));
        meta.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(meta);

        border.Child(content);
        button.Content(border);
        return button;
    }

    UIElement DrakonFindPage::CreateSearchCard(services::DrakonFindSearch const& search) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(16));

        auto content = StackPanel();
        content.Spacing(10);

        auto header = Grid();
        header.ColumnDefinitions().Append(ColumnDefinition{});
        auto actionColumn = ColumnDefinition();
        actionColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Auto));
        header.ColumnDefinitions().Append(actionColumn);

        auto titleStack = StackPanel();
        titleStack.Spacing(4);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));
        title.Text(to_hstring(search.targetName));
        title.TextWrapping(TextWrapping::WrapWholeWords);
        titleStack.Children().Append(title);

        auto subtitle = TextBlock();
        subtitle.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        subtitle.Text(to_hstring(
            "#" + std::to_string(search.id) + " • " +
            search.status + " • " +
            std::to_string(search.eligibleCameraCount) + " câmera(s) • " +
            std::to_string(search.hitCount) + " hit(s)"));
        subtitle.TextWrapping(TextWrapping::WrapWholeWords);
        titleStack.Children().Append(subtitle);
        header.Children().Append(titleStack);

        auto actionPanel = StackPanel();
        actionPanel.Orientation(Orientation::Horizontal);
        actionPanel.Spacing(8);

        if (IsActiveSearchStatus(search.status))
        {
            auto cancelButton = Button();
            cancelButton.Tag(box_value(search.id));
            cancelButton.Content(box_value(L"Cancelar"));
            cancelButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnCancelSearchClick });
            actionPanel.Children().Append(cancelButton);
        }
        else
        {
            auto retryButton = Button();
            retryButton.Tag(box_value(search.id));
            retryButton.Content(box_value(L"Retry"));
            retryButton.IsEnabled(search.pendingCameraCount == 0);
            retryButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnRetrySearchClick });
            actionPanel.Children().Append(retryButton);

            auto deleteButton = Button();
            deleteButton.Tag(box_value(search.id));
            deleteButton.Content(box_value(L"Excluir"));
            deleteButton.IsEnabled(search.pendingCameraCount == 0);
            deleteButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnDeleteSearchClick });
            actionPanel.Children().Append(deleteButton);
        }

        Grid::SetColumn(actionPanel, 1);
        header.Children().Append(actionPanel);
        content.Children().Append(header);

        auto statusBorder = Border();
        statusBorder.Background(StatusBrush(search.status));
        statusBorder.CornerRadius(CornerRadiusHelper::FromUniformRadius(999));
        statusBorder.Padding(ThicknessHelper::FromLengths(10, 6, 10, 6));
        statusBorder.HorizontalAlignment(HorizontalAlignment::Left);

        auto statusText = TextBlock();
        statusText.Text(StatusLabel(search.status));
        statusText.Foreground(LookupBrush(L"DrakonStrongTextBrush"));
        statusBorder.Child(statusText);
        content.Children().Append(statusBorder);

        auto runtime = TextBlock();
        runtime.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        runtime.Text(to_hstring(
            "Duração " + FormatDurationLabel(search.durationSeconds) +
            " • owners " + std::to_string(search.eligibleOwnerCount) +
            " • último evento " + FormatDateTimeShort(search.lastEventAt.empty() ? search.updatedAt : search.lastEventAt)));
        runtime.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(runtime);

        if (!search.lastError.empty())
        {
            auto errorText = TextBlock();
            errorText.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            errorText.Text(to_hstring(search.lastError));
            errorText.TextWrapping(TextWrapping::WrapWholeWords);
            content.Children().Append(errorText);
        }

        border.Child(content);
        return border;
    }

    UIElement DrakonFindPage::CreateHitCard(services::DrakonFindHit const& hit) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(16));

        auto content = StackPanel();
        content.Spacing(8);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));
        title.Text(to_hstring(hit.cameraName.empty() ? std::string("Câmera sem nome") : hit.cameraName));
        title.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(title);

        auto summary = TextBlock();
        summary.Style(LookupStyle(L"DrakonBodyTextStyle"));
        summary.Text(to_hstring(hit.summary));
        summary.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(summary);

        auto meta = TextBlock();
        meta.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        meta.Text(to_hstring(
            "Busca #" + std::to_string(hit.searchId) +
            " • confiança " + FormatConfidence(hit.confidence) +
            " • " + FormatDateTimeShort(hit.matchedAt)));
        meta.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(meta);

        if (!hit.imageUrl.empty() || !hit.videoUrl.empty())
        {
            auto media = TextBlock();
            media.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            media.Text(to_hstring(
                (!hit.imageUrl.empty() ? "imagem disponível" : "") +
                (!hit.imageUrl.empty() && !hit.videoUrl.empty() ? std::string(" • ") : std::string("")) +
                (!hit.videoUrl.empty() ? "vídeo disponível" : "")));
            content.Children().Append(media);
        }

        auto deleteButton = Button();
        deleteButton.Tag(box_value(hit.id));
        deleteButton.Content(box_value(L"Excluir alerta"));
        deleteButton.Click({ const_cast<DrakonFindPage*>(this), &DrakonFindPage::OnDeleteHitClick });
        content.Children().Append(deleteButton);

        border.Child(content);
        return border;
    }

    UIElement DrakonFindPage::CreateAuditCard(services::DrakonFindAuditLog const& audit) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonInsetPanelStyle"));
        border.Padding(ThicknessHelper::FromUniformLength(14));

        auto content = StackPanel();
        content.Spacing(6);

        auto title = TextBlock();
        title.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        title.Text(to_hstring(audit.actionType.empty() ? std::string("event") : audit.actionType));
        content.Children().Append(title);

        auto message = TextBlock();
        message.Style(LookupStyle(L"DrakonBodyTextStyle"));
        message.Text(to_hstring(audit.message));
        message.TextWrapping(TextWrapping::WrapWholeWords);
        content.Children().Append(message);

        auto created = TextBlock();
        created.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        created.Text(to_hstring(FormatDateTimeShort(audit.createdAt)));
        content.Children().Append(created);

        border.Child(content);
        return border;
    }

    void DrakonFindPage::RenderTargets()
    {
        auto host = FindName(L"TargetCatalogItemsHost").as<StackPanel>();
        host.Children().Clear();

        if (m_targets.empty())
        {
            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"Nenhum target cadastrado ainda.");
            host.Children().Append(empty);
            return;
        }

        for (auto const& target : m_targets)
        {
            host.Children().Append(CreateTargetCard(target));
        }
    }

    void DrakonFindPage::RenderSelectedTarget()
    {
        auto title = FindName(L"SelectedTargetTitleText").as<TextBlock>();
        auto description = FindName(L"SelectedTargetDescriptionText").as<TextBlock>();
        auto meta = FindName(L"SelectedTargetMetaText").as<TextBlock>();
        auto imagesHost = FindName(L"SelectedTargetImagesHost").as<StackPanel>();
        auto deleteButton = FindName(L"DeleteSelectedTargetButton").as<Button>();
        imagesHost.Children().Clear();

        auto const* selectedTarget = SelectedTarget();
        if (!selectedTarget)
        {
            title.Text(L"Nenhum target selecionado");
            description.Text(L"Selecione um alvo no catálogo para montar a próxima busca.");
            meta.Text(L"0 imagens • 0 buscas vinculadas");
            deleteButton.Tag(box_value(0));
            deleteButton.IsEnabled(false);

            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"O preview do target aparece aqui.");
            imagesHost.Children().Append(empty);
            return;
        }

        title.Text(to_hstring(selectedTarget->name));
        description.Text(to_hstring(selectedTarget->description));
        meta.Text(to_hstring(
            std::to_string(selectedTarget->imageCount) + " imagens • " +
            std::to_string(selectedTarget->searchCount) + " busca(s) vinculada(s)"));
        deleteButton.Tag(box_value(selectedTarget->id));
        deleteButton.IsEnabled(selectedTarget->searchCount <= 0);

        if (selectedTarget->images.empty())
        {
            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"Sem imagens carregadas neste slice nativo. O contador e a exclusão já seguem o backend.");
            empty.TextWrapping(TextWrapping::WrapWholeWords);
            imagesHost.Children().Append(empty);
            return;
        }

        for (auto const& image : selectedTarget->images)
        {
            imagesHost.Children().Append(CreateTargetImageCard(image, true));
        }
    }

    void DrakonFindPage::RenderScope()
    {
        auto summary = FindName(L"ScopeSummaryText").as<TextBlock>();
        auto preview = FindName(L"ScopePreviewSummaryText").as<TextBlock>();
        auto hint = FindName(L"ScopeHintText").as<TextBlock>();
        auto statesHost = FindName(L"ScopeStateItemsHost").as<StackPanel>();
        auto camerasHost = FindName(L"ScopeCameraItemsHost").as<StackPanel>();
        statesHost.Children().Clear();
        camerasHost.Children().Clear();

        if (!m_scope.has_value())
        {
            summary.Text(L"Escopo ainda não resolvido.");
            preview.Text(L"O preview aparece aqui assim que o escopo for resolvido.");
            hint.Text(L"Selecione UFs e resolva o escopo para carregar o preview antes do dispatch.");
            return;
        }

        summary.Text(to_hstring(
            std::to_string(EffectiveEligibleCameraCount()) + " câmera(s) ativas • " +
            std::to_string(IncludedOwnerCount()) + " owner(s)"));
        preview.Text(to_hstring(
            std::to_string(m_scope->eligibleCameraCount) + " elegíveis • atualizado em " +
            (m_scope->previewUpdatedAt.empty() ? std::string("--") : m_scope->previewUpdatedAt)));
        hint.Text(to_hstring(
            "Estados " + JoinStrings(m_selectedStates, ", ") +
            " • " + std::to_string(m_excludedCameraIds.size()) + " câmera(s) desmarcadas manualmente."));

        for (auto const& state : m_scope->states)
        {
            statesHost.Children().Append(CreateScopeStateCard(state));
        }

        if (m_scope->cameras.empty())
        {
            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"Nenhuma câmera elegível para os estados atuais.");
            camerasHost.Children().Append(empty);
            return;
        }

        for (auto const& camera : m_scope->cameras)
        {
            camerasHost.Children().Append(CreateScopeCameraCard(camera));
        }
    }

    void DrakonFindPage::RenderSearches()
    {
        auto host = FindName(L"SearchItemsHost").as<StackPanel>();
        host.Children().Clear();

        if (m_searches.empty())
        {
            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"Nenhuma busca criada ainda.");
            host.Children().Append(empty);
            return;
        }

        for (auto const& search : m_searches)
        {
            host.Children().Append(CreateSearchCard(search));
        }
    }

    void DrakonFindPage::RenderHits()
    {
        auto host = FindName(L"HitItemsHost").as<StackPanel>();
        host.Children().Clear();

        if (m_hits.empty())
        {
            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"Assim que os primeiros matches chegarem, eles aparecem aqui.");
            host.Children().Append(empty);
            return;
        }

        for (auto const& hit : m_hits)
        {
            host.Children().Append(CreateHitCard(hit));
        }
    }

    void DrakonFindPage::RenderAudit()
    {
        auto host = FindName(L"AuditItemsHost").as<StackPanel>();
        host.Children().Clear();

        if (m_audit.empty())
        {
            auto empty = TextBlock();
            empty.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            empty.Text(L"Assim que os primeiros eventos acontecerem, eles aparecem aqui.");
            host.Children().Append(empty);
            return;
        }

        for (auto const& audit : m_audit)
        {
            host.Children().Append(CreateAuditCard(audit));
        }
    }

    void DrakonFindPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"DrakonFindInfoBar").as<InfoBar>();
        infoBar.Severity(severity);
        infoBar.Message(message);
        infoBar.IsOpen(true);
    }

    Windows::Foundation::IAsyncAction DrakonFindPage::RefreshAllAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing Drakon Find collections and scope preview...", InfoBarSeverity::Informational);
        }

        auto selectedStates = ParseSelectedStates();

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetDrakonFindTargets()) targets{};
        decltype(services::DrakonApiClient::Instance().GetDrakonFindSearches()) searches{};
        decltype(services::DrakonApiClient::Instance().GetDrakonFindAuditLog(40)) audit{};
        decltype(services::DrakonApiClient::Instance().GetDrakonFindHits(40)) hits{};
        decltype(services::DrakonApiClient::Instance().ResolveDrakonFindScope("BR", selectedStates, m_excludedCameraIds)) scope{};

        if (auth.success && auth.value.isAuthenticated)
        {
            targets = services::DrakonApiClient::Instance().GetDrakonFindTargets();
            searches = services::DrakonApiClient::Instance().GetDrakonFindSearches();
            audit = services::DrakonApiClient::Instance().GetDrakonFindAuditLog(40);
            hits = services::DrakonApiClient::Instance().GetDrakonFindHits(40);
            if (!selectedStates.empty())
            {
                scope = services::DrakonApiClient::Instance().ResolveDrakonFindScope("BR", selectedStates, m_excludedCameraIds);
            }
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated &&
            targets.success && searches.success && audit.success && hits.success)
        {
            auto previousTargetId = m_selectedTargetId;
            m_targets = std::move(targets.value);
            m_searches = std::move(searches.value);
            m_audit = std::move(audit.value);
            m_hits = std::move(hits.value);
            m_selectedStates = std::move(selectedStates);
            m_loadedRemoteData = true;
            m_usingLocalFallback = false;

            if (previousTargetId.has_value() && FindTargetIndex(*previousTargetId).has_value())
            {
                m_selectedTargetId = previousTargetId;
            }
            else if (!m_targets.empty())
            {
                m_selectedTargetId = m_targets.front().id;
            }
            else
            {
                m_selectedTargetId.reset();
            }

            if (!m_selectedStates.empty() && scope.success)
            {
                m_scope = scope.value;
            }
            else if (m_selectedStates.empty())
            {
                m_scope.reset();
            }

            UpdateMetrics();
            RenderTargets();
            RenderSelectedTarget();
            RenderScope();
            RenderSearches();
            RenderHits();
            RenderAudit();

            if (announceResult)
            {
                ShowStatus(
                    L"Drakon Find synchronized from backend. " + to_hstring(m_targets.size()) + L" target(s) loaded.",
                    InfoBarSeverity::Success);
            }
            co_return;
        }

        m_selectedStates = std::move(selectedStates);
        if (!m_selectedStates.empty())
        {
            m_scope = BuildFallbackScope(m_selectedStates, m_excludedCameraIds);
        }
        else
        {
            m_scope.reset();
        }

        UpdateMetrics();
        RenderScope();

        if (announceResult)
        {
            ShowStatus(
                L"Backend unavailable or not authenticated. Keeping the local fallback preview active.",
                InfoBarSeverity::Warning);
        }
    }

    fire_and_forget DrakonFindPage::ResolveScopeAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        SyncStateSelectionFromInput();
        if (m_selectedStates.empty())
        {
            m_scope.reset();
            RenderScope();
            UpdateMetrics();
            ShowStatus(L"Choose at least one state code before resolving the scope.", InfoBarSeverity::Warning);
            co_return;
        }

        if (announceResult)
        {
            ShowStatus(L"Resolving Drakon Find scope preview...", InfoBarSeverity::Informational);
        }

        auto selectedStates = m_selectedStates;
        auto excludedCameraIds = m_excludedCameraIds;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().ResolveDrakonFindScope("BR", selectedStates, excludedCameraIds)) scope{};

        if (auth.success && auth.value.isAuthenticated)
        {
            scope = services::DrakonApiClient::Instance().ResolveDrakonFindScope("BR", selectedStates, excludedCameraIds);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated && scope.success)
        {
            m_scope = scope.value;
            m_loadedRemoteData = true;
            m_usingLocalFallback = false;
            RenderScope();
            UpdateMetrics();

            if (announceResult)
            {
                ShowStatus(
                    L"Scope preview loaded with " + to_hstring(m_scope->eligibleCameraCount) + L" eligible camera(s).",
                    InfoBarSeverity::Success);
            }
            co_return;
        }

        m_scope = BuildFallbackScope(m_selectedStates, m_excludedCameraIds);
        RenderScope();
        UpdateMetrics();

        if (announceResult)
        {
            ShowStatus(L"Using fallback scope preview because the backend scope is unavailable.", InfoBarSeverity::Warning);
        }
    }

    fire_and_forget DrakonFindPage::CreateTargetAsync()
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        auto entityCombo = FindName(L"EntityTypeComboBox").as<ComboBox>();
        auto nameTextBox = FindName(L"TargetNameTextBox").as<TextBox>();
        auto descriptionTextBox = FindName(L"TargetDescriptionTextBox").as<TextBox>();
        auto traitsTextBox = FindName(L"TargetTraitsTextBox").as<TextBox>();

        std::string entityType = "object";
        if (auto selected = entityCombo.SelectedItem().try_as<ComboBoxItem>())
        {
            entityType = to_string(unbox_value_or<hstring>(selected.Tag(), L"object"));
        }

        services::DrakonFindCreateTargetRequest request;
        request.entityType = entityType;
        request.name = TrimAsciiFind(to_string(nameTextBox.Text()));
        request.description = TrimAsciiFind(to_string(descriptionTextBox.Text()));
        request.traits = ParseStateSelectionText(to_string(traitsTextBox.Text()));

        if (request.name.empty() || request.description.empty())
        {
            ShowStatus(L"Target name and description are required.", InfoBarSeverity::Warning);
            co_return;
        }

        ShowStatus(L"Creating Drakon Find target...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().CreateDrakonFindTarget(request)) create{};
        if (auth.success && auth.value.isAuthenticated)
        {
            create = services::DrakonApiClient::Instance().CreateDrakonFindTarget(request);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!create.success)
            {
                ShowStatus(
                    to_hstring(create.error.empty() ? std::string("Failed to create target.") : create.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            nameTextBox.Text(L"");
            descriptionTextBox.Text(L"");
            traitsTextBox.Text(L"");
            co_await RefreshAllAsync(false);
            m_selectedTargetId = create.value.id;
            RenderTargets();
            RenderSelectedTarget();
            UpdateMetrics();
            ShowStatus(L"Target created and synchronized from the backend.", InfoBarSeverity::Success);
            co_return;
        }

        services::DrakonFindTarget created;
        created.id = m_targets.empty() ? 1 : (m_targets.front().id + 1);
        created.userId = "fallback-user";
        created.entityType = request.entityType;
        created.name = request.name;
        created.description = request.description;
        created.traits = request.traits;
        created.imageCount = 0;
        created.searchCount = 0;
        m_targets.insert(m_targets.begin(), created);
        m_selectedTargetId = created.id;
        nameTextBox.Text(L"");
        descriptionTextBox.Text(L"");
        traitsTextBox.Text(L"");
        UpdateMetrics();
        RenderTargets();
        RenderSelectedTarget();
        ShowStatus(L"Target created in local fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget DrakonFindPage::CreateSearchAsync()
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        SyncStateSelectionFromInput();
        auto const* target = SelectedTarget();
        if (!target)
        {
            ShowStatus(L"Select a target before creating a search.", InfoBarSeverity::Warning);
            co_return;
        }
        if (m_selectedStates.empty())
        {
            ShowStatus(L"Choose at least one state code before creating a search.", InfoBarSeverity::Warning);
            co_return;
        }
        if (EffectiveEligibleCameraCount() <= 0)
        {
            ShowStatus(L"Reactivate at least one camera in the scope preview before dispatching.", InfoBarSeverity::Warning);
            co_return;
        }

        services::DrakonFindCreateSearchRequest request;
        request.targetId = target->id;
        request.countryCode = m_countryCode;
        request.selectedStates = m_selectedStates;
        request.durationSeconds = SelectedDurationSeconds();
        request.excludedCameraIds = m_excludedCameraIds;

        ShowStatus(L"Dispatching Drakon Find search...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().CreateDrakonFindSearch(request)) create{};
        if (auth.success && auth.value.isAuthenticated)
        {
            create = services::DrakonApiClient::Instance().CreateDrakonFindSearch(request);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!create.success)
            {
                ShowStatus(
                    to_hstring(create.error.empty() ? std::string("Failed to create search.") : create.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Search created and sent to the distributed orchestrator.", InfoBarSeverity::Success);
            co_return;
        }

        services::DrakonFindSearch local;
        local.id = m_searches.empty() ? 1 : (m_searches.front().id + 1);
        local.userId = "fallback-user";
        local.targetId = target->id;
        local.targetName = target->name;
        local.targetEntityType = target->entityType;
        local.targetDescription = target->description;
        local.status = "queued";
        local.runtimeMode = "distributed";
        local.inputType = "video_60s";
        local.windowSeconds = 60;
        local.durationSeconds = request.durationSeconds;
        local.countryCode = request.countryCode;
        local.selectedStates = request.selectedStates;
        local.selectedStateCount = static_cast<int32_t>(request.selectedStates.size());
        local.eligibleCameraCount = EffectiveEligibleCameraCount();
        local.eligibleOwnerCount = IncludedOwnerCount();
        local.pendingCameraCount = local.eligibleCameraCount;
        local.createdAt = "fallback";
        local.updatedAt = "fallback";
        m_searches.insert(m_searches.begin(), local);

        for (auto& item : m_targets)
        {
            if (item.id == target->id)
            {
                item.searchCount += 1;
                item.queuedSearchCount += 1;
            }
        }

        services::DrakonFindAuditLog audit;
        audit.id = m_audit.empty() ? 1 : (m_audit.front().id + 1);
        audit.actionType = "search_created";
        audit.message = "Busca criada em modo fallback para o target '" + target->name + "'.";
        audit.createdAt = "fallback";
        m_audit.insert(m_audit.begin(), audit);

        UpdateMetrics();
        RenderTargets();
        RenderSelectedTarget();
        RenderSearches();
        RenderAudit();
        ShowStatus(L"Search created in local fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget DrakonFindPage::DeleteTargetAsync(int32_t targetId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        auto index = FindTargetIndex(targetId);
        if (!index.has_value())
        {
            co_return;
        }

        if (m_targets[*index].searchCount > 0)
        {
            ShowStatus(L"Remove linked searches before deleting this target.", InfoBarSeverity::Warning);
            co_return;
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().DeleteDrakonFindTarget(targetId)) remove{};
        if (auth.success && auth.value.isAuthenticated)
        {
            remove = services::DrakonApiClient::Instance().DeleteDrakonFindTarget(targetId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!remove.success)
            {
                ShowStatus(
                    to_hstring(remove.error.empty() ? std::string("Failed to delete target.") : remove.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Target removed from backend catalog.", InfoBarSeverity::Success);
            co_return;
        }

        m_targets.erase(m_targets.begin() + static_cast<std::ptrdiff_t>(*index));
        if (m_selectedTargetId == targetId)
        {
            m_selectedTargetId = m_targets.empty() ? std::optional<int32_t>{} : std::optional<int32_t>{ m_targets.front().id };
        }
        UpdateMetrics();
        RenderTargets();
        RenderSelectedTarget();
        ShowStatus(L"Target removed from local fallback catalog.", InfoBarSeverity::Success);
    }

    fire_and_forget DrakonFindPage::DeleteTargetImageAsync(int32_t targetId, int32_t imageId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().DeleteDrakonFindTargetImage(targetId, imageId)) remove{};
        if (auth.success && auth.value.isAuthenticated)
        {
            remove = services::DrakonApiClient::Instance().DeleteDrakonFindTargetImage(targetId, imageId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!remove.success)
            {
                ShowStatus(
                    to_hstring(remove.error.empty() ? std::string("Failed to delete target image.") : remove.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Target image removed from backend.", InfoBarSeverity::Success);
            co_return;
        }

        if (auto index = FindTargetIndex(targetId); index.has_value())
        {
            auto& images = m_targets[*index].images;
            images.erase(
                std::remove_if(
                    images.begin(),
                    images.end(),
                    [&](services::DrakonFindTargetImage const& image) { return image.id == imageId; }),
                images.end());
            m_targets[*index].imageCount = static_cast<int32_t>(images.size());
            RenderSelectedTarget();
            UpdateMetrics();
            ShowStatus(L"Target image removed from local fallback.", InfoBarSeverity::Success);
        }
    }

    fire_and_forget DrakonFindPage::CancelSearchAsync(int32_t searchId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().CancelDrakonFindSearch(searchId)) cancel{};
        if (auth.success && auth.value.isAuthenticated)
        {
            cancel = services::DrakonApiClient::Instance().CancelDrakonFindSearch(searchId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!cancel.success)
            {
                ShowStatus(
                    to_hstring(cancel.error.empty() ? std::string("Failed to cancel search.") : cancel.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Cancellation sent to the agents.", InfoBarSeverity::Success);
            co_return;
        }

        for (auto& search : m_searches)
        {
            if (search.id == searchId)
            {
                search.status = "cancelled";
                search.pendingCameraCount = 0;
                search.updatedAt = "fallback";
            }
        }
        RenderSearches();
        ShowStatus(L"Search cancelled in local fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget DrakonFindPage::RetrySearchAsync(int32_t searchId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().RetryDrakonFindSearch(searchId)) retry{};
        if (auth.success && auth.value.isAuthenticated)
        {
            retry = services::DrakonApiClient::Instance().RetryDrakonFindSearch(searchId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!retry.success)
            {
                ShowStatus(
                    to_hstring(retry.error.empty() ? std::string("Failed to retry search.") : retry.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Search placed back in queue.", InfoBarSeverity::Success);
            co_return;
        }

        for (auto& search : m_searches)
        {
            if (search.id == searchId)
            {
                search.status = "queued";
                search.attemptCount += 1;
                search.pendingCameraCount = search.eligibleCameraCount;
            }
        }
        RenderSearches();
        ShowStatus(L"Search retried in local fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget DrakonFindPage::DeleteSearchAsync(int32_t searchId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        auto searchIt = std::find_if(
            m_searches.begin(),
            m_searches.end(),
            [&](services::DrakonFindSearch const& search) { return search.id == searchId; });
        if (searchIt == m_searches.end())
        {
            co_return;
        }

        if (IsActiveSearchStatus(searchIt->status) || searchIt->pendingCameraCount > 0)
        {
            ShowStatus(L"Wait for the search to finish propagating before deleting it.", InfoBarSeverity::Warning);
            co_return;
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().DeleteDrakonFindSearch(searchId)) remove{};
        if (auth.success && auth.value.isAuthenticated)
        {
            remove = services::DrakonApiClient::Instance().DeleteDrakonFindSearch(searchId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!remove.success)
            {
                ShowStatus(
                    to_hstring(remove.error.empty() ? std::string("Failed to delete search.") : remove.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Search removed from the panel.", InfoBarSeverity::Success);
            co_return;
        }

        m_searches.erase(searchIt);
        UpdateMetrics();
        RenderSearches();
        ShowStatus(L"Search removed from local fallback mode.", InfoBarSeverity::Success);
    }

    fire_and_forget DrakonFindPage::DeleteHitAsync(int32_t hitId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().DeleteDrakonFindHit(hitId)) remove{};
        if (auth.success && auth.value.isAuthenticated)
        {
            remove = services::DrakonApiClient::Instance().DeleteDrakonFindHit(hitId);
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (!remove.success)
            {
                ShowStatus(
                    to_hstring(remove.error.empty() ? std::string("Failed to delete hit.") : remove.error),
                    InfoBarSeverity::Error);
                co_return;
            }

            co_await RefreshAllAsync(false);
            ShowStatus(L"Hit removed from the live results.", InfoBarSeverity::Success);
            co_return;
        }

        m_hits.erase(
            std::remove_if(
                m_hits.begin(),
                m_hits.end(),
                [&](services::DrakonFindHit const& hit) { return hit.id == hitId; }),
            m_hits.end());
        UpdateMetrics();
        RenderHits();
        ShowStatus(L"Hit removed from local fallback mode.", InfoBarSeverity::Success);
    }

    void DrakonFindPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        RefreshAllAsync(true);
    }

    void DrakonFindPage::OnCreateTargetClick(IInspectable const&, RoutedEventArgs const&)
    {
        CreateTargetAsync();
    }

    void DrakonFindPage::OnResolveScopeClick(IInspectable const&, RoutedEventArgs const&)
    {
        ResolveScopeAsync(true);
    }

    void DrakonFindPage::OnCreateSearchClick(IInspectable const&, RoutedEventArgs const&)
    {
        CreateSearchAsync();
    }

    void DrakonFindPage::OnStateSelectionChanged(IInspectable const&, TextChangedEventArgs const&)
    {
        SyncStateSelectionFromInput();
        if (m_selectedStates.empty())
        {
            m_scope.reset();
            m_excludedCameraIds.clear();
        }
        RenderScope();
        UpdateMetrics();
    }

    void DrakonFindPage::OnSelectTargetClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto targetId = ReadTaggedInt32(sender);
        if (targetId <= 0)
        {
            return;
        }
        m_selectedTargetId = targetId;
        RenderTargets();
        RenderSelectedTarget();
    }

    void DrakonFindPage::OnDeleteTargetClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto targetId = ReadTaggedInt32(sender);
        if (targetId <= 0)
        {
            targetId = m_selectedTargetId.value_or(0);
        }
        if (targetId > 0)
        {
            DeleteTargetAsync(targetId);
        }
    }

    void DrakonFindPage::OnDeleteTargetImageClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto pair = ReadTaggedPair(sender);
        if (pair.has_value())
        {
            DeleteTargetImageAsync(pair->first, pair->second);
        }
    }

    void DrakonFindPage::OnToggleScopeCameraClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto cameraId = ReadTaggedInt32(sender);
        if (cameraId <= 0)
        {
            return;
        }

        auto it = std::find(m_excludedCameraIds.begin(), m_excludedCameraIds.end(), cameraId);
        if (it == m_excludedCameraIds.end())
        {
            m_excludedCameraIds.push_back(cameraId);
        }
        else
        {
            m_excludedCameraIds.erase(it);
        }

        RenderScope();
        UpdateMetrics();
    }

    void DrakonFindPage::OnCancelSearchClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto searchId = ReadTaggedInt32(sender);
        if (searchId > 0)
        {
            CancelSearchAsync(searchId);
        }
    }

    void DrakonFindPage::OnRetrySearchClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto searchId = ReadTaggedInt32(sender);
        if (searchId > 0)
        {
            RetrySearchAsync(searchId);
        }
    }

    void DrakonFindPage::OnDeleteSearchClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto searchId = ReadTaggedInt32(sender);
        if (searchId > 0)
        {
            DeleteSearchAsync(searchId);
        }
    }

    void DrakonFindPage::OnDeleteHitClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto hitId = ReadTaggedInt32(sender);
        if (hitId > 0)
        {
            DeleteHitAsync(hitId);
        }
    }

    void DrakonFindPage::OnPageSizeChanged(IInspectable const&, SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }

    void DrakonFindPage::OnPollTimerTick(IInspectable const&, IInspectable const&)
    {
        ++m_pollTick;
        if (m_pollTick % PollIntervalSeconds == 0)
        {
            RefreshAllAsync(false);
        }
    }
}
