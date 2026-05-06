import React from 'react';

/// Reusable components for loading and empty states across the app
export const LoadingState = ({ message = "Loading..." }) => (
  <div className="col-span-full py-20 text-center text-gray-500 font-medium">
    {message}
  </div>
);

// EmptyState used for wishlists, carts
export const EmptyState = ({ message = "Nothing to see here yet." }) => (
  <div className="col-span-full h-[60vh] flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl text-gray-400 italic">
    {message}
  </div>
);