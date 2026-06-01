#pragma once

#include "XamlMetaDataProvider.g.h"

#include <winrt/Microsoft.UI.Xaml.Markup.h>
#include <winrt/Microsoft.UI.Xaml.XamlTypeInfo.h>
#include <winrt/Windows.UI.Xaml.Interop.h>

namespace winrt::DrakonDesktop::implementation
{
    struct XamlMetaDataProvider : XamlMetaDataProviderT<XamlMetaDataProvider>
    {
        XamlMetaDataProvider();

        winrt::Microsoft::UI::Xaml::Markup::IXamlType GetXamlType(winrt::Windows::UI::Xaml::Interop::TypeName const& type);
        winrt::Microsoft::UI::Xaml::Markup::IXamlType GetXamlType(hstring const& fullName);
        com_array<winrt::Microsoft::UI::Xaml::Markup::XmlnsDefinition> GetXmlnsDefinitions();

    private:
        winrt::Microsoft::UI::Xaml::XamlTypeInfo::XamlControlsXamlMetaDataProvider m_frameworkProvider{ nullptr };
    };
}

namespace winrt::DrakonDesktop::factory_implementation
{
    struct XamlMetaDataProvider : XamlMetaDataProviderT<XamlMetaDataProvider, implementation::XamlMetaDataProvider>
    {
    };
}
