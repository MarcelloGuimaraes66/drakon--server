import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Bot, Briefcase, Camera, Download, RefreshCw, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";

type HubTab = "agent" | "task";

type HubItem = {
  id: number;
  item_type: HubTab;
  title: string;
  summary: string;
  description?: string | null;
  tags: string[];
  download_count: number;
  version_id: number;
  version_number: number;
  snapshot_json: any;
};

type CameraRow = {
  id: number;
  name: string;
};

export default function HubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("type") === "task" ? "task" : "agent") as HubTab;
  const installTarget = searchParams.get("installTarget");
  const contextCameraId = Number(searchParams.get("cameraId") || 0);
  const contextStepId = Number(searchParams.get("stepId") || 0);
  const returnTo = searchParams.get("returnTo") || "";

  const [items, setItems] = useState<HubItem[]>([]);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [installingItemId, setInstallingItemId] = useState<number | null>(null);
  const [agentPickerItem, setAgentPickerItem] = useState<HubItem | null>(null);
  const [agentCameraId, setAgentCameraId] = useState<string>("");
  const [taskInstallItem, setTaskInstallItem] = useState<HubItem | null>(null);
  const [taskNameOverride, setTaskNameOverride] = useState("");
  const [taskCameraMapping, setTaskCameraMapping] = useState<Record<string, string>>({});

  const contextCameraReady = Number.isInteger(contextCameraId) && contextCameraId > 0;
  const contextStepCameraReady = Number.isInteger(contextCameraId) && contextCameraId !== 0;
  const contextStepReady = Number.isInteger(contextStepId) && contextStepId > 0;
  const jobsLabel = t("jobs.title", { defaultValue: "Jobs" });
  const createJobLabel = t("jobs.createJob", { defaultValue: "Create Job" });
  const searchJobsLabel = t("jobs.searchJobs", { defaultValue: "Search jobs..." });
  const jobNameLabel = t("jobs.jobName", { defaultValue: "Job Name" });
  const jobsLabelLower = jobsLabel.toLocaleLowerCase();

  const availableSlots = useMemo(() => {
    const slots = Array.isArray(taskInstallItem?.snapshot_json?.camera_slots)
      ? taskInstallItem?.snapshot_json.camera_slots
      : [];
    return slots as Array<{ slot_key: string; label: string }>;
  }, [taskInstallItem]);

  const fetchCameras = async () => {
    try {
      const response = await fetch("/api/cameras");
      if (!response.ok) return;
      const data = await response.json();
      setCameras(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  };

  const fetchItems = async (options?: { syncFirst?: boolean }) => {
    setLoading(true);
    setError(null);
    let syncErrorMessage: string | null = null;
    try {
      if (options?.syncFirst) {
        setSyncing(true);
        try {
          const syncResponse = await fetch(`/api/hub/cache/sync?type=${tab}`, { method: "POST" });
          const syncData = await syncResponse.json().catch(() => ({}));
          if (!syncResponse.ok) {
            syncErrorMessage = String(syncData?.error || "Failed to synchronize Hub cache.");
          }
        } catch {
          syncErrorMessage = "Failed to synchronize Hub cache.";
        } finally {
          setSyncing(false);
        }
      }
      const query = new URLSearchParams();
      query.set("type", tab);
      if (search.trim()) query.set("q", search.trim());
      const response = await fetch(`/api/hub/cache/items?${query.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load Hub items.");
      }
      setItems(Array.isArray(data?.items) ? data.items : []);
      if (syncErrorMessage) {
        setError(syncErrorMessage);
      }
    } catch (err: any) {
      setError(String(err?.message || err || "Failed to load Hub items."));
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    void fetchCameras();
  }, []);

  useEffect(() => {
    void fetchItems({ syncFirst: true });
  }, [tab]);

  const updateTab = (nextTab: HubTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("type", nextTab);
    setSearchParams(nextParams);
  };

  const finishAndReturn = (fallbackPath: string) => {
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    navigate(fallbackPath);
  };

  const installAgent = async (item: HubItem, cameraId: number) => {
    setInstallingItemId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/hub/items/${item.id}/install-agent-to-camera/${cameraId}`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to install agent.");
      }
      setMessage("Agent installed successfully.");
      finishAndReturn(`/algorithms/${cameraId}`);
    } catch (err: any) {
      setError(String(err?.message || err || "Failed to install agent."));
    } finally {
      setInstallingItemId(null);
      setAgentPickerItem(null);
    }
  };

  const installAgentIntoStep = async (item: HubItem) => {
    if (!contextStepCameraReady || !contextStepReady) return;
    setInstallingItemId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/hub/items/${item.id}/install-agent-to-step-target`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step_id: contextStepId,
          camera_id: contextCameraId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to install agent into step.");
      }
      setMessage("Agent installed into the step.");
      finishAndReturn("/jobs");
    } catch (err: any) {
      setError(String(err?.message || err || "Failed to install agent into step."));
    } finally {
      setInstallingItemId(null);
    }
  };

  const submitTaskInstall = async () => {
    if (!taskInstallItem) return;
    setInstallingItemId(taskInstallItem.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/hub/items/${taskInstallItem.id}/install-task`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name_override: taskNameOverride.trim() || undefined,
          camera_slot_mapping: availableSlots
            .map((slot) => ({
              slot_key: slot.slot_key,
              camera_id: Number(taskCameraMapping[slot.slot_key] || 0),
            }))
            .filter((row) => Number.isInteger(row.camera_id) && row.camera_id > 0),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create job from Hub.");
      }
      const jobId = Number(data?.job?.id || 0);
      setMessage("Job created from Hub.");
      setTaskInstallItem(null);
      finishAndReturn(jobId > 0 ? `/jobs?job=${jobId}` : "/jobs");
    } catch (err: any) {
      setError(String(err?.message || err || "Failed to create job from Hub."));
    } finally {
      setInstallingItemId(null);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),auto,minmax(0,1fr)] xl:items-center">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow-lg shadow-orange-500/20">
                {tab === "agent" ? <Bot className="h-6 w-6" /> : <Briefcase className="h-6 w-6" />}
              </div>
              <div>
                <h1 className="text-3xl font-semibold text-gray-100">Hub</h1>
                <p className="text-sm text-gray-400">
                  Browse reusable agents and {jobsLabelLower} without touching existing execution flows.
                </p>
              </div>
            </div>
          </div>

          <div className="inline-flex rounded-full border border-gray-800 bg-gray-900/80 p-1">
            <button
              type="button"
              onClick={() => updateTab("agent")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === "agent" ? "bg-orange-500 text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Agents
            </button>
            <button
              type="button"
              onClick={() => updateTab("task")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === "task" ? "bg-orange-500 text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {jobsLabel}
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row xl:justify-self-end">
            <label className="relative block min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void fetchItems();
                  }
                }}
                placeholder={tab === "agent" ? "Search agents" : searchJobsLabel}
                className="w-full rounded-2xl border border-gray-800 bg-gray-900/80 py-3 pl-10 pr-4 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void fetchItems({ syncFirst: true })}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                syncing ? "bg-gray-800 text-gray-500" : "bg-gray-900 text-gray-100 hover:bg-gray-800"
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing" : "Sync Hub"}
            </button>
          </div>
        </div>

        {installTarget === "camera" && contextCameraReady ? (
          <div className="rounded-3xl border border-blue-500/20 bg-blue-500/10 px-5 py-4 text-sm text-blue-100">
            Installing into camera <span className="font-semibold">#{contextCameraId}</span>.
          </div>
        ) : null}
        {installTarget === "step" && contextStepCameraReady && contextStepReady ? (
          <div className="rounded-3xl border border-violet-500/20 bg-violet-500/10 px-5 py-4 text-sm text-violet-100">
            Installing into step <span className="font-semibold">#{contextStepId}</span>,{" "}
            {contextCameraReady ? (
              <>
                camera <span className="font-semibold">#{contextCameraId}</span>
              </>
            ) : (
              <>an unassigned camera slot</>
            )}
            .
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[32px] border border-dashed border-gray-800 bg-gray-900/40 px-6 py-16 text-center text-gray-500">
            Loading Hub items...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-gray-800 bg-gray-900/40 px-6 py-16 text-center text-gray-500">
            No {tab === "agent" ? "agents" : jobsLabelLower} found in the Hub yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <article
                key={item.id}
                className="flex min-h-[250px] flex-col rounded-[28px] border border-gray-800/80 bg-gray-900/70 p-5 shadow-[0_28px_90px_-60px_rgba(0,0,0,1)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1 text-xs font-medium text-gray-300">
                      v{item.version_number}
                    </span>
                    <span className="inline-flex rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-100">
                      {item.item_type === "agent" ? "Agent" : jobsLabel}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">{item.download_count} downloads</div>
                </div>

                <div className="mt-4 flex-1">
                  <h2 className="text-xl font-semibold text-gray-100">{item.title}</h2>
                  <p className="mt-2 line-clamp-4 text-sm leading-6 text-gray-400">
                    {item.summary || item.description || "No summary provided."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <span
                        key={`${item.id}-${tag}`}
                        className="rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1 text-xs text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-5 border-t border-gray-800/80 pt-4">
                  {item.item_type === "agent" ? (
                    installTarget === "step" && contextStepCameraReady && contextStepReady ? (
                      <button
                        type="button"
                        disabled={installingItemId === item.id}
                        onClick={() => void installAgentIntoStep(item)}
                        className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                          installingItemId === item.id
                            ? "cursor-not-allowed bg-gray-800 text-gray-500"
                            : "bg-orange-500 text-white hover:bg-orange-400"
                        }`}
                      >
                        <Download className="h-4 w-4" />
                        {installingItemId === item.id ? "Installing..." : "Use in This Step"}
                      </button>
                    ) : installTarget === "camera" && contextCameraReady ? (
                      <button
                        type="button"
                        disabled={installingItemId === item.id}
                        onClick={() => void installAgent(item, contextCameraId)}
                        className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                          installingItemId === item.id
                            ? "cursor-not-allowed bg-gray-800 text-gray-500"
                            : "bg-orange-500 text-white hover:bg-orange-400"
                        }`}
                      >
                        <Camera className="h-4 w-4" />
                        {installingItemId === item.id ? "Installing..." : "Add to This Camera"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setAgentPickerItem(item);
                          setAgentCameraId(cameras[0]?.id ? String(cameras[0].id) : "");
                        }}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-400"
                      >
                        <Camera className="h-4 w-4" />
                        Install to Camera
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setTaskInstallItem(item);
                        setTaskNameOverride(item.title);
                        const initialMapping: Record<string, string> = {};
                        const slots = Array.isArray(item.snapshot_json?.camera_slots)
                          ? item.snapshot_json.camera_slots
                          : [];
                        for (const slot of slots) {
                          const slotKey = String(slot?.slot_key || "");
                          if (slotKey) initialMapping[slotKey] = "";
                        }
                        setTaskCameraMapping(initialMapping);
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-400"
                    >
                      <Briefcase className="h-4 w-4" />
                      {createJobLabel}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {agentPickerItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-gray-100">Install Agent</h2>
                <p className="mt-1 text-sm text-gray-400">{agentPickerItem.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setAgentPickerItem(null)}
                className="rounded-xl border border-gray-800 bg-gray-900/80 p-2 text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">Camera</label>
                <select
                  value={agentCameraId}
                  onChange={(event) => setAgentCameraId(event.target.value)}
                  className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                >
                  {cameras.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-800 px-6 py-5">
              <button
                type="button"
                onClick={() => setAgentPickerItem(null)}
                className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:border-gray-700 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!agentCameraId || installingItemId === agentPickerItem.id}
                onClick={() => void installAgent(agentPickerItem, Number(agentCameraId))}
                className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  !agentCameraId || installingItemId === agentPickerItem.id
                    ? "cursor-not-allowed bg-gray-800 text-gray-500"
                    : "bg-orange-500 text-white hover:bg-orange-400"
                }`}
              >
                {installingItemId === agentPickerItem.id ? "Installing..." : "Install"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {taskInstallItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-gray-100">{createJobLabel} from Hub</h2>
                <p className="mt-1 text-sm text-gray-400">{taskInstallItem.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setTaskInstallItem(null)}
                className="rounded-xl border border-gray-800 bg-gray-900/80 p-2 text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">{jobNameLabel}</label>
                <input
                  type="text"
                  value={taskNameOverride}
                  onChange={(event) => setTaskNameOverride(event.target.value)}
                  className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {availableSlots.map((slot) => (
                <div key={slot.slot_key}>
                  <label className="mb-2 block text-sm font-medium text-gray-300">{slot.label}</label>
                  <select
                    value={taskCameraMapping[slot.slot_key] || ""}
                    onChange={(event) =>
                      setTaskCameraMapping((current) => ({
                        ...current,
                        [slot.slot_key]: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Choose later</option>
                    {cameras.map((camera) => (
                      <option key={`${slot.slot_key}-${camera.id}`} value={camera.id}>
                        {camera.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-gray-500">
                    Leave this empty to create the {jobsLabelLower} skeleton first and assign the camera later inside the step.
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-800 px-6 py-5">
              <button
                type="button"
                onClick={() => setTaskInstallItem(null)}
                className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:border-gray-700 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={installingItemId === taskInstallItem.id}
                onClick={() => void submitTaskInstall()}
                className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  installingItemId === taskInstallItem.id
                    ? "cursor-not-allowed bg-gray-800 text-gray-500"
                    : "bg-orange-500 text-white hover:bg-orange-400"
                }`}
              >
                {installingItemId === taskInstallItem.id ? "Creating..." : createJobLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
