// Guidance layer: rich help tooltips, a step-by-step guided tour and one-time
// contextual hints ("coach marks") that point at the next useful action.
// Everything is built with DOM APIs + textContent (no HTML strings), so help
// text can never inject markup.

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function isVisible(node) {
  if (!node || !node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(node);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

// Positions `box` next to `rect` on the preferred side, flipping when there is no
// room and clamping to the viewport. Exposes the arrow offset as CSS variables.
export function placeNear(box, rect, placement = 'bottom', gap = 10) {
  box.style.left = '0px';
  box.style.top = '0px';
  const bw = box.offsetWidth;
  const bh = box.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const fits = {
    top: rect.top - gap - bh >= margin,
    bottom: rect.bottom + gap + bh <= vh - margin,
    right: rect.right + gap + bw <= vw - margin,
    left: rect.left - gap - bw >= margin,
  };
  const orders = {
    top: ['top', 'bottom', 'right', 'left'],
    bottom: ['bottom', 'top', 'right', 'left'],
    right: ['right', 'left', 'bottom', 'top'],
    left: ['left', 'right', 'bottom', 'top'],
  };
  const order = orders[placement] || orders.bottom;
  const side = order.find((s) => fits[s]) || order[0];
  let top;
  let left;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? rect.top - gap - bh : rect.bottom + gap;
    left = rect.left + rect.width / 2 - bw / 2;
  } else {
    left = side === 'left' ? rect.left - gap - bw : rect.right + gap;
    top = rect.top + rect.height / 2 - bh / 2;
  }
  left = Math.max(margin, Math.min(left, vw - bw - margin));
  top = Math.max(margin, Math.min(top, vh - bh - margin));
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
  box.dataset.side = side;
  box.style.setProperty('--arrow-x', `${Math.round(Math.max(14, Math.min(bw - 14, rect.left + rect.width / 2 - left)))}px`);
  box.style.setProperty('--arrow-y', `${Math.round(Math.max(14, Math.min(bh - 14, rect.top + rect.height / 2 - top)))}px`);
  return side;
}

// Renders { title, body, steps[], legend[[label, text]], tip, keys[] } into `box`.
function fillHelp(box, help) {
  box.replaceChildren();
  if (help.title) box.append(el('div', 'tip-title', help.title));
  if (help.body) box.append(el('div', 'tip-body', help.body));
  if (help.steps?.length) {
    const list = el('ol', 'tip-steps');
    for (const step of help.steps) list.append(el('li', null, step));
    box.append(list);
  }
  if (help.legend?.length) {
    const legend = el('div', 'tip-legend');
    for (const [label, text, tone] of help.legend) {
      const row = el('div', 'tip-legend-row');
      row.append(el('span', `tip-legend-key${tone ? ` ${tone}` : ''}`, label), el('span', null, text));
      legend.append(row);
    }
    box.append(legend);
  }
  if (help.tip) box.append(el('div', 'tip-extra', help.tip));
  if (help.keys?.length) {
    const keys = el('div', 'tip-keys');
    keys.append(el('span', null, 'Shortcut'));
    for (const key of help.keys) keys.append(el('kbd', null, key));
    box.append(keys);
  }
}

// ── Tooltips ─────────────────────────────────────────────────────────────
// [data-help="key"] → rich tooltip from the `help` dictionary (entries may be
// functions of the element); [data-tip] / [title] → short plain tooltip.
export function initTooltips({ help = {}, isSuppressed = () => false } = {}) {
  const tip = el('div', 'app-tooltip');
  tip.id = 'appTooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let showTimer = null;
  let hideTimer = null;
  let current = null;

  const targetOf = (node) => (node && node.closest ? node.closest('[data-help],[data-tip],[title]') : null);
  const contentOf = (target) => {
    const key = target.dataset.help;
    const entry = key ? help[key] : null;
    if (entry) {
      if (target.hasAttribute('title')) target.removeAttribute('title');
      const resolved = typeof entry === 'function' ? entry(target) : entry;
      return resolved ? { rich: true, ...resolved, title: target.dataset.helpTitle || resolved.title } : null;
    }
    const text = target.dataset.tip || target.getAttribute('title');
    if (!text) return null;
    if (!target.dataset.tip) {
      target.dataset.tip = text;
      target.removeAttribute('title');
    }
    return { rich: false, text };
  };

  const hide = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    tip.classList.remove('visible');
    if (current) current.removeAttribute('aria-describedby');
    current = null;
  };

  const show = (target, delay) => {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (isSuppressed()) return;
    showTimer = setTimeout(() => {
      if (!target.isConnected || isSuppressed()) return;
      const content = contentOf(target);
      if (!content) return;
      if (current && current !== target) current.removeAttribute('aria-describedby');
      tip.classList.toggle('rich', content.rich);
      if (content.rich) fillHelp(tip, content);
      else tip.textContent = content.text;
      tip.classList.add('visible');
      placeNear(tip, target.getBoundingClientRect(), content.rich ? target.dataset.helpPlacement || 'bottom' : 'top', 8);
      current = target;
      target.setAttribute('aria-describedby', tip.id);
    }, delay);
  };

  document.addEventListener('mouseover', (e) => {
    const target = targetOf(e.target);
    if (!target) return;
    if (target === current) { clearTimeout(hideTimer); return; }
    show(target, target.dataset.help ? 420 : 250);
  });
  document.addEventListener('mouseout', (e) => {
    const target = targetOf(e.target);
    if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
    clearTimeout(showTimer);
    hideTimer = setTimeout(hide, 80);
  });
  document.addEventListener('focusin', (e) => {
    const target = targetOf(e.target);
    if (target && e.target.matches(':focus-visible')) show(target, 150);
  });
  document.addEventListener('focusout', () => { hideTimer = setTimeout(hide, 80); });
  document.addEventListener('mousedown', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  return { hide };
}

// ── Guided tour ──────────────────────────────────────────────────────────
// steps: [{ target: () => Element | null, title, body, bullets?, placement?, before?() }]
// A step whose target is missing/hidden is shown as a centred card instead.
export function createTour({ onStart, onEnd } = {}) {
  let run = null;

  function reposition() {
    if (!run) return;
    const step = run.steps[run.index];
    const target = step.target ? step.target() : null;
    const { spot, card } = run;
    if (target && isVisible(target)) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = target.getBoundingClientRect();
      const pad = step.pad ?? 6;
      Object.assign(spot.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      spot.classList.remove('centered');
      card.classList.remove('centered');
      placeNear(card, { top: r.top - pad, bottom: r.bottom + pad, left: r.left - pad, right: r.right + pad, width: r.width + pad * 2, height: r.height + pad * 2 }, step.placement || 'bottom', 14);
    } else {
      Object.assign(spot.style, { top: '50%', left: '50%', width: '0px', height: '0px' });
      spot.classList.add('centered');
      card.classList.add('centered');
      card.style.left = `${Math.round((window.innerWidth - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.round((window.innerHeight - card.offsetHeight) / 2)}px`;
      delete card.dataset.side;
    }
  }

  function render() {
    const { steps, index, card } = run;
    const step = steps[index];
    step.before?.();
    card.replaceChildren();
    const head = el('div', 'tour-head');
    head.append(el('span', 'tour-count', `${index + 1} of ${steps.length}`));
    const skip = el('button', 'tour-skip', 'Skip tour');
    skip.type = 'button';
    skip.addEventListener('click', () => end(false));
    head.append(skip);
    const title = el('div', 'tour-title', step.title);
    title.id = 'tourTitle';
    card.append(head, title, el('div', 'tour-body', step.body));
    if (step.bullets?.length) {
      const list = el('ul', 'tour-bullets');
      for (const b of step.bullets) list.append(el('li', null, b));
      card.append(list);
    }
    const foot = el('div', 'tour-foot');
    const dots = el('div', 'tour-dots');
    steps.forEach((_, i) => dots.append(el('span', i === index ? 'active' : i < index ? 'done' : '')));
    const nav = el('div', 'tour-nav');
    if (index > 0) {
      const back = el('button', 'pill-btn', 'Back');
      back.type = 'button';
      back.addEventListener('click', () => go(-1));
      nav.append(back);
    }
    const next = el('button', 'pill-btn pill-primary', index === steps.length - 1 ? 'Finish' : 'Next');
    next.type = 'button';
    next.addEventListener('click', () => (index === steps.length - 1 ? end(true) : go(1)));
    nav.append(next);
    foot.append(dots, nav);
    card.append(foot);
    // Let view switches from `before()` lay out before measuring.
    requestAnimationFrame(() => {
      if (!run) return;
      reposition();
      next.focus({ preventScroll: true });
    });
  }

  function go(delta) {
    if (!run) return;
    run.index = Math.max(0, Math.min(run.steps.length - 1, run.index + delta));
    render();
  }

  function onKey(e) {
    if (!run) return;
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (run.index < run.steps.length - 1) go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Tab') {
      const focusables = [...run.card.querySelectorAll('button')];
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!run.card.contains(document.activeElement)) { e.preventDefault(); first?.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      e.stopPropagation();
      return;
    } else if (e.key === 'Enter' || e.key === ' ') {
      return; // activates the focused tour button
    }
    e.stopPropagation(); // app shortcuts stay quiet during the tour
  }

  function end(completed) {
    if (!run) return;
    const { layer, returnFocus } = run;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
    layer.remove();
    run = null;
    onEnd?.({ completed });
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }

  function start(steps) {
    if (run) end(false);
    if (!steps?.length) return;
    const layer = el('div', 'tour-layer');
    const spot = el('div', 'tour-spotlight');
    const card = el('div', 'tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tourTitle');
    card.setAttribute('aria-live', 'polite');
    layer.append(spot, card);
    document.body.append(layer);
    run = { steps, index: 0, layer, spot, card, returnFocus: document.activeElement };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reposition);
    onStart?.();
    render();
  }

  return { start, end: () => end(false), get active() { return Boolean(run); } };
}

// ── Contextual hints ─────────────────────────────────────────────────────
// One small bubble at a time, anchored to the element it talks about, shown
// once per hint id (remembered in storage) and never over dialogs or the tour.
export function createHints({ read, write, canShow = () => true, onDismiss } = {}) {
  const KEY = 'owlaso_hints_seen';
  let seen;
  try { seen = new Set(JSON.parse(read(KEY) || '[]')); } catch { seen = new Set(); }
  let active = null;

  const persist = () => write(KEY, JSON.stringify([...seen]));

  // Returns whether the hint is still showing.
  function reposition() {
    if (!active) return false;
    if (!isVisible(active.target) || !canShow()) { hide(); return false; }
    placeNear(active.bubble, active.target.getBoundingClientRect(), active.placement, 12);
    return true;
  }

  function hide() {
    if (!active) return;
    active.target.classList.remove('hint-target');
    active.target.removeEventListener('click', active.onTargetClick, true);
    active.bubble.remove();
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
    active = null;
  }

  function dismiss({ markSeen = true, silent = false } = {}) {
    if (!active) return;
    const { id } = active;
    if (markSeen) { seen.add(id); persist(); }
    hide();
    if (!silent) onDismiss?.(id);
  }

  function show(id, target, { title, body, placement = 'bottom', action } = {}) {
    if (seen.has('*') || seen.has(id) || !canShow() || !isVisible(target)) return false;
    if (active) {
      if (active.id === id) return true;
      return false;
    }
    const bubble = el('div', 'hint-bubble');
    bubble.setAttribute('role', 'status');
    const header = el('div', 'hint-head');
    header.append(el('span', 'hint-icon', '💡'), el('span', 'hint-title', title));
    const actions = el('div', 'hint-actions');
    if (action) {
      const doIt = el('button', 'pill-btn pill-primary', action.label);
      doIt.type = 'button';
      doIt.addEventListener('click', () => { dismiss({ silent: true }); action.run(); });
      actions.append(doIt);
    }
    const ok = el('button', 'pill-btn', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', () => dismiss());
    const off = el('button', 'hint-off', 'Turn off tips');
    off.type = 'button';
    off.addEventListener('click', () => { seen.add('*'); persist(); dismiss({ silent: true }); });
    actions.append(ok);
    bubble.append(header, el('div', 'hint-body', body), actions, off);
    document.body.append(bubble);
    // Acting on the highlighted element counts as "got it".
    const onTargetClick = () => dismiss({ silent: true });
    active = { id, target, bubble, placement, onTargetClick };
    target.classList.add('hint-target');
    target.addEventListener('click', onTargetClick, true);
    placeNear(bubble, target.getBoundingClientRect(), placement, 12);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return true;
  }

  return {
    show,
    dismiss,
    hide,
    refresh: reposition,
    isSeen: (id) => seen.has(id) || seen.has('*'),
    get enabled() { return !seen.has('*'); },
    setEnabled(on) {
      if (on) seen.delete('*');
      else { seen.add('*'); hide(); }
      persist();
    },
    reset() { seen = new Set(); persist(); },
    get activeId() { return active?.id || null; },
  };
}
