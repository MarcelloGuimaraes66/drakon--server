extern "C" {
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
#include <libavcodec/avcodec.h>
}
#include "RtspCapture.h"
#include <thread>
#include <iostream>

static int64_t now_ns() {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

int RtspCapture::interruptCallback(void* opaque) {
    auto* self = static_cast<RtspCapture*>(opaque);
    const int64_t t = now_ns();
    // Abort blocking I/O if deadline passed
    if ((self->open_deadline_ns_ && t > self->open_deadline_ns_) ||
        (self->read_deadline_ns_ && t > self->read_deadline_ns_)) {
        return 1; // tell FFmpeg to interrupt
    }
    return 0;
}

RtspCapture::~RtspCapture() { close(); }

void RtspCapture::freeAll() {
    if (pkt_) { av_packet_free(&pkt_);  pkt_ = nullptr; }
    if (frame_) { av_frame_free(&frame_); frame_ = nullptr; }
    if (dec_) { avcodec_free_context(&dec_); dec_ = nullptr; }
    if (fmt_) { avformat_close_input(&fmt_); fmt_ = nullptr; }
    if (sws_) { sws_freeContext(sws_); sws_ = nullptr; }
    vstream_index_ = -1;
    bgr_.release();
}

bool RtspCapture::open(const RtspOpenParams& p) {
    params_ = p;
    return openInternal();
}

bool RtspCapture::openInternal() {
    freeAll();
    lastError_.clear();

    fmt_ = avformat_alloc_context();
    if (!fmt_) { lastError_ = "avformat_alloc_context failed"; return false; }

    // Interrupt callback & timeouts
    fmt_->interrupt_callback.callback = &RtspCapture::interruptCallback;
    fmt_->interrupt_callback.opaque = this;

    // Input options
    AVDictionary* opts = nullptr;
    if (params_.force_tcp) av_dict_set(&opts, "rtsp_transport", "tcp", 0);
    // FFmpeg expects microseconds for timeouts via AVFormat
    // We'll enforce deadlines via interrupt_cb as well.
    // stimeout: max time to wait for the first response
    char buf[64];
    snprintf(buf, sizeof(buf), "%d", params_.buffer_size_bytes);
    av_dict_set(&opts, "buffer_size", buf, 0);

    snprintf(buf, sizeof(buf), "%d", params_.max_delay_us);
    av_dict_set(&opts, "max_delay", buf, 0);

    // Some servers honor these:
    av_dict_set(&opts, "reconnect", params_.enable_reconnect ? "1" : "0", 0);
    av_dict_set(&opts, "reconnect_streamed", "1", 0);
    snprintf(buf, sizeof(buf), "%d", params_.reconnect_max_delay_s);
    av_dict_set(&opts, "reconnect_delay_max", buf, 0);

    // OPEN with deadline
    open_deadline_ns_ = now_ns() + (int64_t)params_.open_timeout_ms * 1'000'000;
    int rc = avformat_open_input(&fmt_, params_.url.c_str(), nullptr, &opts);
    av_dict_free(&opts);
    open_deadline_ns_ = 0;

    if (rc < 0) {
        char err[256]; av_strerror(rc, err, sizeof(err));
        lastError_ = std::string("avformat_open_input: ") + err;
        freeAll();
        return false;
    }

    rc = avformat_find_stream_info(fmt_, nullptr);
    if (rc < 0) {
        char err[256]; av_strerror(rc, err, sizeof(err));
        lastError_ = std::string("avformat_find_stream_info: ") + err;
        freeAll();
        return false;
    }

    // Find video stream
    for (unsigned i = 0; i < fmt_->nb_streams; ++i) {
        if (fmt_->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            vstream_index_ = (int)i;
            break;
        }
    }
    if (vstream_index_ < 0) { lastError_ = "no video stream"; freeAll(); return false; }

    // Open decoder
    AVCodecParameters* par = fmt_->streams[vstream_index_]->codecpar;
    codec_ = const_cast<AVCodec*>(avcodec_find_decoder(par->codec_id));
    if (!codec_) { lastError_ = "decoder not found"; freeAll(); return false; }

    dec_ = avcodec_alloc_context3(codec_);
    if (!dec_) { lastError_ = "avcodec_alloc_context3 failed"; freeAll(); return false; }
    if ((rc = avcodec_parameters_to_context(dec_, par)) < 0) {
        char err[256]; av_strerror(rc, err, sizeof(err));
        lastError_ = std::string("parameters_to_context: ") + err;
        freeAll(); return false;
    }
    dec_->thread_count = 0; // let FFmpeg decide

    if ((rc = avcodec_open2(dec_, codec_, nullptr)) < 0) {
        char err[256]; av_strerror(rc, err, sizeof(err));
        lastError_ = std::string("avcodec_open2: ") + err;
        freeAll(); return false;
    }

    // Low-CPU decode settings (opcional)
    if (params_.low_cpu_skip_nonref) {
        dec_->flags2 |= AV_CODEC_FLAG2_FAST;
        dec_->skip_frame = AVDISCARD_NONREF;
        dec_->skip_loop_filter = AVDISCARD_NONREF;
    }


    frame_ = av_frame_alloc();
    pkt_ = av_packet_alloc();
    return true;
}

bool RtspCapture::ensureSws(int srcW, int srcH, int srcPixFmt) {
    if (sws_ &&
        bgr_.cols == srcW && bgr_.rows == srcH) return true;
    if (sws_) { sws_freeContext(sws_); sws_ = nullptr; }
    bgr_.create(srcH, srcW, CV_8UC3);
    sws_ = sws_getContext(srcW, srcH, (AVPixelFormat)srcPixFmt,
        srcW, srcH, AV_PIX_FMT_BGR24,
        SWS_BILINEAR, nullptr, nullptr, nullptr);
    return sws_ != nullptr;
}

bool RtspCapture::read(cv::Mat& outBgr) {
    if (!fmt_ || !dec_) { lastError_ = "not opened"; return false; }

    // Set READ deadline (interrupt blocking I/O)
    read_deadline_ns_ = now_ns() + (int64_t)params_.read_timeout_ms * 1'000'000;

    // Demux packets until we decode one frame
    for (;;) {
        int rc = av_read_frame(fmt_, pkt_);
        if (rc < 0) {
            read_deadline_ns_ = 0;
            if (rc == AVERROR_EOF) { lastError_ = "EOF"; return false; }
            char err[256]; av_strerror(rc, err, sizeof(err));
            lastError_ = std::string("av_read_frame: ") + err;
            return false; // let caller decide to reopen with backoff
        }

        if (pkt_->stream_index == vstream_index_) {
            // Send packet to decoder
            rc = avcodec_send_packet(dec_, pkt_);
            av_packet_unref(pkt_);
            if (rc < 0) {
                char err[256]; av_strerror(rc, err, sizeof(err));
                lastError_ = std::string("send_packet: ") + err;
                continue; // skip this packet
            }

            for (;;) {
                rc = avcodec_receive_frame(dec_, frame_);
                if (rc == AVERROR(EAGAIN)) break;   // need more packets
                if (rc < 0) {
                    char err[256]; av_strerror(rc, err, sizeof(err));
                    lastError_ = std::string("receive_frame: ") + err;
                    break;
                }

                // Got a frame → convert to BGR
                if (!ensureSws(frame_->width, frame_->height, frame_->format)) {
                    lastError_ = "sws_getContext failed"; return false;
                }
                uint8_t* dstData[4] = { bgr_.data, nullptr, nullptr, nullptr };
                int dstLines[4] = { (int)bgr_.step[0], 0, 0, 0 };
                sws_scale(sws_, frame_->data, frame_->linesize,
                    0, frame_->height, dstData, dstLines);

                outBgr = bgr_; // shallow copy → fast
                read_deadline_ns_ = 0;
                return true;
            }
        }
        else {
            av_packet_unref(pkt_);
        }
        // Loop until a frame is decoded or read times out (interrupt callback will abort read)
        if (now_ns() > read_deadline_ns_) {
            read_deadline_ns_ = 0;
            lastError_ = "read timeout";
            return false;
        }
    }
}



bool RtspCapture::pump(bool wantBgr, cv::Mat* outBgr)
{
    if (!fmt_ || !dec_) { lastError_ = "not opened"; return false; }

    read_deadline_ns_ = now_ns() + (int64_t)params_.read_timeout_ms * 1'000'000;

    int rc = av_read_frame(fmt_, pkt_);
    if (rc < 0) {
        read_deadline_ns_ = 0;
        if (rc == AVERROR_EOF) { lastError_ = "EOF"; return false; }
        char err[256]; av_strerror(rc, err, sizeof(err));
        lastError_ = std::string("av_read_frame: ") + err;
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
        char err[256]; av_strerror(rc, err, sizeof(err));
        lastError_ = std::string("send_packet: ") + err;
        read_deadline_ns_ = 0;
        return true; // não fatal
    }

    // Keep decoder state in sync even when caller doesn't need BGR output.
    // This avoids starving inter-frame codec references by dropping compressed packets.
    if (!wantBgr) {
        for (;;) {
            rc = avcodec_receive_frame(dec_, frame_);
            if (rc == AVERROR(EAGAIN) || rc == AVERROR_EOF) {
                read_deadline_ns_ = 0;
                return true;
            }
            if (rc < 0) {
                char err[256]; av_strerror(rc, err, sizeof(err));
                lastError_ = std::string("receive_frame: ") + err;
                read_deadline_ns_ = 0;
                return true; // não fatal
            }
            av_frame_unref(frame_); // decode only; no sws_scale/BGR conversion here
        }
    }

    for (;;) {
        rc = avcodec_receive_frame(dec_, frame_);
        if (rc == AVERROR(EAGAIN) || rc == AVERROR_EOF) {
            read_deadline_ns_ = 0;
            return true;
        }
        if (rc < 0) {
            char err[256]; av_strerror(rc, err, sizeof(err));
            lastError_ = std::string("receive_frame: ") + err;
            read_deadline_ns_ = 0;
            return true; // não fatal
        }

        if (!ensureSws(frame_->width, frame_->height, frame_->format)) {
            lastError_ = "sws_getContext failed";
            read_deadline_ns_ = 0;
            return false;
        }

        uint8_t* dstData[4] = { bgr_.data, nullptr, nullptr, nullptr };
        int dstLines[4] = { (int)bgr_.step[0], 0, 0, 0 };
        sws_scale(sws_, frame_->data, frame_->linesize, 0, frame_->height, dstData, dstLines);

        av_frame_unref(frame_);

        if (outBgr) *outBgr = bgr_;
        read_deadline_ns_ = 0;
        return true;
    }
}




bool RtspCapture::reopen() {
    close();
    // backoff loop similar to your PyAV
    const int attempts = 5;
    for (int i = 1; i <= attempts; ++i) {
        if (openInternal()) return true;
        std::this_thread::sleep_for(std::chrono::seconds(std::min(5 * i, params_.reconnect_max_delay_s)));
    }
    return false;
}

void RtspCapture::close() { freeAll(); }
