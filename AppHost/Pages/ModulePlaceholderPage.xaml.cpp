#include "pch.h"
#include "ModulePlaceholderPage.xaml.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;

namespace winrt::DrakonDesktop::implementation
{
    ModulePlaceholderPage::ModulePlaceholderPage()
    {
        InitializeComponent();
    }

    void ModulePlaceholderPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/ModulePlaceholderPage.xaml" });

        m_initialized = true;
    }

    void ModulePlaceholderPage::Configure(hstring const& title, hstring const& subtitle, hstring const& source)
    {
        if (auto titleText = FindName(L"TitleText").try_as<TextBlock>())
        {
            titleText.Text(title);
        }

        if (auto subtitleText = FindName(L"SubtitleText").try_as<TextBlock>())
        {
            subtitleText.Text(subtitle);
        }

        if (auto sourceText = FindName(L"SourceText").try_as<TextBlock>())
        {
            sourceText.Text(source);
        }
    }
}
