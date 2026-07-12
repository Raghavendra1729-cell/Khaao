import { apiFetch } from './client';
import type { MenuItem } from './types';

export async function getMenu(): Promise<MenuItem[]> {
  const res = await apiFetch<{ items: MenuItem[] }>('/menu');
  return res.items;
}
