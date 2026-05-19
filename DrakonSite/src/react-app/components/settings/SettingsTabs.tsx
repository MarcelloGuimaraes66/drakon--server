import { useTranslation } from "react-i18next";

export type SettingsTabView =
  | "user"
  | "users"
  | "api-keys"
  | "alerts"
  | "connectivity"
  | "workspace-access";

interface SettingsTabsProps {
  activeView: SettingsTabView;
  onSelectUser: () => void;
  onSelectUsers: () => void;
  onSelectApiKeys: () => void;
  onSelectAlerts: () => void;
  onSelectConnectivity: () => void;
  onSelectWorkspaceAccess: () => void;
  showAccountUsers?: boolean;
  showWorkspaceAccess?: boolean;
}

export default function SettingsTabs({
  activeView,
  onSelectUser,
  onSelectUsers,
  onSelectApiKeys,
  onSelectAlerts,
  onSelectConnectivity,
  onSelectWorkspaceAccess,
  showAccountUsers = false,
  showWorkspaceAccess = true,
}: SettingsTabsProps) {
  const { t } = useTranslation();

  const tabs: Array<{
    id: SettingsTabView;
    label: string;
    onClick: () => void;
  }> = [
    {
      id: "user",
      label: t("settings.tabs.user"),
      onClick: onSelectUser,
    },
    ...(showAccountUsers
      ? [
          {
            id: "users" as const,
            label: t("settings.tabs.usersRights", { defaultValue: "Users & Rights" }),
            onClick: onSelectUsers,
          },
        ]
      : []),
    {
      id: "api-keys",
      label: t("settings.tabs.apiKeys"),
      onClick: onSelectApiKeys,
    },
    {
      id: "alerts",
      label: t("settings.tabs.alerts"),
      onClick: onSelectAlerts,
    },
    {
      id: "connectivity",
      label: t("settings.tabs.connectivity"),
      onClick: onSelectConnectivity,
    },
  ];

  if (showWorkspaceAccess) {
    tabs.push({
      id: "workspace-access",
      label: t("settings.tabs.workspaceAccess"),
      onClick: onSelectWorkspaceAccess,
    });
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[0_20px_60px_-52px_rgba(0,0,0,0.95)] backdrop-blur-sm">
      {tabs.map((tab) => {
        const isActive = activeView === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={tab.onClick}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 ${
              isActive
                ? "bg-blue-600 text-white shadow-[0_16px_40px_-20px_rgba(37,99,235,0.95)]"
                : "text-gray-300 hover:bg-white/5 hover:text-white"
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
