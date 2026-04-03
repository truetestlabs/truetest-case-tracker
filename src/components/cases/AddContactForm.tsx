"use client";

import { useState, useEffect, useRef } from "react";

type Props = {
  caseId: string;
  onAdded: () => void;
};

type ExistingContact = {
  id: string;
  contactType: string;
  firstName: string;
  lastName: string;
  firmName: string | null;
  email: string | null;
  phone: string | null;
  represents: string;
};

export function AddContactForm({ caseId, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Autocomplete state
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState<ExistingContact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedExisting, setSelectedExisting] = useState<ExistingContact | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Form field values (populated from autocomplete or manual entry)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [represents, setRepresents] = useState("na");

  // Search existing contacts as user types
  useEffect(() => {
    if (searchTerm.length < 2) { setSuggestions([]); return; }

    const timer = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(searchTerm)}`)
        .then((r) => r.json())
        .then((data) => {
          setSuggestions(data.slice(0, 8));
          setShowSuggestions(true);
        })
        .catch(() => {});
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectExistingContact(contact: ExistingContact) {
    setSelectedExisting(contact);
    setFirstName(contact.firstName);
    setLastName(contact.lastName);
    setFirmName(contact.firmName || "");
    setEmail(contact.email || "");
    setPhone(contact.phone || "");
    setRepresents(contact.represents || "na");
    setSearchTerm("");
    setShowSuggestions(false);
  }

  function clearSelection() {
    setSelectedExisting(null);
    setFirstName("");
    setLastName("");
    setFirmName("");
    setEmail("");
    setPhone("");
    setRepresents("na");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const roleInCase = form.get("roleInCase") as string || "other";

    const contactType = (() => {
      if (roleInCase.includes("attorney")) return "attorney";
      if (roleInCase === "gal") return "gal";
      if (roleInCase === "judge") return "judge";
      if (roleInCase === "court_clerk") return "court_clerk";
      return "other";
    })();

    const data: Record<string, unknown> = {
      roleInCase,
      receivesResults: form.get("receivesResults") === "on",
      receivesStatus: form.get("receivesStatus") === "on",
      receivesInvoices: form.get("receivesInvoices") === "on",
      canOrderTests: form.get("canOrderTests") === "on",
    };

    if (selectedExisting) {
      // Link existing contact to this case
      data.contactId = selectedExisting.id;
    } else {
      // Create new contact
      data.contactType = contactType;
      data.firstName = firstName;
      data.lastName = lastName;
      data.firmName = firmName || null;
      data.email = email || null;
      data.phone = phone || null;
      data.represents = represents;
    }

    try {
      const res = await fetch(`/api/cases/${caseId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add contact");
      }

      setOpen(false);
      clearSelection();
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        + Add Attorney, GAL, or Contact
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-gray-900">Add Contact to Case</h4>

      {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

      {/* Autocomplete search */}
      {!selectedExisting && (
        <div className="relative" ref={suggestionsRef}>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Search existing contacts or enter new
          </label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Start typing a name..."
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-[200px] overflow-y-auto">
              {suggestions.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => selectExistingContact(contact)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                >
                  <div className="text-sm font-medium text-gray-900">
                    {contact.firstName} {contact.lastName}
                    <span className="text-xs text-gray-400 ml-2 capitalize">{contact.contactType}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {contact.firmName && <span>{contact.firmName} · </span>}
                    {contact.email && <span>{contact.email} · </span>}
                    {contact.phone && <span>{contact.phone}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchTerm.length >= 2 && suggestions.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">No existing contacts found — fill in details below to create new</p>
          )}
        </div>
      )}

      {/* Selected existing contact banner */}
      {selectedExisting && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-900">
              {selectedExisting.firstName} {selectedExisting.lastName}
            </p>
            <p className="text-xs text-blue-600">
              Existing contact
              {selectedExisting.firmName && ` · ${selectedExisting.firmName}`}
              {selectedExisting.email && ` · ${selectedExisting.email}`}
            </p>
          </div>
          <button type="button" onClick={clearSelection} className="text-xs text-blue-500 hover:text-blue-700">
            Change
          </button>
        </div>
      )}

      {/* Role in this case */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Role in Case</label>
        <select name="roleInCase" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
          <option value="other">Unknown / Not specified</option>
          <option value="petitioner_attorney">Petitioner&apos;s Attorney</option>
          <option value="respondent_attorney">Respondent&apos;s Attorney</option>
          <option value="gal">Guardian ad Litem (GAL)</option>
          <option value="judge">Judge</option>
          <option value="referring_party">Referring Party</option>
          <option value="court_clerk">Court Clerk</option>
        </select>
      </div>

      {/* Contact details — only show if NOT using existing contact */}
      {!selectedExisting && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Firm Name</label>
            <input type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" placeholder="Law firm name" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Represents</label>
            <select value={represents} onChange={(e) => setRepresents(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
              <option value="na">N/A</option>
              <option value="petitioner">Petitioner</option>
              <option value="respondent">Respondent</option>
              <option value="child">Child</option>
              <option value="neutral">Neutral</option>
            </select>
          </div>
        </>
      )}

      {/* Distribution Settings */}
      <div className="border-t border-gray-200 pt-3 mt-3">
        <p className="text-xs font-semibold text-gray-700 mb-2">What should this contact receive?</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="receivesResults" defaultChecked className="rounded border-gray-300 text-blue-600" />
            <span className="text-gray-700">Receives test results</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="receivesStatus" defaultChecked className="rounded border-gray-300 text-blue-600" />
            <span className="text-gray-700">Receives status updates</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="receivesInvoices" className="rounded border-gray-300 text-blue-600" />
            <span className="text-gray-700">Receives invoices</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="canOrderTests" className="rounded border-gray-300 text-blue-600" />
            <span className="text-gray-700">Can order additional tests</span>
          </label>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2 pt-2">
        <button type="submit" disabled={loading} className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50">
          {loading ? "Adding..." : "Add to Case"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(""); clearSelection(); }} className="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
