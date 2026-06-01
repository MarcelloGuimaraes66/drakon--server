import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface HitImage {
  time_in_video?: string;
  url?: string;
  key?: string;
}

interface HitImagesAlbumProps {
  images: HitImage[];
}

export default function HitImagesAlbum({ images }: HitImagesAlbumProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (!images || images.length === 0) {
    return null;
  }

  const handlePrevious = () => {
    if (selectedIndex === null) return;
    setSelectedIndex(selectedIndex === 0 ? images.length - 1 : selectedIndex - 1);
  };

  const handleNext = () => {
    if (selectedIndex === null) return;
    setSelectedIndex((selectedIndex + 1) % images.length);
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
          Total Relevant Detections: {images.length}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              className="relative flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-gray-600 hover:border-blue-500 transition-all"
            >
              {img.url ? (
                <img
                  src={img.url}
                  alt={`Hit ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                  No preview
                </div>
              )}
              {img.time_in_video && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-1 py-0.5 text-center">
                  {img.time_in_video}
                </div>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {images.length} frame{images.length !== 1 ? "s" : ""} found
        </p>
      </div>

      {/* Lightbox Modal */}
      {selectedIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedIndex(null)}
          onKeyDown={handleKeyDown as any}
          tabIndex={0}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex(null);
            }}
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrevious();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div
            className="max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {images[selectedIndex].url ? (
              <img
                src={images[selectedIndex].url}
                alt={`Frame ${selectedIndex + 1}`}
                className="max-w-full max-h-[80vh] rounded-lg shadow-2xl"
              />
            ) : (
              <div className="w-96 h-96 bg-gray-800 rounded-lg flex items-center justify-center text-gray-400">
                Image not available
              </div>
            )}
            <div className="mt-4 text-white text-center">
              <p className="text-sm font-medium">
                Frame {selectedIndex + 1} of {images.length}
              </p>
              {images[selectedIndex].time_in_video && (
                <p className="text-xs text-gray-400 mt-1">
                  {images[selectedIndex].time_in_video}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
