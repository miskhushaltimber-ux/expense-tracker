// Fallback Master presets, mirrored from the backend's
// constants/categories.js. Used to populate the sheet's Master suggestions
// instantly; api/meta.js refreshes these from the server so the two stay in
// sync if the backend list changes. Free text is always allowed too — these
// are just suggestions, not a locked list.
export const DEFAULT_EXPENSE_MASTERS = [
  "Raw Timber Purchase",
  "Transport & Freight",
  "Labor Wages",
  "Loading & Unloading",
  "Sawmill & Machinery Maintenance",
  "Fuel & Diesel",
  "Service & Maintenance",
  "Tyre & Puncture",
  "Spare Parts",
  "Toll & Parking",
  "Vehicle Insurance Premium",
  "Permit & Fitness Fees",
  "Driver Wages",
  "Fines & Challans",
  "Vehicle Expenses",
  "Electricity Bill",
  "Rent",
  "GST & Taxes",
  "Packing Material",
  "Office & Stationery",
  "Miscellaneous",
];
