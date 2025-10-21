import React from 'react';
import { ArmIcon } from '../shapes/ArmIcon';
import { SquareIcon } from '../shapes/SquareIcon';
import { motion } from 'framer-motion';

interface AnimatedLogoProps {
  className?: string;
  scale?: string;
  size?: 'small' | 'medium' | 'large';
  animate?: boolean;
  color?: string;
}

/**
 * Reusable animated Mira logo component with assembly animation
 * Plays the animation every time the component is mounted
 */
function AnimatedLogo({
  className = '',
  scale,
  size = 'large',
  animate = true,
  color = '#470088'
}: AnimatedLogoProps) {
  // Size configurations
  const sizeClasses = {
    small: 'scale-[0.15]',
    medium: 'scale-[0.35]',
    large: 'scale-45 sm:scale-50 md:scale-75 lg:scale-100'
  };

  const finalScale = scale || sizeClasses[size];

  // Animation variants
  const squareVariants = {
    hidden: { scale: 0, rotate: -180, opacity: 0 },
    visible: { scale: 1, rotate: 0, opacity: 1 }
  };

  const leftArmVariants = {
    hidden: { x: -100, y: -100, opacity: 0 },
    visible: { x: 0, y: 0, opacity: 1 }
  };

  const rightArmVariants = {
    hidden: { x: 100, y: 100, opacity: 0 },
    visible: { x: 0, y: 0, opacity: 1 }
  };

  return (
    <div className={`flex flex-row justify-center items-end gap-5.5 ${finalScale} ${className}`}>
      {/* Left Square - Rotates in from the left */}
      <motion.div
        className='-mr-10'
        variants={squareVariants}
        initial={animate ? "hidden" : "visible"}
        animate="visible"
        transition={{ duration: 0.7, ease: [0.9, 0.1, 0.3, 1], delay: 0.1 }}
      >
        <SquareIcon className='w-12 h-12' color={color} />
      </motion.div>

      {/* Left Arm - Slides in from top-left */}
      <motion.div
        className='-mr-10'
        variants={leftArmVariants}
        initial={animate ? "hidden" : "visible"}
        animate="visible"
        transition={{ duration: 0.8, ease: [0.9, 0.1, 0.3, 1], delay: 0 }}
      >
        <ArmIcon className='w-24 h-24' color={color} />
      </motion.div>

      {/* Right Arm - Slides in from bottom-right */}
      <motion.div
        variants={rightArmVariants}
        initial={animate ? "hidden" : "visible"}
        animate="visible"
        transition={{ duration: 0.8, ease: [0.9, 0.1, 0.3, 1], delay: 0 }}
      >
        <ArmIcon className='w-24 h-24' color={color} />
      </motion.div>
    </div>
  );
}

export default AnimatedLogo;
