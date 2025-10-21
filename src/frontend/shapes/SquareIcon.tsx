import React from 'react';

interface SquareIconProps {
  className?: string;
  color?: string;
}

export const SquareIcon: React.FC<SquareIconProps> = ({ className = '', color = '#9333ea' }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 24.55 22.075 19.88"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '50px', height: '50px' }}
    >
      <path
        d="M22.075 24.55H0v19.88h22.075V24.55z"
        fill={color}
      />
    </svg>
  );
};
