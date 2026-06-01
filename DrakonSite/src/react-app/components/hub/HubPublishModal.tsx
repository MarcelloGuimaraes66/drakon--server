import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface HubPublishModalProps {
  isOpen: boolean;
  title: string;
  defaultTitle: string;
  defaultSummary: string;
  defaultDescription?: string | null;
  itemLabel: string;
  submitting?: boolean;
  submissionError?: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    summary: string;
    description: string;
    tags: string[];
  }) => Promise<void> | void;
}

export default function HubPublishModal({
  isOpen,
  title,
  defaultTitle,
  defaultSummary,
  defaultDescription,
  itemLabel,
  submitting = false,
  submissionError = null,
  onClose,
  onSubmit,
}: HubPublishModalProps) {
  const [formTitle, setFormTitle] = useState(defaultTitle);
  const [formSummary, setFormSummary] = useState(defaultSummary);
  const [formDescription, setFormDescription] = useState(defaultDescription || "");
  const [formTags, setFormTags] = useState("");
  const [localError, setLocalError] = useState<string | null>(submissionError);

  useEffect(() => {
    if (!isOpen) return;
    setFormTitle(defaultTitle);
    setFormSummary(defaultSummary);
    setFormDescription(defaultDescription || "");
    setFormTags("");
    setLocalError(null);
  }, [defaultDescription, defaultSummary, defaultTitle, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setLocalError(null);
      return;
    }
    setLocalError(submissionError || null);
  }, [isOpen, submissionError]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-gray-100">{title}</h2>
            <p className="mt-1 text-sm text-gray-400">
              Publique este {itemLabel} no Hub e torne-o publico imediatamente, sem alterar o runtime atual.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-800 bg-gray-900/80 p-2 text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-6">
          {localError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {localError}
            </div>
          ) : null}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Title</label>
            <input
              type="text"
              value={formTitle}
              onChange={(event) => {
                setFormTitle(event.target.value);
                if (localError) setLocalError(null);
              }}
              className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="Enter a title"
            />
            <p className="mt-2 text-xs text-gray-500">
              Use a unique title. If another {itemLabel} already has the same name in the Hub, change
              it before publishing.
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Summary</label>
            <textarea
              value={formSummary}
              onChange={(event) => {
                setFormSummary(event.target.value);
                if (localError) setLocalError(null);
              }}
              rows={3}
              className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="Short summary for the Hub card"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Description</label>
            <textarea
              value={formDescription}
              onChange={(event) => {
                setFormDescription(event.target.value);
                if (localError) setLocalError(null);
              }}
              rows={5}
              className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="Explain how this item should be used"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Tags</label>
            <input
              type="text"
              value={formTags}
              onChange={(event) => {
                setFormTags(event.target.value);
                if (localError) setLocalError(null);
              }}
              className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="security, warehouse, xray"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-800 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:border-gray-700 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !formTitle.trim() || !formSummary.trim()}
            onClick={() =>
              void onSubmit({
                title: formTitle.trim(),
                summary: formSummary.trim(),
                description: formDescription.trim(),
                tags: formTags
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              submitting || !formTitle.trim() || !formSummary.trim()
                ? "cursor-not-allowed bg-gray-800 text-gray-500"
                : "bg-blue-600 text-white hover:bg-blue-500"
            }`}
          >
            {submitting ? "Publishing..." : "Publish to Hub"}
          </button>
        </div>
      </div>
    </div>
  );
}
