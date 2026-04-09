import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CAMERA_DIRECTORY_INDEX_KEYS,
  type CameraDirectoryIndexKey,
  type CameraDirectoryTab,
} from "@/react-app/hooks/useCameraDirectory";

type CameraDirectoryControlsProps = {
  activeTab: CameraDirectoryTab;
  activeSearchTerm: string;
  activeIndexKey: CameraDirectoryIndexKey;
  activeIndexCounts: Record<CameraDirectoryIndexKey, number>;
  tabCounts: Record<CameraDirectoryTab, number>;
  searchInputId: string;
  onTabChange: (tab: CameraDirectoryTab) => void;
  onSearchChange: (value: string) => void;
  onIndexChange: (key: CameraDirectoryIndexKey) => void;
  actions?: ReactNode;
};

export default function CameraDirectoryControls({
  activeTab,
  activeSearchTerm,
  activeIndexKey,
  activeIndexCounts,
  tabCounts,
  searchInputId,
  onTabChange,
  onSearchChange,
  onIndexChange,
  actions,
}: CameraDirectoryControlsProps) {
  const { t } = useTranslation();

  const onlineLabel = t("dashboard.online");
  const offlineLabel = t("dashboard.offline");
  const activeTabLabel = activeTab === "online" ? onlineLabel : offlineLabel;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr),auto] xl:items-center">
        <div className="min-w-0">
          <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[0_20px_60px_-52px_rgba(0,0,0,0.95)] backdrop-blur-sm">
            {(
              [
                ["online", onlineLabel],
                ["offline", offlineLabel],
              ] as Array<[CameraDirectoryTab, string]>
            ).map(([tabId, label]) => {
              const isActive = tabId === activeTab;

              return (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => onTabChange(tabId)}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-[0_16px_40px_-20px_rgba(37,99,235,0.95)]"
                      : "text-gray-300 hover:bg-white/5 hover:text-white"
                  }`}
                  aria-pressed={isActive}
                >
                  <span>{label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isActive ? "bg-white/15 text-white" : "bg-white/8 text-gray-400"
                    }`}
                  >
                    {tabCounts[tabId]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {actions ? (
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center xl:justify-self-end">
            {actions}
          </div>
        ) : null}
      </div>

      <div className="w-full max-w-md">
        <label className="sr-only" htmlFor={searchInputId}>
          {t("cameraDirectory.searchLabel", {
            defaultValue: "Search cameras",
          })}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            id={searchInputId}
            type="text"
            value={activeSearchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("cameraDirectory.searchPlaceholder", {
              status: activeTabLabel.toLowerCase(),
              defaultValue: `Search ${activeTabLabel.toLowerCase()} cameras...`,
            })}
            className="w-full rounded-lg border border-gray-700 bg-gray-900/60 py-2 pl-9 pr-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
          {t("cameraDirectory.filterByInitial", {
            defaultValue: "Filter by initial",
          })}
        </div>

        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 pr-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CAMERA_DIRECTORY_INDEX_KEYS.map((indexKey) => {
            const isActive = activeIndexKey === indexKey;
            const isDisabled = indexKey !== "all" && activeIndexCounts[indexKey] === 0;

            return (
              <button
                key={indexKey}
                type="button"
                onClick={() => onIndexChange(indexKey)}
                disabled={isDisabled}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "border-blue-500/60 bg-blue-500/15 text-blue-200"
                    : isDisabled
                    ? "cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600"
                    : "border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-500 hover:text-white"
                }`}
                aria-pressed={isActive}
              >
                {indexKey === "all"
                  ? t("dashboard.alertFilters.all", {
                      defaultValue: "All",
                    })
                  : indexKey}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
