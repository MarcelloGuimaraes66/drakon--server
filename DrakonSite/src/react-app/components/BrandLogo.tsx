import { brand } from "@/shared/brand";

type BrandLogoProps = {
  theme: "dark" | "light";
  variant: "full" | "icon";
  surface?: "default" | "login";
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
  textClassName?: string;
};

function getThemedAssetPath(
  theme: "dark" | "light",
  kind: "wordmark" | "icon",
  surface: "default" | "login"
): string | null {
  if (kind === "wordmark") {
    if (surface === "login") {
      return theme === "light"
        ? brand.assets.loginWordmarkLightPath ?? brand.assets.wordmarkLightPath
        : brand.assets.loginWordmarkDarkPath ?? brand.assets.wordmarkDarkPath;
    }
    return theme === "light" ? brand.assets.wordmarkLightPath : brand.assets.wordmarkDarkPath;
  }
  return theme === "light" ? brand.assets.iconLightPath : brand.assets.iconDarkPath;
}

export default function BrandLogo({
  theme,
  variant,
  surface = "default",
  className = "",
  imageClassName = "",
  iconClassName = "",
  textClassName = "",
}: BrandLogoProps) {
  const iconPath = getThemedAssetPath(theme, "icon", surface);
  const wordmarkPath = getThemedAssetPath(theme, "wordmark", surface);

  if (variant === "icon") {
    if (!iconPath) return null;
    return (
      <img
        src={iconPath}
        alt={`${brand.displayName} icon`}
        className={iconClassName}
      />
    );
  }

  if (wordmarkPath) {
    return (
      <img
        src={wordmarkPath}
        alt={`${brand.displayName} logo`}
        className={imageClassName}
      />
    );
  }

  return (
    <div className={className}>
      {iconPath ? (
        <img
          src={iconPath}
          alt={`${brand.displayName} icon`}
          className={iconClassName}
        />
      ) : null}
      <span className={textClassName}>{brand.displayName}</span>
    </div>
  );
}
