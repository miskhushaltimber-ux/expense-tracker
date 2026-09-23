import { apiClient } from "./config";

// Owner-only full-data backup (23 Sep) — downloads a JSON file of every
// record in this account. See backend/utils/backup.js.
export const downloadBackup = async () => {
  try {
    const res = await apiClient.get("/backup/download", { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error("Couldn't download the backup. Please try again.");
  }
};
