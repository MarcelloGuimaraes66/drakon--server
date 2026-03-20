import { branding as generatedBranding } from "@/shared/generated/brand.generated";

type BrandId = "drakon" | "perceptrum";
type BrandFeatures = {
  billingEnabled: boolean;
  drakonFindEnabled: boolean;
  googleLoginEnabled: boolean;
};
type RuntimeBrandConfig = Omit<typeof generatedBranding.brand, "id" | "features"> & {
  id: BrandId;
  features: BrandFeatures;
};

const branding = generatedBranding;
const SORTED_BRAND_TOKENS = [...branding.knownBrandNames].sort((a, b) => b.length - a.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceBrandTokenCaseSensitive(input: string): string {
  let output = input;
  for (const token of SORTED_BRAND_TOKENS) {
    output = output.replace(new RegExp(escapeRegExp(token), "g"), branding.brand.displayName);
    output = output.replace(
      new RegExp(escapeRegExp(token.toLowerCase()), "g"),
      branding.brand.displayName.toLowerCase()
    );
  }
  return output;
}

export const brand: RuntimeBrandConfig = branding.brand;
export const isBillingEnabled = brand.features.billingEnabled;

type BrandStorageKey = keyof typeof branding.brand.storageKeys | "globalUltraModelFps";

const fallbackStorageKeys: Partial<Record<BrandStorageKey, string>> = {
  globalUltraModelFps: `${branding.brand.id}_global_ultra_model_fps`,
};

export function getBrandStorageKey(
  key: BrandStorageKey
): string {
  return (
    branding.brand.storageKeys[key as keyof typeof branding.brand.storageKeys] ||
    fallbackStorageKeys[key] ||
    String(key)
  );
}

export function getBrandWindowEventName(
  key: keyof typeof branding.brand.windowEvents
): string {
  return branding.brand.windowEvents[key];
}

export function replaceKnownBrandTokens(input: string): string {
  return replaceBrandTokenCaseSensitive(input);
}

export function deepReplaceKnownBrandTokens<T>(value: T): T {
  if (typeof value === "string") {
    return replaceKnownBrandTokens(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceKnownBrandTokens(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        deepReplaceKnownBrandTokens(nestedValue),
      ])
    ) as T;
  }

  return value;
}

type MinimalDocument = {
  title?: string;
  querySelector: (selector: string) => {
    setAttribute: (name: string, value: string) => void;
  } | null;
};

function getDocument(): MinimalDocument | null {
  if (typeof globalThis === "undefined" || !("document" in globalThis)) {
    return null;
  }
  return (globalThis as { document?: MinimalDocument }).document || null;
}

function setMeta(selector: string, content: string) {
  const doc = getDocument();
  if (!doc) return;
  const element = doc.querySelector(selector);
  if (element) {
    element.setAttribute("content", content);
  }
}

function setLink(selector: string, href: string | null) {
  const doc = getDocument();
  if (!doc || !href) return;
  const element = doc.querySelector(selector);
  if (element) {
    element.setAttribute("href", href);
  }
}

export function applyBrandMetadataToDocument(): void {
  const doc = getDocument();
  if (!doc) return;

  doc.title = brand.siteTitle;
  setMeta('meta[property="og:url"]', brand.siteUrl);
  setMeta('meta[property="og:title"]', brand.marketingTitle);
  setMeta('meta[property="og:description"]', brand.siteDescription);
  setMeta('meta[name="twitter:title"]', brand.marketingTitle);
  setMeta('meta[name="twitter:description"]', brand.siteDescription);
  setLink('link[rel="icon"][sizes="any"]', brand.assets.faviconPath);
  setLink('link[rel="icon"][type="image/png"]', brand.assets.faviconPngPath);
  setLink('link[rel="apple-touch-icon"]', brand.assets.appleTouchIconPath);
}
