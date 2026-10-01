import { apiClient } from "./config";

// Team management (19 Sep, multi-user accounts) — everything here is
// owner-only on the backend (see backend/routes/teamRoutes.js). A staff
// login calling any of these gets a 403 from the server; the Team page
// itself is also hidden from staff and redirects them away, so in practice
// these are only ever called by an owner.
export const fetchTeam = async () => {
  try {
    const res = await apiClient.get("/team");
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to fetch your team.");
  }
};

export const createStaff = async ({ name, email, password }) => {
  try {
    const res = await apiClient.post("/team/staff", { name, email, password });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to add that team member.");
  }
};

export const removeStaff = async (id) => {
  try {
    const res = await apiClient.delete(`/team/staff/${id}`);
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to remove that team member.");
  }
};

export const fetchAuditLog = async () => {
  try {
    const res = await apiClient.get("/team/audit-log");
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to fetch the activity log.");
  }
};

// 30 Sep, per Rishi: a bad Labor Wages import trashed his contractor data
// with no way back except finding the bad rows by hand. Reverses one
// activity-log entry — deletes what it created, restores what it deleted,
// or rolls back what it changed (only shown for entries the backend marked
// `undoable`; see backend/utils/auditLog.js).
export const undoAuditEntry = async (id) => {
  try {
    const res = await apiClient.post(`/team/audit-log/${id}/undo`);
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to undo that action.");
  }
};
