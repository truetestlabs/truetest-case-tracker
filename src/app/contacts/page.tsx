"use client";

import { useEffect, useState } from "react";

type ContactRow = {
  id: string;
  contactType: string;
  firstName: string;
  lastName: string;
  firmName: string | null;
  email: string | null;
  phone: string | null;
  _count: { caseContacts: number };
};

const contactTypeColors: Record<string, string> = {
  donor: "bg-purple-100 text-purple-700",
  attorney: "bg-blue-100 text-blue-700",
  gal: "bg-green-100 text-green-700",
  judge: "bg-red-100 text-red-700",
  court_clerk: "bg-gray-100 text-gray-700",
  mro: "bg-teal-100 text-teal-700",
  staff: "bg-indigo-100 text-indigo-700",
  other: "bg-gray-100 text-gray-600",
};

const CONTACT_TYPES = [
  { value: "attorney", label: "Attorney" },
  { value: "donor", label: "Donor" },
  { value: "gal", label: "GAL" },
  { value: "judge", label: "Judge" },
  { value: "court_clerk", label: "Court Clerk" },
  { value: "mro", label: "MRO" },
  { value: "staff", label: "Staff" },
  { value: "other", label: "Other" },
];

type FormData = {
  contactType: string;
  firstName: string;
  lastName: string;
  firmName: string;
  email: string;
  phone: string;
};

const emptyForm: FormData = { contactType: "attorney", firstName: "", lastName: "", firmName: "", email: "", phone: "" };

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  function loadContacts() {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (typeFilter) params.set("type", typeFilter);
    fetch(`/api/contacts?${params}`)
      .then((res) => res.json())
      .then((data) => { setContacts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    loadContacts();
    const interval = setInterval(loadContacts, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") loadContacts(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setModal("add");
  }

  function openEdit(c: ContactRow) {
    setForm({
      contactType: c.contactType,
      firstName: c.firstName,
      lastName: c.lastName,
      firmName: c.firmName || "",
      email: c.email || "",
      phone: c.phone || "",
    });
    setEditingId(c.id);
    setModal("edit");
  }

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) { alert("Name is required"); return; }
    setSaving(true);
    try {
      const url = modal === "edit" ? `/api/contacts/${editingId}` : "/api/contacts";
      const method = modal === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setModal(null); loadContacts(); }
      else { const d = await res.json(); alert(d.error || "Failed to save"); }
    } catch { alert("Failed to save"); }
    setSaving(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete contact "${name}"?\n\nThis will also remove them from any cases they're linked to.`)) return;
    const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    if (res.ok) loadContacts();
    else alert("Failed to delete contact");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="text-gray-500 mt-1">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2a5490 100%)" }}
        >
          + Add Contact
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <form onSubmit={(e) => { e.preventDefault(); loadContacts(); }} className="flex flex-wrap gap-3">
          <input type="text" placeholder="Search by name, firm, or email..." value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">All Types</option>
            {CONTACT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="submit" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Filter</button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {loading ? (
          <div className="px-6 py-12 text-center text-gray-400">Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <p className="text-lg">No contacts found</p>
            <p className="text-sm mt-1">Click &quot;+ Add Contact&quot; to create one</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th scope="col" className="px-6 py-3">Name</th>
                  <th scope="col" className="px-6 py-3">Type</th>
                  <th scope="col" className="px-6 py-3">Firm</th>
                  <th scope="col" className="px-6 py-3">Email</th>
                  <th scope="col" className="px-6 py-3">Phone</th>
                  <th scope="col" className="px-6 py-3">Cases</th>
                  <th scope="col" className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{c.lastName}, {c.firstName}</td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${contactTypeColors[c.contactType] || "bg-gray-100 text-gray-600"}`}>
                        {c.contactType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-600">{c.firmName || "—"}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-600">{c.email || "—"}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-600">{c.phone || "—"}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-600">{c._count.caseContacts}</td>
                    <td className="px-6 py-3.5 text-right">
                      <button onClick={() => openEdit(c)} className="text-xs text-blue-600 hover:text-blue-800 font-medium mr-3">Edit</button>
                      <button onClick={() => handleDelete(c.id, `${c.firstName} ${c.lastName}`)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setModal(null)} onKeyDown={(e) => { if (e.key === "Escape") setModal(null); }}>
          <div className="bg-white rounded-lg w-full max-w-md p-6" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">{modal === "add" ? "Add Contact" : "Edit Contact"}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.contactType} onChange={(e) => setForm({ ...form, contactType: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {CONTACT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input type="text" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input type="text" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Firm / Organization</label>
                <input type="text" value={form.firmName} onChange={(e) => setForm({ ...form, firmName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModal(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : modal === "add" ? "Add Contact" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
