import React, { useEffect, useMemo, useRef, useState } from "react";

// A text input with a suggestion dropdown, driven by whatever list of options
// it's handed. Used for the Master column (ledger heads) and for every search /
// expense filter box, where the options are the values already entered in the
// sheet — so nobody has to remember and retype an existing entry exactly.
//
// Keyboard behaviour is the point: arrows move through suggestions, the first
// Enter accepts the highlighted one, and a second Enter falls through to
// whatever the parent does with Enter (moving to the next cell or filter
// field). That keeps entry and filtering mouse-free.
//
// `renderRow` and `renderFooter` are optional hooks the Master column uses to
// put add/rename/delete controls inside this dropdown. Left out — as every
// filter box leaves them out — this behaves exactly as it always has.
const SuggestInput = ({
  value,
  onChange,
  onBlur,
  onKeyDown,
  options,
  inputRef,
  placeholder,
  className,
  maxSuggestions = 8,
  renderRow,
  renderFooter,
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimeout = useRef(null);

  const rootRef = useRef(null);

  // When the dropdown was last clicked inside.
  //
  // Clicking a control in there (rename, delete, add) blurs the input, and the
  // blur used to close the dropdown before the click's own handler had run —
  // so the row you clicked rename on vanished instead of becoming editable.
  // A timestamp rather than a flag, because a flag has to be cleared by some
  // later event, and whichever event you pick either fires too early (mouseup,
  // before the 120ms blur timer) or may never fire at all, wedging the dropdown
  // permanently open. A timestamp expires by itself.
  const lastInsideClick = useRef(0);

  const keepOpen = () => clearTimeout(blurTimeout.current);
  const close = () => setOpen(false);

  // Focus can end up INSIDE the dropdown (the rename box), and then the input's
  // blur will never fire again — so closing can't rely on blur alone.
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const matches = useMemo(() => {
    const pool = options || [];
    const q = (value || "").trim().toLowerCase();
    if (!q) return pool.slice(0, maxSuggestions);
    // Entries starting with what was typed are the likelier intent, so they
    // sort above ones that merely contain it somewhere.
    const starts = [];
    const contains = [];
    for (const opt of pool) {
      const lower = String(opt).toLowerCase();
      if (lower.startsWith(q)) starts.push(opt);
      else if (lower.includes(q)) contains.push(opt);
    }
    return [...starts, ...contains].slice(0, maxSuggestions);
  }, [value, options, maxSuggestions]);

  const select = (option) => {
    onChange(option);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (open && matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHighlight((h) =>
        e.key === "ArrowDown" ? (h + 1) % matches.length : (h - 1 + matches.length) % matches.length
      );
      return;
    }
    if (open && matches.length > 0 && e.key === "Enter" && matches[highlight] && matches[highlight] !== value) {
      e.preventDefault();
      select(matches[highlight]);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    onKeyDown?.(e);
  };

  const footer = renderFooter?.({ keepOpen, close, value });
  // Without a footer this is unchanged: no matches, no dropdown. With one, the
  // dropdown still opens on an empty result set, because that is exactly when
  // "add this as a new master" needs to be reachable.
  const showDropdown = open && (matches.length > 0 || !!footer);

  return (
    <div className="relative" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Delayed so a click on a suggestion registers before it vanishes.
          blurTimeout.current = setTimeout(() => {
            // A blur caused by clicking inside the dropdown is not a reason to
            // close it; the click-away listener above handles the real exits.
            if (Date.now() - lastInsideClick.current < 400) return;
            setOpen(false);
          }, 120);
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {showDropdown && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg text-sm"
          // CAPTURE phase on purpose. The controls inside call stopPropagation so
          // a click on "rename" doesn't also select the row — which would stop a
          // bubbling handler here from ever running, leaving the guard unarmed
          // and the dropdown closing 120ms later, right after it had opened the
          // rename box. Capture runs before the children, so nothing can skip it.
          onMouseDownCapture={() => {
            lastInsideClick.current = Date.now();
          }}
        >
          <div className="max-h-48 overflow-y-auto">
            {matches.map((m, i) => {
              const highlighted = i === highlight;
              const custom = renderRow?.(m, { highlighted, select: () => select(m), keepOpen, close });
              if (custom) return <React.Fragment key={m}>{custom}</React.Fragment>;
              return (
                <div
                  key={m}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    keepOpen();
                    select(m);
                  }}
                  className={`px-3 py-1.5 cursor-pointer truncate ${
                    highlighted
                      ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                      : "hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-200"
                  }`}
                  title={m}
                >
                  {m}
                </div>
              );
            })}
          </div>
          {footer}
        </div>
      )}
    </div>
  );
};

export default SuggestInput;
