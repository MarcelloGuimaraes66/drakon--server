import { useTranslation } from "react-i18next";

type JobsTabView = "list" | "create" | "steps";

interface JobsTabsProps {
  activeView: JobsTabView;
  stepsEnabled: boolean;
  onSelectList: () => void;
  onSelectCreate: () => void;
  onSelectSteps: () => void;
}

export default function JobsTabs({
  activeView,
  stepsEnabled,
  onSelectList,
  onSelectCreate,
  onSelectSteps,
}: JobsTabsProps) {
  const { t } = useTranslation();

  const tabs: Array<{
    id: JobsTabView;
    index: number;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    {
      id: "list",
      index: 1,
      label: t("jobs.jobsList", { defaultValue: "Jobs List" }),
      onClick: onSelectList,
    },
    {
      id: "create",
      index: 2,
      label: t("jobs.createJob", { defaultValue: "Create Job" }),
      onClick: onSelectCreate,
    },
    {
      id: "steps",
      index: 3,
      label: t("jobs.jobDetails", { defaultValue: "Job Details" }),
      onClick: onSelectSteps,
      disabled: !stepsEnabled,
    },
  ];

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[0_20px_60px_-52px_rgba(0,0,0,0.95)] backdrop-blur-sm">
      {tabs.map((tab) => {
        const isActive = activeView === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={tab.onClick}
            disabled={tab.disabled}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 ${
              isActive
                ? "bg-blue-600 text-white shadow-[0_16px_40px_-20px_rgba(37,99,235,0.95)]"
                : tab.disabled
                ? "cursor-not-allowed text-gray-600"
                : "text-gray-300 hover:bg-white/5 hover:text-white"
            }`}
            aria-pressed={isActive}
          >
            {tab.index}. {tab.label}
          </button>
        );
      })}
    </div>
  );
}
