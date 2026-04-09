import { useEffect, useMemo, useRef, useState } from "react";
import { isCameraServiceRunning } from "@/react-app/lib/cameraStatus";

export type CameraDirectoryTab = "online" | "offline";

type CameraDirectoryLetterKey =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

export type CameraDirectoryIndexKey = "all" | "0-9" | CameraDirectoryLetterKey;

type CameraDirectoryCamera = {
  name?: string | null;
  ip_address?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  is_service_running?: number | boolean | null;
};

type CameraDirectoryTabCounts = Record<CameraDirectoryTab, number>;
type CameraDirectoryIndexCounts = Record<CameraDirectoryIndexKey, number>;
type CameraDirectorySearchState = Record<CameraDirectoryTab, string>;
type CameraDirectoryIndexState = Record<CameraDirectoryTab, CameraDirectoryIndexKey>;

const LETTER_INDEX_KEYS: CameraDirectoryLetterKey[] = Array.from(
  { length: 26 },
  (_, index) => String.fromCharCode(65 + index) as CameraDirectoryLetterKey
);

export const CAMERA_DIRECTORY_INDEX_KEYS: CameraDirectoryIndexKey[] = [
  "all",
  "0-9",
  ...LETTER_INDEX_KEYS,
];

const cameraNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSearchValue(value: unknown): string {
  return stripDiacritics(String(value ?? "").trim().toLowerCase());
}

function createEmptyIndexCounts(): CameraDirectoryIndexCounts {
  return CAMERA_DIRECTORY_INDEX_KEYS.reduce(
    (counts, key) => {
      counts[key] = 0;
      return counts;
    },
    {} as CameraDirectoryIndexCounts
  );
}

function compareCamerasByName(
  left: Pick<CameraDirectoryCamera, "name" | "ip_address">,
  right: Pick<CameraDirectoryCamera, "name" | "ip_address">
): number {
  const nameResult = cameraNameCollator.compare(
    String(left.name ?? ""),
    String(right.name ?? "")
  );

  if (nameResult !== 0) {
    return nameResult;
  }

  return cameraNameCollator.compare(
    String(left.ip_address ?? ""),
    String(right.ip_address ?? "")
  );
}

function getCameraSearchHaystack(camera: CameraDirectoryCamera): string {
  return [
    camera.name,
    camera.ip_address,
    camera.manufacturer,
    camera.description,
  ]
    .map((value) => normalizeSearchValue(value))
    .filter(Boolean)
    .join(" ");
}

export function getCameraDirectoryTab(camera: CameraDirectoryCamera): CameraDirectoryTab {
  return isCameraServiceRunning(camera) ? "online" : "offline";
}

export function getCameraDirectoryIndexKey(
  cameraOrName: CameraDirectoryCamera | string | null | undefined
): Exclude<CameraDirectoryIndexKey, "all"> | null {
  const rawName =
    typeof cameraOrName === "string" || cameraOrName == null
      ? cameraOrName
      : cameraOrName.name;

  const normalizedName = stripDiacritics(String(rawName ?? "").trim()).toUpperCase();
  if (!normalizedName) {
    return null;
  }

  const firstCharacter = normalizedName.charAt(0);
  if (/^[0-9]$/.test(firstCharacter)) {
    return "0-9";
  }

  if (/^[A-Z]$/.test(firstCharacter)) {
    return firstCharacter as CameraDirectoryLetterKey;
  }

  return null;
}

export function useCameraDirectory<T extends CameraDirectoryCamera>(cameras: T[]) {
  const [activeTab, setActiveTab] = useState<CameraDirectoryTab>("online");
  const [searchByTab, setSearchByTab] = useState<CameraDirectorySearchState>(() => ({
    online: "",
    offline: "",
  }));
  const [indexByTab, setIndexByTab] = useState<CameraDirectoryIndexState>(() => ({
    online: "all",
    offline: "all",
  }));
  const hasAutoSelectedInitialTabRef = useRef(false);

  const camerasByTab = useMemo(() => {
    const grouped: Record<CameraDirectoryTab, T[]> = {
      online: [],
      offline: [],
    };

    for (const camera of cameras) {
      grouped[getCameraDirectoryTab(camera)].push(camera);
    }

    grouped.online.sort(compareCamerasByName);
    grouped.offline.sort(compareCamerasByName);

    return grouped;
  }, [cameras]);

  const tabCounts = useMemo<CameraDirectoryTabCounts>(
    () => ({
      online: camerasByTab.online.length,
      offline: camerasByTab.offline.length,
    }),
    [camerasByTab]
  );

  useEffect(() => {
    if (hasAutoSelectedInitialTabRef.current) {
      return;
    }

    if (tabCounts.online === 0 && tabCounts.offline === 0) {
      return;
    }

    if (tabCounts.online === 0 && tabCounts.offline > 0) {
      setActiveTab("offline");
    }

    hasAutoSelectedInitialTabRef.current = true;
  }, [tabCounts.offline, tabCounts.online]);

  const activeSearchTerm = searchByTab[activeTab];
  const activeIndexKey = indexByTab[activeTab];
  const activeTabCameras = camerasByTab[activeTab];

  const normalizedSearchTerm = useMemo(
    () => normalizeSearchValue(activeSearchTerm),
    [activeSearchTerm]
  );

  const activeIndexCounts = useMemo<CameraDirectoryIndexCounts>(() => {
    const counts = createEmptyIndexCounts();
    counts.all = activeTabCameras.length;

    for (const camera of activeTabCameras) {
      const indexKey = getCameraDirectoryIndexKey(camera);
      if (!indexKey) {
        continue;
      }

      counts[indexKey] += 1;
    }

    return counts;
  }, [activeTabCameras]);

  const searchMatchedCameras = useMemo(() => {
    if (!normalizedSearchTerm) {
      return activeTabCameras;
    }

    return activeTabCameras.filter((camera) =>
      getCameraSearchHaystack(camera).includes(normalizedSearchTerm)
    );
  }, [activeTabCameras, normalizedSearchTerm]);

  const filteredCameras = useMemo(() => {
    if (activeIndexKey === "all") {
      return searchMatchedCameras;
    }

    return searchMatchedCameras.filter(
      (camera) => getCameraDirectoryIndexKey(camera) === activeIndexKey
    );
  }, [activeIndexKey, searchMatchedCameras]);

  const setActiveSearchTerm = (value: string) => {
    setSearchByTab((current) => ({
      ...current,
      [activeTab]: value,
    }));
  };

  const setActiveIndexKey = (value: CameraDirectoryIndexKey) => {
    setIndexByTab((current) => ({
      ...current,
      [activeTab]: value,
    }));
  };

  return {
    activeTab,
    setActiveTab,
    activeSearchTerm,
    setActiveSearchTerm,
    activeIndexKey,
    setActiveIndexKey,
    activeIndexCounts,
    filteredCameras,
    totalCameraCount: cameras.length,
    activeTabCount: activeTabCameras.length,
    activeSearchCount: searchMatchedCameras.length,
    hasFiltersApplied: normalizedSearchTerm.length > 0 || activeIndexKey !== "all",
    tabCounts,
  };
}
