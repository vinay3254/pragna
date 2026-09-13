import { useContext } from "react";
import { ChatContext } from "../../context/ChatContext";
import { SUPPORTED_LANGUAGE_OPTIONS, normalizeLanguageCode } from "../../utils/language";

export default function LanguageSelector() {
  const { language, setLanguage } = useContext(ChatContext);

  return (
    <div className="group relative flex h-[36px] shrink-0 items-center rounded-lg transition-colors duration-150 hover:bg-[#1a1710]">
      <select
        className="h-[36px] cursor-pointer appearance-none rounded-lg border-none bg-transparent pl-3 pr-6 text-[12.5px] font-semibold transition-colors duration-150 group-hover:text-[var(--pragna-gold-soft)] focus:outline-none"
        style={{ color: "#d8cbb0", lineHeight: "36px" }}
        value={normalizeLanguageCode(language)}
        onChange={(e) => setLanguage(normalizeLanguageCode(e.target.value))}
        title="Language"
      >
        {SUPPORTED_LANGUAGE_OPTIONS.map((item) => (
          <option 
            key={item.code} 
            value={item.code} 
            style={{ backgroundColor: "#1e1e1e", color: "#ffffff" }}
          >
            {item.nativeName && item.nativeName !== item.label ? `${item.nativeName} (${item.label})` : item.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2 h-[10px] w-[10px] transition-colors duration-150 group-hover:text-[var(--pragna-gold-soft)]"
        style={{ color: "#c9bda2" }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}


