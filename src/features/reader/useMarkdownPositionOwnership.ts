import { nextTick } from 'vue'

import type { MarkdownReadingPosition } from '@/features/library/types'

export type MarkdownReadingLocation = Omit<MarkdownReadingPosition, 'updatedAt'>

export interface MarkdownPositionOwner {
  documentId: string
  restorePause: object | null
  suspension: MarkdownPositionOwnerSuspensionState | null
}

export interface MarkdownPositionRestorePause {
  owner: MarkdownPositionOwner
  token: object
}

interface MarkdownPositionOwnerSuspensionState {
  pendingPosition: MarkdownReadingLocation | null
  token: object
}

export interface MarkdownPositionOwnerSuspension {
  owner: MarkdownPositionOwner
  state: MarkdownPositionOwnerSuspensionState
}

interface PendingMarkdownRestore {
  owner: MarkdownPositionOwner
  position: MarkdownReadingLocation
  scheduled: boolean
}

interface MarkdownPositionOwnershipOptions {
  getActiveDocumentId: () => string | null
  getActiveHeadingId: () => string
  getScrollY: () => number
  isLibraryActive: () => boolean
  isReaderActive: () => boolean
  isRendering: () => boolean
  isScrollTrackingEnabled: () => boolean
  onPositionRestored: () => void
  restoreScroll: (scrollY: number) => void
  savePosition: (position: MarkdownReadingLocation) => Promise<unknown> | unknown
}

export function useMarkdownPositionOwnership(options: MarkdownPositionOwnershipOptions) {
  let activeOwner: MarkdownPositionOwner | null = null
  let pendingRestore: PendingMarkdownRestore | null = null
  let positionSaveTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const positionSaves = new Map<MarkdownPositionOwner, Set<Promise<void>>>()

  function onScroll(): void {
    if (
      !options.isReaderActive()
      || !options.getActiveDocumentId()
      || !options.isScrollTrackingEnabled()
    ) {
      return
    }

    const owner = activeOwner
    if (!owner || pendingRestore?.owner === owner) {
      return
    }

    const position = createPosition(owner)
    if (!position) {
      return
    }

    if (owner.suspension) {
      owner.suspension.pendingPosition = position
      return
    }

    clearSaveTimer()
    positionSaveTimer = window.setTimeout(() => {
      positionSaveTimer = undefined
      if (!isOwnerCurrent(owner)) {
        return
      }

      void savePosition(position, owner).catch(() => undefined)
    }, 450)
  }

  async function preserveActive(options: { scrollY?: number } = {}): Promise<void> {
    await saveActive(options).catch(() => undefined)
  }

  async function flushPending(): Promise<void> {
    while (positionSaveTimer !== undefined) {
      await preserveActive()
    }
  }

  async function saveActive(saveOptions: { scrollY?: number } = {}): Promise<void> {
    clearSaveTimer()
    const owner = activeOwner
    if (!owner || pendingRestore?.owner === owner) {
      return
    }

    if (owner.suspension) {
      const position = createPosition(owner, saveOptions)
      if (position) {
        owner.suspension.pendingPosition = position
      }
      return
    }

    if (!isOwnerCurrent(owner)) {
      return
    }

    const position = createPosition(owner, saveOptions)
    if (position) {
      await savePosition(position, owner)
    }
  }

  function createPosition(
    owner: MarkdownPositionOwner,
    positionOptions: { scrollY?: number } = {},
  ): MarkdownReadingLocation | null {
    if (
      activeOwner !== owner
      || options.getActiveDocumentId() !== owner.documentId
      || !options.isReaderActive()
    ) {
      return null
    }

    return {
      documentId: owner.documentId,
      type: 'markdown',
      scrollY: Math.max(0, Math.round(positionOptions.scrollY ?? options.getScrollY())),
      activeHeadingId: options.getActiveHeadingId() || null,
    }
  }

  function savePosition(
    position: MarkdownReadingLocation,
    owner: MarkdownPositionOwner,
  ): Promise<void> {
    let ownerSaves = positionSaves.get(owner)
    if (!ownerSaves) {
      ownerSaves = new Set()
      positionSaves.set(owner, ownerSaves)
    }

    const save = Promise.resolve()
      .then(() => options.savePosition(position))
      .then(() => undefined)
    ownerSaves.add(save)
    void save.finally(() => {
      ownerSaves?.delete(save)
      if (ownerSaves?.size === 0) {
        positionSaves.delete(owner)
      }
    }).catch(() => undefined)
    return save
  }

  function clearSaveTimer(): void {
    if (positionSaveTimer === undefined) {
      return
    }

    window.clearTimeout(positionSaveTimer)
    positionSaveTimer = undefined
  }

  function activate(documentId: string): MarkdownPositionOwner {
    invalidate()
    const owner = { documentId, restorePause: null, suspension: null }
    activeOwner = owner
    return owner
  }

  function pauseRestore(): MarkdownPositionRestorePause | null {
    const owner = activeOwner
    if (!owner) {
      return null
    }

    const token = {}
    owner.restorePause = token
    return { owner, token }
  }

  function resumeRestore(pause: MarkdownPositionRestorePause | null): void {
    if (!pause || activeOwner !== pause.owner || pause.owner.restorePause !== pause.token) {
      return
    }

    pause.owner.restorePause = null
    restorePendingIfReady()
  }

  function retainActivePositionForRestore(
    pause: MarkdownPositionRestorePause | null,
    positionOptions: { scrollY?: number } = {},
  ): void {
    if (
      !pause
      || activeOwner !== pause.owner
      || pause.owner.restorePause !== pause.token
      || pendingRestore?.owner === pause.owner
    ) {
      return
    }

    const position = createPosition(pause.owner, positionOptions)
    if (position) {
      pendingRestore = { owner: pause.owner, position, scheduled: false }
    }
  }

  function suspend(documentId: string): MarkdownPositionOwnerSuspension | null {
    const owner = activeOwner
    if (owner?.documentId !== documentId) {
      return null
    }

    const state: MarkdownPositionOwnerSuspensionState = {
      pendingPosition: null,
      token: {},
    }
    clearSaveTimer()
    owner.suspension = state
    return { owner, state }
  }

  function resumeSuspension(suspension: MarkdownPositionOwnerSuspension | null): void {
    if (!suspension || suspension.owner.suspension !== suspension.state) {
      return
    }

    suspension.owner.suspension = null
    if (disposed) {
      return
    }

    const currentOwner = activeOwner
    if (
      currentOwner
      && currentOwner !== suspension.owner
      && currentOwner.documentId === suspension.owner.documentId
    ) {
      return
    }

    if (suspension.state.pendingPosition) {
      void savePosition(suspension.state.pendingPosition, suspension.owner).catch(() => undefined)
    }

    if (
      activeOwner !== suspension.owner
      || options.getActiveDocumentId() !== suspension.owner.documentId
    ) {
      return
    }

    if (pendingRestore?.owner === suspension.owner) {
      restorePendingIfReady()
      return
    }

    if (!suspension.state.pendingPosition) {
      void preserveActive()
    }
  }

  async function settleSaves(owner: MarkdownPositionOwner, signal: AbortSignal): Promise<void> {
    while (positionSaves.get(owner)?.size) {
      if (signal.aborted) {
        return
      }

      let onAbort: (() => void) | undefined
      const abort = new Promise<void>((resolve) => {
        onAbort = () => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        await Promise.race([
          Promise.allSettled(positionSaves.get(owner) ?? []),
          abort,
        ])
      }
      finally {
        if (onAbort) {
          signal.removeEventListener('abort', onAbort)
        }
      }
    }
  }

  function invalidate(
    expectedOwner?: MarkdownPositionOwner | string,
    invalidateOptions: { discardSuspendedPosition?: boolean } = {},
  ): void {
    const owner = activeOwner
    if (
      typeof expectedOwner === 'string'
        ? owner?.documentId !== expectedOwner
        : expectedOwner && owner !== expectedOwner
    ) {
      return
    }

    clearSaveTimer()
    if (invalidateOptions.discardSuspendedPosition && owner) {
      owner.suspension = null
    }
    if (pendingRestore?.owner === owner) {
      pendingRestore = null
    }
    activeOwner = null
  }

  function setPendingRestore(
    owner: MarkdownPositionOwner,
    position: MarkdownReadingPosition | null,
  ): void {
    pendingRestore = position ? { owner, position, scheduled: false } : null
  }

  function clearPendingRestore(): void {
    pendingRestore = null
  }

  function restorePendingIfReady(): void {
    const restore = pendingRestore
    if (!restore) {
      return
    }

    if (isOwnerPaused(restore.owner)) {
      return
    }

    if (!isPendingRestoreCurrent(restore)) {
      clearPendingRestoreIfCurrent(restore)
      return
    }

    if (options.isRendering() || restore.scheduled) {
      return
    }

    restore.scheduled = true
    void nextTick(() => {
      if (!isPendingRestoreCurrent(restore)) {
        if (retainPausedRestore(restore)) {
          return
        }

        clearPendingRestoreIfCurrent(restore)
        return
      }

      window.requestAnimationFrame(() => {
        if (!isPendingRestoreCurrent(restore)) {
          if (retainPausedRestore(restore)) {
            return
          }

          clearPendingRestoreIfCurrent(restore)
          return
        }

        clearPendingRestoreIfCurrent(restore)
        options.restoreScroll(restore.position.scrollY)
        options.onPositionRestored()
      })
    })
  }

  function retainPausedRestore(restore: PendingMarkdownRestore): boolean {
    if (!isOwnerPaused(restore.owner)) {
      return false
    }

    restore.scheduled = false
    return true
  }

  function isOwnerPaused(owner: MarkdownPositionOwner): boolean {
    return activeOwner === owner
      && options.getActiveDocumentId() === owner.documentId
      && (
        owner.restorePause !== null
        || owner.suspension !== null
        || options.isLibraryActive()
      )
  }

  function isOwnerCurrent(owner: MarkdownPositionOwner): boolean {
    return activeOwner === owner
      && owner.suspension === null
      && options.getActiveDocumentId() === owner.documentId
      && options.isReaderActive()
  }

  function isPendingRestoreCurrent(restore: PendingMarkdownRestore): boolean {
    return pendingRestore === restore
      && restore.owner.documentId === restore.position.documentId
      && restore.owner.restorePause === null
      && isOwnerCurrent(restore.owner)
  }

  function clearPendingRestoreIfCurrent(restore: PendingMarkdownRestore): void {
    if (pendingRestore === restore) {
      pendingRestore = null
    }
  }

  function dispose(): void {
    disposed = true
    invalidate(undefined, { discardSuspendedPosition: true })
  }

  return {
    activate,
    clearPendingRestore,
    dispose,
    flushPending,
    getActiveOwner: () => activeOwner,
    invalidate,
    onScroll,
    pauseRestore,
    preserveActive,
    retainActivePositionForRestore,
    restorePendingIfReady,
    resumeRestore,
    resumeSuspension,
    saveActive,
    setPendingRestore,
    settleSaves,
    suspend,
  }
}
