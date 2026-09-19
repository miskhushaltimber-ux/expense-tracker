import { apiClient } from "./config";

const BASE_URL = "/vehicles";

// Builds multipart form data — vehicleData can include up to 3 File objects
// (rcFileObj/insuranceFileObj/permitFileObj), each optional.
const toFormData = (vehicleData) => {
  const formData = new FormData();
  const fileFields = {
    rcFileObj: "rcFile",
    insuranceFileObj: "insuranceFile",
    permitFileObj: "permitFile",
    plateFileObj: "plateFile",
  };

  Object.entries(vehicleData).forEach(([key, value]) => {
    if (fileFields[key]) {
      if (value) formData.append(fileFields[key], value);
      return;
    }
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  });
  return formData;
};

export const fetchVehicles = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching vehicles:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch vehicles.");
  }
};

export const addVehicle = async (vehicleData) => {
  try {
    const response = await apiClient.post(BASE_URL, toFormData(vehicleData));
    return response.data;
  } catch (error) {
    console.error("Error adding vehicle:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to add vehicle.");
  }
};

export const updateVehicle = async (vehicleId, vehicleData) => {
  try {
    const response = await apiClient.put(`${BASE_URL}/${vehicleId}`, toFormData(vehicleData));
    return response.data;
  } catch (error) {
    console.error("Error updating vehicle:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to update vehicle.");
  }
};

export const deleteVehicle = async (vehicleId) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${vehicleId}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting vehicle:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to delete vehicle.");
  }
};
