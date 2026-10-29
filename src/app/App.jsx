import { RouterProvider } from "react-router-dom";
import { router } from "./routes.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </AuthProvider>
  );
}
