#pragma once

#include <algorithm>
#include <chrono>
#include <optional>
#include <vector>

namespace contentcoverage {

struct CoverageSnapshot {
    bool hasCoveredUntil = false;
    std::chrono::system_clock::time_point coveredUntil{};

    bool hasLatestCaptured = false;
    std::chrono::system_clock::time_point latestCaptured{};

    bool hasFirstGapStart = false;
    std::chrono::system_clock::time_point firstGapStart{};
};

class Tracker {
public:
    using time_point = std::chrono::system_clock::time_point;

    void clear() {
        ranges_.clear();
        latestCaptured_.reset();
        cutoff_.reset();
    }

    void setCutoff(const std::optional<time_point>& cutoff) {
        cutoff_ = cutoff;
        if (!cutoff_.has_value()) {
            return;
        }

        std::vector<Range> trimmed;
        trimmed.reserve(ranges_.size());
        for (const auto& range : ranges_) {
            if (range.start >= *cutoff_) {
                continue;
            }
            Range clamped = range;
            if (clamped.end > *cutoff_) {
                clamped.end = *cutoff_;
            }
            if (clamped.end > clamped.start) {
                trimmed.push_back(clamped);
            }
        }
        ranges_ = std::move(trimmed);
        mergeRanges_();
    }

    void observeCapturedEnd(const time_point& endUtc) {
        if (!latestCaptured_.has_value() || endUtc > *latestCaptured_) {
            latestCaptured_ = endUtc;
        }
    }

    bool addSuccessfulSpan(time_point startUtc, time_point endUtc) {
        if (endUtc <= startUtc) {
            return false;
        }

        if (cutoff_.has_value()) {
            if (startUtc >= *cutoff_) {
                return false;
            }
            if (endUtc > *cutoff_) {
                endUtc = *cutoff_;
            }
            if (endUtc <= startUtc) {
                return false;
            }
        }

        ranges_.push_back(Range{ startUtc, endUtc });
        mergeRanges_();
        return true;
    }

    CoverageSnapshot snapshotFromAnchor(
        const time_point& anchorUtc,
        std::chrono::seconds adjacencyTolerance = std::chrono::seconds(1)) const
    {
        CoverageSnapshot snapshot;
        if (latestCaptured_.has_value()) {
            snapshot.hasLatestCaptured = true;
            snapshot.latestCaptured = *latestCaptured_;
        }

        time_point frontier = anchorUtc;
        bool advanced = false;
        for (const auto& range : ranges_) {
            if (range.end <= frontier) {
                continue;
            }
            if (range.start > frontier + adjacencyTolerance) {
                snapshot.hasFirstGapStart = true;
                snapshot.firstGapStart = frontier;
                break;
            }
            if (range.end > frontier) {
                frontier = range.end;
                advanced = true;
            }
        }

        snapshot.hasCoveredUntil = true;
        snapshot.coveredUntil = advanced ? frontier : anchorUtc;

        if (!snapshot.hasFirstGapStart &&
            cutoff_.has_value() &&
            snapshot.coveredUntil < *cutoff_)
        {
            snapshot.hasFirstGapStart = true;
            snapshot.firstGapStart = snapshot.coveredUntil;
        }

        return snapshot;
    }

private:
    struct Range {
        time_point start{};
        time_point end{};
    };

    void mergeRanges_() {
        if (ranges_.empty()) {
            return;
        }

        std::sort(ranges_.begin(), ranges_.end(), [](const Range& a, const Range& b) {
            if (a.start != b.start) {
                return a.start < b.start;
            }
            return a.end < b.end;
        });

        std::vector<Range> merged;
        merged.reserve(ranges_.size());
        merged.push_back(ranges_.front());

        for (std::size_t i = 1; i < ranges_.size(); ++i) {
            Range& tail = merged.back();
            const Range& next = ranges_[i];
            if (next.start <= tail.end + std::chrono::seconds(1)) {
                if (next.end > tail.end) {
                    tail.end = next.end;
                }
                continue;
            }
            merged.push_back(next);
        }

        ranges_ = std::move(merged);
    }

    std::vector<Range> ranges_;
    std::optional<time_point> latestCaptured_;
    std::optional<time_point> cutoff_;
};

} // namespace contentcoverage
