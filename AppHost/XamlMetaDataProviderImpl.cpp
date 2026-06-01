#include "pch.h"
#include "XamlMetaDataProvider.h"
#include "XamlMetaDataProvider.g.cpp"

namespace winrt::DrakonDesktop::implementation
{
    XamlMetaDataProvider::XamlMetaDataProvider()
    {
        m_frameworkProvider = winrt::Microsoft::UI::Xaml::XamlTypeInfo::XamlControlsXamlMetaDataProvider{};
        m_frameworkProvider.Initialize();
    }

    winrt::Microsoft::UI::Xaml::Markup::IXamlType XamlMetaDataProvider::GetXamlType(winrt::Windows::UI::Xaml::Interop::TypeName const& type)
    {
        return m_frameworkProvider ? m_frameworkProvider.GetXamlType(type) : nullptr;
    }

    winrt::Microsoft::UI::Xaml::Markup::IXamlType XamlMetaDataProvider::GetXamlType(hstring const& fullName)
    {
        return m_frameworkProvider ? m_frameworkProvider.GetXamlType(fullName) : nullptr;
    }

    com_array<winrt::Microsoft::UI::Xaml::Markup::XmlnsDefinition> XamlMetaDataProvider::GetXmlnsDefinitions()
    {
        return m_frameworkProvider ? m_frameworkProvider.GetXmlnsDefinitions() : com_array<winrt::Microsoft::UI::Xaml::Markup::XmlnsDefinition>{};
    }
}
