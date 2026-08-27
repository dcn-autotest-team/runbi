/**
 * TriggerCapsule - 28px Floating Trigger Micro-Icon
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React from 'react';

export interface TriggerCapsuleProps {
  top: number;
  left: number;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

export const TriggerCapsule: React.FC<TriggerCapsuleProps> = ({
  top,
  left,
  onClick,
  className = '',
}) => {
  return (
    <button
      id="runbi-trigger-capsule"
      type="button"
      aria-label="打开润笔面板"
      onClick={onClick}
      onMouseDown={(e) => {
        // Prevent clicking the capsule from deselecting text on the webpage
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        pointerEvents: 'auto',
      }}
      className={`absolute z-[2147483647] pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-[#00BFA5] text-white shadow-capsule hover:shadow-capsule-hover cursor-pointer transition-all duration-150 ease-out transform hover:scale-110 active:scale-95 animate-pop-in animate-pulse-glow select-none border border-teal-300/40 focus:outline-none ${className}`}
    >
      {/* Pen Tip Icon */}
      <svg
        className="w-4 h-4 text-white drop-shadow-sm transform -rotate-12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    </button>
  );
};

export default TriggerCapsule;
