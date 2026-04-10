"use client";

import { useState, useEffect, useRef } from "react";

type ContactResult = {
  name: string;
  firm: string;
  email: string;
  phone: string;
  contactId?: string;
  role?: string;
};

type Props = {
  type: "attorney" | "gal";
  label: string;
  value: ContactResult | null;
  onChange: (contact: ContactResult | null) => void;
};

export function AttorneySearch({ label, value, onChange }: Props) {
  const [query, setQuery] = useState(value?.name || "");
  const [results, setResults] = useState<ContactResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setResults([]); setShowDropdown(false); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        // Search across both attorney and gal — the same person may play either role across cases
        const res = await fetch(`/api/contacts?type=attorney,gal&q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          const mapped = (data || []).slice(0, 8).map((c: { id: string; firstName: string; lastName: string; firmName?: string; email?: string; phone?: string; contactType?: string }) => ({
            name: `${c.firstName} ${c.lastName}`,
            firm: c.firmName || "",
            email: c.email || "",
            phone: c.phone || "",
            contactId: c.id,
            role: c.contactType,
          }));
          setResults(mapped);
          setShowDropdown(mapped.length > 0);
        }
      } catch { /* silent */ }
    }, 300);
  }, [query]);

  if (value && !showManual) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">{value.name}</p>
            {value.firm && <p className="text-sm text-gray-600">{value.firm}</p>}
            {value.email && <p className="text-sm text-gray-500">{value.email}</p>}
            {value.phone && <p className="text-sm text-gray-500">{value.phone}</p>}
          </div>
          <button
            onClick={() => { onChange(null); setQuery(""); setShowManual(false); }}
            className="text-sm text-red-500 hover:text-red-700 font-medium"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  if (showManual) {
    const canSave = manualFirstName.trim() && manualLastName.trim();
    return (
      <div className="space-y-3 bg-gray-50 rounded-xl p-4">
        <p className="text-sm font-medium text-gray-600">Enter {label} info manually:</p>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="First Name"
            value={manualFirstName}
            onChange={(e) => setManualFirstName(e.target.value)}
            className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#7AB928]"
          />
          <input
            type="text"
            placeholder="Last Name"
            value={manualLastName}
            onChange={(e) => setManualLastName(e.target.value)}
            className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#7AB928]"
          />
        </div>
        <input
          type="email"
          placeholder="Email"
          value={manualEmail}
          onChange={(e) => setManualEmail(e.target.value)}
          className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#7AB928]"
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (canSave) {
                onChange({
                  name: `${manualFirstName.trim()} ${manualLastName.trim()}`,
                  firm: "",
                  email: manualEmail.trim(),
                  phone: "",
                });
                setShowManual(false);
              }
            }}
            disabled={!canSave}
            className="px-4 py-2 bg-[#7AB928] text-white rounded-lg text-sm font-semibold disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => {
              setShowManual(false);
              setManualFirstName("");
              setManualLastName("");
              setManualEmail("");
            }}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const hasSearched = query.trim().length >= 2;
  const noResults = hasSearched && results.length === 0;

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={`Search for ${label.toLowerCase()} by name...`}
        className="w-full text-lg p-4 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#7AB928]"
        autoComplete="off"
      />

      {showDropdown && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-64 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(r); setQuery(r.name); setShowDropdown(false); }}
              className="w-full text-left px-4 py-3 hover:bg-green-50 transition-colors border-b border-gray-100 last:border-0"
            >
              <p className="font-semibold text-gray-900">{r.name}</p>
              {r.firm && <p className="text-sm text-gray-500">{r.firm}</p>}
            </button>
          ))}
        </div>
      )}

      {/* No-match banner — prominent manual entry prompt */}
      {noResults && (
        <div className="mt-3 bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-900 font-semibold mb-2">No matches found for &ldquo;{query}&rdquo;</p>
          <p className="text-sm text-amber-800 mb-3">Enter the {label.toLowerCase()}&apos;s info manually below.</p>
          <button
            onClick={() => {
              // Pre-fill first name from query if possible
              const parts = query.trim().split(" ");
              if (parts.length >= 2) {
                setManualFirstName(parts[0]);
                setManualLastName(parts.slice(1).join(" "));
              } else {
                setManualFirstName(query.trim());
              }
              setShowManual(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#7AB928] text-white rounded-lg text-sm font-bold hover:bg-[#6aa322]"
          >
            Enter {label} Manually
          </button>
        </div>
      )}

      <button
        onClick={() => setShowManual(true)}
        className="mt-2 text-sm text-[#7AB928] hover:text-[#6aa322] font-medium underline"
      >
        Or enter manually anyway
      </button>
    </div>
  );
}
