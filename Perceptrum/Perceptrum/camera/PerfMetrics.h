#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif
#include <cstdint>

class ThreadCpuMeter {
public:
    void init() {
#ifdef _WIN32
        hThread_ = GetCurrentThread();
        lastWallMs_ = GetTickCount64();
        lastCpu100ns_ = readCpu100ns_();
#endif
    }

    // Retorna % de um core no intervalo desde a última chamada.
    double samplePercent() {
#ifdef _WIN32
        const uint64_t nowWallMs = GetTickCount64();
        const uint64_t nowCpu100ns = readCpu100ns_();

        const uint64_t dWallMs = nowWallMs - lastWallMs_;
        const uint64_t dCpu100ns = nowCpu100ns - lastCpu100ns_;

        lastWallMs_ = nowWallMs;
        lastCpu100ns_ = nowCpu100ns;

        if (dWallMs == 0) return 0.0;

        // CPU time (100ns) -> ms
        const double cpuMs = (double)dCpu100ns / 10'000.0;
        const double wallMs = (double)dWallMs;

        // % de 1 core
        return (cpuMs / wallMs) * 100.0;
#else
        return 0.0;
#endif
    }

private:
#ifdef _WIN32
    uint64_t readCpu100ns_() const {
        FILETIME ct, et, kt, ut;
        if (!GetThreadTimes(hThread_, &ct, &et, &kt, &ut)) return 0;

        ULARGE_INTEGER k, u;
        k.LowPart = kt.dwLowDateTime; k.HighPart = kt.dwHighDateTime;
        u.LowPart = ut.dwLowDateTime; u.HighPart = ut.dwHighDateTime;
        return (uint64_t)(k.QuadPart + u.QuadPart); // 100ns units
    }

    HANDLE hThread_ = nullptr;
    uint64_t lastWallMs_ = 0;
    uint64_t lastCpu100ns_ = 0;
#endif
};
