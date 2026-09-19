import { apiClient } from "./config";

// Contractors and the Labors under them — sprint 1 of Labor Wages (master
// data only, no wage/CFT entry yet). Same file-upload shape as vehicles.js.
const fileFields = { aadharFileObj: "aadharFile", panFileObj: "panFile", greenCardFileObj: "greenCardFile" };

const toFormData = (data) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (fileFields[key]) {
      if (value) formData.append(fileFields[key], value);
      return;
    }
    if (value !== undefined && value !== null) formData.append(key, value);
  });
  return formData;
};

const crud = (base, label) => ({
  fetch: async () => {
    try {
      const res = await apiClient.get(base);
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to fetch ${label}.`);
    }
  },
  add: async (data) => {
    try {
      const res = await apiClient.post(base, toFormData(data));
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to add ${label}.`);
    }
  },
  update: async (id, data) => {
    try {
      const res = await apiClient.put(`${base}/${id}`, toFormData(data));
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to update ${label}.`);
    }
  },
  remove: async (id) => {
    try {
      const res = await apiClient.delete(`${base}/${id}`);
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to delete ${label}.`);
    }
  },
});

// Mills, wage entries and payments carry no files — plain JSON, no
// multipart form data needed.
const jsonCrud = (base, label) => ({
  fetch: async () => {
    try {
      const res = await apiClient.get(base);
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to fetch ${label}.`);
    }
  },
  add: async (data) => {
    try {
      const res = await apiClient.post(base, data);
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to add ${label}.`);
    }
  },
  update: async (id, data) => {
    try {
      const res = await apiClient.put(`${base}/${id}`, data);
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to update ${label}.`);
    }
  },
  remove: async (id) => {
    try {
      const res = await apiClient.delete(`${base}/${id}`);
      return res.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || `Failed to delete ${label}.`);
    }
  },
});

const locations = jsonCrud("/labour/locations", "location");
const mills = jsonCrud("/labour/mills", "mill");
const contractors = crud("/labour/contractors", "contractor");
const labors = crud("/labour/labors", "labor");
const wageEntries = jsonCrud("/labour/wage-entries", "wage entry");
const payments = jsonCrud("/labour/payments", "payment");

export const fetchLocations = locations.fetch;
export const addLocation = locations.add;
export const updateLocation = locations.update;
export const deleteLocation = locations.remove;

export const fetchMills = mills.fetch;
export const addMill = mills.add;
export const updateMill = mills.update;
export const deleteMill = mills.remove;

export const fetchContractors = contractors.fetch;
export const addContractor = contractors.add;
export const updateContractor = contractors.update;
export const deleteContractor = contractors.remove;

export const fetchLabors = labors.fetch;
export const addLabor = labors.add;
export const updateLabor = labors.update;
export const deleteLabor = labors.remove;

export const fetchWageEntries = wageEntries.fetch;
export const addWageEntry = wageEntries.add;
export const updateWageEntry = wageEntries.update;
export const deleteWageEntry = wageEntries.remove;

export const fetchPayments = payments.fetch;
export const addPayment = payments.add;
export const updatePayment = payments.update;
export const deletePayment = payments.remove;

// Bulk add — used by the Work Log / Payments importer once rows are reviewed.
export const bulkAddWageEntries = async (rows) => {
  try {
    const res = await apiClient.post("/labour/wage-entries/bulk", { rows });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to add wage entries.");
  }
};

export const bulkAddPayments = async (rows) => {
  try {
    const res = await apiClient.post("/labour/payments/bulk", { rows });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to add payments.");
  }
};

// Bulk delete — one request for a whole selection, matching the "select
// rows, delete selected" feature the Expense Sheet already had (18 Sep, per
// Rishi: "add multi deletation in vehicle and labor wages page").
export const bulkDeleteWageEntries = async (ids) => {
  try {
    const res = await apiClient.post("/labour/wage-entries/bulk-delete", { ids });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to delete those entries.");
  }
};

export const bulkDeletePayments = async (ids) => {
  try {
    const res = await apiClient.post("/labour/payments/bulk-delete", { ids });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to delete those payments.");
  }
};
