/**
 * @fileoverview Timeline Scrollbar Component (Google Photos style)
 * Shows a minimal vertical scrollbar with date markers for quick navigation
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';

/**
 * TimelineScrollbar - A minimal vertical timeline with date markers
 * @param {Array} dateGroups - Array of {date, label, element} objects representing date sections
 * @param {Object} containerRef - Ref to the scrollable container
 * @param {number} navbarHeight - Live navbar height so the rail never sits under it
 */
export default function TimelineScrollbar({ dateGroups, containerRef, navbarHeight = 0 }) {
  const [isDragging, setIsDragging] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [scrollable, setScrollable] = useState(false);
  const [labelPinned, setLabelPinned] = useState(false);
  const scrollbarRef = useRef(null);
  const labelTimerRef = useRef(null);

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

  // Update progress when the user scrolls. The scroller is whichever source
  // actually has overflow: the page container, or — when the container just
  // grows with content (g-page is min-h-screen, no max) — the window itself.
  useEffect(() => {
    // shouldPin is true only for genuine scroll events — resize/re-check reads
    // must never re-pin the label (that would flash it back on while images load).
    const readProgress = (shouldPin) => {
      const c = containerRef?.current;
      const doc = document.scrollingElement;
      const cMax = c ? c.scrollHeight - c.clientHeight : 0;
      const dMax = doc ? doc.scrollHeight - doc.clientHeight : 0;
      const maxScroll = Math.max(cMax, dMax, 0);
      setScrollable(maxScroll > 8);
      if (maxScroll <= 0) {
        setScrollPercentage(0);
        return;
      }
      // Prefer the source that is actually offset; fall back to the larger one.
      let pct = 0;
      if (doc && doc.scrollTop > 0) pct = doc.scrollTop / dMax;
      else if (c && c.scrollTop > 0) pct = c.scrollTop / cMax;
      else pct = dMax >= cMax ? (doc ? doc.scrollTop / dMax : 0) : (c ? c.scrollTop / cMax : 0);
      setScrollPercentage(Math.min(100, Math.max(0, pct * 100)));

      if (shouldPin) {
        setLabelPinned(true);
        if (labelTimerRef.current) clearTimeout(labelTimerRef.current);
        labelTimerRef.current = setTimeout(() => setLabelPinned(false), 1200);
      }
    };

    const onScroll = () => readProgress(true);
    const container = containerRef?.current;
    container?.addEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll);
    // Content growth (lazy images, filters) changes overflow without a scroll event.
    // Observe BOTH the container and the body — after a route remount the container
    // may already be at full height when the effect runs, so its ResizeObserver
    // would never fire and the rail would stay hidden until the first scroll.
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => readProgress(false));
      if (container) ro.observe(container);
      if (document.body) ro.observe(document.body);
    }
    readProgress(false); // Initial call — never pins
    // Late content loads (async image fetch) also need re-checks.
    const timers = [500, 1500, 3000].map((ms) => setTimeout(() => readProgress(false), ms));

    return () => {
      container?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      timers.forEach(clearTimeout);
      if (labelTimerRef.current) clearTimeout(labelTimerRef.current);
    };
  }, [containerRef]);

  const scrollTargetFromClientY = (clientY) => {
    const c = containerRef?.current;
    const doc = document.scrollingElement;
    const cMax = c ? c.scrollHeight - c.clientHeight : 0;
    const dMax = doc ? doc.scrollHeight - doc.clientHeight : 0;
    const maxScroll = Math.max(cMax, dMax, 0);
    if (!scrollbarRef.current || maxScroll <= 0) return null;
    const rect = scrollbarRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    const percentage = Math.min(100, Math.max(0, (y / rect.height) * 100));
    return { target: (percentage / 100) * maxScroll, useWindow: dMax >= cMax };
  };

  const updateScrollFromClientY = (clientY) => {
    const next = scrollTargetFromClientY(clientY);
    if (!next) return;
    if (next.useWindow) {
      document.scrollingElement?.scrollTo({ top: next.target, behavior: 'smooth' });
    } else {
      containerRef?.current?.scrollTo({ top: next.target, behavior: 'smooth' });
    }
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

  if (!dateGroups || dateGroups.length === 0 || !scrollable) return null;

  return (
    <div
      className="fixed right-3 z-30 hidden lg:flex items-center pointer-events-none"
      style={{ top: (navbarHeight || 112) + 16, bottom: 32 }}
    >
      <div
        ref={scrollbarRef}
        onClick={handleScrollbarClick}
        onMouseDown={handleDragStart}
        className="relative h-[min(68vh,560px)] w-10 rounded-[var(--radius-box)] border border-base-content/10
                   backdrop-blur-xl shadow-xl pointer-events-auto select-none"
        style={{ background: 'oklch(from var(--color-base-100) l c h / 0.45)' }}
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
          const showLabel = isHovered || (isActive && (labelPinned || isDragging));

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

              {showLabel && (
                <span className="absolute right-full top-1/2 -translate-y-1/2 mr-3 px-2.5 py-1 rounded-[var(--radius-box)]
                               text-[11px] font-semibold whitespace-nowrap text-base-content
                               bg-base-100/95 border border-base-content/15 shadow-xl"
                      style={{ background: 'oklch(from var(--color-base-100) l c h / 0.95)' }}>
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
