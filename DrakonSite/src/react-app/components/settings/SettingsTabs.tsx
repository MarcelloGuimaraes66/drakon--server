export type SettingsTabView = "user" | "api-keys" | "alerts" | "connectivity";

interface SettingsTabsProps {
  activeView: SettingsTabView;
  onSelectUser: () => void;
  onSelectApiKeys: () => void;
  onSelectAlerts: () => void;
  onSelectConnectivity: () => void;
}

export default function SettingsTabs({
  activeView,
  onSelectUser,
  onSelectApiKeys,
  onSelectAlerts,
  onSelectConnectivity,
}: SettingsTabsProps) {
  const tabs: Array<{
    id: SettingsTabView;
    label: string;
    onClick: () => void;
  }> = [
    {
      id: "user",
      label: "User",
      onClick: onSelectUser,
    },
    {
      id: "api-keys",
      label: "API Keys",
      onClick: onSelectApiKeys,
    },
    {
      id: "alerts",
      label: "Alerts",
      onClick: onSelectAlerts,
    },
    {
      id: "connectivity",
      label: "EXE Connectivity",
      onClick: onSelectConnectivity,
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
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              isActive ? "fluent-tab-active" : "fluent-tab-idle"
            }`}
            aria-pressed={isActive}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
