import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShopMenuManagePage } from './MenuManage';
import { ToastProvider } from '../../components/ui/Toast';
import { LanguageProvider } from '../../context/LanguageContext';
import { AuthProvider } from '../../context/AuthContext';
import type { MenuItem } from '../../api/types';

// jsdom doesn't implement these — MenuManage's photo picker calls them
// directly (createObjectURL for the local preview, createImageBitmap inside
// lib/image.ts's downscaleImage, which already falls back to the original
// File on any failure there).
beforeEach(() => {
  vi.stubGlobal('createImageBitmap', undefined);
});
URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
URL.revokeObjectURL = vi.fn();

const getShopMenuMock = vi.fn();
const updateMenuItemMock = vi.fn();
const uploadMenuItemPhotoMock = vi.fn();

vi.mock('../../api/shop', () => ({
  getShopMenu: () => getShopMenuMock(),
  createMenuItem: vi.fn(),
  updateMenuItem: (...args: unknown[]) => updateMenuItemMock(...args),
  deleteMenuItem: vi.fn(),
  setMenuItemStock: vi.fn(),
  uploadMenuItemPhoto: (...args: unknown[]) => uploadMenuItemPhotoMock(...args),
}));

const EXISTING_PHOTO_URL = 'https://res.cloudinary.com/demo/image/upload/v1/existing.jpg';

function existingItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 1,
    name: 'Samosa',
    price: 2000,
    photo_url: EXISTING_PHOTO_URL,
    diet: 'veg',
    tags: [],
    is_available: true,
    avail_from: null,
    avail_to: null,
    out_of_stock: false,
    status: 'available',
    orderable: true,
    order_count_today: 0,
    avg_rating: 0,
    rating_count: 0,
    ...overrides,
  };
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LanguageProvider>
          <MemoryRouter>
            <AuthProvider>
              <ShopMenuManagePage />
            </AuthProvider>
          </MemoryRouter>
        </LanguageProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Guards against a real regression found in a fresh read: MenuItemForm's
// photo-picker catch block reset form.photo_url to '' on ANY upload failure,
// including while editing an item that already had a working photo. Saving
// after a failed re-upload attempt therefore wiped a perfectly good,
// already-published photo from the item — even though nothing new was ever
// successfully uploaded.
describe('MenuItemForm — a failed photo re-upload must not erase the existing photo', () => {
  beforeEach(() => {
    getShopMenuMock.mockReset();
    updateMenuItemMock.mockReset();
    uploadMenuItemPhotoMock.mockReset();
  });

  it('keeps the original photo_url in the saved payload after an upload failure', async () => {
    getShopMenuMock.mockResolvedValue([existingItem()]);
    uploadMenuItemPhotoMock.mockRejectedValue(new Error('network error'));
    updateMenuItemMock.mockResolvedValue(existingItem());

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() => expect(screen.getByText('Samosa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Edit'));

    const fileInput = await waitFor(() => {
      const input = document.querySelector('input[type="file"]');
      expect(input).toBeTruthy();
      return input as HTMLInputElement;
    });

    const file = new File(['fake-bytes'], 'new-photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // The failed upload must surface an error toast...
    await waitFor(() => expect(screen.getByText('Photo upload failed.')).toBeInTheDocument());

    // ...and must not have touched the name/price validity — Save should go
    // straight through to the update call.
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateMenuItemMock).toHaveBeenCalled());
    const [, submittedInput] = updateMenuItemMock.mock.calls[0];
    expect(submittedInput.photo_url).toBe(EXISTING_PHOTO_URL);
  });
});
