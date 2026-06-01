#pragma once

namespace winrt::DrakonDesktop::implementation
{
    struct ModulePlaceholderPage : winrt::Microsoft::UI::Xaml::Controls::PageT<ModulePlaceholderPage>
    {
        ModulePlaceholderPage();

        void InitializeComponent();
        void Configure(winrt::hstring const& title, winrt::hstring const& subtitle, winrt::hstring const& source);

    private:
        bool m_initialized{ false };
    };
}
