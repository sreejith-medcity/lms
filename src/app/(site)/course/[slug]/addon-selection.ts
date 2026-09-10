'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which extras are ticked, shared by everything on the page that can buy.
 *
 * A course page has three buy buttons: the purchase card, the sticky bar on a
 * desktop and the bar at the bottom of a phone. The tick boxes are only in the
 * card, so if the selection lived in that component's state then ticking the
 * question bank and then pressing the button in the sticky bar would buy the
 * course without it. That is the sort of bug a buyer discovers on their bank
 * statement, so the selection lives outside all three.
 *
 * A module-level store rather than a context, because the three buttons are
 * rendered in different parts of the server tree and there is no single client
 * component that wraps them all.
 */

const selected = new Map<string, Set<string>>();
/** Snapshots must be referentially stable or useSyncExternalStore loops. */
const snapshots = new Map<string, string[]>();
const listeners = new Set<() => void>();

const EMPTY: string[] = [];

function refresh(productId: string) {
  const set = selected.get(productId);
  snapshots.set(productId, set && set.size > 0 ? [...set].sort() : EMPTY);
  for (const listen of listeners) listen();
}

export function setAddon(productId: string, addonProductId: string, on: boolean): void {
  const set = selected.get(productId) ?? new Set<string>();
  if (on) set.add(addonProductId);
  else set.delete(addonProductId);
  selected.set(productId, set);
  refresh(productId);
}

/**
 * Seed the selection once, from what the page was asked for.
 *
 * A card in the catalogue can send somebody here with the extra already
 * ticked, and an academy can mark one preselected. Both arrive as a seed
 * rather than as a render-time default, so a later untick is not undone by
 * the next render.
 */
export function seedAddons(productId: string, ids: string[]): void {
  if (selected.has(productId)) return;
  selected.set(productId, new Set(ids));
  refresh(productId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedAddons(productId: string): string[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshots.get(productId) ?? EMPTY,
    () => EMPTY,
  );
}
