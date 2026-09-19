import React, { createContext, useContext, useReducer, useEffect } from "react";
import { useAuth } from "./AuthContext";
import * as expenseApi from "../api/expenses";

// Initial State
const initialState = {
  expenses: [],
  loading: false,
  error: null,
};

// Action Types
const ACTIONS = {
  FETCH_REQUEST: "FETCH_REQUEST",
  FETCH_SUCCESS: "FETCH_SUCCESS",
  FETCH_FAILURE: "FETCH_FAILURE",
  ADD_EXPENSE: "ADD_EXPENSE",
  DELETE_EXPENSE: "DELETE_EXPENSE",
};

// Reducer Function
const expenseReducer = (state, action) => {
  switch (action.type) {
    case ACTIONS.FETCH_REQUEST:
      return { ...state, loading: true, error: null };
    case ACTIONS.FETCH_SUCCESS:
      return { ...state, loading: false, expenses: action.payload };
    case ACTIONS.FETCH_FAILURE:
      return { ...state, loading: false, error: action.payload };
    case ACTIONS.ADD_EXPENSE:
      return { ...state, expenses: [action.payload, ...state.expenses] };
    case ACTIONS.DELETE_EXPENSE:
      return {
        ...state,
        expenses: state.expenses.filter((expense) => expense._id !== action.payload),
      };
    default:
      return state;
  }
};

// Create Context
const ExpenseContext = createContext();

// Provider Component
export const ExpenseProvider = ({ children }) => {
  const [state, dispatch] = useReducer(expenseReducer, initialState);
  const { user } = useAuth(); // Get logged-in user from AuthContext

  // Fetch Expenses when the component mounts or user changes
  useEffect(() => {
    if (user) {
      fetchExpenses();
    }
  }, [user]);

  // Fetch Expenses for the logged-in user (identity comes from the JWT, server-side)
  const fetchExpenses = async () => {
    dispatch({ type: ACTIONS.FETCH_REQUEST });
    try {
      const expenses = await expenseApi.fetchExpenses();
      dispatch({ type: ACTIONS.FETCH_SUCCESS, payload: expenses });
    } catch (error) {
      dispatch({ type: ACTIONS.FETCH_FAILURE, payload: error.message });
    }
  };

  return (
    <ExpenseContext.Provider value={{ ...state, fetchExpenses }}>
      {children}
    </ExpenseContext.Provider>
  );
};

// Custom Hook
export const useExpenses = () => useContext(ExpenseContext);
