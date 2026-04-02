import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Eye, EyeOff, X } from "lucide-react";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { ONBOARDING_TARGETS } from "@/react-app/lib/onboarding";
import { normalizeCountryCode } from "@/shared/brazilStates";
import type { CameraFindShare } from "@/shared/types";

const CAMERA_LABEL_OPTIONS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "living_room", label: "Living Room" },
  { value: "bedroom", label: "Bedroom" },
  { value: "childrens_room", label: "Children's Room" },
  { value: "office_room", label: "Office Room" },
  { value: "corridor", label: "Corridor" },
  { value: "elevator", label: "Elevator" },
  { value: "classroom", label: "Classroom" },
  { value: "parking_lot", label: "Parking Lot" },
  { value: "garage", label: "Garage" },
  { value: "street", label: "Street" },
  { value: "intersection", label: "Intersection" },
  { value: "park", label: "Park" },
  { value: "yard", label: "Yard" },
  { value: "frontyard", label: "Frontyard" },
  { value: "backyard", label: "Backyard" },
  { value: "store", label: "Store" },
  { value: "supermarket", label: "Supermarket" },
  { value: "warehouse", label: "Warehouse" },
  { value: "staircase", label: "Staircase" },
  { value: "lobby", label: "Lobby" },
  { value: "reception", label: "Reception" },
  { value: "restaurant", label: "Restaurant" },
  { value: "bar", label: "Bar" },
  { value: "cafe", label: "Cafe" },
  { value: "gym", label: "Gym" },
  { value: "front_door", label: "Front Door" },
  { value: "back_door", label: "Back Door" },
  { value: "other_indoor", label: "Other Indoor" },
  { value: "other_outdoor", label: "Other Outdoor" },
] as const;

type RetentionDays = 1 | 3 | 7 | 15 | 30 | 90 | 180;
type CameraConnectionTab = "WEBCAM" | "IP_RTSP";
type CameraConnectionMethod = "WEBCAM" | "RTSP" | "HTTP" | "ONVIF";

type BaseFormData = {
  name: string;
  street: string;
  number: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  retention_days: RetentionDays;
  allowpublicaccess: boolean;
};

type WebcamFormData = BaseFormData & {
  webcam_index: number | null;
};

type RtspFormData = BaseFormData & {
  ip_address: string;
  rtsp_port: string;
  manufacturer: string;
  username: string;
  password: string;
  channel: string;
  subtype: string;
  connection_method: Exclude<CameraConnectionMethod, "WEBCAM">;
};

type EditFormData = BaseFormData & {
  ip_address: string;
  rtsp_port: string;
  manufacturer: string;
  username: string;
  password: string;
  channel: string;
  subtype: string;
  connection_method: CameraConnectionMethod;
  webcam_index: number | null;
};

type AddressLookupStatus = "idle" | "loading" | "success" | "warning" | "error";

type AddressLookupState = {
  status: AddressLookupStatus;
  message: string | null;
};

type AddressLookupResponse = {
  found: boolean;
  source: "viacep" | "google-geocoding" | null;
  postal_code: string;
  country: string | null;
  country_code: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  confidence: "high" | "medium" | null;
  auto_filled_fields: Array<"street" | "city" | "state" | "country">;
  message: string | null;
};

function normalizeCameraFindShare(value: unknown): CameraFindShare | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CameraFindShare> & Record<string, unknown>;
  const id = Number(row.id || 0);
  if (!Number.isInteger(id) || id <= 0) return null;

  return {
    id,
    owner_public_id: typeof row.owner_public_id === "string" ? row.owner_public_id : "",
    invitee_public_id: typeof row.invitee_public_id === "string" ? row.invitee_public_id : "",
    owner_local_camera_id: Number(row.owner_local_camera_id || 0),
    camera_name: typeof row.camera_name === "string" ? row.camera_name : "",
    city: typeof row.city === "string" ? row.city : null,
    state_code: typeof row.state_code === "string" ? row.state_code : null,
    country_code: typeof row.country_code === "string" ? row.country_code : "BR",
    status: typeof row.status === "string" ? row.status : "pending",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : null,
    revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

export type CameraEditorCamera = {
  id: number;
  name: string;
  ip_address?: string | null;
  rtsp_port?: string | null;
  manufacturer?: string | null;
  username?: string | null;
  password?: string | null;
  channel?: string | null;
  subtype?: string | null;
  connection_method?: string | null;
  description?: string | null;
  street?: string | null;
  number?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  country?: string | null;
  retention_days?: number | null;
  webcam_index?: number | null;
  allowpublicaccess?: number | boolean | null;
};

export type CameraEditorDraft = Partial<Omit<CameraEditorCamera, "id">>;

export type CameraEditorSavedResult = {
  cameraId: number | null;
  cameraName: string | null;
  connectionMethod: string | null;
};

type CameraEditorModalProps = {
  isOpen: boolean;
  camera: CameraEditorCamera | null;
  draftCamera?: CameraEditorDraft | null;
  existingCameraNames?: string[];
  onClose: () => void;
  onSaved?: (result?: CameraEditorSavedResult) => Promise<void> | void;
};

type TutorialWebcamProbeStatus = "idle" | "probing" | "ready" | "missing" | "unknown";

type TutorialWebcamProbeResult = {
  status: TutorialWebcamProbeStatus;
  preferredIndex: number | null;
  attemptedIndices: number[];
  respondingIndices: number[];
  error: string | null;
};

const VALID_RETENTION_DAYS: RetentionDays[] = [1, 3, 7, 15, 30, 90, 180];
const DEFAULT_TUTORIAL_WEBCAM_PROBE_INDICES = [0, 1, 2, 3, 4, 5] as const;
const DEFAULT_TUTORIAL_WEBCAM_PROBE_RESULT: TutorialWebcamProbeResult = {
  status: "idle",
  preferredIndex: null,
  attemptedIndices: [...DEFAULT_TUTORIAL_WEBCAM_PROBE_INDICES],
  respondingIndices: [],
  error: null,
};

function parseProbeIndices(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: number[] = [];
  for (const entry of value) {
    const numeric = Number(entry);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 5) {
      continue;
    }
    if (!normalized.includes(numeric)) {
      normalized.push(numeric);
    }
  }

  return normalized;
}

function parseOptionalProbeIndex(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

async function requestTutorialWebcamProbe(): Promise<TutorialWebcamProbeResult> {
  try {
    const response = await fetch("/api/webcams/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ indices: [...DEFAULT_TUTORIAL_WEBCAM_PROBE_INDICES] }),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const attemptedIndices = (() => {
      const parsed = parseProbeIndices(data.attempted_indices);
      return parsed.length > 0 ? parsed : [...DEFAULT_TUTORIAL_WEBCAM_PROBE_INDICES];
    })();
    const respondingIndices = parseProbeIndices(data.responding_indices);
    const preferredIndex = parseOptionalProbeIndex(data.preferred_index);
    const rawStatus = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
    const error =
      typeof data.error === "string" && data.error.trim().length > 0 ? data.error.trim() : null;

    if (!response.ok) {
      return {
        status: "unknown",
        preferredIndex,
        attemptedIndices,
        respondingIndices,
        error: error || "Unable to verify webcam availability on this machine.",
      };
    }

    if (rawStatus === "ready") {
      return {
        status: "ready",
        preferredIndex,
        attemptedIndices,
        respondingIndices,
        error: null,
      };
    }

    if (rawStatus === "missing") {
      return {
        status: "missing",
        preferredIndex,
        attemptedIndices,
        respondingIndices,
        error,
      };
    }

    return {
      status: "unknown",
      preferredIndex,
      attemptedIndices,
      respondingIndices,
      error,
    };
  } catch (error) {
    return {
      status: "unknown",
      preferredIndex: null,
      attemptedIndices: [...DEFAULT_TUTORIAL_WEBCAM_PROBE_INDICES],
      respondingIndices: [],
      error: getErrorMessage(error, "Unable to verify webcam availability on this machine."),
    };
  }
}

function createEmptyWebcamForm(country = ""): WebcamFormData {
  return {
    name: "",
    webcam_index: null,
    street: "",
    number: "",
    city: "",
    state: "",
    zip_code: "",
    country,
    retention_days: 1,
    allowpublicaccess: false,
  };
}

function getNextTutorialWebcamName(existingCameraNames: string[]): string {
  let highestTutorialIndex = 0;

  for (const rawName of existingCameraNames) {
    const normalizedName = String(rawName || "").trim();
    const match = normalizedName.match(/^(?:webcam\s+)?tutorial webcam(?:\s+(\d+))?$/i);
    if (!match) {
      continue;
    }

    const parsedIndex = match[1] ? Number.parseInt(match[1], 10) : 1;
    if (Number.isInteger(parsedIndex) && parsedIndex > highestTutorialIndex) {
      highestTutorialIndex = parsedIndex;
    }
  }

  return highestTutorialIndex <= 0
    ? "tutorial webcam"
    : `tutorial webcam ${highestTutorialIndex + 1}`;
}

function createTutorialWebcamForm(
  name = "tutorial webcam",
  country = "",
  countryCode: string | null = null
): WebcamFormData {
  const fallbackCountry =
    country.trim() || (countryCode === "BR" ? "Brazil" : "United States");

  return {
    name,
    webcam_index: 0,
    street: "Tutorial setup",
    number: "0",
    city: "Tutorial City",
    state: "Tutorial State",
    zip_code: countryCode === "BR" ? "00000000" : "00000",
    country: fallbackCountry,
    retention_days: 1,
    allowpublicaccess: false,
  };
}

function createEmptyRtspForm(country = ""): RtspFormData {
  return {
    name: "",
    ip_address: "",
    rtsp_port: "",
    manufacturer: "",
    username: "",
    password: "",
    channel: "",
    subtype: "",
    connection_method: "RTSP",
    street: "",
    number: "",
    city: "",
    state: "",
    zip_code: "",
    country,
    retention_days: 1,
    allowpublicaccess: false,
  };
}

function resolveCountryName(countryCode: string | null | undefined): string {
  const normalized = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (!normalized) {
    return "";
  }

  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

function normalizePostalCodeForLookup(value: string, countryCode: string | null): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  if (countryCode === "BR") {
    return raw.replace(/\D+/g, "").slice(0, 8);
  }

  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 -]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPostalCodeReadyForLookup(postalCode: string, countryCode: string | null): boolean {
  if (!postalCode) {
    return false;
  }

  if (countryCode === "BR") {
    return postalCode.length === 8;
  }

  return postalCode.length >= 3;
}

function formatAddressLookupSource(source: AddressLookupResponse["source"]): string {
  if (source === "viacep") {
    return "ViaCEP";
  }

  if (source === "google-geocoding") {
    return "Google Geocoding";
  }

  return "address lookup";
}

function formatAddressLookupFields(
  fields: AddressLookupResponse["auto_filled_fields"]
): string {
  const labelByField: Record<AddressLookupResponse["auto_filled_fields"][number], string> = {
    street: "Street",
    city: "City",
    state: "State",
    country: "Country",
  };

  return fields
    .filter((field) => field !== "country")
    .map((field) => labelByField[field])
    .join(", ");
}

function normalizeManufacturerValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function isSubtypeLockedForManufacturer(value: unknown): boolean {
  return normalizeManufacturerValue(value) === "hikvision";
}

function normalizeOptionalField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRetentionDays(value: number | null | undefined): RetentionDays {
  if (value && VALID_RETENTION_DAYS.includes(value as RetentionDays)) {
    return value as RetentionDays;
  }
  return 1;
}

function parseDescription(description: string | null | undefined) {
  let label = "other_indoor";
  let text = "";

  if (!description) {
    return { label, text };
  }

  const labelMatch = description.match(/LABEL:\s*(.+?)\s*DESCRIPTION:/);
  const descMatch = description.match(/DESCRIPTION:\s*(.+)$/s);

  if (labelMatch && descMatch) {
    const extractedLabel = labelMatch[1].trim();
    text = descMatch[1].trim();
    const allowedValues = CAMERA_LABEL_OPTIONS.map((option) => option.value);
    if (allowedValues.includes(extractedLabel as (typeof CAMERA_LABEL_OPTIONS)[number]["value"])) {
      label = extractedLabel;
    }
  } else {
    text = description;
  }

  return { label, text };
}

function buildEditForm(camera: CameraEditorCamera): EditFormData {
  return {
    name: camera.name,
    ip_address: camera.ip_address || "",
    rtsp_port: camera.rtsp_port || "",
    manufacturer: camera.manufacturer || "",
    username: camera.username || "",
    password: camera.password || "",
    channel: camera.channel || "",
    subtype: camera.subtype || "",
    connection_method:
      camera.connection_method === "WEBCAM" ||
      camera.connection_method === "HTTP" ||
      camera.connection_method === "ONVIF"
        ? camera.connection_method
        : "RTSP",
    retention_days: normalizeRetentionDays(camera.retention_days),
    street: camera.street || "",
    number: camera.number || "",
    city: camera.city || "",
    state: camera.state || "",
    zip_code: camera.zip_code || "",
    country: camera.country || "",
    webcam_index: camera.webcam_index ?? null,
    allowpublicaccess: Boolean(camera.allowpublicaccess),
  };
}

function buildDraftWebcamForm(camera: CameraEditorDraft, fallbackCountry = ""): WebcamFormData {
  return {
    ...createEmptyWebcamForm(),
    name: camera.name || "",
    webcam_index:
      typeof camera.webcam_index === "number" ? camera.webcam_index : null,
    street: camera.street || "",
    number: camera.number || "",
    city: camera.city || "",
    state: camera.state || "",
    zip_code: camera.zip_code || "",
    country: camera.country || fallbackCountry,
    retention_days: normalizeRetentionDays(camera.retention_days),
    allowpublicaccess: Boolean(camera.allowpublicaccess),
  };
}

function buildDraftRtspForm(camera: CameraEditorDraft, fallbackCountry = ""): RtspFormData {
  return {
    ...createEmptyRtspForm(),
    name: camera.name || "",
    ip_address: camera.ip_address || "",
    rtsp_port: camera.rtsp_port || "",
    manufacturer: camera.manufacturer || "",
    username: camera.username || "",
    password: camera.password || "",
    channel: camera.channel || "",
    subtype: camera.subtype || "",
    connection_method:
      camera.connection_method === "HTTP" || camera.connection_method === "ONVIF"
        ? camera.connection_method
        : "RTSP",
    street: camera.street || "",
    number: camera.number || "",
    city: camera.city || "",
    state: camera.state || "",
    zip_code: camera.zip_code || "",
    country: camera.country || fallbackCountry,
    retention_days: normalizeRetentionDays(camera.retention_days),
    allowpublicaccess: Boolean(camera.allowpublicaccess),
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof (error as { error?: unknown }).error === "string"
  ) {
    return (error as { error: string }).error;
  }
  return fallback;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const responseText = await response.text();

  try {
    const errorData = JSON.parse(responseText);

    if (typeof errorData.error === "string") {
      return errorData.error;
    }

    if (errorData.error && typeof errorData.error === "object" && Array.isArray(errorData.error.issues)) {
      return `Validation error: ${errorData.error.issues
        .map((issue: { path?: string[]; message: string }) => {
          const fieldPath = Array.isArray(issue.path) ? issue.path.join(".") : "field";
          return `${fieldPath}: ${issue.message}`;
        })
        .join(", ")}`;
    }

    if (typeof errorData.message === "string") {
      return errorData.message;
    }

    if (Array.isArray(errorData.details)) {
      return `Validation error: ${errorData.details
        .map((issue: { path?: string[]; message: string }) => {
          const fieldPath = Array.isArray(issue.path) ? issue.path.join(".") : "field";
          return `${fieldPath}: ${issue.message}`;
        })
        .join(", ")}`;
    }
  } catch {
    if (responseText.trim().length > 0) {
      return `Server error (${response.status}): ${responseText}`;
    }
  }

  return fallback;
}

function normalizeCameraId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function getSavedCameraResult(
  responseData: unknown,
  fallback: {
    cameraId?: number | null;
    cameraName?: string | null;
    connectionMethod?: string | null;
  }
): CameraEditorSavedResult {
  const data =
    responseData && typeof responseData === "object"
      ? (responseData as Record<string, unknown>)
      : null;
  const cameraData =
    data?.camera && typeof data.camera === "object"
      ? (data.camera as Record<string, unknown>)
      : null;

  const cameraId =
    normalizeCameraId(cameraData?.id) ??
    normalizeCameraId(data?.camera_id) ??
    normalizeCameraId(data?.id) ??
    normalizeCameraId(fallback.cameraId);

  const cameraName =
    typeof cameraData?.name === "string" && cameraData.name.trim()
      ? cameraData.name.trim()
      : typeof fallback.cameraName === "string" && fallback.cameraName.trim()
      ? fallback.cameraName.trim()
      : null;

  const connectionMethod =
    typeof cameraData?.connection_method === "string" && cameraData.connection_method.trim()
      ? cameraData.connection_method.trim()
      : typeof fallback.connectionMethod === "string" && fallback.connectionMethod.trim()
      ? fallback.connectionMethod.trim()
      : null;

  return {
    cameraId,
    cameraName,
    connectionMethod,
  };
}

export default function CameraEditorModal({
  isOpen,
  camera,
  draftCamera = null,
  existingCameraNames = [],
  onClose,
  onSaved,
}: CameraEditorModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    currentStepId: onboardingStepId,
    isOpen: isOnboardingOpen,
    setTutorialProceedWithoutWebcam,
  } = useOnboarding();
  const userCountryCode = normalizeCountryCode(user?.country_code, null);
  const userCountryName = resolveCountryName(user?.country_code);
  const latestUserCountryNameRef = useRef(userCountryName);
  const tutorialWebcamSeededRef = useRef(false);
  const addressLookupRequestIdRef = useRef(0);
  const lookupAddressForCurrentFormRef = useRef<(() => Promise<void>) | null>(null);
  const lastAutoLookupKeyRef = useRef("");
  const [activeTab, setActiveTab] = useState<CameraConnectionTab>("IP_RTSP");
  const [webcamForm, setWebcamForm] = useState<WebcamFormData>(createEmptyWebcamForm);
  const [rtspForm, setRtspForm] = useState<RtspFormData>(createEmptyRtspForm);
  const [editForm, setEditForm] = useState<EditFormData | null>(null);
  const [descriptionLabel, setDescriptionLabel] = useState("other_indoor");
  const [descriptionText, setDescriptionText] = useState("");
  const [isAddressExpanded, setIsAddressExpanded] = useState(false);
  const [addressErrors, setAddressErrors] = useState<Record<string, boolean>>({});
  const [addressLookupState, setAddressLookupState] = useState<AddressLookupState>({
    status: "idle",
    message: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [shareLookupValue, setShareLookupValue] = useState("");
  const [cameraShares, setCameraShares] = useState<CameraFindShare[]>([]);
  const [loadingCameraShares, setLoadingCameraShares] = useState(false);
  const [creatingCameraShare, setCreatingCameraShare] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState<number | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [tutorialWebcamProbe, setTutorialWebcamProbe] = useState<TutorialWebcamProbeResult>(
    DEFAULT_TUTORIAL_WEBCAM_PROBE_RESULT
  );
  const [showTutorialNoWebcamDialog, setShowTutorialNoWebcamDialog] = useState(false);
  const [tutorialWebcamDecisionBusy, setTutorialWebcamDecisionBusy] = useState(false);
  const isEditing = !!camera;
  const isTutorialWebcamOnboardingStep =
    !isEditing &&
    isOnboardingOpen &&
    (onboardingStepId === "camera-webcam-form" || onboardingStepId === "camera-webcam-save");

  useEffect(() => {
    latestUserCountryNameRef.current = userCountryName;
  }, [userCountryName]);

  useEffect(() => {
    if (!isOpen) {
      tutorialWebcamSeededRef.current = false;
      setTutorialWebcamProbe(DEFAULT_TUTORIAL_WEBCAM_PROBE_RESULT);
      setShowTutorialNoWebcamDialog(false);
      setTutorialWebcamDecisionBusy(false);
      return;
    }

    const defaultCountry = latestUserCountryNameRef.current;

    addressLookupRequestIdRef.current += 1;
    lastAutoLookupKeyRef.current = "";
    setSubmitError(null);
    setAddressErrors({});
    setAddressLookupState({ status: "idle", message: null });
    setIsAddressExpanded(false);
    setIsSubmitting(false);
    setShareLookupValue("");
    setCameraShares([]);
    setLoadingCameraShares(false);
    setCreatingCameraShare(false);
    setRevokingShareId(null);
    setShareError(null);
    setShowPassword(false);
    setTutorialWebcamProbe(DEFAULT_TUTORIAL_WEBCAM_PROBE_RESULT);
    setShowTutorialNoWebcamDialog(false);
    setTutorialWebcamDecisionBusy(false);

    if (camera) {
      const isWebcam = camera.connection_method === "WEBCAM" || camera.webcam_index != null;
      const { label, text } = parseDescription(camera.description);

      setActiveTab(isWebcam ? "WEBCAM" : "IP_RTSP");
      setEditForm(buildEditForm(camera));
      setDescriptionLabel(label);
      setDescriptionText(text);
      void loadCameraShares(camera.id);
      return;
    }

    if (draftCamera) {
      const isWebcam =
        draftCamera.connection_method === "WEBCAM" || draftCamera.webcam_index != null;

      setActiveTab(isWebcam ? "WEBCAM" : "IP_RTSP");
      setWebcamForm(buildDraftWebcamForm(draftCamera, defaultCountry));
      setRtspForm(buildDraftRtspForm(draftCamera, defaultCountry));
      setEditForm(null);
      setDescriptionLabel("other_indoor");
      setDescriptionText("");
      setIsAddressExpanded(true);
      return;
    }

    setActiveTab("IP_RTSP");
    setWebcamForm(createEmptyWebcamForm(defaultCountry));
    setRtspForm(createEmptyRtspForm(defaultCountry));
    setEditForm(null);
    setDescriptionLabel("other_indoor");
    setDescriptionText("");
  }, [camera, draftCamera, isOpen]);

  useEffect(() => {
    if (!isOpen || isEditing || !isOnboardingOpen || !onboardingStepId) {
      if (!isOpen) {
        tutorialWebcamSeededRef.current = false;
      }
      return;
    }

    const isRtspTutorialStep =
      onboardingStepId === "camera-rtsp-form" ||
      onboardingStepId === "camera-address" ||
      onboardingStepId === "camera-storage";
    const isWebcamTutorialStep =
      onboardingStepId === "camera-webcam-form" ||
      onboardingStepId === "camera-webcam-save";

    if (isRtspTutorialStep && activeTab !== "IP_RTSP") {
      addressLookupRequestIdRef.current += 1;
      lastAutoLookupKeyRef.current = "";
      setActiveTab("IP_RTSP");
      setAddressErrors({});
      setAddressLookupState({ status: "idle", message: null });
      setSubmitError(null);
    }

    if (
      onboardingStepId === "camera-address" ||
      onboardingStepId === "camera-storage" ||
      isWebcamTutorialStep
    ) {
      setIsAddressExpanded(true);
    }

    if (!isWebcamTutorialStep) {
      return;
    }

    if (activeTab !== "WEBCAM") {
      addressLookupRequestIdRef.current += 1;
      lastAutoLookupKeyRef.current = "";
      setActiveTab("WEBCAM");
      setAddressErrors({});
      setAddressLookupState({ status: "idle", message: null });
      setSubmitError(null);
    }

    if (!tutorialWebcamSeededRef.current) {
      const defaultCountry =
        latestUserCountryNameRef.current.trim() ||
        (userCountryCode === "BR" ? "Brazil" : "United States");
      const tutorialCameraName = getNextTutorialWebcamName(existingCameraNames);

      setWebcamForm(createTutorialWebcamForm(tutorialCameraName, defaultCountry, userCountryCode));
      tutorialWebcamSeededRef.current = true;
    }
  }, [activeTab, existingCameraNames, isEditing, isOnboardingOpen, isOpen, onboardingStepId, userCountryCode]);

  useEffect(() => {
    if (!isOpen || !isTutorialWebcamOnboardingStep || activeTab !== "WEBCAM") {
      return;
    }

    if (tutorialWebcamProbe.status !== "idle") {
      return;
    }

    void runTutorialWebcamProbe({ autoApplyPreferredIndex: true });
  }, [activeTab, isOpen, isTutorialWebcamOnboardingStep, tutorialWebcamProbe.status]);

  useEffect(() => {
    if (!isOpen || !userCountryName) {
      return;
    }

    setWebcamForm((current) =>
      current.country.trim() ? current : { ...current, country: userCountryName }
    );
    setRtspForm((current) =>
      current.country.trim() ? current : { ...current, country: userCountryName }
    );
    setEditForm((current) =>
      current && !current.country.trim()
        ? { ...current, country: userCountryName }
        : current
    );
  }, [isOpen, userCountryName]);

  const formData = isEditing ? editForm : activeTab === "WEBCAM" ? webcamForm : rtspForm;
  const currentManufacturer =
    formData && "manufacturer" in formData ? formData.manufacturer : undefined;
  const subtypeLocked =
    activeTab === "IP_RTSP" && isSubtypeLockedForManufacturer(currentManufacturer);
  const webcamFields = formData && "webcam_index" in formData ? formData : null;
  const rtspFields = formData && "ip_address" in formData ? formData : null;

  const runTutorialWebcamProbe = async (
    options: {
      autoApplyPreferredIndex?: boolean;
    } = {}
  ): Promise<TutorialWebcamProbeResult> => {
    setTutorialWebcamProbe((current) => ({
      ...current,
      status: "probing",
      error: null,
    }));

    const result = await requestTutorialWebcamProbe();

    setTutorialWebcamProbe(result);
    if (
      options.autoApplyPreferredIndex &&
      result.status === "ready" &&
      typeof result.preferredIndex === "number"
    ) {
      setWebcamForm((current) =>
        current.webcam_index === result.preferredIndex
          ? current
          : { ...current, webcam_index: result.preferredIndex }
      );
    }

    return result;
  };

  const handleTabChange = (tab: CameraConnectionTab) => {
    addressLookupRequestIdRef.current += 1;
    lastAutoLookupKeyRef.current = "";
    setActiveTab(tab);
    setAddressErrors({});
    setAddressLookupState({ status: "idle", message: null });
    setSubmitError(null);
  };

  const updateCurrentFormData = (
    updates: Partial<EditFormData> | Partial<WebcamFormData> | Partial<RtspFormData>
  ) => {
    if (isEditing) {
      setEditForm((current) =>
        current ? { ...current, ...(updates as Partial<EditFormData>) } : current
      );
      return;
    }

    if (activeTab === "WEBCAM") {
      setWebcamForm((current) => ({
        ...current,
        ...(updates as Partial<WebcamFormData>),
      }));
      return;
    }

    setRtspForm((current) => ({
      ...current,
      ...(updates as Partial<RtspFormData>),
    }));
  };

  const handleZipCodeChange = (value: string) => {
    addressLookupRequestIdRef.current += 1;
    lastAutoLookupKeyRef.current = "";
    setAddressLookupState({ status: "idle", message: null });
    updateCurrentFormData({ zip_code: value });
  };

  const handleCountryChange = (value: string) => {
    addressLookupRequestIdRef.current += 1;
    lastAutoLookupKeyRef.current = "";
    setAddressLookupState({ status: "idle", message: null });
    updateCurrentFormData({ country: value });
  };

  const lookupAddressForCurrentForm = async () => {
    if (!formData) {
      return;
    }

    const fallbackCountryCode = userCountryCode;
    const effectiveCountryCode =
      normalizeCountryCode(formData.country, null) || fallbackCountryCode;
    const normalizedPostalCode = normalizePostalCodeForLookup(
      formData.zip_code || "",
      effectiveCountryCode
    );

    if (
      !effectiveCountryCode ||
      !isPostalCodeReadyForLookup(normalizedPostalCode, effectiveCountryCode)
    ) {
      return;
    }

    const lookupRequestId = ++addressLookupRequestIdRef.current;
    const targetForm = isEditing ? "EDIT" : activeTab;
    const sourceName = formData.country.trim() || userCountryName || undefined;

    setAddressLookupState({
      status: "loading",
      message: "Looking up address...",
    });

    try {
      const response = await fetch("/api/address-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          postal_code: normalizedPostalCode,
          country_code: effectiveCountryCode,
          country: sourceName,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to look up address"));
      }

      const result = (await response.json()) as AddressLookupResponse;
      if (lookupRequestId !== addressLookupRequestIdRef.current) {
        return;
      }

      if (!result.found) {
        setAddressLookupState({
          status: "warning",
          message: result.message || "No address data was found for this postal code.",
        });
        return;
      }

      const applyLookupResult = <T extends BaseFormData>(current: T): T => {
        if (
          normalizePostalCodeForLookup(current.zip_code, effectiveCountryCode) !==
          normalizedPostalCode
        ) {
          return current;
        }

        return {
          ...current,
          street: result.street ?? current.street,
          city: result.city ?? current.city,
          state: result.state ?? current.state,
          country: result.country ?? current.country,
        };
      };

      if (targetForm === "EDIT") {
        setEditForm((current) => (current ? applyLookupResult(current) : current));
      } else if (targetForm === "WEBCAM") {
        setWebcamForm((current) => applyLookupResult(current));
      } else {
        setRtspForm((current) => applyLookupResult(current));
      }

      setAddressErrors((current) => {
        const next = { ...current };
        delete next.zip_code;
        if (result.street) {
          delete next.street;
        }
        if (result.city) {
          delete next.city;
        }
        if (result.state) {
          delete next.state;
        }
        if (result.country) {
          delete next.country;
        }
        return next;
      });

      const filledFields = formatAddressLookupFields(result.auto_filled_fields);
      setAddressLookupState({
        status: "success",
        message: filledFields
          ? `Filled ${filledFields} from ${formatAddressLookupSource(result.source)}.`
          : `Address found via ${formatAddressLookupSource(result.source)}.`,
      });
    } catch (error) {
      if (lookupRequestId !== addressLookupRequestIdRef.current) {
        return;
      }

      console.error("Failed to look up address:", error);
      setAddressLookupState({
        status: "error",
        message: getErrorMessage(error, "Failed to look up address."),
      });
    }
  };

  lookupAddressForCurrentFormRef.current = lookupAddressForCurrentForm;

  useEffect(() => {
    if (!isOpen || !formData) {
      lastAutoLookupKeyRef.current = "";
      return;
    }

    const effectiveCountryCode =
      normalizeCountryCode(formData.country, null) || userCountryCode;
    const normalizedPostalCode = normalizePostalCodeForLookup(
      formData.zip_code || "",
      effectiveCountryCode
    );

    if (
      !effectiveCountryCode ||
      !isPostalCodeReadyForLookup(normalizedPostalCode, effectiveCountryCode)
    ) {
      lastAutoLookupKeyRef.current = "";
      return;
    }

    const nextLookupKey = `${isEditing ? "EDIT" : activeTab}:${effectiveCountryCode}:${normalizedPostalCode}`;
    if (nextLookupKey === lastAutoLookupKeyRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (nextLookupKey !== lastAutoLookupKeyRef.current) {
        lastAutoLookupKeyRef.current = nextLookupKey;
        void lookupAddressForCurrentFormRef.current?.();
      }
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, formData?.country, formData?.zip_code, isEditing, isOpen, userCountryCode]);

  const loadCameraShares = async (cameraId: number) => {
    setLoadingCameraShares(true);
    setShareError(null);
    try {
      const response = await fetch(`/api/shared-find/outgoing?camera_id=${cameraId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load shared find invitations.");
      }
      setCameraShares(
        Array.isArray(data?.shares)
          ? data.shares
              .map((row: unknown) => normalizeCameraFindShare(row))
              .filter((row: CameraFindShare | null): row is CameraFindShare => Boolean(row))
          : []
      );
      if (
        (!Array.isArray(data?.shares) || data.shares.length === 0) &&
        typeof data?.sync_error === "string" &&
        data.sync_error.trim()
      ) {
        setShareError(data.sync_error);
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to load shared find invitations.");
    } finally {
      setLoadingCameraShares(false);
    }
  };

  const handleCreateCameraShare = async () => {
    if (!camera) return;
    const query = shareLookupValue.trim();
    if (!query) {
      setShareError("Enter a @handle or email to invite.");
      return;
    }

    setCreatingCameraShare(true);
    setShareError(null);
    try {
      const response = await fetch(`/api/shared-find/cameras/${camera.id}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create the shared find invitation.");
      }
      setShareLookupValue("");
      await loadCameraShares(camera.id);
    } catch (error) {
      setShareError(
        error instanceof Error ? error.message : "Failed to create the shared find invitation."
      );
    } finally {
      setCreatingCameraShare(false);
    }
  };

  const handleRevokeCameraShare = async (shareId: number) => {
    if (!camera) return;
    setRevokingShareId(shareId);
    setShareError(null);
    try {
      const response = await fetch(`/api/shared-find/shares/${shareId}/revoke`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to revoke the shared find invitation.");
      }
      await loadCameraShares(camera.id);
    } catch (error) {
      setShareError(
        error instanceof Error ? error.message : "Failed to revoke the shared find invitation."
      );
    } finally {
      setRevokingShareId(null);
    }
  };

  const submitNewCameraCreation = async (
    options: {
      tutorialProceedWithoutWebcam?: boolean;
      overrideWebcamIndex?: number | null;
    } = {}
  ) => {
    setIsSubmitting(true);

    try {
      let payload: Record<string, unknown>;

      if (activeTab === "WEBCAM") {
        payload = {
          name: webcamForm.name,
          connection_method: "WEBCAM",
          webcam_index:
            typeof options.overrideWebcamIndex === "number"
              ? options.overrideWebcamIndex
              : webcamForm.webcam_index,
          store_frames: true,
          retention_days: webcamForm.retention_days,
          allowpublicaccess: webcamForm.allowpublicaccess,
          street: webcamForm.street,
          number: webcamForm.number,
          city: webcamForm.city,
          state: webcamForm.state,
          zip_code: webcamForm.zip_code,
          country: webcamForm.country,
        };
      } else {
        payload = {
          name: rtspForm.name,
          ip_address: rtspForm.ip_address,
          rtsp_port: normalizeOptionalField(rtspForm.rtsp_port),
          manufacturer: normalizeOptionalField(rtspForm.manufacturer),
          username: normalizeOptionalField(rtspForm.username),
          password: normalizeOptionalField(rtspForm.password),
          channel: normalizeOptionalField(rtspForm.channel),
          subtype: isSubtypeLockedForManufacturer(rtspForm.manufacturer)
            ? undefined
            : normalizeOptionalField(rtspForm.subtype),
          connection_method: rtspForm.connection_method,
          store_frames: true,
          retention_days: rtspForm.retention_days,
          allowpublicaccess: rtspForm.allowpublicaccess,
          street: rtspForm.street,
          number: rtspForm.number,
          city: rtspForm.city,
          state: rtspForm.state,
          zip_code: rtspForm.zip_code,
          country: rtspForm.country,
        };
      }

      const response = await fetch("/api/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create camera"));
      }

      const responseData = await response.json().catch(() => null);
      if (activeTab === "WEBCAM" && isTutorialWebcamOnboardingStep) {
        setTutorialProceedWithoutWebcam(Boolean(options.tutorialProceedWithoutWebcam));
      }
      await onSaved?.(
        getSavedCameraResult(responseData, {
          cameraName: typeof payload.name === "string" ? payload.name : null,
          connectionMethod:
            typeof payload.connection_method === "string" ? payload.connection_method : null,
        })
      );
      onClose();
    } catch (error) {
      console.error("Failed to create camera:", error);
      setSubmitError(getErrorMessage(error, "Failed to create camera. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryTutorialWebcamProbe = async (submitAfterReady = false) => {
    setTutorialWebcamDecisionBusy(true);
    try {
      const probeResult = await runTutorialWebcamProbe({ autoApplyPreferredIndex: true });
      if (probeResult.status === "ready") {
        setShowTutorialNoWebcamDialog(false);
        if (submitAfterReady) {
          await submitNewCameraCreation({
            tutorialProceedWithoutWebcam: false,
            overrideWebcamIndex: probeResult.preferredIndex,
          });
        }
      }
    } finally {
      setTutorialWebcamDecisionBusy(false);
    }
  };

  const handleContinueWithoutTutorialWebcam = async () => {
    setTutorialWebcamDecisionBusy(true);
    try {
      setShowTutorialNoWebcamDialog(false);
      await submitNewCameraCreation({ tutorialProceedWithoutWebcam: true });
    } finally {
      setTutorialWebcamDecisionBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const errors: Record<string, boolean> = {};
    const requiredAddressFields = ["street", "number", "city", "state", "zip_code", "country"] as const;

    if (isEditing) {
      if (!camera || !editForm) {
        return;
      }

      if (!editForm.name.trim()) {
        errors.name = true;
      }

      requiredAddressFields.forEach((field) => {
        if (!editForm[field].trim()) {
          errors[field] = true;
        }
      });

      if (editForm.connection_method !== "WEBCAM") {
        const requiredRtspFields = [
          "ip_address",
          "rtsp_port",
          "manufacturer",
          "connection_method",
          "username",
          "password",
        ] as const;

        requiredRtspFields.forEach((field) => {
          if (!editForm[field].trim()) {
            errors[field] = true;
          }
        });
      }

      if (Object.keys(errors).length > 0) {
        setAddressErrors(errors);
        setIsAddressExpanded(true);
        const errorFields = Object.keys(errors).join(", ");
        setSubmitError(`Please fill in all required fields: ${errorFields}`);
        alert(`Validation failed. Missing required fields: ${errorFields}`);
        return;
      }

      setIsSubmitting(true);

      try {
        const finalDescription =
          descriptionLabel.trim() || descriptionText.trim()
            ? `LABEL: ${descriptionLabel.trim()} DESCRIPTION: ${descriptionText.trim()}`
            : null;

        let payload: Record<string, unknown>;

        if (editForm.connection_method === "WEBCAM") {
          payload = {
            name: editForm.name,
            connection_method: "WEBCAM",
            webcam_index: editForm.webcam_index,
            retention_days: editForm.retention_days,
            allowpublicaccess: editForm.allowpublicaccess,
            street: editForm.street,
            number: editForm.number,
            city: editForm.city,
            state: editForm.state,
            zip_code: editForm.zip_code,
            country: editForm.country,
            description: finalDescription,
          };
        } else {
          payload = {
            name: editForm.name,
            ip_address: editForm.ip_address,
            rtsp_port: normalizeOptionalField(editForm.rtsp_port),
            manufacturer: normalizeOptionalField(editForm.manufacturer),
            username: normalizeOptionalField(editForm.username),
            password: normalizeOptionalField(editForm.password),
            channel: normalizeOptionalField(editForm.channel),
            subtype: isSubtypeLockedForManufacturer(editForm.manufacturer)
              ? undefined
              : normalizeOptionalField(editForm.subtype),
            connection_method: editForm.connection_method,
            retention_days: editForm.retention_days,
            allowpublicaccess: editForm.allowpublicaccess,
            street: editForm.street,
            number: editForm.number,
            city: editForm.city,
            state: editForm.state,
            zip_code: editForm.zip_code,
            country: editForm.country,
            description: finalDescription,
          };
        }

        const response = await fetch(`/api/cameras/${camera.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response, "Failed to update camera"));
        }

        const responseData = await response.json().catch(() => null);
        await onSaved?.(
          getSavedCameraResult(responseData, {
            cameraId: camera.id,
            cameraName: typeof payload.name === "string" ? payload.name : camera.name,
            connectionMethod:
              typeof payload.connection_method === "string"
                ? payload.connection_method
                : camera.connection_method,
          })
        );
        onClose();
      } catch (error) {
        console.error("Failed to update camera:", error);
        setSubmitError(getErrorMessage(error, "Failed to save camera. Please try again."));
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    const currentFormData = activeTab === "WEBCAM" ? webcamForm : rtspForm;

    if (!currentFormData.name.trim()) {
      errors.name = true;
    }

    requiredAddressFields.forEach((field) => {
      if (!currentFormData[field].trim()) {
        errors[field] = true;
      }
    });

    if (activeTab === "WEBCAM") {
      if (webcamForm.webcam_index === null || webcamForm.webcam_index === undefined) {
        errors.webcam_index = true;
      }
    } else {
      const requiredRtspFields = [
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "connection_method",
        "username",
        "password",
      ] as const;

      requiredRtspFields.forEach((field) => {
        if (!rtspForm[field].trim()) {
          errors[field] = true;
        }
      });
    }

    if (Object.keys(errors).length > 0) {
      setAddressErrors(errors);
      setIsAddressExpanded(true);
      setSubmitError("Please fill in all required fields");
      return;
    }

    setAddressErrors({});
    if (activeTab === "WEBCAM" && isTutorialWebcamOnboardingStep) {
      const probeResult =
        tutorialWebcamProbe.status === "ready" ||
        tutorialWebcamProbe.status === "missing" ||
        tutorialWebcamProbe.status === "unknown"
          ? tutorialWebcamProbe
          : await runTutorialWebcamProbe({ autoApplyPreferredIndex: true });

      if (probeResult.status === "missing") {
        setShowTutorialNoWebcamDialog(true);
        return;
      }

      await submitNewCameraCreation({
        tutorialProceedWithoutWebcam: false,
        overrideWebcamIndex: probeResult.preferredIndex,
      });
      return;
    }

    await submitNewCameraCreation({ tutorialProceedWithoutWebcam: false });
  };

  const addressValidationCount = Object.keys(addressErrors).filter(
    (key) =>
      key !== "webcam_index" &&
      key !== "ip_address" &&
      key !== "rtsp_port" &&
      key !== "manufacturer" &&
      key !== "connection_method" &&
      key !== "username" &&
      key !== "password" &&
      key !== "name"
  ).length;
  const addressLookupMessageClassName =
    addressLookupState.status === "error"
      ? "text-red-400"
      : addressLookupState.status === "warning"
        ? "text-amber-300"
        : addressLookupState.status === "success"
          ? "text-emerald-300"
          : "text-gray-400";
  const tutorialWebcamProbeNotice =
    isTutorialWebcamOnboardingStep && activeTab === "WEBCAM"
      ? (() => {
          switch (tutorialWebcamProbe.status) {
            case "probing":
              return {
                className: "border-sky-400/20 bg-sky-500/10 text-sky-100",
                message: t("tutorial.cameraWebcamProbe.probing"),
              };
            case "ready":
              return {
                className: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
                message: t("tutorial.cameraWebcamProbe.ready", {
                  index:
                    typeof tutorialWebcamProbe.preferredIndex === "number"
                      ? tutorialWebcamProbe.preferredIndex
                      : webcamFields?.webcam_index ?? 0,
                }),
              };
            case "missing":
              return {
                className: "border-amber-400/20 bg-amber-500/10 text-amber-100",
                message: t("tutorial.cameraWebcamProbe.missing"),
              };
            case "unknown":
              return {
                className: "border-white/10 bg-white/5 text-slate-200",
                message: t("tutorial.cameraWebcamProbe.unknown"),
              };
            default:
              return null;
          }
        })()
      : null;

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
            <h2 className="text-lg md:text-xl font-bold text-gray-100">
              {isEditing ? "Edit Camera" : "Add New Camera"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex border-b border-gray-800 bg-gray-900">
            <button
              type="button"
              onClick={() => handleTabChange("IP_RTSP")}
              disabled={isEditing}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "IP_RTSP"
                  ? "text-blue-400 border-b-2 border-blue-400 bg-gray-800/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              } ${isEditing ? "cursor-not-allowed opacity-50" : ""}`}
            >
              IP / RTSP Camera
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("WEBCAM")}
              disabled={isEditing}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "WEBCAM"
                  ? "text-blue-400 border-b-2 border-blue-400 bg-gray-800/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"
              } ${isEditing ? "cursor-not-allowed opacity-50" : ""}`}
            >
              Webcam
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 md:p-6" autoComplete={isEditing ? "on" : "off"}>
            {submitError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                {submitError}
              </div>
            )}

            {Object.keys(addressErrors).length > 0 && (
              <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg text-yellow-400 text-sm">
                <div className="font-semibold mb-1">Please fix the following errors:</div>
                <ul className="list-disc list-inside text-xs">
                  {Object.keys(addressErrors).map((key) => (
                    <li key={key}>{key.replace(/_/g, " ")}: Required</li>
                  ))}
                </ul>
              </div>
            )}

            {activeTab === "WEBCAM" && (
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"
                data-onboarding-target={ONBOARDING_TARGETS.cameraEditorWebcamForm}
              >
                {tutorialWebcamProbeNotice ? (
                  <div
                    className={`md:col-span-2 rounded-lg border px-4 py-3 text-sm ${tutorialWebcamProbeNotice.className}`}
                  >
                    {tutorialWebcamProbeNotice.message}
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Camera Name *</label>
                  <input
                    type="text"
                    value={formData?.name || ""}
                    onChange={(e) => updateCurrentFormData({ name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., Front Entrance"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Webcam Index *</label>
                  <select
                    value={webcamFields?.webcam_index ?? ""}
                    onChange={(e) =>
                      updateCurrentFormData({
                        webcam_index: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.webcam_index ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  >
                    <option value="">Select webcam index...</option>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <option key={index} value={index}>
                        {index}
                      </option>
                    ))}
                  </select>
                  {addressErrors.webcam_index && (
                    <p className="text-red-400 text-xs mt-1">Webcam index is required</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "IP_RTSP" && (
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"
                data-onboarding-target={ONBOARDING_TARGETS.cameraEditorRtspForm}
              >
                {!isEditing && (
                  <div className="sr-only" aria-hidden="true">
                    <input type="text" name="username" autoComplete="username" tabIndex={-1} />
                    <input
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      tabIndex={-1}
                    />
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Camera Name *</label>
                  <input
                    type="text"
                    value={formData?.name || ""}
                    onChange={(e) => updateCurrentFormData({ name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g., Front Entrance"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">IP Address *</label>
                  <input
                    type="text"
                    name="camera_network_ip"
                    value={rtspFields?.ip_address || ""}
                    onChange={(e) => updateCurrentFormData({ ip_address: e.target.value })}
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-form-type="other"
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.ip_address ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    placeholder="192.168.1.100"
                  />
                  {addressErrors.ip_address && (
                    <p className="text-red-400 text-xs mt-1">IP Address is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">RTSP Port *</label>
                  <input
                    type="text"
                    name="camera_rtsp_port"
                    value={rtspFields?.rtsp_port || ""}
                    onChange={(e) => updateCurrentFormData({ rtsp_port: e.target.value })}
                    autoComplete="one-time-code"
                    data-lpignore="true"
                    data-form-type="other"
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.rtsp_port ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    placeholder="554"
                  />
                  {addressErrors.rtsp_port && (
                    <p className="text-red-400 text-xs mt-1">RTSP Port is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Manufacturer *</label>
                  <select
                    value={rtspFields?.manufacturer || ""}
                    onChange={(e) => {
                      const nextManufacturer = e.target.value;
                      updateCurrentFormData({
                        manufacturer: nextManufacturer,
                        ...(isSubtypeLockedForManufacturer(nextManufacturer) ? { subtype: "" } : {}),
                      });
                    }}
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.manufacturer ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  >
                    <option value="">Select...</option>
                    <option value="Hikvision">Hikvision</option>
                    <option value="Intelbras">Intelbras</option>
                    <option value="Axis">Axis</option>
                    <option value="Dahua">Dahua</option>
                    <option value="ONVIF">ONVIF</option>
                    <option value="Other">Other</option>
                  </select>
                  {addressErrors.manufacturer && (
                    <p className="text-red-400 text-xs mt-1">Manufacturer is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Connection Method *
                  </label>
                  <select
                    value={
                      rtspFields?.connection_method || "RTSP"
                    }
                    onChange={(e) =>
                      updateCurrentFormData({
                        connection_method: e.target.value as Exclude<CameraConnectionMethod, "WEBCAM">,
                      })
                    }
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.connection_method ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  >
                    <option value="RTSP">RTSP</option>
                    <option value="HTTP">HTTP</option>
                    <option value="ONVIF">ONVIF</option>
                  </select>
                  {addressErrors.connection_method && (
                    <p className="text-red-400 text-xs mt-1">Connection Method is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Channel</label>
                  <input
                    type="text"
                    value={rtspFields?.channel || ""}
                    onChange={(e) => updateCurrentFormData({ channel: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="1 or 201"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Subtype</label>
                  <input
                    type="text"
                    value={subtypeLocked ? "" : rtspFields?.subtype || ""}
                    onChange={(e) => updateCurrentFormData({ subtype: e.target.value })}
                    disabled={subtypeLocked}
                    className={`w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                      subtypeLocked ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                    placeholder={subtypeLocked ? "Locked for Hikvision" : "0, 1, 2..."}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Username *</label>
                  <input
                    type="text"
                    name={isEditing ? "username" : "camera_auth_username"}
                    value={rtspFields?.username || ""}
                    onChange={(e) => updateCurrentFormData({ username: e.target.value })}
                    autoComplete={isEditing ? "username" : "off"}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className={`w-full px-4 py-2.5 bg-gray-800 border ${
                      addressErrors.username ? "border-red-500" : "border-gray-700"
                    } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    placeholder="admin"
                  />
                  {addressErrors.username && (
                    <p className="text-red-400 text-xs mt-1">Username is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Password *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      name={isEditing ? "password" : "camera_auth_password"}
                      value={rtspFields?.password || ""}
                      onChange={(e) => updateCurrentFormData({ password: e.target.value })}
                      autoComplete={isEditing ? "current-password" : "new-password"}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      className={`w-full px-4 py-2.5 pr-12 bg-gray-800 border ${
                        addressErrors.password ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="********"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {addressErrors.password && (
                    <p className="text-red-400 text-xs mt-1">Password is required</p>
                  )}
                </div>
              </div>
            )}

            <div
              data-onboarding-target={ONBOARDING_TARGETS.cameraEditorAddress}
              className={`mb-6 border rounded-lg overflow-hidden transition-all ${
                Object.keys(addressErrors).length > 0 ? "border-red-500/50" : "border-gray-700"
              }`}
            >
              <button
                type="button"
                onClick={() => setIsAddressExpanded((current) => !current)}
                className="w-full px-4 py-3 bg-gray-800/50 hover:bg-gray-800 flex items-center justify-between transition-colors"
              >
                <span className="text-sm font-medium text-gray-300">
                  Address & Location *{" "}
                  {addressValidationCount > 0 && (
                    <span className="text-red-400 ml-2">(Required fields missing)</span>
                  )}
                </span>
                {isAddressExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {isAddressExpanded && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 animate-slide-down">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">ZIP Code *</label>
                    <input
                      type="text"
                      name="camera_location_zip"
                      value={formData?.zip_code || ""}
                      onChange={(e) => handleZipCodeChange(e.target.value)}
                      autoComplete="section-camera-location postal-code"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.zip_code ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="10001"
                    />
                    {addressErrors.zip_code && <p className="text-red-400 text-xs mt-1">Required</p>}
                    {addressLookupState.message && (
                      <p className={`text-xs mt-1 ${addressLookupMessageClassName}`}>
                        {addressLookupState.message}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">Street *</label>
                    <input
                      type="text"
                      name="camera_location_street"
                      value={formData?.street || ""}
                      onChange={(e) => updateCurrentFormData({ street: e.target.value })}
                      autoComplete="section-camera-location address-line1"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.street ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="e.g., Main Street"
                    />
                    {addressErrors.street && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Number *</label>
                    <input
                      type="text"
                      name="camera_location_number"
                      value={formData?.number || ""}
                      onChange={(e) => updateCurrentFormData({ number: e.target.value })}
                      autoComplete="section-camera-location address-line2"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.number ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="123"
                    />
                    {addressErrors.number && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">City *</label>
                    <input
                      type="text"
                      name="camera_location_city"
                      value={formData?.city || ""}
                      onChange={(e) => updateCurrentFormData({ city: e.target.value })}
                      autoComplete="section-camera-location address-level2"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.city ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="New York"
                    />
                    {addressErrors.city && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">State *</label>
                    <input
                      type="text"
                      name="camera_location_state"
                      value={formData?.state || ""}
                      onChange={(e) => updateCurrentFormData({ state: e.target.value })}
                      autoComplete="section-camera-location address-level1"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.state ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="NY"
                    />
                    {addressErrors.state && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Country *</label>
                    <input
                      type="text"
                      name="camera_location_country"
                      value={formData?.country || ""}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      autoComplete="section-camera-location country-name"
                      className={`w-full px-4 py-2.5 bg-gray-800 border ${
                        addressErrors.country ? "border-red-500" : "border-gray-700"
                      } rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                      placeholder="United States"
                    />
                    {addressErrors.country && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </div>
                </div>
              )}
            </div>

            {isEditing && (
              <div className="mb-6 pt-4 border-t border-gray-800">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">
                  {t("cameras.cameraDescription")}
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t("cameras.label")}
                    </label>
                    <select
                      value={descriptionLabel}
                      onChange={(e) => setDescriptionLabel(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      {CAMERA_LABEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t("cameras.description")}
                    </label>
                    <textarea
                      value={descriptionText}
                      onChange={(e) => setDescriptionText(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                      placeholder={t("cameras.descriptionPlaceholder")}
                      rows={3}
                      maxLength={1900}
                    />
                    <p className="text-xs text-gray-500 mt-1">{descriptionText.length}/1900 characters</p>
                  </div>
                </div>
              </div>
            )}

            <div
              className="mb-6 border-t border-gray-800 pt-4"
              data-onboarding-target={ONBOARDING_TARGETS.cameraEditorStorage}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className="relative inline-flex items-center opacity-75">
                      <div className="w-11 h-6 bg-blue-500 rounded-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:translate-x-full" />
                    </div>
                    <span className="text-sm font-medium text-gray-300">Store Frames for Past Search</span>
                  </div>
                  <p className="text-xs text-gray-500 ml-14">Required for timeline & past search</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t("cameras.retention")}
                  </label>
                  <select
                    value={formData?.retention_days || 1}
                    onChange={(e) =>
                      updateCurrentFormData({
                        retention_days: parseInt(e.target.value, 10) as RetentionDays,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    <option value={1}>1 day</option>
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value={15}>15 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                  </select>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-800 pt-4">
                <div className="md:col-span-2 flex flex-col gap-2">
                  <div className="space-y-3 rounded-2xl border border-gray-800 bg-gray-950/50 p-4">
                    <div>
                      <p className="text-sm font-medium text-gray-200">Shared Drakon Find Access</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Invite a Perceptrum user by @handle or email so they can use this camera in Drakon Find.
                      </p>
                    </div>

                    {camera ? (
                      <>
                        <div className="flex flex-col gap-3 md:flex-row">
                          <input
                            type="text"
                            value={shareLookupValue}
                            onChange={(event) => setShareLookupValue(event.target.value)}
                            placeholder="@nickname or email"
                            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => void handleCreateCameraShare()}
                            disabled={creatingCameraShare}
                            className="rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-700"
                          >
                            {creatingCameraShare ? "Inviting..." : "Invite"}
                          </button>
                        </div>

                        {shareError ? <p className="text-xs text-red-300">{shareError}</p> : null}

                        <div className="space-y-2">
                          {loadingCameraShares ? (
                            <p className="text-xs text-gray-400">Loading invitations...</p>
                          ) : cameraShares.length ? (
                            cameraShares.map((share) => (
                              <div
                                key={share.id}
                                className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3 md:flex-row md:items-center md:justify-between"
                              >
                                <div>
                                  <p className="text-sm text-gray-200 break-all">
                                    Invitee: {share.invitee_public_id}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    Status: {share.status}
                                    {share.accepted_at ? ` • accepted ${share.accepted_at}` : ""}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleRevokeCameraShare(share.id)}
                                  disabled={revokingShareId === share.id}
                                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {revokingShareId === share.id ? "Revoking..." : "Remove access"}
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-gray-400">
                              No shared Drakon Find invitations have been created for this camera yet.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">
                        Save the camera first to invite authorized users for Drakon Find.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="w-full md:w-auto px-5 py-3 md:py-2.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg font-medium transition-colors min-h-[44px] md:min-h-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                data-onboarding-target={ONBOARDING_TARGETS.cameraEditorSave}
                className="w-full md:w-auto px-5 py-3 md:py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 min-h-[44px] md:min-h-0 flex items-center justify-center gap-2"
              >
                {isSubmitting && (
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                )}
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Add Camera"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showTutorialNoWebcamDialog ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-100">
                {t("tutorial.cameraWebcamProbe.modalTitle")}
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-300">
                {t("tutorial.cameraWebcamProbe.modalDescription")}
              </p>
              {tutorialWebcamProbe.status === "missing" ? (
                <p className="mt-3 text-sm text-amber-100">
                  {t("tutorial.cameraWebcamProbe.missing")}
                </p>
              ) : null}
              {tutorialWebcamProbe.status === "unknown" ? (
                <p className="mt-3 text-sm text-slate-200">
                  {t("tutorial.cameraWebcamProbe.unknown")}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => void handleRetryTutorialWebcamProbe(true)}
                  disabled={tutorialWebcamDecisionBusy || isSubmitting}
                  className="w-full rounded-lg bg-blue-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-700"
                >
                  {tutorialWebcamDecisionBusy && tutorialWebcamProbe.status === "probing"
                    ? t("common.loading")
                    : t("tutorial.cameraWebcamProbe.connectAndRetry")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleContinueWithoutTutorialWebcam()}
                  disabled={tutorialWebcamDecisionBusy || isSubmitting}
                  className="w-full rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("tutorial.cameraWebcamProbe.continueWithout")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowTutorialNoWebcamDialog(false)}
                  disabled={tutorialWebcamDecisionBusy || isSubmitting}
                  className="w-full rounded-lg px-4 py-3 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("tutorial.cameraWebcamProbe.keepEditing")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}
