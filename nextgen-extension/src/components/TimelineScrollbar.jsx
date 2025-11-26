/**
 * @fileoverview Timeline Scrollbar Component (Google Photos style)
 * Shows a minimal vertical scrollbar with date markers for quick navigation
 */

import React, { useState, useEffect, useRef } from 'react';

/**
 * TimelineScrollbar - A minimal vertical timeline with date markers
 * @param {Array} dateGroups - Array of {date, label, element} objects representing date sections
 * @param {Object} containerRef - Ref to the scrollable container
 */
export default function TimelineScrollbar({ dateGroups, containerRef }) {
  const [isDragging, setIsDragging] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const scrollbarRef = useRef(null);

  // Update scroll percentage when user scrolls
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef?.current) return;
      
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const maxScroll = scrollHeight - clientHeight;
      const percentage = maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0;
      setScrollPercentage(Math.min(100, Math.max(0, percentage)));
    };

    const container = containerRef?.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll(); // Initial call
    }

    return () => container?.removeEventListener('scroll', handleScroll);
  }, [containerRef]);

  const handleScrollbarClick = (e) => {
    if (!scrollbarRef.current || !containerRef?.current) return;
    
    const rect = scrollbarRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = (y / rect.height) * 100;
    
    const { scrollHeight, clientHeight } = containerRef.current;
    const maxScroll = scrollHeight - clientHeight;
    const targetScroll = (percentage / 100) * maxScroll;
    
    containerRef.current.scrollTo({ top: targetScroll, behavior: 'smooth' });
  };

  const handleDateMarkerClick = (element) => {
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!dateGroups || dateGroups.length === 0) return null;

  return (
    <div className="fixed right-2 top-32 bottom-8 w-8 z-50 flex flex-col pointer-events-none">
      {/* Scrollbar Track */}
      <div
        ref={scrollbarRef}
        onClick={handleScrollbarClick}
        onMouseEnter={() => setIsDragging(true)}
        onMouseLeave={() => setIsDragging(false)}
        className="flex-1 relative pointer-events-auto"
      >
        {/* Current Position Thumb - thin white line */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-0.5 h-12 bg-white/50 rounded-full
                     transition-all duration-200"
          style={{ top: `${Math.max(0, Math.min(scrollPercentage, 100))}%` }}
        />

        {/* Date Markers */}
        <div className="absolute inset-0 flex flex-col justify-between py-4">
          {dateGroups.map((group, index) => {
            const isFirst = index === 0;
            const isLast = index === dateGroups.length - 1;
            
            return (
              <div
                key={group.date}
                className="group relative flex items-center justify-center pointer-events-auto"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDateMarkerClick(group.element);
                }}
              >
                {/* Marker Dot */}
                <div className={`w-1 h-1 rounded-full cursor-pointer transition-all duration-200
                              ${hoveredIndex === index 
                                ? 'bg-white w-2 h-2' 
                                : 'bg-white/40'}`} 
                />

                {/* Date Label - shows on hover */}
                {hoveredIndex === index && (
                  <div className="absolute right-full mr-3 px-3 py-1.5 bg-slate-900/95 backdrop-blur-xl 
                                rounded-lg border border-white/10 whitespace-nowrap shadow-xl
                                animate-in fade-in slide-in-from-right-2 duration-150">
                    <span className="text-xs font-semibold text-white">
                      {group.label}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
