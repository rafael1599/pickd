# Modal Pattern — Architecture Decision

> **Status:** Adopted 2026-04-10
> **Applies to:** All modals, full-screen overlays, sheets, and editors
> **NOT for:** tooltips, dropdowns, small popovers, ephemeral UI

---

## The Problem

Modal state coupled to the lifecycle of the wrong component causes bugs:

- UserMenu controls a modal → menu unmounts → modal dies
- Drawer controls an editor → drawer closes → editor lost
- Child view controls a sheet → parent unmounts → sheet dies

These are not bugs to fix one by one — they share a structural anti-pattern: **UI state coupled to the wrong component lifecycle**.

---

## The Pattern: Modal Manager (Context + Root Render)

> **Golden rule:** No critical modal lives inside the component that opens it.

### 1. Typed modal state (discriminated union)

```ts
type ModalState =
  | { type: 'inventory-snapshot' }
  | { type: 'item-detail'; item: InventoryItemWithMetadata; mode?: 'edit' | 'add' }
  | { type: 'tag-editor'; tag: AssetTagRow }
  | null;
```

### 2. Context (no overengineering)

```ts
const ModalContext = createContext<{
  open: (modal: NonNullable<ModalState>) => void;
  close: () => void;
}>(null!);

export const useModal = () => useContext(ModalContext);
```

### 3. Provider mounted in LayoutMain (root level)

```tsx
export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const [modal, setModal] = useState<ModalState>(null);

  const open = (m: NonNullable<ModalState>) => setModal(m);
  const close = () => setModal(null);

  return (
    <ModalContext.Provider value={{ open, close }}>
      {children}

      {/* All critical modals live here */}
      {modal?.type === 'inventory-snapshot' && (
        <InventorySnapshotModal isOpen onClose={close} />
      )}
      {modal?.type === 'item-detail' && (
        <ItemDetailView isOpen item={modal.item} mode={modal.mode} onClose={close} />
      )}
      {modal?.type === 'tag-editor' && (
        <TagEditorModal tag={modal.tag} onClose={close} />
      )}
    </ModalContext.Provider>
  );
};
```

### 4. Use anywhere — zero prop drilling

```tsx
const { open } = useModal();

// Open from button click
<button onClick={() => open({ type: 'item-detail', item })}>Edit</button>
```

---

## Why This Pattern

| Problem | How it solves it |
|---------|------------------|
| Modal dies when parent unmounts | Modal lives at root, never tied to opener |
| Prop drilling for callbacks | `useModal()` from anywhere |
| New modal = changes in 3+ files | New modal = 1 type + 1 provider case |
| Hard to test which modal is open | Single source of truth in context |
| Modals scattered across the app | Single location to audit them all |

---

## When to Use

### ✅ Use Modal Manager for:
- Critical modals (item editors, snapshots, confirmations)
- Full-screen overlays
- Editing sheets
- Anything that should survive the opener unmounting
- Anything triggered from multiple components

### ❌ Do NOT use for:
- Tooltips
- Dropdown menus
- Small popovers
- Ephemeral UI (toasts, hints)
- Components tightly coupled to their parent's render state (e.g., expandable accordions)

If everything goes to the context, it becomes a monster.

---

## The Rule for the Team

Before creating a modal/sheet/full-screen overlay, ask:

> **"Can this component unmount while the modal is open?"**

If the answer is **yes** → it goes in the Modal Manager.
If the answer is **no** (it's a child of something always-mounted) → local state is fine.

---

## Optional: Modal Stack (advanced)

For modal-on-modal flows (rare), the context can support a stack:

```ts
const [stack, setStack] = useState<ModalState[]>([]);
const open = (m) => setStack((prev) => [...prev, m]);
const close = () => setStack((prev) => prev.slice(0, -1));
```

Don't add this until you actually need it.

---

## Migration Checklist (for existing modals)

When migrating an existing modal:

1. **Identify the bug:** Is the modal currently inside a component that can unmount?
2. **Add to ModalState union:** Define the type with required props
3. **Add provider case:** Render the modal in `ModalProvider`
4. **Replace local state:** Remove `useState` + conditional render in the parent
5. **Update trigger:** Replace `setLocalOpen(true)` with `open({ type: '...', ...props })`
6. **Test:** Open modal → close opener → modal should still work

---

## Files

- `src/context/ModalContext.tsx` — provider, hook, types
- `src/components/layout/LayoutMain.tsx` — provider mounted at root
- `docs/modal-pattern.md` — this document

## Related decisions

- Z-index system: see `.claude/plans/deep-booping-ember.md` (Phase 2a, normalized to 6 layers)
- Color system: see `.claude/plans/deep-booping-ember.md` (idea-046)
