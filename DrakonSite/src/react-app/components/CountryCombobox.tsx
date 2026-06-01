import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import type { Country } from "@/react-app/data/countries";
import { filterCountries, resolveCountryOption } from "@/react-app/lib/countrySelection";

const VIEWPORT_PADDING = 16;
const MENU_OFFSET = 12;
const MAX_MENU_HEIGHT = 320;

type CountryComboboxProps = {
  value: string;
  onChange: (countryName: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  ariaLabel?: string;
  name?: string;
  disabled?: boolean;
  buttonClassName: string;
  panelClassName: string;
  searchContainerClassName: string;
  searchInputClassName: string;
  optionClassName: (country: Country, isSelected: boolean) => string;
  selectedTextClassName?: string;
  placeholderTextClassName?: string;
  emptyStateClassName?: string;
};

export default function CountryCombobox({
  value,
  onChange,
  placeholder = "Select country",
  searchPlaceholder = "Search country...",
  emptyMessage = "No countries found",
  ariaLabel,
  name,
  disabled = false,
  buttonClassName,
  panelClassName,
  searchContainerClassName,
  searchInputClassName,
  optionClassName,
  selectedTextClassName = "text-white",
  placeholderTextClassName = "text-gray-500",
  emptyStateClassName = "px-4 py-6 text-center text-sm text-gray-400",
}: CountryComboboxProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const selectedCountryOption = useMemo(() => resolveCountryOption(value), [value]);
  const filteredCountryOptions = useMemo(() => filterCountries(searchValue), [searchValue]);

  useEffect(() => {
    if (!disabled) {
      return;
    }

    setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) {
      setSearchValue("");
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      return;
    }

    const updatePanelPosition = () => {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) {
        return;
      }

      const availableBelow =
        window.innerHeight - buttonRect.bottom - MENU_OFFSET - VIEWPORT_PADDING;
      const availableAbove = buttonRect.top - MENU_OFFSET - VIEWPORT_PADDING;
      const shouldOpenUpward = availableBelow < 280 && availableAbove > availableBelow;
      const width = Math.min(buttonRect.width, window.innerWidth - VIEWPORT_PADDING * 2);
      const left = Math.min(
        Math.max(VIEWPORT_PADDING, buttonRect.left),
        window.innerWidth - width - VIEWPORT_PADDING
      );
      const nextMaxHeight = Math.max(
        120,
        Math.min(
          MAX_MENU_HEIGHT,
          Math.floor(shouldOpenUpward ? availableAbove : availableBelow)
        )
      );

      setPanelStyle(
        shouldOpenUpward
          ? {
              left,
              width,
              maxHeight: nextMaxHeight,
              bottom: Math.max(VIEWPORT_PADDING, window.innerHeight - buttonRect.top + MENU_OFFSET),
            }
          : {
              left,
              width,
              maxHeight: nextMaxHeight,
              top: Math.max(VIEWPORT_PADDING, buttonRect.bottom + MENU_OFFSET),
            }
      );
    };

    updatePanelPosition();

    const frameId = window.requestAnimationFrame(updatePanelPosition);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [isOpen]);

  const displayedValue = selectedCountryOption?.name || value || placeholder;

  const handleSelect = (country: Country) => {
    onChange(country.name);
    setSearchValue("");
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        name={name}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={`${buttonClassName} flex items-center justify-between gap-3 text-left`}
      >
        <span
          className={`block min-w-0 flex-1 truncate ${
            value ? selectedTextClassName : placeholderTextClassName
          }`}
        >
          {displayedValue}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div ref={menuRef} className={`${panelClassName} flex flex-col`} style={panelStyle}>
              <div className={searchContainerClassName}>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder={searchPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    className={searchInputClassName}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredCountryOptions.map((country) => {
                  const isSelected = selectedCountryOption?.code === country.code;
                  return (
                    <button
                      key={country.code}
                      type="button"
                      onClick={() => handleSelect(country)}
                      className={optionClassName(country, isSelected)}
                    >
                      {country.name}
                    </button>
                  );
                })}
                {filteredCountryOptions.length === 0 ? (
                  <div className={emptyStateClassName}>{emptyMessage}</div>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
