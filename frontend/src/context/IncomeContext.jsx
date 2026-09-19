import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import * as incomeApi from "../api/income";

// Action Types
const ACTIONS = {
  FETCH_REQUEST: "FETCH_REQUEST",
  FETCH_SUCCESS: "FETCH_SUCCESS",
  FETCH_FAILURE: "FETCH_FAILURE",
  ADD_INCOME: "ADD_INCOME",
  UPDATE_INCOME: "UPDATE_INCOME",
  DELETE_INCOME: "DELETE_INCOME",
  RESET: "RESET"
};

// Initial State
const initialState = {
  income: [],
  loading: false,
  error: null,
};

// Reducer Function
const incomeReducer = (state, action) => {
  switch (action.type) {
    case ACTIONS.FETCH_REQUEST:
      return { ...state, loading: true, error: null };
    case ACTIONS.FETCH_SUCCESS:
      return { ...state, loading: false, income: action.payload };
    case ACTIONS.FETCH_FAILURE:
      return { ...state, loading: false, error: action.payload };
    case ACTIONS.ADD_INCOME:
      return { ...state, income: [action.payload, ...state.income] };
    case ACTIONS.UPDATE_INCOME:
      return {
        ...state,
        income: state.income.map(item => 
          item._id === action.payload._id ? action.payload : item
        ),
      };
    case ACTIONS.DELETE_INCOME:
      return {
        ...state,
        income: state.income.filter((item) => item._id !== action.payload),
      };
    case ACTIONS.RESET:
      return initialState;
    default:
      return state;
  }
};

// Create Context
const IncomeContext = createContext(undefined);

// Provider Component
export const IncomeProvider = ({ children }) => {
  const [state, dispatch] = useReducer(incomeReducer, initialState);
  const { user } = useAuth();

  // Fetch Income when the component mounts or user changes
  useEffect(() => {
    if (user) {
      fetchIncome();
    } else {
      // Reset state when user logs out
      dispatch({ type: ACTIONS.RESET });
    }
  }, [user]);

  // Fetch Income for the logged-in user (identity comes from the JWT, server-side)
  const fetchIncome = useCallback(async () => {
    dispatch({ type: ACTIONS.FETCH_REQUEST });
    try {
      const income = await incomeApi.getIncome();
      dispatch({ type: ACTIONS.FETCH_SUCCESS, payload: income });
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || "Failed to fetch income";
      console.error("Error fetching income:", errorMessage);
      dispatch({ type: ACTIONS.FETCH_FAILURE, payload: errorMessage });
    }
  }, []);


  // Add new income
  const addIncome = useCallback(async (incomeData) => {
    if (!user) {
      dispatch({ type: ACTIONS.FETCH_FAILURE, payload: "User not authenticated" });
      return null;
    }

    try {
      const newIncome = await incomeApi.addIncome(incomeData);
      dispatch({ type: ACTIONS.ADD_INCOME, payload: newIncome });
      return newIncome;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || "Failed to add income";
      console.error("Error adding income:", errorMessage);
      dispatch({ type: ACTIONS.FETCH_FAILURE, payload: errorMessage });
      return null;
    }
  }, [user]);

  // Update income
  const updateIncome = useCallback(async (id, updatedData) => {
    try {
      const updated = await incomeApi.updateIncome(id, updatedData);
      dispatch({ type: ACTIONS.UPDATE_INCOME, payload: updated });
      return updated;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || "Failed to update income";
      console.error("Error updating income:", errorMessage);
      dispatch({ type: ACTIONS.FETCH_FAILURE, payload: errorMessage });
      return null;
    }
  }, []);

  // Delete income
  const deleteIncome = useCallback(async (id) => {
    try {
      await incomeApi.deleteIncome(id);
      dispatch({ type: ACTIONS.DELETE_INCOME, payload: id });
      return true;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || "Failed to delete income";
      console.error("Error deleting income:", errorMessage);
      dispatch({ type: ACTIONS.FETCH_FAILURE, payload: errorMessage });
      return false;
    }
  }, []);

  const value = {
    income: state.income,
    loading: state.loading,
    error: state.error,
    fetchIncome,
    addIncome,
    updateIncome,
    deleteIncome,
  };

  return (
    <IncomeContext.Provider value={value}>
      {children}
    </IncomeContext.Provider>
  );
};

// Custom Hook - Explicitly handle undefined context
export const useIncome = () => {
  const context = useContext(IncomeContext);
  if (context === undefined) {
    throw new Error("useIncome must be used within an IncomeProvider");
  }
  return context;
};