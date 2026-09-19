import React from 'react';

const AuthLayout = ({ children }) => {
  console.log("AuthLayout rendered");
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-800 flex justify-center">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
};

export default AuthLayout;


