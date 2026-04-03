"use client";

import Link from "next/link";
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

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

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

  useEffect(() => { loadContacts(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="text-gray-500 mt-1">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <form onSubmit={(e) => { e.preventDefault(); loadContacts(); }} className="flex flex-wrap gap-3">
          <input type="text" placeholder="Search by name, firm, or email..." value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">All Types</option>
            <option value="donor">Donors</option>
            <option value="attorney">Attorneys</option>
            <option value="gal">GALs</option>
            <option value="judge">Judges</option>
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
            <p className="text-sm mt-1">Contacts are created automatically when you create a case</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Firm</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Phone</th>
                  <th className="px-6 py-3">Cases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{contact.lastName}, {contact.firstName}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${contactTypeColors[contact.contactType] || "bg-gray-100 text-gray-600"}`}>
                        {contact.contactType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{contact.firmName || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{contact.email || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{contact.phone || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{contact._count.caseContacts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
