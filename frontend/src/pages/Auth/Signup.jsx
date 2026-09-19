import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { APP_NAME } from '../../constants/brand';

const Signup = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setSignupError('');

    if (!name.trim() || !email.trim() || !password.trim()) {
      setSignupError("All fields are required.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await signup(name, email, password);
      if (response?.success) {
        navigate('/dashboard');
      } else {
        setSignupError(response?.message || "Signup failed. Please try again.");
      }
    } catch (error) {
      console.error('Signup error:', error);
      setSignupError(error?.message || 'Signup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 dark:bg-gray-800 py-8 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm"
      >
        <div className="text-center mb-4">
          <p className="text-blue-600 dark:text-blue-400 font-bold text-lg">{APP_NAME}</p>
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200">Create Your Account</h2>
        </div>

        {signupError && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded border border-red-200">
            {signupError}
          </div>
        )}

        <div className="mb-4">
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Name
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
        </div>

        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
        </div>

        <div className="mb-4">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full ${isLoading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} text-white py-2 px-4 rounded-md transition-colors`}
        >
          {isLoading ? 'Signing up...' : 'Sign Up'}
        </button>

        <div className="mt-4 text-center">
          <p>
            Already have an account? <Link to="/login" className="text-blue-600 dark:text-blue-400">Login</Link>
          </p>
        </div>
      </form>
    </div>
  );
};

export default Signup;
