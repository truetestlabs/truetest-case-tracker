"use client";

/**
 * AccountSelect — searchable dropdown for picking a referring Account,
 * with an inline "+ Create new account" option that opens the shared
 * AccountFormModal and immediately selects the newly-created row.
 *
 * Used in the case intake form (Phase 3 Piece 4) and the case detail
 * edit flow, and available to anywhere else that needs to set a
 * Case.referringAccountId.
 *
 * Controlled: the parent owns the selectedId state. onChange fires with
 * the new id (or null if the user clears the selection).
 */
import { useEffect, useState } from "react";
import { AccountFormModal, type AccountDraft } from "./AccountFormModal";

type AccountOption = {
  id: string;
  name: string;
  shortCode: string | null;
  active: boolean;
  _count?: { cases: number };
};

type Props = {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function AccountSelect({
  value,
  onChange,
  placeholder = "Select referring account…",
  disabled = false,
}: Props) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const loadAccounts = () => {
    setLoading(true);
    fetch("/api/accounts?active=true")
      .then((r) => r.json())
      .then((data) => { setAccounts(data); setLoading(false); })
      .catch((e) => { console.error("[AccountSelect] load failed:", e); setLoading(false); });
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  // When the user creates a new account from the inline modal, add it to
  // the local options list (so the new row appears in the dropdown
  // without another round trip) and select it immediately.
  function handleCreated(saved: AccountDraft) {
    if (!saved.id) return;
    const newOption: AccountOption = {
      id: saved.id,
      name: saved.name,
      shortCode: saved.shortCode ?? null,
      active: saved.active ?? true,
      _count: { cases: 0 },
    };
    setAccounts((prev) => [...prev, newOption]);
    onChange(saved.id);
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === "__create__") {
      setCreateOpen(true);
      return;
    }
    onChange(v || null);
  }

  return (
    <>
      <select
        value={value ?? ""}
        onChange={handleSelectChange}
        disabled={disabled || loading}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:opacity-50"
      >
        <option value="">{loading ? "Loading accounts…" : placeholder}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}{a.shortCode ? ` (${a.shortCode})` : ""}
          </option>
        ))}
        <option value="" disabled>──────────</option>
        <option value="__create__">+ Create new account…</option>
      </select>

      <AccountFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleCreated}
      />
    </>
  );
}
