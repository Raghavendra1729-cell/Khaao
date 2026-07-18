import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMenuItem,
  deleteMenuItem,
  getShopMenu,
  setMenuItemStock,
  updateMenuItem,
  uploadMenuItemPhoto,
  type MenuItemInput,
} from '../../api/shop';
import { ApiError } from '../../api/client';
import type { Diet, MenuItem } from '../../api/types';
import { cloudinaryThumb, formatPrice, paiseToRupeesInput, rupeesToPaise } from '../../lib/format';
import { downscaleImage } from '../../lib/image';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { MenuStatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { useLanguage } from '../../context/LanguageContext';

const MENU_STATUS_LABEL_HI: Record<MenuItem['status'], string> = {
  available: 'उपलब्ध',
  time_limited: 'समय-सीमित',
  out_of_stock: 'स्टॉक में नहीं',
  unavailable: 'अनुपलब्ध',
};

interface FormState {
  name: string;
  price: string;
  photo_url: string;
  avail_from: string;
  avail_to: string;
  is_available: boolean;
  diet: Diet;
  tags: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  price: '',
  photo_url: '',
  avail_from: '',
  avail_to: '',
  is_available: true,
  diet: 'veg',
  tags: [],
};

function toFormState(item: MenuItem): FormState {
  return {
    name: item.name,
    price: paiseToRupeesInput(item.price),
    photo_url: item.photo_url ?? '',
    avail_from: item.avail_from ?? '',
    avail_to: item.avail_to ?? '',
    is_available: item.is_available,
    diet: item.diet ?? 'veg',
    tags: item.tags ?? [],
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
    diet: form.diet,
    tags: form.tags,
  };
}

function MenuItemForm({
  initial,
  allTags,
  onCancel,
  onSubmit,
  submitting,
}: {
  initial: FormState;
  allTags: string[];
  onCancel: () => void;
  onSubmit: (input: MenuItemInput) => void;
  submitting: boolean;
}) {
  const { language } = useLanguage();
  const [form, setForm] = useState<FormState>(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !form.tags.includes(t)) {
      setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  };

  const { showToast } = useToast();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Kept separate from form.photo_url so a blob: preview can never be
  // submitted — Save reads only form.photo_url, which only ever holds a
  // real Cloudinary URL (or the empty string). Mirrored into a ref so the
  // unmount cleanup below always sees the latest value, not the one from
  // whichever render the effect closed over.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const localPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    // Revoke on unmount so a mid-upload navigate-away doesn't leak the blob.
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    };
  }, []);

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    const previewUrl = URL.createObjectURL(file);
    localPreviewRef.current = previewUrl;
    setLocalPreview(previewUrl);

    setUploadingPhoto(true);
    try {
      const resized = await downscaleImage(file);
      const url = await uploadMenuItemPhoto(resized);
      setForm((f) => ({ ...f, photo_url: url }));
    } catch (err) {
      showToast('Photo upload failed.', 'error');
      setForm((f) => ({ ...f, photo_url: '' }));
    } finally {
      if (localPreviewRef.current === previewUrl) {
        URL.revokeObjectURL(previewUrl);
        localPreviewRef.current = null;
        setLocalPreview(null);
      }
      setUploadingPhoto(false);
    }
  }

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-edge bg-brand-light/40 p-4">
      {validationError && (
        <div className="rounded-lg border border-stamp/40 bg-stamp-light px-3 py-2 text-sm font-medium text-stamp-dark">
          {validationError}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Name</span>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="min-h-[44px] w-full rounded-xl border border-edge bg-steel/30 px-3 text-base focus:border-brand focus:bg-paper"
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
          className="min-h-[44px] w-full rounded-xl border border-edge bg-steel/30 px-3 text-base focus:border-brand focus:bg-paper"
          placeholder="40.00"
        />
      </label>
      
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Diet</span>
        <select
          value={form.diet}
          onChange={(e) => setForm((f) => ({ ...f, diet: e.target.value as Diet }))}
          className="min-h-[44px] w-full rounded-xl border border-edge bg-steel/30 px-3 text-base focus:border-brand focus:bg-paper"
        >
          <option value="veg">Vegetarian</option>
          <option value="non_veg">Non-Vegetarian</option>
        </select>
      </label>

      <div className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Tags (optional)</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {form.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand-dark"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-brand-dark/50 hover:text-brand-dark"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {allTags
            .filter((t) => !form.tags.includes(t))
            .map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => addTag(tag)}
                className="rounded-full border border-edge px-3 py-1 text-sm text-ink/60 hover:bg-steel/30"
              >
                + {tag}
              </button>
            ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            className="min-h-[44px] flex-1 rounded-xl border border-edge bg-steel/30 px-3 text-base focus:border-brand focus:bg-paper"
            placeholder="Add new tag"
          />
          <Button type="button" variant="secondary" onClick={() => addTag(tagInput)}>
            Add
          </Button>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink/70">Photo (optional)</span>
        <div className="flex items-center gap-3">
          {(localPreview || form.photo_url) && (
            <img
              src={localPreview ?? cloudinaryThumb(form.photo_url, 88) ?? undefined}
              alt="Preview"
              className="h-11 w-11 rounded-lg object-cover"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handlePhotoSelected}
            disabled={uploadingPhoto}
            className="block w-full text-sm text-ink/70 file:mr-4 file:rounded-full file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-dark hover:file:bg-brand/20"
          />
        </div>
        {uploadingPhoto && <p className="mt-1 text-sm text-ink/60">Uploading...</p>}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">Available from</span>
          <input
            type="time"
            value={form.avail_from}
            onChange={(e) => setForm((f) => ({ ...f, avail_from: e.target.value }))}
            className="min-h-[44px] w-full rounded-xl border border-edge bg-steel/30 px-3 text-base focus:border-brand focus:bg-paper"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">Available to</span>
          <input
            type="time"
            value={form.avail_to}
            onChange={(e) => setForm((f) => ({ ...f, avail_to: e.target.value }))}
            className="min-h-[44px] w-full rounded-xl border border-edge bg-steel/30 px-3 text-base focus:border-brand focus:bg-paper"
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
        <span className="text-sm font-semibold text-ink/70">
          {language === 'hi' ? 'मेन्यू पर उपलब्ध' : 'Available on the menu'}
        </span>
      </label>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={submitting} disabled={uploadingPhoto}>
          Save
        </Button>
      </div>
    </form>
  );
}

function MenuItemRow({ item, allTags }: { item: MenuItem; allTags: string[] }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    const clickHandler = () => setArmed(false);
    const addListener = setTimeout(() => window.addEventListener('click', clickHandler), 0);
    return () => {
      clearTimeout(timer);
      clearTimeout(addListener);
      window.removeEventListener('click', clickHandler);
    };
  }, [armed]);

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

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (window.confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      deleteMutation.mutate();
    }
  }

  function handleCardClick() {
    if (item.out_of_stock) {
      stockMutation.mutate();
    } else {
      if (armed) {
        stockMutation.mutate();
        setArmed(false);
      } else {
        setArmed(true);
      }
    }
  }

  if (editing) {
    return (
      <Card className="p-4">
        <MenuItemForm
          initial={toFormState(item)}
          allTags={allTags}
          onCancel={() => setEditing(false)}
          onSubmit={(input) => updateMutation.mutate(input)}
          submitting={updateMutation.isPending}
        />
      </Card>
    );
  }

  return (
    <Card
      className={`relative overflow-hidden flex h-full flex-col p-4 transition-colors ${
        item.out_of_stock ? 'opacity-60 grayscale-[0.3]' : 'hover:bg-steel/10 cursor-pointer'
      } ${armed ? 'ring-2 ring-red-500' : ''}`}
      onClick={handleCardClick}
    >
      <div className="flex-1">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="font-bold text-ink">{item.name}</p>
          <div className="flex flex-col items-end gap-0.5">
            {language === 'hi' ? (
              <span className="text-[10px] font-medium text-ink/50">{MENU_STATUS_LABEL_HI[item.status]}</span>
            ) : (
              <MenuStatusBadge status={item.status} />
            )}
          </div>
        </div>
        <p className="tabular text-sm text-ink/60">{formatPrice(item.price)}</p>
        {item.rating_count > 0 && (
          <p className="mt-0.5 flex items-center gap-0.5 text-xs font-semibold text-ink/70">
            <span className="text-turmeric-deep text-[10px]">★</span> {item.avg_rating.toFixed(1)} ({item.rating_count})
          </p>
        )}
        {(item.avail_from || item.avail_to) && (
          <p className="text-xs text-ink/40">
            {item.avail_from ?? '00:00'} – {item.avail_to ?? '23:59'}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              item.diet === 'veg' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {item.diet === 'veg' ? 'Veg' : 'Non-veg'}
          </span>
          {item.tags?.map((tag) => (
            <span key={tag} className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-dark">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-3" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" onClick={() => setEditing(true)} className="flex-1">
          <span>{language === 'hi' ? 'संपादित करें' : 'Edit'}</span>
        </Button>
        <Button variant="danger" loading={deleteMutation.isPending} onClick={handleDelete} className="flex-1">
          <span>{language === 'hi' ? 'हटाएं' : 'Delete'}</span>
        </Button>
      </div>

      {armed && (
        <div className="absolute bottom-0 left-0 right-0 animate-in fade-in slide-in-from-bottom-2 bg-red-500 py-3 text-center text-sm font-bold text-white">
          <span>{language === 'hi' ? 'फिर से टैप करें' : 'Tap again to mark unavailable'}</span>
        </div>
      )}
    </Card>
  );
}

export function ShopMenuManagePage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { language } = useLanguage();
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
  const allTags = Array.from(new Set(items.flatMap((item) => item.tags || []))).sort();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Menu</h1>
          <p className="text-sm text-ink/60">Add, edit, and manage stock.</p>
        </div>
        <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
          <span>
            {language === 'hi'
              ? showAddForm
                ? 'फॉर्म बंद करें'
                : 'आइटम जोड़ें'
              : showAddForm
                ? 'Close form'
                : 'Add item'}
          </span>
        </Button>
      </div>

      {showAddForm && (
        <div className="mb-5">
          <MenuItemForm
            initial={EMPTY_FORM}
            allTags={allTags}
            onCancel={() => setShowAddForm(false)}
            onSubmit={(input) => createMutation.mutate(input)}
            submitting={createMutation.isPending}
          />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="No menu items yet" hint="Add your first item to get started." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <MenuItemRow key={item.id} item={item} allTags={allTags} />
          ))}
        </div>
      )}
    </div>
  );
}
