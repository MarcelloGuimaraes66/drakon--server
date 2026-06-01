// Localization.h
#pragma once

#include <string>
#include <algorithm>

// Supported languages
enum class Lang {
    EN, // English
    PT, // Portuguese
    ES, // Spanish
    FR, // French
    AR, // Arabic
    ZH  // Chinese (Simplified)
};

// Helper: lowercase a string
inline std::string toLowerCopy(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

// Optional helper: map locale string ("pt-BR", "es", "fr-FR", "ar", "zh-CN") to Lang
inline Lang langFromLocale(const std::string& locale) {
    std::string lc = toLowerCopy(locale);

    if (lc.rfind("pt", 0) == 0) {        // "pt", "pt-br", ...
        return Lang::PT;
    }
    else if (lc.rfind("es", 0) == 0) { // "es", "es-es", ...
        return Lang::ES;
    }
    else if (lc.rfind("fr", 0) == 0) { // "fr", ...
        return Lang::FR;
    }
    else if (lc.rfind("ar", 0) == 0) { // "ar", ...
        return Lang::AR;
    }
    else if (lc.rfind("zh", 0) == 0) { // "zh", "zh-cn", ...
        return Lang::ZH;
    }

    // Default fallback
    return Lang::EN;
}

// Main function: builds the "no frames" message in the chosen language
inline std::string makeNoFramesMessage(
    Lang lang,
    const std::string& startTs,
    const std::string& endTs,
    const std::string& cameraNamesStr
) {
    switch (lang) {
    case Lang::PT:
        // Portuguese (Brazil-friendly)
        return "Nenhuma imagem gravada entre " + startTs + " e " + endTs +
            " para " + cameraNamesStr +
            ". Tente outro intervalo de tempo.";

    case Lang::ES:
        // Spanish
        return "No se registraron imágenes entre " + startTs + " y " + endTs +
            " para " + cameraNamesStr +
            ". Intente con otro intervalo de tiempo.";

    case Lang::FR:
        // French
        return "Aucune image enregistrée entre " + startTs + " et " + endTs +
            " pour " + cameraNamesStr +
            ". Veuillez essayer un autre intervalle de temps.";

    case Lang::AR:
        // Arabic (Modern Standard), keep placeholders as-is
        // Note: source file should be saved as UTF-8.
        return "لا توجد صور مسجَّلة بين " + startTs + " و" + endTs +
            " لـ " + cameraNamesStr +
            ". يُرجى تجربة نطاق زمني آخر.";

    case Lang::ZH:
        // Chinese (Simplified)
        return "在 " + startTs + " 到 " + endTs +
            " 之间，没有为 " + cameraNamesStr +
            " 记录到任何图像。请尝试其他时间范围。";

    case Lang::EN:
    default:
        // English (original)
        return "No images recorded between " + startTs + " and " + endTs +
            " for " + cameraNamesStr +
            ". Please try a different time window.";
    }
}
