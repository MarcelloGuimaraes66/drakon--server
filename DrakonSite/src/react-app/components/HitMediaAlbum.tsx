import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface HitMediaItem {
  media_type: "image" | "video";
  time_in_video?: string;
  url?: string;
  key?: string;
  camera_id?: number;
  mime_type?: string;
}

interface HitMediaAlbumProps {
  items: HitMediaItem[];
}

export default function HitMediaAlbum({ items }: HitMediaAlbumProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (!items || items.length === 0) {
    return null;
  }

  const imageCount = items.filter((item) => item.media_type === "image").length;
  const videoCount = items.filter((item) => item.media_type === "video").length;

  const handlePrevious = () => {
    if (selectedIndex === null) return;
    setSelectedIndex(selectedIndex === 0 ? items.length - 1 : selectedIndex - 1);
  };

  const handleNext = () => {
    if (selectedIndex === null) return;
    setSelectedIndex((selectedIndex + 1) % items.length);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (selectedIndex === null) return;
    if (e.key === "ArrowLeft") handlePrevious();
    if (e.key === "ArrowRight") handleNext();
    if (e.key === "Escape") setSelectedIndex(null);
  };

  return (
    <>
      <div className="mt-4 pt-4 border-t border-gray-700/50">
        <p className="text-xs text-gray-400 mb-2">
          Relevant Media: {items.length} ({imageCount} image{imageCount !== 1 ? "s" : ""}, {videoCount} video{videoCount !== 1 ? "s" : ""})
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {items.map((item, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              className="relative flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-gray-600 hover:border-blue-500 transition-all"
            >
              {item.url ? (
                item.media_type === "video" ? (
                  <video
                    src={item.url}
                    className="w-full h-full object-cover"
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={item.url}
                    alt={`Hit ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                )
              ) : (
                <div className="w-full h-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                  No preview
                </div>
              )}
              {item.time_in_video && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-1 py-0.5 text-center">
                  {item.time_in_video}
                </div>
              )}
              {item.media_type === "video" && (
                <div className="absolute top-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                  VIDEO
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox Modal */}
      {selectedIndex !== null && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedIndex(null)}
          onKeyDown={handleKeyDown as any}
          tabIndex={0}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex(null);
            }}
            aria-label="Close media viewer"
            className="absolute top-4 right-4 z-30 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrevious();
            }}
            aria-label="Previous media"
            className="absolute left-4 top-1/2 z-30 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            aria-label="Next media"
            className="absolute right-4 top-1/2 z-30 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div
            className="relative z-10 max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {items[selectedIndex].url ? (
              items[selectedIndex].media_type === "video" ? (
                <video
                  src={items[selectedIndex].url}
                  controls
                  autoPlay
                  className="max-w-full max-h-[80vh] rounded-lg shadow-2xl"
                  style={{ maxHeight: "80vh" }}
                />
              ) : (
                <img
                  src={items[selectedIndex].url}
                  alt={`Frame ${selectedIndex + 1}`}
                  className="max-w-full max-h-[80vh] rounded-lg shadow-2xl"
                />
              )
            ) : (
              <div className="w-96 h-96 bg-gray-800 rounded-lg flex items-center justify-center text-gray-400">
                Media not available
              </div>
            )}
            <div className="mt-4 text-white text-center">
              <p className="text-sm font-medium">
                {items[selectedIndex].media_type === "video" ? "Video" : "Image"} {selectedIndex + 1} of {items.length}
              </p>
              {items[selectedIndex].time_in_video && (
                <p className="text-xs text-gray-400 mt-1">
                  {items[selectedIndex].time_in_video}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
