"use client";

/**
 * Shared create/edit modal for Account records. Reused by:
 *   - Accounts list page "+ New Account" button
 *   - Account detail page "Edit" button
 *   - (Phase 3 Piece 4) Case intake form's inline "+ Create new account"
 *
 * Pass `account={...}` to edit an existing row, or omit it to create.
 * `onSaved(account)` fires with the created/updated row so callers can
 * select it immediately (important for the inline-create-on-intake flow).
 */
import { useState, useEffect } from "react";
import { apiError } from "@/lib/clientErrors";

export type AccountDraft = {
  id?: string;
  name: string;
  shortCode?: string | null;
  type?: string | null;
  primaryContactId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  invoiceGrouping?: string | null;
  active?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (account: AccountDraft) => void;
  account?: AccountDraft; // undefined = create mode
};

const ACCOUNT_TYPES = [
  { value: "law_firm", label: "Law Firm" },
  { value: "counseling_practice", label: "Counseling Practice" },
  { value: "evaluator_office", label: "Evaluator Office" },
  { value: "court", label: "Court" },
  { value: "state_agency", label: "State Agency" },
  { value: "other", label: "Other" },
];

const INVOICE_GROUPINGS = [
  { value: "per_case", label: "Invoice per case (default)" },
  { value: "consolidated", label: "Consolidated monthly invoice" },
];

export function AccountFormModal({ open, onClose, onSaved, account }: Props) {
  const isEdit = !!account?.id;
  const [form, setForm] = useState<AccountDraft>({
    name: "",
    shortCode: "",
    type: "other",
    address: "",
    phone: "",
    email: "",
    website: "",
    notes: "",
    invoiceGrouping: "per_case",
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  // Reset form whenever the modal opens with a different account (edit mode)
  // or closes and reopens (create mode).
  useEffect(() => {
    if (!open) return;
    if (account) {
      setForm({
        id: account.id,
        name: account.name ?? "",
        shortCode: account.shortCode ?? "",
        type: account.type ?? "other",
        address: account.address ?? "",
        phone: account.phone ?? "",
        email: account.email ?? "",
        website: account.website ?? "",
        notes: account.notes ?? "",
        invoiceGrouping: account.invoiceGrouping ?? "per_case",
        active: account.active ?? true,
      });
    } else {
      setForm({
        name: "",
        shortCode: "",
        type: "other",
        address: "",
        phone: "",
        email: "",
        website: "",
        notes: "",
        invoiceGrouping: "per_case",
        active: true,
      });
    }
    setError("");
  }, [open, account]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const url = isEdit ? `/api/accounts/${account!.id}` : "/api/accounts";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          shortCode: form.shortCode?.trim() || null,
          type: form.type,
          address: form.address?.trim() || null,
          phone: form.phone?.trim() || null,
          email: form.email?.trim() || null,
          website: form.website?.trim() || null,
          notes: form.notes?.trim() || null,
          invoiceGrouping: form.invoiceGrouping,
          active: form.active,
        }),
      });
      if (!res.ok) throw await apiError(res, `Failed to ${isEdit ? "update" : "create"} account`);
      const saved = await res.json();
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEdit ? "Edit Account" : "New Account"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Name <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Associates in Human Development Counseling"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Short code
              </label>
              <input
                type="text"
                value={form.shortCode ?? ""}
                onChange={(e) => setForm({ ...form, shortCode: e.target.value })}
                placeholder="AHDC"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Type
              </label>
              <select
                value={form.type ?? "other"}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Website</label>
            <input
              type="url"
              value={form.website ?? ""}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
            <input
              type="text"
              value={form.address ?? ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Invoice grouping
            </label>
            <select
              value={form.invoiceGrouping ?? "per_case"}
              onChange={(e) => setForm({ ...form, invoiceGrouping: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {INVOICE_GROUPINGS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Preference only — invoicing logic isn&apos;t built yet. Reserved for future use.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active ?? true}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="rounded border-slate-300"
              />
              Active
            </label>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
