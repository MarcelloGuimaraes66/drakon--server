#pragma once

#include <string_view>

#if defined(_DEBUG)

#include <fstream>

inline constexpr char kBootstrapTracePath[] = "C:\\dev\\Drakon-Perceptrum\\Drakon.Desktop\\bootstrap-debug.log";

inline void ResetBootstrapTrace()
{
    std::ofstream trace{ kBootstrapTracePath, std::ios::trunc };
}

inline void AppendBootstrapTrace(std::string_view message)
{
    std::ofstream trace{ kBootstrapTracePath, std::ios::app };
    trace << message << std::endl;
}

#else

inline void ResetBootstrapTrace()
{
}

inline void AppendBootstrapTrace(std::string_view)
{
}

#endif
