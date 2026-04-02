/**
 * @fileoverview Timeline Scrollbar Component (Google Photos style)
 * Shows a minimal vertical scrollbar with date markers for quick navigation
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';

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

  const markerPositions = useMemo(() => {
    if (!dateGroups || dateGroups.length === 0) return [];
    if (dateGroups.length === 1) return [0];
    return dateGroups.map((_, index) => (index / (dateGroups.length - 1)) * 100);
  }, [dateGroups]);

  const activeIndex = useMemo(() => {
    if (!markerPositions.length) return null;
    let closestIndex = 0;
    let smallestDistance = Number.POSITIVE_INFINITY;

    markerPositions.forEach((position, index) => {
      const distance = Math.abs(position - scrollPercentage);
      if (distance < smallestDistance) {
        smallestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }, [markerPositions, scrollPercentage]);

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

  const updateScrollFromClientY = (clientY) => {
    if (!scrollbarRef.current || !containerRef?.current) return;
    
    const rect = scrollbarRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    const percentage = Math.min(100, Math.max(0, (y / rect.height) * 100));
    
    const { scrollHeight, clientHeight } = containerRef.current;
    const maxScroll = scrollHeight - clientHeight;
    const targetScroll = (percentage / 100) * maxScroll;
    
    containerRef.current.scrollTo({ top: targetScroll, behavior: 'smooth' });
  };

  const handleScrollbarClick = (e) => {
    updateScrollFromClientY(e.clientY);
  };

  const handleDragStart = (e) => {
    e.preventDefault();
    setIsDragging(true);
    updateScrollFromClientY(e.clientY);
  };

  useEffect(() => {
    if (!isDragging) return undefined;

    const handleMouseMove = (event) => {
      updateScrollFromClientY(event.clientY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleDateMarkerClick = (element) => {
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!dateGroups || dateGroups.length === 0) return null;

  return (
    <div className="fixed right-3 top-28 bottom-8 z-50 hidden md:flex items-center pointer-events-none">
      <div
        ref={scrollbarRef}
        onClick={handleScrollbarClick}
        onMouseDown={handleDragStart}
        className="relative h-[min(68vh,560px)] w-14 rounded-[var(--radius-box)] border border-base-content/10
                   bg-base-100/70 backdrop-blur-xl shadow-2xl pointer-events-auto select-none"
      >
        {/* Track */}
        <div className="absolute top-4 bottom-4 left-1/2 -translate-x-1/2 w-[2px] rounded-full bg-base-content/20" />

        {/* Current Position Thumb */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40
                     bg-primary shadow-lg shadow-primary/30 transition-all duration-150
                     ${isDragging ? 'w-4 h-4' : 'w-3 h-3'}`}
          style={{ top: `${Math.max(0, Math.min(scrollPercentage, 100))}%` }}
        />

        {/* Date Markers */}
        {dateGroups.map((group, index) => {
          const markerTop = markerPositions[index] ?? 0;
          const isActive = activeIndex === index;
          const isHovered = hoveredIndex === index;

          return (
            <button
              key={`${group.date}-${index}`}
              type="button"
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 group"
              style={{ top: `${markerTop}%` }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={(e) => {
                e.stopPropagation();
                handleDateMarkerClick(group.element);
              }}
              title={group.label}
              aria-label={`Jump to ${group.label}`}
            >
              <span
                className={`block rounded-full border transition-all duration-150
                          ${isActive || isHovered
                            ? 'w-3 h-3 bg-base-content border-base-content/80 shadow-md shadow-base-content/20'
                            : 'w-2 h-2 bg-base-content/40 border-base-content/30'}`}
              />

              {(isHovered || isActive) && (
                <span className="absolute right-full top-1/2 -translate-y-1/2 mr-3 px-2.5 py-1 rounded-[var(--radius-box)]
                               text-[11px] font-semibold whitespace-nowrap text-base-content
                               bg-base-100/95 border border-base-content/15 shadow-xl">
                  {group.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

