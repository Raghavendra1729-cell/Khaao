import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';

// Route-group chunks: a student's first load never needs to fetch the shop
// pages (and vice versa), and neither needs to fetch the other role's pages
// at all in the common case — one role per session (STATUS.md R24).
const Menu = lazy(() => import('./pages/student/Menu').then((m) => ({ default: m.Menu })));
const OrderStatusPage = lazy(() =>
  import('./pages/student/OrderStatus').then((m) => ({ default: m.OrderStatusPage })),
);
const ShopOrdersPage = lazy(() => import('./pages/shop/Orders').then((m) => ({ default: m.ShopOrdersPage })));
const ShopPrepPage = lazy(() => import('./pages/shop/Prep').then((m) => ({ default: m.ShopPrepPage })));
const ShopMenuManagePage = lazy(() =>
  import('./pages/shop/MenuManage').then((m) => ({ default: m.ShopMenuManagePage })),
);
const ShopHistoryPage = lazy(() =>
  import('./pages/shop/History').then((m) => ({ default: m.ShopHistoryPage })),
);

function RoleHome() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'shopkeeper' ? '/shop' : '/'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute role="student">
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Menu />} />
        <Route path="/order" element={<OrderStatusPage />} />
      </Route>

      <Route
        element={
          <ProtectedRoute role="shopkeeper">
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/shop" element={<ShopOrdersPage />} />
        <Route path="/shop/prep" element={<ShopPrepPage />} />
        <Route path="/shop/history" element={<ShopHistoryPage />} />
        <Route path="/shop/menu" element={<ShopMenuManagePage />} />
      </Route>

      <Route path="*" element={<RoleHome />} />
    </Routes>
  );
}
