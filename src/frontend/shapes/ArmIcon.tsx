import React from 'react';

interface ArmIconProps {
  className?: string;
  color?: string;
}

export const ArmIcon: React.FC<ArmIconProps> = ({ className = '', color = '#9333ea' }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="53.49 0 39.51 44.43"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d="M92.999 44.43L53.49 19.88V0L93 24.55v19.88z"
        fill={color}
      />
    </svg>
  );
};
