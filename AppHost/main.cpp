#include "pch.h"
#include "App.xaml.h"
#include "BootstrapTrace.h"
#include "Platform\\AppRuntimeConfig.h"
#include "..\\Perceptrum\\Perceptrum\\runtime\\HeadlessService.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;

int __stdcall wWinMain([[maybe_unused]] HINSTANCE instance, [[maybe_unused]] HINSTANCE previousInstance, [[maybe_unused]] PWSTR commandLine, [[maybe_unused]] int commandShow)
{
    ResetBootstrapTrace();
    AppendBootstrapTrace("main: entry");

    try
    {
        ::DrakonDesktop::platform::InitializeRuntimeConfig();
        auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
        if (runtimeConfig.internalServiceMode)
        {
            AppendBootstrapTrace("main: internal service-cpp mode");
            return ::PerceptrumCore::RunHeadlessService({ runtimeConfig.shutdownEventName });
        }

        init_apartment(apartment_type::single_threaded);
        AppendBootstrapTrace("main: apartment initialized");

        AppendBootstrapTrace("main: calling Application::Start");
        Application::Start([](auto&&)
        {
            AppendBootstrapTrace("main: Application::Start callback begin");
            auto app = make<winrt::DrakonDesktop::implementation::App>();
            AppendBootstrapTrace("main: App instance created");
            [[maybe_unused]] auto keepAlive = app;
        });
        AppendBootstrapTrace("main: Application::Start returned");
        return 0;
    }
    catch (winrt::hresult_error const& ex)
    {
        AppendBootstrapTrace("main: hresult_error");
        AppendBootstrapTrace(winrt::to_string(ex.message()));
    }
    catch (std::exception const& ex)
    {
        AppendBootstrapTrace("main: std::exception");
        AppendBootstrapTrace(ex.what());
    }
    catch (...)
    {
        AppendBootstrapTrace("main: unknown exception");
    }

    return 1;
}
