import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './county-ui.css';

export function searchCountyNames(countyNames, query, limit = 8) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return { matches: [], total: 0 };
  const tokens = normalized.split(/[\s,]+/).filter(Boolean);
  const matches = Object.entries(countyNames ?? {})
    .filter(([fips, county]) => /^\d{5}$/.test(normalized) ? fips === normalized
      : tokens.every((token) => `${county.name} ${county.state} ${fips}`.toLocaleLowerCase().includes(token)))
    .map(([fips, county]) => ({ fips, ...county }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state) || a.fips.localeCompare(b.fips));
  return { matches: matches.slice(0, limit), total: matches.length };
}

export default function CountySearch({ countyNames, onSelect, disabled = false }) {
  const id = useId();
  const list = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { matches, total } = useMemo(() => searchCountyNames(countyNames, query), [countyNames, query]);
  const expanded = open && query.trim().length > 0 && !disabled;
  useEffect(() => {
    if (expanded) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded]);
  const select = (county) => {
    setQuery(`${county.name}, ${county.state}`);
    setOpen(false);
    onSelect(county.fips);
  };
  return <div className="county-search" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label className="county-visually-hidden" htmlFor={`${id}-input`}>Find a county</label>
    <svg className="county-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
    <input id={`${id}-input`} type="search" role="combobox" autoComplete="off" spellCheck="false"
      placeholder="Search county, state or FIPS" value={query} disabled={disabled}
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`}
      aria-describedby={`${id}-status`}
      aria-activedescendant={expanded && matches[active] ? `${id}-${matches[active].fips}` : undefined}
      onFocus={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); event.preventDefault(); }
        else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
          event.preventDefault();
          setOpen(true);
          setActive((index) => expanded ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
            : event.key === 'ArrowDown' ? 0 : matches.length - 1);
        } else if (event.key === 'Enter' && expanded && matches[active]) {
          event.preventDefault(); select(matches[active]);
        }
      }} />
    <div className={expanded ? 'county-search-popup' : 'county-visually-hidden'}>
      <p id={`${id}-status`} className="county-search-status" role="status">
        {disabled ? 'Loading county names…' : !query.trim() ? 'Search modern county names or a full FIPS code.'
          : !total ? 'No counties found. Try a county name, state or full FIPS.'
            : total > matches.length ? `${total.toLocaleString()} matches · showing ${matches.length}. Keep typing to narrow the list.`
              : `${total} ${total === 1 ? 'county' : 'counties'} found. Use ↑ and ↓, then Enter to select.`}
      </p>
      {expanded && <ul ref={list} id={`${id}-results`} className="county-search-results" role="listbox" aria-label="Matching counties">
        {matches.map((county, index) => <li key={county.fips} id={`${id}-${county.fips}`} role="option"
          aria-selected={active === index} onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index)} onClick={() => select(county)}>
          <span>{county.name}<span className="county-search-state">, {county.state}</span></span>
          <small>FIPS {county.fips}</small>
        </li>)}
      </ul>}
    </div>
  </div>;
}
