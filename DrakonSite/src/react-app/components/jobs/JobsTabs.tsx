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
    <div className="fluent-tablist inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border p-1">
      {tabs.map((tab) => {
        const isActive = activeView === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={tab.onClick}
            disabled={tab.disabled}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              isActive
                ? "fluent-tab-active"
                : tab.disabled
                ? "cursor-not-allowed text-gray-600"
                : "fluent-tab-idle"
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
