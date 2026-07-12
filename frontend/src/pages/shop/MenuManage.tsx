import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeDay,
  createMenuItem,
  deleteMenuItem,
  getShopMenu,
  setMenuItemStock,
  updateMenuItem,
  type MenuItemInput,
} from '../../api/shop';
import { ApiError } from '../../api/client';
import type { MenuItem } from '../../api/types';
import { formatPrice, paiseToRupeesInput, rupeesToPaise } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { MenuStatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';

interface FormState {
  name: string;
  price: string;
  photo_url: string;
  avail_from: string;
  avail_to: string;
  is_available: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  price: '',
  photo_url: '',
  avail_from: '',
  avail_to: '',
  is_available: true,
};

function toFormState(item: MenuItem): FormState {
  return {
    name: item.name,
    price: paiseToRupeesInput(item.price),
    photo_url: item.photo_url ?? '',
    avail_from: item.avail_from ?? '',
    avail_to: item.avail_to ?? '',
    is_available: item.is_available,
  };
}

function toInput(form: FormState): MenuItemInput {
  return {
    name: form.name.trim(),
    price: rupeesToPaise(form.price),
    photo_url: form.photo_url.trim() ? form.photo_url.trim() : null,
    avail_from: form.avail_from ? form.avail_from : null,
    avail_to: form.avail_to ? form.avail_to : null,
    is_available: form.is_available,
  };
}

function MenuItemForm({
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  initial: FormState;
  onCancel: () => void;
  onSubmit: (input: MenuItemInput) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!form.name.trim()) {
      setValidationError('Name is required.');
      return;
    }
    const price = rupeesToPaise(form.price);
    if (!(price > 0)) {
      setValidationError('Price must be greater than ₹0.');
      return;
    }
    if ((form.avail_from && !form.avail_to) || (!form.avail_from && form.avail_to)) {
      setValidationError('Set both a start and end time, or leave both blank.');
      return;
    }

    onSubmit(toInput(form));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-sage bg-brand-light/40 p-4">
      {validationError && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{validationError}</div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Name</span>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
          placeholder="e.g. Masala Dosa"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Price (₹)</span>
        <input
          type="number"
          required
          min="0"
          step="0.01"
          value={form.price}
          onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
          placeholder="40.00"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Photo URL (optional)</span>
        <input
          type="url"
          value={form.photo_url}
          onChange={(e) => setForm((f) => ({ ...f, photo_url: e.target.value }))}
          className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
          placeholder="https://..."
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">Available from</span>
          <input
            type="time"
            value={form.avail_from}
            onChange={(e) => setForm((f) => ({ ...f, avail_from: e.target.value }))}
            className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">Available to</span>
          <input
            type="time"
            value={form.avail_to}
            onChange={(e) => setForm((f) => ({ ...f, avail_to: e.target.value }))}
            className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
          />
        </label>
      </div>

      <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={form.is_available}
          onChange={(e) => setForm((f) => ({ ...f, is_available: e.target.checked }))}
          className="h-5 w-5 accent-brand"
        />
        <span className="text-sm font-semibold text-ink/70">Available on the menu</span>
      </label>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={submitting}>
          Save
        </Button>
      </div>
    </form>
  );
}

function MenuItemRow({ item }: { item: MenuItem }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });

  const stockMutation = useMutation({
    mutationFn: () => setMenuItemStock(item.id, !item.out_of_stock),
    onSuccess: invalidate,
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not update stock.', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: (input: MenuItemInput) => updateMenuItem(item.id, input),
    onSuccess: () => {
      invalidate();
      setEditing(false);
      showToast('Item updated.', 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not update item.', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMenuItem(item.id),
    onSuccess: () => {
      invalidate();
      showToast('Item deleted.', 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not delete item.', 'error'),
  });

  function handleDelete() {
    if (window.confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      deleteMutation.mutate();
    }
  }

  if (editing) {
    return (
      <Card className="p-4">
        <MenuItemForm
          initial={toFormState(item)}
          onCancel={() => setEditing(false)}
          onSubmit={(input) => updateMutation.mutate(input)}
          submitting={updateMutation.isPending}
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div>
          <p className="font-bold text-ink">{item.name}</p>
          <p className="tabular text-sm text-ink/60">{formatPrice(item.price)}</p>
          {(item.avail_from || item.avail_to) && (
            <p className="text-xs text-ink/40">
              {item.avail_from ?? '00:00'} – {item.avail_to ?? '23:59'}
            </p>
          )}
        </div>
        <MenuStatusBadge status={item.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="md"
          variant={item.out_of_stock ? 'primary' : 'secondary'}
          loading={stockMutation.isPending}
          onClick={() => stockMutation.mutate()}
        >
          {item.out_of_stock ? 'Mark in stock' : 'Mark out of stock'}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="danger" loading={deleteMutation.isPending} onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

export function ShopMenuManagePage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const menuQuery = useQuery({ queryKey: ['shop', 'menu'], queryFn: getShopMenu });
  const [showAddForm, setShowAddForm] = useState(false);

  const createMutation = useMutation({
    mutationFn: (input: MenuItemInput) => createMenuItem(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
      setShowAddForm(false);
      showToast('Item added.', 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not add item.', 'error'),
  });

  const closeDayMutation = useMutation({
    mutationFn: closeDay,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      showToast('Day closed — availability reset.', 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not close the day.', 'error'),
  });

  function handleCloseDay() {
    if (
      window.confirm(
        'Close the day? Open orders will expire, the done pool clears, and all items go back in stock.',
      )
    ) {
      closeDayMutation.mutate();
    }
  }

  if (menuQuery.isLoading) return <FullPageSpinner />;

  if (menuQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load the menu"
        hint={menuQuery.error instanceof ApiError ? menuQuery.error.message : 'Please try again.'}
      />
    );
  }

  const items = menuQuery.data ?? [];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink">Menu</h1>
          <p className="text-sm text-ink/60">Add, edit, and manage stock.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? 'Close form' : 'Add item'}
          </Button>
          <Button variant="danger" loading={closeDayMutation.isPending} onClick={handleCloseDay}>
            Close day
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="mb-5">
          <MenuItemForm
            initial={EMPTY_FORM}
            onCancel={() => setShowAddForm(false)}
            onSubmit={(input) => createMutation.mutate(input)}
            submitting={createMutation.isPending}
          />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="No menu items yet" hint="Add your first item to get started." />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <MenuItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
