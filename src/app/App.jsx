import { RouterProvider } from "react-router-dom";
import { router } from "./routes.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AppProvider>
    </AuthProvider>
  );
}
