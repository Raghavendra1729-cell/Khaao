import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Menu } from './pages/student/Menu';
import { OrderStatusPage } from './pages/student/OrderStatus';
import { ShopOrdersPage } from './pages/shop/Orders';
import { ShopPrepPage } from './pages/shop/Prep';
import { ShopMenuManagePage } from './pages/shop/MenuManage';

function RoleHome() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'shopkeeper' ? '/shop' : '/'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

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
        <Route path="/shop/menu" element={<ShopMenuManagePage />} />
      </Route>

      <Route path="*" element={<RoleHome />} />
    </Routes>
  );
}
