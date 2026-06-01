extern "C" {
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/hwcontext.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>
#include <libavcodec/avcodec.h>
}

#include "RtspCapture.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <dxgi1_6.h>
#include <wrl/client.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <thread>

static std::string avErrorToString(int rc);

namespace {

using Microsoft::WRL::ComPtr;

constexpr UINT kNvidiaVendorId = 0x10DE;

static std::string narrowWideAscii(const wchar_t* value) {
    if (!value) {
        return {};
    }

    std::string out;
    for (const wchar_t* cursor = value; *cursor != L'\0'; ++cursor) {
        const wchar_t ch = *cursor;
        if (ch >= 32 && ch <= 126) {
            out.push_back(static_cast<char>(ch));
        }
        else if (ch == L'\t' || ch == L'\r' || ch == L'\n') {
            out.push_back(' ');
        }
        else {
            out.push_back('?');
        }
    }
    return out;
}

static std::string describeHwDeviceType(AVHWDeviceType deviceType) {
    const char* typeName = av_hwdevice_get_type_name(deviceType);
    return typeName ? std::string(typeName) : std::string("none");
}

static std::string describeDxgiAdapter(UINT index, const DXGI_ADAPTER_DESC1& desc) {
    const std::string name = narrowWideAscii(desc.Description);

    char buffer[384];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "index=%u vendor=0x%04X device=0x%04X dedicated_vram_mb=%llu flags=0x%08X name=\"%s\"",
        index,
        static_cast<unsigned int>(desc.VendorId),
        static_cast<unsigned int>(desc.DeviceId),
        static_cast<unsigned long long>(desc.DedicatedVideoMemory / (1024ull * 1024ull)),
        static_cast<unsigned int>(desc.Flags),
        name.c_str());
    return std::string(buffer);
}

static std::string describeCodecHardwareConfigs(const AVCodec* codec) {
    if (!codec) {
        return "none";
    }

    std::string out;
    for (int i = 0;; ++i) {
        const AVCodecHWConfig* hwConfig = avcodec_get_hw_config(codec, i);
        if (!hwConfig) {
            break;
        }

        if (!out.empty()) {
            out += "; ";
        }

        out += "index=" + std::to_string(i);
        out += ",device=" + describeHwDeviceType(hwConfig->device_type);
        out += ",methods=" + std::to_string(hwConfig->methods);
        out += ",pix_fmt=" + std::to_string(static_cast<int>(hwConfig->pix_fmt));
    }

    return out.empty() ? std::string("none") : out;
}

static std::string describePixelFormats(const AVPixelFormat* pixFmts) {
    if (!pixFmts) {
        return "null";
    }

    std::string out;
    for (const AVPixelFormat* pixFmt = pixFmts; *pixFmt != AV_PIX_FMT_NONE; ++pixFmt) {
        if (!out.empty()) {
            out += ", ";
        }

        const char* name = av_get_pix_fmt_name(*pixFmt);
        out += name ? std::string(name) : std::string("unknown");
        out += "(" + std::to_string(static_cast<int>(*pixFmt)) + ")";
    }

    return out.empty() ? std::string("none") : out;
}

static std::string hardwareBackendReason(const std::string& backend, const char* suffix) {
    if (backend.empty()) {
        return suffix ? std::string(suffix) : std::string();
    }

    if (!suffix || !*suffix) {
        return backend;
    }

    return backend + "_" + suffix;
}

static AVHWDeviceType hwDeviceTypeForBackend(const std::string& backend) {
    if (backend == "cuda") {
        return AV_HWDEVICE_TYPE_CUDA;
    }
    if (backend == "d3d11va") {
        return AV_HWDEVICE_TYPE_D3D11VA;
    }
    if (backend == "d3d12va") {
        return AV_HWDEVICE_TYPE_D3D12VA;
    }
    return AV_HWDEVICE_TYPE_NONE;
}

static bool findPreferredNvidiaAdapterIndex(
    int& outIndex,
    std::string* outSelectedAdapterDetail = nullptr,
    std::string* outAdapterScanSummary = nullptr)
{
    outIndex = -1;
    if (outSelectedAdapterDetail) {
        outSelectedAdapterDetail->clear();
    }
    if (outAdapterScanSummary) {
        outAdapterScanSummary->clear();
    }

    ComPtr<IDXGIFactory1> factory;
    const HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(hr) || !factory) {
        return false;
    }

    SIZE_T bestDedicatedVideoMemory = 0;
    DXGI_ADAPTER_DESC1 bestDesc{};
    bool hasBestDesc = false;

    for (UINT index = 0;; ++index) {
        ComPtr<IDXGIAdapter1> adapter;
        const HRESULT enumHr = factory->EnumAdapters1(index, &adapter);
        if (enumHr == DXGI_ERROR_NOT_FOUND) {
            break;
        }
        if (FAILED(enumHr) || !adapter) {
            continue;
        }

        DXGI_ADAPTER_DESC1 desc{};
        if (FAILED(adapter->GetDesc1(&desc))) {
            continue;
        }

        if (outAdapterScanSummary) {
            if (!outAdapterScanSummary->empty()) {
                *outAdapterScanSummary += "; ";
            }
            *outAdapterScanSummary += describeDxgiAdapter(index, desc);
        }

        if ((desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) {
            continue;
        }
        if (desc.VendorId != kNvidiaVendorId) {
            continue;
        }

        if (outIndex < 0 || desc.DedicatedVideoMemory >= bestDedicatedVideoMemory) {
            bestDedicatedVideoMemory = desc.DedicatedVideoMemory;
            outIndex = static_cast<int>(index);
            bestDesc = desc;
            hasBestDesc = true;
        }
    }

    if (outIndex >= 0 && outSelectedAdapterDetail && hasBestDesc) {
        *outSelectedAdapterDetail = describeDxgiAdapter(static_cast<UINT>(outIndex), bestDesc);
    }

    return outIndex >= 0;
}

} // namespace

static int64_t now_ns() {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

static std::string avErrorToString(int rc) {
    char err[256];
    av_strerror(rc, err, sizeof(err));
    return std::string(err);
}

void RtspCapture::appendAccelerationDebugTrace_(const std::string& message) {
    if (message.empty()) {
        return;
    }

    constexpr size_t kMaxTraceChars = 8192;
    if (accelerationDebugTrace_.size() >= kMaxTraceChars) {
        return;
    }

    if (!accelerationDebugTrace_.empty()) {
        accelerationDebugTrace_ += " || ";
    }

    size_t remaining = kMaxTraceChars - accelerationDebugTrace_.size();
    if (remaining == 0) {
        return;
    }

    if (message.size() <= remaining) {
        accelerationDebugTrace_ += message;
        return;
    }

    if (remaining <= 3) {
        accelerationDebugTrace_.append(remaining, '.');
        return;
    }

    accelerationDebugTrace_ += message.substr(0, remaining - 3);
    accelerationDebugTrace_ += "...";
}

int RtspCapture::interruptCallback(void* opaque) {
    auto* self = static_cast<RtspCapture*>(opaque);
    const int64_t t = now_ns();
    if ((self->open_deadline_ns_ && t > self->open_deadline_ns_) ||
        (self->read_deadline_ns_ && t > self->read_deadline_ns_)) {
        return 1;
    }
    return 0;
}

RtspCapture::~RtspCapture() { close(); }

void RtspCapture::freeAll() {
    if (pkt_) { av_packet_free(&pkt_); pkt_ = nullptr; }
    if (frame_) { av_frame_free(&frame_); frame_ = nullptr; }
    if (swFrame_) { av_frame_free(&swFrame_); swFrame_ = nullptr; }
    if (dec_) { avcodec_free_context(&dec_); dec_ = nullptr; }
    if (fmt_) { avformat_close_input(&fmt_); fmt_ = nullptr; }
    if (sws_) { sws_freeContext(sws_); sws_ = nullptr; }
    if (hwDeviceCtx_) { av_buffer_unref(&hwDeviceCtx_); }
    vstream_index_ = -1;
    hwPixFmt_ = -1;
    swsSrcPixFmt_ = -1;
    requestedGpuDecode_ = false;
    requireHardwareDecode_ = false;
    activeAccelerationMode_ = "cpu";
    activeAccelerationBackend_.clear();
    accelerationReason_.clear();
    configuredHardwareBackend_.clear();
    bgr_.release();
}

bool RtspCapture::open(const RtspOpenParams& p) {
    params_ = p;
    return openInternal();
}

bool RtspCapture::openDecoderContext(const AVCodecParameters* par, const char* requestedHardwareBackend) {
    lastError_.clear();
    const std::string backendLabel =
        (requestedHardwareBackend && *requestedHardwareBackend)
            ? std::string(requestedHardwareBackend)
            : std::string("cpu");

    if (dec_) {
        avcodec_free_context(&dec_);
        dec_ = nullptr;
    }
    if (hwDeviceCtx_) {
        av_buffer_unref(&hwDeviceCtx_);
    }
    hwPixFmt_ = -1;
    configuredHardwareBackend_.clear();

    dec_ = avcodec_alloc_context3(codec_);
    if (!dec_) {
        lastError_ = "avcodec_alloc_context3 failed";
        appendAccelerationDebugTrace_("backend=" + backendLabel + " result=decoder_context_alloc_failed");
        return false;
    }

    int rc = avcodec_parameters_to_context(dec_, par);
    if (rc < 0) {
        lastError_ = std::string("parameters_to_context: ") + avErrorToString(rc);
        appendAccelerationDebugTrace_(
            "backend=" + backendLabel + " result=decoder_context_init_failed error=" + lastError_);
        avcodec_free_context(&dec_);
        return false;
    }

    dec_->thread_count = 0;
    dec_->opaque = this;

    if (params_.low_cpu_skip_nonref) {
        dec_->flags2 |= AV_CODEC_FLAG2_FAST;
        dec_->skip_frame = AVDISCARD_NONREF;
        dec_->skip_loop_filter = AVDISCARD_NONREF;
    }

    if (requestedHardwareBackend && *requestedHardwareBackend) {
        const bool configured = configureHardwareDecode(requestedHardwareBackend);
        if (!configured && requireHardwareDecode_) {
            if (lastError_.empty()) {
                lastError_ = accelerationReason_.empty()
                    ? "gpu decode unavailable"
                    : accelerationReason_;
            }
            return false;
        }
    }

    return true;
}

bool RtspCapture::configureHardwareDecode(const char* backendName) {
    const std::string backend = backendName ? std::string(backendName) : std::string();
    accelerationReason_ = hardwareBackendReason(backend, "requested");
    selectedHardwareDevice_.clear();
    appendAccelerationDebugTrace_(
        "backend=" + backend +
        " result=configure_requested codec=" +
        (codec_ && codec_->name ? std::string(codec_->name) : std::string("unknown")));

    if (!codec_ || !dec_) {
        accelerationReason_ = "decoder_not_found";
        appendAccelerationDebugTrace_("backend=" + backend + " result=decoder_not_found");
        return false;
    }

    const AVHWDeviceType deviceType = hwDeviceTypeForBackend(backend);
    if (deviceType == AV_HWDEVICE_TYPE_NONE) {
        accelerationReason_ = "gpu_backend_unknown";
        appendAccelerationDebugTrace_("backend=" + backend + " result=gpu_backend_unknown");
        return false;
    }

    const AVCodecHWConfig* hwConfig = nullptr;
    for (int i = 0;; ++i) {
        hwConfig = avcodec_get_hw_config(codec_, i);
        if (!hwConfig) {
            break;
        }

        if (hwConfig->device_type == deviceType &&
            (hwConfig->methods & AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX)) {
            hwPixFmt_ = static_cast<int>(hwConfig->pix_fmt);
            appendAccelerationDebugTrace_(
                "backend=" + backend +
                " result=hw_config_match device=" + describeHwDeviceType(deviceType) +
                " pix_fmt=" + std::to_string(hwPixFmt_));
            break;
        }
    }

    if (hwPixFmt_ < 0) {
        accelerationReason_ = hardwareBackendReason(backend, "backend_not_supported");
        appendAccelerationDebugTrace_(
            "backend=" + backend +
            " result=backend_not_supported available_hw_configs=[" +
            describeCodecHardwareConfigs(codec_) + "]");
        return false;
    }

    int rc = 0;
    if (backend == "cuda") {
        appendAccelerationDebugTrace_("backend=cuda device_request=default");
        rc = av_hwdevice_ctx_create(&hwDeviceCtx_, AV_HWDEVICE_TYPE_CUDA, nullptr, nullptr, 0);
        if (rc < 0) {
            accelerationReason_ = hardwareBackendReason(backend, "backend_init_failed");
            lastError_ = std::string("av_hwdevice_ctx_create(cuda): ") + avErrorToString(rc);
            appendAccelerationDebugTrace_(
                "backend=cuda result=backend_init_failed error=" + lastError_);
            return false;
        }
        selectedHardwareDevice_ = "cuda/default";
        appendAccelerationDebugTrace_("backend=cuda result=backend_init_ok");
    } else {
        int adapterIndex = -1;
        std::string adapterDetail;
        std::string adapterScanSummary;
        if (!findPreferredNvidiaAdapterIndex(adapterIndex, &adapterDetail, &adapterScanSummary)) {
            accelerationReason_ = hardwareBackendReason(backend, "no_nvidia_adapter");
            lastError_ = "no NVIDIA DXGI adapter found";
            appendAccelerationDebugTrace_(
                "backend=" + backend +
                " result=no_nvidia_adapter adapters=[" + adapterScanSummary + "]");
            return false;
        }

        selectedHardwareDevice_ = adapterDetail;
        appendAccelerationDebugTrace_(
            "backend=" + backend +
            " result=adapter_selected adapter={" + selectedHardwareDevice_ +
            "} adapters=[" + adapterScanSummary + "]");

        const std::string deviceName = std::to_string(adapterIndex);
        rc = av_hwdevice_ctx_create(&hwDeviceCtx_, deviceType, deviceName.c_str(), nullptr, 0);
        if (rc < 0) {
            accelerationReason_ = hardwareBackendReason(backend, "backend_init_failed");
            lastError_ =
                std::string("av_hwdevice_ctx_create(") + backend + ":" + deviceName + "): " + avErrorToString(rc);
            appendAccelerationDebugTrace_(
                "backend=" + backend +
                " result=backend_init_failed adapter_index=" + deviceName +
                " error=" + lastError_);
            return false;
        }
        appendAccelerationDebugTrace_(
            "backend=" + backend +
            " result=backend_init_ok adapter_index=" + deviceName);
    }

    dec_->hw_device_ctx = av_buffer_ref(hwDeviceCtx_);
    if (!dec_->hw_device_ctx) {
        accelerationReason_ = hardwareBackendReason(backend, "backend_init_failed");
        lastError_ = "av_buffer_ref(hwDeviceCtx_) failed";
        appendAccelerationDebugTrace_(
            "backend=" + backend +
            " result=backend_ref_failed error=" + lastError_);
        av_buffer_unref(&hwDeviceCtx_);
        return false;
    }

    configuredHardwareBackend_ = backend;
    appendAccelerationDebugTrace_(
        "backend=" + backend +
        " result=backend_configured selected_device={" +
        (selectedHardwareDevice_.empty() ? std::string("none") : selectedHardwareDevice_) + "}");
    dec_->get_format = [](AVCodecContext* ctx, const AVPixelFormat* pixFmts) -> AVPixelFormat {
        auto* self = static_cast<RtspCapture*>(ctx->opaque);
        if (!pixFmts) {
            if (self) {
                self->accelerationReason_ =
                    hardwareBackendReason(self->configuredHardwareBackend_, "decoder_format_unavailable");
                self->appendAccelerationDebugTrace_(
                    "backend=" + self->configuredHardwareBackend_ +
                    " result=decoder_format_unavailable offered_pix_fmts=[null]");
            }
            return AV_PIX_FMT_NONE;
        }

        if (!self) {
            return pixFmts[0];
        }

        for (const AVPixelFormat* pixFmt = pixFmts; *pixFmt != AV_PIX_FMT_NONE; ++pixFmt) {
            if (static_cast<int>(*pixFmt) == self->hwPixFmt_) {
                return *pixFmt;
            }
        }

        self->accelerationReason_ =
            hardwareBackendReason(self->configuredHardwareBackend_, "decoder_format_unavailable");
        self->appendAccelerationDebugTrace_(
            "backend=" + self->configuredHardwareBackend_ +
            " result=decoder_format_unavailable expected_hw_pix_fmt=" +
            std::to_string(self->hwPixFmt_) +
            " offered_pix_fmts=[" + describePixelFormats(pixFmts) + "]");
        return self->requireHardwareDecode_ ? AV_PIX_FMT_NONE : pixFmts[0];
    };

    return true;
}

bool RtspCapture::openInternal() {
    freeAll();
    lastError_.clear();
    selectedHardwareDevice_.clear();
    accelerationDebugTrace_.clear();
    accelerationFrameModeRecorded_ = false;
    requestedGpuDecode_ = params_.prefer_nvidia_decode;
    requireHardwareDecode_ = params_.require_hardware_decode;
    activeAccelerationMode_ = "cpu";
    activeAccelerationBackend_.clear();
    accelerationReason_ = requestedGpuDecode_ ? "gpu_requested" : "cpu_requested";
    if (requestedGpuDecode_) {
        appendAccelerationDebugTrace_("gpu_decode_requested preferred_backends=cuda,d3d11va,d3d12va");
    }

    fmt_ = avformat_alloc_context();
    if (!fmt_) {
        lastError_ = "avformat_alloc_context failed";
        return false;
    }

    fmt_->interrupt_callback.callback = &RtspCapture::interruptCallback;
    fmt_->interrupt_callback.opaque = this;

    AVDictionary* opts = nullptr;
    if (params_.force_tcp) av_dict_set(&opts, "rtsp_transport", "tcp", 0);

    char buf[64];
    snprintf(buf, sizeof(buf), "%d", params_.buffer_size_bytes);
    av_dict_set(&opts, "buffer_size", buf, 0);

    snprintf(buf, sizeof(buf), "%d", params_.max_delay_us);
    av_dict_set(&opts, "max_delay", buf, 0);

    av_dict_set(&opts, "reconnect", params_.enable_reconnect ? "1" : "0", 0);
    av_dict_set(&opts, "reconnect_streamed", "1", 0);
    snprintf(buf, sizeof(buf), "%d", params_.reconnect_max_delay_s);
    av_dict_set(&opts, "reconnect_delay_max", buf, 0);

    open_deadline_ns_ = now_ns() + (int64_t)params_.open_timeout_ms * 1'000'000;
    int rc = avformat_open_input(&fmt_, params_.url.c_str(), nullptr, &opts);
    av_dict_free(&opts);
    open_deadline_ns_ = 0;

    if (rc < 0) {
        lastError_ = std::string("avformat_open_input: ") + avErrorToString(rc);
        freeAll();
        return false;
    }

    rc = avformat_find_stream_info(fmt_, nullptr);
    if (rc < 0) {
        lastError_ = std::string("avformat_find_stream_info: ") + avErrorToString(rc);
        freeAll();
        return false;
    }

    for (unsigned i = 0; i < fmt_->nb_streams; ++i) {
        if (fmt_->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            vstream_index_ = static_cast<int>(i);
            break;
        }
    }
    if (vstream_index_ < 0) {
        lastError_ = "no video stream";
        freeAll();
        return false;
    }

    AVCodecParameters* par = fmt_->streams[vstream_index_]->codecpar;
    codec_ = const_cast<AVCodec*>(avcodec_find_decoder(par->codec_id));
    if (!codec_) {
        lastError_ = "decoder not found";
        freeAll();
        return false;
    }

    bool decoderOpened = false;
    std::string lastHardwareReason;
    std::string lastHardwareError;

    if (requestedGpuDecode_) {
        static constexpr std::array<const char*, 3> kGpuBackends = {
            "cuda",
            "d3d11va",
            "d3d12va",
        };

        for (const char* backend : kGpuBackends) {
            appendAccelerationDebugTrace_("attempt backend=" + std::string(backend));
            if (!openDecoderContext(par, backend)) {
                appendAccelerationDebugTrace_(
                    "attempt backend=" + std::string(backend) +
                    " result=decoder_context_unavailable reason=" +
                    (accelerationReason_.empty() ? std::string("unknown") : accelerationReason_) +
                    (lastError_.empty() ? std::string() : std::string(" error=") + lastError_));
                if (!accelerationReason_.empty()) {
                    lastHardwareReason = accelerationReason_;
                }
                if (!lastError_.empty()) {
                    lastHardwareError = lastError_;
                }
                continue;
            }

            appendAccelerationDebugTrace_(
                "attempt backend=" + std::string(backend) +
                " result=decoder_context_ready configured_backend=" +
                (configuredHardwareBackend_.empty() ? std::string("none") : configuredHardwareBackend_) +
                " selected_device={" +
                (selectedHardwareDevice_.empty() ? std::string("none") : selectedHardwareDevice_) + "}");
            if (configuredHardwareBackend_.empty()) {
                appendAccelerationDebugTrace_(
                    "attempt backend=" + std::string(backend) +
                    " result=decoder_context_without_hw_backend reason=" +
                    (accelerationReason_.empty() ? std::string("gpu_decode_not_activated") : accelerationReason_));
                if (!accelerationReason_.empty()) {
                    lastHardwareReason = accelerationReason_;
                }
                if (!lastError_.empty()) {
                    lastHardwareError = lastError_;
                }
                continue;
            }
            rc = avcodec_open2(dec_, codec_, nullptr);
            if (rc >= 0) {
                appendAccelerationDebugTrace_(
                    "attempt backend=" + std::string(backend) +
                    " result=decoder_open_ok configured_backend=" +
                    (configuredHardwareBackend_.empty() ? std::string("none") : configuredHardwareBackend_));
                decoderOpened = true;
                break;
            }

            accelerationReason_ =
                hardwareBackendReason(configuredHardwareBackend_.empty() ? std::string(backend) : configuredHardwareBackend_,
                                      "decoder_open_failed");
            lastError_ =
                std::string("avcodec_open2(") + backend + "): " + avErrorToString(rc);
            appendAccelerationDebugTrace_(
                "attempt backend=" + std::string(backend) +
                " result=decoder_open_failed error=" + lastError_);
            lastHardwareReason = accelerationReason_;
            lastHardwareError = lastError_;
        }

        if (!decoderOpened && requireHardwareDecode_) {
            if (!lastHardwareError.empty()) {
                lastError_ = lastHardwareError;
            } else if (!lastHardwareReason.empty()) {
                lastError_ = lastHardwareReason;
            } else {
                lastError_ = "gpu decode unavailable";
            }
            appendAccelerationDebugTrace_(
                "gpu_decode_required result=failed reason=" +
                (lastHardwareReason.empty() ? std::string("unknown") : lastHardwareReason) +
                (lastHardwareError.empty() ? std::string() : std::string(" error=") + lastHardwareError));
            freeAll();
            return false;
        }
    }

    if (!decoderOpened) {
        if (!openDecoderContext(par, nullptr)) {
            appendAccelerationDebugTrace_(
                "fallback_to_cpu result=decoder_context_failed error=" + lastError_);
            freeAll();
            return false;
        }

        rc = avcodec_open2(dec_, codec_, nullptr);
        if (rc < 0) {
            lastError_ = std::string("avcodec_open2: ") + avErrorToString(rc);
            appendAccelerationDebugTrace_("fallback_to_cpu result=decoder_open_failed error=" + lastError_);
            freeAll();
            return false;
        }

        if (!requestedGpuDecode_) {
            accelerationReason_ = "cpu_requested";
        } else if (!lastHardwareReason.empty()) {
            accelerationReason_ = lastHardwareReason;
        } else {
            accelerationReason_ = "gpu_decode_not_activated";
        }

        if (requestedGpuDecode_) {
            appendAccelerationDebugTrace_(
                "fallback_to_cpu result=active last_gpu_reason=" +
                (lastHardwareReason.empty() ? std::string("unknown") : lastHardwareReason) +
                (lastHardwareError.empty() ? std::string() : std::string(" last_gpu_error=") + lastHardwareError));
        }
    }

    frame_ = av_frame_alloc();
    swFrame_ = av_frame_alloc();
    pkt_ = av_packet_alloc();
    if (!frame_ || !swFrame_ || !pkt_) {
        lastError_ = "av_frame_alloc/av_packet_alloc failed";
        freeAll();
        return false;
    }

    lastError_.clear();
    return true;
}

bool RtspCapture::ensureSws(int srcW, int srcH, int srcPixFmt) {
    if (sws_ &&
        bgr_.cols == srcW &&
        bgr_.rows == srcH &&
        swsSrcPixFmt_ == srcPixFmt) {
        return true;
    }

    if (sws_) {
        sws_freeContext(sws_);
        sws_ = nullptr;
    }

    bgr_.create(srcH, srcW, CV_8UC3);
    sws_ = sws_getContext(
        srcW,
        srcH,
        static_cast<AVPixelFormat>(srcPixFmt),
        srcW,
        srcH,
        AV_PIX_FMT_BGR24,
        SWS_BILINEAR,
        nullptr,
        nullptr,
        nullptr);
    swsSrcPixFmt_ = srcPixFmt;
    return sws_ != nullptr;
}

void RtspCapture::noteDecodedFrameAcceleration() {
    if (frame_ && hwPixFmt_ >= 0 && frame_->format == hwPixFmt_ && !configuredHardwareBackend_.empty()) {
        activeAccelerationMode_ = "gpu";
        activeAccelerationBackend_ = configuredHardwareBackend_;
        accelerationReason_ = hardwareBackendReason(configuredHardwareBackend_, "active");
        if (!accelerationFrameModeRecorded_) {
            appendAccelerationDebugTrace_(
                "decoded_frame mode=gpu backend=" + configuredHardwareBackend_ +
                " frame_format=" + std::to_string(frame_->format) +
                " hw_pix_fmt=" + std::to_string(hwPixFmt_));
            accelerationFrameModeRecorded_ = true;
        }
        return;
    }

    activeAccelerationMode_ = "cpu";
    activeAccelerationBackend_.clear();
    if (!requestedGpuDecode_) {
        if (accelerationReason_.empty()) {
            accelerationReason_ = "cpu_requested";
        }
        return;
    }

    if (accelerationReason_.empty() ||
        accelerationReason_ == "gpu_requested" ||
        accelerationReason_.ends_with("_requested") ||
        accelerationReason_.ends_with("_active")) {
        accelerationReason_ = "gpu_decode_not_activated";
    }

    if (!accelerationFrameModeRecorded_) {
        appendAccelerationDebugTrace_(
            "decoded_frame mode=cpu reason=" + accelerationReason_ +
            " frame_format=" + (frame_ ? std::to_string(frame_->format) : std::string("none")) +
            " hw_pix_fmt=" + std::to_string(hwPixFmt_));
        accelerationFrameModeRecorded_ = true;
    }
}

AVFrame* RtspCapture::currentFrameForConversion() {
    if (!frame_) {
        lastError_ = "decoded frame unavailable";
        return nullptr;
    }

    if (hwPixFmt_ >= 0 && frame_->format == hwPixFmt_) {
        if (!swFrame_) {
            swFrame_ = av_frame_alloc();
            if (!swFrame_) {
                lastError_ = "av_frame_alloc(swFrame_) failed";
                return nullptr;
            }
        }

        av_frame_unref(swFrame_);
        const int rc = av_hwframe_transfer_data(swFrame_, frame_, 0);
        if (rc < 0) {
            lastError_ = std::string("av_hwframe_transfer_data: ") + avErrorToString(rc);
            appendAccelerationDebugTrace_(
                "frame_transfer result=failed backend=" +
                (configuredHardwareBackend_.empty() ? std::string("none") : configuredHardwareBackend_) +
                " error=" + lastError_);
            return nullptr;
        }

        return swFrame_;
    }

    return frame_;
}

bool RtspCapture::convertCurrentFrameToBgr(cv::Mat& outBgr) {
    AVFrame* srcFrame = currentFrameForConversion();
    if (!srcFrame) {
        return false;
    }

    if (!ensureSws(srcFrame->width, srcFrame->height, srcFrame->format)) {
        lastError_ = "sws_getContext failed";
        return false;
    }

    uint8_t* dstData[4] = { bgr_.data, nullptr, nullptr, nullptr };
    int dstLines[4] = { static_cast<int>(bgr_.step[0]), 0, 0, 0 };
    sws_scale(
        sws_,
        srcFrame->data,
        srcFrame->linesize,
        0,
        srcFrame->height,
        dstData,
        dstLines);

    outBgr = bgr_;
    return true;
}

bool RtspCapture::read(cv::Mat& outBgr) {
    if (!fmt_ || !dec_) {
        lastError_ = "not opened";
        return false;
    }

    read_deadline_ns_ = now_ns() + (int64_t)params_.read_timeout_ms * 1'000'000;

    for (;;) {
        int rc = av_read_frame(fmt_, pkt_);
        if (rc < 0) {
            read_deadline_ns_ = 0;
            if (rc == AVERROR_EOF) {
                lastError_ = "EOF";
                return false;
            }
            lastError_ = std::string("av_read_frame: ") + avErrorToString(rc);
            return false;
        }

        if (pkt_->stream_index == vstream_index_) {
            rc = avcodec_send_packet(dec_, pkt_);
            av_packet_unref(pkt_);
            if (rc < 0) {
                lastError_ = std::string("send_packet: ") + avErrorToString(rc);
                continue;
            }

            for (;;) {
                rc = avcodec_receive_frame(dec_, frame_);
                if (rc == AVERROR(EAGAIN)) {
                    break;
                }
                if (rc < 0) {
                    lastError_ = std::string("receive_frame: ") + avErrorToString(rc);
                    break;
                }

                noteDecodedFrameAcceleration();
                const bool converted = convertCurrentFrameToBgr(outBgr);
                av_frame_unref(frame_);
                read_deadline_ns_ = 0;
                return converted;
            }
        } else {
            av_packet_unref(pkt_);
        }

        if (now_ns() > read_deadline_ns_) {
            read_deadline_ns_ = 0;
            lastError_ = "read timeout";
            return false;
        }
    }
}

bool RtspCapture::pump(bool wantBgr, cv::Mat* outBgr) {
    if (!fmt_ || !dec_) {
        lastError_ = "not opened";
        return false;
    }

    read_deadline_ns_ = now_ns() + (int64_t)params_.read_timeout_ms * 1'000'000;

    int rc = av_read_frame(fmt_, pkt_);
    if (rc < 0) {
        read_deadline_ns_ = 0;
        if (rc == AVERROR_EOF) {
            lastError_ = "EOF";
            return false;
        }
        lastError_ = std::string("av_read_frame: ") + avErrorToString(rc);
        return false;
    }

    if (pkt_->stream_index != vstream_index_) {
        av_packet_unref(pkt_);
        read_deadline_ns_ = 0;
        return true;
    }

    rc = avcodec_send_packet(dec_, pkt_);
    av_packet_unref(pkt_);
    if (rc < 0) {
        lastError_ = std::string("send_packet: ") + avErrorToString(rc);
        read_deadline_ns_ = 0;
        return true;
    }

    if (!wantBgr) {
        for (;;) {
            rc = avcodec_receive_frame(dec_, frame_);
            if (rc == AVERROR(EAGAIN) || rc == AVERROR_EOF) {
                read_deadline_ns_ = 0;
                return true;
            }
            if (rc < 0) {
                lastError_ = std::string("receive_frame: ") + avErrorToString(rc);
                read_deadline_ns_ = 0;
                return true;
            }

            noteDecodedFrameAcceleration();
            av_frame_unref(frame_);
        }
    }

    for (;;) {
        rc = avcodec_receive_frame(dec_, frame_);
        if (rc == AVERROR(EAGAIN) || rc == AVERROR_EOF) {
            read_deadline_ns_ = 0;
            return true;
        }
        if (rc < 0) {
            lastError_ = std::string("receive_frame: ") + avErrorToString(rc);
            read_deadline_ns_ = 0;
            return true;
        }

        noteDecodedFrameAcceleration();
        const bool converted = convertCurrentFrameToBgr(outBgr ? *outBgr : bgr_);
        av_frame_unref(frame_);
        read_deadline_ns_ = 0;
        return converted;
    }
}

bool RtspCapture::reopen() {
    close();
    const int attempts = 5;
    for (int i = 1; i <= attempts; ++i) {
        if (openInternal()) return true;
        std::this_thread::sleep_for(
            std::chrono::seconds((std::min)(5 * i, params_.reconnect_max_delay_s)));
    }
    return false;
}

void RtspCapture::close() { freeAll(); }
