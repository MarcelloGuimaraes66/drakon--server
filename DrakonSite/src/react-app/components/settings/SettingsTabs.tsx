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
