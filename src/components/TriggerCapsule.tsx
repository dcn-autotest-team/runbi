/**
 * TriggerCapsule - browser selection trigger
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
      className={`runbi-trigger-capsule absolute z-[2147483647] pointer-events-auto flex h-8 w-8 items-center justify-center rounded-[10px] cursor-pointer select-none focus:outline-none animate-pop-in ${className}`}
    >
      {/* Pen Tip Icon */}
      <svg
        className="h-[17px] w-[17px] text-[#0f766e]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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
