import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { FiUserPlus, FiTrash2, FiShield, FiUser, FiClock } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { fetchTeam, createStaff, removeStaff, fetchAuditLog } from "../../api/team";

// Team & Activity (19 Sep, multi-user accounts) — owner-only. Two things
// live here: who has a login under this account, and a chronological feed
// of who did what — the two gaps flagged as the app's biggest weaknesses
// ("one login = the whole company's data" and "no audit log"). Staff never
// sees this page: the route itself redirects them (below), and every
// underlying API call is also refused server-side regardless.
//
// Staff accounts are created here directly (name/email/password) rather
// than through an email invite flow — this is a small, known team, so the
// owner just hands the login to the person it's for. No self-serve public
// signup creates a staff account; /signup always creates a brand-new,
// separate company.
const emptyForm = () => ({ name: "", email: "", password: "" });

const roleBadge = (role) =>
  role === "owner" ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      <FiShield size={11} /> Owner
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
      <FiUser size={11} /> Staff
    </span>
  );

const actionVerb = { created: "added", updated: "updated", deleted: "deleted" };

const formatWhen = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

const Team = () => {
  const { user } = useAuth();
  const [team, setTeam] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [createdCreds, setCreatedCreds] = useState(null);

  const loadAll = async () => {
    try {
      const [teamData, logData] = await Promise.all([fetchTeam(), fetchAuditLog()]);
      setTeam(teamData);
      setLog(logData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // A staff login landing here directly (typed URL, old bookmark) is bounced
  // back to the dashboard — the real security boundary is the backend
  // rejecting every /api/team call, this is just so they don't see a page
  // full of errors instead.
  if (user && user.role !== "owner") {
    return <Navigate to="/dashboard" replace />;
  }

  const handleAdd = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) {
      setFormError("Fill in a name, email, and a password of at least 6 characters.");
      return;
    }
    setSaving(true);
    try {
      const created = await createStaff(form);
      setCreatedCreds({ email: created.email, password: form.password });
      setForm(emptyForm());
      await loadAll();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.name}'s login? They'll no longer be able to sign in.`)) return;
    try {
      await removeStaff(member.id);
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="p-4 sm:p-6 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Team &amp; Activity</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Everyone who can log in to this account, and a record of who did what — visible only to you.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {/* Team list + add-staff form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Logins on this account</h2>

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {team.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{member.name}</span>
                  {roleBadge(member.role)}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.email}</p>
              </div>
              {member.role !== "owner" && (
                <button
                  onClick={() => handleRemove(member)}
                  title={`Remove ${member.name}`}
                  className="shrink-0 text-gray-300 dark:text-gray-500 hover:text-red-600 p-1"
                >
                  <FiTrash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd} className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Add a staff login</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={saving}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={saving}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">Password</label>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                disabled={saving}
                placeholder="At least 6 characters"
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              <FiUserPlus size={14} />
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
          {formError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{formError}</p>}
        </form>

        {createdCreds && (
          <div className="bg-green-50 dark:bg-green-900/25 border border-green-200 dark:border-green-700 rounded-lg p-3 text-sm text-green-800 dark:text-green-300">
            Login created. Share these with them yourself — they won't be shown again here:
            <br />
            <span className="font-mono">{createdCreds.email}</span> / <span className="font-mono">{createdCreds.password}</span>
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500">
          Staff can log day-to-day entries on the Expense Sheet, Vehicle Expense Sheet and Labor Wages. Manage Data,
          budgets, and bulk-delete stay owner-only.
        </p>
      </div>

      {/* Activity log */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5 mb-3">
          <FiClock size={14} /> Recent activity
        </h2>
        <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[28rem] overflow-y-auto">
          {log.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 italic py-2">Nothing logged yet.</p>}
          {log.map((entry) => (
            <div key={entry.id} className="py-2 text-sm">
              <span className="font-medium text-gray-800 dark:text-gray-100">{entry.actorName || "Someone"}</span>{" "}
              <span className="text-gray-500 dark:text-gray-400">
                {actionVerb[entry.action] || entry.action} a {entry.entity}
                {entry.entityLabel ? ` — ${entry.entityLabel}` : ""}
              </span>
              <div className="text-xs text-gray-400 dark:text-gray-500">{formatWhen(entry.createdAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Team;
