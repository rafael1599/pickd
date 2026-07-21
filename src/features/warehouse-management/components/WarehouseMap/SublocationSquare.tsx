import React from 'react';

interface SublocationSquareProps {
  id: string;
  name: string;
  status?: 'empty' | 'partial' | 'full';
  onClick?: () => void;
}

export const SublocationSquare: React.FC<SublocationSquareProps> = ({
  name,
  status = 'empty',
  onClick,
}) => {
  const statusColors = {
    empty: 'bg-white border-gray-200 text-gray-400',
    partial: 'bg-yellow-50 border-yellow-300 text-yellow-700',
    full: 'bg-green-50 border-green-400 text-green-700',
  };

  return (
    <div
      onClick={onClick}
      className={`
        w-16 h-16 flex items-center justify-center rounded-lg border-2 
        shadow-sm transition-all duration-200 cursor-pointer
        hover:scale-105 hover:shadow-md active:scale-95
        ${statusColors[status]}
      `}
      title={`Sublocation ${name} - ${status}`}
    >
      <span className="font-mono font-bold text-sm">{name}</span>
    </div>
  );
};
